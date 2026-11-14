import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  ArrowRight,
  ArrowUpRight,
  Bot,
  CalendarCheck,
  CalendarDays,
  ChevronRight,
  Clock3,
  MessageCircle,
  Plus,
  Send,
  Users,
} from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import type { Booking, Contact, Lead } from '../types';
import type { ActiveTab } from './Navbar';
import { DashboardAiCards } from './DashboardAiCards';
import { DashboardAiHomeHero } from './DashboardAiHomeHero';

interface DashboardSummary {
  totalConversations: number;
  activeConversations: number;
  unreadMessages: number;
  humanHandoffs: number;
  totalCampaigns: number;
  runningCampaigns: number;
  campaignLeads: number;
  emailsSent: number;
  pendingEmails: number;
  replies: number;
  demosBooked: number;
  failedEmails: number;
}

interface DashboardViewProps {
  tenantId: string;
  tenantName?: string;
  userName: string;
  canUseAi: boolean;
  leads: Lead[];
  contacts: Contact[];
  conversations: Array<{
    conversationId: string;
    status: string;
    humanHandoff?: boolean;
    managementMode?: string;
    unreadCount?: number;
    unread?: boolean;
  }>;
  onNavigate: (tab: ActiveTab) => void;
  onAddLead: () => void;
  onOpenLead: (leadId: string) => void;
}

const dateValue = (value?: any) => {
  if (value === undefined || value === null || value === '') return 0;
  if (value instanceof Date) return Number.isFinite(value.getTime()) ? value.getTime() : 0;
  if (typeof value === 'number') return Number.isFinite(value) ? value : 0;
  if (value && typeof value.toDate === 'function') {
    const date = value.toDate();
    return date instanceof Date && Number.isFinite(date.getTime()) ? date.getTime() : 0;
  }
  const parsed = Date.parse(String(value));
  return Number.isFinite(parsed) ? parsed : 0;
};

const readableStatus = (value?: string) =>
  (value || 'NEW').split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ');

const statusTone = (status: string) => {
  if (status === 'CLOSED_WON' || status === 'DEMO_BOOKED' || status === 'DEMO_SCHEDULED') return 'bg-emerald-500/15 text-emerald-200 border-emerald-400/25';
  if (status === 'CLOSED_LOST' || status === 'NOT_INTERESTED' || status === 'UNSUBSCRIBED') return 'bg-rose-500/15 text-rose-200 border-rose-400/25';
  if (status === 'FOLLOW_UP') return 'bg-amber-500/15 text-amber-200 border-amber-400/25';
  if (status === 'QUALIFIED' || status === 'PROPOSAL_SENT') return 'bg-blue-500/15 text-blue-200 border-blue-400/25';
  if (status === 'HUMAN_HANDOFF') return 'bg-violet-500/15 text-violet-200 border-violet-400/25';
  return 'bg-blue-500/15 text-blue-200 border-blue-400/25';
};

const shortDate = (value?: any) => {
  const timestamp = dateValue(value);
  return timestamp
    ? new Date(timestamp).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '—';
};

