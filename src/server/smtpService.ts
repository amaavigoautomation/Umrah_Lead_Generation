import fs from 'fs';
import path from 'path';
import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';

/**
 * Outgoing email is sent through Resend (https://resend.com) instead of SMTP.
 * The exported names/shapes are unchanged so every existing caller keeps working:
 *   sendLiveEmail()        -> sends one email via Resend
 *   verifySmtpConnection() -> checks the Resend API key
 *   getSmtpConfig()        -> `configured` now means "RESEND_API_KEY is set"
 *
 * Env vars:
 *   RESEND_API_KEY      required
 *   RESEND_FROM_EMAIL   required — an address on a domain verified in Resend, e.g. hello@yourdomain.com
 *   RESEND_FROM_NAME    optional — display name (default "Umrah360 Automation")
 *   RESEND_REPLY_TO     optional — where replies go (default: the existing IMAP/SMTP_USER mailbox)
 */

export interface SmtpStatus {
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  from: string;
  verified: boolean;
  lastChecked?: string;
  lastError?: string;
}

export interface EmailAttachmentParam {
  filename: string;
  content?: string | Buffer;
  path?: string;
  contentType?: string;
  encoding?: string;
  dataUrl?: string;
}

export interface SendMailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  replyTo?: string;
  attachments?: EmailAttachmentParam[];
  headers?: Record<string, string>;
}

export interface SendMailResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
  simulated?: boolean;
  isDailyLimitExceeded?: boolean;
}

const RESEND_API_BASE = 'https://api.resend.com';

// In-memory status cache
let cachedSmtpStatus: SmtpStatus | null = null;

// Runtime in-memory config override (kept for the existing /api/smtp/config route; only used for display/reply-to now)
let runtimeSmtpConfig: {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
} | null = null;

const CREDENTIALS_FILE = path.join(process.cwd(), '.mail_credentials.json');

function loadSavedCredentials(): any {
  try {
    if (fs.existsSync(CREDENTIALS_FILE)) {
      const data = fs.readFileSync(CREDENTIALS_FILE, 'utf-8');
      return JSON.parse(data);
    }
  } catch (e) {
    // ignore
  }
  return null;
}

function saveCredentialsToFile(creds: any) {
  try {
    const existing = loadSavedCredentials() || {};
    const updated = { ...existing, ...creds };
    fs.writeFileSync(CREDENTIALS_FILE, JSON.stringify(updated, null, 2), 'utf-8');
  } catch (e) {
    // ignore
  }
}

export function updateSmtpConfig(newConfig: {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
}) {
  const current = getSmtpConfig();
  runtimeSmtpConfig = {
    host: newConfig.host !== undefined ? newConfig.host : current.host,
    port: newConfig.port !== undefined ? newConfig.port : current.port,
    secure: newConfig.secure !== undefined ? newConfig.secure : current.secure,
    user: newConfig.user !== undefined ? newConfig.user : current.user,
    pass: newConfig.pass !== undefined ? newConfig.pass : current.pass,
    from: newConfig.from !== undefined ? newConfig.from : current.from,
  };
  cachedSmtpStatus = null;
  saveCredentialsToFile({ smtp: runtimeSmtpConfig });
  return getSmtpConfig();
}

function getResendApiKey(): string {
  return (process.env.RESEND_API_KEY || '').trim();
}

