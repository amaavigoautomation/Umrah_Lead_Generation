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
}

// In-memory status cache
let cachedSmtpStatus: SmtpStatus | null = null;
let lastSmtpFetchTime = 0;
const SMTP_FETCH_CACHE_TTL = 60_000; // Cache SMTP config for 1 minute to avoid Firestore quota exhaustion

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
  const from = runtimeSmtpConfig?.from || process.env.SMTP_FROM || (user ? `Umrah360 Automation <${user}>` : 'Umrah360 Automation');

  const configured = Boolean(host && pass && user);

  return { host, port, secure, user, pass, from, configured };
}

export async function fetchFirestoreSmtpConfig() {
  const now = Date.now();
  if (now - lastSmtpFetchTime < SMTP_FETCH_CACHE_TTL) {
    return getSmtpConfig();
  }
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
      lastSmtpFetchTime = now;
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

async function sendViaSmtp(params: SendMailParams): Promise<SendMailResult> {
  await fetchFirestoreSmtpConfig().catch(() => {});
  const config = getSmtpConfig();

  // If SMTP is configured, attempt real SMTP transmission
  if (config.configured) {
    try {
      const transporter = createTransporter();
      if (!transporter) {
        throw new Error('SMTP transporter creation failed');
      }

      // Process attachments if present
      let formattedAttachments: any[] | undefined = undefined;
      if (params.attachments && Array.isArray(params.attachments) && params.attachments.length > 0) {
        formattedAttachments = params.attachments.map((att) => {
          if (att.dataUrl && !att.content) {
            const matches = att.dataUrl.match(/^data:([^;]+);base64,(.+)$/);
            if (matches) {
              return {
                filename: att.filename,
                contentType: att.contentType || matches[1],
                content: Buffer.from(matches[2], 'base64'),
              };
            }
          }
          if (att.content && typeof att.content === 'string' && att.encoding === 'base64') {
            return {
              filename: att.filename,
              contentType: att.contentType,
              content: Buffer.from(att.content, 'base64'),
            };
          }
          return {
            filename: att.filename,
            contentType: att.contentType,
            content: att.content,
            path: att.path,
          };
        });
      }

      const mailOptions: any = {
        from: config.from,
        to: params.to,
        replyTo: params.replyTo || config.user,
        subject: params.subject,
        text: params.text,
        html: params.html || params.text.replace(/\n/g, '<br/>'),
        inReplyTo: params.inReplyTo,
        references: params.references ? params.references.join(' ') : params.inReplyTo,
        headers: {
          'X-Mailer': 'Umrah360-AI-Automated-Platform',
          'X-Automated-By': config.user,
          ...(params.headers || {}),
        },
      };

      if (formattedAttachments && formattedAttachments.length > 0) {
        mailOptions.attachments = formattedAttachments;
      }

      let info: any;
      try {
        info = await transporter.sendMail(mailOptions);
      } catch (firstErr: any) {
        console.warn(`[SMTP Live] Primary transport error (${firstErr?.code || firstErr?.message}), trying fallback port 587/465...`);
        try {
          const fallback587 = createTransporter(587, false);
          if (fallback587) {
            info = await fallback587.sendMail(mailOptions);
          } else {
            throw firstErr;
          }
        } catch (secondErr: any) {
          try {
            const fallback465 = createTransporter(465, true);
            if (fallback465) {
              info = await fallback465.sendMail(mailOptions);
            } else {
              throw secondErr;
            }
          } catch (thirdErr: any) {
            throw firstErr;
          }
        }
      }

      console.log(`[SMTP Live] Successfully sent email to ${params.to}, messageId: ${info.messageId}`);

      return {
        success: true,
        messageId: info.messageId,
        response: info.response,
        simulated: false,
        provider: 'smtp',
      };
    } catch (err: any) {
      console.error(`[SMTP Live] Error sending email to ${params.to}:`, err);
      return {
        success: false,
        error: `SMTP error: ${err.message || 'Unknown SMTP error'}`,
        simulated: false,
      };
    }
  }

  // If SMTP credentials not provided yet in environment
  return {
    success: false,
    error: `SMTP is not yet configured in environment. Set SMTP_HOST, SMTP_USER, and SMTP_PASS to dispatch real outgoing emails.`,
    simulated: false,
  };
}

// ---------------------------------------------------------------------------
// Resend (outbound). Inbound stays on IMAP.
// ---------------------------------------------------------------------------

/**
 * Resend is used when RESEND_API_KEY and RESEND_FROM are both set (RESEND_FROM must be an
 * address on a domain verified in Resend, e.g. "Sales <sales@yourdomain.com>").
 * Set EMAIL_PROVIDER=smtp to force SMTP, or RESEND_DISABLE_SMTP_FALLBACK=true to never fall back.
 */
export function getResendConfig() {
  const apiKey = (process.env.RESEND_API_KEY || '').trim();
  const from = (process.env.RESEND_FROM || '').trim();
  const forceSmtp = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase() === 'smtp';
  return {
    apiKey,
    from,
    configured: Boolean(apiKey && from) && !forceSmtp,
    fallbackToSmtp: process.env.RESEND_DISABLE_SMTP_FALLBACK !== 'true',
  };
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

type ResendOutcome = SendMailResult & { definiteRejection?: boolean };

async function sendViaResend(params: SendMailParams, override?: { from: string; replyTo?: string }): Promise<ResendOutcome> {
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
      // Only a 4xx answer proves Resend refused the email (bad key, unverified domain, invalid
      // address, rate limit), so only then is SMTP fallback safe. A missing status means the request
      // never got an answer (network/timeout) and 5xx is not conclusive: the email may still have
      // been accepted, so we must not send it a second time through SMTP.
      const definite = Number.isFinite(status) && status >= 400 && status < 500;
      console.error(`[Resend] ${definite ? 'Rejected' : 'Failed (outcome unknown)'} email to ${params.to}: ${msg}`);
      return { success: false, error: `Resend error: ${msg}`, simulated: false, provider: 'resend', definiteRejection: definite };
    }

    // Map the Resend email id to the workspace so bounce/complaint webhooks suppress in the right tenant.
    const tenantId = params.tenantId || params.headers?.['X-Tenant-Id'];
    if (tenantId && isFirebaseConfigured && db) {
      setDoc(globalEmailRouteDoc(data.id), { emailId: data.id, tenantId, createdAt: new Date().toISOString() }, { merge: true }).catch(() => {});
    }

    console.log(`[Resend] Sent email to ${params.to}, id: ${data.id}`);
    return { success: true, messageId: data.id, response: 'resend:accepted', simulated: false, provider: 'resend' };
  } catch (err: any) {
    // Network error / timeout: we cannot know whether Resend accepted it, so do NOT fall back (would risk a duplicate).
    console.error(`[Resend] Error sending email to ${params.to}:`, err);
    return { success: false, error: `Resend error: ${err?.message || 'Unknown error'}`, simulated: false, provider: 'resend', definiteRejection: false };
  }
}

