import { simpleParser } from 'mailparser';
import { runWithJobLease } from './jobLeaseService.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { isMessageAlreadyProcessed, recordProcessedInboundEmail, normalizeIdentifier } from './firestorePersistence.js';
import { isBotOrNewsletter } from './imapService.js';
import { findExistingConversationForInboundEmail, processLiveInboundEmail, runWithInboundCtx } from './inboundPipeline.js';
import {
  createTenantImapClient,
  friendlyImapError,
  getInboundCredentials,
  getInboundSettings,
  listInboundTenantIds,
  resolveSafeHost,
  safeClose,
  updateInboundState,
  type InboundCredentials,
  type TenantInboundSettings,
} from './tenantInboundService.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Reads each workspace's OWN connected mailbox and hands relevant mail to the normal inbound pipeline
 * inside that workspace's tenant scope.
 *
 * Rules:
 *  - The inbox is opened read-only: nothing is marked read, moved or deleted. Staff keep using their mail as usual.
 *  - Only mail that arrived after the mailbox was connected (UID high-water mark) is considered.
 *  - Unless "process new inquiries" is on, only replies to our conversations / known contacts are ingested,
 *    so unrelated personal mail never reaches the AI.
 *  - Never touches the platform env mailbox (that is the separate owner path in imapService).
 */

const JOB_NAME = 'tenant_imap_inbound';
const JOB_LEASE_MS = 3 * 60_000;
const MIN_POLL_INTERVAL_MS = 45_000;
const MAX_MESSAGES_PER_CYCLE = 25;
const MAX_MESSAGE_BYTES = 10 * 1024 * 1024;
const TICK_MS = 30_000;
const CONCURRENCY = 3;
const MAX_BACKOFF_MS = 30 * 60_000;

const lastAttempt = new Map<string, number>();

const sysCtx = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: '', role: 'admin' });

interface Candidate {
  uid: number;
  messageId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  text: string;
  inReplyTo?: string;
  references?: string[];
  date?: string;
  skipReason?: string;
}

export interface TenantPollResult {
  tenantId: string;
  ran: boolean;
  processed: number;
  skipped: number;
  error?: string;
}

function isAuthFailure(err: any): boolean {
  return Boolean(err?.authenticationFailed) || /AUTHENTICATIONFAILED|Invalid credentials|Authentication failed|LOGIN failed/i.test(String(err?.responseText || err?.message || ''));
}

function backoffMs(failures: number): number {
  return Math.min(MAX_BACKOFF_MS, 60_000 * 2 ** Math.max(0, failures - 1));
}

