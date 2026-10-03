import crypto from 'crypto';
import fs from 'fs';

/**
 * Resend transport (plain REST via fetch — no SDK dependency).
 *
 * Env:
 *   RESEND_API_KEY          required — full-access key; it can send from every verified domain in the account
 *   RESEND_WEBHOOK_SECRET   optional — signing secret (whsec_...) for /api/webhooks/resend
 *
 * Notes:
 *  - Default Resend limit is ~2 requests/second per team. Callers pace themselves; this layer also
 *    retries 429 "rate_limit_exceeded" responses (honouring Retry-After) a few times.
 *  - Quota errors (daily/monthly) are NOT retried; they are surfaced as isDailyLimitExceeded so the
 *    campaign engine can pause cleanly.
 *  - The batch endpoint accepts up to 100 emails per call but does not support attachments.
 */

const RESEND_API_BASE = 'https://api.resend.com';
export const RESEND_BATCH_LIMIT = 100;
/** Pause between Resend API calls to stay under the default 2 req/s limit. */
export const RESEND_CALL_SPACING_MS = 600;

export interface ResendAttachmentInput {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  encoding?: string;
  dataUrl?: string;
}

export interface ResendEmailPayload {
  from: string;
  to: string;
  subject: string;
  text?: string;
  html?: string;
  replyTo?: string;
  headers?: Record<string, string>;
  attachments?: ResendAttachmentInput[];
  tags?: Array<{ name: string; value: string }>;
  /** Used as the Idempotency-Key header (single sends only). */
  idempotencyKey?: string;
}

export interface ResendSendResult {
  success: boolean;
  id?: string;
  error?: string;
  errorName?: string;
  statusCode?: number;
  /** Daily or monthly sending quota reached — retrying will not help until the quota resets. */
  isDailyLimitExceeded?: boolean;
  /** Still rate limited after internal retries. */
  isRateLimited?: boolean;
  /** Request was rejected as invalid (bad address etc.) — safe to fall back to single sends for a batch. */
  isValidationError?: boolean;
}

export interface ResendBatchResult {
  success: boolean;
  ids: string[];
  error?: string;
  errorName?: string;
  statusCode?: number;
  isDailyLimitExceeded?: boolean;
  isRateLimited?: boolean;
  isValidationError?: boolean;
}

export function getResendApiKey(): string {
  return (process.env.RESEND_API_KEY || '').trim();
}

export function isResendConfigured(): boolean {
  return Boolean(getResendApiKey());
}

export function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function normalizeAttachments(
  attachments?: ResendAttachmentInput[]
): Array<{ filename: string; content: string; content_type?: string }> | undefined {
  if (!attachments || attachments.length === 0) return undefined;
  const out: Array<{ filename: string; content: string; content_type?: string }> = [];

  for (const att of attachments) {
    let base64: string | undefined;
    let contentType = att.contentType;

    if (att.dataUrl && !att.content) {
      const m = att.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) {
        contentType = contentType || m[1];
        base64 = m[2];
      }
    }
    if (!base64 && att.content !== undefined) {
      if (Buffer.isBuffer(att.content)) {
        base64 = att.content.toString('base64');
      } else if (typeof att.content === 'string') {
        base64 = att.encoding === 'base64' ? att.content : Buffer.from(att.content, 'utf-8').toString('base64');
      }
    }
    if (!base64 && att.path) {
      try {
        base64 = fs.readFileSync(att.path).toString('base64');
      } catch {
        // skip unreadable attachment
      }
    }
    if (!base64) continue;

    out.push({
      filename: att.filename || 'attachment',
      content: base64,
      ...(contentType ? { content_type: contentType } : {}),
    });
  }

  return out.length > 0 ? out : undefined;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Builds a safe RFC 5322 "From" value: "Display Name" <address>. */
