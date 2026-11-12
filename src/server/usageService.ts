import { getDoc, getDocs, setDoc, increment, query, where, limit, orderByDocumentId, startAfterId, runTransaction } from './adminFirestore.js';
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
interface AiUsageParts {
  model: string;
  inputTokens: number;
  outputTokens: number;
  totalTokens: number;
  cachedInputTokens: number;
  cachedImageTokens: number;
  reasoningTokens: number;
  inputImageTokens: number;
  outputImageTokens: number;
  inputAudioTokens: number;
  outputAudioTokens: number;
  generatedImageCount: number;
  hasTokenUsage: boolean;
}

function numericTokenValue(...values: unknown[]): number {
  for (const value of values) {
    if (value === undefined || value === null || value === '') continue;
    const parsed = Number(value);
    if (Number.isFinite(parsed) && parsed >= 0) return parsed;
  }
  return 0;
}

function extractAiUsageParts(completion: any, requestedModel: string): AiUsageParts {
  const usage = completion?.usage || completion?.usageMetadata || null;
  const model = String(completion?.model || requestedModel || 'unknown').trim();
  const imageModel = /^gpt-image-/i.test(model);
  const inputTokens = numericTokenValue(usage?.prompt_tokens, usage?.input_tokens, usage?.promptTokenCount, usage?.inputTokenCount);
  const outputTokens = numericTokenValue(
    usage?.completion_tokens,
    usage?.output_tokens,
    usage?.candidatesTokenCount !== undefined
      ? numericTokenValue(usage?.candidatesTokenCount) + numericTokenValue(usage?.thoughtsTokenCount)
      : undefined,
    usage?.outputTokenCount,
  );
  const totalTokens = Math.max(
    numericTokenValue(usage?.total_tokens, usage?.totalTokens, usage?.totalTokenCount),
    inputTokens + outputTokens,
  );
  const cachedInputTokens = Math.min(inputTokens, numericTokenValue(
    usage?.prompt_tokens_details?.cached_tokens,
    usage?.input_tokens_details?.cached_tokens,
    usage?.cachedContentTokenCount,
    usage?.cached_tokens,
  ));
  const reasoningTokens = Math.min(outputTokens, numericTokenValue(
    usage?.completion_tokens_details?.reasoning_tokens,
    usage?.output_tokens_details?.reasoning_tokens,
    usage?.thoughtsTokenCount,
  ));
  const inputImageTokens = Math.min(inputTokens, numericTokenValue(
    usage?.prompt_tokens_details?.image_tokens,
    usage?.input_tokens_details?.image_tokens,
    usage?.inputImageTokens,
  ));
  // The direct Images API returns input text/image details but can omit output_tokens_details.
  // GPT Image output_tokens are image-output tokens, so price them at the image output rate.
  const outputImageTokens = Math.min(outputTokens, numericTokenValue(
    usage?.completion_tokens_details?.image_tokens,
    usage?.output_tokens_details?.image_tokens,
    usage?.outputImageTokens,
    imageModel ? outputTokens : undefined,
  ));
  const inputAudioTokens = Math.min(inputTokens, numericTokenValue(
    usage?.prompt_tokens_details?.audio_tokens,
    usage?.input_tokens_details?.audio_tokens,
    usage?.inputAudioTokens,
  ));
  const outputAudioTokens = Math.min(outputTokens, numericTokenValue(
    usage?.completion_tokens_details?.audio_tokens,
    usage?.output_tokens_details?.audio_tokens,
    usage?.outputAudioTokens,
  ));
  const cachedImageTokens = Math.min(inputImageTokens, numericTokenValue(
    usage?.input_tokens_details?.cached_image_tokens,
    usage?.input_tokens_details?.cachedImageTokens,
    usage?.cachedImageTokens,
  ));
  const generatedImageCount = Array.isArray(completion?.data)
    ? completion.data.length
    : Array.isArray(completion?.output)
      ? completion.output.filter((item: any) => item?.type === 'image_generation_call' && item?.status === 'completed').length
      : 0;

  return {
    model, inputTokens, outputTokens, totalTokens, cachedInputTokens, cachedImageTokens,
    reasoningTokens, inputImageTokens, outputImageTokens, inputAudioTokens, outputAudioTokens,
    generatedImageCount,
    hasTokenUsage: inputTokens + outputTokens > 0,
  };
}

