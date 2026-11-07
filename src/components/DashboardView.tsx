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
  Sparkles,
  Users,
} from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import type { Booking, Contact, Lead, OutboundCampaign } from '../types';
import type { ActiveTab } from './Navbar';

interface DashboardViewProps {
  tenantId: string;
  tenantName?: string;
  userName: string;
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
  campaigns: OutboundCampaign[];
  onNavigate: (tab: ActiveTab) => void;
  onAddLead: () => void;
  onOpenLead: (leadId: string) => void;
}

const dateValue = (value?: string) => {
  if (!value) return 0;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? parsed : 0;
};

const readableStatus = (value?: string) =>
  (value || 'NEW').split('_').map((part) => part.charAt(0) + part.slice(1).toLowerCase()).join(' ');

const statusTone = (status: string) => {
  if (status === 'CLOSED_WON' || status === 'DEMO_BOOKED') return 'bg-emerald-50 text-emerald-700 border-emerald-100';
  if (status === 'CLOSED_LOST' || status === 'NOT_INTERESTED') return 'bg-rose-50 text-rose-700 border-rose-100';
  if (status === 'FOLLOW_UP') return 'bg-amber-50 text-amber-700 border-amber-100';
  if (status === 'QUALIFIED') return 'bg-blue-50 text-blue-700 border-blue-100';
  return 'bg-orange-50 text-orange-700 border-orange-100';
};

const shortDate = (value?: string) =>
  value && dateValue(value)
    ? new Date(value).toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
    : '—';