export function formatFromAddress(name: string, email: string): string {
  const cleanName = (name || '').replace(/["<>\r\n]/g, '').trim();
  return cleanName ? `"${cleanName}" <${email}>` : email;
}

export function textToHtml(text: string): string {
  return escapeHtml(text || '').replace(/\r?\n/g, '<br/>');
}

/** Resend tag values may only contain ASCII letters, numbers, underscores and dashes. */
export function sanitizeTagValue(v: string): string {
  return (v || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 256);
}

function toApiBody(p: ResendEmailPayload): Record<string, any> {
  const body: Record<string, any> = {
    from: p.from,
    to: [p.to],
    subject: p.subject,
  };
  if (p.text) body.text = p.text;
  body.html = p.html || textToHtml(p.text || '');
  if (p.replyTo) body.reply_to = p.replyTo;
  if (p.headers && Object.keys(p.headers).length > 0) body.headers = p.headers;
  const atts = normalizeAttachments(p.attachments);
  if (atts) body.attachments = atts;
  if (p.tags && p.tags.length > 0) body.tags = p.tags;
  return body;
}

interface RawResponse {
  ok: boolean;
  status: number;
  json: any;
  retryAfterMs?: number;
}

async function postJson(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<RawResponse> {
  const apiKey = getResendApiKey();
  const res = await fetch(`${RESEND_API_BASE}${path}`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...extraHeaders,
    },
    body: JSON.stringify(body),
  });

  let json: any = null;
  try {
    json = await res.json();
  } catch {
    json = null;
  }

  let retryAfterMs: number | undefined;
  const ra = res.headers.get('retry-after');
  if (ra && !Number.isNaN(Number(ra))) retryAfterMs = Math.max(0, Number(ra)) * 1000;

  return { ok: res.ok, status: res.status, json, retryAfterMs };
}

function isQuotaError(name: string | undefined): boolean {
  return name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded';
}

/** POST with automatic retry on plain rate-limit (429) responses. */
async function postWithRetry(path: string, body: unknown, extraHeaders: Record<string, string> = {}): Promise<RawResponse> {
  let attempt = 0;
  // up to 4 attempts total
  while (true) {
    const r = await postJson(path, body, extraHeaders);
    const name: string | undefined = r.json?.name;
    if (r.status === 429 && !isQuotaError(name) && attempt < 3) {
      attempt++;
      await sleep(r.retryAfterMs ?? 1000 * attempt);
      continue;
    }
    return r;
  }
}

export async function sendViaResend(payload: ResendEmailPayload): Promise<ResendSendResult> {
  if (!isResendConfigured()) {
    return { success: false, error: 'RESEND_API_KEY is not configured on the server.' };
  }
  try {
    const headers: Record<string, string> = {};
    if (payload.idempotencyKey) headers['Idempotency-Key'] = payload.idempotencyKey.slice(0, 256);

    const r = await postWithRetry('/emails', toApiBody(payload), headers);
    if (r.ok && r.json?.id) {
      return { success: true, id: String(r.json.id) };
    }
    const name: string | undefined = r.json?.name;
    return {
      success: false,
      error: r.json?.message || `Resend error (HTTP ${r.status})`,
      errorName: name,
      statusCode: r.status,
      isDailyLimitExceeded: isQuotaError(name),
      isRateLimited: r.status === 429 && !isQuotaError(name),
      isValidationError: r.status === 422 || r.status === 400,
    };
  } catch (err: any) {
    return { success: false, error: `Resend request failed: ${err?.message || String(err)}` };
  }
}

/**
 * Sends up to 100 emails in one request. Attachments are not supported by Resend's batch endpoint,
 * so callers must send attachment emails individually.
 */
export async function sendBatchViaResend(payloads: ResendEmailPayload[], idempotencyKey?: string): Promise<ResendBatchResult> {
  if (!isResendConfigured()) {
    return { success: false, ids: [], error: 'RESEND_API_KEY is not configured on the server.' };
  }
  if (payloads.length === 0) return { success: true, ids: [] };
  if (payloads.length > RESEND_BATCH_LIMIT) {
    return { success: false, ids: [], error: `Batch too large (max ${RESEND_BATCH_LIMIT})` };
  }

  try {
    const headers: Record<string, string> = {};
    if (idempotencyKey) headers['Idempotency-Key'] = idempotencyKey.slice(0, 256);

    const r = await postWithRetry('/emails/batch', payloads.map(toApiBody), headers);
    if (r.ok) {
      const list: any[] = Array.isArray(r.json?.data) ? r.json.data : Array.isArray(r.json) ? r.json : [];
      const ids = list.map((x) => (x && x.id ? String(x.id) : ''));
      if (ids.length === payloads.length && ids.every(Boolean)) {
        return { success: true, ids };
      }
      return { success: false, ids: [], error: 'Unexpected batch response from Resend', statusCode: r.status };
    }
    const name: string | undefined = r.json?.name;
    return {
      success: false,
      ids: [],
      error: r.json?.message || `Resend batch error (HTTP ${r.status})`,
      errorName: name,
      statusCode: r.status,
      isDailyLimitExceeded: isQuotaError(name),
      isRateLimited: r.status === 429 && !isQuotaError(name),
      isValidationError: r.status === 422 || r.status === 400,
    };
  } catch (err: any) {
    return { success: false, ids: [], error: `Resend batch request failed: ${err?.message || String(err)}` };
  }
}

export interface ResendDomainInfo {
  id?: string;
  name: string;
  status: string;
}

/** Lists the domains in the Resend account (used to validate sender identities). Returns null if the lookup fails. */
export async function listResendDomains(): Promise<ResendDomainInfo[] | null> {
  if (!isResendConfigured()) return null;
  try {
    const res = await fetch(`${RESEND_API_BASE}/domains`, {
      headers: { Authorization: `Bearer ${getResendApiKey()}` },
    });
    if (!res.ok) return null;
    const json: any = await res.json();
    const list: any[] = Array.isArray(json?.data) ? json.data : Array.isArray(json) ? json : [];
    return list
      .filter((d) => d && d.name)
      .map((d) => ({ id: d.id, name: String(d.name).toLowerCase(), status: String(d.status || 'unknown') }));
  } catch {
    return null;
  }
}

function safeEqual(a: string, b: string): boolean {
  const ab = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ab.length !== bb.length) return false;
  return crypto.timingSafeEqual(ab, bb);
}