function formatFrom(name: string, email: string): string {
  const cleanName = (name || '').replace(/["<>\r\n]/g, '').trim();
  return cleanName ? `"${cleanName}" <${email}>` : email;
}

/**
 * Legacy-shaped config. `configured` is true when RESEND_API_KEY is set.
 * `user` is still the mailbox replies are read from (IMAP) and is the default Reply-To.
 */
export function getSmtpConfig() {
  const saved = loadSavedCredentials()?.smtp;
  const host = 'api.resend.com';
  const port = 443;
  const secure = true;

  const user =
    runtimeSmtpConfig?.user ||
    saved?.user ||
    process.env.SMTP_USER ||
    process.env.GMAIL_USER ||
    process.env.IMAP_USER ||
    'amaavigo@gmail.com';
  const pass = ''; // no mail password is needed for sending any more

  const fromEmail = (process.env.RESEND_FROM_EMAIL || '').trim();
  const fromName = (process.env.RESEND_FROM_NAME || 'Umrah360 Automation').trim();
  const from = fromEmail ? formatFrom(fromName, fromEmail) : `Umrah360 Automation <${user}>`;

  const configured = Boolean(getResendApiKey());

  return { host, port, secure, user, pass, from, configured };
}

/** Kept for compatibility with callers that refresh SMTP settings from Firestore. Resend needs nothing from there. */
export async function fetchFirestoreSmtpConfig() {
  if (isFirebaseConfigured && db) {
    try {
      await getDoc(doc(db, 'system_settings', 'default'));
    } catch (e) {
      // ignore
    }
  }
  return getSmtpConfig();
}

/** Checks the Resend API key. */
export async function verifySmtpConnection(): Promise<SmtpStatus> {
  const config = getSmtpConfig();
  const now = new Date().toISOString();
  const base = {
    host: config.host,
    port: config.port,
    secure: config.secure,
    user: config.user,
    from: config.from,
    lastChecked: now,
  };

  if (!config.configured) {
    cachedSmtpStatus = {
      ...base,
      configured: false,
      verified: false,
      lastError: 'RESEND_API_KEY is not set. Add it to your environment to enable email sending.',
    };
    return cachedSmtpStatus;
  }

  if (!(process.env.RESEND_FROM_EMAIL || '').trim()) {
    cachedSmtpStatus = {
      ...base,
      configured: true,
      verified: false,
      lastError: 'RESEND_FROM_EMAIL is not set. Use an address on a domain verified in Resend.',
    };
    return cachedSmtpStatus;
  }

  try {
    const res = await fetch(`${RESEND_API_BASE}/domains`, {
      headers: { Authorization: `Bearer ${getResendApiKey()}` },
    });
    let json: any = null;
    try {
      json = await res.json();
    } catch {
      json = null;
    }
    // A "sending access" key cannot list domains but is still a valid key for sending.
    const valid = res.ok || json?.name === 'restricted_api_key';
    cachedSmtpStatus = {
      ...base,
      configured: true,
      verified: valid,
      lastError: valid ? undefined : json?.message || `Resend rejected the API key (HTTP ${res.status}).`,
    };
    return cachedSmtpStatus;
  } catch (err: any) {
    cachedSmtpStatus = {
      ...base,
      configured: true,
      verified: false,
      lastError: err?.message || 'Could not reach the Resend API.',
    };
    return cachedSmtpStatus;
  }
}

function toResendAttachments(
  attachments?: EmailAttachmentParam[]
): Array<{ filename: string; content: string; content_type?: string }> | undefined {
  if (!attachments || !Array.isArray(attachments) || attachments.length === 0) return undefined;
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
      if (Buffer.isBuffer(att.content)) base64 = att.content.toString('base64');
      else if (typeof att.content === 'string') {
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

function wait(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Sends one email through Resend. */
export async function sendLiveEmail(params: SendMailParams): Promise<SendMailResult> {
  const apiKey = getResendApiKey();
  const config = getSmtpConfig();

  if (!apiKey) {
    return {
      success: false,
      error: 'RESEND_API_KEY is not set, so no emails can be sent.',
      simulated: false,
    };
  }
  if (!(process.env.RESEND_FROM_EMAIL || '').trim()) {
    return {
      success: false,
      error: 'RESEND_FROM_EMAIL is not set. Use an address on a domain verified in Resend.',
      simulated: false,
    };
  }

  const headers: Record<string, string> = {
    'X-Mailer': 'Umrah360-AI-Automated-Platform',
    'X-Automated-By': config.user,
    ...(params.headers || {}),
  };
  if (params.inReplyTo) {
    headers['In-Reply-To'] = params.inReplyTo;
    headers['References'] = params.references && params.references.length > 0 ? params.references.join(' ') : params.inReplyTo;
  }

  const body: Record<string, any> = {
    from: config.from,
    to: [params.to],
    subject: params.subject,
    text: params.text,
    html: params.html || (params.text || '').replace(/\n/g, '<br/>'),
    reply_to: params.replyTo || (process.env.RESEND_REPLY_TO || '').trim() || config.user,
    headers,
  };
  const attachments = toResendAttachments(params.attachments);
  if (attachments) body.attachments = attachments;

  try {
    let attempt = 0;
    while (true) {
      const res = await fetch(`${RESEND_API_BASE}/emails`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      let json: any = null;
      try {
        json = await res.json();
      } catch {
        json = null;
      }

      if (res.ok && json?.id) {
        console.log(`[Resend] Sent email to ${params.to}, id: ${json.id}`);
        return { success: true, messageId: String(json.id), simulated: false };
      }

      const name: string | undefined = json?.name;
      const isQuota = name === 'daily_quota_exceeded' || name === 'monthly_quota_exceeded';

      // Plain rate limit (too many requests per second): wait and retry a couple of times
      if (res.status === 429 && !isQuota && attempt < 2) {
        attempt++;
        const retryAfter = Number(res.headers.get('retry-after'));
        await wait(Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter * 1000 : 1000 * attempt);
        continue;
      }

      const message = json?.message || `HTTP ${res.status}`;
      console.error(`[Resend] Error sending email to ${params.to}:`, message);
      return {
        success: false,
        error: `Resend error: ${message}`,
        simulated: false,
        isDailyLimitExceeded: isQuota,
      };
    }
  } catch (err: any) {
    console.error(`[Resend] Request failed for ${params.to}:`, err);
    return {
      success: false,
      error: `Resend request failed: ${err?.message || 'Unknown error'}`,
      simulated: false,
    };
  }
}