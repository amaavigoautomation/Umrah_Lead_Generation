import React, { useEffect, useState } from 'react';
import { Palette, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import type { TenantBrand } from '../shared/brand';
import { DAY_NAMES, brandWorkingWindowLabel } from '../shared/brand';

const inputCls =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500';

const Field: React.FC<{ label: string; hint?: string; children: React.ReactNode }> = ({ label, hint, children }) => (
  <label className="block">
    <span className="block text-xs font-semibold text-slate-600 mb-1">{label}</span>
    {children}
    {hint && <span className="block text-[11px] text-slate-400 mt-1">{hint}</span>}
  </label>
);

export const BrandSettingsPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const { brand, setBrand } = useBrand();
  const [draft, setDraft] = useState<TenantBrand>(brand);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => setDraft(brand), [brand]);

  const set = <K extends keyof TenantBrand>(k: K, v: TenantBrand[K]) => setDraft((d) => ({ ...d, [k]: v }));
  const text = (k: keyof TenantBrand, label: string, placeholder = '', hint?: string) => (
    <Field label={label} hint={hint}>
      <input
        className={inputCls}
        disabled={!canEdit}
        placeholder={placeholder}
        value={String(draft[k] ?? '')}
        onChange={(e) => set(k, e.target.value as any)}
      />
    </Field>
  );

  const toggleDay = (n: number) =>
    set('workingDays', draft.workingDays.includes(n) ? draft.workingDays.filter((d) => d !== n) : [...draft.workingDays, n].sort());

  const save = async () => {
    setBusy(true);
    setError(null);
    setSaved(false);
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/brand`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ brand: draft }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      setBrand(data.brand);
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (e: any) {
      setError(e?.message || 'Could not save');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-white border border-slate-200 rounded-xl p-5 space-y-4">
      <div className="flex items-center gap-2">
        <Palette className="w-5 h-5 text-orange-600" />
        <h3 className="text-base font-bold text-slate-900">Company brand &amp; messaging</h3>
      </div>
      <p className="text-xs text-slate-500">
        Everything customers see — AI replies, email sign-offs, thank-you emails, demo invites and times — uses these details.
      </p>

      <div className="grid sm:grid-cols-2 gap-4">
        {text('companyName', 'Company name', 'Acme Travel')}
        {text('teamName', 'Sign-off team name', 'Acme Team', 'Used as "Regards, <team>"')}
        {text('senderName', 'Email sender name', 'Acme Travel')}
        {text('aiAgentName', 'AI agent name in inbox', 'Acme AI')}
        {text('websiteUrl', 'Website', 'https://acme.com')}
        {text('salesEmail', 'Sales / contact email', 'sales@acme.com')}
        {text('supportPhone', 'Phone / WhatsApp for hand-offs', '+1 555 000 0000')}
        {text('logoUrl', 'Logo URL', 'https://…/logo.png', 'Leave empty to show your company name as text')}
        {text('defaultProduct', 'Default product / service', 'Acme Booking Platform')}
        {text('tagline', 'One-line description', 'the booking platform for …', 'Used in AI prompts: "<company>, <description>"')}
      </div>
      <Field label="Who are your customers?" hint={'Helps the AI write relevant replies, e.g. "independent tour operators"'}>
        <input className={inputCls} disabled={!canEdit} value={draft.industryDescription} onChange={(e) => set('industryDescription', e.target.value)} />
      </Field>

      <div className="border-t border-slate-100 pt-4 space-y-3">
        <h4 className="text-sm font-bold text-slate-800">Demo scheduling hours</h4>
        <div className="grid sm:grid-cols-3 gap-4">
          {text('timezone', 'Timezone (IANA)', 'Asia/Kolkata')}
          {text('timezoneLabel', 'Timezone label shown to customers', 'IST')}
          {text('calendarEmail', 'Calendar email for demo invites', 'you@company.com')}
          <Field label="Start hour (0-23)">
            <input type="number" min={0} max={23} className={inputCls} disabled={!canEdit} value={draft.workingHoursStart} onChange={(e) => set('workingHoursStart', Number(e.target.value))} />
          </Field>
          <Field label="End hour (1-24)">
            <input type="number" min={1} max={24} className={inputCls} disabled={!canEdit} value={draft.workingHoursEnd} onChange={(e) => set('workingHoursEnd', Number(e.target.value))} />
          </Field>
        </div>
        <div className="flex flex-wrap gap-2">
          {DAY_NAMES.map((d, i) => (
            <button
              key={d}
              type="button"
              disabled={!canEdit}
              onClick={() => toggleDay(i)}
              className={`px-3 py-1 rounded-full text-xs font-semibold border ${draft.workingDays.includes(i) ? 'bg-orange-600 text-white border-orange-600' : 'bg-white text-slate-600 border-slate-200'}`}
            >
              {d.slice(0, 3)}
            </button>
          ))}
        </div>
        <p className="text-xs text-slate-500">Customers will see: {brandWorkingWindowLabel(draft)}</p>
      </div>

      {error && (
        <div className="flex items-center gap-2 text-sm text-red-600">
          <AlertTriangle className="w-4 h-4" /> {error}
        </div>
      )}
      {canEdit && (
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2"
        >
          {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : saved ? <CheckCircle2 className="w-4 h-4" /> : null}
          {saved ? 'Saved' : 'Save brand settings'}
        </button>
      )}
    </div>
  );
};
