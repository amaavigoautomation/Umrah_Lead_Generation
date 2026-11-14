import React, { useEffect, useMemo, useRef, useState } from 'react';
import {
  Radio,
  MessageSquare,
  LogOut,
  LayoutDashboard,
  Send,
  Users,
  Calendar,
  BookOpen,
  Sparkles,
  Bot,
  Database,
  FileBarChart,
  Building2,
  Mail,
  Inbox,
  Settings,
  ShieldCheck,
  Search,
  CircleHelp,
  ChevronDown,
  ChevronRight,
  Grid2X2,
  X,
} from 'lucide-react';
import { useBrand } from '../context/BrandContext';
import { ActiveTab } from './Navbar';
import { AppUser } from '../types';
import { useConnectedChannels } from '../hooks/useConnectedChannels';

interface HeaderBarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  unreadCount: number;
  handoffCount: number;
  tenantId?: string;
  currentUser?: AppUser | null;
  onLogout?: () => void;
  currentTenant?: { id: string; name: string; plan?: string; planName?: string; limits?: Record<string, number>; contactLimit?: number; maxContacts?: number } | null;
  contactCount?: number;
  entitlements?: { planName?: string; limits?: Record<string, number>; billing?: { status?: string; locked?: boolean; graceEndsAt?: string } } | null;
  planLocked?: (tabId: ActiveTab) => boolean;
  allTenants?: { id: string; name: string; plan?: string }[];
  onSwitchTenant?: (tenantId: string) => void;
  hideModuleNavigation?: boolean;
}

type ModuleTab = { id: ActiveTab; label: string; icon: React.ReactNode };

const TAB_TITLES: Record<ActiveTab, { title: string; icon: React.ReactNode; category: string; workspaceLabel: string }> = {
  dashboard: { title: 'Home', icon: <LayoutDashboard className="h-4 w-4" />, category: 'HOME', workspaceLabel: 'Home' },
  inbox: { title: 'Unified Inbox', icon: <Inbox className="h-4 w-4" />, category: 'CONVERSATION', workspaceLabel: 'Conversation' },
  agent: { title: 'AI Agent', icon: <Sparkles className="h-4 w-4" />, category: 'HOME', workspaceLabel: 'Home' },
  'auto-followup': { title: 'Auto Follow-Up Agent', icon: <Bot className="h-4 w-4" />, category: 'AI & AUTOMATION', workspaceLabel: 'AI' },
  scheduling: { title: 'Demo Scheduling Agent', icon: <Calendar className="h-4 w-4" />, category: 'AI & AUTOMATION', workspaceLabel: 'AI' },
  playground: { title: 'AI Testing', icon: <Sparkles className="h-4 w-4" />, category: 'AI & AUTOMATION', workspaceLabel: 'AI' },
  crm: { title: 'CRM', icon: <Users className="h-4 w-4" />, category: 'SALES', workspaceLabel: 'Sales' },
  campaigns: { title: 'Campaigns', icon: <Send className="h-4 w-4" />, category: 'GROWTH & MARKETING', workspaceLabel: 'Marketing' },
  'email-design-studio': { title: 'Template Studio', icon: <Mail className="h-4 w-4" />, category: 'GROWTH & MARKETING', workspaceLabel: 'Marketing' },
  'campaign-reports': { title: 'AI Campaign Report', icon: <FileBarChart className="h-4 w-4" />, category: 'GROWTH & MARKETING', workspaceLabel: 'Marketing' },
  database: { title: 'Database', icon: <Database className="h-4 w-4" />, category: 'DATA MANAGEMENT', workspaceLabel: 'Database' },
  knowledge: { title: 'Knowledge Base', icon: <BookOpen className="h-4 w-4" />, category: 'AI KNOWLEDGE', workspaceLabel: 'Knowledge Base' },
  workspace: { title: 'Workspace', icon: <Building2 className="h-4 w-4" />, category: 'WORKSPACE SETTINGS', workspaceLabel: 'Workspace' },
  settings: { title: 'Workspace', icon: <Settings className="h-4 w-4" />, category: 'WORKSPACE SETTINGS', workspaceLabel: 'Workspace' },
  'company-profile': { title: 'Workspace', icon: <Building2 className="h-4 w-4" />, category: 'WORKSPACE SETTINGS', workspaceLabel: 'Workspace' },
  'audit-logs': { title: 'Workspace', icon: <ShieldCheck className="h-4 w-4" />, category: 'WORKSPACE SETTINGS', workspaceLabel: 'Workspace' },
};

