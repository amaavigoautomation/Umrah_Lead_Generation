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

export interface SendMailParams {
  to: string;
  subject: string;
  text: string;
  html?: string;
  inReplyTo?: string;
  references?: string[];
  replyTo?: string;
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

export function getSmtpConfig() {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER || 'amaavigo@gmail.com';
  const pass = process.env.SMTP_PASS || '';
  const from = process.env.SMTP_FROM || `Umrah360 Automation <${user}>`;

  const configured = Boolean(host && pass);

  return { host, port, secure, user, pass, from, configured };
}

export function createTransporter() {
  const config = getSmtpConfig();

  if (!config.configured) {
    return null;
  }

  return nodemailer.createTransport({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    tls: {
      rejectUnauthorized: false, // Prevents self-signed cert blocks on custom mail hosts
    },
    connectionTimeout: 10000,
    greetingTimeout: 5000,
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
  const config = getSmtpConfig();

  // If SMTP is configured, attempt real SMTP transmission
  if (config.configured) {
    try {
      const transporter = createTransporter();
      if (!transporter) {
        throw new Error('SMTP transporter creation failed');
      }

      const info = await transporter.sendMail({
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
      });

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
