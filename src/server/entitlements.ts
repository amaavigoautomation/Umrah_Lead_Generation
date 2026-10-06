import { db, doc, getDoc, getDocs, setDoc, collection } from './adminFirestore.js';
import { globalTenantDoc } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { FEATURES, LIMITS } from '../shared/features.js';

/**
 * Plans are data (Firestore `plans/{id}`); a workspace stores only `planId` + optional `overrides`.
 * Effective access = registry defaults < plan < workspace overrides.
 */

export interface PlanDoc {
  id: string;
  name: string;
  priceMonthly: number;
  currency: string;
  stripePriceId?: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  sortOrder: number;
  active: boolean;
  createdAt?: string;
  updatedAt?: string;
}

export interface Entitlements {
  planId: string;
  planName: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
}

export class EntitlementError extends Error {
  status = 402;
  code = 'upgrade_required';
  constructor(public feature: string, message?: string) {
    super(message || `Your plan does not include "${feature}". Upgrade to use it.`);
  }
}

export const LEGACY_PLAN_ID = 'legacy';

const allOn = () => Object.fromEntries(FEATURES.map((f) => [f.key, true]));

/** Placeholder plans, seeded once. Super admin edits them in the Platform Console. */
export const SEED_PLANS: PlanDoc[] = [
  {
    id: LEGACY_PLAN_ID,
    name: 'Legacy (all features)',
    priceMonthly: 0,
    currency: 'USD',
    features: allOn(),
    limits: {}, // empty = keep the workspace's own limits
    sortOrder: 0,
    active: false,
  },
  {
    id: 'basic',
    name: 'Basic',
    priceMonthly: 29,
    currency: 'USD',
    features: { ...allOn(), campaigns: false, scheduling: false, auto_followup: false, custom_domain: false },
    limits: { seats: 2, dailyOutboundSends: 200, hourlyOutboundSends: 50, monthlyAiTokens: 500_000 },
    sortOrder: 1,
    active: true,
  },
  {
    id: 'growth',
    name: 'Growth',
    priceMonthly: 99,
    currency: 'USD',
    features: { ...allOn(), auto_followup: false },
    limits: { seats: 5, dailyOutboundSends: 1_000, hourlyOutboundSends: 200, monthlyAiTokens: 2_000_000 },
    sortOrder: 2,
    active: true,
  },
  {
    id: 'pro',
    name: 'Pro',
    priceMonthly: 249,
    currency: 'USD',
    features: allOn(),
    limits: { seats: 15, dailyOutboundSends: 5_000, hourlyOutboundSends: 1_000, monthlyAiTokens: 5_000_000 },
    sortOrder: 3,
    active: true,
  },
];

const CACHE_MS = 60_000;
const entCache = new Map<string, { at: number; value: Entitlements }>();
let plansCache: { at: number; value: Map<string, PlanDoc> } | null = null;
let seeded = false;

export function invalidateEntitlements(tenantId?: string) {
  if (tenantId) entCache.delete(tenantId);
  else entCache.clear();
  plansCache = null;
}

async function ensureSeeded() {
  if (seeded || !isFirebaseConfigured || !db) return;
  seeded = true;
  try {
    for (const p of SEED_PLANS) {
      const ref = doc(db, 'plans', p.id);
      const snap = await getDoc(ref);
      if (!snap.exists()) {
        const now = new Date().toISOString();
        await setDoc(ref, { ...p, createdAt: now, updatedAt: now }, { merge: false });
      }
    }
  } catch (err) {
    seeded = false;
    console.warn('[Entitlements] could not seed plans:', (err as any)?.message || err);
  }
}

export async function listPlans(): Promise<PlanDoc[]> {
  if (!isFirebaseConfigured || !db) return SEED_PLANS;
  await ensureSeeded();
  if (plansCache && Date.now() - plansCache.at < CACHE_MS) return [...plansCache.value.values()].sort((a, b) => a.sortOrder - b.sortOrder);
  const snap = await getDocs(collection(db, 'plans'));
  const map = new Map<string, PlanDoc>();
  snap.docs.forEach((d) => map.set(d.id, { ...(d.data() as PlanDoc), id: d.id }));
  plansCache = { at: Date.now(), value: map };
  return [...map.values()].sort((a, b) => a.sortOrder - b.sortOrder);
}

