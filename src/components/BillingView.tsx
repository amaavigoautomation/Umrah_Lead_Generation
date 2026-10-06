import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, AlertTriangle, Loader2, LogOut, ExternalLink } from 'lucide-react';
import { FEATURES, LIMITS } from '../shared/features';

interface BillingPlan {
  id: string;
  name: string;
  priceMonthly: number;
  currency: string;
  features: Record<string, boolean>;
  limits: Record<string, number>;
  purchasable: boolean;
}
interface BillingState {
  billing: { status: string; locked: boolean; planSource: string; currentPeriodEnd?: string; graceEndsAt?: string };
  planId: string;
  planName: string;
  hasCustomer: boolean;
  stripeConfigured: boolean;
  plans: BillingPlan[];
}

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

const STATUS_TEXT: Record<string, { text: string; cls: string }> = {
  awaiting_plan: { text: 'Choose a plan to get started', cls: 'bg-amber-50 text-amber-800 border-amber-200' },
  past_due: { text: 'Your last payment failed. Update your card to keep access.', cls: 'bg-red-50 text-red-800 border-red-200' },
  canceled: { text: 'Your subscription has ended. Choose a plan to continue.', cls: 'bg-slate-100 text-slate-700 border-slate-200' },
  active: { text: 'Your subscription is active.', cls: 'bg-emerald-50 text-emerald-800 border-emerald-200' },
  trialing: { text: 'You are on a trial.', cls: 'bg-sky-50 text-sky-800 border-sky-200' },
  manual: { text: 'Your plan was set up by your account manager.', cls: 'bg-indigo-50 text-indigo-800 border-indigo-200' },
};

export const BillingView: React.FC<{ fullScreen?: boolean; onLogout?: () => void; email?: string }> = ({ fullScreen, onLogout, email }) => {
  const [state, setState] = useState<BillingState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setState(await api<BillingState>('/api/billing'));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const go = async (key: string, path: string, body?: any) => {
    setBusy(key);
    setError(null);
    try {
      const { url } = await api<{ url: string }>(path, { method: 'POST', body: JSON.stringify(body || {}) });
      if (url) window.location.href = url;
    } catch (e: any) {
      setError(e.message);
      setBusy(null);
    }
  };

  const status = state?.billing.status || 'active';
  const note = STATUS_TEXT[status];
  const subscribed = state?.billing.planSource === 'stripe' && ['active', 'trialing', 'past_due'].includes(status);

  const body = (
    <div className="space-y-5">
      <div className="flex items-center gap-3">
        <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
          <CreditCard className="w-5 h-5" />
        </div>
        <div>
          <h3 className="text-base font-bold text-slate-900">Plan & billing</h3>
          {state && (
            <p className="text-sm text-slate-500">
              Current plan: <span className="font-semibold text-slate-800">{state.planName}</span>
            </p>
          )}
        </div>
      </div>

      {note && (
        <div className={`flex items-center gap-2 text-sm rounded-lg border px-3 py-2 ${note.cls}`}>
          {status === 'active' || status === 'manual' || status === 'trialing' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
          {note.text}
          {state?.billing.currentPeriodEnd && status !== 'canceled' && <span className="ml-auto text-xs opacity-80">Renews {new Date(state.billing.currentPeriodEnd).toLocaleDateString()}</span>}
        </div>
      )}
      {status === 'past_due' && state?.billing.graceEndsAt && !state.billing.locked && (
        <p className="text-xs text-slate-500">Access continues until {new Date(state.billing.graceEndsAt).toLocaleDateString()}.</p>
      )}
      {error && <div className="text-sm bg-red-50 border border-red-100 text-red-700 rounded-lg px-3 py-2">{error}</div>}
      {state && !state.stripeConfigured && (
        <div className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-lg px-3 py-2">Online payments aren't enabled on this platform yet.</div>
      )}

      {state && !subscribed && state.billing.planSource !== 'manual' && (
        <div className="grid gap-3 sm:grid-cols-3">
          {state.plans.map((p) => (
            <div key={p.id} className={`rounded-xl border p-4 flex flex-col ${p.id === state.planId ? 'border-orange-300 bg-orange-50/30' : 'border-slate-200 bg-white'}`}>
              <div className="font-bold text-slate-900">{p.name}</div>
              <div className="mt-1 text-2xl font-bold text-slate-900">
                {p.currency === 'USD' ? '$' : `${p.currency} `}
                {p.priceMonthly}
                <span className="text-sm font-medium text-slate-500">/mo</span>
              </div>
              <ul className="mt-3 space-y-1 text-xs text-slate-600 flex-1">
                {FEATURES.filter((f) => p.features[f.key] ?? f.defaultEnabled).map((f) => (
                  <li key={f.key} className="flex items-center gap-1.5">
                    <CheckCircle2 className="w-3.5 h-3.5 text-emerald-500" /> {f.label}
                  </li>
                ))}
                {LIMITS.filter((l) => p.limits[l.key] !== undefined).map((l) => (
                  <li key={l.key} className="text-slate-500 pl-5">
                    {p.limits[l.key].toLocaleString('en-US')} {l.label.toLowerCase()}
                  </li>
                ))}
              </ul>
              <button
                disabled={!p.purchasable || !state.stripeConfigured || busy !== null}
                onClick={() => go(p.id, '/api/billing/checkout', { planId: p.id })}
                className="mt-4 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-40 text-white text-sm font-bold flex items-center justify-center gap-2"
              >
                {busy === p.id && <Loader2 className="w-4 h-4 animate-spin" />}
                {p.purchasable ? 'Choose plan' : 'Not available yet'}
              </button>
            </div>
          ))}
        </div>
      )}

      {state?.hasCustomer && (
        <button
          disabled={busy !== null}
          onClick={() => go('portal', '/api/billing/portal')}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-sm font-semibold text-slate-700"
        >
          {busy === 'portal' ? <Loader2 className="w-4 h-4 animate-spin" /> : <ExternalLink className="w-4 h-4" />} Manage billing, invoices & card
        </button>
      )}
    </div>
  );

  if (!fullScreen) return <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm">{body}</div>;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-4xl mx-auto px-4 h-14 flex items-center justify-between">
          <span className="text-sm font-bold text-slate-900">Welcome</span>
          <div className="flex items-center gap-3">
            {email && <span className="hidden sm:inline text-xs text-slate-500">{email}</span>}
            {onLogout && (
              <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                <LogOut className="w-3.5 h-3.5" /> Sign out
              </button>
            )}
          </div>
        </div>
      </header>
      <main className="max-w-4xl mx-auto px-4 py-8">
        <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm">{body}</div>
      </main>
    </div>
  );
};
