import React, { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Building2,
  Plus,
  Search,
  X,
  Users,
  Activity,
  Power,
  Copy,
  Check,
  LogOut,
  Loader2,
  Mail,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
} from 'lucide-react';

import { PlansManager, type Catalog } from './PlansManager';

type Plan = 'starter' | 'growth' | 'enterprise';
type Status = 'active' | 'suspended';

interface Tenant {
  id: string;
  name: string;
  status: Status;
  plan?: Plan;
  planId?: string;
  billingStatus?: string;
  planSource?: string;
  overrides?: { features?: Record<string, boolean>; limits?: Record<string, number> };
  currentPeriodEnd?: string;
  contactEmail?: string;
  timezone?: string;
  createdAt?: string;
  limits?: { monthlyAiTokens: number; dailyOutboundSends: number; hourlyOutboundSends: number; seats: number };
}

interface TenantUser {
  uid: string;
  email: string;
  name?: string;
  role: 'admin' | 'member' | string;
  active: boolean;
}

interface Usage {
  usage: { aiTotalTokens?: number; coldEmailCount?: number; solicitedEmailCount?: number; whatsappMessageCount?: number };
  limits: { monthlyAiTokens: number; dailyOutboundSends: number; seats: number };
  percentages: { aiTokens: number };
}

interface Props {
  email: string;
  onLogout: () => void;
}

// Neutral on purpose: tenants (e.g. Umrah360) must not brand the platform owner's console.
const CONSOLE_NAME = 'Platform Console';

const PLAN_LABEL: Record<Plan, string> = { starter: 'Starter', growth: 'Growth', enterprise: 'Enterprise' };
const PLAN_STYLE: Record<Plan, string> = {
  starter: 'bg-slate-100 text-slate-700',
  growth: 'bg-orange-50 text-orange-700',
  enterprise: 'bg-indigo-50 text-indigo-700',
};
const TIMEZONES = ['Asia/Kolkata', 'Asia/Riyadh', 'Asia/Dubai', 'Europe/London', 'America/New_York'];

