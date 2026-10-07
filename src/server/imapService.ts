import { ImapFlow } from 'imapflow';
import { simpleParser, ParsedMail } from 'mailparser';
import {
  initPersistentIdempotencyStore,
  isMessageAlreadyProcessed,
  recordProcessedInboundEmail,
  normalizeIdentifier,
  getOrCreateImapBaseline,
} from './firestorePersistence.js';

export interface FetchedInboundEmail {
  uid: number;
  seq: number;
  messageId?: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  html?: string;
  date?: string;
  inReplyTo?: string;
  references?: string[];
}

export interface ImapPollResult {
  success: boolean;
  configured: boolean;
  checkedMailbox: string;
  messagesFound: number;
  emails: FetchedInboundEmail[];
  error?: string;
  timestamp: string;
}

let runtimeImapConfig: {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
} | null = null;

// ---------------------------------------------------------------------------
// Failure backoff: after a failed poll, wait before opening another connection.
// Hammering Gmail with a fresh login every few seconds makes throttling worse.
// ---------------------------------------------------------------------------
let consecutiveFailures = 0;
let imapBackoffUntil = 0;
let lastImapErrorText = '';

function registerImapFailure(errorText: string) {
  consecutiveFailures += 1;
  lastImapErrorText = errorText;
  // 15s, 30s, 60s, 120s, 240s, then capped at 5 minutes
  const waitMs = Math.min(5 * 60_000, 15_000 * Math.pow(2, consecutiveFailures - 1));
  imapBackoffUntil = Date.now() + waitMs;
}

function registerImapSuccess() {
  consecutiveFailures = 0;
  imapBackoffUntil = 0;
  lastImapErrorText = '';
}

/**
 * imapflow reports almost every server rejection as the generic "Command failed".
 * The real reason lives in extra fields on the error object. This collects them
 * (never the full command text, which could contain credentials).
 */
export function describeImapError(err: any): string {
  if (!err) return 'Unknown IMAP error';
  const parts: string[] = [err.message || String(err)];
  if (err.responseText) parts.push(`server said: ${err.responseText}`);
  if (err.serverResponseCode) parts.push(`response code: ${err.serverResponseCode}`);
  if (err.code) parts.push(`error code: ${err.code}`);
  if (err.authenticationFailed) parts.push('authentication failed');
  if (err.executedCommand) {
    const verb = String(err.executedCommand).trim().split(/\s+/)[0];
    if (verb) parts.push(`command: ${verb}`);
  }
  return parts.join(' | ');
}

export function updateImapConfig(newConfig: {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
}) {
  const current = getImapConfig();
  runtimeImapConfig = {
    host: newConfig.host !== undefined ? newConfig.host : current.host,
    port: newConfig.port !== undefined ? newConfig.port : current.port,
    secure: newConfig.secure !== undefined ? newConfig.secure : current.secure,
    user: newConfig.user !== undefined ? newConfig.user : current.user,
    pass: newConfig.pass !== undefined ? newConfig.pass : current.pass,
  };
  // New credentials / settings: allow an immediate retry
  registerImapSuccess();
  return getImapConfig();
}

export function getImapConfig() {
  const host = runtimeImapConfig?.host || process.env.IMAP_HOST || (process.env.SMTP_HOST ? process.env.SMTP_HOST.replace('smtp.', 'imap.') : 'imap.gmail.com');
  const port = runtimeImapConfig?.port || parseInt(process.env.IMAP_PORT || '993', 10);
  const secure = runtimeImapConfig?.secure !== undefined
    ? runtimeImapConfig.secure
    : process.env.IMAP_SECURE !== 'false';
  const user = runtimeImapConfig?.user || process.env.IMAP_USER || process.env.SMTP_USER || '';
  const pass = (runtimeImapConfig?.pass || process.env.IMAP_PASS || process.env.SMTP_PASS || '').trim();

  const configured = Boolean(host && pass && user);

  return { host, port, secure, user, pass, configured };
}

// In-memory set of already processed message IDs & UIDs to prevent duplicate ingestion
const processedEmailIdentifiers = new Set<string>();

let isFirestoreSynced = false;
let isFirstPollCycleCompleted = false;

/**
 * Creates a resilient ImapFlow instance with pre-attached error handlers
 * to prevent unhandled EventEmitter 'error' crashes in Node.js (e.g., Socket timeout).
 */
