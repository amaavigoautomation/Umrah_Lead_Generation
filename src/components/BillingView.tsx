import React, { useCallback, useEffect, useState } from 'react';
import { CreditCard, CheckCircle2, AlertTriangle, Loader2, LogOut, ExternalLink } from 'lucide-react';
import { FEATURES, LIMITS } from '../shared/features';
import { AI_USAGE_FEATURES, type AiFeatureUsageTotals } from '../shared/aiUsageFeatures';

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
interface TenantUsageState {
  usage: { aiInputTokens?: number; aiOutputTokens?: number; aiTotalTokens?: number; aiCostUsd?: number; aiUnpricedRequestCount?: number; aiModelCostUsd?: number; aiModelUnpricedRequestCount?: number; aiFeatureUsage?: Record<string, AiFeatureUsageTotals>; coldEmailCount?: number; solicitedEmailCount?: number };
  costRepricing?: { processed: number; pending: boolean };
  limits: { monthlyAiTokens: number; dailyOutboundSends: number };
  dailyUsage?: { emailSentCount?: number };
  percentages?: { aiTokens?: number; dailySends?: number };
  periodUsage?: {
    from: string; to: string; timezone: string;
    emailSentCount: number; coldEmailCount: number; solicitedEmailCount: number;
    aiInputTokens: number; aiOutputTokens: number; aiTotalTokens: number; aiRequestCount: number;
    aiCostUsd: number; aiUnpricedRequestCount: number; aiModelCostUsd: number; aiModelUnpricedRequestCount: number; aiFeatureUsage?: Record<string, AiFeatureUsageTotals>;
    days: Array<{
      day: string; emailSentCount: number; coldEmailCount: number; solicitedEmailCount: number;
      aiInputTokens: number; aiOutputTokens: number; aiTotalTokens: number; aiRequestCount: number;
      aiCostUsd: number; aiUnpricedRequestCount: number; aiModelCostUsd: number; aiModelUnpricedRequestCount: number; aiFeatureUsage?: Record<string, AiFeatureUsageTotals>;
    }>;
  };
}

const currentUtcDateKey = () => new Date().toISOString().slice(0, 10);
const currentUtcMonthStartKey = () => new Date().toISOString().slice(0, 8) + '01';

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

