import React, { useEffect, useState } from 'react';
import {
  Building2, Globe, Save, Loader2, CheckCircle2, AlertTriangle,
  ExternalLink, X, Image as ImageIcon,
} from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import type { TenantBrand } from '../shared/brand';
import { CompanyAssetsPanel } from './CompanyAssetsPanel';
import type { CompanyAsset } from '../types';

const inputCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 disabled:bg-slate-50 disabled:text-slate-500';
const labelCls = 'block text-xs font-semibold text-slate-600 mb-1';

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block min-w-0">
    <span className={labelCls}>{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
  </label>
);

export const BrandSettingsPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const { brand, setBrand } = useBrand();
  const [draft, setDraft] = useState<TenantBrand>(brand);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [showAssets, setShowAssets] = useState(false);

  useEffect(() => setDraft(brand), [brand]);

  useEffect(() => {
    let active = true;
    const load = async () => {
      setLoading(true);
      setError(null);
      try {
        const response = await fetch('/api/tenants/' + encodeURIComponent(tenantId) + '/company-profile');
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load company profile.');
        if (!active) return;
        if (data.brand) setDraft(data.brand);
      } catch (loadError: any) {
        if (active) setError(loadError && loadError.message ? loadError.message : 'Could not load company profile.');
      } finally {
        if (active) setLoading(false);
      }
    };
    if (tenantId) void load();
    return () => { active = false; };
  }, [tenantId]);

  const set = <K extends keyof TenantBrand>(key: K, value: TenantBrand[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
  };

  const text = (key: keyof TenantBrand, label: string, placeholder = '', hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        className={inputCls}
        disabled={!canEdit || busy}
        placeholder={placeholder}
        value={String(draft[key] || '')}
        onChange={(event) => set(key, event.target.value as any)}
      />
    </Field>
  );

  const save = async () => {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const response = await fetch('/api/tenants/' + encodeURIComponent(tenantId) + '/company-profile/save', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: draft }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data.error || 'Could not save company profile.');
      setBrand(data.brand);
      setDraft(data.brand);
      setNotice('Company profile saved successfully.');
    } catch (saveError: any) {
      setError(saveError && saveError.message ? saveError.message : 'Could not save company profile.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="max-w-5xl mx-auto space-y-5 pb-8">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2 text-orange-600"><Building2 className="w-5 h-5" /><span className="text-[10px] font-bold uppercase tracking-[0.18em]">Workspace setup</span></div>
          <h1 className="text-2xl font-extrabold text-slate-900 mt-1">Company Profile</h1>
          <p className="text-sm text-slate-500 mt-1 max-w-2xl">Save your company's essential contact and identity details. Product information, services, FAQs and policies are managed in the existing Knowledge Base.</p>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 rounded-xl border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700"><AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}
      {notice && <div className="flex items-start gap-2 rounded-xl border border-emerald-100 bg-emerald-50 px-4 py-3 text-sm text-emerald-800"><CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" />{notice}</div>}

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-5 shadow-sm">
        <div className="flex items-center gap-2"><Globe className="w-4 h-4 text-orange-600" /><h2 className="text-sm font-bold text-slate-900">Company website</h2></div>
        <Field label="Website URL" hint="Your public website address, used as a reference when company-specific online research is needed.">
          <input
            className={inputCls}
            disabled={!canEdit || busy || loading}
            type="url"
            placeholder="https://www.yourcompany.com"
            value={draft.websiteUrl || ''}
            onChange={(event) => set('websiteUrl', event.target.value)}
          />
        </Field>
      </div>

      <div className="bg-white border border-slate-200 rounded-2xl p-5 sm:p-6 space-y-4 shadow-sm">
        <div className="flex items-center gap-2"><Building2 className="w-4 h-4 text-orange-600" /><h2 className="text-sm font-bold text-slate-900">Company details</h2></div>
        {loading ? <div className="py-8 text-sm text-slate-400 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" />Loading company profile…</div> : <>
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {text('companyName', 'Company name', 'Your company')}
            {text('tagline', 'Tagline / short description', 'What your company does')}
            {text('industryDescription', 'Industry and target audience', 'Industry; target customers')}
            {text('defaultProduct', 'Main product / service', 'Primary product or service')}
            {text('salesEmail', 'Business contact email', 'hello@company.com')}
            {text('supportPhone', 'Business phone / WhatsApp', '+91 …')}
            <div className="md:col-span-2 grid grid-cols-1 sm:grid-cols-[1fr_auto] gap-2 items-end">
              {text('logoUrl', 'Company logo URL', 'https://…/logo.png', 'You can also select an image from your existing Company Assets.')}
              {canEdit && <button type="button" onClick={() => setShowAssets(true)} disabled={busy || loading} className="inline-flex items-center gap-2 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-700 hover:border-orange-300 disabled:opacity-50"><ImageIcon className="w-4 h-4" />Choose asset</button>}
            </div>
          </div>
          <Field label="Company description" hint="A short overview of what the company does. Keep detailed product information, pricing, FAQs and policies in Knowledge Base.">
            <textarea
              className={inputCls + ' min-h-[100px] resize-y'}
              disabled={!canEdit || busy}
              value={draft.companyDescription || ''}
              onChange={(event) => set('companyDescription', event.target.value)}
              placeholder="A short overview of your company."
            />
          </Field>
        </>}
      </div>

      {canEdit && <div className="flex flex-col sm:flex-row items-center justify-between gap-3">
        <div className="text-[11px] text-slate-400">Only these company profile details are saved here. Your Knowledge Base remains the source for products, services and business policies.</div>
        <button type="button" onClick={save} disabled={busy || loading} className="inline-flex items-center gap-2 rounded-xl bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-bold px-5 py-3 shadow-sm">
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />} Save company profile
        </button>
      </div>}

      {draft.websiteUrl && <a href={draft.websiteUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-1 text-[11px] text-slate-400 hover:text-orange-700"><ExternalLink className="w-3 h-3" />Open company website</a>}

      {showAssets && <div className="fixed inset-0 z-[95] bg-slate-950/50 flex items-center justify-center p-3">
        <div className="w-full max-w-5xl max-h-[90vh] overflow-y-auto rounded-2xl bg-white shadow-2xl">
          <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-3">
            <div className="text-sm font-bold text-slate-900">Choose from Company Assets</div>
            <button type="button" onClick={() => setShowAssets(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100"><X className="w-4 h-4" /></button>
          </div>
          <div className="p-4"><CompanyAssetsPanel isDrawerMode onSelectAsset={(asset: CompanyAsset) => { set('logoUrl', asset.url); setShowAssets(false); }} /></div>
        </div>
      </div>}
    </div>
  );
};
