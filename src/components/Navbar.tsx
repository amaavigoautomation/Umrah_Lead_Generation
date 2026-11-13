import React, { useState } from 'react';
import {
  LayoutDashboard,
  MessageSquare,
  Bot,
  Users,
  Send,
  Database,
  BookOpen,
  Building2,
  Lock,
  LogOut,
  Shield,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { AppUser } from '../types';
import { Umrah360Logo } from './Umrah360Logo';
import { useBrand } from '../context/BrandContext';

export type ActiveTab =
  | 'dashboard'
  | 'inbox'
  | 'campaigns'
  | 'email-design-studio'
  | 'crm'
  | 'scheduling'
  | 'knowledge'
  | 'playground'
  | 'workspace'
  | 'settings'
  | 'auto-followup'
  | 'audit-logs'
  | 'database'
  | 'campaign-reports'
  | 'company-profile'
  | 'agent';

export interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  unreadCount: number;
  handoffCount: number;
  isFirebaseActive: boolean;
  currentUser?: AppUser | null;
  onLogout?: () => void;
  currentTenant?: { id: string; name: string; plan?: string; status?: string } | null;
  allTenants?: { id: string; name: string; plan?: string; status?: string }[];
  onSwitchTenant?: (tenantId: string) => void;
  planLocked?: (tabId: ActiveTab) => boolean;
  isCollapsed?: boolean;
  onToggleCollapse?: () => void;
}

