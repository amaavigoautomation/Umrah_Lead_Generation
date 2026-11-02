import React, { useEffect, useState } from 'react';
import { Palette, Loader2, CheckCircle2, AlertTriangle } from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import type { TenantBrand } from '../shared/brand';
import { DAY_NAMES, brandWorkingWindowLabel, fmtHour, workingHoursForDay } from '../shared/brand';

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

  const updateDayHours = (day: number, field: 'start' | 'end', value: number) => {
    const current = workingHoursForDay(draft, day);
    set('workingHoursByDay', {
      ...draft.workingHoursByDay,
      [day]: { ...current, [field]: value },
    });
  };

  const save = async () => {
    if (!Number.isInteger(draft.demoDurationMinutes) || draft.demoDurationMinutes < 5 || draft.demoDurationMinutes > 240) {
      setError('Demo duration must be a whole number between 5 and 240 minutes.');
      return;
    }
    if (draft.workingDays.length === 0) {
      setError('Enable at least one day for demo bookings.');
      return;
    }
    for (const day of draft.workingDays) {
      const hours = workingHoursForDay(draft, day);
      if (hours.start < 0 || hours.start > 23 || hours.end < 1 || hours.end > 24 || hours.start >= hours.end) {
        setError(`Please choose a valid start and end time for ${DAY_NAMES[day]}.`);
        return;
      }
    }
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
        <h4 className="text-sm font-bold text-slate-800">Demo booking availability</h4>
        <p className="text-xs text-slate-500">
          Choose the session length first. Start times then repeat at that interval, and a full session must fit inside each day's working window.
        </p>
        <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Field label="Demo duration (minutes)" hint="Examples: 20, 30, 45 or 60. Slots repeat at this interval.">
            <input type="number" min={5} max={240} step={1} className={inputCls} disabled={!canEdit}
              value={draft.demoDurationMinutes}
              onChange={(e) => set('demoDurationMinutes', Number(e.target.value))}
            />
          </Field>
          {text('timezone', 'Timezone (IANA)', 'Asia/Kolkata')}
          {text('timezoneLabel', 'Timezone label shown to customers', 'IST')}
          {text('calendarEmail', 'Calendar email for demo invites', 'you@company.com')}
        </div>
        <div className="space-y-2">
          {DAY_NAMES.map((day, dayIndex) => {
            const enabled = draft.workingDays.includes(dayIndex);
            const hours = workingHoursForDay(draft, dayIndex);
            return (
              <div key={day} className="grid grid-cols-1 sm:grid-cols-[minmax(130px,1fr)_1fr_1fr] gap-3 items-center rounded-lg border border-slate-100 p-3">
                <label className="flex items-center gap-2 text-sm font-semibold text-slate-700">
                  <input
                    type="checkbox"
                    disabled={!canEdit}
                    checked={enabled}
                    onChange={() => toggleDay(dayIndex)}
                    className="h-4 w-4 accent-orange-600"
                  />
                  {day}
                  {!enabled && <span className="text-xs font-normal text-slate-400">Closed</span>}
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-500">Start time</span>
                  <select
                    className={inputCls}
                    disabled={!canEdit || !enabled}
                    value={hours.start}
                    onChange={(e) => updateDayHours(dayIndex, 'start', Number(e.target.value))}
                  >
                    {Array.from({ length: 24 }, (_, hour) => (
                      <option key={hour} value={hour}>{fmtHour(hour)}</option>
                    ))}
                  </select>
                </label>
                <label className="block">
                  <span className="mb-1 block text-[11px] font-semibold text-slate-500">End time</span>
                  <select
                    className={inputCls}
                    disabled={!canEdit || !enabled}
                    value={hours.end}
                    onChange={(e) => updateDayHours(dayIndex, 'end', Number(e.target.value))}
                  >
                    {Array.from({ length: 24 }, (_, index) => index + 1).map((hour) => (
                      <option key={hour} value={hour}>{hour === 24 ? '12:00 AM (midnight)' : fmtHour(hour)}</option>
                    ))}
                  </select>
                </label>
              </div>
            );
          })}
        </div>
        <p className="text-xs text-slate-500">
          Customers will see: {brandWorkingWindowLabel(draft)}. Each demo is {draft.demoDurationMinutes} minutes; start times repeat every {draft.demoDurationMinutes} minutes.
        </p>
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