export const DashboardView: React.FC<DashboardViewProps> = ({
  tenantId,
  tenantName,
  userName,
  canUseAi,
  leads,
  contacts,
  conversations,
  onNavigate,
  onAddLead,
  onOpenLead,
}) => {
  const { brand } = useBrand();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [summaryError, setSummaryError] = useState('');
  const [clockNow, setClockNow] = useState(() => Date.now());

  // This endpoint uses Firestore aggregate queries, so the dashboard is not limited to the
  // inbox's latest 50 conversation rows and it reads the actual email-campaign collection.
  useEffect(() => {
    let active = true;
    setSummary(null);
    setSummaryError('');

    const loadSummary = async () => {
      try {
        const response = await fetch('/api/dashboard/summary');
        const payload = await response.json().catch(() => ({}));
        if (!response.ok || !payload?.summary) {
          throw new Error(payload?.error || `Dashboard metrics request failed (${response.status}).`);
        }
        if (active) {
          setSummary(payload.summary as DashboardSummary);
          setSummaryError('');
        }
      } catch (error: any) {
        if (active) setSummaryError(error?.message || 'Could not refresh workspace metrics.');
      }
    };

    void loadSummary();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadSummary();
    }, 60_000);
    const onFocus = () => {
      if (document.visibilityState === 'visible') void loadSummary();
    };
    window.addEventListener('focus', onFocus);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [tenantId]);

  useEffect(() => {
    const interval = window.setInterval(() => setClockNow(Date.now()), 60_000);
    return () => window.clearInterval(interval);
  }, []);


  // Demo Scheduling uses this same authenticated, tenant-scoped endpoint.
  // Refresh it periodically so AI-created and manually-created bookings appear here.
  useEffect(() => {
    let active = true;
    setBookings([]);
    setBookingsLoaded(false);
    const loadBookings = async () => {
      try {
        const response = await fetch('/api/calendar/bookings');
        if (!response.ok) return;
        const payload = await response.json();
        if (!active) return;
        setBookings(Array.isArray(payload?.bookings) ? payload.bookings : []);
        setBookingsLoaded(true);
      } catch {
        // Until calendar data is available, the CRM's demo status provides a fallback.
      }
    };

    void loadBookings();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadBookings();
    }, 60_000);
    window.addEventListener('focus', loadBookings);
    return () => {
      active = false;
      window.clearInterval(interval);
      window.removeEventListener('focus', loadBookings);
    };
  }, [tenantId]);

  const now = clockNow;

  const dueFollowUps = useMemo(() => leads.filter((lead) => {
    if (['CLOSED_WON', 'CLOSED_LOST', 'UNSUBSCRIBED', 'NOT_INTERESTED'].includes(lead.status)) return false;
    const scheduledAt = lead.aiAutoFollowUp?.status === 'scheduled'
      ? lead.aiAutoFollowUp.scheduledAt
      : lead.autoFollowUp?.enabled
        ? lead.autoFollowUp.nextScheduledAt || lead.nextFollowUpAt
        : lead.nextFollowUpAt;
    return scheduledAt ? dateValue(scheduledAt) <= now : lead.status === 'FOLLOW_UP';
  }), [leads, now]);

  const scheduledDemoCount = useMemo(() => {
    // CRM status is authoritative for a lead marked Demo Booked, even when there is no
    // calendar booking row linked to it (such as a manual CRM status update).
    const bookedLeadIds = new Set(
      leads
        .filter((lead) => lead.demoStatus === 'BOOKED' || lead.status === 'DEMO_BOOKED' || lead.status === 'DEMO_SCHEDULED')
        .map((lead) => lead.leadId)
    );
    const bookingOnlyIds = new Set<string>();

    if (bookingsLoaded) {
      const contactsById = new Map<string, Contact>(contacts.map((contact) => [contact.contactId, contact] as const));
      const leadIdByEmail = new Map<string, string>();
      const leadIdByPhone = new Map<string, string>();
      leads.forEach((lead) => {
        const contact = contactsById.get(lead.contactId);
        const email = String(contact?.email || '').trim().toLowerCase();
        const phone = String(contact?.phone || '').replace(/\D/g, '').slice(-10);
        if (email && !leadIdByEmail.has(email)) leadIdByEmail.set(email, lead.leadId);
        if (phone && !leadIdByPhone.has(phone)) leadIdByPhone.set(phone, lead.leadId);
      });

      bookings.forEach((booking) => {
        if (booking.status !== 'BOOKED' && booking.status !== 'RESCHEDULED') return;
        const startsAt = booking.startDateTimeIso ||
          (booking.date && booking.startTime ? booking.date + 'T' + booking.startTime + ':00+05:30' : '');
        if (!startsAt || dateValue(startsAt) < now) return;

        const email = String(booking.leadEmail || '').trim().toLowerCase();
        const phone = String(booking.leadPhone || '').replace(/\D/g, '').slice(-10);
        const matchingLeadId = booking.leadId || leadIdByEmail.get(email) || leadIdByPhone.get(phone);
        if (matchingLeadId) bookedLeadIds.add(matchingLeadId);
        else if (booking.bookingId) bookingOnlyIds.add(booking.bookingId);
      });
    }

    // Count a CRM lead once when both its CRM record and calendar booking exist.
    return bookedLeadIds.size + bookingOnlyIds.size;
  }, [leads, contacts, bookings, bookingsLoaded, now]);

  const stages = [
    { key: 'NEW', label: 'New', statuses: ['NEW'], color: 'bg-slate-400' },
    { key: 'CONTACTED', label: 'Contacted', statuses: ['CONTACTED'], color: 'bg-blue-500' },
    { key: 'FOLLOW_UP', label: 'Follow-up', statuses: ['FOLLOW_UP'], color: 'bg-amber-500' },
    { key: 'ENGAGED', label: 'Engaged', statuses: ['ENGAGED'], color: 'bg-orange-500' },
    { key: 'QUALIFIED', label: 'Qualified', statuses: ['QUALIFIED'], color: 'bg-[#0848ef]' },
    { key: 'DEMO_BOOKED', label: 'Demo scheduled', statuses: ['DEMO_BOOKED', 'DEMO_SCHEDULED'], color: 'bg-emerald-500' },
    { key: 'PROPOSAL_SENT', label: 'Proposal sent', statuses: ['PROPOSAL_SENT'], color: 'bg-cyan-500' },
    { key: 'HUMAN_HANDOFF', label: 'Human handoff', statuses: ['HUMAN_HANDOFF'], color: 'bg-violet-500' },
    { key: 'CLOSED_WON', label: 'Won', statuses: ['CLOSED_WON'], color: 'bg-emerald-600' },
    { key: 'CLOSED_LOST', label: 'Lost', statuses: ['CLOSED_LOST'], color: 'bg-rose-400' },
    { key: 'NOT_INTERESTED', label: 'Not interested', statuses: ['NOT_INTERESTED'], color: 'bg-rose-300' },
    { key: 'UNSUBSCRIBED', label: 'Unsubscribed', statuses: ['UNSUBSCRIBED'], color: 'bg-slate-500' },
  ];
  const knownLeadStatuses = new Set(stages.flatMap((stage) => stage.statuses));
  const pipeline = [
    ...stages.map((stage) => ({
      ...stage,
      count: leads.filter((lead) => stage.statuses.includes(lead.status)).length,
    })),
    {
      key: 'OTHER',
      label: 'Other',
      statuses: [],
      color: 'bg-slate-300',
      count: leads.filter((lead) => !knownLeadStatuses.has(lead.status)).length,
    },
  ].filter((stage) => stage.count > 0);

  const monthlyTrend = useMemo(() => {
    const current = new Date();
    return Array.from({ length: 6 }, (_, index) => {
      const month = new Date(current.getFullYear(), current.getMonth() - (5 - index), 1);
      const count = leads.filter((lead) => {
        const createdAt = dateValue(lead.createdAt);
        if (!createdAt) return false;
        const created = new Date(createdAt);
        return created.getFullYear() === month.getFullYear() && created.getMonth() === month.getMonth();
      }).length;
      return {
        label: month.toLocaleDateString('en-IN', { month: 'short' }),
        count,
        key: String(month.getFullYear()) + '-' + String(month.getMonth()),
      };
    });
  }, [leads]);
  const maxMonthlyCount = Math.max(1, ...monthlyTrend.map((month) => month.count));

  const recentLeads = useMemo(
    () => [...leads]
      .sort((a, b) =>
        dateValue(b.updatedAt || b.lastActivityAt || b.createdAt) -
        dateValue(a.updatedAt || a.lastActivityAt || a.createdAt)
      )
      .slice(0, 5),
    [leads]
  );

  const workspaceName = tenantName || brand.companyName || 'Your workspace';

  const kpis = [
    { label: 'Total leads', value: leads.length, note: 'Across this workspace', icon: <Users className="h-4 w-4" />, tone: 'bg-[#eaf0ff] text-[#0848ef]', tab: 'crm' as ActiveTab },
    { label: 'Active conversations', value: summary?.activeConversations ?? null, note: summary ? `${summary.unreadMessages.toLocaleString('en-IN')} unread messages` : 'Loading workspace totals', icon: <MessageCircle className="h-4 w-4" />, tone: 'bg-blue-50 text-[#0848ef]', tab: 'inbox' as ActiveTab },
    { label: 'Follow-ups due', value: dueFollowUps.length, note: 'Require attention', icon: <Clock3 className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600', tab: 'auto-followup' as ActiveTab },
    { label: 'Demo / consultation booked', value: scheduledDemoCount, note: 'CRM demo status + upcoming calendar bookings', icon: <CalendarCheck className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-600', tab: 'scheduling' as ActiveTab },
    { label: 'Email campaigns', value: summary?.totalCampaigns ?? null, note: summary ? `${summary.runningCampaigns} running · ${summary.campaignLeads.toLocaleString('en-IN')} recipients` : 'Loading campaign totals', icon: <Send className="h-4 w-4" />, tone: 'bg-sky-50 text-sky-600', tab: 'campaigns' as ActiveTab },
    { label: 'Human handoffs', value: summary?.humanHandoffs ?? null, note: 'Waiting for your team', icon: <Bot className="h-4 w-4" />, tone: 'bg-rose-50 text-rose-600', tab: 'inbox' as ActiveTab },
  ];

  const activity = [
    { label: 'Active conversations', description: 'Across the entire workspace', count: summary?.activeConversations ?? null, icon: <MessageCircle className="h-4 w-4" />, tone: 'bg-blue-50 text-[#0848ef]', tab: 'inbox' as ActiveTab },
    { label: 'Human handoffs', description: 'Conversations needing your team', count: summary?.humanHandoffs ?? null, icon: <Activity className="h-4 w-4" />, tone: 'bg-[#eaf0ff] text-[#0848ef]', tab: 'inbox' as ActiveTab },
    { label: 'Follow-ups due', description: 'Review pending follow-up tasks', count: dueFollowUps.length, icon: <Clock3 className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600', tab: 'auto-followup' as ActiveTab },
    { label: 'Email campaigns', description: 'Manage workspace email campaigns', count: summary?.totalCampaigns ?? null, icon: <Send className="h-4 w-4" />, tone: 'bg-sky-50 text-sky-600', tab: 'campaigns' as ActiveTab },
  ];

  return (
    <div className="dashboard-view dashboard-home-view min-h-full w-full bg-[#05051f] pb-8">
      <DashboardAiHomeHero userName={userName} canUseAi={canUseAi} onNavigate={onNavigate} />

      <div className="dashboard-home-content mx-auto w-full max-w-[1600px] space-y-5 px-3 pt-5 sm:px-5">
      <div className="flex flex-col gap-3 pt-1 sm:flex-row sm:items-end sm:justify-between">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[9px] font-bold uppercase tracking-[0.18em] text-slate-400">
            <span className="text-blue-300">{workspaceName}</span>
            <span className="text-slate-600">/</span>
            <span>Overview</span>
          </div>
          <h2 className="text-[21px] font-semibold tracking-[-.035em] text-white sm:text-[24px]">Your dashboard</h2>
          <p className="mt-1 text-[11px] text-slate-400">A live view of the metrics and activity that matter to your workspace.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onAddLead} className="inline-flex items-center gap-2 rounded-lg border border-white/15 bg-white/[.06] px-3.5 py-2.5 text-[10px] font-semibold text-slate-100 shadow-sm transition hover:border-blue-300/40 hover:bg-white/10">
            <Plus className="h-3.5 w-3.5" /> Add lead
          </button>
          <button type="button" onClick={() => onNavigate('campaigns')} className="inline-flex items-center gap-2 rounded-lg bg-[#0848ef] px-3.5 py-2.5 text-[10px] font-semibold text-white shadow-sm transition hover:bg-blue-600">
            Create campaign <ArrowUpRight className="h-3.5 w-3.5" />
          </button>
        </div>
      </div>

      <div className="dashboard-kpis grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((card) => (
          <button key={card.label} type="button" onClick={() => onNavigate(card.tab)} className="dashboard-metric-card group min-h-[124px] rounded-xl border border-[#dfe5f0] bg-white p-4 text-left shadow-[0_2px_10px_rgba(15,23,42,0.025)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:p-5">
            <div className="flex items-center justify-between">
              <span className="dashboard-metric-label text-xs font-medium text-slate-500">{card.label}</span>
              <span className={'dashboard-card-icon flex h-9 w-9 items-center justify-center rounded-xl ' + card.tone}>{card.icon}</span>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <span className="dashboard-metric-value text-3xl font-bold leading-none tracking-tight text-[#080b32] tabular-nums">{card.value === null ? '—' : card.value.toLocaleString('en-IN')}</span>
              <ChevronRight className="mb-1 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
            </div>
            <p className="dashboard-metric-note mt-2 text-[11px] text-slate-400">{card.note}</p>
          </button>
        ))}
      </div>



      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.88fr]">
        <section className="dashboard-content-card rounded-xl border border-[#dfe5f0] bg-white p-5 shadow-[0_1px_3px_rgba(8,11,50,.035)]">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="dashboard-card-heading text-sm font-bold text-[#080b32]">Lead pipeline overview</h2><p className="dashboard-card-description mt-1 text-xs text-slate-400">Current distribution by lead status</p></div>
            <button type="button" onClick={() => onNavigate('crm')} className="dashboard-card-link inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[#0848ef] hover:text-blue-700">View CRM <ArrowRight className="h-3.5 w-3.5" /></button>
          </div>
          {leads.length === 0 ? (
            <div className="flex min-h-[190px] flex-col items-center justify-center text-center">
              <span className="dashboard-card-icon flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-[#0848ef]"><Users className="h-5 w-5" /></span>
              <p className="dashboard-card-subheading mt-3 text-sm font-semibold text-slate-700">Your pipeline is ready</p>
              <p className="dashboard-card-description mt-1 max-w-xs text-xs text-slate-400">Add your first lead to see its progress here.</p>
              <button type="button" onClick={onAddLead} className="dashboard-card-link mt-3 text-xs font-bold text-[#0848ef] hover:text-[#0848ef]">Add your first lead</button>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {pipeline.map((stage) => {
                const percentage = Math.round((stage.count / leads.length) * 100);
                return <div key={stage.key}>
                  <div className="dashboard-pipeline-label mb-1.5 flex items-center justify-between gap-3 text-[11px]"><span className="font-semibold uppercase tracking-wide text-slate-600">{stage.label}</span><span className="shrink-0 font-medium tabular-nums text-slate-500">{stage.count} · {percentage}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={'dashboard-pipeline-bar h-full rounded-full ' + stage.color} style={{ width: String(percentage) + '%' }} /></div>
                </div>;
              })}
            </div>
          )}
        </section>

        <section className="dashboard-content-card rounded-xl border border-[#dfe5f0] bg-white p-5 shadow-[0_1px_3px_rgba(8,11,50,.035)]">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="dashboard-card-heading text-sm font-bold text-[#080b32]">Workspace activity</h2><p className="dashboard-card-description mt-1 text-xs text-slate-400">Live operational snapshot</p></div>
            <span className={summary ? "inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700" : "inline-flex items-center gap-1.5 rounded-full bg-slate-100 px-2.5 py-1 text-[10px] font-bold text-slate-500"}><span className={summary ? "h-1.5 w-1.5 rounded-full bg-emerald-500" : "h-1.5 w-1.5 rounded-full bg-slate-400"} /> {summary ? 'Live data' : 'Syncing totals'}</span>
          </div>
          <div className="mt-4 space-y-1">
            {activity.map((row) => (
              <button key={row.label} type="button" onClick={() => onNavigate(row.tab)} className="dashboard-activity-row group flex w-full items-center gap-3 rounded-xl border border-transparent px-2.5 py-3 text-left transition">
                <span className={'dashboard-card-icon flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ' + row.tone}>{row.icon}</span>
                <span className="min-w-0 flex-1"><span className="dashboard-activity-label block text-xs font-bold text-slate-800">{row.label}</span><span className="dashboard-activity-description mt-0.5 block truncate text-[11px] text-slate-400">{row.description}</span></span>
                <span className="dashboard-activity-value text-sm font-bold tabular-nums text-[#080b32]">{row.count === null ? '—' : row.count.toLocaleString('en-IN')}</span><ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.88fr]">
        <section className="dashboard-content-card self-start rounded-xl border border-[#dfe5f0] bg-white p-5 shadow-[0_1px_3px_rgba(8,11,50,.035)]">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="dashboard-card-heading text-sm font-bold text-[#080b32]">Lead acquisition trend</h2><p className="dashboard-card-description mt-1 text-xs text-slate-400">New leads created in the last six months</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-[#0848ef]"><CalendarDays className="h-3 w-3" /> Monthly</span>
          </div>
          <div className="mt-5 grid h-[150px] grid-cols-6 gap-2 sm:gap-4">
            {monthlyTrend.map((month) => {
              const height = month.count ? Math.max(12, (month.count / maxMonthlyCount) * 100) : 3;
              return <div key={month.key} className="flex min-w-0 flex-col items-center">
                <span className="dashboard-trend-value mb-2 text-[10px] font-semibold tabular-nums text-slate-500">{month.count}</span>
                <div className="flex w-full flex-1 items-end overflow-hidden rounded-t-lg bg-slate-50"><div className="dashboard-trend-bar w-full rounded-t-lg bg-gradient-to-t from-[#5d83ff] to-[#94adff] transition-all" style={{ height: String(height) + '%', opacity: month.count ? 1 : 0.22 }} /></div>
                <span className="dashboard-trend-label mt-2 text-[10px] font-medium text-slate-400">{month.label}</span>
              </div>;
            })}
          </div>
        </section>

        <section className="dashboard-content-card rounded-xl border border-[#dfe5f0] bg-white p-5 shadow-[0_1px_3px_rgba(8,11,50,.035)]">
          <div><h2 className="dashboard-card-heading text-sm font-bold text-[#080b32]">Workspace snapshot</h2><p className="dashboard-card-description mt-1 text-xs text-slate-400">Live totals from connected modules</p></div>
          <div className="mt-4 space-y-2">
            {[
              { label: 'Leads in CRM', value: leads.length, tone: 'bg-orange-50 text-[#0848ef]' },
              { label: 'Total conversations', value: summary?.totalConversations ?? null, tone: 'bg-blue-50 text-[#0848ef]' },
              { label: 'Email campaigns', value: summary?.totalCampaigns ?? null, tone: 'bg-sky-50 text-sky-700' },
              { label: 'Campaign recipients', value: summary?.campaignLeads ?? null, tone: 'bg-cyan-50 text-cyan-700' },
              { label: 'Emails sent', value: summary?.emailsSent ?? null, tone: 'bg-violet-50 text-violet-700' },
              { label: 'Pending emails', value: summary?.pendingEmails ?? null, tone: 'bg-amber-50 text-amber-700' },
              { label: 'Replies received', value: summary?.replies ?? null, tone: 'bg-emerald-50 text-emerald-700' },
              { label: 'Campaign demos booked', value: summary?.demosBooked ?? null, tone: 'bg-amber-50 text-amber-700' },
              { label: 'Failed emails', value: summary?.failedEmails ?? null, tone: 'bg-rose-50 text-rose-700' },
            ].map((item) => <div key={item.label} className={'dashboard-snapshot-row flex items-center justify-between rounded-xl px-3.5 py-3 ' + item.tone}><span className="dashboard-snapshot-label text-xs font-semibold">{item.label}</span><span className="dashboard-snapshot-value text-sm font-bold tabular-nums">{item.value === null ? '—' : item.value.toLocaleString('en-IN')}</span></div>)}
          </div>
          <button type="button" onClick={() => onNavigate('campaign-reports')} className="dashboard-card-link mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#0848ef] hover:text-blue-700">Open campaign reports <ArrowUpRight className="h-3.5 w-3.5" /></button>
        </section>
      </div>

      {summaryError && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-xs text-amber-900">
          Some workspace-wide totals could not be refreshed. Values shown as a dash are unavailable, not zero. {summaryError}
        </div>
      )}

      <section className="dashboard-content-card overflow-hidden rounded-xl border border-[#dfe5f0] bg-white shadow-[0_1px_3px_rgba(8,11,50,.035)]">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div><h2 className="dashboard-card-heading text-sm font-bold text-[#080b32]">Recently updated leads</h2><p className="dashboard-card-description mt-1 text-xs text-slate-400">Latest activity recorded in your CRM</p></div>
          <button type="button" onClick={() => onNavigate('crm')} className="dashboard-card-link inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-[#0848ef] hover:text-blue-700">View all leads <ArrowUpRight className="h-3.5 w-3.5" /></button>
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_100px_90px_54px] gap-3 border-y border-slate-100 px-5 py-2.5 text-[9px] font-bold uppercase tracking-[0.12em] text-slate-400 max-sm:grid-cols-[minmax(0,1fr)_76px_48px]">
          <span>Lead</span><span className="max-sm:hidden">Status</span><span>Updated</span><span className="text-right">Score</span>
        </div>
        {recentLeads.length === 0 ? (
          <div className="px-5 py-12 text-center"><p className="text-sm font-semibold text-slate-700">No leads yet</p><p className="mt-1 text-xs text-slate-400">New leads will appear here as soon as they enter your CRM.</p></div>
        ) : (
          <div className="divide-y divide-slate-100">
            {recentLeads.map((lead) => {
              const contact = contacts.find((item) => item.contactId === lead.contactId);
              const name = (contact as any)?.fullName || [contact?.firstName, contact?.lastName].filter(Boolean).join(' ') || contact?.companyName || 'Unnamed lead';
              const subline = contact?.email || contact?.phone || lead.source || 'CRM lead';
              const updated = lead.updatedAt || lead.lastActivityAt || lead.createdAt;
              return <button key={lead.leadId} type="button" onClick={() => onOpenLead(lead.leadId)} className="dashboard-recent-row grid w-full grid-cols-[minmax(0,1fr)_100px_90px_54px] items-center gap-3 border border-transparent px-5 py-3 text-left transition max-sm:grid-cols-[minmax(0,1fr)_76px_48px]">
                <span className="min-w-0"><span className="dashboard-recent-name block truncate text-xs font-bold text-slate-800">{name}</span><span className="dashboard-recent-meta mt-0.5 block truncate text-[10px] uppercase tracking-wide text-slate-400">{subline}</span></span>
                <span className="max-sm:hidden"><span className={'inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-[9px] font-bold ' + statusTone(lead.status)}>{readableStatus(lead.status)}</span></span>
                <span className="dashboard-recent-date text-[11px] text-slate-500">{shortDate(updated)}</span><span className="dashboard-recent-score text-right text-xs font-bold tabular-nums text-[#080b32]">{Number(lead.leadScore) || 0}</span>
              </button>;
            })}
          </div>
        )}
      </section>

      {/* Custom AI dashboard cards live at the end of the main dashboard. */}
      <DashboardAiCards key={tenantId} tenantId={tenantId} canUseAi={canUseAi} />

      <div className="flex items-center justify-center gap-1.5 pb-1 text-[10px] text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Updated from your workspace data</div>
      </div>
    </div>
  );
};

export default DashboardView;