type PrimaryNavItem = {
  id: string;
  label: string;
  icon: React.ReactNode;
  route: ActiveTab;
  tabs: ActiveTab[];
};

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  unreadCount,
  handoffCount,
  isFirebaseActive,
  currentUser,
  onLogout,
  currentTenant,
  allTenants = [],
  onSwitchTenant,
  planLocked,
  isCollapsed: controlledIsCollapsed,
  onToggleCollapse,
}) => {
  const { brand } = useBrand();
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(true);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);
  const isCollapsed = controlledIsCollapsed !== undefined ? controlledIsCollapsed : internalCollapsed;

  const handleToggle = () => {
    if (onToggleCollapse) onToggleCollapse();
    else setInternalCollapsed((prev) => !prev);
  };

  const isModuleAccessible = (tabId: ActiveTab): boolean => {
    if (planLocked?.(tabId)) return false;
    if (tabId === 'dashboard' || tabId === 'database' || tabId === 'workspace' || tabId === 'company-profile') return true;
    if (!currentUser) return true;
    if (currentUser.accessLevel === 'ALL' || currentUser.role === 'ADMIN') return true;
    if (tabId === 'email-design-studio' && (currentUser.allowedModules || []).includes('settings')) return true;
    return (currentUser.allowedModules || []).includes(tabId);
  };

  const primaryItems: PrimaryNavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="h-4 w-4 shrink-0" />, route: 'dashboard', tabs: ['dashboard'] },
    { id: 'conversation', label: 'Conversation', icon: <MessageSquare className="h-4 w-4 shrink-0" />, route: 'inbox', tabs: ['inbox'] },
    { id: 'ai', label: 'AI', icon: <Bot className="h-4 w-4 shrink-0" />, route: 'agent', tabs: ['agent', 'auto-followup', 'scheduling', 'playground'] },
    { id: 'sales', label: 'Sales', icon: <Users className="h-4 w-4 shrink-0" />, route: 'crm', tabs: ['crm'] },
    { id: 'marketing', label: 'Marketing', icon: <Send className="h-4 w-4 shrink-0" />, route: 'campaigns', tabs: ['campaigns', 'email-design-studio', 'campaign-reports'] },
    { id: 'database', label: 'Database', icon: <Database className="h-4 w-4 shrink-0" />, route: 'database', tabs: ['database'] },
    { id: 'knowledge', label: 'Knowledge Base', icon: <BookOpen className="h-4 w-4 shrink-0" />, route: 'knowledge', tabs: ['knowledge'] },
    { id: 'workspace', label: 'Workspace', icon: <Building2 className="h-4 w-4 shrink-0" />, route: 'workspace', tabs: ['workspace'] },
  ];

  const handleSelectTab = (tabId: ActiveTab) => {
    setActiveTab(tabId);
    setIsMobileOpen(false);
  };

  const isItemActive = (item: PrimaryNavItem) => item.tabs.includes(activeTab);
  const isItemAccessible = (item: PrimaryNavItem) => item.tabs.some((tab) => isModuleAccessible(tab));

  const activePrimaryItem = primaryItems.find((item) => isItemActive(item)) || primaryItems[0];
  const moduleLinks: { id: ActiveTab; label: string }[] = activePrimaryItem.id === 'ai'
    ? [{ id: 'agent', label: 'AI Agent' }, { id: 'auto-followup', label: 'Auto Follow-Up Agent' }, { id: 'scheduling', label: 'Demo Scheduling Agent' }, { id: 'playground', label: 'AI Testing' }]
    : activePrimaryItem.id === 'marketing'
      ? [{ id: 'campaigns', label: 'Campaigns' }, { id: 'email-design-studio', label: 'Template Studio' }, { id: 'campaign-reports', label: 'AI Campaign Report' }]
      : activePrimaryItem.id === 'conversation' ? [{ id: 'inbox', label: 'Unified Inbox' }]
      : activePrimaryItem.id === 'sales' ? [{ id: 'crm', label: 'CRM' }]
      : activePrimaryItem.id === 'database' ? [{ id: 'database', label: 'Database' }]
      : activePrimaryItem.id === 'knowledge' ? [{ id: 'knowledge', label: 'Knowledge Base' }]
      : activePrimaryItem.id === 'workspace' ? [{ id: 'workspace', label: 'Workspace' }]
      : [{ id: 'dashboard', label: 'Overview' }];

  const sidebarContent = (
    <div className="flex h-full w-full overflow-hidden bg-white text-slate-900 select-none">
      <div className="flex w-[56px] shrink-0 flex-col items-center bg-[#05051f] text-white">
        <div className="flex h-[56px] w-full items-center justify-center border-b border-white/10">
          <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} />
        </div>
        <nav aria-label="Main modules" className="flex min-h-0 flex-1 flex-col items-center gap-2 overflow-y-auto py-3">
          {primaryItems.map((item) => {
            const active = isItemActive(item);
            const accessible = isItemAccessible(item);
            const badgeCount = item.id === 'conversation' ? unreadCount : 0;
            return (
              <button key={item.id} type="button" onClick={() => handleSelectTab(item.route)} title={item.label} aria-label={item.label} aria-current={active ? 'page' : undefined}
                className={`relative flex h-10 w-10 shrink-0 items-center justify-center rounded-xl transition-colors ${active ? 'bg-[#0848ef] text-white shadow-[0_3px_10px_rgba(8,72,239,.3)]' : 'text-slate-300 hover:bg-white/10 hover:text-white'} ${!accessible ? 'opacity-45' : ''}`}>
                {item.icon}
                {badgeCount > 0 && <span className="absolute -right-0.5 -top-0.5 min-w-4 rounded-full bg-rose-500 px-1 text-[9px] font-bold leading-4 text-white">{badgeCount > 99 ? '99+' : badgeCount}</span>}
                {!accessible && <Lock className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full bg-[#05051f] text-slate-400" />}
              </button>
            );
          })}
        </nav>
        <div className="flex w-full flex-col items-center gap-2 border-t border-white/10 py-3">
          <button type="button" onClick={handleToggle} title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'} className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white">
            {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
          {onLogout && <button type="button" onClick={onLogout} title="Sign out" className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white"><LogOut className="h-4 w-4" /></button>}
        </div>
      </div>
      <div className={`flex min-w-0 flex-1 flex-col border-r border-slate-200 bg-white transition-all duration-200 ${isCollapsed ? 'w-0 max-w-0 opacity-0' : 'w-[230px] max-w-[230px] opacity-100'}`}>
        <div className="flex h-[56px] shrink-0 items-center border-b border-slate-200 px-5">
          <span className="truncate text-[16px] font-semibold tracking-[-.02em] text-[#080b32]">{activePrimaryItem.label === 'Dashboard' ? 'Overview' : activePrimaryItem.label}</span>
        </div>
        <div className="border-b border-slate-100 px-3 py-3">
          <div className="flex items-center gap-2 rounded-md bg-slate-50 px-2.5 py-2">
            <Shield className="h-3.5 w-3.5 shrink-0 text-[#0848ef]" />
            {allTenants.length > 1 && onSwitchTenant ? (
              <select value={currentTenant?.id || ''} onChange={(event) => onSwitchTenant(event.target.value)} className="min-w-0 flex-1 bg-transparent text-[11px] font-semibold text-slate-700 focus:outline-none" aria-label="Switch workspace">
                {allTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.plan || 'growth'})</option>)}
              </select>
            ) : <span className="min-w-0 flex-1 truncate text-[11px] font-semibold text-slate-700">{currentTenant?.name || brand.companyName || 'Workspace'}</span>}
            <span className="shrink-0 rounded bg-blue-50 px-1.5 py-0.5 text-[8px] font-bold uppercase text-[#0848ef]">{currentTenant?.plan || 'Enterprise'}</span>
          </div>
        </div>
        <nav aria-label={activePrimaryItem.label + ' navigation'} className="min-h-0 flex-1 overflow-y-auto px-3 py-4">
          <p className="mb-2 px-2 text-[9px] font-bold uppercase tracking-[.16em] text-slate-400">{activePrimaryItem.label === 'Dashboard' ? 'Workspace' : activePrimaryItem.label}</p>
          <div className="space-y-1">
            {moduleLinks.map((link) => {
              const active = link.id === activeTab;
              const accessible = isModuleAccessible(link.id);
              return <button key={link.id} type="button" onClick={() => handleSelectTab(link.id)} aria-current={active ? 'page' : undefined}
                className={`flex min-h-[34px] w-full items-center justify-between rounded-lg px-3 text-left text-[11px] transition-colors ${active ? 'bg-[#eaf0ff] font-semibold text-[#0848ef]' : 'text-slate-700 hover:bg-slate-100'} ${!accessible ? 'opacity-50' : ''}`}>
                <span className="truncate">{link.label}</span>{!accessible && <Lock className="h-3 w-3 shrink-0 text-slate-400" />}
              </button>;
            })}
          </div>
        </nav>
        <div className="shrink-0 border-t border-slate-100 px-4 py-3">
          {currentUser && <div className="flex min-w-0 items-center gap-2">
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-[#eaf0ff] text-[10px] font-bold text-[#0848ef]">{(currentUser.name || 'U').slice(0,1).toUpperCase()}</span>
            <span className="min-w-0"><span className="block truncate text-[10px] font-semibold text-slate-800">{currentUser.name}</span><span className="block text-[8px] font-bold uppercase text-slate-400">{currentUser.role === 'ADMIN' ? 'Admin' : currentUser.role}</span></span>
          </div>}
        </div>
      </div>
    </div>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-slate-200 bg-white px-4 py-2.5 shadow-2xs md:hidden">
        <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} />
        <div className="flex items-center gap-2">
          {unreadCount > 0 && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">{unreadCount}</span>}
          <button type="button" onClick={() => setIsMobileOpen(true)} className="rounded-xl border border-slate-200 p-2 text-slate-700 hover:bg-slate-100" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      <aside className={`sticky top-0 z-40 hidden h-screen shrink-0 transition-all duration-200 md:block ${isCollapsed ? 'w-[56px]' : 'w-[286px]'}`}>
        {sidebarContent}
      </aside>

      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button type="button" aria-label="Close navigation" onClick={() => setIsMobileOpen(false)} className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]" />
          <div className="relative z-10 h-full w-64 max-w-[85vw] shadow-2xl">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};

export default Navbar;
