import React from 'react';
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
  currentTenant?: { id: string; name: string; plan?: string } | null;
  allTenants?: { id: string; name: string; plan?: string }[];
  onSwitchTenant?: (tenantId: string) => void;
}

type ModuleTab = { id: ActiveTab; label: string; icon: React.ReactNode };

const TAB_TITLES: Record<ActiveTab, { title: string; icon: React.ReactNode; category: string; workspaceLabel: string }> = {
  dashboard: { title: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, category: 'OVERVIEW', workspaceLabel: 'Dashboard' },
  inbox: { title: 'Unified Inbox', icon: <Inbox className="h-4 w-4" />, category: 'CONVERSATION', workspaceLabel: 'Conversation' },
  agent: { title: 'AI Agent', icon: <Sparkles className="h-4 w-4" />, category: 'AI & AUTOMATION', workspaceLabel: 'AI' },
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
  { id: 'agent', label: 'AI Agent', icon: <Sparkles className="h-3.5 w-3.5" /> },
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
  agent: AI_TABS,
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
}) => {
  const { brand } = useBrand();
  const { mailbox: connectedMailbox, whatsapp: connectedWhatsApp } = useConnectedChannels(tenantId);
  const meta = TAB_TITLES[activeTab] || TAB_TITLES.dashboard;
  const moduleTabs = MODULE_TABS[activeTab] || [];
  const workspaceName = brand.companyName || 'UMRAH360';

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

        <div className="flex shrink-0 items-center gap-2 text-xs sm:gap-3">
          {allTenants.length > 1 && onSwitchTenant && (
            <label className="hidden items-center rounded-lg border border-white/15 bg-white/5 px-2.5 py-1.5 text-[10px] text-slate-200 sm:flex">
              <span className="mr-2 text-slate-400">Workspace</span>
              <select value={currentTenant?.id || ''} onChange={(event) => onSwitchTenant(event.target.value)}
                className="max-w-[150px] bg-transparent font-semibold text-white outline-none" aria-label="Switch workspace">
                {allTenants.map((item) => <option key={item.id} value={item.id} className="text-slate-900">{item.name} ({item.plan || 'growth'})</option>)}
              </select>
            </label>
          )}
          {connectedMailbox && (
            <div title={"Connected mailbox: " + connectedMailbox} className="hidden max-w-[190px] items-center gap-1.5 truncate rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600 sm:flex">
              <Radio className="h-3.5 w-3.5 shrink-0 animate-pulse text-blue-500" />
              <span className="truncate font-mono text-[10px]">{connectedMailbox}</span>
            </div>
          )}
          {connectedWhatsApp && (
            <button type="button" onClick={() => setActiveTab('inbox')} title={"Connected WhatsApp Business: " + connectedWhatsApp} className="hidden items-center gap-1.5 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-1.5 text-slate-600 transition hover:bg-slate-100 md:flex">
              <MessageSquare className="h-3.5 w-3.5 shrink-0 text-emerald-500" />
              <span className="font-mono text-[10px]">{connectedWhatsApp}</span>
            </button>
          )}
          {handoffCount > 0 && (
            <button type="button" onClick={() => setActiveTab('inbox')} className="flex items-center gap-1.5 rounded-full border border-orange-200 bg-orange-50 px-2.5 py-1.5 text-[10px] font-bold text-orange-800">
              <span className="h-2 w-2 animate-pulse rounded-full bg-orange-500" />
              <span>{handoffCount} Handoff</span>
            </button>
          )}
          {currentUser && onLogout && (
            <button type="button" onClick={onLogout} title="Sign out" className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-xs font-semibold text-slate-700 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600">
              <LogOut className="h-3.5 w-3.5" />
              <span className="hidden sm:inline">Sign Out</span>
            </button>
          )}
        </div>
      </div>

      <div className="flex min-h-[48px] items-stretch border-t border-slate-200 bg-white">
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
      </div>
    </header>
  );
};

export default HeaderBar;
