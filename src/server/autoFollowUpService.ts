/**
 * AI Auto Follow-Up (tenant-scoped).
 *
 * Ported from the `main` branch and rebuilt for the multi-tenant architecture:
 *  - every function takes a TenantContext; nothing is global or hard-coded to one tenant
 *  - data lives in `tenants/{id}/followup_jobs`, `tenants/{id}/auto_followup_logs`
 *    and `tenants/{id}/settings/auto_followup_config`
 *    (NOT `tenants/{id}/jobs`, which holds the worker leases)
 *  - the worker never scans leads / conversations / messages. It reads only the
 *    tenant's `scheduled` jobs, and loads a lead / thread only when a job is due
 *  - only EMAIL / WEBSITE conversations are auto-sent. Other channels go to human review
 *    instead of being marked "sent" without anything leaving the system
 *  - respects the suppression list and the tenant's daily outbound quota
 */
import { getDoc, getDocs, setDoc, query, where, orderBy, limit } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import type { Channel, Lead, Conversation, Message, LeadStatus } from '../types/index.js';
import type { TenantContext } from '../types/tenant.js';
import { tenantRepo } from './tenantRepo.js';
import { sendLiveEmail, getSmtpConfig } from './smtpService.js';
import { appendOutboundMessageToThread, getAllThreadMessages } from './inboundPipeline.js';
import { generateOpenAICompletion, getOpenAIApiKey } from './openaiClient.js';
import { isEmailSuppressed, checkTenantQuota, recordTenantUsage } from './usageService.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type FollowUpJobStatus =
  | 'scheduled'
  | 'processing'
  | 'sent'
  | 'cancelled'
  | 'skipped'
  | 'human_review'
  | 'failed'
  | 'completed';

export interface AutoFollowUpJob {
  id: string;
  tenantId: string;
  leadId: string;
  conversationId: string;
  channel: Channel;
  sequenceId: string;
  attempt: number;
  referenceMessageId: string;
  referenceMessageText?: string;
  referenceMessageTimestamp: string;
  scheduledAt: string;
  status: FollowUpJobStatus;
  createdAt: string;
  processedAt?: string | null;
  cancelledAt?: string | null;
  cancelReason?: string | null;
  idempotencyKey: string;
  /** Snapshot taken when the job was scheduled, so the worker can run without scanning collections. */
  recipientEmail?: string;
  subject?: string;
  threadId?: string;
  leadSnapshot?: {
    status?: string;
    leadType?: string;
    source?: string;
    serviceInterest?: string;
    buyingStage?: string;
    requirements?: string[];
    calendarEventId?: string | null;
    autoFollowUp?: Lead['autoFollowUp'];
  };
  audit?: {
    decision: 'send' | 'skip' | 'human_review';
    reason: string;
    objective?: string;
    generatedMessage?: string | null;
    language?: string;
    model?: string;
    timestamp?: string;
    humanReviewReason?: string | null;
  };
}

export interface ChannelTimingConfig {
  enabled: boolean;
  defaultDelayValue: number;
  defaultDelayUnit: 'minute' | 'hour' | 'day';
  maxFollowUps: number;
}

export interface AutoFollowUpGlobalConfig {
  channels: Record<string, ChannelTimingConfig>;
  mode: 'SIMPLE' | 'SEQUENCE';
  sequenceSteps: Array<{ value: number; unit: 'minute' | 'hour' | 'day' }>;
  quietHours: { enabled: boolean; start: string; end: string };
  businessHours: { enabled: boolean; days: number[]; start: string; end: string };
  timezone: string;
}

export interface AutoFollowUpActivityLog {
  id: string;
  leadId: string;
  conversationId?: string;
  channel?: Channel;
  attempt?: number;
  type:
    | 'ENABLED'
    | 'DISABLED'
    | 'SCHEDULED'
    | 'CANCELLED'
    | 'SENT'
    | 'SKIPPED'
    | 'HUMAN_REVIEW'
    | 'FAILED'
    | 'COMPLETED';
  title: string;
  description: string;
  reason?: string;
  user?: string;
  timestamp: string;
  metadata?: Record<string, any>;
}

export const DEFAULT_FOLLOWUP_CONFIG: AutoFollowUpGlobalConfig = {
  channels: {
    WHATSAPP: { enabled: true, defaultDelayValue: 1, defaultDelayUnit: 'hour', maxFollowUps: 3 },
    INSTAGRAM: { enabled: true, defaultDelayValue: 4, defaultDelayUnit: 'hour', maxFollowUps: 3 },
    FACEBOOK: { enabled: true, defaultDelayValue: 1, defaultDelayUnit: 'day', maxFollowUps: 3 },
    EMAIL: { enabled: true, defaultDelayValue: 2, defaultDelayUnit: 'day', maxFollowUps: 3 },
    WEBSITE: { enabled: true, defaultDelayValue: 1, defaultDelayUnit: 'hour', maxFollowUps: 3 },
    LINKEDIN: { enabled: true, defaultDelayValue: 1, defaultDelayUnit: 'day', maxFollowUps: 3 },
  },
  mode: 'SIMPLE',
  sequenceSteps: [
    { value: 1, unit: 'hour' },
    { value: 1, unit: 'day' },
    { value: 3, unit: 'day' },
  ],
  quietHours: { enabled: true, start: '22:00', end: '08:00' },
  businessHours: { enabled: false, days: [1, 2, 3, 4, 5, 6], start: '09:00', end: '20:00' },
  timezone: 'Asia/Kolkata',
};

const INELIGIBLE_STATUSES: LeadStatus[] = ['CLOSED_WON', 'CLOSED_LOST', 'NOT_INTERESTED', 'UNSUBSCRIBED'];
const AUTO_SEND_CHANNELS = ['EMAIL', 'WEBSITE'];

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

const safeId = (s: string) => String(s || '').replace(/[^A-Za-z0-9_-]/g, '_').slice(0, 120);
const randSuffix = () => Math.random().toString(36).slice(2, 7);
const ts = (v?: string | null) => new Date(v || 0).getTime();