interface AiCostResult {
  estimatedCostUsd: number;
  pricingComplete: boolean;
  pricingRates: Record<string, number | null>;
  pricingSource: string | null;
  pricingSourceUrl: string | null;
  pricingVersion: string | null;
}

function calculateAiUsageCost(
  pricing: Awaited<ReturnType<typeof getModelTokenPricing>>,
  parts: AiUsageParts,
): AiCostResult {
  if (!pricing || !parts.hasTokenUsage) {
    return {
      estimatedCostUsd: 0,
      pricingComplete: false,
      pricingRates: {},
      pricingSource: pricing?.source || null,
      pricingSourceUrl: pricing?.sourceUrl || null,
      pricingVersion: pricing?.pricingVersion || null,
    };
  }

  const cachedTextTokens = Math.min(
    parts.cachedInputTokens,
    Math.max(0, parts.inputTokens - parts.inputImageTokens - parts.inputAudioTokens),
  );
  const cachedImageTokens = Math.min(
    parts.inputImageTokens,
    Math.max(parts.cachedImageTokens, parts.cachedInputTokens - cachedTextTokens),
  );
  const textInputTokens = Math.max(0,
    parts.inputTokens - parts.inputImageTokens - parts.inputAudioTokens - cachedTextTokens - cachedImageTokens);
  const uncachedImageTokens = Math.max(0, parts.inputImageTokens - cachedImageTokens);
  const textOutputTokens = Math.max(0,
    parts.outputTokens - parts.outputImageTokens - parts.outputAudioTokens - parts.reasoningTokens);

  const cachedTextRate = pricing.cacheRead ?? pricing.input;
  const cachedImageRate = pricing.cacheReadImage;
  const reasoningRate = pricing.reasoning ?? pricing.output;
  const imageOutputRate = pricing.outputImage ?? pricing.output;

  const pricingComplete =
    (textInputTokens <= 0 || pricing.input !== undefined) &&
    (cachedTextTokens <= 0 || cachedTextRate !== undefined) &&
    (uncachedImageTokens <= 0 || pricing.inputImage !== undefined) &&
    (cachedImageTokens <= 0 || cachedImageRate !== undefined) &&
    (parts.inputAudioTokens <= 0 || pricing.inputAudio !== undefined) &&
    (textOutputTokens <= 0 || pricing.output !== undefined) &&
    (parts.reasoningTokens <= 0 || reasoningRate !== undefined) &&
    (parts.outputImageTokens <= 0 || imageOutputRate !== undefined) &&
    (parts.outputAudioTokens <= 0 || pricing.outputAudio !== undefined);

  const estimatedCostUsd = pricingComplete ? (
    textInputTokens * Number(pricing.input || 0) +
    cachedTextTokens * Number(cachedTextRate || 0) +
    uncachedImageTokens * Number(pricing.inputImage || 0) +
    cachedImageTokens * Number(cachedImageRate || 0) +
    parts.inputAudioTokens * Number(pricing.inputAudio || 0) +
    textOutputTokens * Number(pricing.output || 0) +
    parts.reasoningTokens * Number(reasoningRate || 0) +
    parts.outputImageTokens * Number(imageOutputRate || 0) +
    parts.outputAudioTokens * Number(pricing.outputAudio || 0)
  ) / 1_000_000 : 0;

  return {
    estimatedCostUsd,
    pricingComplete,
    pricingRates: {
      input: pricing.input ?? null,
      output: pricing.output ?? null,
      reasoning: pricing.reasoning ?? null,
      cacheRead: pricing.cacheRead ?? null,
      cacheReadImage: pricing.cacheReadImage ?? null,
      cacheWrite: pricing.cacheWrite ?? null,
      inputImage: pricing.inputImage ?? null,
      outputImage: pricing.outputImage ?? null,
      inputAudio: pricing.inputAudio ?? null,
      outputAudio: pricing.outputAudio ?? null,
    },
    pricingSource: pricing.source || null,
    pricingSourceUrl: pricing.sourceUrl || null,
    pricingVersion: pricing.pricingVersion || null,
  };
}