const fmt = (n?: number) => (n ?? 0).toLocaleString('en-US');
const fmtDate = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—';

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, {
    ...init,
    headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

const inputCls =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';

export const PlatformConsole: React.FC<Props> = ({ email, onLogout }) => {
  const [tenants, setTenants] = useState<Tenant[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [showCreate, setShowCreate] = useState(false);
  const [view, setView] = useState<'workspaces' | 'plans'>('workspaces');
  const [catalog, setCatalog] = useState<Catalog>({ plans: [], features: [], limits: [] });
  const loadCatalog = useCallback(async () => {
    try {
      setCatalog(await api<Catalog>('/api/plans'));
    } catch {
      /* the Plans tab shows an empty state */
    }
  }, []);
  useEffect(() => {
    loadCatalog();
  }, [loadCatalog]);
  const planName = (t: Tenant) => catalog.plans.find((p) => p.id === t.planId)?.name || (t.planId ? t.planId : t.billingStatus ? 'No plan yet' : 'Legacy');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await api<{ tenants: Tenant[] }>('/api/tenants');
      setTenants(data.tenants || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...tenants]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .filter((t) => !q || t.name?.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) || t.contactEmail?.toLowerCase().includes(q));
  }, [tenants, search]);

  const active = tenants.filter((t) => t.status !== 'suspended').length;
  const selected = tenants.find((t) => t.id === selectedId) || null;

  const patchLocal = (id: string, patch: Partial<Tenant>) =>
    setTenants((prev) => prev.map((t) => (t.id === id ? { ...t, ...patch } : t)));

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      {/* Header */}
      <header className="bg-white border-b border-slate-200">
        <div className="max-w-6xl mx-auto px-4 sm:px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-slate-900 flex items-center justify-center">
              <ShieldCheck className="w-4.5 h-4.5 text-white" />
            </div>
            <span className="text-sm font-bold text-slate-900">{CONSOLE_NAME}</span>
          </div>
          <div className="flex items-center gap-3">
            <span className="hidden sm:inline text-xs text-slate-500">{email}</span>
            <button
              onClick={onLogout}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <LogOut className="w-3.5 h-3.5" /> Sign out
            </button>
          </div>
        </div>
      </header>

      <div className="max-w-6xl mx-auto px-4 sm:px-6 pt-5">
        <div className="inline-flex rounded-lg bg-slate-200/60 p-1 text-sm font-semibold">
          {(['workspaces', 'plans'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md capitalize ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {v}
            </button>
          ))}
        </div>
      </div>

      {view === 'plans' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <PlansManager catalog={catalog} onChanged={loadCatalog} />
        </main>
      )}

      {view === 'workspaces' && (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Stats */}
        <div className="grid grid-cols-3 gap-3">
          {[
            { label: 'Workspaces', value: tenants.length },
            { label: 'Active', value: active },
            { label: 'Suspended', value: tenants.length - active },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3">
              <div className="text-xs font-medium text-slate-500">{s.label}</div>
              <div className="text-2xl font-bold text-slate-900 mt-0.5">{s.value}</div>
            </div>
          ))}
        </div>

        {/* Toolbar */}
        <div className="flex flex-col sm:flex-row gap-3 sm:items-center sm:justify-between">
          <div className="relative sm:w-80">
            <Search className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
            <input
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              placeholder="Search workspaces"
              className={`${inputCls} pl-9`}
            />
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={load}
              className="p-2 rounded-lg border border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
              title="Refresh"
            >
              <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
            </button>
            <button
              onClick={() => setShowCreate(true)}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white text-sm font-bold shadow-sm"
            >
              <Plus className="w-4 h-4" /> New workspace
            </button>
          </div>
        </div>

        {error && (
          <div className="flex items-center gap-2 p-3 rounded-lg bg-red-50 border border-red-200 text-red-800 text-sm">
            <AlertCircle className="w-4 h-4 shrink-0" /> {error}
          </div>
        )}

        {/* List */}
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          {loading && tenants.length === 0 ? (
            <div className="p-10 flex justify-center text-slate-400">
              <Loader2 className="w-5 h-5 animate-spin" />
            </div>
          ) : filtered.length === 0 ? (
            <div className="p-10 text-center text-sm text-slate-500">
              <Building2 className="w-8 h-8 mx-auto mb-2 text-slate-300" />
              {tenants.length === 0 ? 'No workspaces yet. Create the first one.' : 'No workspaces match your search.'}
            </div>
          ) : (
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs font-semibold text-slate-500 border-b border-slate-200 bg-slate-50/60">
                  <th className="px-4 py-3">Workspace</th>
                  <th className="px-4 py-3">Plan</th>
                  <th className="px-4 py-3">Status</th>
                  <th className="px-4 py-3 hidden md:table-cell">Contact</th>
                  <th className="px-4 py-3 hidden md:table-cell">Created</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((t) => (
                  <tr
                    key={t.id}
                    onClick={() => setSelectedId(t.id)}
                    className={`border-b border-slate-100 last:border-0 cursor-pointer hover:bg-orange-50/40 ${
                      selectedId === t.id ? 'bg-orange-50/60' : ''
                    }`}
                  >
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-900">{t.name || t.id}</div>
                      <div className="text-xs text-slate-500 font-mono">{t.id}</div>
                    </td>
                    <td className="px-4 py-3">
                      <div className="font-semibold text-slate-800">{planName(t)}</div>
                      <BillingPill status={t.billingStatus} />
                    </td>
                    <td className="px-4 py-3">
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-semibold ${
                          t.status === 'suspended' ? 'text-red-600' : 'text-emerald-600'
                        }`}
                      >
                        <span className={`w-1.5 h-1.5 rounded-full ${t.status === 'suspended' ? 'bg-red-500' : 'bg-emerald-500'}`} />
                        {t.status === 'suspended' ? 'Suspended' : 'Active'}
                      </span>
                    </td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-600">{t.contactEmail || '—'}</td>
                    <td className="px-4 py-3 hidden md:table-cell text-slate-600">{fmtDate(t.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </main>
      )}

      {showCreate && (
        <CreateWorkspaceModal
          catalog={catalog}
          onClose={() => setShowCreate(false)}
          onCreated={(t) => {
            setTenants((prev) => [t, ...prev]);
            setShowCreate(false);
            setSelectedId(t.id);
          }}
        />
      )}

      {selected && (
        <WorkspacePanel
          key={selected.id}
          tenant={selected}
          catalog={catalog}
          onClose={() => setSelectedId(null)}
          onChanged={(patch) => patchLocal(selected.id, patch)}
        />
      )}
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Create workspace                                                    */
/* ------------------------------------------------------------------ */

const BILLING_LABEL: Record<string, { label: string; cls: string }> = {
  awaiting_plan: { label: 'Awaiting payment', cls: 'text-amber-600' },
  trialing: { label: 'Trial', cls: 'text-sky-600' },
  active: { label: 'Paid', cls: 'text-emerald-600' },
  past_due: { label: 'Payment failed', cls: 'text-red-600' },
  canceled: { label: 'Canceled', cls: 'text-slate-500' },
  manual: { label: 'Granted manually', cls: 'text-indigo-600' },
};
const BillingPill: React.FC<{ status?: string }> = ({ status }) => {
  const b = status ? BILLING_LABEL[status] : null;
  return <div className={`text-xs font-semibold ${b ? b.cls : 'text-slate-400'}`}>{b ? b.label : 'Existing customer'}</div>;
};

const CreateWorkspaceModal: React.FC<{ catalog: Catalog; onClose: () => void; onCreated: (t: Tenant) => void }> = ({ catalog, onClose, onCreated }) => {
  const [billing, setBilling] = useState<'stripe' | 'manual'>('stripe');
  const [planId, setPlanId] = useState('');
  const [name, setName] = useState('');
  const [contactEmail, setContactEmail] = useState('');
  const [timezone, setTimezone] = useState('Asia/Kolkata');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      const data = await api<{ tenant: Tenant }>('/api/tenants', {
        method: 'POST',
        body: JSON.stringify({ name: name.trim(), billing, planId: billing === 'manual' ? planId : undefined, contactEmail: contactEmail.trim(), timezone }),
      });
      onCreated(data.tenant);
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4" onClick={onClose}>
      <form
        onSubmit={submit}
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-white rounded-2xl shadow-xl border border-slate-200 p-6 space-y-4"
      >
        <div className="flex items-center justify-between">
          <h2 className="text-base font-bold text-slate-900">New workspace</h2>
          <button type="button" onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <label className="block text-sm">
          <span className="font-semibold text-slate-700">Company name</span>
          <input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="Al Noor Travels" className={`${inputCls} mt-1`} />
        </label>

        <div className="grid grid-cols-2 gap-3">
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Billing</span>
            <select value={billing} onChange={(e) => setBilling(e.target.value as 'stripe' | 'manual')} className={`${inputCls} mt-1`}>
              <option value="stripe">Customer pays online</option>
              <option value="manual">Grant a plan (no payment)</option>
            </select>
          </label>
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Timezone</span>
            <select value={timezone} onChange={(e) => setTimezone(e.target.value)} className={`${inputCls} mt-1`}>
              {TIMEZONES.map((z) => (
                <option key={z} value={z}>
                  {z}
                </option>
              ))}
            </select>
          </label>
        </div>

        {billing === 'manual' ? (
          <label className="block text-sm">
            <span className="font-semibold text-slate-700">Plan to grant</span>
            <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={`${inputCls} mt-1`}>
              <option value="">Choose a plan…</option>
              {catalog.plans.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <p className="text-xs text-slate-500">The workspace stays locked until its admin chooses a plan and pays on the Billing screen.</p>
        )}

        <label className="block text-sm">
          <span className="font-semibold text-slate-700">Contact email (optional)</span>
          <input type="email" value={contactEmail} onChange={(e) => setContactEmail(e.target.value)} placeholder="owner@company.com" className={`${inputCls} mt-1`} />
        </label>

        {err && (
          <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
            <AlertCircle className="w-4 h-4 shrink-0" /> {err}
          </div>
        )}

        <div className="flex justify-end gap-2 pt-1">
          <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm font-semibold text-slate-700 hover:bg-slate-50">
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy || !name.trim() || (billing === 'manual' && !planId)}
            className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold flex items-center gap-2"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />} Create
          </button>
        </div>
      </form>
    </div>
  );
};

/* ------------------------------------------------------------------ */
/* Workspace detail panel                                              */
/* ------------------------------------------------------------------ */

const WorkspacePanel: React.FC<{ tenant: Tenant; catalog: Catalog; onClose: () => void; onChanged: (patch: Partial<Tenant>) => void }> = ({
  catalog,
  tenant,
  onClose,
  onChanged,
}) => {
  const [usage, setUsage] = useState<Usage | null>(null);
  const [users, setUsers] = useState<TenantUser[]>([]);
  const [planId, setPlanId] = useState<string>(tenant.planId || '');
  const [billingStatus, setBillingStatus] = useState<string>(tenant.billingStatus || '');
  const [ovFeatures, setOvFeatures] = useState<Record<string, boolean | undefined>>({ ...(tenant.overrides?.features || {}) });
  const [ovLimits, setOvLimits] = useState<Record<string, string>>(Object.fromEntries(Object.entries(tenant.overrides?.limits || {}).map(([k, v]) => [k, String(v)])));
  const [busy, setBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member'>('admin');
  const [setupLink, setSetupLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const suspended = tenant.status === 'suspended';

  const loadDetail = useCallback(async () => {
    const [u, us] = await Promise.allSettled([
      api<Usage>(`/api/tenants/${tenant.id}/usage`),
      api<{ users: TenantUser[] }>(`/api/tenants/${tenant.id}/users`),
    ]);
    if (u.status === 'fulfilled') setUsage(u.value);
    if (us.status === 'fulfilled') setUsers(us.value.users || []);
  }, [tenant.id]);

  useEffect(() => {
    loadDetail();
  }, [loadDetail]);

  const patch = async (body: Record<string, any>, label: string, local: Partial<Tenant>) => {
    setBusy(label);
    setErr(null);
    try {
      await api(`/api/tenants/${tenant.id}`, { method: 'PATCH', body: JSON.stringify(body) });
      onChanged(local);
      if (body.planId || body.overrides) loadDetail();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const toggleStatus = () => {
    const next: Status = suspended ? 'active' : 'suspended';
    if (!suspended && !window.confirm(`Suspend ${tenant.name}? Their users will be blocked immediately.`)) return;
    patch({ status: next }, 'status', { status: next });
  };

  const invite = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inviteEmail.trim()) return;
    setBusy('invite');
    setErr(null);
    setSetupLink(null);
    try {
      const data = await api<{ setupLink: string }>(`/api/tenants/${tenant.id}/users`, {
        method: 'POST',
        body: JSON.stringify({ email: inviteEmail.trim(), role: inviteRole }),
      });
      setSetupLink(data.setupLink);
      setInviteEmail('');
      loadDetail();
    } catch (e: any) {
      setErr(e.message);
    } finally {
      setBusy(null);
    }
  };

  const copyLink = async () => {
    if (!setupLink) return;
    try {
      await navigator.clipboard.writeText(setupLink);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const aiPct = usage?.percentages?.aiTokens ?? 0;
  const emailsThisMonth = (usage?.usage?.coldEmailCount || 0) + (usage?.usage?.solicitedEmailCount || 0);

  return (
    <div className="fixed inset-0 z-40 flex justify-end bg-slate-900/30" onClick={onClose}>
      <aside
        onClick={(e) => e.stopPropagation()}
        className="w-full sm:w-[28rem] h-full bg-white border-l border-slate-200 shadow-2xl overflow-y-auto"
      >
        <div className="sticky top-0 bg-white border-b border-slate-200 px-5 py-4 flex items-start justify-between">
          <div>
            <h2 className="text-base font-bold text-slate-900">{tenant.name || tenant.id}</h2>
            <div className="text-xs text-slate-500 font-mono">{tenant.id}</div>
          </div>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-700">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-5 space-y-6">
          {err && (
            <div className="flex items-center gap-2 p-2.5 rounded-lg bg-red-50 border border-red-200 text-red-800 text-xs">
              <AlertCircle className="w-4 h-4 shrink-0" /> {err}
            </div>
          )}

          {/* Usage */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Activity className="w-3.5 h-3.5" /> Usage this month
            </h3>
            <div>
              <div className="flex justify-between text-sm mb-1">
                <span className="text-slate-700">AI tokens</span>
                <span className="font-semibold text-slate-900">
                  {fmt(usage?.usage?.aiTotalTokens)} <span className="text-slate-400 font-normal">/ {fmt(usage?.limits?.monthlyAiTokens || tenant.limits?.monthlyAiTokens)}</span>
                </span>
              </div>
              <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                <div
                  className={`h-full rounded-full ${aiPct >= 90 ? 'bg-red-500' : aiPct >= 70 ? 'bg-amber-500' : 'bg-orange-500'}`}
                  style={{ width: `${Math.min(100, aiPct)}%` }}
                />
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Emails sent</div>
                <div className="font-semibold text-slate-900">{fmt(emailsThisMonth)}</div>
                <div className="text-[11px] text-slate-400">limit {fmt(usage?.limits?.dailyOutboundSends || tenant.limits?.dailyOutboundSends)}/day</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Seats</div>
                <div className="font-semibold text-slate-900">
                  {users.length} <span className="text-slate-400 font-normal">/ {usage?.limits?.seats || tenant.limits?.seats || '—'}</span>
                </div>
              </div>
            </div>
          </section>

          {/* Plan & billing */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Plan & billing</h3>
            <div className="flex items-center justify-between text-sm">
              <span className="text-slate-600">Billing</span>
              <BillingPill status={tenant.billingStatus} />
            </div>
            {tenant.currentPeriodEnd && <div className="text-xs text-slate-500">Renews / ends {fmtDate(tenant.currentPeriodEnd)}</div>}
            <div className="flex gap-2">
              <select value={planId} onChange={(e) => setPlanId(e.target.value)} className={inputCls}>
                <option value="">{tenant.billingStatus ? 'No plan yet' : 'Legacy (all features)'}</option>
                {catalog.plans.filter((p) => p.id !== 'legacy').map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
              <button
                disabled={!planId || planId === tenant.planId || busy === 'plan'}
                onClick={() => patch({ planId }, 'plan', { planId, billingStatus: 'manual', planSource: 'manual' })}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
              >
                {busy === 'plan' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Grant'}
              </button>
            </div>
            <p className="text-xs text-slate-500">Granting a plan by hand marks the workspace as “granted manually”; Stripe events will never overwrite it.</p>
            <div className="flex gap-2">
              <select value={billingStatus} onChange={(e) => setBillingStatus(e.target.value)} className={inputCls}>
                <option value="">Existing customer (never locked)</option>
                {Object.entries(BILLING_LABEL).map(([k, v]) => (
                  <option key={k} value={k}>
                    {v.label}
                  </option>
                ))}
              </select>
              <button
                disabled={!billingStatus || billingStatus === tenant.billingStatus || busy === 'billing'}
                onClick={() => patch({ billingStatus }, 'billing', { billingStatus })}
                className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
              >
                {busy === 'billing' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Set'}
              </button>
            </div>
          </section>

          {/* Overrides */}
          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">Overrides for this workspace</h3>
            <p className="text-xs text-slate-500">Leave on “Plan default” to follow the plan. Use this for special deals.</p>
            {catalog.features.map((f) => (
              <div key={f.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-700">{f.label}</span>
                <select
                  value={ovFeatures[f.key] === undefined ? '' : ovFeatures[f.key] ? 'on' : 'off'}
                  onChange={(e) => setOvFeatures({ ...ovFeatures, [f.key]: e.target.value === '' ? undefined : e.target.value === 'on' })}
                  className="border border-slate-200 rounded-lg px-2 py-1 text-sm bg-white"
                >
                  <option value="">Plan default</option>
                  <option value="on">Always on</option>
                  <option value="off">Always off</option>
                </select>
              </div>
            ))}
            {catalog.limits.map((l) => (
              <div key={l.key} className="flex items-center justify-between gap-3 text-sm">
                <span className="text-slate-700">{l.label}</span>
                <input
                  type="number"
                  min={0}
                  placeholder="Plan default"
                  value={ovLimits[l.key] ?? ''}
                  onChange={(e) => setOvLimits({ ...ovLimits, [l.key]: e.target.value })}
                  className="w-32 border border-slate-200 rounded-lg px-2 py-1 text-sm"
                />
              </div>
            ))}
            <button
              disabled={busy === 'overrides'}
              onClick={() => {
                const features: Record<string, boolean> = {};
                Object.entries(ovFeatures).forEach(([k, v]) => {
                  if (v !== undefined) features[k] = v;
                });
                const limits: Record<string, number> = {};
                Object.entries(ovLimits).forEach(([k, v]) => {
                  if (v !== '' && Number.isFinite(Number(v))) limits[k] = Number(v);
                });
                patch({ overrides: { features, limits } }, 'overrides', { overrides: { features, limits } });
              }}
              className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-40"
            >
              {busy === 'overrides' ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Save overrides'}
            </button>
          </section>

          {/* Users */}
          <section className="space-y-3">
            <h3 className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
              <Users className="w-3.5 h-3.5" /> Users
            </h3>
            {users.length === 0 ? (
              <p className="text-sm text-slate-500">No users yet. Invite the first admin below.</p>
            ) : (
              <ul className="divide-y divide-slate-100 border border-slate-200 rounded-lg">
                {users.map((u) => (
                  <li key={u.uid} className="flex items-center justify-between px-3 py-2 text-sm">
                    <div className="min-w-0">
                      <div className="font-medium text-slate-900 truncate">{u.email}</div>
                      {u.name && <div className="text-xs text-slate-500 truncate">{u.name}</div>}
                    </div>
                    <span className="text-xs font-semibold text-slate-600 capitalize">{u.role}</span>
                  </li>
                ))}
              </ul>
            )}

            <form onSubmit={invite} className="space-y-2">
              <div className="flex gap-2">
                <div className="relative flex-1">
                  <Mail className="w-4 h-4 absolute left-3 top-2.5 text-slate-400" />
                  <input
                    type="email"
                    value={inviteEmail}
                    onChange={(e) => setInviteEmail(e.target.value)}
                    placeholder="user@company.com"
                    className={`${inputCls} pl-9`}
                  />
                </div>
                <select value={inviteRole} onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member')} className={`${inputCls} !w-28`}>
                  <option value="admin">Admin</option>
                  <option value="member">Member</option>
                </select>
              </div>
              <button
                type="submit"
                disabled={!inviteEmail.trim() || busy === 'invite'}
                className="w-full px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white text-sm font-bold flex items-center justify-center gap-2"
              >
                {busy === 'invite' && <Loader2 className="w-4 h-4 animate-spin" />} Invite user
              </button>
            </form>

            {setupLink && (
              <div className="rounded-lg border border-emerald-200 bg-emerald-50 p-3 space-y-2">
                <p className="text-xs text-emerald-900 font-medium">
                  User created. Send them this link so they can set their password (it is not emailed automatically).
                </p>
                <div className="flex gap-2">
                  <input readOnly value={setupLink} onFocus={(e) => e.currentTarget.select()} className="flex-1 min-w-0 text-xs font-mono bg-white border border-emerald-200 rounded-md px-2 py-1.5" />
                  <button onClick={copyLink} className="px-2.5 rounded-md bg-emerald-600 text-white text-xs font-semibold flex items-center gap-1">
                    {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    {copied ? 'Copied' : 'Copy'}
                  </button>
                </div>
              </div>
            )}
          </section>

          {/* Danger zone */}
          <section className="pt-2 border-t border-slate-200">
            <button
              onClick={toggleStatus}
              disabled={busy === 'status'}
              className={`w-full flex items-center justify-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold border ${
                suspended
                  ? 'border-emerald-300 text-emerald-700 hover:bg-emerald-50'
                  : 'border-red-300 text-red-700 hover:bg-red-50'
              }`}
            >
              {busy === 'status' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Power className="w-4 h-4" />}
              {suspended ? 'Reactivate workspace' : 'Suspend workspace'}
            </button>
          </section>
        </div>
      </aside>
    </div>
  );
};