function repoFor(ctx: TenantContext) {
  const r = tenantRepo(ctx);
  return {
    r,
    jobs: () => r.collection('followup_jobs'),
    job: (id: string) => r.doc('followup_jobs', id),
    logs: () => r.collection('auto_followup_logs'),
    log: (id: string) => r.doc('auto_followup_logs', id),
  };
}

function enabledDb() {
  return Boolean(isFirebaseConfigured && db);
}

/** Firestore rejects `undefined` values; strip them before writing. */
function clean<T>(obj: T): T {
  return JSON.parse(JSON.stringify(obj ?? null));
}

// Per-tenant config cache (60s) so the worker does not re-read config every pass.
const configCache = new Map<string, { at: number; cfg: AutoFollowUpGlobalConfig }>();
const CONFIG_TTL_MS = 60_000;

// Per-tenant "nothing can be due before this time" hint for the worker.
const nextCheckAt = new Map<string, number>();
const IDLE_RECHECK_MS = 5 * 60_000;

function markWorkerDirty(tenantId: string) {
  nextCheckAt.delete(tenantId);
}

/** True when the worker should look at this tenant now (lets callers skip the lease + read entirely). */
export function isFollowUpWorkerDue(tenantId: string): boolean {
  return Date.now() >= (nextCheckAt.get(tenantId) || 0);
}

// ---------------------------------------------------------------------------
// Config
// ---------------------------------------------------------------------------

export async function getAutoFollowUpConfig(ctx: TenantContext): Promise<AutoFollowUpGlobalConfig> {
  const cached = configCache.get(ctx.tenantId);
  if (cached && Date.now() - cached.at < CONFIG_TTL_MS) return cached.cfg;

  let cfg: AutoFollowUpGlobalConfig = { ...DEFAULT_FOLLOWUP_CONFIG };
  if (enabledDb()) {
    try {
      const snap = await getDoc(tenantRepo(ctx).settingsDoc('auto_followup_config'));
      if (snap.exists()) {
        const data = snap.data() as Partial<AutoFollowUpGlobalConfig>;
        cfg = {
          ...DEFAULT_FOLLOWUP_CONFIG,
          ...data,
          channels: { ...DEFAULT_FOLLOWUP_CONFIG.channels, ...(data.channels || {}) },
          quietHours: { ...DEFAULT_FOLLOWUP_CONFIG.quietHours, ...(data.quietHours || {}) },
          businessHours: { ...DEFAULT_FOLLOWUP_CONFIG.businessHours, ...(data.businessHours || {}) },
        };
      }
    } catch (e) {
      console.warn('[AutoFollowUp] Could not load config:', e);
    }
  }
  configCache.set(ctx.tenantId, { at: Date.now(), cfg });
  return cfg;
}

export async function updateAutoFollowUpConfig(
  ctx: TenantContext,
  updates: Partial<AutoFollowUpGlobalConfig>
): Promise<AutoFollowUpGlobalConfig> {
  const current = await getAutoFollowUpConfig(ctx);
  const next: AutoFollowUpGlobalConfig = {
    ...current,
    ...(updates.mode ? { mode: updates.mode } : {}),
    ...(updates.timezone ? { timezone: String(updates.timezone) } : {}),
    ...(Array.isArray(updates.sequenceSteps) ? { sequenceSteps: updates.sequenceSteps } : {}),
    channels: { ...current.channels, ...(updates.channels || {}) },
    quietHours: { ...current.quietHours, ...(updates.quietHours || {}) },
    businessHours: { ...current.businessHours, ...(updates.businessHours || {}) },
  };

  if (enabledDb()) {
    await setDoc(tenantRepo(ctx).settingsDoc('auto_followup_config'), clean(next), { merge: true });
  }
  configCache.set(ctx.tenantId, { at: Date.now(), cfg: next });
  markWorkerDirty(ctx.tenantId);
  return next;
}

// ---------------------------------------------------------------------------
// Logs
// ---------------------------------------------------------------------------

export async function logFollowUpActivity(
  ctx: TenantContext,
  activity: Omit<AutoFollowUpActivityLog, 'id'>
): Promise<AutoFollowUpActivityLog> {
  const entry: AutoFollowUpActivityLog = {
    ...activity,
    id: `log_${Date.now()}_${randSuffix()}`,
  };
  if (enabledDb()) {
    await setDoc(repoFor(ctx).log(entry.id), clean(entry), { merge: true }).catch(() => {});
  }
  return entry;
}

// ---------------------------------------------------------------------------
// Timing
// ---------------------------------------------------------------------------

export function calculateDelayMs(value: number, unit: 'minute' | 'hour' | 'day'): number {
  const v = Math.max(1, Number(value) || 1);
  if (unit === 'minute') return v * 60_000;
  if (unit === 'day') return v * 86_400_000;
  return v * 3_600_000;
}

function minutesOfDayInTz(date: Date, timeZone: string): number {
  try {
    const parts = new Intl.DateTimeFormat('en-GB', {
      timeZone,
      hour: '2-digit',
      minute: '2-digit',
      hour12: false,
    }).formatToParts(date);
    const h = Number(parts.find((p) => p.type === 'hour')?.value ?? 0) % 24;
    const m = Number(parts.find((p) => p.type === 'minute')?.value ?? 0);
    return h * 60 + m;
  } catch {
    return date.getUTCHours() * 60 + date.getUTCMinutes();
  }
}

/** If `target` falls inside quiet hours (in the configured timezone), push it to the end of them. */
export function applyQuietHoursAdjustment(
  target: Date,
  quiet: { enabled: boolean; start: string; end: string },
  timeZone: string = DEFAULT_FOLLOWUP_CONFIG.timezone
): Date {
  if (!quiet?.enabled) return target;
  try {
    const [sh, sm] = quiet.start.split(':').map(Number);
    const [eh, em] = quiet.end.split(':').map(Number);
    const startM = sh * 60 + (sm || 0);
    const endM = eh * 60 + (em || 0);
    const nowM = minutesOfDayInTz(target, timeZone);

    const isQuiet = startM > endM ? nowM >= startM || nowM < endM : nowM >= startM && nowM < endM;
    if (!isQuiet) return target;

    const deltaMin = (endM - nowM + 1440) % 1440 || 1440;
    const adjusted = new Date(target.getTime() + deltaMin * 60_000);
    adjusted.setSeconds(0, 0);
    return adjusted;
  } catch {
    return target;
  }
}