export async function savePlan(input: Partial<PlanDoc> & { id: string }): Promise<PlanDoc> {
  if (!isFirebaseConfigured || !db) throw new Error('Database not configured');
  const id = String(input.id).toLowerCase().trim();
  if (!/^[a-z0-9_-]{2,40}$/.test(id)) throw new Error('Plan id must be 2-40 characters: a-z, 0-9, - or _');
  const existing = (await listPlans()).find((p) => p.id === id);
  const features: Record<string, boolean> = {};
  const src = input.features || existing?.features || {};
  for (const f of FEATURES) if (f.key in src) features[f.key] = Boolean(src[f.key]);
  const limits: Record<string, number> = {};
  const lsrc = input.limits || existing?.limits || {};
  for (const l of LIMITS) {
    const n = Number(lsrc[l.key]);
    if (lsrc[l.key] !== undefined && lsrc[l.key] !== null && Number.isFinite(n) && n >= 0) limits[l.key] = Math.floor(n);
  }
  const now = new Date().toISOString();
  const plan: PlanDoc = {
    id,
    name: String(input.name ?? existing?.name ?? id).trim().slice(0, 60) || id,
    priceMonthly: Math.max(0, Number(input.priceMonthly ?? existing?.priceMonthly ?? 0) || 0),
    currency: String(input.currency ?? existing?.currency ?? 'USD').toUpperCase().slice(0, 3),
    ...(input.stripePriceId !== undefined ? { stripePriceId: String(input.stripePriceId).trim() } : existing?.stripePriceId ? { stripePriceId: existing.stripePriceId } : {}),
    features,
    limits,
    sortOrder: Number(input.sortOrder ?? existing?.sortOrder ?? 99),
    active: input.active ?? existing?.active ?? true,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await setDoc(doc(db, 'plans', id), JSON.parse(JSON.stringify(plan)), { merge: false });
  invalidateEntitlements();
  return plan;
}

/** Pure merge, exported for tests. */
export function computeEntitlements(
  plan: PlanDoc | undefined,
  tenant: { planId?: string; overrides?: { features?: Record<string, boolean>; limits?: Record<string, number> }; limits?: Record<string, number> } | undefined
): Entitlements {
  const features: Record<string, boolean> = {};
  for (const f of FEATURES) {
    let v = f.defaultEnabled;
    if (plan && f.key in plan.features) v = Boolean(plan.features[f.key]);
    const o = tenant?.overrides?.features;
    if (o && f.key in o) v = Boolean(o[f.key]);
    features[f.key] = v;
  }
  const limits: Record<string, number> = {};
  for (const l of LIMITS) {
    let v = l.fallback;
    const own = Number(tenant?.limits?.[l.key]);
    if (Number.isFinite(own) && tenant?.limits?.[l.key] !== undefined) v = own;
    const pl = plan?.limits?.[l.key];
    if (pl !== undefined) v = pl;
    const ol = tenant?.overrides?.limits?.[l.key];
    if (ol !== undefined) v = ol;
    limits[l.key] = v;
  }
  return { planId: plan?.id || tenant?.planId || LEGACY_PLAN_ID, planName: plan?.name || 'Legacy', features, limits };
}

export async function getEntitlements(tenantId: string): Promise<Entitlements> {
  const cached = entCache.get(tenantId);
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  let value: Entitlements;
  if (!isFirebaseConfigured || !db || !tenantId) {
    value = computeEntitlements(SEED_PLANS[0], undefined);
  } else {
    const tSnap = await getDoc(globalTenantDoc(tenantId));
    const tenant = tSnap.exists() ? (tSnap.data() as any) : undefined;
    const plans = await listPlans();
    const wanted = tenant?.planId || LEGACY_PLAN_ID;
    // An unknown plan id must never lock a workspace out: fall back to legacy.
    const plan = plans.find((p) => p.id === wanted) || plans.find((p) => p.id === LEGACY_PLAN_ID) || SEED_PLANS[0];
    value = computeEntitlements(plan, tenant);
  }
  entCache.set(tenantId, { at: Date.now(), value });
  return value;
}

export async function hasFeature(tenantId: string, feature: string): Promise<boolean> {
  try {
    return (await getEntitlements(tenantId)).features[feature] !== false;
  } catch {
    // Failing closed would lock paying customers out on a read error; fail open and log.
    console.warn(`[Entitlements] lookup failed for ${tenantId}; allowing ${feature}`);
    return true;
  }
}

export async function requireFeature(tenantId: string, feature: string): Promise<void> {
  if (!(await hasFeature(tenantId, feature))) throw new EntitlementError(feature);
}

export async function getEffectiveLimits(tenantId: string): Promise<Record<string, number>> {
  return (await getEntitlements(tenantId)).limits;
}

/** URL -> feature, so every gated API route is protected in one place. */
export function featureForUrl(url: string): string | null {
  if (/^\/api\/auto-followup\/(toggle|dashboard|config|trigger-now)$/.test(url)) return 'auto_followup';
  if (/^\/api\/campaigns\/(cron|process-active)$/.test(url)) return null; // cron entry points are gated per workspace in the worker
  if (url === '/api/campaigns' || url.startsWith('/api/campaigns/') || url === '/api/campaign-templates' || url === '/api/templates') return 'campaigns';
  if (/^\/api\/calendar\/(availability|book|bookings|cancel|reschedule|schedule-turn)$/.test(url)) return 'scheduling';
  if (url === '/api/knowledge' || url.startsWith('/api/knowledge/')) return 'knowledge_base';
  if (/^\/api\/tenants\/[^/]+\/email(\/.*)?$/.test(url)) return 'custom_domain';
  return null;
}
