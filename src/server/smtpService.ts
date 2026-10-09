import nodemailer from 'nodemailer';
import { Resend } from 'resend';
import fs from 'fs';
import path from 'path';
import { doc, getDoc, setDoc } from './adminFirestore.js';
import { globalEmailRouteDoc } from './tenantRepo.js';
import { resolveTenantSender } from './tenantEmailService.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';

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
  /** Used to map Resend delivery events (bounce/complaint) back to a workspace. */
  tenantId?: string;
}

export interface SendMailResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
  simulated?: boolean;
  isDailyLimitExceeded?: boolean;
  provider?: 'resend' | 'smtp';
  /**
   * True when THIS SERVER cannot send email at all (Resend key missing or refused here).
   * That is a setup problem of the server, not a failure of the recipient: callers should not
   * mark the lead/message as failed, because a correctly configured server can still deliver it.
   */
  notConfigured?: boolean;
}

// In-memory status cache
let cachedSmtpStatus: SmtpStatus | null = null;

// Runtime in-memory config override
let runtimeSmtpConfig: {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  from?: string;
} | null = null;

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
  return getSmtpConfig();
}

export function getSmtpConfig() {
  const host = runtimeSmtpConfig?.host || process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = runtimeSmtpConfig?.port || parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = runtimeSmtpConfig?.secure !== undefined
    ? runtimeSmtpConfig.secure
    : (process.env.SMTP_SECURE === 'true' || port === 465);
  const user = runtimeSmtpConfig?.user || process.env.SMTP_USER || process.env.GMAIL_USER || process.env.IMAP_USER || '';
  const rawPass = runtimeSmtpConfig?.pass || process.env.SMTP_PASS || process.env.IMAP_PASS || process.env.GMAIL_APP_PASSWORD || process.env.GMAIL_PASS || '';
  const pass = rawPass.trim();
  const fromName = process.env.SMTP_FROM_NAME || 'Umrah360 Automation'; // shared platform mailbox only; workspaces send from their own verified sender
  const from = runtimeSmtpConfig?.from || process.env.SMTP_FROM || (user ? `${fromName} <${user}>` : fromName);

  const configured = Boolean(host && pass && user);

  return { host, port, secure, user, pass, from, configured };
}

export async function fetchFirestoreSmtpConfig() {
  if (isFirebaseConfigured && db) {
    try {
      const settingsRef = doc(db, 'system_settings', 'default');
      const settingsSnap = await getDoc(settingsRef);
      if (settingsSnap.exists()) {
        const data = settingsSnap.data() as any;
        const smtp = data.smtp || {};
        const hostToUse = data.smtpHost || smtp.host;
        const userToUse = data.smtpUser || smtp.user;
        const passToUse = data.smtpPass || smtp.pass;
        const fromToUse = data.smtpFrom || smtp.from;

        // Only update runtime config if passToUse is a valid non-empty password
        if (passToUse && typeof passToUse === 'string' && passToUse.trim().length > 3) {
          updateSmtpConfig({
            host: hostToUse,
            port: data.smtpPort || smtp.port,
            secure: data.smtpSecure !== undefined ? data.smtpSecure : smtp.secure,
            user: userToUse,
            pass: passToUse.trim(),
            from: fromToUse,
          });
        }
      }
    } catch (e) {
      console.warn('[SMTP Service] Error reading Firestore SMTP config:', e);
    }
  }
  return getSmtpConfig();
}

export function createTransporter(customPort?: number, customSecure?: boolean) {
  const config = getSmtpConfig();

  if (!config.configured) {
    return null;
  }

  const port = customPort ?? config.port;
  const isGmail = config.host.toLowerCase().includes('gmail') || config.user.toLowerCase().includes('gmail.com');
  // Clean password of any spaces (standard Gmail App Password formatted with spaces)
  const cleanPass = config.pass.replace(/\s+/g, '');

  if (isGmail && (!customPort || customPort === 465 || customPort === 587)) {
    if (port === 587) {
      return nodemailer.createTransport({
        host: 'smtp.gmail.com',
        port: 587,
        secure: false, // STARTTLS
        auth: {
          user: config.user,
          pass: cleanPass,
        },
        tls: {
          rejectUnauthorized: false,
        },
        connectionTimeout: 10000,
        greetingTimeout: 8000,
        socketTimeout: 10000,
      });
    }

    // Gmail service transport (Optimized for Vercel Serverless AWS Lambda runtime)
    return nodemailer.createTransport({
      service: 'gmail',
      auth: {
        user: config.user,
        pass: cleanPass,
      },
      tls: {
        rejectUnauthorized: false,
      },
      connectionTimeout: 10000,
      greetingTimeout: 8000,
      socketTimeout: 10000,
    });
  }

  const secure = customSecure !== undefined ? customSecure : (config.secure && port === 465);

  return nodemailer.createTransport({
    host: config.host,
    port,
    secure,
    auth: {
      user: config.user,
      pass: cleanPass,
    },
    tls: {
      rejectUnauthorized: false, // Prevents self-signed cert blocks on custom mail hosts
    },
    connectionTimeout: 10000,
    greetingTimeout: 8000,
    socketTimeout: 10000,
  });
}