// ---------------------------------------------------------------------------
// Job helpers
// ---------------------------------------------------------------------------

async function loadJobsByField(
  ctx: TenantContext,
  field: 'conversationId' | 'leadId' | 'status',
  value: string
): Promise<AutoFollowUpJob[]> {
  if (!enabledDb()) return [];
  const snap = await getDocs(query(repoFor(ctx).jobs(), where(field, '==', value)));
  const out: AutoFollowUpJob[] = [];
  snap.forEach((d) => out.push({ ...(d.data() as AutoFollowUpJob), id: (d.data() as any)?.id || d.id }));
  return out;
}

async function saveJob(ctx: TenantContext, job: AutoFollowUpJob): Promise<void> {
  if (!enabledDb()) return;
  await setDoc(repoFor(ctx).job(job.id), clean(job), { merge: true });
}

async function saveLeadFollowUpState(ctx: TenantContext, lead: Lead): Promise<void> {
  if (!enabledDb() || !lead.leadId) return;
  await setDoc(
    tenantRepo(ctx).leadDoc(lead.leadId),
    clean({ leadId: lead.leadId, autoFollowUp: lead.autoFollowUp, updatedAt: new Date().toISOString() }),
    { merge: true }
  ).catch(() => {});
}

export async function cancelPendingFollowUpJob(
  ctx: TenantContext,
  conversationId: string,
  cancelReason: string,
  _cancelledBy: string = 'system'
): Promise<number> {
  const jobs = await loadJobsByField(ctx, 'conversationId', conversationId);
  let count = 0;
  for (const job of jobs) {
    if (job.status === 'scheduled' || job.status === 'processing') {
      job.status = 'cancelled';
      job.cancelledAt = new Date().toISOString();
      job.cancelReason = cancelReason;
      await saveJob(ctx, job);
      count++;
    }
  }
  return count;
}

export async function scheduleAutoFollowUpJob(
  ctx: TenantContext,
  params: {
    lead: Lead;
    conversation: Conversation;
    referenceMessage: { id: string; text: string; timestamp: string };
    attemptNumber?: number;
    user?: string;
  }
): Promise<AutoFollowUpJob | null> {
  const { lead, conversation, referenceMessage, attemptNumber = 1, user = 'System' } = params;
  const cfg = await getAutoFollowUpConfig(ctx);

  if (lead.leadType !== 'INBOUND' && lead.leadType !== 'OUTBOUND') return null;
  if (!lead.autoFollowUp?.enabled) return null;
  if (INELIGIBLE_STATUSES.includes(lead.status)) return null;
  if (lead.status === 'DEMO_BOOKED' && lead.calendarEventId) return null;

  const channelKey = (conversation.channel || 'EMAIL').toUpperCase();
  const channelCfg = cfg.channels[channelKey] || cfg.channels['EMAIL'];
  if (!channelCfg || !channelCfg.enabled) return null;

  const maxAttempts = channelCfg.maxFollowUps || 3;
  if (attemptNumber > maxAttempts) {
    await logFollowUpActivity(ctx, {
      leadId: lead.leadId,
      conversationId: conversation.conversationId,
      channel: conversation.channel,
      attempt: attemptNumber,
      type: 'COMPLETED',
      title: 'Auto Follow-Up sequence completed',
      description: `Maximum follow-up attempts (${maxAttempts}) reached for ${conversation.channel}.`,
      user,
      timestamp: new Date().toISOString(),
    });
    return null;
  }

  await cancelPendingFollowUpJob(ctx, conversation.conversationId, 'rescheduled_by_new_outbound_interaction', user);

  let delayValue = channelCfg.defaultDelayValue;
  let delayUnit = channelCfg.defaultDelayUnit;
  if (lead.autoFollowUp?.channelDelayOverride) {
    delayValue = lead.autoFollowUp.channelDelayOverride.value;
    delayUnit = lead.autoFollowUp.channelDelayOverride.unit;
  } else if (cfg.mode === 'SEQUENCE') {
    const step = cfg.sequenceSteps[attemptNumber - 1] || cfg.sequenceSteps[0];
    if (step) {
      delayValue = step.value;
      delayUnit = step.unit;
    }
  }

  const base = ts(referenceMessage.timestamp) || Date.now();
  let when = new Date(base + calculateDelayMs(delayValue, delayUnit));
  when = applyQuietHoursAdjustment(when, cfg.quietHours, cfg.timezone);
  if (when.getTime() < Date.now()) when = new Date();

  const nowIso = new Date().toISOString();
  const job: AutoFollowUpJob = {
    id: `fj_${safeId(conversation.conversationId)}_a${attemptNumber}_${Date.now().toString(36)}`,
    tenantId: ctx.tenantId,
    leadId: lead.leadId,
    conversationId: conversation.conversationId,
    channel: conversation.channel,
    sequenceId: `seq_${safeId(lead.leadId)}_${Date.now()}`,
    attempt: attemptNumber,
    referenceMessageId: referenceMessage.id,
    referenceMessageText: referenceMessage.text,
    referenceMessageTimestamp: referenceMessage.timestamp,
    scheduledAt: when.toISOString(),
    status: 'scheduled',
    createdAt: nowIso,
    idempotencyKey: `${ctx.tenantId}_${conversation.conversationId}_attempt_${attemptNumber}`,
    recipientEmail: conversation.customerEmail || undefined,
    subject: conversation.subject || undefined,
    threadId: conversation.gmailThreadId || conversation.emailThreadId || undefined,
    leadSnapshot: {
      status: lead.status,
      leadType: lead.leadType,
      source: lead.source,
      serviceInterest: lead.serviceInterest,
      buyingStage: lead.buyingStage,
      requirements: lead.requirements || [],
      calendarEventId: lead.calendarEventId || null,
      autoFollowUp: lead.autoFollowUp,
    },
  };

  await saveJob(ctx, job);
  markWorkerDirty(ctx.tenantId);

  const label = when.toLocaleString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    hour12: true,
    timeZone: cfg.timezone,
  });
  await logFollowUpActivity(ctx, {
    leadId: lead.leadId,
    conversationId: conversation.conversationId,
    channel: conversation.channel,
    attempt: attemptNumber,
    type: 'SCHEDULED',
    title: `Follow-up scheduled (${attemptNumber}/${maxAttempts})`,
    description: `Auto follow-up scheduled for ${label} (${cfg.timezone}).`,
    user,
    timestamp: nowIso,
  });

  return job;
}