export async function recordAiCompletionUsage(
  tenantId: string,
  completion: any,
  requestedModel: string,
  provider: string = 'openai',
  featureId: string = 'unclassified',
): Promise<void> {
  if (!tenantId) return;
  const usage = completion?.usage || completion?.usageMetadata || null;
  const parts = extractAiUsageParts(completion, requestedModel);
  const normalizedProvider = String(provider || 'openai').trim().toLowerCase();
  const safeFeatureId = String(featureId || 'unclassified').trim().toLowerCase().replace(/[^a-z0-9_-]/g, '_').slice(0, 80) || 'unclassified';
  const pricing = (parts.hasTokenUsage || parts.generatedImageCount > 0) && parts.model !== 'unknown'
    ? await getModelTokenPricing(normalizedProvider, parts.model).catch(() => null)
    : null;
  const cost = calculateAiUsageCost(pricing, parts);
  const unpricedToolCallCount = Array.isArray(completion?.output)
    ? completion.output.filter((item: any) => item?.type === 'web_search_call').length
    : 0;
  const unpricedCount = cost.pricingComplete && unpricedToolCallCount === 0 ? 0 : 1;
  const featureTotals: AiFeatureUsageTotals = {
    aiInputTokens: parts.inputTokens,
    aiOutputTokens: parts.outputTokens,
    aiTotalTokens: parts.totalTokens,
    aiRequestCount: 1,
    aiCostUsd: cost.estimatedCostUsd,
    aiUnpricedRequestCount: unpricedCount,
  };

  await recordTenantUsage(tenantId, {
    aiInputTokens: parts.inputTokens,
    aiOutputTokens: parts.outputTokens,
    aiCachedInputTokens: parts.cachedInputTokens,
    aiTotalTokens: parts.totalTokens,
    aiRequestCount: 1,
    aiModelCostUsd: cost.estimatedCostUsd,
    aiModelUnpricedRequestCount: unpricedCount,
    aiFeatureUsage: { [safeFeatureId]: featureTotals },
  });

  if (isFirebaseConfigured && db) {
    try {
      const ctx: TenantContext = { tenantId, uid: 'system', email: 'system@umrah360.in', role: 'admin' };
      const eventId = randomUUID();
      await setDoc(tenantRepo(ctx).aiUsageEventDoc(eventId), {
        eventId,
        provider: normalizedProvider,
        requestedModel: String(requestedModel || 'unknown'),
        actualModel: parts.model,
        feature: safeFeatureId,
        usageAvailable: Boolean(usage),
        hasTokenUsage: parts.hasTokenUsage,
        inputTokens: parts.inputTokens,
        outputTokens: parts.outputTokens,
        totalTokens: parts.totalTokens,
        cachedInputTokens: parts.cachedInputTokens,
        cachedImageTokens: parts.cachedImageTokens,
        reasoningTokens: parts.reasoningTokens,
        inputImageTokens: parts.inputImageTokens,
        outputImageTokens: parts.outputImageTokens,
        inputAudioTokens: parts.inputAudioTokens,
        outputAudioTokens: parts.outputAudioTokens,
        generatedImageCount: parts.generatedImageCount,
        estimatedCostUsd: cost.estimatedCostUsd,
        pricingRates: cost.pricingRates,
        unpricedToolCallCount,
        pricingStatus: !cost.pricingComplete ? 'UNPRICED' : unpricedToolCallCount > 0 ? 'PARTIALLY_PRICED' : 'PRICED',
        pricingSource: cost.pricingSource,
        pricingSourceUrl: cost.pricingSourceUrl,
        pricingVersion: cost.pricingVersion,
        pricingFetchedAt: pricing?.fetchedAt || null,
        createdAt: new Date().toISOString(),
      });
    } catch (error) {
      console.warn('[UsageService] Could not write the AI usage event:', error);
    }
  }
}