export async function verifySmtpConnection(): Promise<SmtpStatus> {
  const config = getSmtpConfig();
  const now = new Date().toISOString();

  // When Resend is the active provider, outgoing mail never uses the Gmail login, so don't test it
  // (a stale/wrong Gmail password would show a misleading error while sending works fine).
  const resend = getResendConfig();
  if (resend.configured) {
    cachedSmtpStatus = {
      configured: true,
      host: 'Resend',
      port: 443,
      secure: true,
      user: config.user,
      from: resend.from,
      verified: true,
      lastChecked: now,
    };
    return cachedSmtpStatus;
  }

  if (!config.configured) {
    cachedSmtpStatus = {
      configured: false,
      host: config.host || '(not set)',
      port: config.port,
      secure: config.secure,
      user: config.user,
      from: config.from,
      verified: false,
      lastChecked: now,
      lastError: 'SMTP_HOST or SMTP_PASS environment variable is missing. Set these to enable live email dispatch.',
    };
    return cachedSmtpStatus;
  }

  try {
    const transporter = createTransporter();
    if (!transporter) {
      throw new Error('Failed to instantiate SMTP transporter');
    }

    await transporter.verify();

    cachedSmtpStatus = {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      from: config.from,
      verified: true,
      lastChecked: now,
    };
    return cachedSmtpStatus;
  } catch (err: any) {
    console.error('SMTP Connection verification failed:', err);
    cachedSmtpStatus = {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      from: config.from,
      verified: false,
      lastChecked: now,
      lastError: err.message || 'Failed to authenticate or connect with SMTP server',
    };
    return cachedSmtpStatus;
  }
}

// ---------------------------------------------------------------------------
// Resend (outbound). Inbound stays on IMAP.
// ---------------------------------------------------------------------------

/**
 * Resend is the ONLY way this app sends email. There is no SMTP sending and no SMTP fallback.
 *  - RESEND_API_KEY: required on every server that should send.
 *  - RESEND_FROM:    only for workspaces listed in PLATFORM_SENDER_TENANTS (they send from this platform
 *                    address until their own domain is verified). Workspaces with a verified domain send
 *                    from their own address and do not need it.
 * EMAIL_PROVIDER and RESEND_DISABLE_SMTP_FALLBACK no longer have any effect.
 */
export function getResendConfig() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.RESEND_FROM || '').trim();
  return {
    apiKey,
    from,
    configured: Boolean(apiKey && from),
  };
}

const notConfiguredResult = (reason: string): SendMailResult => ({
  success: false,
  error: `Email sending is not set up on this server (${reason}). Nothing was sent.`,
  simulated: false,
  provider: 'resend',
  notConfigured: true,
});

/**
 * Can THIS SERVER send email for this workspace at all? Checks server setup only (the Resend key, and the
 * platform sender when one is needed). It makes no network call and sends nothing.
 * A workspace whose own domain is not verified yet still counts as "ready" here: that is a workspace
 * setting, reported per email by sendLiveEmail exactly as before.
 */
export async function getEmailSendReadiness(tenantId?: string): Promise<{ ok: boolean; error?: string }> {
  const cfg = getResendConfig();
  if (!cfg.apiKey) return { ok: false, error: notConfiguredResult('RESEND_API_KEY is missing').error };
  if (tenantId) return { ok: true }; // workspace sender (own domain / platform sender / blocked) is resolved at send time
  if (!cfg.from) return { ok: false, error: notConfiguredResult('RESEND_FROM is missing').error };
  return { ok: true };
}

let resendClient: Resend | null = null;
let resendClientKey = '';
function getResendClient(apiKey: string): Resend {
  if (!resendClient || resendClientKey !== apiKey) {
    resendClient = new Resend(apiKey);
    resendClientKey = apiKey;
  }
  return resendClient;
}

