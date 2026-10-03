import crypto from 'crypto';
import { collection, doc, getDocs, setDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { sanitizeForFirestore } from './firestoreUtils.js';
import type { SuppressionReason } from '../types/index.js';

/**
 * Suppression list + unsubscribe links.
 *
 * - Suppressions are per client, except hard bounces and spam complaints which are stored under
 *   GLOBAL_SCOPE and block that address for every client (they hurt the shared Resend account).
 * - Every campaign email carries a List-Unsubscribe header (RFC 8058 one-click) and a footer link.
 *
 * Env:
 *   APP_URL              public base URL of this deployment (needed to build unsubscribe links)
 *   UNSUBSCRIBE_SECRET   HMAC secret for unsubscribe tokens (falls back to AUTH_SECRET)
 */

export const GLOBAL_SCOPE = '*';
const PLATFORM_SCOPE = 'platform';

interface SuppressionRecord {
  key: string;
  scope: string;
  email: string;
  reason: SuppressionReason;
  source?: string;
  createdAt: string;
}

const suppressed = new Set<string>(); // `${scope}|${email}`
let lastLoadAt = 0;
let loading: Promise<void> | null = null;
const RELOAD_INTERVAL_MS = 2 * 60 * 1000;

function normEmail(email: string): string {
  return (email || '').trim().toLowerCase();
}

function scopeOf(clientId?: string | null): string {
  return clientId && clientId.trim() ? clientId.trim() : PLATFORM_SCOPE;
}

function memKey(scope: string, email: string): string {
  return `${scope}|${normEmail(email)}`;
}

function docIdFor(scope: string, email: string): string {
  return crypto.createHash('sha256').update(`${scope}|${normEmail(email)}`).digest('hex').slice(0, 40);
}

async function loadSuppressions(force = false): Promise<void> {
  if (!force && Date.now() - lastLoadAt < RELOAD_INTERVAL_MS) return;
  if (loading) return loading;

  loading = (async () => {
    try {
      if (isFirebaseConfigured && db) {
        const snap = await getDocs(collection(db, 'email_suppressions')).catch(() => null);
        if (snap) {
          snap.forEach((d) => {
            const r = d.data() as SuppressionRecord;
            if (r && r.email && r.scope) suppressed.add(memKey(r.scope, r.email));
          });
        }
      }
      lastLoadAt = Date.now();
    } finally {
      loading = null;
    }
  })();

  return loading;
}

export async function isSuppressed(clientId: string | undefined | null, email: string): Promise<boolean> {
  await loadSuppressions();
  return suppressed.has(memKey(scopeOf(clientId), email)) || suppressed.has(memKey(GLOBAL_SCOPE, email));
}

export async function addSuppression(params: {
  clientId?: string | null;
  email: string;
  reason: SuppressionReason;
  source?: string;
}): Promise<void> {
  const email = normEmail(params.email);
  if (!email) return;

  // Hard bounces and complaints are global; unsubscribes/manual stay inside the client.
  const scope = params.reason === 'bounced' || params.reason === 'complained' ? GLOBAL_SCOPE : scopeOf(params.clientId);
  suppressed.add(memKey(scope, email));

  if (isFirebaseConfigured && db) {
    const record: SuppressionRecord = {
      key: docIdFor(scope, email),
      scope,
      email,
      reason: params.reason,
      source: params.source,
      createdAt: new Date().toISOString(),
    };
    try {
      await setDoc(doc(db, 'email_suppressions', record.key), sanitizeForFirestore(record), { merge: true });
    } catch (e) {
      console.warn('[Suppression] Failed to persist suppression:', e);
    }
  }
}

// ---------------------------------------------------------------------------
// Unsubscribe tokens
// ---------------------------------------------------------------------------

function getTokenSecret(): string {
  return process.env.UNSUBSCRIBE_SECRET || process.env.AUTH_SECRET || 'umrah360-dev-unsubscribe-secret';
}

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function sign(data: string): string {
  return b64url(crypto.createHmac('sha256', getTokenSecret()).update(data).digest());
}

export interface UnsubscribePayload {
  c: string; // clientId scope
  e: string; // email
  k?: string; // campaignId
}

export function makeUnsubscribeToken(params: { clientId?: string | null; email: string; campaignId?: string }): string {
  const payload: UnsubscribePayload = { c: scopeOf(params.clientId), e: normEmail(params.email), k: params.campaignId };
  const body = b64url(JSON.stringify(payload));
  return `${body}.${sign(body)}`;
}

export function parseUnsubscribeToken(token: string): UnsubscribePayload | null {
  if (!token || !token.includes('.')) return null;
  const [body, sig] = token.split('.');
  const expected = sign(body);
  const a = Buffer.from(sig || '');
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf-8'));
    if (payload && typeof payload.e === 'string' && typeof payload.c === 'string') return payload as UnsubscribePayload;
  } catch {
    // fallthrough
  }
  return null;
}

export function getPublicBaseUrl(): string {
  return (process.env.APP_URL || '').trim().replace(/\/+$/, '');
}

export interface ComplianceExtras {
  headers: Record<string, string>;
  textFooter: string;
  htmlFooter: string;
}

/** Headers + footer text that make a campaign email unsubscribable. */
export function buildComplianceExtras(params: {
  clientId?: string | null;
  email: string;
  campaignId?: string;
  replyTo?: string;
}): ComplianceExtras {
  const base = getPublicBaseUrl();
  const headers: Record<string, string> = {};
  let url = '';

  if (base) {
    const token = makeUnsubscribeToken(params);
    url = `${base}/api/unsubscribe?t=${encodeURIComponent(token)}`;
    const parts = [`<${url}>`];
    if (params.replyTo) parts.push(`<mailto:${params.replyTo}?subject=unsubscribe>`);
    headers['List-Unsubscribe'] = parts.join(', ');
    headers['List-Unsubscribe-Post'] = 'List-Unsubscribe=One-Click';
  } else if (params.replyTo) {
    headers['List-Unsubscribe'] = `<mailto:${params.replyTo}?subject=unsubscribe>`;
  }

  const textFooter = url
    ? `\n\n--\nIf you'd rather not receive emails from us, unsubscribe here: ${url}`
    : params.replyTo
    ? `\n\n--\nIf you'd rather not receive emails from us, reply with "unsubscribe".`
    : '';
  const htmlFooter = url
    ? `<br/><br/><div style="font-size:12px;color:#888;">If you'd rather not receive emails from us, <a href="${url}">unsubscribe here</a>.</div>`
    : params.replyTo
    ? `<br/><br/><div style="font-size:12px;color:#888;">If you'd rather not receive emails from us, reply with "unsubscribe".</div>`
    : '';

  return { headers, textFooter, htmlFooter };
}