/** Pulls new messages (parsed, filtered at the header level) from the mailbox. Connection is closed before any AI work. */
async function fetchNewMessages(
  creds: InboundCredentials,
  ip: string,
  settings: TenantInboundSettings
): Promise<{ candidates: Candidate[]; uidValidity: string; uidNext: number; reset: boolean; highestSeen: number }> {
  const client = createTenantImapClient(creds, ip);
  try {
    await client.connect();
    const lock = await client.getMailboxLock('INBOX', { readOnly: true });
    try {
      const mb: any = client.mailbox;
      const uidValidity = String(mb?.uidValidity ?? '');
      const uidNext = Number(mb?.uidNext) || 1;

      // UIDs were reset by the server (mailbox rebuilt/migrated): start again from "now", never re-process history.
      if (settings.uidValidity && settings.uidValidity !== uidValidity) {
        return { candidates: [], uidValidity, uidNext, reset: true, highestSeen: Math.max(0, uidNext - 1) };
      }

      const lastUid = Number(settings.lastUid) || 0;
      if (uidNext - 1 <= lastUid) {
        return { candidates: [], uidValidity, uidNext, reset: false, highestSeen: lastUid };
      }

      // STEP 1: headers only (no other IMAP command may run while a FETCH is streaming)
      const heads: { uid: number; envelope: any; size: number }[] = [];
      for await (const m of client.fetch(`${lastUid + 1}:*`, { uid: true, envelope: true, size: true }, { uid: true })) {
        // "N:*" always returns the newest message even when N is above it, so filter explicitly.
        if (m.uid > lastUid) heads.push({ uid: m.uid, envelope: m.envelope, size: Number((m as any).size) || 0 });
        if (heads.length >= MAX_MESSAGES_PER_CYCLE) break;
      }
      heads.sort((a, b) => a.uid - b.uid);

      const ownAddress = creds.user.toLowerCase();
      const candidates: Candidate[] = [];
      let highestSeen = lastUid;

      // STEP 2: download + parse only what could matter
      for (const h of heads.slice(0, MAX_MESSAGES_PER_CYCLE)) {
        highestSeen = Math.max(highestSeen, h.uid);
        const fromAddr = String(h.envelope?.from?.[0]?.address || '').toLowerCase();
        const subject = String(h.envelope?.subject || '');
        const envId = String(h.envelope?.messageId || '');
        const base = { uid: h.uid, messageId: envId, from: fromAddr, fromName: fromAddr, to: creds.user, subject, text: '' };

        if (!fromAddr) { candidates.push({ ...base, skipReason: 'No sender address' }); continue; }
        if (fromAddr === ownAddress) { candidates.push({ ...base, skipReason: 'Sent from the connected mailbox itself' }); continue; }
        if (isBotOrNewsletter(fromAddr, subject)) { candidates.push({ ...base, skipReason: 'Automated / newsletter sender' }); continue; }
        if (h.size > MAX_MESSAGE_BYTES) { candidates.push({ ...base, skipReason: 'Message too large' }); continue; }

        try {
          const full: any = await client.fetchOne(String(h.uid), { source: true }, { uid: true });
          if (!full || !full.source) { candidates.push({ ...base, skipReason: 'Message body unavailable' }); continue; }
          const parsed = await simpleParser(full.source);

          const xAutomatedBy = parsed.headers.get('x-automated-by');
          const xMailer = parsed.headers.get('x-mailer');
          const autoSubmitted = String(parsed.headers.get('auto-submitted') || '').toLowerCase();
          const precedence = String(parsed.headers.get('precedence') || '').toLowerCase();
          if (
            xAutomatedBy ||
            xMailer === 'Umrah360-AI-Automated-Platform' ||
            (autoSubmitted && autoSubmitted !== 'no') ||
            ['bulk', 'junk', 'list'].includes(precedence) ||
            parsed.headers.get('list-unsubscribe')
          ) {
            candidates.push({ ...base, skipReason: 'Automated or bulk email' });
            continue;
          }

          const from = parsed.from?.value?.[0]?.address?.toLowerCase() || fromAddr;
          const refs = Array.isArray(parsed.references) ? parsed.references : parsed.references ? [parsed.references] : undefined;
          candidates.push({
            uid: h.uid,
            // Deterministic fallback id so a re-read produces the same key
            messageId: parsed.messageId || envId || `<tenant-inbound-${h.uid}-${uidValidity}@${creds.host}>`,
            from,
            fromName: parsed.from?.value?.[0]?.name || from,
            to: creds.user,
            subject: parsed.subject || subject || 'No Subject',
            text: parsed.text || '',
            inReplyTo: parsed.inReplyTo || undefined,
            references: refs,
            date: parsed.date ? parsed.date.toISOString() : undefined,
          });
        } catch (e) {
          console.warn(`[Tenant IMAP] Could not read message UID ${h.uid}:`, friendlyImapError(e, creds));
          candidates.push({ ...base, skipReason: 'Message could not be read' });
        }
      }

      return { candidates, uidValidity, uidNext, reset: false, highestSeen };
    } finally {
      lock.release();
    }
  } finally {
    await safeClose(client);
  }
}