export const BillingView: React.FC<{ fullScreen?: boolean; onLogout?: () => void; email?: string; tenantId?: string }> = ({ fullScreen, onLogout, email, tenantId }) => {
  const [state, setState] = useState<BillingState | null>(null);
  const [usageState, setUsageState] = useState<TenantUsageState | null>(null);
  const [usageError, setUsageError] = useState<string | null>(null);
  const [dateFrom, setDateFrom] = useState(currentUtcMonthStartKey);
  const [dateTo, setDateTo] = useState(currentUtcDateKey);
  const [appliedDateRange, setAppliedDateRange] = useState(() => ({ from: currentUtcMonthStartKey(), to: currentUtcDateKey() }));
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
  const loadUsage = useCallback(async () => {
    if (!tenantId) return;
    try {
      const params = new URLSearchParams({ from: appliedDateRange.from, to: appliedDateRange.to });
      setUsageState(await api<TenantUsageState>(`/api/tenants/${encodeURIComponent(tenantId)}/usage?${params.toString()}`));
      setUsageError(null);
    } catch (e: any) {
      setUsageError(e.message || 'Could not load workspace usage.');
    }
  }, [tenantId, appliedDateRange]);

  useEffect(() => {
    load();
    loadUsage();
    const refresh = window.setInterval(loadUsage, 60_000);
    return () => window.clearInterval(refresh);
  }, [load, loadUsage]);

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
  const isCurrentMonthRange = appliedDateRange.from === currentUtcMonthStartKey() && appliedDateRange.to === currentUtcDateKey();
  const selectedEmails = isCurrentMonthRange
    ? (usageState?.usage?.coldEmailCount || 0) + (usageState?.usage?.solicitedEmailCount || 0)
    : usageState?.periodUsage?.emailSentCount || 0;
  const selectedTokens = isCurrentMonthRange
    ? usageState?.usage?.aiTotalTokens || 0
    : usageState?.periodUsage?.aiTotalTokens || 0;
  const selectedInputTokens = isCurrentMonthRange
    ? usageState?.usage?.aiInputTokens || 0
    : usageState?.periodUsage?.aiInputTokens || 0;
  const selectedOutputTokens = isCurrentMonthRange
    ? usageState?.usage?.aiOutputTokens || 0
    : usageState?.periodUsage?.aiOutputTokens || 0;
  const selectedCostUsd = isCurrentMonthRange
    ? usageState?.usage?.aiModelCostUsd || 0
    : usageState?.periodUsage?.aiModelCostUsd || 0;
  const selectedUnpricedRequests = isCurrentMonthRange
    ? usageState?.usage?.aiModelUnpricedRequestCount || 0
    : usageState?.periodUsage?.aiModelUnpricedRequestCount || 0;
  const selectedFeatureUsage = (isCurrentMonthRange
    ? usageState?.usage?.aiFeatureUsage
    : usageState?.periodUsage?.aiFeatureUsage) || {};
  const selectedFeaturesUsed = AI_USAGE_FEATURES.filter((feature) =>
    Number(selectedFeatureUsage[feature.key]?.aiRequestCount || selectedFeatureUsage[feature.key]?.aiTotalTokens || 0) > 0
  );
  const formatUsd = (value: number) => new Intl.NumberFormat('en-US', {
    style: 'currency', currency: 'USD', minimumFractionDigits: 4, maximumFractionDigits: 6,
  }).format(value);

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

      {tenantId && (
        <div className="space-y-4">
          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <h4 className="text-sm font-bold text-slate-900">{isCurrentMonthRange ? 'Usage this month' : 'Usage for selected dates'}</h4>
                <p className="text-[11px] text-slate-500">All usage and cost totals use UTC dates. The default range is the current calendar month.</p>
              </div>
              <span className="text-[11px] text-slate-400">Maximum 93 days</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-2 items-end">
              <label className="text-xs font-medium text-slate-600">
                From
                <input type="date" value={dateFrom} max="9999-12-31" onChange={(event) => setDateFrom(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
              </label>
              <label className="text-xs font-medium text-slate-600">
                To
                <input type="date" value={dateTo} max="9999-12-31" onChange={(event) => setDateTo(event.target.value)} className="mt-1 w-full rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-800" />
              </label>
              <button
                type="button"
                disabled={!dateFrom || !dateTo || dateFrom > dateTo}
                onClick={() => setAppliedDateRange({ from: dateFrom, to: dateTo })}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
              >
                Apply filter
              </button>
            </div>
            {usageError && <p className="text-xs text-red-600">{usageError}</p>}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Emails sent</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{selectedEmails.toLocaleString('en-US')}</div>
                {isCurrentMonthRange && <div className="text-[11px] text-slate-500 mt-1">UTC today {(usageState?.dailyUsage?.emailSentCount || 0).toLocaleString('en-US')} / {(usageState?.limits?.dailyOutboundSends || 0).toLocaleString('en-US')}</div>}
                {isCurrentMonthRange && <div className="text-[11px] text-slate-400">Campaign {(usageState?.usage?.coldEmailCount || 0).toLocaleString('en-US')} · Other {(usageState?.usage?.solicitedEmailCount || 0).toLocaleString('en-US')}</div>}
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs text-slate-500">AI tokens consumed</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{selectedTokens.toLocaleString('en-US')}</div>
                {isCurrentMonthRange && <div className="text-[11px] text-slate-500 mt-1">of {(usageState?.limits?.monthlyAiTokens || 0).toLocaleString('en-US')} monthly tokens</div>}
                <div className="text-[11px] text-slate-400">Input {selectedInputTokens.toLocaleString('en-US')} · Output {selectedOutputTokens.toLocaleString('en-US')}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 p-3">
                <div className="text-xs text-slate-500">Estimated AI cost</div>
                <div className="text-xl font-bold text-slate-900 mt-1">{formatUsd(selectedCostUsd)}</div>
                <div className="text-[11px] text-slate-400 mt-1">USD · text, reasoning and image usage</div>
              </div>
            </div>
            {usageState?.costRepricing?.pending && (
              <p className="text-[11px] text-sky-700">Recalculating historical model and image costs. This summary will update automatically as stored usage events are re-priced.</p>
            )}
            {selectedUnpricedRequests > 0 && (
              <p className="text-[11px] text-amber-700">Cost is incomplete for {selectedUnpricedRequests.toLocaleString('en-US')} AI request(s) because usage details or an official model rate were unavailable. Their tokens remain included.</p>
            )}
            <p className="text-[11px] text-slate-400">Includes provider-reported text, reasoning, image input and generated image output tokens where available. This is an estimate, not a provider invoice.</p>
          </section>

          <section className="rounded-xl border border-slate-200 bg-white p-4 space-y-3">
            <div className="flex items-center justify-between gap-2">
              <h4 className="text-sm font-bold text-slate-900">AI usage by feature</h4>
              <span className="text-[11px] text-slate-400">{isCurrentMonthRange ? 'Current UTC month' : `${appliedDateRange.from} to ${appliedDateRange.to} UTC`}</span>
            </div>
            <p className="text-xs text-slate-500">Estimated tokens and model-priced cost, including AI-generated images, grouped by feature.</p>
            {selectedFeaturesUsed.length > 0 ? (
              <div className="overflow-x-auto rounded-lg border border-slate-200">
                <table className="w-full text-sm min-w-[440px]">
                  <thead className="bg-slate-50 text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Feature</th>
                      <th className="px-3 py-2 text-right font-semibold">AI tokens</th>
                      <th className="px-3 py-2 text-right font-semibold">Estimated cost</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {selectedFeaturesUsed.map((feature) => (
                      <tr key={feature.key}>
                        <td className="px-3 py-2 text-slate-700">{feature.label}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900">{Number(selectedFeatureUsage[feature.key]?.aiTotalTokens || 0).toLocaleString('en-US')}</td>
                        <td className="px-3 py-2 text-right text-slate-700">{formatUsd(Number(selectedFeatureUsage[feature.key]?.aiCostUsd || 0))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <p className="text-xs text-slate-400">Feature-level AI usage will appear here as new AI requests are recorded.</p>
            )}
          </section>
        </div>
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