export function createResilientImapClient(config: ReturnType<typeof getImapConfig>): ImapFlow {
  const client = new ImapFlow({
    host: config.host,
    port: config.port,
    secure: config.secure,
    auth: {
      user: config.user,
      pass: config.pass,
    },
    logger: false,
    emitLogs: false,
    tls: {
      rejectUnauthorized: false,
    },
    clientInfo: {
      name: 'Umrah360-Automation',
      version: '1.0.0',
    },
    connectionTimeout: 20000,
    greetingTimeout: 15000,
    socketTimeout: 45000,
  });

  // CRITICAL: Attach 'error' handler immediately to prevent unhandled EventEmitter error crashes
  client.on('error', (err: any) => {
    console.warn('[Resilient IMAP Client Notice]:', describeImapError(err));
  });

  return client;
}

async function safeCloseClient(client: ImapFlow) {
  try {
    await client.logout();
  } catch {
    try {
      client.close();
    } catch {}
  }
}

export async function checkImapStatus(): Promise<{
  configured: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  verified: boolean;
  error?: string;
}> {
  const config = getImapConfig();

  if (!config.configured) {
    return {
      configured: false,
      host: config.host || '(not set)',
      port: config.port,
      secure: config.secure,
      user: config.user,
      verified: false,
      error: 'IMAP_HOST and IMAP_PASS not configured in environment. Set these to enable live email polling from ' + config.user + '.',
    };
  }

  const client = createResilientImapClient(config);

  try {
    await client.connect();
    await safeCloseClient(client);
    registerImapSuccess();
    return {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      verified: true,
    };
  } catch (err: any) {
    const detail = describeImapError(err);
    console.error('[IMAP Status] Connection check failed:', detail);
    await safeCloseClient(client);
    return {
      configured: true,
      host: config.host,
      port: config.port,
      secure: config.secure,
      user: config.user,
      verified: false,
      error: detail || 'Failed to authenticate with IMAP server',
    };
  }
}

export function isBotOrNewsletter(fromAddress: string, subject: string): boolean {
  const from = fromAddress.toLowerCase();
  const subj = subject.toLowerCase();

  if (
    from.includes('no-reply') ||
    from.includes('noreply') ||
    from.includes('donotreply') ||
    from.includes('mailer-daemon') ||
    from.includes('postmaster') ||
    from.includes('accounts.google.com') ||
    from.includes('googleaistudio-noreply') ||
    from.includes('firebase-no-reply') ||
    from.endsWith('@google.com') ||
    from.includes('facebookmail.com') ||
    from.includes('redditmail.com') ||
    from.includes('quora.com') ||
    from.includes('elevenlabs.io') ||
    from.includes('meta.com') ||
    from.includes('business-updates.facebook.com') ||
    from.includes('linkedin.com') ||
    from.includes('twitter.com') ||
    from.includes('x.com') ||
    from.includes('medium.com') ||
    from.includes('substack.com') ||
    from.includes('mailchimp') ||
    from.includes('security-noreply')
  ) {
    return true;
  }

  if (
    subj.includes('security alert') ||
    subj.includes('delivery status notification') ||
    subj.includes('mail delivery subsystem') ||
    subj.includes('welcome to google') ||
    subj.includes('welcome to firebase') ||
    subj.includes('action needed on your meta account')
  ) {
    return true;
  }

  return false;
}

/**
 * Polls unread and recent inbound emails from the inbox.
 * Checks unseen messages and recent inbox items that have not yet been ingested into CRM.
 * When markAsSeen=true, marks the emails as seen so other mail clients know it was handled.
 */
