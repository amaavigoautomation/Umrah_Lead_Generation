import { getDoc, getDocs, setDoc, increment, query, where } from './adminFirestore.js';
import { getEffectiveLimits } from './entitlements.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { tenantRepo, globalTenantDoc } from './tenantRepo.js';
import type { TenantContext, Tenant, TenantMonthlyUsage } from '../types/tenant.js';
import { randomUUID } from 'node:crypto';
import { getModelTokenPricing } from './modelPricingService.js';
import type { AiFeatureUsageTotals } from '../shared/aiUsageFeatures.js';

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
  aiModelCostUsd?: number;
  aiModelUnpricedRequestCount?: number;
  solicitedEmailCount?: number;
  coldEmailCount?: number;
  whatsappMessageCount?: number;
  aiFeatureUsage?: Record<string, Partial<AiFeatureUsageTotals>>;
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
    'aiCostUsd', 'aiUnpricedRequestCount', 'aiModelCostUsd', 'aiModelUnpricedRequestCount', 'solicitedEmailCount', 'coldEmailCount', 'whatsappMessageCount',
  ];
  const dailyCounters: (keyof UsageDelta)[] = [
    'aiInputTokens', 'aiOutputTokens', 'aiCachedInputTokens', 'aiTotalTokens', 'aiRequestCount',
    'aiCostUsd', 'aiUnpricedRequestCount', 'aiModelCostUsd', 'aiModelUnpricedRequestCount', 'solicitedEmailCount', 'coldEmailCount',
  ];
  for (const key of monthlyCounters) {
    const value = Number(delta[key] || 0);
    if (Number.isFinite(value) && value !== 0) monthUpdate[key] = increment(value);
  }
  for (const key of dailyCounters) {
    const value = Number(delta[key] || 0);
    if (Number.isFinite(value) && value !== 0) dailyUpdate[key] = increment(value);
  }

  // Feature-level token/cost totals are stored in the same month/day summaries.
  // Firestore merge semantics preserve other feature keys while incrementing these counters.
  const featureIncrements: Record<string, any> = {};
  for (const [featureId, featureDelta] of Object.entries(delta.aiFeatureUsage || {})) {
    const safeFeatureId = featureId.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80);
    if (!safeFeatureId) continue;
    const featureCounters: Record<string, any> = {};
    for (const key of ['aiInputTokens', 'aiOutputTokens', 'aiTotalTokens', 'aiRequestCount', 'aiCostUsd', 'aiUnpricedRequestCount'] as const) {
      const value = Number(featureDelta[key] || 0);
      if (Number.isFinite(value) && value !== 0) featureCounters[key] = increment(value);
    }
    if (Object.keys(featureCounters).length) featureIncrements[safeFeatureId] = featureCounters;
  }
  if (Object.keys(featureIncrements).length) {
    monthUpdate.aiFeatureUsage = featureIncrements;
    dailyUpdate.aiFeatureUsage = featureIncrements;
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
 * Records one provider completion as an immutable event and increments tenant/month/day
 * summaries. Pricing is resolved from the refreshed external model catalogue, never from
 * an in-code list of model rates.
 */
export async function recordAiCompletionUsage(
  tenantId: string,
  completion: any,
  requestedModel: string,
  provider: string = 'openai',
  featureId: string = 'unclassified',
): Promise<void> {
  if (!tenantId) return;
  const usage = completion?.usage || completion?.usageMetadata || null;
  const inputTokens = Math.max(0, Number(
    usage?.prompt_tokens ?? usage?.input_tokens ?? usage?.promptTokenCount ?? usage?.inputTokenCount ?? 0
  ) || 0);
  const outputTokens = Math.max(0, Number(
    usage?.completion_tokens ??
    usage?.output_tokens ??
    (usage?.candidatesTokenCount !== undefined
      ? ((Number(usage.candidatesTokenCount) || 0) + (Number(usage?.thoughtsTokenCount ?? 0) || 0))
      : (Number(usage?.outputTokenCount ?? 0) || 0))
  ) || 0);
  const reportedTotalTokens = Math.max(0, Number(
    usage?.total_tokens ?? usage?.totalTokens ?? usage?.totalTokenCount ?? 0
  ) || 0);
  const totalTokens = Math.max(reportedTotalTokens, inputTokens + outputTokens);
  const cachedInputTokens = Math.min(inputTokens, Math.max(0, Number(
    usage?.prompt_tokens_details?.cached_tokens ??
    usage?.input_tokens_details?.cached_tokens ??
    usage?.cachedContentTokenCount ??
    usage?.cached_tokens ?? 0
  ) || 0));
  const reasoningTokens = Math.min(outputTokens, Math.max(0, Number(
    usage?.completion_tokens_details?.reasoning_tokens ??
    usage?.output_tokens_details?.reasoning_tokens ??
    usage?.thoughtsTokenCount ?? 0
  ) || 0));
  const inputImageTokens = Math.min(inputTokens, Math.max(0, Number(
    usage?.prompt_tokens_details?.image_tokens ??
    usage?.input_tokens_details?.image_tokens ??
    usage?.inputImageTokens ?? 0
  ) || 0));
  const outputImageTokens = Math.min(outputTokens, Math.max(0, Number(
    usage?.completion_tokens_details?.image_tokens ??
    usage?.output_tokens_details?.image_tokens ??
    usage?.outputImageTokens ?? 0
  ) || 0));
  const inputAudioTokens = Math.min(inputTokens, Math.max(0, Number(
    usage?.prompt_tokens_details?.audio_tokens ??
    usage?.input_tokens_details?.audio_tokens ??
    usage?.inputAudioTokens ?? 0
  ) || 0));
  const outputAudioTokens = Math.min(outputTokens, Math.max(0, Number(
    usage?.completion_tokens_details?.audio_tokens ??
    usage?.output_tokens_details?.audio_tokens ??
    usage?.outputAudioTokens ?? 0
  ) || 0));

  const model = String(completion?.model || requestedModel || 'unknown').trim();
  const hasTokenUsage = inputTokens + outputTokens + totalTokens > 0;
  const normalizedProvider = String(provider || 'openai').trim().toLowerCase();
  const safeFeatureId = String(featureId || 'unclassified').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || 'unclassified';
  const pricing = hasTokenUsage && model !== 'unknown'
    ? await getModelTokenPricing(normalizedProvider, model).catch(() => null)
    : null;

  const textInputTokens = Math.max(0, inputTokens - cachedInputTokens - inputImageTokens - inputAudioTokens);
  const textOutputTokens = Math.max(0, outputTokens - reasoningTokens - outputImageTokens - outputAudioTokens);
  const cachedRate = pricing?.cacheRead ?? pricing?.input;
  const reasoningRate = pricing?.reasoning ?? pricing?.output;
  const imageOutputRate = pricing?.outputImage ?? pricing?.output;
  let pricingComplete = Boolean(hasTokenUsage && pricing);
  const missingRate =
    (textInputTokens > 0 && pricing?.input === undefined) ||
    (cachedInputTokens > 0 && cachedRate === undefined) ||
    (textOutputTokens > 0 && pricing?.output === undefined) ||
    (reasoningTokens > 0 && reasoningRate === undefined) ||
    (inputImageTokens > 0 && pricing?.inputImage === undefined) ||
    (outputImageTokens > 0 && imageOutputRate === undefined) ||
    (inputAudioTokens > 0 && pricing?.inputAudio === undefined) ||
    (outputAudioTokens > 0 && pricing?.outputAudio === undefined);
  if (missingRate) pricingComplete = false;

  let estimatedCostUsd = 0;
  if (pricingComplete && pricing) {
    estimatedCostUsd = (
      textInputTokens * Number(pricing.input || 0) +
      cachedInputTokens * Number(cachedRate || 0) +
      textOutputTokens * Number(pricing.output || 0) +
      reasoningTokens * Number(reasoningRate || 0) +
      inputImageTokens * Number(pricing.inputImage || 0) +
      outputImageTokens * Number(imageOutputRate || 0) +
      inputAudioTokens * Number(pricing.inputAudio || 0) +
      outputAudioTokens * Number(pricing.outputAudio || 0)
    ) / 1_000_000;
  }
  // Provider tool calls (for example, Responses API web search) can carry separate per-call
  // charges that are not token rates. Keep token cost, but flag the request as partially priced.
  const unpricedToolCallCount = Array.isArray(completion?.output)
    ? completion.output.filter((item: any) => item?.type === 'web_search_call').length
    : 0;
  const requestCount = 1;
  const unpricedCount = pricingComplete && unpricedToolCallCount === 0 ? 0 : 1;
  const featureTotals: AiFeatureUsageTotals = {
    aiInputTokens: inputTokens,
    aiOutputTokens: outputTokens,
    aiTotalTokens: totalTokens,
    aiRequestCount: requestCount,
    aiCostUsd: estimatedCostUsd,
    aiUnpricedRequestCount: unpricedCount,
  };

  await recordTenantUsage(tenantId, {
    aiInputTokens: inputTokens,
    aiOutputTokens: outputTokens,
    aiCachedInputTokens: cachedInputTokens,
    aiTotalTokens: totalTokens,
    aiRequestCount: requestCount,
    aiModelCostUsd: estimatedCostUsd,
    aiModelUnpricedRequestCount: unpricedCount,
    aiFeatureUsage: { [safeFeatureId]: featureTotals },
  });

  // Store model/provider/rate metadata per request; never store prompts or customer content.
  if (isFirebaseConfigured && db) {
    try {
      const ctx: TenantContext = { tenantId, uid: 'system', email: 'system@umrah360.in', role: 'admin' };
      const eventId = randomUUID();
      await setDoc(tenantRepo(ctx).aiUsageEventDoc(eventId), {
        eventId,
        provider: normalizedProvider,
        requestedModel: String(requestedModel || 'unknown'),
        actualModel: model,
        feature: safeFeatureId,
        usageAvailable: Boolean(usage),
        inputTokens,
        outputTokens,
        totalTokens,
        cachedInputTokens,
        reasoningTokens,
        inputImageTokens,
        outputImageTokens,
        inputAudioTokens,
        outputAudioTokens,
        estimatedCostUsd,
        pricingRates: pricing ? {
          input: pricing.input ?? null,
          output: pricing.output ?? null,
          reasoning: pricing.reasoning ?? null,
          cacheRead: pricing.cacheRead ?? null,
          cacheWrite: pricing.cacheWrite ?? null,
          inputImage: pricing.inputImage ?? null,
          outputImage: pricing.outputImage ?? null,
          inputAudio: pricing.inputAudio ?? null,
          outputAudio: pricing.outputAudio ?? null,
        } : null,
        hasTokenUsage,
        unpricedToolCallCount,
        pricingStatus: !pricingComplete ? 'UNPRICED' : unpricedToolCallCount > 0 ? 'PARTIALLY_PRICED' : 'PRICED',
        pricingSource: pricing?.source || null,
        pricingSourceUrl: pricing?.sourceUrl || null,
        pricingVersion: pricing?.pricingVersion || null,
        pricingFetchedAt: pricing?.fetchedAt || null,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('[UsageService] Could not write the AI usage event:', error);
    }
  }
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
  aiModelCostUsd: number;
  aiModelUnpricedRequestCount: number;
  aiFeatureUsage: Record<string, AiFeatureUsageTotals>;
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
  aiModelCostUsd: number;
  aiModelUnpricedRequestCount: number;
  aiFeatureUsage: Record<string, AiFeatureUsageTotals>;
  days: TenantDailyUsageRow[];
}

function normalizeAiFeatureUsage(value: unknown): Record<string, AiFeatureUsageTotals> {
  const raw = value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
  const result: Record<string, AiFeatureUsageTotals> = {};
  for (const [featureId, entry] of Object.entries(raw)) {
    const item = entry && typeof entry === 'object' ? entry : {};
    result[featureId] = {
      aiInputTokens: Number(item.aiInputTokens || 0),
      aiOutputTokens: Number(item.aiOutputTokens || 0),
      aiTotalTokens: Number(item.aiTotalTokens || 0),
      aiRequestCount: Number(item.aiRequestCount || 0),
      aiCostUsd: Number(item.aiCostUsd || 0),
      aiUnpricedRequestCount: Number(item.aiUnpricedRequestCount || 0),
    };
  }
  return result;
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
    aiCostUsd: 0, aiUnpricedRequestCount: 0, aiModelCostUsd: 0, aiModelUnpricedRequestCount: 0, aiFeatureUsage: {},
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
        aiModelCostUsd: Number(data.aiModelCostUsd || 0),
        aiModelUnpricedRequestCount: Number(data.aiModelUnpricedRequestCount || 0),
        aiFeatureUsage: normalizeAiFeatureUsage(data.aiFeatureUsage),
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
      totals.aiModelCostUsd += row.aiModelCostUsd;
      totals.aiModelUnpricedRequestCount += row.aiModelUnpricedRequestCount;
      for (const [featureId, usage] of Object.entries(row.aiFeatureUsage)) {
        const current = totals.aiFeatureUsage[featureId] || {
          aiInputTokens: 0, aiOutputTokens: 0, aiTotalTokens: 0, aiRequestCount: 0, aiCostUsd: 0, aiUnpricedRequestCount: 0,
        };
        for (const key of ['aiInputTokens', 'aiOutputTokens', 'aiTotalTokens', 'aiRequestCount', 'aiCostUsd', 'aiUnpricedRequestCount'] as const) {
          current[key] += Number(usage[key] || 0);
        }
        totals.aiFeatureUsage[featureId] = current;
      }
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
    aiModelCostUsd: 0,
    aiModelUnpricedRequestCount: 0,
    aiFeatureUsage: {},
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
