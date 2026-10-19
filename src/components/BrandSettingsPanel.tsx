import React, { useEffect, useRef, useState } from 'react';
import { Palette, Loader2, CheckCircle2, AlertTriangle, Upload, Trash2, ImageIcon } from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import type { TenantBrand } from '../shared/brand';
import { DAY_NAMES, brandWorkingWindowLabel } from '../shared/brand';

const inputCls =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500';

// Logos are resized in the browser so any normal logo file fits the server's 512 KB limit.
const LOGO_MAX_W = 600;
const LOGO_MAX_H = 240;
async function fileToLogoDataUrl(file: File): Promise<string> {
  if (!/^image\/(png|jpe?g|webp)$/i.test(file.type)) throw new Error('Use a PNG, JPG or WebP image');
  if (file.size > 8 * 1024 * 1024) throw new Error('That image is too large (max 8 MB)');
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('Could not read that image'));
      i.src = objectUrl;
    });
    const scale = Math.min(1, LOGO_MAX_W / img.width, LOGO_MAX_H / img.height);
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = w;
    canvas.height = h;
    const c2d = canvas.getContext('2d');
    if (!c2d) throw new Error('Your browser cannot process images');
    c2d.drawImage(img, 0, 0, w, h);
    let out = canvas.toDataURL('image/png'); // keeps transparency
    if (out.length > 600_000) out = canvas.toDataURL('image/webp', 0.9);
    if (out.length > 680_000) throw new Error('That logo is too detailed. Use a simpler or smaller image.');
    return out;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}

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

  // After an upload/remove the server returns the saved brand; keep any unsaved edits in the form.
  const keepDraftRef = useRef<TenantBrand | null>(null);
  useEffect(() => {
    setDraft(keepDraftRef.current ?? brand);
    keepDraftRef.current = null;
  }, [brand]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [logoBusy, setLogoBusy] = useState(false);

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

  const sendLogo = async (method: 'POST' | 'DELETE', image?: string) => {
    setLogoBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/brand/logo`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: method === 'POST' ? JSON.stringify({ image }) : undefined,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
      keepDraftRef.current = { ...draft, logoUrl: data.brand.logoUrl };
      setBrand(data.brand);
    } catch (e: any) {
      setError(e?.message || 'Could not update the logo');
    } finally {
      setLogoBusy(false);
    }
  };

  const onPickLogo = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      await sendLogo('POST', await fileToLogoDataUrl(file));
    } catch (err: any) {
      setError(err?.message || 'Could not read that image');
    }
  };

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
        {text('defaultProduct', 'Default product / service', 'Acme Booking Platform')}
        {text('tagline', 'One-line description', 'the booking platform for …', 'Used in AI prompts: "<company>, <description>"')}
      </div>
      <div className="border border-slate-200 rounded-lg p-4 flex flex-col sm:flex-row sm:items-center gap-4">
        <div className="h-16 w-40 shrink-0 rounded-md border border-dashed border-slate-300 bg-slate-50 flex items-center justify-center overflow-hidden">
          {draft.logoUrl ? (
            <img src={draft.logoUrl} alt={`${draft.companyName || 'Company'} logo`} className="max-h-14 max-w-[9.5rem] object-contain" />
          ) : (
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <ImageIcon className="w-4 h-4" /> No logo
            </span>
          )}
        </div>
        <div className="flex-1 min-w-0">
          <div className="text-xs font-semibold text-slate-600">Company logo</div>
          <p className="text-[11px] text-slate-400 mt-0.5">PNG, JPG or WebP. Shown in the app header and on your dashboard. Without a logo, your company name is shown as text.</p>
          {canEdit && (
            <div className="flex flex-wrap gap-2 mt-2">
              <input ref={fileInputRef} type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={onPickLogo} />
              <button
                type="button"
                disabled={logoBusy}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex items-center gap-1.5 bg-white border border-slate-200 hover:border-orange-500 text-slate-700 text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
              >
                {logoBusy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5" />}
                {draft.logoUrl ? 'Replace logo' : 'Upload logo'}
              </button>
              {draft.logoUrl && (
                <button
                  type="button"
                  disabled={logoBusy}
                  onClick={() => sendLogo('DELETE')}
                  className="inline-flex items-center gap-1.5 text-red-600 hover:bg-red-50 text-xs font-semibold rounded-lg px-3 py-1.5 disabled:opacity-50"
                >
                  <Trash2 className="w-3.5 h-3.5" /> Remove
                </button>
              )}
            </div>
          )}
        </div>
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
