import { getDoc, setDoc, updateDoc, increment } from './adminFirestore.js';
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
  aiTotalTokens?: number;
  aiRequestCount?: number;
  solicitedEmailCount?: number;
  coldEmailCount?: number;
  whatsappMessageCount?: number;
}

/**
 * Atomically increments monthly usage counters for a tenant in Firestore
 */
export async function recordTenantUsage(
  tenantId: string,
  delta: UsageDelta
): Promise<void> {
  if (!isFirebaseConfigured || !db || !tenantId) return;

  const month = getCurrentMonthKey();
  const ctx: TenantContext = {
    tenantId,
    uid: 'system',
    email: 'system@umrah360.in',
    role: 'admin',
  };

  const usageDocRef = tenantRepo(ctx).usageDoc(month);

  try {
    const snap = await getDoc(usageDocRef);
    const nowIso = new Date().toISOString();

    if (!snap.exists()) {
      const initialRecord: TenantMonthlyUsage = {
        month,
        aiInputTokens: delta.aiInputTokens || 0,
        aiOutputTokens: delta.aiOutputTokens || 0,
        aiTotalTokens: delta.aiTotalTokens || (delta.aiInputTokens || 0) + (delta.aiOutputTokens || 0),
        aiRequestCount: delta.aiRequestCount || 1,
        solicitedEmailCount: delta.solicitedEmailCount || 0,
        coldEmailCount: delta.coldEmailCount || 0,
        whatsappMessageCount: delta.whatsappMessageCount || 0,
        updatedAt: nowIso,
      };
      await setDoc(usageDocRef, initialRecord);
    } else {
      const updates: Record<string, any> = {
        updatedAt: nowIso,
      };
      if (delta.aiInputTokens) updates.aiInputTokens = increment(delta.aiInputTokens);
      if (delta.aiOutputTokens) updates.aiOutputTokens = increment(delta.aiOutputTokens);
      if (delta.aiTotalTokens) {
        updates.aiTotalTokens = increment(delta.aiTotalTokens);
      } else if (delta.aiInputTokens || delta.aiOutputTokens) {
        updates.aiTotalTokens = increment((delta.aiInputTokens || 0) + (delta.aiOutputTokens || 0));
      }
      if (delta.aiRequestCount) updates.aiRequestCount = increment(delta.aiRequestCount);
      if (delta.solicitedEmailCount) updates.solicitedEmailCount = increment(delta.solicitedEmailCount);
      if (delta.coldEmailCount) updates.coldEmailCount = increment(delta.coldEmailCount);
      if (delta.whatsappMessageCount) updates.whatsappMessageCount = increment(delta.whatsappMessageCount);

      await updateDoc(usageDocRef, updates);
    }
  } catch (err) {
    console.warn(`[UsageService] Error recording usage for tenant ${tenantId}:`, err);
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
    aiTotalTokens: 0,
    aiRequestCount: 0,
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
      return snap.data() as TenantMonthlyUsage;
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
      const currentSends = (usage.coldEmailCount || 0) + (usage.solicitedEmailCount || 0);
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