// ---------------------------------------------------------------------------
// Trigger events
// ---------------------------------------------------------------------------

export async function handleEnableAutoFollowUp(
  ctx: TenantContext,
  params: {
    lead: Lead;
    conversation: Conversation;
    messages: Message[];
    userName?: string;
    delayOverride?: { value: number; unit: 'minute' | 'hour' | 'day' } | null;
  }
): Promise<{ enabled: boolean; job: AutoFollowUpJob | null }> {
  const { lead, conversation, messages, userName = 'Team Member', delayOverride } = params;
  const nowIso = new Date().toISOString();

  lead.autoFollowUp = {
    enabled: true,
    enabledBy: userName,
    enabledAt: nowIso,
    disabledBy: null,
    disabledAt: null,
    disabledReason: null,
    attemptCount: lead.autoFollowUp?.attemptCount || 0,
    channelDelayOverride: delayOverride ?? lead.autoFollowUp?.channelDelayOverride ?? null,
  };
  await saveLeadFollowUpState(ctx, lead);

  await logFollowUpActivity(ctx, {
    leadId: lead.leadId,
    conversationId: conversation.conversationId,
    channel: conversation.channel,
    type: 'ENABLED',
    title: 'Auto Follow-Up enabled',
    description: `Auto Follow-Up turned ON by ${userName}.`,
    user: userName,
    timestamp: nowIso,
  });

  const thread = (messages || [])
    .filter((m) => m.conversationId === conversation.conversationId)
    .sort((a, b) => ts(a.timestamp) - ts(b.timestamp));
  const last = thread[thread.length - 1];
  if (!last) return { enabled: true, job: null };

  const lastIsOurs = last.senderType === 'AGENT' || last.senderType === 'AI' || last.senderType === 'HUMAN' || last.direction === 'OUTBOUND';
  if (!lastIsOurs) return { enabled: true, job: null };

  const job = await scheduleAutoFollowUpJob(ctx, {
    lead,
    conversation,
    // Timer starts the moment the user switches Auto Follow-Up ON.
    referenceMessage: { id: last.messageId, text: last.text, timestamp: nowIso },
    attemptNumber: (lead.autoFollowUp.attemptCount || 0) + 1,
    user: userName,
  });

  if (job) {
    lead.autoFollowUp.activeFollowUpId = job.id;
    lead.autoFollowUp.nextScheduledAt = job.scheduledAt;
    await saveLeadFollowUpState(ctx, lead);
  }
  return { enabled: true, job };
}

export async function handleDisableAutoFollowUp(
  ctx: TenantContext,
  params: {
    lead: Lead;
    conversationId?: string;
    userName?: string;
    reason?: 'manual' | 'demo_booked' | 'lead_closed' | 'lead_lost' | 'do_not_contact' | 'spam' | 'opted_out' | 'admin_disabled';
  }
): Promise<{ disabled: boolean }> {
  const { lead, conversationId, userName = 'Team Member', reason = 'manual' } = params;
  const nowIso = new Date().toISOString();

  lead.autoFollowUp = {
    enabled: false,
    enabledBy: lead.autoFollowUp?.enabledBy || null,
    enabledAt: lead.autoFollowUp?.enabledAt || null,
    disabledBy: userName,
    disabledAt: nowIso,
    disabledReason: reason,
    activeFollowUpId: null,
    nextScheduledAt: null,
    attemptCount: lead.autoFollowUp?.attemptCount || 0,
    channelDelayOverride: lead.autoFollowUp?.channelDelayOverride || null,
  };
  await saveLeadFollowUpState(ctx, lead);

  if (conversationId) {
    await cancelPendingFollowUpJob(ctx, conversationId, reason, userName);
  } else {
    const jobs = await loadJobsByField(ctx, 'leadId', lead.leadId);
    for (const job of jobs) {
      if (job.status === 'scheduled' || job.status === 'processing') {
        job.status = 'cancelled';
        job.cancelledAt = nowIso;
        job.cancelReason = reason;
        await saveJob(ctx, job);
      }
    }
  }

  await logFollowUpActivity(ctx, {
    leadId: lead.leadId,
    conversationId,
    type: 'DISABLED',
    title: `Auto Follow-Up disabled (${reason})`,
    description: `Auto Follow-Up turned OFF by ${userName}. Reason: ${reason}`,
    user: userName,
    timestamp: nowIso,
  });

  return { disabled: true };
}

/**
 * Called from the inbound pipelines when a customer message arrives:
 * cancels pending follow-ups for that conversation. Cheap (one indexed query).
 */
export async function handleLeadReplyEvent(
  ctx: TenantContext,
  params: { leadId?: string; conversationId: string }
): Promise<number> {
  if (!enabledDb()) return 0;
  const count = await cancelPendingFollowUpJob(ctx, params.conversationId, 'lead_replied', 'Lead');
  if (count > 0) {
    await logFollowUpActivity(ctx, {
      leadId: params.leadId || '',
      conversationId: params.conversationId,
      type: 'CANCELLED',
      title: 'Follow-up cancelled',
      description: 'Pending follow-up cancelled because the lead responded.',
      user: 'Lead',
      timestamp: new Date().toISOString(),
    });
    if (params.leadId) {
      await setDoc(
        tenantRepo(ctx).leadDoc(params.leadId),
        { autoFollowUp: { activeFollowUpId: null, nextScheduledAt: null }, updatedAt: new Date().toISOString() },
        { merge: true }
      ).catch(() => {});
    }
  }
  return count;
}

/** Cancel every scheduled/processing follow-up job for a lead (used by demo booking). */
export async function cancelFollowUpsForLead(ctx: TenantContext, leadId: string, reason: string): Promise<number> {
  const jobs = await loadJobsByField(ctx, 'leadId', leadId);
  let count = 0;
  for (const job of jobs) {
    if (job.status === 'scheduled' || job.status === 'processing') {
      job.status = 'cancelled';
      job.cancelledAt = new Date().toISOString();
      job.cancelReason = reason;
      await saveJob(ctx, job);
      count++;
    }
  }
  return count;
}

