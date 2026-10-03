import fs from 'fs';
import path from 'path';
import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import {
  isResendConfigured,
  sendViaResend,
  listResendDomains,
  formatFromAddress,
} from './resendService.js';
import { findIdentity, getDefaultIdentity, bumpIdentityUsage } from './sendingIdentities.js';

/**
 * Outgoing email now goes through Resend (see resendService.ts / sendingIdentities.ts).
 *
 * This module keeps the legacy "SMTP" names so existing callers and API routes keep working:
 *  - sendLiveEmail()        -> sends one email through Resend using a sending identity
 *  - verifySmtpConnection() -> checks the Resend API key / account
 *  - getSmtpConfig()        -> legacy shape; `configured` now means "RESEND_API_KEY is set"
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
  /** Send from this specific sending identity. Defaults to the client's (or platform's) default identity. */
  identityId?: string;
  /** Client (tenant) the email is sent on behalf of. Defaults to the platform client. */
  clientId?: string;
  idempotencyKey?: string;
}

export interface SendMailResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
  simulated?: boolean;
  isDailyLimitExceeded?: boolean;
}

// In-memory status cache
let cachedSmtpStatus: SmtpStatus | null = null;

// Runtime in-memory config override (legacy; only used for display / reply-to defaults now)
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

const DEFAULT_SMTP_USER = 'amaavigo@gmail.com';

/**
 * Legacy-shaped config. `configured` now reflects whether Resend is ready to send;
 * `user`/`from` prefer RESEND_FROM_EMAIL / RESEND_FROM_NAME when set (they are only used for display
 * and inbox bookkeeping — the actual sender is the sending identity chosen at send time).
 */
export function getSmtpConfig() {
  const saved = loadSavedCredentials()?.smtp;
  const host = runtimeSmtpConfig?.host || saved?.host || process.env.SMTP_HOST || 'api.resend.com';
  const port = runtimeSmtpConfig?.port || saved?.port || parseInt(process.env.SMTP_PORT || '443', 10);
  const secure = runtimeSmtpConfig?.secure !== undefined ? runtimeSmtpConfig.secure : saved?.secure !== undefined ? saved.secure : true;

  const resendFromEmail = (process.env.RESEND_FROM_EMAIL || '').trim();
  const resendFromName = (process.env.RESEND_FROM_NAME || 'Umrah360').trim();

  const user = resendFromEmail || runtimeSmtpConfig?.user || saved?.user || process.env.SMTP_USER || DEFAULT_SMTP_USER;
  const pass = ''; // no mail passwords are kept for sending anymore
  const from = resendFromEmail
    ? `${resendFromName} <${resendFromEmail}>`
    : runtimeSmtpConfig?.from || saved?.from || process.env.SMTP_FROM || `Umrah360 Automation <${user}>`;

  const configured = isResendConfigured();

  return { host, port, secure, user, pass, from, configured };
}

/** Kept for compatibility with callers that refresh SMTP settings from Firestore. Resend needs none. */
export async function fetchFirestoreSmtpConfig() {
  if (isFirebaseConfigured && db) {
    try {
      const settingsSnap = await getDoc(doc(db, 'system_settings', 'default'));
      if (settingsSnap.exists()) {
        const data = settingsSnap.data() as any;
        const smtp = data.smtp || {};
        const fromToUse = data.smtpFrom || smtp.from;
        if (fromToUse && typeof fromToUse === 'string') {
          runtimeSmtpConfig = { ...(runtimeSmtpConfig || {}), from: fromToUse };
        }
      }
    } catch (e) {
      console.warn('[Email Service] Error reading Firestore settings:', e);
    }
  }
  return getSmtpConfig();
}

/** Checks the Resend API key by listing the account's domains. */
export async function verifySmtpConnection(): Promise<SmtpStatus> {
  const config = getSmtpConfig();
  const now = new Date().toISOString();

  if (!isResendConfigured()) {
    cachedSmtpStatus = {
      configured: false,
      host: 'api.resend.com',
      port: 443,
      secure: true,
      user: config.user,
      from: config.from,
      verified: false,
      lastChecked: now,
      lastError: 'RESEND_API_KEY is not set on the server. Add it to your environment to enable email sending.',
    };
    return cachedSmtpStatus;
  }

  const domains = await listResendDomains();
  const identity = await getDefaultIdentity().catch(() => null);

  cachedSmtpStatus = {
    configured: true,
    host: 'api.resend.com',
    port: 443,
    secure: true,
    user: identity?.fromEmail || config.user,
    from: identity ? `${identity.fromName} <${identity.fromEmail}>` : config.from,
    verified: domains !== null,
    lastChecked: now,
    lastError: domains === null ? 'Could not reach the Resend API — check that RESEND_API_KEY is valid.' : undefined,
  };
  return cachedSmtpStatus;
}

/**
 * Sends one email through Resend.
 * Used for one-off mail (auto-replies, thank-you emails, manual sends). The campaign engine talks to
 * Resend directly so it can batch.
 */
export async function sendLiveEmail(params: SendMailParams): Promise<SendMailResult> {
  if (!isResendConfigured()) {
    return {
      success: false,
      error: 'RESEND_API_KEY is not configured on the server, so no emails can be sent.',
      simulated: false,
    };
  }

  let identity = params.identityId ? await findIdentity(params.identityId) : null;
  if (!identity) identity = await getDefaultIdentity(params.clientId);
  if (!identity) {
    return {
      success: false,
      error:
        'No sending identity is configured. Add a verified domain under Settings → Sending Domains (or set RESEND_FROM_EMAIL for platform mail).',
      simulated: false,
    };
  }

  const headers: Record<string, string> = {
    'X-Mailer': 'Umrah360-AI-Automated-Platform',
    ...(params.headers || {}),
  };
  if (params.inReplyTo) {
    headers['In-Reply-To'] = params.inReplyTo;
    const refs = params.references && params.references.length > 0 ? params.references.join(' ') : params.inReplyTo;
    headers['References'] = refs;
  }

  const result = await sendViaResend({
    from: formatFromAddress(identity.fromName, identity.fromEmail),
    to: params.to,
    subject: params.subject,
    text: params.text,
    html: params.html,
    replyTo: params.replyTo || identity.replyTo || identity.fromEmail,
    headers,
    attachments: params.attachments,
    idempotencyKey: params.idempotencyKey,
  });

  if (result.success) {
    await bumpIdentityUsage(identity.identityId, 1).catch(() => {});
    console.log(`[Resend] Sent email to ${params.to} from ${identity.fromEmail}, id: ${result.id}`);
    return { success: true, messageId: result.id, simulated: false };
  }

  console.error(`[Resend] Error sending email to ${params.to}:`, result.error);
  return {
    success: false,
    error: `Resend error: ${result.error || 'Unknown error'}`,
    simulated: false,
    isDailyLimitExceeded: result.isDailyLimitExceeded,
  };
}