/**
 * Reprices historical AI events using the event's actual model and recorded text/image token counts.
 * Each event and both summary-ledger deltas are updated transactionally, preventing double-counting
 * when a billing page refresh repeats the migration.
 */
export async function repriceTenantAiUsageEvents(
  tenantId: string,
  batchSize = 80,
): Promise<{ processed: number; pending: boolean }> {
  if (!isFirebaseConfigured || !db || !tenantId) return { processed: 0, pending: false };
  const ctx: TenantContext = { tenantId, uid: 'system', email: 'system@umrah360.in', role: 'admin' };
  const repo = tenantRepo(ctx);
  const markerRef = repo.settingsDoc('ai_usage_cost_repricing_v2');
  const markerSnap = await getDoc(markerRef);
  const marker = markerSnap.exists() ? markerSnap.data() as any : {};
  const version = 2;

  if (marker.version === version && marker.status === 'COMPLETE') return { processed: 0, pending: false };
  const cursor = marker.version === version ? String(marker.cursor || '') : '';
  const eventQuery = cursor
    ? query(repo.aiUsageEvents(), orderByDocumentId(), startAfterId(cursor), limit(batchSize))
    : query(repo.aiUsageEvents(), orderByDocumentId(), limit(batchSize));
  const events = await getDocs(eventQuery);
  if (!events.docs.length) {
    await setDoc(markerRef, { version, status: 'COMPLETE', cursor: '', completedAt: new Date().toISOString() }, { merge: true });
    return { processed: 0, pending: false };
  }

  let processed = 0;
  for (const eventDoc of events.docs) {
    const event = eventDoc.data() as any;
    const oldStatus = String(event.pricingStatus || 'UNPRICED');
    if (oldStatus === 'PRICED') continue;
    const model = String(event.actualModel || event.requestedModel || 'unknown');
    const provider = String(event.provider || 'openai');
    if (model === 'unknown') continue;

    const eventInputTokens = numericTokenValue(event.inputTokens);
    const eventOutputTokens = numericTokenValue(event.outputTokens);
    const parts: AiUsageParts = {
      model,
      inputTokens: eventInputTokens,
      outputTokens: eventOutputTokens,
      totalTokens: Math.max(numericTokenValue(event.totalTokens), eventInputTokens + eventOutputTokens),
      cachedInputTokens: numericTokenValue(event.cachedInputTokens),
      cachedImageTokens: numericTokenValue(event.cachedImageTokens),
      reasoningTokens: numericTokenValue(event.reasoningTokens),
      inputImageTokens: numericTokenValue(event.inputImageTokens),
      outputImageTokens: numericTokenValue(event.outputImageTokens, /^gpt-image-/i.test(model) ? eventOutputTokens : 0),
      inputAudioTokens: numericTokenValue(event.inputAudioTokens),
      outputAudioTokens: numericTokenValue(event.outputAudioTokens),
      generatedImageCount: numericTokenValue(event.generatedImageCount),
      hasTokenUsage: eventInputTokens + eventOutputTokens > 0,
    };
    const pricing = await getModelTokenPricing(provider, model).catch(() => null);
    const cost = calculateAiUsageCost(pricing, parts);
    if (!cost.pricingComplete || !parts.hasTokenUsage) continue;

    const newStatus = numericTokenValue(event.unpricedToolCallCount) > 0 ? 'PARTIALLY_PRICED' : 'PRICED';
    const createdAt = String(event.createdAt || '');
    const day = createdAt.slice(0, 10);
    const month = day.slice(0, 7);
    const feature = String(event.feature || 'unclassified').replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 80) || 'unclassified';
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day) || !/^\d{4}-\d{2}$/.test(month)) continue;

    const eventRef = repo.aiUsageEventDoc(eventDoc.id);
    const monthRef = repo.usageDoc(month);
    const dayRef = repo.dailyUsageDoc(day);
    const now = new Date().toISOString();
    await runTransaction(async (transaction: any) => {
      const currentEventSnap = await transaction.get(eventRef);
      if (!currentEventSnap.exists) return;
      const currentEvent = currentEventSnap.data() as any;
      const currentStatus = String(currentEvent.pricingStatus || 'UNPRICED');
      if (currentStatus === 'PRICED') return;
      const [monthSnap, daySnap] = await Promise.all([
        transaction.get(monthRef),
        transaction.get(dayRef),
      ]);
      const oldUnpriced = currentStatus === 'PRICED' ? 0 : 1;
      const newUnpriced = newStatus === 'PRICED' ? 0 : 1;
      const unpricedDelta = newUnpriced - oldUnpriced;
      const currentFeature = monthSnap.exists ? (monthSnap.data() as any)?.aiFeatureUsage?.[feature] || {} : {};
      const currentDailyFeature = daySnap.exists ? (daySnap.data() as any)?.aiFeatureUsage?.[feature] || {} : {};
      const monthlyUnpriced = Math.max(0, numericTokenValue(monthSnap.exists ? (monthSnap.data() as any)?.aiModelUnpricedRequestCount : 0) + unpricedDelta);
      const dailyUnpriced = Math.max(0, numericTokenValue(daySnap.exists ? (daySnap.data() as any)?.aiModelUnpricedRequestCount : 0) + unpricedDelta);
      const oldCost = numericTokenValue(currentEvent.estimatedCostUsd);
      const costDelta = cost.estimatedCostUsd - oldCost;
      const monthlyFeatureUnpriced = Math.max(0, numericTokenValue(currentFeature.aiUnpricedRequestCount) + unpricedDelta);
      const dailyFeatureUnpriced = Math.max(0, numericTokenValue(currentDailyFeature.aiUnpricedRequestCount) + unpricedDelta);

      transaction.set(monthRef, {
        aiModelCostUsd: increment(costDelta),
        aiModelUnpricedRequestCount: monthlyUnpriced,
        aiFeatureUsage: { [feature]: { aiCostUsd: increment(costDelta), aiUnpricedRequestCount: monthlyFeatureUnpriced } },
        updatedAt: now,
      }, { merge: true });
      transaction.set(dayRef, {
        aiModelCostUsd: increment(costDelta),
        aiModelUnpricedRequestCount: dailyUnpriced,
        aiFeatureUsage: { [feature]: { aiCostUsd: increment(costDelta), aiUnpricedRequestCount: dailyFeatureUnpriced } },
        updatedAt: now,
      }, { merge: true });
      transaction.set(eventRef, {
        estimatedCostUsd: cost.estimatedCostUsd,
        pricingRates: cost.pricingRates,
        pricingStatus: newStatus,
        pricingSource: cost.pricingSource,
        pricingSourceUrl: cost.pricingSourceUrl,
        pricingVersion: cost.pricingVersion,
        pricingFetchedAt: pricing?.fetchedAt || null,
        repricedAt: now,
      }, { merge: true });
    });
    processed += 1;
  }

  const nextCursor = events.docs[events.docs.length - 1].id;
  const pending = events.docs.length >= batchSize;
  await setDoc(markerRef, {
    version,
    status: pending ? 'RUNNING' : 'COMPLETE',
    cursor: pending ? nextCursor : '',
    processedAt: new Date().toISOString(),
    ...(pending ? {} : { completedAt: new Date().toISOString() }),
  }, { merge: true });
  return { processed, pending };
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