/** Hard stop when a demo is booked. */
export async function handleDemoBookedEvent(
  ctx: TenantContext,
  params: { lead: Lead; conversationId?: string; userName?: string }
): Promise<void> {
  await handleDisableAutoFollowUp(ctx, {
    lead: params.lead,
    conversationId: params.conversationId,
    userName: params.userName || 'System Demo Booking',
    reason: 'demo_booked',
  });
}

// ---------------------------------------------------------------------------
// AI evaluation
// ---------------------------------------------------------------------------

type Evaluation = {
  decision: 'send' | 'skip' | 'human_review';
  reason: string;
  objective?: string;
  generatedMessage?: string | null;
  language?: string;
  humanReviewReason?: string | null;
  model?: string;
};

function fallbackFollowUpText(interest?: string): string {
  return `Hello,\n\nFollowing up on our previous message regarding ${interest || 'Umrah360'}. If you have any questions, or would like a short walkthrough of the platform, just reply to this email and we will be glad to help.\n\nRegards,\nUmrah360 Team`;
}

export async function evaluateAndGenerateAiFollowUp(params: {
  job: AutoFollowUpJob;
  lead: Lead;
  conversation: Conversation;
  messages: Message[];
}): Promise<Evaluation> {
  const { job, lead, conversation, messages } = params;

  const apiKey = await getOpenAIApiKey();
  if (!apiKey) {
    return {
      decision: 'send',
      reason: 'OpenAI API key not configured; used neutral fallback follow-up template.',
      generatedMessage: fallbackFollowUpText(lead.serviceInterest),
    };
  }

  const threadContext = messages
    .filter((m) => m.conversationId === conversation.conversationId)
    .sort((a, b) => ts(a.timestamp) - ts(b.timestamp))
    .slice(-20)
    .map((m) => `[${m.senderType} - ${m.timestamp}]: ${m.text}`)
    .join('\n');

  const systemPrompt = `You are the AI Operations & Conversation Engine for Umrah360 (www.umrah360.in), the travel ERP & CRM software for Hajj & Umrah tour operators.

YOUR MISSION:
Analyze the conversation thread with a lead who stopped responding after our last message. Decide whether an automated follow-up is appropriate and, if so, write a natural, contextual follow-up.

STRICT RULES:
1. NO GENERIC FOLLOW-UPS. Do not say "Just checking in...", "The system noticed you haven't replied", or "This is an automated follow-up".
2. NO HALLUCINATIONS. Never invent prices, discounts, availability, features, or promises. Use only information present in the conversation or confirmed lead details.
3. DO NOT REPEAT questions or information already given in recent messages.
4. TONE: natural, helpful, concise, warm, suitable for ${conversation.channel}. Plain text only: no Markdown symbols (no **, ##, backticks).
5. GREETING: use a formal professional greeting such as "Hello [Name]," or "Dear [Name],". NEVER use religious greetings such as "Assalamu Alaikum" or "Salam".
6. LANGUAGE: match the dominant language the lead used.
7. DECISION:
   - "send": a safe, relevant follow-up can be written.
   - "skip": no useful next step right now.
   - "human_review": a human must step in (promised pricing/visa check, complaint, conflicting details, complex request).
8. Respond ONLY with valid JSON:
   {"decision":"send|skip|human_review","reason":"...","objective":"...","language":"...","generatedMessage":"exact text if send","humanReviewReason":"if human_review"}
9. End generatedMessage with the sign-off: "Regards,\\nUmrah360 Team".`;

  const snap = job.leadSnapshot || {};
  const userPrompt = `LEAD PROFILE:
- ID: ${lead.leadId}
- Source: ${lead.source || snap.source || 'unknown'}
- Service Interest: ${lead.serviceInterest || snap.serviceInterest || 'Umrah ERP Software'}
- Status: ${lead.status || snap.status}
- Buying Stage: ${lead.buyingStage || snap.buyingStage || 'unknown'}
- Known Requirements: ${JSON.stringify(lead.requirements || snap.requirements || [])}
- Attempt Number: ${job.attempt}

CHANNEL: ${conversation.channel}

CONVERSATION THREAD:
${threadContext || 'No recent messages recorded.'}

LAST REFERENCE MESSAGE FROM US:
"${job.referenceMessageText || ''}"

Decide SEND, SKIP, or HUMAN_REVIEW and produce the JSON.`;

  try {
    const quota = await checkTenantQuota(ctx0(job), 'ai');
    if (!quota.allowed) {
      return {
        decision: 'human_review',
        reason: quota.reason || 'AI quota exceeded',
        humanReviewReason: quota.reason || 'AI quota exceeded',
      };
    }

    const raw = await generateOpenAICompletion({
      systemPrompt,
      userPrompt,
      jsonMode: true,
      models: ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'],
      temperature: 0.3,
    });
    if (!raw) {
      return { decision: 'human_review', reason: 'OpenAI output was empty.', humanReviewReason: 'Empty response from model.' };
    }

    const parsed = JSON.parse(raw);
    if (parsed.decision === 'send' && parsed.generatedMessage) {
      const msg = String(parsed.generatedMessage).toLowerCase();
      if (
        msg.includes('automated follow-up') ||
        msg.includes('system noticed') ||
        msg.includes('timer expired') ||
        msg.includes('assalamu') ||
        msg.includes('salam')
      ) {
        return {
          decision: 'human_review',
          reason: 'Generated message violated tone policy.',
          humanReviewReason: 'Generated text violated tone & authenticity policies.',
        };
      }
    }
    if (parsed.decision === 'send' && !parsed.generatedMessage) {
      return { decision: 'human_review', reason: 'Model chose send but returned no text.', humanReviewReason: 'No message generated.' };
    }

    return {
      decision: ['send', 'skip', 'human_review'].includes(parsed.decision) ? parsed.decision : 'human_review',
      reason: parsed.reason || 'OpenAI evaluation completed.',
      objective: parsed.objective,
      generatedMessage: parsed.generatedMessage,
      language: parsed.language || 'English',
      humanReviewReason: parsed.humanReviewReason,
      model: 'gpt-4o-mini',
    };
  } catch (err: any) {
    console.error('[AutoFollowUp] OpenAI error:', err?.message || err);
    return {
      decision: 'send',
      reason: `OpenAI generation failed (${err?.message || 'error'}); used neutral fallback.`,
      generatedMessage: fallbackFollowUpText(lead.serviceInterest || snap.serviceInterest),
    };
  }
}