async function runCycle(tenantId: string): Promise<TenantPollResult> {
  const result: TenantPollResult = { tenantId, ran: true, processed: 0, skipped: 0 };
  const ctx = sysCtx(tenantId);

  const settings = await getInboundSettings(tenantId, { fresh: true });
  const creds = await getInboundCredentials(tenantId);
  if (!creds) {
    await updateInboundState(tenantId, {
      status: 'error',
      lastError: 'The saved mailbox password could not be read. Please reconnect the mailbox.',
      lastErrorAt: new Date().toISOString(),
      nextPollAt: new Date(Date.now() + MAX_BACKOFF_MS).toISOString(),
    });
    result.error = 'credentials unavailable';
    return result;
  }

  const startedAt = new Date().toISOString();
  let fetched;
  try {
    const ip = await resolveSafeHost(creds.host);
    fetched = await fetchNewMessages(creds, ip, settings);
  } catch (err: any) {
    const msg = err?.message && err?.status ? String(err.message) : friendlyImapError(err, creds);
    const failures = (settings.consecutiveFailures || 0) + 1;
    const authFail = isAuthFailure(err);
    await updateInboundState(tenantId, {
      status: authFail ? 'auth_failed' : 'error',
      lastError: msg,
      lastErrorAt: new Date().toISOString(),
      lastPolledAt: startedAt,
      consecutiveFailures: failures,
      // A wrong password will not fix itself: stop hammering the account until the admin reconnects.
      nextPollAt: authFail ? new Date(Date.now() + 24 * 3600_000).toISOString() : new Date(Date.now() + backoffMs(failures)).toISOString(),
    });
    result.error = msg;
    console.warn(`[Tenant IMAP] ${tenantId}: ${msg}`);
    return result;
  }

  if (fetched.reset) {
    await updateInboundState(tenantId, {
      uidValidity: fetched.uidValidity,
      lastUid: fetched.highestSeen,
      lastPolledAt: startedAt,
      lastSuccessAt: startedAt,
      status: 'connected',
      consecutiveFailures: 0,
      lastError: undefined,
      lastErrorAt: undefined,
    });
    return result;
  }

  let lastUid = Number(settings.lastUid) || 0;

  for (const c of fetched.candidates) {
    try {
      if (c.skipReason) {
        result.skipped++;
        await recordProcessedInboundEmail(
          { messageId: c.messageId || `<uid-${c.uid}>`, fromEmail: c.from || 'unknown', subject: c.subject, aiReplied: false, status: 'SKIPPED', reason: c.skipReason },
          ctx
        );
        lastUid = Math.max(lastUid, c.uid);
        continue;
      }

      const already = await isMessageAlreadyProcessed(c.messageId, c.from, ctx);
      if (already.processed) {
        result.skipped++;
        lastUid = Math.max(lastUid, c.uid);
        continue;
      }

      // Reply-only filter: keep unrelated mail out of the AI unless the company opted in to new inquiries.
      let allowed = Boolean(settings.processNewInquiries);
      if (!allowed) {
        const match = await runWithInboundCtx(ctx, () =>
          findExistingConversationForInboundEmail({
            senderEmail: c.from,
            inReplyTo: c.inReplyTo,
            references: c.references,
            subject: c.subject,
          })
        );
        allowed = Boolean(match.isExisting && ['inReplyTo', 'references', 'customerEmail', 'contactEmail'].includes(match.matchedBy));
      }

      if (!allowed) {
        result.skipped++;
        await recordProcessedInboundEmail(
          { messageId: c.messageId, fromEmail: c.from, subject: c.subject, aiReplied: false, status: 'SKIPPED', reason: 'Not a reply to a known conversation' },
          ctx
        );
        lastUid = Math.max(lastUid, c.uid);
        continue;
      }

      await runWithInboundCtx(ctx, () =>
        processLiveInboundEmail({
          from: c.from,
          fromName: c.fromName,
          to: c.to,
          subject: c.subject,
          body: c.text,
          messageId: c.messageId,
          inReplyTo: c.inReplyTo,
          references: c.references,
          ownMailbox: creds.user,
        })
      );
      result.processed++;
      lastUid = Math.max(lastUid, c.uid);
    } catch (e: any) {
      // Do not retry forever on one poisonous message: log it, record it, move past it.
      console.error(`[Tenant IMAP] ${tenantId}: failed processing UID ${c.uid}:`, e?.message || e);
      try {
        await recordProcessedInboundEmail(
          { messageId: c.messageId || `<uid-${c.uid}>`, fromEmail: c.from || 'unknown', subject: c.subject, aiReplied: false, status: 'SKIPPED', reason: `Processing error: ${String(e?.message || e).slice(0, 200)}` },
          ctx
        );
      } catch {}
      result.skipped++;
      lastUid = Math.max(lastUid, c.uid);
    }
  }

  // If every message in the mailbox up to highestSeen was handled, move the marker there.
  const complete = fetched.candidates.length === 0 || fetched.candidates.every((c) => c.uid <= lastUid);
  if (complete) lastUid = Math.max(lastUid, fetched.highestSeen);

  await updateInboundState(tenantId, {
    uidValidity: fetched.uidValidity,
    lastUid,
    lastPolledAt: startedAt,
    lastSuccessAt: new Date().toISOString(),
    status: 'connected',
    consecutiveFailures: 0,
    lastError: undefined,
    lastErrorAt: undefined,
    nextPollAt: undefined,
  });
  return result;
}