export async function pollUnreadEmails(markAsSeen: boolean = true): Promise<ImapPollResult> {
  const config = getImapConfig();
  const now = new Date().toISOString();

  if (!config.configured) {
    return {
      success: false,
      configured: false,
      checkedMailbox: config.user,
      messagesFound: 0,
      emails: [],
      error: 'IMAP credentials (IMAP_HOST, IMAP_USER, IMAP_PASS) are not yet configured in environment.',
      timestamp: now,
    };
  }

  // Back off after a failure instead of opening a new login every few seconds
  if (Date.now() < imapBackoffUntil) {
    const waitSec = Math.ceil((imapBackoffUntil - Date.now()) / 1000);
    return {
      success: false,
      configured: true,
      checkedMailbox: config.user,
      messagesFound: 0,
      emails: [],
      error: `IMAP polling paused for ${waitSec}s after a failure. Last error: ${lastImapErrorText}`,
      timestamp: now,
    };
  }

  const client = createResilientImapClient(config);
  const fetchedEmails: FetchedInboundEmail[] = [];

  try {
    await client.connect();

    // Select INBOX
    const lock = await client.getMailboxLock('INBOX');

    try {
      // Total messages from the already-selected mailbox (no extra STATUS command needed)
      const totalMessages = Number((client.mailbox as any)?.exists) || 0;

      if (totalMessages === 0) {
        lock.release();
        await safeCloseClient(client);
        registerImapSuccess();
        return {
          success: true,
          configured: true,
          checkedMailbox: config.user,
          messagesFound: 0,
          emails: [],
          timestamp: now,
        };
      }

      // Ensure Firestore idempotency store is initialized before inspecting mailbox
      if (!isFirestoreSynced) {
        try {
          await initPersistentIdempotencyStore();
          isFirestoreSynced = true;
        } catch (e) {
          console.warn('[IMAP Sync] Notice initializing Firestore idempotency store:', e);
        }
      }

      // Persisted baseline (throws if Firestore is down, so the poll fails visibly)
      const baselineMs = await getOrCreateImapBaseline();

      // Inspect the latest 30 messages in the mailbox, prioritizing the newest sequence numbers first
      const rawCandidates: { seq: number; msgId: string; uidStr: string }[] = [];
      const inspectCount = Math.min(30, totalMessages);
      const startSeq = Math.max(1, totalMessages - inspectCount + 1);
      const range = `${startSeq}:*`;

      // STEP 1: collect message headers only. No other IMAP commands and no Firestore
      // calls inside this loop (imapflow does not allow commands while a FETCH is streaming).
      const headerBatch: Array<{
        seq: number;
        uid: number;
        envelope: any;
        flags: Set<string> | undefined;
        internalDate: Date | string | undefined;
      }> = [];
      for await (const message of client.fetch(range, { envelope: true, flags: true, uid: true, internalDate: true })) {
        headerBatch.push({
          seq: message.seq,
          uid: message.uid,
          envelope: message.envelope,
          flags: message.flags as any,
          internalDate: message.internalDate as any,
        });
      }

      // STEP 2: evaluate each header (Firestore + flag updates are safe now)
      for (const message of headerBatch) {
        const msgId = message.envelope?.messageId || `seq-${message.seq}`;
        const uidStr = String(message.uid);
        const normId = normalizeIdentifier(msgId);

        // 1. If already ingested in this server session, skip
        if (processedEmailIdentifiers.has(normId) || processedEmailIdentifiers.has(msgId) || processedEmailIdentifiers.has(uidStr)) {
          continue;
        }

        const fromAddress = message.envelope?.from?.[0]?.address || '';
        const subject = message.envelope?.subject || '';

        // 2. Skip newsletters and system bots
        if (isBotOrNewsletter(fromAddress, subject)) {
          processedEmailIdentifiers.add(normId);
          processedEmailIdentifiers.add(msgId);
          processedEmailIdentifiers.add(uidStr);
          continue;
        }

        // 3. Skip messages already marked as SEEN/read in IMAP
        const isSeen = Boolean(message.flags && message.flags.has('\\Seen'));
        if (isSeen) {
          processedEmailIdentifiers.add(normId);
          processedEmailIdentifiers.add(msgId);
          processedEmailIdentifiers.add(uidStr);
          continue;
        }

        // 4. Check persistent Firestore idempotency store
        const firestoreCheck = await isMessageAlreadyProcessed(msgId, fromAddress);
        if (firestoreCheck.processed) {
          processedEmailIdentifiers.add(normId);
          processedEmailIdentifiers.add(msgId);
          processedEmailIdentifiers.add(uidStr);
          continue;
        }

        // 5. History protection: anything that arrived before the persisted mailbox
        // baseline is historical and is baselined (never auto-replied to). The baseline
        // lives in Firestore so it survives restarts and serverless cold starts.
        const msgInternalTime = message.internalDate ? new Date(message.internalDate).getTime() : 0;
        if (msgInternalTime > 0 && msgInternalTime < baselineMs) {
          console.log(`[IMAP Guard] Baselining historical email ${msgId} from ${fromAddress} (arrived before the mailbox baseline).`);
          processedEmailIdentifiers.add(normId);
          processedEmailIdentifiers.add(msgId);
          processedEmailIdentifiers.add(uidStr);
          await recordProcessedInboundEmail({
            messageId: msgId,
            fromEmail: fromAddress,
            subject,
            aiReplied: false,
            status: 'BASELINE',
            reason: 'Historical email (before mailbox baseline) baselined to prevent re-sending',
            timestamp: message.internalDate ? new Date(message.internalDate).toISOString() : new Date().toISOString(),
          });
          if (markAsSeen) {
            try {
              await client.messageFlagsAdd(message.seq, ['\\Seen']);
            } catch {}
          }
          continue;
        }

        rawCandidates.push({ seq: message.seq, msgId, uidStr });
      }

      isFirstPollCycleCompleted = true;

      // Sort candidate sequences descending: NEWEST message processed first
      rawCandidates.sort((a, b) => b.seq - a.seq);
      const candidateSeqList = rawCandidates.slice(0, 10).map((c) => c.seq);

      // Download and parse candidate messages in newest-first order
      for (const seq of candidateSeqList) {
        try {
          const download = await client.download(String(seq));
          if (!download || !download.content) continue;
          const parsed: ParsedMail = await simpleParser(download.content);

          const fromAddress =
            parsed.from?.value?.[0]?.address ||
            (typeof parsed.from?.text === 'string' ? parsed.from.text : 'unknown@sender.com');
          const fromName = parsed.from?.value?.[0]?.name || parsed.from?.text || fromAddress;

          // Strict anti-loop: ignore if it is our own automated reply
          const xAutomatedBy = parsed.headers.get('x-automated-by');
          const xMailer = parsed.headers.get('x-mailer');
          const autoSubmitted = parsed.headers.get('auto-submitted');

          if (
            xAutomatedBy ||
            xMailer === 'Umrah360-AI-Automated-Platform' ||
            autoSubmitted === 'auto-replied'
          ) {
            const loopMsgId = parsed.messageId || `seq-${seq}`;
            processedEmailIdentifiers.add(loopMsgId);
            processedEmailIdentifiers.add(String(seq));
            if (markAsSeen) {
              try {
                await client.messageFlagsAdd(seq, ['\\Seen']);
              } catch {}
            }
            continue;
          }

          const toAddress =
            parsed.to && Array.isArray(parsed.to)
              ? parsed.to[0]?.value?.[0]?.address || config.user
              : (parsed.to as any)?.value?.[0]?.address || config.user;

          // Deterministic message ID: Never use Date.now() so recurring polls produce the exact same ID
          const finalMsgId = parsed.messageId || `<inbound-seq-${seq}-${parsed.date ? parsed.date.getTime() : 'nodate'}@${config.user.split('@')[1] || 'gmail.com'}>`;
          const finalNormId = normalizeIdentifier(finalMsgId);

          if (processedEmailIdentifiers.has(finalMsgId) || processedEmailIdentifiers.has(finalNormId)) {
            continue;
          }

          // Double check Firestore idempotency after parsing full messageId
          const parsedCheck = await isMessageAlreadyProcessed(finalMsgId, fromAddress);
          if (parsedCheck.processed) {
            processedEmailIdentifiers.add(finalMsgId);
            processedEmailIdentifiers.add(finalNormId);
            processedEmailIdentifiers.add(String(seq));
            if (markAsSeen) {
              try {
                await client.messageFlagsAdd(seq, ['\\Seen']);
              } catch {}
            }
            continue;
          }

          const fetched: FetchedInboundEmail = {
            uid: (download as any).meta?.uid || seq,
            seq,
            messageId: finalMsgId,
            from: fromAddress,
            fromName,
            to: toAddress,
            subject: parsed.subject || 'No Subject',
            text: parsed.text || '',
            html: parsed.html || undefined,
            date: parsed.date ? parsed.date.toISOString() : now,
            inReplyTo: parsed.inReplyTo || undefined,
            references: Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : undefined,
          };

          fetchedEmails.push(fetched);
          processedEmailIdentifiers.add(finalMsgId);
          processedEmailIdentifiers.add(String(seq));

          if (markAsSeen) {
            try {
              await client.messageFlagsAdd(seq, ['\\Seen']);
            } catch {}
          }
        } catch (msgErr) {
          console.error(`[IMAP Poll] Error processing message seq ${seq}:`, describeImapError(msgErr));
        }
      }
    } finally {
      lock.release();
    }

    await safeCloseClient(client);
    registerImapSuccess();

    return {
      success: true,
      configured: true,
      checkedMailbox: config.user,
      messagesFound: fetchedEmails.length,
      emails: fetchedEmails,
      timestamp: now,
    };
  } catch (err: any) {
    const detail = describeImapError(err);
    console.error('[IMAP Poll] Connection or polling error:', detail);
    await safeCloseClient(client);
    registerImapFailure(detail);

    return {
      success: false,
      configured: true,
      checkedMailbox: config.user,
      messagesFound: 0,
      emails: [],
      error: detail || 'IMAP connection failed',
      timestamp: now,
    };
  }
}