function ctx0(job: AutoFollowUpJob): string {
  return job.tenantId;
}

// ---------------------------------------------------------------------------
// Worker
// ---------------------------------------------------------------------------

async function loadThreadMessages(ctx: TenantContext, conversationId: string): Promise<Message[]> {
  const out: Message[] = [];
  if (enabledDb()) {
    try {
      const snap = await getDocs(
        query(tenantRepo(ctx).messages(), where('conversationId', '==', conversationId), limit(100))
      );
      snap.forEach((d) => out.push({ ...(d.data() as Message), messageId: (d.data() as any)?.messageId || d.id }));
    } catch (e) {
      console.warn('[AutoFollowUp] Could not load thread messages:', e);
    }
  }
  // Merge in-memory pipeline messages for this conversation only
  const mem = (getAllThreadMessages() as Record<string, Message[]>)[conversationId] || [];
  for (const m of mem) {
    if (m?.messageId && !out.some((x) => x.messageId === m.messageId)) out.push(m);
  }
  return out;
}

async function finishJob(ctx: TenantContext, job: AutoFollowUpJob): Promise<void> {
  await saveJob(ctx, job).catch((e) => console.warn('[AutoFollowUp] saveJob failed:', e));
}

async function clearLeadSchedule(ctx: TenantContext, lead: Lead) {
  if (lead.autoFollowUp) {
    lead.autoFollowUp.activeFollowUpId = null;
    lead.autoFollowUp.nextScheduledAt = null;
  }
  await saveLeadFollowUpState(ctx, lead);
}