/**
 * Single entry point for every outgoing email in the app.
 * Resend when configured; SMTP otherwise, and as a fallback only when Resend definitely rejected the email.
 */
export async function sendLiveEmail(params: SendMailParams): Promise<SendMailResult> {
  const cfg = getResendConfig();

  // Workspace-scoped sends: the From address must come from the workspace's own verified domain.
  // Never fall back to SMTP here (that would send as the platform's shared Gmail mailbox).
  const forceSmtp = (process.env.EMAIL_PROVIDER || '').trim().toLowerCase() === 'smtp';
  if (params.tenantId && cfg.apiKey && !forceSmtp) {
    const sender = await resolveTenantSender(params.tenantId);
    if (sender.ok === false) {
      console.warn(`[Email] Blocked send for tenant ${params.tenantId}: ${sender.error}`);
      return { success: false, error: sender.error, simulated: false, provider: 'resend' };
    }
    if (sender.source === 'tenant') {
      const { definiteRejection: _d, ...r } = await sendViaResend(params, { from: sender.from, replyTo: sender.replyTo });
      return r;
    }
    // source === 'platform' (grandfathered tenant): continue with the platform sender below.
  }
  if (!cfg.configured) {
    return sendViaSmtp(params);
  }

  const { definiteRejection, ...resendResult } = await sendViaResend(params);
  if (resendResult.success) return resendResult;

  if (definiteRejection && cfg.fallbackToSmtp) {
    console.warn('[Email] Resend rejected the email, falling back to SMTP.');
    const smtpResult = await sendViaSmtp(params);
    if (smtpResult.success) return smtpResult;
    return { ...smtpResult, error: `${resendResult.error}; SMTP fallback: ${smtpResult.error}` };
  }
  return resendResult;
}
