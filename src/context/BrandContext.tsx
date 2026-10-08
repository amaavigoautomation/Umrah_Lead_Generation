import React, { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { defaultBrandFor, mergeBrand, type TenantBrand } from '../shared/brand';
import { applyBrandLabels } from '../shared/brandLabels';

/** Non-React code (plain services) reads the active workspace brand from here. */
let currentBrand: TenantBrand = defaultBrandFor('');
export const getCurrentBrand = (): TenantBrand => currentBrand;

interface BrandCtx {
  tenantId: string;
  brand: TenantBrand;
  refresh: () => Promise<void>;
  setBrand: (b: TenantBrand) => void;
}

const Ctx = createContext<BrandCtx>({ tenantId: '', brand: currentBrand, refresh: async () => {}, setBrand: () => {} });

export const BrandProvider: React.FC<{ tenantId: string; tenantName?: string; children: React.ReactNode }> = ({ tenantId, tenantName, children }) => {
  const base = useMemo(() => defaultBrandFor(tenantId, tenantName), [tenantId, tenantName]);
  const [brand, setBrandState] = useState<TenantBrand>(base);

  const setBrand = useCallback((b: TenantBrand) => {
    currentBrand = b;
    applyBrandLabels(b);
    setBrandState(b);
  }, []);

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/brand`);
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      setBrand(mergeBrand(base, data?.brand));
    } catch {
      setBrand(base);
    }
  }, [tenantId, base, setBrand]);

  useEffect(() => {
    setBrand(base);
    void refresh();
  }, [base, refresh, setBrand]);

  useEffect(() => {
    try {
      document.title = `${brand.companyName || 'Lead Platform'} – AI Lead & Engagement Platform`;
    } catch {}
  }, [brand.companyName]);

  const value = useMemo(() => ({ tenantId, brand, refresh, setBrand }), [tenantId, brand, refresh, setBrand]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
};

export const useBrand = (): BrandCtx => useContext(Ctx);
