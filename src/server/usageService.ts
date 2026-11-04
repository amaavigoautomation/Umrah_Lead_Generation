import { getDoc, getDocs, setDoc, increment, query, where } from './adminFirestore.js';
import { getEffectiveLimits } from './entitlements.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { tenantRepo, globalTenantDoc } from './tenantRepo.js';
import type { TenantContext, Tenant, TenantMonthlyUsage } from '../types/tenant.js';

function getCurrentMonthKey(): string {
  const now = new Date();
  const yyyy = now.getUTCFullYear();
  const mm = String(now.getUTCMonth() + 1).padStart(2, '0');
  return `${yyyy}-${mm}`;
}

export interface UsageDelta {
  aiInputTokens?: number;
  aiOutputTokens?: number;
  aiCachedInputTokens?: number;
  aiTotalTokens?: number;
  aiRequestCount?: number;
  aiCostUsd?: number;
  aiUnpricedRequestCount?: number;
  solicitedEmailCount?: number;
  coldEmailCount?: number;
  whatsappMessageCount?: number;
}

function getCurrentDayKey(): string {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, '0')}-${String(now.getUTCDate()).padStart(2, '0')}`;
}

/**
 * Atomically records usage in both the monthly summary and the UTC-day ledger.
 * The daily ledger powers date-filtered email and AI usage reporting.
 */
export async function recordTenantUsage(tenantId: string, delta: UsageDelta): Promise<void> {
  if (!isFirebaseConfigured || !db || !tenantId) return;
  const ctx: TenantContext = { tenantId, uid: 'system', email: 'system@umrah360.in', role: 'admin' };
  const repo = tenantRepo(ctx);
  const nowIso = new Date().toISOString();
  const month = getCurrentMonthKey();
  const day = getCurrentDayKey();
  const monthUpdate: Record<string, any> = { month, updatedAt: nowIso };
  const dailyUpdate: Record<string, any> = { day, updatedAt: nowIso };
  const monthlyCounters: (keyof UsageDelta)[] = [
    'aiInputTokens', 'aiOutputTokens', 'aiCachedInputTokens', 'aiTotalTokens', 'aiRequestCount',
    'aiCostUsd', 'aiUnpricedRequestCount', 'solicitedEmailCount', 'coldEmailCount', 'whatsappMessageCount',
  ];
  const dailyCounters: (keyof UsageDelta)[] = [
    'aiInputTokens', 'aiOutputTokens', 'aiCachedInputTokens', 'aiTotalTokens', 'aiRequestCount',
    'aiCostUsd', 'aiUnpricedRequestCount', 'solicitedEmailCount', 'coldEmailCount',
  ];
  for (const key of monthlyCounters) {
    const value = Number(delta[key] || 0);
    if (Number.isFinite(value) && value !== 0) monthUpdate[key] = increment(value);
  }
  for (const key of dailyCounters) {
    const value = Number(delta[key] || 0);
    if (Number.isFinite(value) && value !== 0) dailyUpdate[key] = increment(value);
  }

  const emailCount = Math.max(0, Number(delta.coldEmailCount || 0)) + Math.max(0, Number(delta.solicitedEmailCount || 0));
  if (emailCount > 0) dailyUpdate.emailSentCount = increment(emailCount);

  try {
    await Promise.all([
      setDoc(repo.usageDoc(month), monthUpdate, { merge: true }),
      ...(Object.keys(dailyUpdate).length > 2 ? [setDoc(repo.dailyUsageDoc(day), dailyUpdate, { merge: true })] : []),
    ]);
  } catch (err) {
    console.warn(`[UsageService] Error recording usage for tenant ${tenantId}:`, err);
  }
}
/**
 * Record provider-reported token usage and estimate cost only where a model rate is known.
 * Rates are USD per 1M tokens. Unknown models still count tokens and are flagged as unpriced.
 */
export async function recordAiCompletionUsage(
  tenantId: string,
  completion: any,
  requestedModel: string,
  provider: 'openai' | 'gemini' = 'openai',
): Promise<void> {
  if (!tenantId || !completion?.usage) return;
  const usage = completion.usage;
  const inputTokens = Math.max(0, Number(usage.prompt_tokens ?? usage.input_tokens ?? usage.promptTokenCount ?? 0) || 0);
  const outputTokens = Math.max(0, Number(usage.completion_tokens ?? usage.output_tokens ?? usage.candidatesTokenCount ?? 0) || 0);
  const totalTokens = Math.max(0, Number(usage.total_tokens ?? usage.totalTokens ?? usage.totalTokenCount ?? (inputTokens + outputTokens)) || 0);
  if (inputTokens + outputTokens + totalTokens <= 0) return;

  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(
    usage.prompt_tokens_details?.cached_tokens ?? usage.input_tokens_details?.cached_tokens ?? usage.cachedContentTokenCount ?? 0
  ) || 0));
  const model = String(completion.model || requestedModel || 'unknown').toLowerCase();
  const openAiRates = model.startsWith('gpt-6.1-sol')
    ? { input: 2.00, cachedInput: 0.10, output: 10.00 }
    : model.startsWith('gpt-4o-mini')
    ? { input: 0.15, cachedInput: 0.075, output: 0.60 }
    : model.startsWith('gpt-4o')
      ? { input: 2.50, cachedInput: 1.25, output: 10.00 }
      : null;
  const rates = provider === 'openai' ? openAiRates : null;
  const uncachedInputTokens = Math.max(0, inputTokens - cachedInputTokens);
  const estimatedCost = rates
    ? (uncachedInputTokens * rates.input + cachedInputTokens * rates.cachedInput + outputTokens * rates.output) / 1_000_000
    : 0;

  await recordTenantUsage(tenantId, {
    aiInputTokens: inputTokens,
    aiOutputTokens: outputTokens,
    aiCachedInputTokens: cachedInputTokens,
    aiTotalTokens: totalTokens,
    aiRequestCount: 1,
    aiCostUsd: estimatedCost,
    aiUnpricedRequestCount: rates ? 0 : 1,
  });
}

export interface TenantDailyUsageRow {
  day: string;
  emailSentCount: number;
  coldEmailCount: number;
  solicitedEmailCount: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiRequestCount: number;
  aiCostUsd: number;
  aiUnpricedRequestCount: number;
}

export interface TenantUsageDateRange {
  from: string;
  to: string;
  timezone: 'UTC';
  emailSentCount: number;
  coldEmailCount: number;
  solicitedEmailCount: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiRequestCount: number;
  aiCostUsd: number;
  aiUnpricedRequestCount: number;
  days: TenantDailyUsageRow[];
}

function isValidDateKey(value: string): boolean {
  const parts = value.split('-');
  const isDigits = (part: string) => part.length > 0 && Array.from(part).every((character) => character >= '0' && character <= '9');
  if (parts.length !== 3 || parts[0].length !== 4 || parts[1].length !== 2 || parts[2].length !== 2 || !parts.every(isDigits)) return false;
  const [year, month, day] = parts.map(Number);
  if (year < 2000 || month < 1 || month > 12 || day < 1 || day > 31) return false;
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return parsed.getUTCFullYear() === year && parsed.getUTCMonth() === month - 1 && parsed.getUTCDate() === day;
}
function enumerateDateKeys(from: string, to: string): string[] {
  const start = Date.parse(`${from}T00:00:00.000Z`);
  const end = Date.parse(`${to}T00:00:00.000Z`);
  const count = Math.floor((end - start) / 86_400_000) + 1;
  if (count < 1 || count > 93) throw new Error('Choose a date range of 93 days or less.');
  return Array.from({ length: count }, (_, index) => new Date(start + index * 86_400_000).toISOString().slice(0, 10));
}

/**
 * Returns one row per UTC day, including dates with no activity, plus totals for the range.
 * Future dates are valid and show zero until sends or AI requests actually occur.
 */
export async function getTenantUsageForDateRange(
  tenantId: string,
  fromInput?: string | null,
  toInput?: string | null,
  includeDays = true,
): Promise<TenantUsageDateRange> {
  const today = getCurrentDayKey();
  const from = String(fromInput || toInput || today).trim();
  const to = String(toInput || fromInput || today).trim();
  if (!isValidDateKey(from) || !isValidDateKey(to) || from > to) {
    throw new Error('Enter a valid date range. The end date must be on or after the start date.');
  }
  const dateKeys = enumerateDateKeys(from, to);
  const totals: Omit<TenantDailyUsageRow, 'day'> = {
    emailSentCount: 0, coldEmailCount: 0, solicitedEmailCount: 0,
    aiInputTokens: 0, aiOutputTokens: 0, aiTotalTokens: 0, aiRequestCount: 0,
    aiCostUsd: 0, aiUnpricedRequestCount: 0,
  };

  if (!isFirebaseConfigured || !db || !tenantId) {
    return { from, to, timezone: 'UTC', ...totals, days: includeDays ? dateKeys.map((day) => ({ day, ...totals })) : [] };
  }

  try {
    const ctx: TenantContext = { tenantId, uid: 'system', email: 'system@umrah360.in', role: 'admin' };
    const repo = tenantRepo(ctx);
    const snapshot = await getDocs(query(repo.dailyUsageCol(), where('day', '>=', from), where('day', '<=', to)));
    const byDay = new Map<string, any>();
    snapshot.forEach((document) => byDay.set(document.id, document.data()));
    const rows = dateKeys.map((day): TenantDailyUsageRow => {
      const data = byDay.get(day) || {};
      return {
        day,
        emailSentCount: Number(data.emailSentCount || 0),
        coldEmailCount: Number(data.coldEmailCount || 0),
        solicitedEmailCount: Number(data.solicitedEmailCount || 0),
        aiInputTokens: Number(data.aiInputTokens || 0),
        aiOutputTokens: Number(data.aiOutputTokens || 0),
        aiTotalTokens: Number(data.aiTotalTokens || 0),
        aiRequestCount: Number(data.aiRequestCount || 0),
        aiCostUsd: Number(data.aiCostUsd || 0),
        aiUnpricedRequestCount: Number(data.aiUnpricedRequestCount || 0),
      };
    });
    for (const row of rows) {
      totals.emailSentCount += row.emailSentCount;
      totals.coldEmailCount += row.coldEmailCount;
      totals.solicitedEmailCount += row.solicitedEmailCount;
      totals.aiInputTokens += row.aiInputTokens;
      totals.aiOutputTokens += row.aiOutputTokens;
      totals.aiTotalTokens += row.aiTotalTokens;
      totals.aiRequestCount += row.aiRequestCount;
      totals.aiCostUsd += row.aiCostUsd;
      totals.aiUnpricedRequestCount += row.aiUnpricedRequestCount;
    }
    return { from, to, timezone: 'UTC', ...totals, days: includeDays ? rows : [] };
  } catch (err) {
    console.warn(`[UsageService] Error reading date-filtered usage for tenant ${tenantId}:`, err);
    throw new Error('Could not load daily usage data.');
  }
}

/** Current UTC-day email count used for daily outbound quota enforcement. */
export async function getTenantCurrentDailyEmailCount(tenantId: string): Promise<number> {
  if (!isFirebaseConfigured || !db || !tenantId) return 0;
  try {
    const ctx: TenantContext = { tenantId, uid: 'system', email: 'system@umrah360.in', role: 'admin' };
    const snap = await getDoc(tenantRepo(ctx).dailyUsageDoc(getCurrentDayKey()));
    return snap.exists() ? Math.max(0, Number((snap.data() as any)?.emailSentCount || 0)) : 0;
  } catch (err) {
    console.warn(`[UsageService] Error fetching daily email usage for tenant ${tenantId}:`, err);
    return 0;
  }
}

/**
 * Retrieves the current month's usage stats for a tenant
 */
export async function getTenantCurrentUsage(
  tenantId: string
): Promise<TenantMonthlyUsage> {
  const month = getCurrentMonthKey();
  const defaultUsage: TenantMonthlyUsage = {
    month,
    aiInputTokens: 0,
    aiOutputTokens: 0,
    aiCachedInputTokens: 0,
    aiTotalTokens: 0,
    aiRequestCount: 0,
    aiCostUsd: 0,
    aiUnpricedRequestCount: 0,
    solicitedEmailCount: 0,
    coldEmailCount: 0,
    whatsappMessageCount: 0,
    updatedAt: new Date().toISOString(),
  };

  if (!isFirebaseConfigured || !db || !tenantId) return defaultUsage;

  try {
    const ctx: TenantContext = {
      tenantId,
      uid: 'system',
      email: 'system@umrah360.in',
      role: 'admin',
    };
    const snap = await getDoc(tenantRepo(ctx).usageDoc(month));
    if (snap.exists()) {
      return { ...defaultUsage, ...(snap.data() as Partial<TenantMonthlyUsage>) };
    }
  } catch (err) {
    console.warn(`[UsageService] Error fetching usage for tenant ${tenantId}:`, err);
  }

  return defaultUsage;
}

/**
 * Checks whether a tenant has exceeded their plan limits
 */
export async function checkTenantQuota(
  tenantId: string,
  type: 'ai' | 'outboundDaily'
): Promise<{ allowed: boolean; reason?: string; current: number; limit: number }> {
  if (!isFirebaseConfigured || !db || !tenantId) {
    return { allowed: true, current: 0, limit: 1_000_000 };
  }

  try {
    const tenantSnap = await getDoc(globalTenantDoc(tenantId));
    if (!tenantSnap.exists()) {
      return { allowed: true, current: 0, limit: 1_000_000 };
    }

    const tenant = tenantSnap.data() as Tenant;
    // Limits come from the workspace's plan (+ overrides); legacy workspaces keep their own stored limits.
    const limits = (await getEffectiveLimits(tenantId).catch(() => null)) || tenant.limits || {
      monthlyAiTokens: 2_000_000,
      dailyOutboundSends: 3_000,
      hourlyOutboundSends: 500,
      seats: 10,
    };

    const usage = await getTenantCurrentUsage(tenantId);

    if (type === 'ai') {
      const currentTokens = usage.aiTotalTokens || 0;
      const limitTokens = limits.monthlyAiTokens || 2_000_000;
      if (currentTokens >= limitTokens) {
        return {
          allowed: false,
          reason: `Monthly AI token limit of ${limitTokens.toLocaleString()} exceeded (current: ${currentTokens.toLocaleString()}).`,
          current: currentTokens,
          limit: limitTokens,
        };
      }
      return { allowed: true, current: currentTokens, limit: limitTokens };
    }

    if (type === 'outboundDaily') {
      const currentSends = await getTenantCurrentDailyEmailCount(tenantId);
      const limitSends = limits.dailyOutboundSends || 3_000;
      if (currentSends >= limitSends) {
        return {
          allowed: false,
          reason: `Daily outbound send limit of ${limitSends.toLocaleString()} reached.`,
          current: currentSends,
          limit: limitSends,
        };
      }
      return { allowed: true, current: currentSends, limit: limitSends };
    }
  } catch (err) {
    console.warn(`[UsageService] Quota check error for ${tenantId}:`, err);
  }

  return { allowed: true, current: 0, limit: 1_000_000 };
}

/**
 * Checks if a recipient email is suppressed (unsubscribed or hard bounced)
 */
export async function isEmailSuppressed(
  tenantId: string,
  email: string
): Promise<boolean> {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !isFirebaseConfigured || !db || !tenantId) return false;

  try {
    const ctx: TenantContext = {
      tenantId,
      uid: 'system',
      email: 'system@umrah360.in',
      role: 'admin',
    };
    const snap = await getDoc(tenantRepo(ctx).suppressionDoc(clean));
    return snap.exists();
  } catch {
    return false;
  }
}

/**
 * Adds an email to the tenant's suppression list
 */
export async function addEmailSuppression(
  tenantId: string,
  email: string,
  reason: 'unsubscribe' | 'bounce' | 'complaint' | 'manual' = 'unsubscribe'
): Promise<void> {
  const clean = (email || '').trim().toLowerCase();
  if (!clean || !isFirebaseConfigured || !db || !tenantId) return;

  try {
    const ctx: TenantContext = {
      tenantId,
      uid: 'system',
      email: 'system@umrah360.in',
      role: 'admin',
    };
    await setDoc(tenantRepo(ctx).suppressionDoc(clean), {
      email: clean,
      reason,
      createdAt: new Date().toISOString(),
    });
  } catch (err) {
    console.warn(`[UsageService] Error suppressing email ${clean}:`, err);
  }
}
