import { getDoc, setDoc, increment } from './adminFirestore.js';
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
 * Atomically increments the tenant's monthly usage document. Merge + FieldValue.increment
 * avoids the read-then-write race that could lose simultaneous usage events on a new month.
 */
export async function recordTenantUsage(tenantId: string, delta: UsageDelta): Promise<void> {
  if (!isFirebaseConfigured || !db || !tenantId) return;
  const ctx: TenantContext = { tenantId, uid: 'system', email: 'system@umrah360.in', role: 'admin' };
  const repo = tenantRepo(ctx);
  const nowIso = new Date().toISOString();
  const month = getCurrentMonthKey();
  const monthUpdate: Record<string, any> = { month, updatedAt: nowIso };
  const counters: (keyof UsageDelta)[] = [
    'aiInputTokens', 'aiOutputTokens', 'aiCachedInputTokens', 'aiTotalTokens', 'aiRequestCount',
    'aiCostUsd', 'aiUnpricedRequestCount', 'solicitedEmailCount', 'coldEmailCount', 'whatsappMessageCount',
  ];
  for (const key of counters) {
    const value = Number(delta[key] || 0);
    if (Number.isFinite(value) && value !== 0) monthUpdate[key] = increment(value);
  }

  try {
    await setDoc(repo.usageDoc(month), monthUpdate, { merge: true });
    const emailCount = Math.max(0, Number(delta.coldEmailCount || 0)) + Math.max(0, Number(delta.solicitedEmailCount || 0));
    if (emailCount > 0) {
      await setDoc(repo.dailyUsageDoc(getCurrentDayKey()), {
        day: getCurrentDayKey(),
        emailSentCount: increment(emailCount),
        updatedAt: nowIso,
      }, { merge: true });
    }
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
  const openAiRates = model.startsWith('gpt-4o-mini')
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
