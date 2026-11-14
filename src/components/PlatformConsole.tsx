import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { LegalEditor } from './LegalEditor';
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
  Lightbulb,
  Bug,
  MessageSquare,
  Clock,
  CheckCircle2,
  Save,
} from 'lucide-react';

import { PlansManager, type Catalog } from './PlansManager';
import { AI_USAGE_FEATURES, type AiFeatureUsageTotals } from '../shared/aiUsageFeatures';

type Plan = 'starter' | 'growth' | 'enterprise';
type Status = 'active' | 'suspended';

interface UsagePeriod {
  from: string;
  to: string;
  timezone: string;
  emailSentCount: number;
  coldEmailCount: number;
  solicitedEmailCount: number;
  aiInputTokens: number;
  aiOutputTokens: number;
  aiTotalTokens: number;
  aiRequestCount: number;
  aiCostUsd: number;
  aiUnpricedRequestCount: number;
  aiModelCostUsd: number;
  aiModelUnpricedRequestCount: number;
  aiFeatureUsage?: Record<string, AiFeatureUsageTotals>;
  days?: Array<{
    day: string; emailSentCount: number; coldEmailCount: number; solicitedEmailCount: number;
    aiInputTokens: number; aiOutputTokens: number; aiTotalTokens: number; aiRequestCount: number;
    aiCostUsd: number; aiUnpricedRequestCount: number; aiModelCostUsd: number; aiModelUnpricedRequestCount: number; aiFeatureUsage?: Record<string, AiFeatureUsageTotals>;
  }>;
}

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
  currentMonthUsage?: { aiTotalTokens?: number; aiModelCostUsd?: number; aiModelUnpricedRequestCount?: number; coldEmailCount?: number; solicitedEmailCount?: number };
  periodUsage?: UsagePeriod;
}

interface TenantUser {
  uid: string;
  email: string;
  name?: string;
  role: 'admin' | 'member' | string;
  active: boolean;
}

interface Usage {
  usage: { aiInputTokens?: number; aiOutputTokens?: number; aiTotalTokens?: number; aiCostUsd?: number; aiUnpricedRequestCount?: number; aiModelCostUsd?: number; aiModelUnpricedRequestCount?: number; aiFeatureUsage?: Record<string, AiFeatureUsageTotals>; coldEmailCount?: number; solicitedEmailCount?: number; whatsappMessageCount?: number };
  limits: { monthlyAiTokens: number; dailyOutboundSends: number; seats: number };
  dailyUsage?: { emailSentCount?: number };
  periodUsage?: UsagePeriod;
  percentages: { aiTokens: number; dailySends?: number };
}

type FeedbackStatus = 'NEW' | 'IN_REVIEW' | 'RESOLVED' | 'CLOSED';
interface FeedbackSubmission {
  id: string;
  type: 'IDEA' | 'BUG';
  description: string;
  status: FeedbackStatus;
  adminNote?: string;
  tenantId: string;
  tenantName: string;
  submittedBy: { uid: string; name: string; email: string; role: string };
  contextModule?: string;
  contextPath?: string;
  createdAt: string;
  updatedAt: string;
  reviewedAt?: string;
  reviewedBy?: string;
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

const currentUtcDateKey = () => new Date().toISOString().slice(0, 10);
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
  const [view, setView] = useState<'workspaces' | 'feedback' | 'plans' | 'legal'>('workspaces');
  const [feedbackItems, setFeedbackItems] = useState<FeedbackSubmission[]>([]);
  const [feedbackLoading, setFeedbackLoading] = useState(false);
  const [feedbackError, setFeedbackError] = useState<string | null>(null);
  const [feedbackSearch, setFeedbackSearch] = useState('');
  const [feedbackTypeFilter, setFeedbackTypeFilter] = useState<'ALL' | 'IDEA' | 'BUG'>('ALL');
  const [feedbackStatusFilter, setFeedbackStatusFilter] = useState<'ALL' | FeedbackStatus>('ALL');
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<string | null>(null);
  const [feedbackStatusDraft, setFeedbackStatusDraft] = useState<FeedbackStatus>('NEW');
  const [feedbackNoteDraft, setFeedbackNoteDraft] = useState('');
  const [feedbackSaving, setFeedbackSaving] = useState(false);
  const [catalog, setCatalog] = useState<Catalog>({ plans: [], features: [], limits: [] });
  const [dateFrom, setDateFrom] = useState(currentUtcDateKey);
  const [dateTo, setDateTo] = useState(currentUtcDateKey);
  const [appliedDateRange, setAppliedDateRange] = useState(() => ({ from: currentUtcDateKey(), to: currentUtcDateKey() }));
  const loadFeedback = useCallback(async () => {
    setFeedbackLoading(true);
    setFeedbackError(null);
    try {
      const data = await api<{ submissions: FeedbackSubmission[] }>('/api/platform/feedback');
      setFeedbackItems(Array.isArray(data.submissions) ? data.submissions : []);
    } catch (error: any) {
      setFeedbackError(error?.message || 'Could not load feedback submissions.');
    } finally {
      setFeedbackLoading(false);
    }
  }, []);

