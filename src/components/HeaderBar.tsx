import React from 'react';
import {
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
  Settings2,
  Activity,
  ShieldCheck,
} from 'lucide-react';
import { ActiveTab } from './Navbar';

interface HeaderBarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  currentTenant?: { id: string; name: string; plan?: string } | null;
  allTenants?: { id: string; name: string; plan?: string }[];
  onSwitchTenant?: (tenantId: string) => void;
  hideModuleNavigation?: boolean;
  isWorkspaceConnected?: boolean;
  onOpenAgentSettings?: () => void;
}

type ModuleTab = { id: ActiveTab; label: string; icon: React.ReactNode };

const TAB_TITLES: Record<ActiveTab, { title: string; icon: React.ReactNode; category: string; workspaceLabel: string; description: string }> = {
  dashboard: { title: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4" />, category: 'OVERVIEW', workspaceLabel: 'Home', description: 'Your workspace at a glance · AI-powered insights' },
  inbox: { title: 'Unified Inbox', icon: <Inbox className="h-4 w-4" />, category: 'CONVERSATION', workspaceLabel: 'Conversation', description: 'Manage conversations across your connected channels' },
  agent: { title: 'AI Agent', icon: <Sparkles className="h-4 w-4" />, category: 'HOME', workspaceLabel: 'Home', description: 'Context-aware assistant · secure execution boundary' },
  'auto-followup': { title: 'Auto Follow-Up Agent', icon: <Bot className="h-4 w-4" />, category: 'AI', workspaceLabel: 'AI', description: 'Automate timely lead follow-ups' },
  scheduling: { title: 'Demo Scheduling Agent', icon: <Calendar className="h-4 w-4" />, category: 'AI', workspaceLabel: 'AI', description: 'Coordinate demos and consultations' },
  playground: { title: 'AI Testing', icon: <Sparkles className="h-4 w-4" />, category: 'AI', workspaceLabel: 'AI', description: 'Test AI responses and agent workflows' },
  crm: { title: 'CRM', icon: <Users className="h-4 w-4" />, category: 'SALES', workspaceLabel: 'Sales', description: 'Manage leads, contacts and sales activity' },
  campaigns: { title: 'Campaigns', icon: <Send className="h-4 w-4" />, category: 'MARKETING', workspaceLabel: 'Marketing', description: 'Create, organize and measure campaigns' },
  'email-design-studio': { title: 'Template Studio', icon: <Mail className="h-4 w-4" />, category: 'MARKETING', workspaceLabel: 'Marketing', description: 'Design and manage reusable email templates' },
  'campaign-reports': { title: 'AI Campaign Report', icon: <FileBarChart className="h-4 w-4" />, category: 'MARKETING', workspaceLabel: 'Marketing', description: 'Understand campaign performance and results' },
  database: { title: 'Database', icon: <Database className="h-4 w-4" />, category: 'DATABASE', workspaceLabel: 'Database', description: 'Organize lead databases and audience records' },
  knowledge: { title: 'Knowledge Base', icon: <BookOpen className="h-4 w-4" />, category: 'KNOWLEDGE', workspaceLabel: 'Knowledge Base', description: 'Manage verified information for your AI Agent' },
  workspace: { title: 'Workspace', icon: <Building2 className="h-4 w-4" />, category: 'WORKSPACE', workspaceLabel: 'Workspace', description: 'Company profile, channels, team and preferences' },
  settings: { title: 'Workspace', icon: <Building2 className="h-4 w-4" />, category: 'WORKSPACE', workspaceLabel: 'Workspace', description: 'Company profile, channels, team and preferences' },
  'company-profile': { title: 'Company Profile', icon: <Building2 className="h-4 w-4" />, category: 'WORKSPACE', workspaceLabel: 'Workspace', description: 'Business identity, brand and company information' },
  'audit-logs': { title: 'Audit & Security', icon: <ShieldCheck className="h-4 w-4" />, category: 'WORKSPACE', workspaceLabel: 'Workspace', description: 'Workspace activity and security history' },
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

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  setActiveTab,
  currentTenant,
  allTenants = [],
  onSwitchTenant,
  hideModuleNavigation = false,
  isWorkspaceConnected = true,
  onOpenAgentSettings,
}) => {
  const meta = TAB_TITLES[activeTab] || TAB_TITLES.dashboard;
  const moduleTabs = MODULE_TABS[activeTab] || [];

  return (
    <header className="app-module-header sticky top-0 z-30 shrink-0">
      <div className="app-module-header-main flex min-h-[76px] items-center justify-between gap-3 px-4 text-white sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="app-module-orb relative h-10 w-10 shrink-0" aria-hidden="true">
            <span className="app-module-orb-core absolute inset-[25%] rounded-full" />
            <span className="app-module-orb-ring absolute inset-[7%] rounded-full" />
            <span className="app-module-orb-ring app-module-orb-ring-outer absolute inset-0 rounded-full" />
            <span className="absolute inset-[42%] rounded-full bg-white/90 blur-[1px]" />
          </div>
          <div className="min-w-0">
            <div className="flex min-w-0 items-center gap-2">
              <h1 className="truncate text-[16px] font-bold leading-tight tracking-[-.025em] text-white sm:text-[17px]">{meta.title}</h1>
              <span className="app-module-header-badge shrink-0 rounded-full px-2 py-1 text-[8px] font-bold uppercase tracking-[.19em]">Workspace</span>
            </div>
            <p className="mt-1 truncate text-[10px] leading-4 text-slate-400 sm:text-[11px]">{meta.description}</p>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2 sm:gap-2.5">
          {allTenants.length > 1 && onSwitchTenant && (
            <label className="app-module-tenant-switch hidden items-center rounded-xl px-2.5 py-2 text-[10px] text-slate-200 lg:flex">
              <span className="mr-2 text-slate-400">Workspace</span>
              <select value={currentTenant?.id || ''} onChange={(event) => onSwitchTenant(event.target.value)}
                className="max-w-[145px] bg-transparent font-semibold text-white outline-none" aria-label="Switch workspace">
                {allTenants.map((item) => <option key={item.id} value={item.id} className="text-slate-900">{item.name} ({item.plan || 'growth'})</option>)}
              </select>
            </label>
          )}
          <div className={'app-module-connected hidden items-center gap-1.5 rounded-full px-3 py-2 text-[10px] font-medium sm:flex ' + (isWorkspaceConnected ? 'is-connected' : 'is-disconnected')}>
            <span className="h-1.5 w-1.5 rounded-full" />
            {isWorkspaceConnected ? 'Workspace connected' : 'Connecting workspace'}
          </div>
          <button type="button" onClick={() => activeTab === 'agent' ? onOpenAgentSettings?.() : setActiveTab('workspace')}
            aria-label="Open settings" title="Settings"
            className="app-module-header-action inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[11px] font-semibold">
            <Settings2 className="h-4 w-4" /><span className="hidden sm:inline">Settings</span>
          </button>
          <button type="button" onClick={() => setActiveTab('audit-logs')}
            aria-label="Open activity and audit history" title="Activity"
            className="app-module-header-action app-module-header-icon rounded-xl p-2">
            <Activity className="h-4 w-4" />
          </button>
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