const AI_TABS: ModuleTab[] = [
  { id: 'auto-followup', label: 'Auto Follow-Up Agent', icon: <Bot className="h-3.5 w-3.5" /> },
  { id: 'scheduling', label: 'Demo Scheduling Agent', icon: <Calendar className="h-3.5 w-3.5" /> },
  { id: 'playground', label: 'AI Testing', icon: <Sparkles className="h-3.5 w-3.5" /> },
];
const MARKETING_TABS: ModuleTab[] = [
  { id: 'campaigns', label: 'Campaigns', icon: <Send className="h-3.5 w-3.5" /> },
  { id: 'email-design-studio', label: 'Template Studio', icon: <Mail className="h-3.5 w-3.5" /> },
  { id: 'campaign-reports', label: 'AI Campaign Report', icon: <FileBarChart className="h-3.5 w-3.5" /> },
];

const MODULE_TABS: Partial<Record<ActiveTab, ModuleTab[]>> = {
  'auto-followup': AI_TABS,
  scheduling: AI_TABS,
  playground: AI_TABS,
  crm: [{ id: 'crm', label: 'CRM', icon: <Users className="h-3.5 w-3.5" /> }],
  campaigns: MARKETING_TABS,
  'email-design-studio': MARKETING_TABS,
  'campaign-reports': MARKETING_TABS,
  dashboard: [{ id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-3.5 w-3.5" /> }],
  database: [{ id: 'database', label: 'Database', icon: <Database className="h-3.5 w-3.5" /> }],
  knowledge: [{ id: 'knowledge', label: 'Knowledge Base', icon: <BookOpen className="h-3.5 w-3.5" /> }],
  workspace: [{ id: 'workspace', label: 'Workspace', icon: <Building2 className="h-3.5 w-3.5" /> }],
  settings: [{ id: 'workspace', label: 'Workspace', icon: <Building2 className="h-3.5 w-3.5" /> }],
  'company-profile': [{ id: 'workspace', label: 'Workspace', icon: <Building2 className="h-3.5 w-3.5" /> }],
  'audit-logs': [{ id: 'workspace', label: 'Workspace', icon: <Building2 className="h-3.5 w-3.5" /> }],
};

const APP_SHORTCUTS: ModuleTab[] = [
  { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" /> },
  { id: 'inbox', label: 'Unified Inbox', icon: <Inbox className="h-4 w-4" /> },
  { id: 'agent', label: 'AI Agent', icon: <Sparkles className="h-4 w-4" /> },
  { id: 'crm', label: 'CRM', icon: <Users className="h-4 w-4" /> },
  { id: 'campaigns', label: 'Campaigns', icon: <Send className="h-4 w-4" /> },
  { id: 'email-design-studio', label: 'Template Studio', icon: <Mail className="h-4 w-4" /> },
  { id: 'campaign-reports', label: 'Campaign Reports', icon: <FileBarChart className="h-4 w-4" /> },
  { id: 'database', label: 'Lead Database', icon: <Database className="h-4 w-4" /> },
  { id: 'knowledge', label: 'Knowledge Base', icon: <BookOpen className="h-4 w-4" /> },
  { id: 'workspace', label: 'Workspace', icon: <Building2 className="h-4 w-4" /> },
];

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  setActiveTab,
  unreadCount,
  handoffCount,
  tenantId,
  currentUser,
  onLogout,
  currentTenant,
  allTenants = [],
  onSwitchTenant,
  hideModuleNavigation = false,
  contactCount = 0,
  entitlements,
  planLocked,
}) => {
  const { brand } = useBrand();
  const { mailbox: connectedMailbox, whatsapp: connectedWhatsApp } = useConnectedChannels(tenantId);
  const meta = TAB_TITLES[activeTab] || TAB_TITLES.dashboard;
  const moduleTabs = MODULE_TABS[activeTab] || [];
  const workspaceName = brand.companyName || currentTenant?.name || 'UMRAH360';
  const [activePopover, setActivePopover] = useState<'search' | 'help' | 'account' | null>(null);
  const [appsExpanded, setAppsExpanded] = useState(false);
  const [moduleQuery, setModuleQuery] = useState('');
  const [usage, setUsage] = useState<{ dailySent: number; dailyLimit: number } | null>(null);
  const actionsRef = useRef<HTMLDivElement>(null);
  const moduleSearchRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!tenantId) {
      setUsage(null);
      return;
    }
    let active = true;
    const loadUsage = async () => {
      try {
        const todayUtc = new Date().toISOString().slice(0, 10);
        const params = new URLSearchParams({ from: todayUtc, to: todayUtc });
        const response = await fetch(`/api/tenants/${encodeURIComponent(tenantId)}/usage?${params.toString()}`);
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data?.error || 'Usage unavailable');
        if (active) {
          setUsage({
            dailySent: Math.max(0, Number(data?.dailyUsage?.emailSentCount) || 0),
            dailyLimit: Math.max(0, Number(data?.limits?.dailyOutboundSends) || 0),
          });
        }
      } catch {
        // Keep the last successfully loaded usage visible if a temporary refresh fails.
      }
    };
    void loadUsage();
    const interval = window.setInterval(() => {
      if (document.visibilityState === 'visible') void loadUsage();
    }, 60_000);
    return () => {
      active = false;
      window.clearInterval(interval);
    };
  }, [tenantId]);

  useEffect(() => {
    if (!activePopover) return;
    const handlePointer = (event: MouseEvent) => {
      if (actionsRef.current && !actionsRef.current.contains(event.target as Node)) {
        setActivePopover(null);
        setAppsExpanded(false);
      }
    };
    const handleKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setActivePopover(null);
        setAppsExpanded(false);
      }
    };
    document.addEventListener('mousedown', handlePointer);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handlePointer);
      document.removeEventListener('keydown', handleKey);
    };
  }, [activePopover]);

  useEffect(() => {
    if (activePopover === 'search') moduleSearchRef.current?.focus();
  }, [activePopover]);

  const availableApps = useMemo(() => {
    const isAdmin = currentUser?.role === 'ADMIN' || currentUser?.accessLevel === 'ALL';
    return APP_SHORTCUTS.filter((item) => {
      const allowed = isAdmin ||
        item.id === 'dashboard' ||
        item.id === 'database' ||
        item.id === 'workspace' ||
        (currentUser?.allowedModules || []).includes(item.id) ||
        (item.id === 'email-design-studio' && (currentUser?.allowedModules || []).includes('settings'));
      return allowed && !planLocked?.(item.id);
    });
  }, [currentUser, planLocked]);

  const filteredApps = useMemo(() => {
    const query = moduleQuery.trim().toLowerCase();
    return query ? availableApps.filter((item) => item.label.toLowerCase().includes(query)) : availableApps;
  }, [availableApps, moduleQuery]);

  const openPopover = (name: 'search' | 'help' | 'account') => {
    setActivePopover((current) => current === name ? null : name);
    if (name !== 'account') setAppsExpanded(false);
  };
  const navigateAndClose = (tab: ActiveTab) => {
    setActiveTab(tab);
    setActivePopover(null);
    setAppsExpanded(false);
    setModuleQuery('');
  };
  const firstName = (currentUser?.name || currentUser?.email || 'User').trim();
  const initials = firstName.split(/\\s+/).filter(Boolean).slice(0, 2).map((part) => part[0]?.toUpperCase()).join('') || 'U';
  const billingStatus = entitlements?.billing?.status || '';
  const rawPlanName = entitlements?.planName || currentTenant?.planName || currentTenant?.plan || '';
  const formattedPlanName = rawPlanName
    ? rawPlanName.replace(/[_-]+/g, ' ').replace(/^./, (letter) => letter.toUpperCase())
    : 'Workspace plan';
  const planLabel = billingStatus === 'trialing'
    ? 'Trial Plan'
    : formattedPlanName.toLowerCase().includes('plan') ? formattedPlanName : `${formattedPlanName} Plan`;
  const contactLimitRaw =
    entitlements?.limits?.contacts ??
    currentTenant?.limits?.contacts ??
    currentTenant?.contactLimit ??
    currentTenant?.maxContacts;
  const contactLimit = Number(contactLimitRaw);
  const hasContactLimit = contactLimitRaw !== undefined && contactLimitRaw !== null && Number.isFinite(contactLimit) && contactLimit > 0;
  const sendingLimit = Number(usage?.dailyLimit || entitlements?.limits?.dailyOutboundSends || currentTenant?.limits?.dailyOutboundSends || 0);
  const dailySent = usage?.dailySent ?? 0;
  const contactPercent = hasContactLimit ? Math.min(100, Math.round((contactCount / contactLimit) * 100)) : 0;
  const sendingPercent = sendingLimit > 0 ? Math.min(100, Math.round((dailySent / sendingLimit) * 100)) : 0;
  const planTone = billingStatus === 'past_due' || billingStatus === 'awaiting_plan'
    ? 'border-amber-200 bg-amber-50 text-amber-800'
    : billingStatus === 'trialing'
      ? 'border-blue-200 bg-blue-50 text-blue-700'
      : 'border-emerald-200 bg-emerald-50 text-emerald-700';

  const popoverButtonClass = 'inline-flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/[.045] text-slate-300 transition hover:border-white/20 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400';

  return (
    <header className="sticky top-0 z-30 shrink-0 border-b border-slate-200 bg-white">
      <div className="flex min-h-[56px] items-center justify-between gap-4 bg-[#05051f] px-4 text-white sm:px-6">
        <div className="flex min-w-0 items-center gap-4">
          <div className="min-w-0">
            <div className="mb-0.5 flex items-center gap-2 text-[8px] font-bold uppercase tracking-[0.2em] text-slate-400">
              <span className="truncate">{workspaceName}</span>
              <span className="text-slate-300">/</span>
              <span className="truncate">{meta.category}</span>
            </div>
            <div className="flex items-center gap-2 text-[14px] font-semibold leading-tight text-white">
              <span className="text-[#6f9aff]">{meta.icon}</span>
              <h1 className="truncate">{meta.title}</h1>
            </div>
          </div>
        </div>

        <div className="flex min-w-0 shrink-0 items-center gap-2 text-xs sm:gap-3">
          {allTenants.length > 1 && onSwitchTenant && (
            <label className="hidden items-center rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] text-slate-200 sm:flex">
              <span className="mr-2 text-slate-400">Workspace</span>
              <select value={currentTenant?.id || ''} onChange={(event) => onSwitchTenant(event.target.value)}
                className="max-w-[150px] bg-transparent font-semibold text-white outline-none" aria-label="Switch workspace">
                {allTenants.map((item) => <option key={item.id} value={item.id} className="text-slate-900">{item.name} ({item.plan || 'growth'})</option>)}
              </select>
            </label>
          )}
          {activeTab !== 'inbox' && connectedMailbox && (
            <div title={"Connected mailbox: " + connectedMailbox} className="hidden max-w-[190px] items-center gap-1.5 truncate rounded-lg border border-white/10 bg-white/[.045] px-2.5 py-1.5 text-slate-300 sm:flex">
              <Radio className="h-3.5 w-3.5 shrink-0 animate-pulse text-blue-400" />
              <span className="truncate font-mono text-[10px]">{connectedMailbox}</span>
            </div>
          )}
          {activeTab !== 'inbox' && connectedWhatsApp && (
            <button type="button" onClick={() => setActiveTab('inbox')} title={"Connected WhatsApp Business: " + connectedWhatsApp} className="hidden items-center gap-1.5 rounded-lg border border-white/10 bg-white/[.045] px-2.5 py-1.5 text-slate-300 transition hover:bg-white/10 md:flex">
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-emerald-400" />
              <span className="font-mono text-[10px]">{connectedWhatsApp}</span>
            </button>
          )}
          {activeTab !== 'inbox' && handoffCount > 0 && (
            <button type="button" onClick={() => setActiveTab('inbox')} className="flex items-center gap-1.5 rounded-full border border-amber-300/25 bg-amber-400/10 px-2.5 py-1.5 text-[10px] font-bold text-amber-100">
              <span className="h-2 w-2 animate-pulse rounded-full bg-amber-400" />
              <span>{handoffCount} Handoff</span>
            </button>
          )}

          <div ref={actionsRef} className="relative ml-1 flex shrink-0 items-center gap-1.5 sm:gap-2">
            <button type="button" onClick={() => openPopover('search')} className={popoverButtonClass} title="Search apps" aria-label="Search apps">
              <Search className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => openPopover('help')} className={popoverButtonClass} title="Help and shortcuts" aria-label="Help and shortcuts">
              <CircleHelp className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => navigateAndClose('workspace')} className={popoverButtonClass} title="Workspace settings" aria-label="Workspace settings">
              <Settings className="h-4 w-4" />
            </button>
            <button type="button" onClick={() => openPopover('account')} aria-expanded={activePopover === 'account'} aria-label="Open account menu" title="Account"
              className="ml-1 flex h-9 w-9 items-center justify-center rounded-full border border-white/20 bg-white/10 text-[11px] font-extrabold text-white shadow-inner transition hover:border-blue-300 hover:bg-white/15 focus-visible:outline focus-visible:outline-2 focus-visible:outline-blue-400">
              {initials}
            </button>

            {activePopover === 'search' && (
              <div className="absolute right-0 top-[calc(100%+12px)] z-[70] w-[min(320px,calc(100vw-24px))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-[0_18px_50px_rgba(15,23,42,.18)]">
                <div className="border-b border-slate-100 p-3">
                  <label htmlFor="header-app-search" className="mb-1.5 block text-[9px] font-bold uppercase tracking-[.12em] text-slate-400">Find a module</label>
                  <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3">
                    <Search className="h-4 w-4 text-slate-400" />
                    <input ref={moduleSearchRef} id="header-app-search" value={moduleQuery} onChange={(event) => setModuleQuery(event.target.value)} placeholder="Search your apps…" className="h-10 min-w-0 flex-1 bg-transparent text-[11px] text-slate-800 outline-none placeholder:text-slate-400" />
                    {moduleQuery && <button type="button" onClick={() => setModuleQuery('')} aria-label="Clear search" className="rounded p-1 text-slate-400 hover:bg-slate-200"><X className="h-3.5 w-3.5" /></button>}
                  </div>
                </div>
                <div className="max-h-[300px] overflow-y-auto p-2">
                  {filteredApps.length ? filteredApps.map((item) => (
                    <button key={item.id} type="button" onClick={() => navigateAndClose(item.id)} className="flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#155eef]">
                      <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500">{item.icon}</span>{item.label}
                    </button>
                  )) : <p className="px-3 py-6 text-center text-[10px] text-slate-400">No matching apps found.</p>}
                </div>
              </div>
            )}

            {activePopover === 'help' && (
              <div className="absolute right-0 top-[calc(100%+12px)] z-[70] w-[min(285px,calc(100vw-24px))] rounded-xl border border-slate-200 bg-white p-3 text-slate-800 shadow-[0_18px_50px_rgba(15,23,42,.18)]">
                <div className="mb-2">
                  <p className="text-[12px] font-bold text-slate-900">Need help?</p>
                  <p className="mt-1 text-[10px] leading-relaxed text-slate-500">Browse your workspace knowledge or open workspace settings for account and team support.</p>
                </div>
                <button type="button" onClick={() => navigateAndClose('knowledge')} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-slate-700 hover:bg-blue-50 hover:text-[#155eef]">
                  <BookOpen className="h-4 w-4" /> Knowledge Base <ChevronRight className="ml-auto h-3.5 w-3.5" />
                </button>
                <button type="button" onClick={() => navigateAndClose('workspace')} className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[11px] font-semibold text-slate-700 hover:bg-blue-50 hover:text-[#155eef]">
                  <Building2 className="h-4 w-4" /> Workspace settings <ChevronRight className="ml-auto h-3.5 w-3.5" />
                </button>
              </div>
            )}

            {activePopover === 'account' && (
              <div className="absolute right-0 top-[calc(100%+12px)] z-[70] w-[min(304px,calc(100vw-24px))] overflow-hidden rounded-xl border border-slate-200 bg-white text-slate-800 shadow-[0_18px_50px_rgba(15,23,42,.20)]">
                <div className="border-b border-slate-100 px-4 pb-3 pt-4">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="truncate text-[13px] font-bold text-slate-900">{currentUser?.name || 'Workspace member'}</p>
                      <p className="mt-0.5 truncate text-[10px] text-slate-500">{currentUser?.email || currentTenant?.name || workspaceName}</p>
                    </div>
                    <span className={`shrink-0 rounded-full border px-2 py-1 text-[9px] font-bold ${planTone}`}>{planLabel}</span>
                  </div>
                  {currentTenant?.name && <p className="mt-2 truncate text-[10px] text-slate-400">{currentTenant.name}</p>}
                </div>

                <div className="space-y-3 border-b border-slate-100 px-4 py-3">
                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-600">Contact limit</span>
                      <span className="text-[10px] font-bold tabular-nums text-slate-800">
                        {hasContactLimit ? `${contactCount.toLocaleString('en-IN')} / ${contactLimit.toLocaleString('en-IN')}` : `${contactCount.toLocaleString('en-IN')} contacts · No cap`}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: (hasContactLimit ? contactPercent : 0) + '%' }} />
                    </div>
                    {!hasContactLimit && <p className="mt-1 text-[9px] text-slate-400">A contact quota is not configured for this workspace.</p>}
                  </div>

                  <div>
                    <div className="mb-1.5 flex items-center justify-between gap-2">
                      <span className="text-[10px] font-semibold text-slate-600">Sending limit</span>
                      <span className="text-[10px] font-bold tabular-nums text-slate-800">
                        {usage ? `${dailySent.toLocaleString('en-IN')} / ${sendingLimit > 0 ? sendingLimit.toLocaleString('en-IN') : 'Unlimited'}` : 'Loading usage…'}
                      </span>
                    </div>
                    <div className="h-1.5 overflow-hidden rounded-full bg-slate-100">
                      <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: (sendingLimit > 0 ? sendingPercent : 0) + '%' }} />
                    </div>
                    <p className="mt-1 text-[9px] text-slate-400">Email sends used today (UTC)</p>
                  </div>
                </div>

                <div className="p-2">
                  <button type="button" onClick={() => setAppsExpanded((value) => !value)} aria-expanded={appsExpanded} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold text-slate-700 transition hover:bg-blue-50 hover:text-[#155eef]">
                    <Grid2X2 className="h-4 w-4" /> Apps
                    <ChevronDown className={`ml-auto h-3.5 w-3.5 transition ${appsExpanded ? 'rotate-180' : ''}`} />
                  </button>
                  {appsExpanded && (
                    <div className="grid grid-cols-2 gap-1.5 px-1 pb-2 pt-1">
                      {availableApps.map((item) => (
                        <button key={item.id} type="button" onClick={() => navigateAndClose(item.id)} className="flex min-w-0 items-center gap-2 rounded-lg border border-slate-100 px-2 py-2 text-left text-[10px] font-semibold text-slate-600 transition hover:border-blue-200 hover:bg-blue-50 hover:text-[#155eef]">
                          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md bg-slate-100 text-slate-500">{item.icon}</span>
                          <span className="truncate">{item.label}</span>
                        </button>
                      ))}
                    </div>
                  )}
                  {onLogout && (
                    <button type="button" onClick={() => { setActivePopover(null); onLogout(); }} className="flex w-full items-center gap-2 rounded-lg px-3 py-2.5 text-left text-[11px] font-semibold text-slate-600 transition hover:bg-rose-50 hover:text-rose-700">
                      <LogOut className="h-4 w-4" /> Log out
                    </button>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>

      {!hideModuleNavigation && <div className="flex min-h-[48px] items-stretch border-t border-slate-200 bg-white">
        <div className="flex w-[154px] shrink-0 flex-col justify-center border-r border-slate-200 px-5">
          <span className="text-[9px] font-extrabold uppercase tracking-[0.2em] text-[#0848ef]">Workspace</span>
          <span className="mt-0.5 truncate text-[12px] font-bold text-slate-800">{meta.workspaceLabel}</span>
        </div>
        <nav aria-label={meta.workspaceLabel + ' module navigation'} className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto px-4 py-2 [scrollbar-width:none]">
          {moduleTabs.map((tab) => {
            const active = tab.id === activeTab;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                aria-current={active ? 'page' : undefined}
                className={`inline-flex min-h-9 shrink-0 items-center gap-2 rounded-lg border px-3 py-2 text-[11px] font-semibold transition ${
                  active
                    ? 'border-[#cbd8ff] bg-[#eaf0ff] text-[#0848ef] shadow-2xs'
                    : 'border-transparent bg-transparent text-slate-600 hover:border-slate-200 hover:bg-white hover:text-slate-900'
                }`}
              >
                <span className={active ? 'text-[#0848ef]' : 'text-slate-400'}>{tab.icon}</span>
                {tab.label}
              </button>
            );
          })}
        </nav>
      </div>}
    </header>
  );
};
export default HeaderBar;