/**
 * Verifies a Resend (Svix) webhook signature.
 * Headers: svix-id, svix-timestamp, svix-signature ("v1,<base64> v1,<base64> ...").
 */
export function verifyResendWebhookSignature(
  rawBody: string,
  headers: Record<string, string | string[] | undefined>,
  secret: string
): boolean {
  const pick = (name: string): string => {
    const v = headers[name] ?? headers[name.toLowerCase()];
    return Array.isArray(v) ? v[0] || '' : v || '';
  };
  const id = pick('svix-id');
  const timestamp = pick('svix-timestamp');
  const sigHeader = pick('svix-signature');
  if (!id || !timestamp || !sigHeader || !secret) return false;

  const ts = Number(timestamp);
  if (!Number.isFinite(ts) || Math.abs(Date.now() / 1000 - ts) > 5 * 60) return false;

  const secretPart = secret.startsWith('whsec_') ? secret.slice(6) : secret;
  let key: Buffer;
  try {
    key = Buffer.from(secretPart, 'base64');
  } catch {
    return false;
  }

  const expected = crypto.createHmac('sha256', key).update(`${id}.${timestamp}.${rawBody}`).digest('base64');

  for (const part of sigHeader.split(' ')) {
    const [version, sig] = part.split(',');
    if (version === 'v1' && sig && safeEqual(sig, expected)) return true;
  }
  return false;
}
