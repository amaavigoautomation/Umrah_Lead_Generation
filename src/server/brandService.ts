import { getDoc, setDoc } from './adminFirestore.js';
import { tenantRepo, globalTenantDoc } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { defaultBrandFor, mergeBrand, type TenantBrand } from '../shared/brand.js';
import type { TenantContext } from '../types/tenant.js';

const TTL_MS = 60_000;
const cache = new Map<string, { brand: TenantBrand; at: number }>();

const ctxFor = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: 'system@brand', role: 'admin' } as TenantContext);

/** Sync accessor: whatever is cached, else neutral defaults. Prefer `await getTenantBrand()` at entry points. */
export function getBrandSync(tenantId: string): TenantBrand {
  return cache.get(tenantId)?.brand || defaultBrandFor(tenantId);
}

export function invalidateTenantBrand(tenantId: string) {
  cache.delete(tenantId);
}

export async function getTenantBrand(tenantId: string): Promise<TenantBrand> {
  const hit = cache.get(tenantId);
  if (hit && Date.now() - hit.at < TTL_MS) return hit.brand;
  let base = defaultBrandFor(tenantId);
  let stored: Partial<TenantBrand> | null = null;
  if (isFirebaseConfigured) {
    try {
      const t = await getDoc(globalTenantDoc(tenantId));
      if (t.exists()) {
        const td: any = t.data();
        base = defaultBrandFor(tenantId, td?.name, { timezone: td?.timezone, contactEmail: td?.contactEmail });
      }
    } catch {}
    try {
      const s = await getDoc(tenantRepo(ctxFor(tenantId)).settingsDoc('brand'));
      if (s.exists()) stored = s.data() as Partial<TenantBrand>;
    } catch {}
  }
  const brand = mergeBrand(base, stored);
  cache.set(tenantId, { brand, at: Date.now() });
  return brand;
}

export async function saveTenantBrand(tenantId: string, patch: Partial<TenantBrand>): Promise<TenantBrand> {
  const current = await getTenantBrand(tenantId);
  const next = mergeBrand(current, patch);
  if (isFirebaseConfigured) {
    await setDoc(tenantRepo(ctxFor(tenantId)).settingsDoc('brand'), JSON.parse(JSON.stringify(next)), { merge: true });
  }
  cache.set(tenantId, { brand: next, at: Date.now() });
  return next;
}