  useEffect(() => {
    if (view === 'feedback') void loadFeedback();
  }, [view, loadFeedback]);

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
      const params = new URLSearchParams({ from: appliedDateRange.from, to: appliedDateRange.to });
      const data = await api<{ tenants: Tenant[] }>(`/api/tenants?${params.toString()}`);
      setTenants(data.tenants || []);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [appliedDateRange]);

  useEffect(() => {
    load();
  }, [load]);

  const applyUsageDateFilter = () => {
    if (!dateFrom || !dateTo || dateFrom > dateTo) {
      setError('Choose a valid date range. The end date must be on or after the start date.');
      return;
    }
    setError(null);
    setAppliedDateRange({ from: dateFrom, to: dateTo });
  };

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return [...tenants]
      .sort((a, b) => (b.createdAt || '').localeCompare(a.createdAt || ''))
      .filter((t) => !q || t.name?.toLowerCase().includes(q) || t.id.toLowerCase().includes(q) || t.contactEmail?.toLowerCase().includes(q));
  }, [tenants, search]);

  const filteredFeedback = useMemo(() => {
    const q = feedbackSearch.trim().toLowerCase();
    return feedbackItems.filter((item) => {
      if (feedbackTypeFilter !== 'ALL' && item.type !== feedbackTypeFilter) return false;
      if (feedbackStatusFilter !== 'ALL' && item.status !== feedbackStatusFilter) return false;
      if (!q) return true;
      return [
        item.description, item.tenantName, item.tenantId,
        item.submittedBy?.name, item.submittedBy?.email,
        item.contextModule, item.id,
      ].some((value) => String(value || '').toLowerCase().includes(q));
    });
  }, [feedbackItems, feedbackSearch, feedbackTypeFilter, feedbackStatusFilter]);
  const selectedFeedback = feedbackItems.find((item) => item.id === selectedFeedbackId) || null;
  const openFeedback = (item: FeedbackSubmission) => {
    setSelectedFeedbackId(item.id);
    setFeedbackStatusDraft(item.status);
    setFeedbackNoteDraft(item.adminNote || '');
  };
  const saveFeedback = async () => {
    if (!selectedFeedback) return;
    setFeedbackSaving(true);
    setFeedbackError(null);
    try {
      const saved = await api<{ success: boolean; status: FeedbackStatus; adminNote: string; updatedAt: string }>('/api/platform/feedback', {
        method: 'PATCH',
        body: JSON.stringify({ id: selectedFeedback.id, status: feedbackStatusDraft, adminNote: feedbackNoteDraft }),
      });
      setFeedbackItems((items) => items.map((item) => item.id === selectedFeedback.id
        ? { ...item, status: saved.status, adminNote: saved.adminNote, updatedAt: saved.updatedAt }
        : item
      ));
    } catch (error: any) {
      setFeedbackError(error?.message || 'Could not update this submission.');
    } finally {
      setFeedbackSaving(false);
    }
  };

  const active = tenants.filter((t) => t.status !== 'suspended').length;
  const selected = tenants.find((t) => t.id === selectedId) || null;
  const usageTotals = tenants.reduce((sum, t) => {
    const u = t.periodUsage || {};
    sum.emails += Number(u.emailSentCount || 0);
    sum.tokens += Number(u.aiTotalTokens || 0);
    sum.costUsd += Number(u.aiModelCostUsd || 0);
    return sum;
  }, { emails: 0, tokens: 0, costUsd: 0 });

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
          {(['workspaces', 'feedback', 'plans', 'legal'] as const).map((v) => (
            <button
              key={v}
              onClick={() => setView(v)}
              className={`px-4 py-1.5 rounded-md capitalize ${view === v ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-600 hover:text-slate-900'}`}
            >
              {v === 'feedback' ? 'Ideas & Bugs' : v}
              {v === 'feedback' && feedbackItems.some((item) => item.status === 'NEW') && <span className="ml-1.5 rounded-full bg-rose-100 px-1.5 py-0.5 text-[9px] font-bold text-rose-700">{feedbackItems.filter((item) => item.status === 'NEW').length}</span>}
            </button>
          ))}
        </div>
      </div>

      {view === 'plans' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <PlansManager catalog={catalog} onChanged={loadCatalog} />
        </main>
      )}

      {view === 'legal' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6">
          <LegalEditor />
        </main>
      )}

      {view === 'feedback' && (
        <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
          <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
            <div>
              <div className="text-[9px] font-bold uppercase tracking-[.18em] text-slate-400">Customer voice</div>
              <h1 className="mt-1 text-xl font-bold tracking-tight text-slate-900">Ideas & Bug Reports</h1>
              <p className="mt-1 text-xs text-slate-500">Review product ideas and bug reports submitted by users across all workspaces.</p>
            </div>
            <button type="button" onClick={() => void loadFeedback()} disabled={feedbackLoading} className="inline-flex items-center justify-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:opacity-50">
              <RefreshCw className={`h-3.5 w-3.5 ${feedbackLoading ? 'animate-spin' : ''}`} /> Refresh
            </button>
          </div>

          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {[
              { label: 'All submissions', value: feedbackItems.length, icon: <MessageSquare className="h-4 w-4" />, tone: 'text-slate-700 bg-slate-100' },
              { label: 'New', value: feedbackItems.filter((item) => item.status === 'NEW').length, icon: <Clock className="h-4 w-4" />, tone: 'text-blue-700 bg-blue-50' },
              { label: 'Ideas', value: feedbackItems.filter((item) => item.type === 'IDEA').length, icon: <Lightbulb className="h-4 w-4" />, tone: 'text-amber-700 bg-amber-50' },
              { label: 'Bug reports', value: feedbackItems.filter((item) => item.type === 'BUG').length, icon: <Bug className="h-4 w-4" />, tone: 'text-rose-700 bg-rose-50' },
            ].map((stat) => (
              <div key={stat.label} className="rounded-xl border border-slate-200 bg-white p-3">
                <div className="flex items-center gap-2 text-[10px] font-semibold text-slate-500"><span className={`flex h-7 w-7 items-center justify-center rounded-lg ${stat.tone}`}>{stat.icon}</span>{stat.label}</div>
                <div className="mt-2 text-xl font-bold tabular-nums text-slate-900">{stat.value.toLocaleString('en-US')}</div>
              </div>
            ))}
          </div>

          {feedbackError && <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-[11px] text-rose-700">{feedbackError}</div>}

          <div className="grid min-w-0 gap-4 lg:grid-cols-[minmax(0,1.15fr)_minmax(320px,.85fr)]">
            <section className="min-w-0 overflow-hidden rounded-xl border border-slate-200 bg-white">
              <div className="space-y-3 border-b border-slate-100 p-3">
                <div className="relative">
                  <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
                  <input value={feedbackSearch} onChange={(event) => setFeedbackSearch(event.target.value)} placeholder="Search ideas, bugs, people or workspaces…" className="w-full rounded-lg border border-slate-200 bg-slate-50 py-2 pl-9 pr-3 text-[11px] text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
                </div>
                <div className="flex flex-wrap gap-2">
                  <select value={feedbackTypeFilter} onChange={(event) => setFeedbackTypeFilter(event.target.value as any)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 outline-none">
                    <option value="ALL">All types</option><option value="IDEA">Ideas</option><option value="BUG">Bugs</option>
                  </select>
                  <select value={feedbackStatusFilter} onChange={(event) => setFeedbackStatusFilter(event.target.value as any)} className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[10px] font-semibold text-slate-600 outline-none">
                    <option value="ALL">All statuses</option><option value="NEW">New</option><option value="IN_REVIEW">In review</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option>
                  </select>
                  <span className="ml-auto self-center text-[9px] text-slate-400">{filteredFeedback.length} shown</span>
                </div>
              </div>
              <div className="max-h-[680px] overflow-y-auto divide-y divide-slate-100">
                {feedbackLoading && feedbackItems.length === 0 ? (
                  <div className="flex items-center justify-center gap-2 p-10 text-[11px] text-slate-400"><Loader2 className="h-4 w-4 animate-spin" /> Loading submissions…</div>
                ) : filteredFeedback.length === 0 ? (
                  <div className="p-10 text-center">
                    <MessageSquare className="mx-auto mb-2 h-7 w-7 text-slate-300" />
                    <p className="text-[11px] font-semibold text-slate-600">No submissions found</p>
                    <p className="mt-1 text-[10px] text-slate-400">{feedbackItems.length === 0 ? 'Ideas and bug reports from workspace users will appear here.' : 'Try changing your filters or search.'}</p>
                  </div>
                ) : filteredFeedback.map((item) => (
                  <button key={item.id} type="button" onClick={() => openFeedback(item)} className={`block w-full p-3.5 text-left transition hover:bg-slate-50 ${selectedFeedbackId === item.id ? 'bg-blue-50/70 ring-1 ring-inset ring-blue-100' : ''}`}>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${item.type === 'BUG' ? 'bg-rose-50 text-rose-600' : 'bg-amber-50 text-amber-600'}`}>{item.type === 'BUG' ? <Bug className="h-4 w-4" /> : <Lightbulb className="h-4 w-4" />}</span>
                        <span className="min-w-0">
                          <span className="block truncate text-[11px] font-bold text-slate-800">{item.type === 'BUG' ? 'Bug report' : 'Product idea'}</span>
                          <span className="mt-0.5 block truncate text-[9px] text-slate-500">{item.submittedBy?.name || item.submittedBy?.email || 'Workspace user'} · {item.tenantName || item.tenantId}</span>
                        </span>
                      </div>
                      <span className={`shrink-0 rounded-full px-2 py-1 text-[8px] font-bold ${item.status === 'NEW' ? 'bg-blue-50 text-blue-700' : item.status === 'IN_REVIEW' ? 'bg-amber-50 text-amber-700' : item.status === 'RESOLVED' ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-100 text-slate-600'}`}>{item.status.replace('_', ' ')}</span>
                    </div>
                    <p className="mt-2 line-clamp-3 whitespace-pre-wrap text-[10px] leading-relaxed text-slate-600">{item.description}</p>
                    <div className="mt-2 flex items-center justify-between gap-2 text-[9px] text-slate-400"><span className="truncate">{item.submittedBy?.email || item.tenantId}</span><span className="shrink-0">{item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}</span></div>
                  </button>
                ))}
              </div>
            </section>

            <section className="min-w-0 rounded-xl border border-slate-200 bg-white">
              {!selectedFeedback ? (
                <div className="flex min-h-[360px] flex-col items-center justify-center p-8 text-center">
                  <span className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-500"><MessageSquare className="h-5 w-5" /></span>
                  <p className="text-[12px] font-bold text-slate-800">Submission details</p>
                  <p className="mt-1 max-w-[230px] text-[10px] leading-relaxed text-slate-400">Select an idea or bug report to review its details and update its status.</p>
                </div>
              ) : (
                <div className="space-y-4 p-4">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className={`mb-1 inline-flex items-center gap-1.5 text-[9px] font-bold uppercase tracking-wider ${selectedFeedback.type === 'BUG' ? 'text-rose-600' : 'text-amber-600'}`}>{selectedFeedback.type === 'BUG' ? <Bug className="h-3.5 w-3.5" /> : <Lightbulb className="h-3.5 w-3.5" />}{selectedFeedback.type === 'BUG' ? 'Bug report' : 'Product idea'}</div>
                      <h2 className="text-[13px] font-bold text-slate-900">Submission details</h2>
                    </div>
                    <span className="max-w-[120px] truncate rounded-md bg-slate-100 px-2 py-1 font-mono text-[8px] text-slate-500">{selectedFeedback.id}</span>
                  </div>
                  <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                    <p className="whitespace-pre-wrap break-words text-[11px] leading-[1.7] text-slate-700">{selectedFeedback.description}</p>
                  </div>

                  <div className="space-y-2 rounded-lg border border-slate-100 p-3">
                    <div className="text-[9px] font-bold uppercase tracking-wider text-slate-400">Submitted by</div>
                    <div className="text-[11px] font-bold text-slate-800">{selectedFeedback.submittedBy?.name || 'Workspace user'}</div>
                    <div className="text-[10px] text-slate-500">{selectedFeedback.submittedBy?.email || '—'} · {selectedFeedback.submittedBy?.role || 'member'}</div>
                    <div className="border-t border-slate-100 pt-2 text-[10px] text-slate-700"><span className="font-semibold">Workspace:</span> {selectedFeedback.tenantName || selectedFeedback.tenantId} <span className="font-mono text-[9px] text-slate-400">({selectedFeedback.tenantId})</span></div>
                    <div className="text-[10px] text-slate-500"><span className="font-semibold text-slate-700">Submitted:</span> {selectedFeedback.createdAt ? new Date(selectedFeedback.createdAt).toLocaleString() : '—'}</div>
                    <div className="text-[10px] text-slate-500"><span className="font-semibold text-slate-700">From:</span> {selectedFeedback.contextModule || 'Unknown module'} · <span className="font-mono">{selectedFeedback.contextPath || '—'}</span></div>
                  </div>

                  <div className="space-y-2">
                    <label className="block text-[10px] font-semibold text-slate-700">Status</label>
                    <select value={feedbackStatusDraft} onChange={(event) => setFeedbackStatusDraft(event.target.value as FeedbackStatus)} className="w-full rounded-lg border border-slate-200 bg-white px-3 py-2 text-[11px] text-slate-800 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100">
                      <option value="NEW">New</option><option value="IN_REVIEW">In review</option><option value="RESOLVED">Resolved</option><option value="CLOSED">Closed</option>
                    </select>
                    <label className="block pt-1 text-[10px] font-semibold text-slate-700">Internal note</label>
                    <textarea value={feedbackNoteDraft} onChange={(event) => setFeedbackNoteDraft(event.target.value)} maxLength={5000} rows={4} placeholder="Add an internal note for the product team…" className="w-full resize-y rounded-lg border border-slate-200 px-3 py-2 text-[10px] leading-relaxed text-slate-700 outline-none focus:border-blue-300 focus:ring-2 focus:ring-blue-100" />
                    <button type="button" onClick={() => void saveFeedback()} disabled={feedbackSaving} className="inline-flex w-full items-center justify-center gap-2 rounded-lg bg-slate-900 px-4 py-2.5 text-[10px] font-semibold text-white hover:bg-slate-800 disabled:opacity-50">
                      {feedbackSaving ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Save className="h-3.5 w-3.5" />} Save review
                    </button>
                  </div>
                </div>
              )}
            </section>
          </div>
        </main>
      )}

      {view === 'workspaces' && (
      <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
        {/* Usage date filter */}
        <section className="bg-white border border-slate-200 rounded-xl p-4 space-y-3">
          <div>
            <h2 className="text-sm font-bold text-slate-900">Usage date filter</h2>
            <p className="text-xs text-slate-500">The selected UTC dates apply to platform totals and each workspace row.</p>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-[1fr_1fr_auto] gap-3 items-end">
            <label className="block text-xs font-semibold text-slate-600">
              From
              <input type="date" value={dateFrom} onChange={(event) => setDateFrom(event.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <label className="block text-xs font-semibold text-slate-600">
              To
              <input type="date" value={dateTo} onChange={(event) => setDateTo(event.target.value)} className={`${inputCls} mt-1`} />
            </label>
            <button type="button" onClick={applyUsageDateFilter} disabled={!dateFrom || !dateTo || dateFrom > dateTo} className="px-4 py-2 rounded-lg bg-slate-900 text-white text-sm font-semibold disabled:opacity-40">
              Apply filter
            </button>
          </div>
        </section>

        {/* Stats */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          {[
            { label: 'Workspaces', value: tenants.length.toLocaleString('en-US') },
            { label: 'Active', value: active.toLocaleString('en-US') },
            { label: 'Suspended', value: (tenants.length - active).toLocaleString('en-US') },
            { label: 'Emails sent', value: usageTotals.emails.toLocaleString('en-US') },
            { label: 'AI tokens', value: usageTotals.tokens.toLocaleString('en-US') },
            { label: 'Estimated AI cost', value: new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(usageTotals.costUsd) },
          ].map((s) => (
            <div key={s.label} className="bg-white border border-slate-200 rounded-xl px-4 py-3 min-w-0">
              <div className="text-xs font-medium text-slate-500">{s.label}</div>
              <div className="text-xl font-bold text-slate-900 mt-0.5 truncate">{s.value}</div>
              {['Emails sent', 'AI tokens', 'Estimated AI cost'].includes(s.label) && <div className="text-[10px] text-slate-400 mt-1">{appliedDateRange.from === appliedDateRange.to ? appliedDateRange.from : `${appliedDateRange.from} – ${appliedDateRange.to}`} UTC</div>}
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
                  <th className="px-4 py-3 hidden lg:table-cell">Emails sent (range)</th>
                  <th className="px-4 py-3 hidden lg:table-cell">AI tokens (range)</th>
                  <th className="px-4 py-3 hidden lg:table-cell">AI cost</th>
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
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-700">{(t.periodUsage?.emailSentCount || 0).toLocaleString('en-US')}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-700">{(t.periodUsage?.aiTotalTokens || 0).toLocaleString('en-US')}</td>
                    <td className="px-4 py-3 hidden lg:table-cell text-slate-700">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(t.periodUsage?.aiModelCostUsd || 0)}</td>
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
          dateFrom={appliedDateRange.from}
          dateTo={appliedDateRange.to}
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

const WorkspacePanel: React.FC<{ tenant: Tenant; catalog: Catalog; dateFrom: string; dateTo: string; onClose: () => void; onChanged: (patch: Partial<Tenant>) => void }> = ({
  catalog,
  tenant,
  dateFrom,
  dateTo,
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
    const params = new URLSearchParams({ from: dateFrom, to: dateTo });
    const [u, us] = await Promise.allSettled([
      api<Usage>(`/api/tenants/${tenant.id}/usage?${params.toString()}`),
      api<{ users: TenantUser[] }>(`/api/tenants/${tenant.id}/users`),
    ]);
    if (u.status === 'fulfilled') setUsage(u.value);
    if (us.status === 'fulfilled') setUsers(us.value.users || []);
  }, [tenant.id, dateFrom, dateTo]);

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
  const dailyEmails = usage?.dailyUsage?.emailSentCount || 0;
  const aiCostUsd = usage?.usage?.aiModelCostUsd || 0;
  const selectedPeriod = usage?.periodUsage;
  const featureUsage = usage?.usage?.aiFeatureUsage || {};
  const featuresUsed = AI_USAGE_FEATURES.filter((feature) => Number(featureUsage[feature.key]?.aiRequestCount || featureUsage[feature.key]?.aiTotalTokens || 0) > 0);

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
                <div className="text-[11px] text-slate-400">today {fmt(dailyEmails)} / {fmt(usage?.limits?.dailyOutboundSends || tenant.limits?.dailyOutboundSends)}</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Seats</div>
                <div className="font-semibold text-slate-900">
                  {users.length} <span className="text-slate-400 font-normal">/ {usage?.limits?.seats || tenant.limits?.seats || '—'}</span>
                </div>
              </div>
            </div>
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Estimated AI cost</div>
                <div className="font-semibold text-slate-900">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(aiCostUsd)}</div>
                <div className="text-[11px] text-slate-400">USD this month</div>
              </div>
              <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                <div className="text-xs text-slate-500">Input / output tokens</div>
                <div className="font-semibold text-slate-900">{fmt(usage?.usage?.aiInputTokens)} / {fmt(usage?.usage?.aiOutputTokens)}</div>
                <div className="text-[11px] text-slate-400">Provider reported</div>
              </div>
            </div>
            {(usage?.usage?.aiModelUnpricedRequestCount || 0) > 0 && <p className="text-[11px] text-amber-700">Estimated expenditure is incomplete for {fmt(usage?.usage?.aiModelUnpricedRequestCount)} AI request(s) because a matching model price or usage breakdown was unavailable.</p>}
            <div className="rounded-lg border border-slate-200 overflow-hidden">
              <div className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-600">AI usage by feature · Estimated tokens</div>
              {featuresUsed.length > 0 ? (
                <table className="w-full text-xs">
                  <thead className="text-slate-500">
                    <tr>
                      <th className="px-3 py-2 text-left font-semibold">Feature</th>
                      <th className="px-3 py-2 text-right font-semibold">Estimated tokens</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {featuresUsed.map((feature) => (
                      <tr key={feature.key}>
                        <td className="px-3 py-2 text-slate-700">{feature.label}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900">{fmt(featureUsage[feature.key]?.aiTotalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <p className="px-3 py-3 text-xs text-slate-400">Feature usage will appear as AI requests are recorded.</p>}
            </div>
          </section>

          <section className="space-y-3">
            <h3 className="text-xs font-bold uppercase tracking-wider text-slate-500">
              Usage by date · {dateFrom} to {dateTo} UTC
            </h3>
            {selectedPeriod && (
              <>
                <div className="grid grid-cols-2 gap-3 text-sm">
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-xs text-slate-500">Emails sent</div>
                    <div className="font-semibold text-slate-900">{fmt(selectedPeriod.emailSentCount)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-xs text-slate-500">AI tokens</div>
                    <div className="font-semibold text-slate-900">{fmt(selectedPeriod.aiTotalTokens)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-xs text-slate-500">AI cost</div>
                    <div className="font-semibold text-slate-900">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(selectedPeriod.aiModelCostUsd)}</div>
                  </div>
                  <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2">
                    <div className="text-xs text-slate-500">Input / output</div>
                    <div className="font-semibold text-slate-900">{fmt(selectedPeriod.aiInputTokens)} / {fmt(selectedPeriod.aiOutputTokens)}</div>
                  </div>
                </div>
                <div className="overflow-x-auto rounded-lg border border-slate-200">
                  <table className="w-full min-w-[470px] text-xs">
                    <thead className="bg-slate-50 text-slate-500">
                      <tr>
                        <th className="px-3 py-2 text-left">Date</th>
                        <th className="px-3 py-2 text-right">Emails</th>
                        <th className="px-3 py-2 text-right">AI tokens</th>
                        <th className="px-3 py-2 text-right">AI cost</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(selectedPeriod.days || []).map((day) => (
                        <tr key={day.day}>
                          <td className="px-3 py-2 text-slate-700">{day.day}</td>
                          <td className="px-3 py-2 text-right text-slate-900">{fmt(day.emailSentCount)}</td>
                          <td className="px-3 py-2 text-right text-slate-900">{fmt(day.aiTotalTokens)}</td>
                          <td className="px-3 py-2 text-right text-slate-700">{new Intl.NumberFormat('en-US', { style: 'currency', currency: 'USD', maximumFractionDigits: 4 }).format(day.aiModelCostUsd)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
            {(selectedPeriod?.aiModelUnpricedRequestCount || 0) > 0 && <p className="text-[11px] text-amber-700">Some AI requests in this range could not be priced from the current model catalogue.</p>}
            {selectedPeriod?.aiFeatureUsage && Object.keys(selectedPeriod.aiFeatureUsage).some((key) => Number(selectedPeriod.aiFeatureUsage?.[key]?.aiRequestCount || 0) > 0) && (
              <div className="rounded-lg border border-slate-200 overflow-hidden">
                <div className="px-3 py-2 bg-slate-50 text-xs font-semibold text-slate-600">Estimated tokens by feature · Selected date range</div>
                <table className="w-full text-xs">
                  <tbody className="divide-y divide-slate-100">
                    {AI_USAGE_FEATURES.filter((feature) => Number(selectedPeriod?.aiFeatureUsage?.[feature.key]?.aiRequestCount || 0) > 0).map((feature) => (
                      <tr key={feature.key}>
                        <td className="px-3 py-2 text-slate-700">{feature.label}</td>
                        <td className="px-3 py-2 text-right font-medium text-slate-900">{fmt(selectedPeriod?.aiFeatureUsage?.[feature.key]?.aiTotalTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            <p className="text-[11px] text-slate-400">Future dates show zero until emails are accepted or AI calls consume tokens. Daily AI history starts with this usage-tracking release.</p>
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
