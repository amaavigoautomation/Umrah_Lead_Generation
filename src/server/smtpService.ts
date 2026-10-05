import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { doc, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';

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
  const from = runtimeSmtpConfig?.from || process.env.SMTP_FROM || (user ? `Umrah360 Automation <${user}>` : 'Umrah360 Automation');

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

export async function sendLiveEmail(params: SendMailParams): Promise<SendMailResult> {
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
