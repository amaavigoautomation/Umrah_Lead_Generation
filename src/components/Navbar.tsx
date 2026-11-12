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

  const sidebarContent = (
    <div className="flex h-full flex-col justify-between border-r border-slate-200/90 bg-white text-slate-800 transition-all duration-200 select-none">
      <div className="space-y-3 border-b border-slate-100 p-3">
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'justify-between'}`}>
          {!isCollapsed ? (
            <>
              <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} />
              <button
                type="button"
                onClick={handleToggle}
                className="hidden items-center justify-center rounded-lg p-1.5 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700 md:flex"
                title="Collapse navigation"
                aria-label="Collapse navigation"
              >
                <PanelLeftClose className="h-4 w-4" />
              </button>
              <button type="button" onClick={() => setIsMobileOpen(false)} className="rounded-lg p-1.5 text-slate-400 hover:bg-slate-100 md:hidden" aria-label="Close navigation">
                <X className="h-5 w-5" />
              </button>
            </>
          ) : (
            <div className="flex w-full items-center justify-center">
              {brand.logoUrl || brand.playbook === 'umrah360' ? (
                <img src={brand.logoUrl || '/amaavigo-logo.png'} alt={brand.companyName || 'Workspace'} className="h-6 max-w-[46px] object-contain" />
              ) : (
                <span className="flex h-8 w-8 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-xs font-extrabold text-orange-700">
                  {(brand.companyName || 'U').charAt(0).toUpperCase()}
                </span>
              )}
            </div>
          )}
        </div>

        {!isCollapsed && (
          <div className="flex items-center justify-between gap-2 rounded-lg border border-slate-200/80 bg-slate-50 px-2.5 py-1.5 text-xs">
            <div className="flex min-w-0 items-center gap-1.5 truncate">
              <Shield className="h-3.5 w-3.5 shrink-0 text-[#ef741a]" />
              {allTenants.length > 1 && onSwitchTenant ? (
                <select
                  value={currentTenant?.id || ''}
                  onChange={(event) => onSwitchTenant(event.target.value)}
                  className="min-w-0 cursor-pointer truncate bg-transparent text-[11px] font-semibold text-slate-800 focus:outline-none"
                  aria-label="Switch workspace"
                >
                  {allTenants.map((tenant) => <option key={tenant.id} value={tenant.id}>{tenant.name} ({tenant.plan || 'growth'})</option>)}
                </select>
              ) : (
                <span className="truncate text-[11px] font-semibold text-slate-800">{currentTenant?.name || brand.companyName}</span>
              )}
            </div>
            <span className="shrink-0 rounded border border-orange-200 bg-orange-50 px-1.5 py-0.5 text-[9px] font-bold uppercase text-orange-700">
              {currentTenant?.plan || 'Enterprise'}
            </span>
          </div>
        )}
      </div>

      <nav aria-label="Primary navigation" className="scrollbar-none flex-1 overflow-y-auto px-2 py-3">
        {!isCollapsed && <p className="mb-2 px-3 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400">Workspace</p>}
        <div className="space-y-1">
          {primaryItems.map((item) => {
            const active = isItemActive(item);
            const accessible = isItemAccessible(item);
            const badgeCount = item.id === 'conversation' ? unreadCount : 0;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => handleSelectTab(item.route)}
                title={isCollapsed ? item.label : undefined}
                aria-label={item.label}
                aria-current={active ? 'page' : undefined}
                className={`relative flex w-full items-center rounded-xl transition-all duration-150 ${
                  isCollapsed ? 'justify-center px-0 py-3' : 'justify-between px-3 py-2.5'
                } ${
                  active
                    ? 'bg-orange-50 text-orange-800 ring-1 ring-inset ring-orange-100'
                    : 'text-slate-600 hover:bg-slate-100/80 hover:text-slate-900'
                } ${!accessible ? 'opacity-50' : ''}`}
              >
                <span className={`flex min-w-0 items-center ${isCollapsed ? 'justify-center' : 'gap-3'}`}>
                  <span className={active ? 'text-orange-600' : 'text-slate-500'}>{item.icon}</span>
                  {!isCollapsed && <span className="truncate text-xs font-semibold">{item.label}</span>}
                </span>
                {!accessible ? (
                  !isCollapsed && <Lock className="h-3.5 w-3.5 shrink-0 text-orange-400" />
                ) : badgeCount > 0 ? (
                  isCollapsed ? (
                    <span className="absolute right-1 top-1 h-2 w-2 rounded-full bg-orange-500" />
                  ) : (
                    <span className="rounded-full bg-orange-500 px-1.5 py-0.5 text-[9px] font-bold text-white">{badgeCount > 99 ? '99+' : badgeCount}</span>
                  )
                ) : null}
              </button>
            );
          })}
        </div>
      </nav>

      <div className="space-y-2 border-t border-slate-200/90 bg-slate-50/60 p-2">
        <button
          type="button"
          onClick={handleToggle}
          title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          className="flex w-full items-center justify-center gap-2 rounded-xl border border-slate-200/80 bg-slate-100/90 p-2 text-xs font-semibold text-slate-600 shadow-2xs transition hover:bg-slate-200/80 hover:text-slate-900"
        >
          {isCollapsed ? <ChevronRight className="h-4 w-4 text-orange-600" /> : <><ChevronLeft className="h-4 w-4 text-orange-600" /><span>Collapse</span></>}
        </button>

        {!isCollapsed && currentUser && (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-slate-200/80 bg-white p-2 shadow-2xs">
            <div className="flex min-w-0 flex-col">
              <span className="truncate text-xs font-bold leading-tight text-slate-900">{currentUser.name}</span>
              <span className="text-[9px] font-bold text-orange-700">{currentUser.role === 'ADMIN' ? 'ADMIN' : currentUser.role}</span>
            </div>
            {onLogout && (
              <button type="button" onClick={onLogout} title="Sign out" aria-label="Sign out" className="shrink-0 rounded-lg p-1.5 text-slate-400 transition hover:bg-orange-50 hover:text-orange-600">
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        )}

        {isCollapsed && currentUser && onLogout && (
          <button type="button" onClick={onLogout} title="Sign out" aria-label="Sign out" className="flex w-full justify-center rounded-lg p-2 text-slate-400 transition hover:bg-orange-50 hover:text-orange-600">
            <LogOut className="h-4 w-4" />
          </button>
        )}
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

      <aside className={`sticky top-0 z-40 hidden h-screen shrink-0 transition-all duration-200 md:block ${isCollapsed ? 'w-[76px]' : 'w-60'}`}>
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