/** Polls one workspace's mailbox. Safe to call from several instances: a job lease keeps it to one at a time. */
export async function pollTenantMailbox(tenantId: string, opts: { force?: boolean } = {}): Promise<TenantPollResult> {
  const idle: TenantPollResult = { tenantId, ran: false, processed: 0, skipped: 0 };
  if (!isFirebaseConfigured || !db || !tenantId) return idle;

  const now = Date.now();
  // "Check now" is allowed more often than the background loop, but never as a flood.
  if (now - (lastAttempt.get(tenantId) || 0) < (opts.force ? 10_000 : MIN_POLL_INTERVAL_MS)) return idle;

  const settings = await getInboundSettings(tenantId, { fresh: true });
  if (!settings.enabled || !settings.host || !settings.user) return idle;
  if (settings.status === 'paused' || settings.status === 'not_configured') return idle;
  if (!opts.force && settings.nextPollAt && new Date(settings.nextPollAt).getTime() > now) return idle;

  lastAttempt.set(tenantId, now);
  const out = await runWithJobLease(tenantId, JOB_NAME, JOB_LEASE_MS, () => runCycle(tenantId));
  return out ?? idle;
}

let tickRunning = false;

/** One pass over every workspace that has a connected mailbox. */
export async function pollAllTenantMailboxes(opts: { force?: boolean } = {}): Promise<TenantPollResult[]> {
  if (tickRunning) return [];
  tickRunning = true;
  try {
    const ids = await listInboundTenantIds();
    const results: TenantPollResult[] = [];
    for (let i = 0; i < ids.length; i += CONCURRENCY) {
      const batch = ids.slice(i, i + CONCURRENCY);
      const settled = await Promise.allSettled(batch.map((id) => pollTenantMailbox(id, opts)));
      settled.forEach((s, idx) => {
        if (s.status === 'fulfilled') results.push(s.value);
        else {
          console.error(`[Tenant IMAP] ${batch[idx]} poll crashed:`, s.reason?.message || s.reason);
          results.push({ tenantId: batch[idx], ran: true, processed: 0, skipped: 0, error: String(s.reason?.message || s.reason) });
        }
      });
    }
    return results;
  } finally {
    tickRunning = false;
  }
}

let timer: NodeJS.Timeout | null = null;

/** Starts the background loop (long-running server only; serverless uses the cron endpoint). */
export function startTenantMailboxPoller() {
  if (timer) return;
  timer = setInterval(() => {
    pollAllTenantMailboxes().catch((e) => console.error('[Tenant IMAP] tick failed:', e?.message || e));
  }, TICK_MS);
  timer.unref?.();
  console.log('[Tenant IMAP] Per-workspace mailbox poller started.');
}

// Re-exported so callers do not need to know where the id normaliser lives.
export { normalizeIdentifier };
