import React, { useState } from 'react';
import { Plus, X, Loader2, AlertCircle, Check } from 'lucide-react';

export interface PlanRow {
  id: string;
  name: string;
  priceMonthly: number;
  currency: string;
  stripePriceId?: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  sortOrder: number;
  active: boolean;
}
export interface FeatureDefRow {
  key: string;
  label: string;
  description: string;
  defaultEnabled: boolean;
}
export interface LimitDefRow {
  key: string;
  label: string;
  unit: string;
  fallback: number;
}
export interface Catalog {
  plans: PlanRow[];
  features: FeatureDefRow[];
  limits: LimitDefRow[];
}

const inputCls =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

const money = (p: PlanRow) => (p.priceMonthly ? `${p.currency} ${p.priceMonthly}/mo` : 'Free');

export const PlansManager: React.FC<{ catalog: Catalog; onChanged: () => void }> = ({ catalog, onChanged }) => {
  const [editing, setEditing] = useState<PlanRow | null>(null);
  const [isNew, setIsNew] = useState(false);

  const startNew = () => {
    setIsNew(true);
    setEditing({
      id: '',
      name: '',
      priceMonthly: 0,
      currency: 'USD',
      features: Object.fromEntries(catalog.features.map((f) => [f.key, f.defaultEnabled])),
      limits: Object.fromEntries(catalog.limits.map((l) => [l.key, l.fallback])),
      sortOrder: catalog.plans.length + 1,
      active: true,
    });
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-slate-500">
          Decide what each plan includes. Changes apply to every workspace on the plan within about a minute — no deploy needed.
        </p>
        <button onClick={startNew} className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold shadow-sm shrink-0">
          <Plus className="w-4 h-4" /> New plan
        </button>
      </div>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {catalog.plans.map((p) => (
          <button
            key={p.id}
            onClick={() => {
              setIsNew(false);
              setEditing(p);
            }}
            className={`text-left bg-white border rounded-xl p-4 hover:border-orange-300 hover:shadow-sm transition ${p.active ? 'border-slate-200' : 'border-dashed border-slate-300 opacity-70'}`}
          >
            <div className="flex items-start justify-between">
              <div>
                <div className="font-bold text-slate-900">{p.name}</div>
                <div className="text-xs font-mono text-slate-400">{p.id}</div>
              </div>
              <div className="text-sm font-semibold text-slate-700">{money(p)}</div>
            </div>
            <div className="mt-3 flex flex-wrap gap-1.5">
              {catalog.features.map((f) => {
                const on = p.features[f.key] ?? f.defaultEnabled;
                return (
                  <span key={f.key} className={`px-2 py-0.5 rounded-full text-[11px] font-semibold ${on ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-400 line-through'}`}>
                    {f.label}
                  </span>
                );
              })}
            </div>
            <div className="mt-3 text-xs text-slate-500">
              {catalog.limits
                .filter((l) => p.limits[l.key] !== undefined)
                .map((l) => `${p.limits[l.key].toLocaleString('en-US')} ${l.label.toLowerCase()}`)
                .join(' · ') || 'Keeps each workspace’s own limits'}
            </div>
            <div className="mt-2 text-[11px] text-slate-400">
              {p.stripePriceId ? 'Stripe price linked' : 'No Stripe price yet'}
              {!p.active && ' · Hidden from customers'}
            </div>
          </button>
        ))}
      </div>

      {editing && (
        <PlanEditor
          plan={editing}
          isNew={isNew}
          catalog={catalog}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            onChanged();
          }}
        />
      )}
    </div>
  );
};

const PlanEditor: React.FC<{ plan: PlanRow; isNew: boolean; catalog: Catalog; onClose: () => void; onSaved: () => void }> = ({
  plan,
  isNew,
  catalog,
  onClose,
  onSaved,
}) => {
  const [draft, setDraft] = useState<PlanRow>({ ...plan, features: { ...plan.features }, limits: { ...plan.limits } });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const id = isNew ? draft.id.trim().toLowerCase() : draft.id;
      await api(`/api/plans/${encodeURIComponent(id)}`, { method: 'PUT', body: JSON.stringify(draft) });
      onSaved();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <form onSubmit={save} onClick={(e) => e.stopPropagation()} className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-5">
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">{isNew ? 'New plan' : `Edit ${plan.name}`}</h2>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Name</span>
            <input value={draft.name} onChange={(e) => setDraft({ ...draft, name: e.target.value })} className={`${inputCls} mt-1`} placeholder="Growth" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Id</span>
            <input value={draft.id} disabled={!isNew} onChange={(e) => setDraft({ ...draft, id: e.target.value })} className={`${inputCls} mt-1 disabled:bg-slate-50 font-mono`} placeholder="growth" />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Price per month</span>
            <input type="number" min={0} value={draft.priceMonthly} onChange={(e) => setDraft({ ...draft, priceMonthly: Number(e.target.value) })} className={`${inputCls} mt-1`} />
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Currency</span>
            <input value={draft.currency} maxLength={3} onChange={(e) => setDraft({ ...draft, currency: e.target.value.toUpperCase() })} className={`${inputCls} mt-1`} />
          </label>
        </div>

        <label className="block text-sm">
          <span className="font-semibold text-slate-700">Stripe price id</span>
          <input value={draft.stripePriceId || ''} onChange={(e) => setDraft({ ...draft, stripePriceId: e.target.value })} className={`${inputCls} mt-1 font-mono`} placeholder="price_…  (from Stripe → Products)" />
          <span className="text-xs text-slate-500">The recurring price customers pay. Without it the plan can't be bought online.</span>
        </label>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Features</h3>
          {catalog.features.map((f) => {
            const on = draft.features[f.key] ?? f.defaultEnabled;
            return (
              <label key={f.key} className="flex items-center justify-between gap-3 py-1.5 border-b border-slate-100 last:border-0 cursor-pointer">
                <span>
                  <span className="block text-sm font-semibold text-slate-800">{f.label}</span>
                  <span className="block text-xs text-slate-500">{f.description}</span>
                </span>
                <input type="checkbox" checked={on} onChange={(e) => setDraft({ ...draft, features: { ...draft.features, [f.key]: e.target.checked } })} className="w-4 h-4 accent-orange-500" />
              </label>
            );
          })}
        </section>

        <section className="space-y-2">
          <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Limits</h3>
          <div className="grid grid-cols-2 gap-3">
            {catalog.limits.map((l) => (
              <label key={l.key} className="block text-sm">
                <span className="font-semibold text-slate-700">{l.label}</span>
                <input
                  type="number"
                  min={0}
                  value={draft.limits[l.key] ?? ''}
                  placeholder="Workspace's own"
                  onChange={(e) => {
                    const limits = { ...draft.limits };
                    if (e.target.value === '') delete limits[l.key];
                    else limits[l.key] = Number(e.target.value);
                    setDraft({ ...draft, limits });
                  }}
                  className={`${inputCls} mt-1`}
                />
              </label>
            ))}
          </div>
        </section>

        <label className="flex items-center gap-2 text-sm text-slate-700 cursor-pointer">
          <input type="checkbox" checked={draft.active} onChange={(e) => setDraft({ ...draft, active: e.target.checked })} className="w-4 h-4 accent-orange-500" />
          Available to customers (uncheck to hide it from the Billing screen)
        </label>

        {err && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" /> {err}
          </div>
        )}

        <div className="flex justify-end gap-2">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button type="submit" disabled={busy || !draft.name.trim() || !draft.id.trim()} className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2">
            {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Check className="w-4 h-4" />} Save plan
          </button>
        </div>
      </form>
    </div>
  );
};