function toResendAttachments(list?: EmailAttachmentParam[]): any[] | undefined {
  if (!list || list.length === 0) return undefined;
  return list.map((att) => {
    if (att.dataUrl && !att.content) {
      const m = att.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
      if (m) return { filename: att.filename, contentType: att.contentType || m[1], content: Buffer.from(m[2], 'base64') };
    }
    if (att.content && typeof att.content === 'string' && att.encoding === 'base64') {
      return { filename: att.filename, contentType: att.contentType, content: Buffer.from(att.content, 'base64') };
    }
    if (att.content) {
      return { filename: att.filename, contentType: att.contentType, content: att.content as any };
    }
    if (att.path) {
      // Resend's `path` must be a public URL; local files are read into memory.
      if (/^https?:\/\//i.test(att.path)) return { filename: att.filename, contentType: att.contentType, path: att.path };
      return { filename: att.filename, contentType: att.contentType, content: fs.readFileSync(att.path) };
    }
    return { filename: att.filename, contentType: att.contentType };
  });
}

/** Resend error names that mean the API key on THIS server is missing or not accepted. */
const RESEND_KEY_ERRORS = ['missing_api_key', 'invalid_api_key', 'restricted_api_key'];

async function sendViaResend(params: SendMailParams, override?: { from: string; replyTo?: string }): Promise<SendMailResult> {
  const cfg = getResendConfig();
  try {
    const resend = getResendClient(cfg.apiKey);
    const refs = params.references && params.references.length > 0 ? params.references : params.inReplyTo ? [params.inReplyTo] : [];
    const headers: Record<string, string> = {
      'X-Mailer': 'Umrah360-AI-Automated-Platform',
      ...(params.inReplyTo ? { 'In-Reply-To': params.inReplyTo } : {}),
      ...(refs.length > 0 ? { References: refs.join(' ') } : {}),
      ...(params.headers || {}),
    };

    // Replies must come back to the mailbox we poll over IMAP, not to the Resend sending address.
    const replyTo = override
      ? params.replyTo || override.replyTo || undefined
      : params.replyTo || (process.env.RESEND_REPLY_TO || '').trim() || getSmtpConfig().user || undefined;

    const { data, error } = await resend.emails.send({
      from: override?.from || cfg.from,
      to: params.to,
      subject: params.subject,
      text: params.text,
      html: params.html || params.text.replace(/\n/g, '<br/>'),
      ...(replyTo ? { replyTo } : {}),
      headers,
      attachments: toResendAttachments(params.attachments),
    } as any);

    if (error || !data?.id) {
      const msg = (error as any)?.message || 'Resend did not return an email id';
      const status = Number((error as any)?.statusCode);
      // A 4xx answer proves Resend refused the email (bad key, unverified domain, invalid address,
      // rate limit). A missing status means the request never got an answer (network/timeout).
      const definite = Number.isFinite(status) && status >= 400 && status < 500;
      console.error(`[Resend] ${definite ? 'Rejected' : 'Failed (outcome unknown)'} email to ${params.to}: ${msg}`);
      // The key itself was refused: this server cannot send for anyone, so it is not this recipient's failure.
      if (status === 401 || RESEND_KEY_ERRORS.includes(String((error as any)?.name || ''))) {
        return { ...notConfiguredResult(`Resend refused the API key: ${msg}`) };
      }
      return { success: false, error: `Resend error: ${msg}`, simulated: false, provider: 'resend' };
    }

    // Map the Resend email id to the workspace so bounce/complaint webhooks suppress in the right tenant.
    const tenantId = params.tenantId || params.headers?.['X-Tenant-Id'];
    if (tenantId && isFirebaseConfigured && db) {
      setDoc(globalEmailRouteDoc(data.id), { emailId: data.id, tenantId, createdAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    }

    console.log(`[Resend] Sent email to ${params.to}, id: ${data.id}`);
    return { success: true, messageId: data.id, response: 'resend:accepted', simulated: false, provider: 'resend' };
  } catch (err: any) {
    // Network error / timeout: we cannot know whether Resend accepted it.
    console.error(`[Resend] Error sending email to ${params.to}:`, err);
    return { success: false, error: `Resend error: ${err?.message || 'Unknown error'}`, simulated: false, provider: 'resend' };
  }
}

/**
 * Single entry point for every outgoing email in the app. Resend only.
 *  - workspace with a verified domain            -> sent from the workspace's own address
 *  - workspace listed in PLATFORM_SENDER_TENANTS -> sent from RESEND_FROM
 *  - any other workspace                         -> blocked with a message pointing to Settings -> Email
 *  - Resend not set up on this server            -> `notConfigured` result; nothing is sent, and no other
 *                                                   transport is tried
 */
export async function sendLiveEmail(params: SendMailParams): Promise<SendMailResult> {
  const cfg = getResendConfig();
  if (!cfg.apiKey) {
    console.warn(`[Email] Not sending to ${params.to}: RESEND_API_KEY is missing on this server.`);
    return notConfiguredResult('RESEND_API_KEY is missing');
  }

  // Workspace-scoped sends: the From address must come from the workspace's own verified domain.
  if (params.tenantId) {
    const sender = await resolveTenantSender(params.tenantId);
    if (sender.ok === false) {
      console.warn(`[Email] Blocked send for tenant ${params.tenantId}: ${sender.error}`);
      return { success: false, error: sender.error, simulated: false, provider: 'resend' };
    }
    if (sender.source === 'tenant') {
      return sendViaResend(params, { from: sender.from, replyTo: sender.replyTo });
    }
    // source === 'platform' (grandfathered tenant): continue with the platform sender below.
  }

  if (!cfg.from) {
    console.warn(`[Email] Not sending to ${params.to}: RESEND_FROM is missing on this server.`);
    return notConfiguredResult('RESEND_FROM is missing');
  }
  return sendViaResend(params);
}