export const DashboardView: React.FC<DashboardViewProps> = ({
  tenantId,
  tenantName,
  userName,
  leads,
  contacts,
  conversations,
  campaigns,
  onNavigate,
  onAddLead,
  onOpenLead,
}) => {
  const { brand } = useBrand();
  const [bookings, setBookings] = useState<Booking[]>([]);
  const [bookingsLoaded, setBookingsLoaded] = useState(false);

  // Demo Scheduling uses this same authenticated, tenant-scoped endpoint.
  // Refresh it periodically so AI-created and manually-created bookings appear here.
  useEffect(() => {
    let active = true;
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

  const now = Date.now();
  const activeConversations = conversations.filter(
    (conversation) => conversation.status === 'ACTIVE' || conversation.status === 'REVIEW'
  );
  const unreadMessages = conversations.reduce(
    (total, conversation) => total + (Number(conversation.unreadCount) || (conversation.unread ? 1 : 0)),
    0
  );
  const handoffs = conversations.filter(
    (conversation) =>
      (conversation.humanHandoff || conversation.managementMode === 'HUMAN') &&
      conversation.status !== 'RESOLVED' &&
      conversation.status !== 'ARCHIVED'
  );

  const dueFollowUps = useMemo(() => leads.filter((lead) => {
    if (['CLOSED_WON', 'CLOSED_LOST', 'UNSUBSCRIBED', 'NOT_INTERESTED'].includes(lead.status)) return false;
    const scheduledAt = lead.aiAutoFollowUp?.status === 'scheduled'
      ? lead.aiAutoFollowUp.scheduledAt
      : lead.autoFollowUp?.enabled
        ? lead.autoFollowUp.nextScheduledAt || lead.nextFollowUpAt
        : lead.nextFollowUpAt;
    return scheduledAt ? dateValue(scheduledAt) <= now : lead.status === 'FOLLOW_UP';
  }), [leads, now]);

  const crmDemoCount = leads.filter(
    (lead) => lead.demoStatus === 'BOOKED' || lead.status === 'DEMO_BOOKED' || lead.status === 'DEMO_SCHEDULED'
  ).length;
  const scheduledDemoCount = bookingsLoaded
    ? bookings.filter((booking) => {
        if (booking.status !== 'BOOKED') return false;
        const startsAt = booking.startDateTimeIso ||
          (booking.date && booking.startTime ? booking.date + 'T' + booking.startTime + ':00+05:30' : '');
        return !startsAt || dateValue(startsAt) >= now;
      }).length
    : crmDemoCount;

  const stages = [
    { key: 'NEW', label: 'New', color: 'bg-slate-400' },
    { key: 'CONTACTED', label: 'Contacted', color: 'bg-blue-500' },
    { key: 'FOLLOW_UP', label: 'Follow-up', color: 'bg-amber-500' },
    { key: 'ENGAGED', label: 'Engaged', color: 'bg-orange-500' },
    { key: 'QUALIFIED', label: 'Qualified', color: 'bg-[#0848ef]' },
    { key: 'DEMO_BOOKED', label: 'Demo booked', color: 'bg-emerald-500' },
    { key: 'CLOSED_WON', label: 'Won', color: 'bg-emerald-600' },
    { key: 'CLOSED_LOST', label: 'Lost', color: 'bg-rose-400' },
  ];
  const pipeline = stages.map((stage) => ({
    ...stage,
    count: leads.filter((lead) =>
      lead.status === stage.key || (stage.key === 'DEMO_BOOKED' && lead.status === 'DEMO_SCHEDULED')
    ).length,
  })).filter((stage) => stage.count > 0);

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

  const hour = new Date().getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 17 ? 'Good afternoon' : 'Good evening';
  const workspaceName = tenantName || brand.companyName || 'Your workspace';

  const kpis = [
    { label: 'Total leads', value: leads.length, note: 'Across this workspace', icon: <Users className="h-4 w-4" />, tone: 'bg-orange-50 text-orange-600', tab: 'crm' as ActiveTab },
    { label: 'Active conversations', value: activeConversations.length, note: unreadMessages + ' unread messages', icon: <MessageCircle className="h-4 w-4" />, tone: 'bg-blue-50 text-[#0848ef]', tab: 'inbox' as ActiveTab },
    { label: 'Follow-ups due', value: dueFollowUps.length, note: 'Require attention', icon: <Clock3 className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600', tab: 'auto-followup' as ActiveTab },
    { label: 'Scheduled demos', value: scheduledDemoCount, note: 'Bookings recorded', icon: <CalendarCheck className="h-4 w-4" />, tone: 'bg-emerald-50 text-emerald-600', tab: 'scheduling' as ActiveTab },
    { label: 'Campaigns', value: campaigns.length, note: 'Created in workspace', icon: <Send className="h-4 w-4" />, tone: 'bg-sky-50 text-sky-600', tab: 'campaigns' as ActiveTab },
    { label: 'Human handoffs', value: handoffs.length, note: 'Waiting in unified inbox', icon: <Bot className="h-4 w-4" />, tone: 'bg-rose-50 text-rose-600', tab: 'inbox' as ActiveTab },
  ];

  const activity = [
    { label: 'Conversations', description: 'Review incoming messages', count: activeConversations.length, icon: <MessageCircle className="h-4 w-4" />, tone: 'bg-blue-50 text-[#0848ef]', tab: 'inbox' as ActiveTab },
    { label: 'Human handoffs', description: 'Conversations needing your team', count: handoffs.length, icon: <Activity className="h-4 w-4" />, tone: 'bg-orange-50 text-orange-600', tab: 'inbox' as ActiveTab },
    { label: 'Follow-ups due', description: 'Review pending follow-up tasks', count: dueFollowUps.length, icon: <Clock3 className="h-4 w-4" />, tone: 'bg-amber-50 text-amber-600', tab: 'auto-followup' as ActiveTab },
    { label: 'Campaigns', description: 'Manage outbound activity', count: campaigns.length, icon: <Send className="h-4 w-4" />, tone: 'bg-sky-50 text-sky-600', tab: 'campaigns' as ActiveTab },
  ];

  return (
    <div className="mx-auto w-full max-w-[1600px] space-y-6 pb-8">
      <div className="flex flex-col gap-4 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="mb-2 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-400">
            <span className="text-[#ef741a]">{workspaceName}</span>
            <span className="text-slate-300">/</span>
            <span>Overview</span>
          </div>
          <h1 className="flex flex-wrap items-center gap-2 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            {greeting}, {userName || 'there'} <Sparkles className="h-5 w-5 fill-[#ef741a] text-[#ef741a]" />
          </h1>
          <p className="mt-1 text-sm text-slate-500">Here’s what’s happening across your workspace today.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button type="button" onClick={onAddLead} className="inline-flex items-center gap-2 rounded-xl border border-slate-200 bg-white px-4 py-2.5 text-xs font-bold text-slate-700 shadow-sm transition hover:border-orange-200 hover:bg-orange-50 hover:text-orange-700">
            <Plus className="h-4 w-4" /> Add lead
          </button>
          <button type="button" onClick={() => onNavigate('campaigns')} className="inline-flex items-center gap-2 rounded-xl bg-[#0848ef] px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-blue-700">
            Create campaign <ArrowUpRight className="h-4 w-4" />
          </button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
        {kpis.map((card) => (
          <button key={card.label} type="button" onClick={() => onNavigate(card.tab)} className="group min-h-[142px] rounded-2xl border border-slate-200/80 bg-white p-4 text-left shadow-[0_2px_10px_rgba(15,23,42,0.025)] transition hover:-translate-y-0.5 hover:border-slate-300 hover:shadow-md sm:p-5">
            <div className="flex items-center justify-between">
              <span className="text-xs font-medium text-slate-500">{card.label}</span>
              <span className={'flex h-9 w-9 items-center justify-center rounded-xl ' + card.tone}>{card.icon}</span>
            </div>
            <div className="mt-4 flex items-end justify-between">
              <span className="text-3xl font-bold leading-none tracking-tight text-slate-950 tabular-nums">{card.value.toLocaleString('en-IN')}</span>
              <ChevronRight className="mb-1 h-4 w-4 text-slate-300 transition group-hover:translate-x-0.5 group-hover:text-slate-500" />
            </div>
            <p className="mt-2 text-[11px] text-slate-400">{card.note}</p>
          </button>
        ))}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.88fr]">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-sm font-bold text-slate-900">Lead pipeline overview</h2><p className="mt-1 text-xs text-slate-400">Current distribution by lead status</p></div>
            <button type="button" onClick={() => onNavigate('crm')} className="inline-flex shrink-0 items-center gap-1 text-xs font-bold text-[#0848ef] hover:text-blue-700">View CRM <ArrowRight className="h-3.5 w-3.5" /></button>
          </div>
          {leads.length === 0 ? (
            <div className="flex min-h-[190px] flex-col items-center justify-center text-center">
              <span className="flex h-11 w-11 items-center justify-center rounded-2xl bg-orange-50 text-[#ef741a]"><Users className="h-5 w-5" /></span>
              <p className="mt-3 text-sm font-semibold text-slate-700">Your pipeline is ready</p>
              <p className="mt-1 max-w-xs text-xs text-slate-400">Add your first lead to see its progress here.</p>
              <button type="button" onClick={onAddLead} className="mt-3 text-xs font-bold text-[#ef741a] hover:text-orange-700">Add your first lead</button>
            </div>
          ) : (
            <div className="mt-6 space-y-4">
              {pipeline.map((stage) => {
                const percentage = Math.round((stage.count / leads.length) * 100);
                return <div key={stage.key}>
                  <div className="mb-1.5 flex items-center justify-between gap-3 text-[11px]"><span className="font-semibold uppercase tracking-wide text-slate-600">{stage.label}</span><span className="shrink-0 font-medium tabular-nums text-slate-500">{stage.count} · {percentage}%</span></div>
                  <div className="h-2 overflow-hidden rounded-full bg-slate-100"><div className={'h-full rounded-full ' + stage.color} style={{ width: String(percentage) + '%' }} /></div>
                </div>;
              })}
            </div>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
          <div className="flex items-center justify-between gap-3">
            <div><h2 className="text-sm font-bold text-slate-900">Workspace activity</h2><p className="mt-1 text-xs text-slate-400">Live operational snapshot</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-2.5 py-1 text-[10px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live data</span>
          </div>
          <div className="mt-4 space-y-1">
            {activity.map((row) => (
              <button key={row.label} type="button" onClick={() => onNavigate(row.tab)} className="group flex w-full items-center gap-3 rounded-xl px-2.5 py-3 text-left transition hover:bg-slate-50">
                <span className={'flex h-9 w-9 shrink-0 items-center justify-center rounded-xl ' + row.tone}>{row.icon}</span>
                <span className="min-w-0 flex-1"><span className="block text-xs font-bold text-slate-800">{row.label}</span><span className="mt-0.5 block truncate text-[11px] text-slate-400">{row.description}</span></span>
                <span className="text-sm font-bold tabular-nums text-slate-900">{row.count}</span><ChevronRight className="h-4 w-4 shrink-0 text-slate-300 transition group-hover:translate-x-0.5" />
              </button>
            ))}
          </div>
        </section>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-[1.2fr_0.88fr]">
        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
          <div className="flex items-start justify-between gap-3">
            <div><h2 className="text-sm font-bold text-slate-900">Lead acquisition trend</h2><p className="mt-1 text-xs text-slate-400">New leads created in the last six months</p></div>
            <span className="inline-flex items-center gap-1.5 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold text-[#0848ef]"><CalendarDays className="h-3 w-3" /> Monthly</span>
          </div>
          <div className="mt-5 grid h-[150px] grid-cols-6 gap-2 sm:gap-4">
            {monthlyTrend.map((month) => {
              const height = month.count ? Math.max(12, (month.count / maxMonthlyCount) * 100) : 3;
              return <div key={month.key} className="flex min-w-0 flex-col items-center">
                <span className="mb-2 text-[10px] font-semibold tabular-nums text-slate-500">{month.count}</span>
                <div className="flex w-full flex-1 items-end overflow-hidden rounded-t-lg bg-slate-50"><div className="w-full rounded-t-lg bg-gradient-to-t from-[#0848ef] to-[#4d83ff] transition-all" style={{ height: String(height) + '%', opacity: month.count ? 1 : 0.22 }} /></div>
                <span className="mt-2 text-[10px] font-medium text-slate-400">{month.label}</span>
              </div>;
            })}
          </div>
        </section>

        <section className="rounded-2xl border border-slate-200/80 bg-white p-5 shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
          <div><h2 className="text-sm font-bold text-slate-900">Workspace snapshot</h2><p className="mt-1 text-xs text-slate-400">Live totals from connected modules</p></div>
          <div className="mt-4 space-y-2">
            {[
              { label: 'Leads in CRM', value: leads.length, tone: 'bg-orange-50 text-orange-700' },
              { label: 'Conversations in inbox', value: conversations.length, tone: 'bg-blue-50 text-[#0848ef]' },
              { label: 'Campaigns', value: campaigns.length, tone: 'bg-sky-50 text-sky-700' },
            ].map((item) => <div key={item.label} className={'flex items-center justify-between rounded-xl px-3.5 py-3 ' + item.tone}><span className="text-xs font-semibold">{item.label}</span><span className="text-sm font-bold tabular-nums">{item.value.toLocaleString('en-IN')}</span></div>)}
          </div>
          <button type="button" onClick={() => onNavigate('campaign-reports')} className="mt-4 inline-flex items-center gap-1.5 text-xs font-bold text-[#0848ef] hover:text-blue-700">Open campaign reports <ArrowUpRight className="h-3.5 w-3.5" /></button>
        </section>
      </div>

      <section className="overflow-hidden rounded-2xl border border-slate-200/80 bg-white shadow-[0_2px_10px_rgba(15,23,42,0.025)]">
        <div className="flex items-center justify-between gap-3 px-5 py-4">
          <div><h2 className="text-sm font-bold text-slate-900">Recently updated leads</h2><p className="mt-1 text-xs text-slate-400">Latest activity recorded in your CRM</p></div>
          <button type="button" onClick={() => onNavigate('crm')} className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold text-[#0848ef] hover:text-blue-700">View all leads <ArrowUpRight className="h-3.5 w-3.5" /></button>
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
              return <button key={lead.leadId} type="button" onClick={() => onOpenLead(lead.leadId)} className="grid w-full grid-cols-[minmax(0,1fr)_100px_90px_54px] items-center gap-3 px-5 py-3 text-left transition hover:bg-slate-50 max-sm:grid-cols-[minmax(0,1fr)_76px_48px]">
                <span className="min-w-0"><span className="block truncate text-xs font-bold text-slate-800">{name}</span><span className="mt-0.5 block truncate text-[10px] uppercase tracking-wide text-slate-400">{subline}</span></span>
                <span className="max-sm:hidden"><span className={'inline-flex max-w-full truncate rounded-full border px-2.5 py-1 text-[9px] font-bold ' + statusTone(lead.status)}>{readableStatus(lead.status)}</span></span>
                <span className="text-[11px] text-slate-500">{shortDate(updated)}</span><span className="text-right text-xs font-bold tabular-nums text-slate-900">{Number(lead.leadScore) || 0}</span>
              </button>;
            })}
          </div>
        )}
      </section>
      <div className="flex items-center justify-center gap-1.5 pb-1 text-[10px] text-slate-400"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Updated from your workspace data</div>
    </div>
  );
};

export default DashboardView;