async function processOneJob(
  ctx: TenantContext,
  job: AutoFollowUpJob,
  cfg: AutoFollowUpGlobalConfig
): Promise<{ jobId: string; status: string; reason?: string; message?: string }> {
  // 1. Re-load current lead + conversation (tenant docs), fall back to the snapshot on the job
  let lead: Lead | null = null;
  let conversation: Conversation | null = null;
  try {
    const ls = await getDoc(tenantRepo(ctx).leadDoc(job.leadId));
    if (ls.exists()) lead = { ...(ls.data() as Lead), leadId: job.leadId };
  } catch {}
  try {
    const cs = await getDoc(tenantRepo(ctx).conversationDoc(job.conversationId));
    if (cs.exists()) conversation = { ...(cs.data() as Conversation), conversationId: job.conversationId };
  } catch {}

  const snap = job.leadSnapshot || {};
  if (!lead) {
    lead = {
      leadId: job.leadId,
      leadType: (snap.leadType as any) || 'INBOUND',
      status: (snap.status as any) || 'NEW',
      source: (snap.source as any) || 'EMAIL',
      serviceInterest: snap.serviceInterest,
      buyingStage: snap.buyingStage as any,
      requirements: snap.requirements || [],
      calendarEventId: snap.calendarEventId || undefined,
      autoFollowUp: snap.autoFollowUp,
    } as unknown as Lead;
  } else if (!lead.autoFollowUp && snap.autoFollowUp) {
    lead.autoFollowUp = snap.autoFollowUp;
  }
  if (!conversation) {
    conversation = {
      conversationId: job.conversationId,
      channel: job.channel,
      customerEmail: job.recipientEmail,
      subject: job.subject,
      emailThreadId: job.threadId,
    } as unknown as Conversation;
  }

  const cancel = async (reason: string) => {
    job.status = 'cancelled';
    job.cancelledAt = new Date().toISOString();
    job.cancelReason = reason;
    await finishJob(ctx, job);
    return { jobId: job.id, status: 'cancelled', reason };
  };

  // 2. Final eligibility checks
  if (lead.leadType !== 'INBOUND' && lead.leadType !== 'OUTBOUND') return cancel('Lead is not inbound or outbound');
  if (!lead.autoFollowUp?.enabled) return cancel('Auto Follow-Up is disabled for lead');
  if (lead.status === 'DEMO_BOOKED' && lead.calendarEventId) {
    await handleDemoBookedEvent(ctx, { lead, conversationId: conversation.conversationId });
    return cancel('Confirmed demo booked on calendar');
  }
  if (INELIGIBLE_STATUSES.includes(lead.status)) return cancel(`Lead status is ${lead.status}`);

  // 3. Has the lead replied (or have we written again) since the reference message?
  const messages = await loadThreadMessages(ctx, conversation.conversationId);
  const thread = messages.sort((a, b) => ts(a.timestamp) - ts(b.timestamp));
  const refIdx = thread.findIndex((m) => m.messageId === job.referenceMessageId);
  const after = refIdx !== -1
    ? thread.slice(refIdx + 1)
    : thread.filter((m) => ts(m.timestamp) > ts(job.referenceMessageTimestamp));

  if (after.some((m) => m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT' || m.direction === 'INBOUND')) {
    await clearLeadSchedule(ctx, lead);
    return cancel('Lead replied after reference message');
  }
  const newerOurs = after.find((m) => m.senderType === 'AGENT' || m.senderType === 'AI' || m.senderType === 'HUMAN' || m.direction === 'OUTBOUND');
  if (newerOurs) {
    job.status = 'cancelled';
    job.cancelledAt = new Date().toISOString();
    job.cancelReason = 'Newer message from our side found; rescheduled';
    await finishJob(ctx, job);
    const next = await scheduleAutoFollowUpJob(ctx, {
      lead,
      conversation,
      referenceMessage: { id: newerOurs.messageId, text: newerOurs.text, timestamp: newerOurs.timestamp || new Date().toISOString() },
      attemptNumber: job.attempt,
    });
    if (next && lead.autoFollowUp) {
      lead.autoFollowUp.activeFollowUpId = next.id;
      lead.autoFollowUp.nextScheduledAt = next.scheduledAt;
      await saveLeadFollowUpState(ctx, lead);
    }
    return { jobId: job.id, status: 'cancelled', reason: job.cancelReason };
  }

  // 4. Channel support: only email is auto-sent
  const channel = (conversation.channel || job.channel || 'EMAIL').toUpperCase();
  const humanReview = async (reason: string) => {
    job.status = 'human_review';
    job.processedAt = new Date().toISOString();
    job.audit = { decision: 'human_review', reason, humanReviewReason: reason, timestamp: job.processedAt };
    await finishJob(ctx, job);
    await clearLeadSchedule(ctx, lead!);
    await logFollowUpActivity(ctx, {
      leadId: lead!.leadId,
      conversationId: conversation!.conversationId,
      channel: conversation!.channel,
      attempt: job.attempt,
      type: 'HUMAN_REVIEW',
      title: `Human review required (${job.attempt})`,
      description: reason,
      reason,
      timestamp: new Date().toISOString(),
    });
    return { jobId: job.id, status: 'human_review', reason };
  };

  if (!AUTO_SEND_CHANNELS.includes(channel)) {
    return humanReview(`Auto-send is not available for ${channel} yet. Please follow up manually.`);
  }

  const recipient = (conversation.customerEmail || job.recipientEmail || '').trim();
  if (!recipient || !recipient.includes('@')) {
    return humanReview('No recipient email address on this conversation.');
  }
  if (await isEmailSuppressed(ctx.tenantId, recipient)) {
    await clearLeadSchedule(ctx, lead);
    return cancel('Recipient is on the suppression list');
  }

  // 5. AI decision
  const evalResult = await evaluateAndGenerateAiFollowUp({ job, lead, conversation, messages: thread });
  job.audit = {
    decision: evalResult.decision,
    reason: evalResult.reason,
    objective: evalResult.objective,
    generatedMessage: evalResult.generatedMessage,
    language: evalResult.language,
    humanReviewReason: evalResult.humanReviewReason,
    model: evalResult.model || 'gpt-4o-mini',
    timestamp: new Date().toISOString(),
  };

  if (evalResult.decision === 'skip') {
    job.status = 'skipped';
    job.processedAt = new Date().toISOString();
    await finishJob(ctx, job);
    await clearLeadSchedule(ctx, lead);
    await logFollowUpActivity(ctx, {
      leadId: lead.leadId,
      conversationId: conversation.conversationId,
      channel: conversation.channel,
      attempt: job.attempt,
      type: 'SKIPPED',
      title: `Follow-up skipped (${job.attempt})`,
      description: evalResult.reason,
      timestamp: new Date().toISOString(),
    });
    return { jobId: job.id, status: 'skipped', reason: evalResult.reason };
  }

  if (evalResult.decision === 'human_review' || !evalResult.generatedMessage) {
    return humanReview(evalResult.humanReviewReason || evalResult.reason);
  }

  // 6. Outbound quota, then send
  const sendQuota = await checkTenantQuota(ctx.tenantId, 'outboundDaily');
  if (!sendQuota.allowed) {
    // Put it back so it is retried on a later pass, not lost.
    job.status = 'scheduled';
    job.scheduledAt = new Date(Date.now() + 60 * 60_000).toISOString();
    await finishJob(ctx, job);
    return { jobId: job.id, status: 'scheduled', reason: sendQuota.reason };
  }

  const subject = `Re: ${(conversation.subject || job.subject || 'Umrah360 Follow-Up').replace(/^re:\s*/i, '')}`;
  const lastMsg = thread[thread.length - 1];
  const inReplyTo = lastMsg?.gmailMessageId && !String(lastMsg.gmailMessageId).startsWith('<out-') ? lastMsg.gmailMessageId : undefined;

  const sendRes = await sendLiveEmail({
    tenantId: ctx.tenantId,
    to: recipient,
    subject,
    text: evalResult.generatedMessage,
    ...(inReplyTo ? { inReplyTo, references: [inReplyTo] } : {}),
  });

  const nowIso = new Date().toISOString();
  if (!sendRes.success) {
    job.status = 'failed';
    job.processedAt = nowIso;
    job.cancelReason = sendRes.error || 'Email send error';
    await finishJob(ctx, job);
    await logFollowUpActivity(ctx, {
      leadId: lead.leadId,
      conversationId: conversation.conversationId,
      channel: conversation.channel,
      attempt: job.attempt,
      type: 'FAILED',
      title: `Follow-up failed (${job.attempt})`,
      description: `Failed to dispatch follow-up: ${sendRes.error || 'Email unavailable'}`,
      reason: sendRes.error,
      timestamp: nowIso,
    });
    return { jobId: job.id, status: 'failed', reason: sendRes.error };
  }

  job.status = 'sent';
  job.processedAt = nowIso;
  await finishJob(ctx, job);
  await recordTenantUsage(ctx.tenantId, { solicitedEmailCount: 1 }).catch(() => {});

  if (lead.autoFollowUp) lead.autoFollowUp.attemptCount = job.attempt;

  const messageId = `msg-followup-${Date.now()}-${randSuffix()}`;
  const gmailMessageId = sendRes.messageId || `<followup-${Date.now()}@${ctx.tenantId}>`;
  const fromAddr = (getSmtpConfig() as any)?.user || (getSmtpConfig() as any)?.from || '';
  const followUpMessage: Message = {
    messageId,
    gmailMessageId,
    gmailThreadId: conversation.gmailThreadId || conversation.emailThreadId || job.threadId || `thread-${conversation.conversationId}`,
    conversationId: conversation.conversationId,
    channel: 'EMAIL',
    direction: 'OUTBOUND',
    senderType: 'AI',
    senderName: 'AI Follow-Up',
    senderEmail: fromAddr || undefined,
    text: evalResult.generatedMessage,
    timestamp: nowIso,
    sentAt: nowIso,
    receivedAt: nowIso,
    createdAt: nowIso,
    aiProcessed: true,
    aiGenerated: true,
    confidence: 0.9,
    emailMeta: { subject, from: fromAddr, to: recipient, messageId: gmailMessageId },
    smtpStatus: sendRes.simulated ? 'SIMULATED' : 'DELIVERED',
  } as unknown as Message;

  if (enabledDb()) {
    await setDoc(tenantRepo(ctx).messageDoc(messageId), clean(followUpMessage), { merge: true }).catch(() => {});
    await setDoc(
      tenantRepo(ctx).conversationDoc(conversation.conversationId),
      { lastMessageAt: nowIso, lastMessageText: evalResult.generatedMessage.slice(0, 120), updatedAt: nowIso },
      { merge: true }
    ).catch(() => {});
  }
  appendOutboundMessageToThread(conversation.conversationId, followUpMessage);

  await logFollowUpActivity(ctx, {
    leadId: lead.leadId,
    conversationId: conversation.conversationId,
    channel: conversation.channel,
    attempt: job.attempt,
    type: 'SENT',
    title: `Follow-up sent (Attempt #${job.attempt})`,
    description: evalResult.generatedMessage,
    timestamp: nowIso,
  });

  // 7. Chain the next attempt
  const channelCfg = cfg.channels[channel] || cfg.channels['EMAIL'];
  const maxAttempts = channelCfg?.maxFollowUps || 3;
  if (job.attempt < maxAttempts && lead.autoFollowUp?.enabled) {
    const next = await scheduleAutoFollowUpJob(ctx, {
      lead,
      conversation,
      referenceMessage: { id: messageId, text: evalResult.generatedMessage, timestamp: nowIso },
      attemptNumber: job.attempt + 1,
      user: 'AI Follow-Up Agent',
    });
    if (next && lead.autoFollowUp) {
      lead.autoFollowUp.activeFollowUpId = next.id;
      lead.autoFollowUp.nextScheduledAt = next.scheduledAt;
    }
  } else if (lead.autoFollowUp) {
    lead.autoFollowUp.activeFollowUpId = null;
    lead.autoFollowUp.nextScheduledAt = null;
  }
  await saveLeadFollowUpState(ctx, lead);

  return { jobId: job.id, status: 'sent', message: evalResult.generatedMessage };
}

/**
 * Processes this tenant's due jobs. Reads only the tenant's `scheduled` jobs
 * (usually zero or a handful). `force` skips the idle-skip hint.
 */
export async function processDueFollowUpJobs(
  ctx: TenantContext,
  opts: { force?: boolean; maxJobs?: number } = {}
): Promise<{ processedCount: number; results: any[] }> {
  if (!enabledDb()) return { processedCount: 0, results: [] };

  const hint = nextCheckAt.get(ctx.tenantId) || 0;
  if (!opts.force && Date.now() < hint) return { processedCount: 0, results: [] };

  const scheduled = await loadJobsByField(ctx, 'status', 'scheduled');
  const nowMs = Date.now();
  const due = scheduled
    .filter((j) => ts(j.scheduledAt) <= nowMs)
    .sort((a, b) => ts(a.scheduledAt) - ts(b.scheduledAt))
    .slice(0, opts.maxJobs ?? 10);

  const future = scheduled.filter((j) => ts(j.scheduledAt) > nowMs).map((j) => ts(j.scheduledAt));
  nextCheckAt.set(ctx.tenantId, Math.min(nowMs + IDLE_RECHECK_MS, ...(future.length ? future : [Infinity])));

  if (due.length === 0) return { processedCount: 0, results: [] };

  const cfg = await getAutoFollowUpConfig(ctx);
  const results: any[] = [];
  for (const job of due) {
    try {
      job.status = 'processing';
      await saveJob(ctx, job);
      results.push(await processOneJob(ctx, job, cfg));
    } catch (err: any) {
      console.error(`[AutoFollowUp] Job ${job.id} crashed:`, err?.message || err);
      job.status = 'failed';
      job.processedAt = new Date().toISOString();
      job.cancelReason = err?.message || 'Unexpected error';
      await finishJob(ctx, job);
      results.push({ jobId: job.id, status: 'failed', reason: job.cancelReason });
    }
  }
  markWorkerDirty(ctx.tenantId);
  return { processedCount: due.length, results };
}

/** Worker entry point (called per tenant under a job lease, or from the cron route). */
export async function runAutoFollowUpWorkerCycle(
  ctx: TenantContext,
  opts: { force?: boolean } = {}
): Promise<{ processedCount: number; results: any[] }> {
  try {
    return await processDueFollowUpJobs(ctx, opts);
  } catch (err) {
    console.warn('[AutoFollowUp] Worker cycle error:', err);
    return { processedCount: 0, results: [] };
  }
}

// ---------------------------------------------------------------------------
// Dashboard
// ---------------------------------------------------------------------------

export async function getAutoFollowUpDashboardData(ctx: TenantContext): Promise<{
  metrics: {
    scheduled: number;
    sentToday: number;
    cancelled: number;
    skipped: number;
    humanReview: number;
    failed: number;
    completed: number;
  };
  jobs: AutoFollowUpJob[];
  logs: AutoFollowUpActivityLog[];
  config: AutoFollowUpGlobalConfig;
}> {
  const config = await getAutoFollowUpConfig(ctx);
  const jobs: AutoFollowUpJob[] = [];
  const logs: AutoFollowUpActivityLog[] = [];

  if (enabledDb()) {
    const r = repoFor(ctx);
    const [jobSnap, logSnap] = await Promise.all([
      getDocs(query(r.jobs(), orderBy('createdAt', 'desc'), limit(200))),
      getDocs(query(r.logs(), orderBy('timestamp', 'desc'), limit(100))),
    ]);
    jobSnap.forEach((d) => jobs.push({ ...(d.data() as AutoFollowUpJob), id: (d.data() as any)?.id || d.id }));
    logSnap.forEach((d) => logs.push({ ...(d.data() as AutoFollowUpActivityLog), id: (d.data() as any)?.id || d.id }));
  }

  const today = new Date().toISOString().slice(0, 10);
  const count = (s: FollowUpJobStatus) => jobs.filter((j) => j.status === s).length;
  return {
    metrics: {
      scheduled: count('scheduled'),
      sentToday: jobs.filter((j) => j.status === 'sent' && j.processedAt && j.processedAt.slice(0, 10) === today).length,
      cancelled: count('cancelled'),
      skipped: count('skipped'),
      humanReview: count('human_review'),
      failed: count('failed'),
      completed: count('completed'),
    },
    jobs,
    logs,
    config,
  };
}
