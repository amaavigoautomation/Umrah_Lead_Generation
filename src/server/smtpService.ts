import nodemailer from 'nodemailer';

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
}

export interface SendMailResult {
  success: boolean;
  messageId?: string;
  response?: string;
  error?: string;
  simulated?: boolean;
}

// In-memory status cache
let cachedSmtpStatus: SmtpStatus | null = null;
let dynamicSmtpPass: string = '';
let dynamicSmtpUser: string = '';
let dynamicSmtpHost: string = '';
let dynamicSmtpPort: number = 465;

export async function fetchFirestoreSmtpConfig() {
  if (dynamicSmtpPass) return;
  try {
    const projectId = process.env.VITE_FIREBASE_PROJECT_ID || 'gen-lang-client-0376069258';
    const dbId = 'ai-studio-379c884e-3360-468a-ad55-8105acbd3214';
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${projectId}/databases/${dbId}/documents/settings/smtp`);
    if (res.ok) {
      const data = await res.json();
      const f = data.fields || {};
      if (f.pass?.stringValue) dynamicSmtpPass = f.pass.stringValue.replace(/\s+/g, '');
      if (f.user?.stringValue) dynamicSmtpUser = f.user.stringValue;
      if (f.host?.stringValue) dynamicSmtpHost = f.host.stringValue;
      if (f.port?.integerValue) dynamicSmtpPort = parseInt(f.port.integerValue, 10);
    }
  } catch (e) {
    // Ignore fallback fetch error
  }
}

export function getSmtpConfig() {
  const host = process.env.SMTP_HOST || dynamicSmtpHost || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || (dynamicSmtpPort ? String(dynamicSmtpPort) : '465'), 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER || dynamicSmtpUser || 'amaavigo@gmail.com';
  const rawPass = process.env.SMTP_PASS || dynamicSmtpPass || '';
  const pass = rawPass.replace(/\s+/g, '').trim();
  const from = process.env.SMTP_FROM || `Umrah360 Automation <${user}>`;

  const configured = Boolean(host && pass);

  return { host, port, secure, user, pass, from, configured };
}

export function createTransporter(customPort?: number, customSecure?: boolean) {
  const config = getSmtpConfig();

  if (!config.configured) {
    return null;
  }

  const port = customPort ?? config.port;
  const secure = customSecure !== undefined ? customSecure : (config.secure && port === 465);
  // Clean password of any spaces (standard Gmail App Password formatted with spaces)
  const cleanPass = config.pass.replace(/\s+/g, '');

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
    connectionTimeout: 15000,
    greetingTimeout: 10000,
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
  let config = getSmtpConfig();
  if (!config.configured) {
    await fetchFirestoreSmtpConfig();
    config = getSmtpConfig();
  }

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
        },
      };

      if (formattedAttachments && formattedAttachments.length > 0) {
        mailOptions.attachments = formattedAttachments;
      }

      let info: any;
      try {
        info = await transporter.sendMail(mailOptions);
      } catch (firstErr: any) {
        if (config.port === 465 && (firstErr?.code === 'ETIMEDOUT' || firstErr?.code === 'ESOCKET' || firstErr?.command === 'CONN')) {
          console.warn('[SMTP Live] Port 465 connection issue, attempting port 587 fallback...');
          const fallbackTransporter = createTransporter(587, false);
          if (fallbackTransporter) {
            info = await fallbackTransporter.sendMail(mailOptions);
          } else {
            throw firstErr;
          }
        } else {
          throw firstErr;
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
