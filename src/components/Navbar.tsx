import React, { useState } from 'react';
import {
  Inbox, Bot, Users, CalendarDays, BookOpen, Sparkles, Settings, Database,
  Lock, LogOut, ShieldCheck, FileBarChart, Building2, Megaphone, Mail,
  PanelLeftClose, PanelLeftOpen, Menu, X, ChevronDown,
} from 'lucide-react';
import { AppUser } from '../types';
import { Umrah360Logo } from './Umrah360Logo';
import { useBrand } from '../context/BrandContext';

export type ActiveTab =
  | 'inbox'
  | 'campaigns'
  | 'email-design-studio'
  | 'crm'
  | 'scheduling'
  | 'knowledge'
  | 'playground'
  | 'settings'
  | 'auto-followup'
  | 'audit-logs'
  | 'database'
  | 'campaign-reports'
  | 'company-profile'
  | 'agent';

type NavItem = {
  id: ActiveTab;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

type NavGroup = {
  label: string;
  items: NavItem[];
};

const NAV_GROUPS: NavGroup[] = [
  { label: 'Conversations', items: [{ id: 'inbox', label: 'Unified Inbox', icon: Inbox }] },
  {
    label: 'Sales operations',
    items: [
      { id: 'crm', label: 'CRM & Leads', icon: Users },
      { id: 'auto-followup', label: 'Auto Follow-Up', icon: Bot },
      { id: 'scheduling', label: 'Demo Scheduling', icon: CalendarDays },
    ],
  },
  {
    label: 'Growth',
    items: [
      { id: 'database', label: 'Lead Database', icon: Database },
      { id: 'campaigns', label: 'Campaigns', icon: Megaphone },
      { id: 'email-design-studio', label: 'Email Design Studio', icon: Mail },
      { id: 'campaign-reports', label: 'Campaign Reports', icon: FileBarChart },
    ],
  },
  {
    label: 'AI workspace',
    items: [
      { id: 'agent', label: 'AI Agent', icon: Sparkles },
      { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
      { id: 'playground', label: 'AI Testing', icon: Bot },
    ],
  },
  {
    label: 'Administration',
    items: [
      { id: 'audit-logs', label: 'Audit Logs', icon: ShieldCheck },
      { id: 'company-profile', label: 'Company Profile', icon: Building2 },
      { id: 'settings', label: 'Settings', icon: Settings },
    ],
  },
];

const ROLE_LABELS: Record<string, string> = {
  ADMIN: 'Administrator',
  SALES: 'Sales',
  OPERATOR: 'Operator',
  SPECIALIST: 'Specialist',
  CUSTOM: 'Custom access',
};

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
  const [internalCollapsed, setInternalCollapsed] = useState(false);
  const [isMobileOpen, setIsMobileOpen] = useState(false);
  const isCollapsed = controlledIsCollapsed !== undefined ? controlledIsCollapsed : internalCollapsed;

  const toggleCollapse = () => {
    if (onToggleCollapse) onToggleCollapse();
    else setInternalCollapsed((previous) => !previous);
  };

  const isModuleAccessible = (tabId: ActiveTab) => {
    if (planLocked?.(tabId)) return false;
    if (tabId === 'database' || tabId === 'company-profile') return true;
    if (!currentUser) return true;
    if (currentUser.accessLevel === 'ALL' || currentUser.role === 'ADMIN') return true;
    if (tabId === 'email-design-studio' && (currentUser.allowedModules || []).includes('settings')) return true;
    return (currentUser.allowedModules || []).includes(tabId);
  };

  const selectTab = (tabId: ActiveTab) => {
    setActiveTab(tabId);
    setIsMobileOpen(false);
  };

  const initials = (currentUser?.name || currentUser?.email || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

  const renderSidebar = (collapsed: boolean, mobile = false) => (
    <div className="flex h-full min-h-0 flex-col bg-white text-slate-800">
      <div className="flex h-[68px] shrink-0 items-center justify-between border-b border-slate-200 px-4">
        {collapsed ? (
          <div className="flex h-9 w-9 items-center justify-center rounded-xl border border-orange-200 bg-orange-50 text-sm font-bold text-orange-700">
            U
          </div>
        ) : (
          <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} />
        )}
        {mobile ? (
          <button
            type="button"
            onClick={() => setIsMobileOpen(false)}
            className="rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900"
            aria-label="Close navigation"
          >
            <X className="h-4 w-4" />
          </button>
        ) : (
          <button
            type="button"
            onClick={toggleCollapse}
            title={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            aria-label={collapsed ? 'Expand navigation' : 'Collapse navigation'}
            className="hidden rounded-lg p-2 text-slate-500 transition hover:bg-slate-100 hover:text-slate-900 md:inline-flex"
          >
            {collapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
          </button>
        )}
      </div>

      {!collapsed && (
        <div className="shrink-0 border-b border-slate-100 px-3 py-3">
          <div className="rounded-xl border border-slate-200 bg-slate-50/80 p-3">
            <div className="mb-1 flex items-center justify-between gap-2">
              <span className="text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">Workspace</span>
              <span className={'h-2 w-2 rounded-full ' + (isFirebaseActive ? 'bg-emerald-500' : 'bg-amber-500')} />
            </div>
            {allTenants.length > 1 && onSwitchTenant ? (
              <div className="relative">
                <select
                  value={currentTenant?.id || ''}
                  onChange={(event) => onSwitchTenant(event.target.value)}
                  aria-label="Switch workspace"
                  className="w-full appearance-none bg-transparent pr-6 text-sm font-semibold text-slate-800 outline-none"
                >
                  {allTenants.map((tenant) => (
                    <option key={tenant.id} value={tenant.id}>{tenant.name}</option>
                  ))}
                </select>
                <ChevronDown className="pointer-events-none absolute right-0 top-1 h-4 w-4 text-slate-400" />
              </div>
            ) : (
              <div className="truncate text-sm font-semibold text-slate-800">
                {currentTenant?.name || brand.companyName || 'Umrah 360'}
              </div>
            )}
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className="truncate text-[11px] text-slate-500">{currentTenant?.status || 'Workspace active'}</span>
              <span className="shrink-0 rounded-md bg-white px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-wide text-slate-500 ring-1 ring-slate-200">
                {currentTenant?.plan || 'Enterprise'}
              </span>
            </div>
          </div>
        </div>
      )}

      <nav aria-label="Primary navigation" className="min-h-0 flex-1 space-y-5 overflow-y-auto px-2.5 py-4">
        {NAV_GROUPS.map((group) => (
          <section key={group.label}>
            {!collapsed && (
              <h2 className="mb-2 px-3 text-[10px] font-semibold uppercase tracking-[0.14em] text-slate-400">
                {group.label}
              </h2>
            )}
            <div className="space-y-1">
              {group.items.map((item) => {
                const Icon = item.icon;
                const active = activeTab === item.id;
                const accessible = isModuleAccessible(item.id);
                const badgeCount = item.id === 'inbox' ? unreadCount : 0;
                const hasHandoff = item.id === 'inbox' && handoffCount > 0;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => selectTab(item.id)}
                    title={collapsed ? item.label : undefined}
                    aria-label={item.label}
                    aria-current={active ? 'page' : undefined}
                    className={
                      'group relative flex min-h-10 w-full items-center rounded-lg px-3 text-left text-[13px] transition-colors ' +
                      (collapsed ? 'justify-center' : 'gap-3') +
                      (active
                        ? ' bg-orange-50 font-semibold text-orange-800'
                        : ' font-medium text-slate-600 hover:bg-slate-100 hover:text-slate-950') +
                      (!accessible ? ' opacity-65' : '')
                    }
                  >
                    {active && <span className="absolute bottom-2 left-0 top-2 w-[3px] rounded-r-full bg-orange-600" />}
                    <span className={'relative flex h-5 w-5 shrink-0 items-center justify-center ' + (active ? 'text-orange-700' : 'text-slate-500 group-hover:text-slate-700')}>
                      <Icon className="h-[18px] w-[18px]" />
                      {collapsed && (badgeCount > 0 || hasHandoff) && (
                        <span className="absolute -right-2 -top-1 h-2 w-2 rounded-full bg-orange-600 ring-2 ring-white" />
                      )}
                    </span>
                    {!collapsed && <span className="min-w-0 flex-1 truncate">{item.label}</span>}
                    {!collapsed && (
                      <span className="flex shrink-0 items-center gap-1.5">
                        {hasHandoff && <span className="h-1.5 w-1.5 rounded-full bg-rose-500" title="Human handoff waiting" />}
                        {!accessible && <Lock className="h-3.5 w-3.5 text-slate-400" />}
                        {badgeCount > 0 && (
                          <span className="min-w-5 rounded-md bg-slate-200/80 px-1.5 py-0.5 text-center text-[10px] font-semibold tabular-nums text-slate-700">
                            {badgeCount > 99 ? '99+' : badgeCount}
                          </span>
                        )}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </section>
        ))}
      </nav>

      <div className="shrink-0 border-t border-slate-200 p-3">
        {currentUser && (
          <div className={'flex items-center gap-2.5 ' + (collapsed ? 'justify-center' : '')}>
            <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-slate-900 text-[11px] font-semibold text-white">
              {initials || 'U'}
            </div>
            {!collapsed && (
              <div className="min-w-0 flex-1">
                <div className="truncate text-xs font-semibold text-slate-800">{currentUser.name}</div>
                <div className="truncate text-[10px] text-slate-500">{ROLE_LABELS[currentUser.role] || 'Workspace member'}</div>
              </div>
            )}
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
        {!collapsed && !currentUser && (
          <div className="flex items-center gap-2 text-[11px] text-slate-500">
            <span className={'h-2 w-2 rounded-full ' + (isFirebaseActive ? 'bg-emerald-500' : 'bg-amber-500')} />
            {isFirebaseActive ? 'Live workspace' : 'Preview data'}
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      <div className="flex h-14 shrink-0 items-center justify-between border-b border-slate-200 bg-white px-4 md:hidden">
        <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} />
        <div className="flex items-center gap-3">
          {unreadCount > 0 && (
            <button
              type="button"
              onClick={() => selectTab('inbox')}
              className="rounded-md bg-slate-100 px-2 py-1 text-[11px] font-semibold tabular-nums text-slate-700"
              aria-label={unreadCount + ' unread conversations'}
            >
              {unreadCount} unread
            </button>
          )}
          <button
            type="button"
            onClick={() => setIsMobileOpen(true)}
            className="rounded-lg border border-slate-200 p-2 text-slate-700 transition hover:bg-slate-100"
            aria-label="Open navigation"
          >
            <Menu className="h-4 w-4" />
          </button>
        </div>
      </div>

      <aside
        className={'hidden h-dvh shrink-0 border-r border-slate-200 bg-white transition-[width] duration-200 md:flex md:flex-col ' + (isCollapsed ? 'w-[76px]' : 'w-[264px]')}
      >
        {renderSidebar(isCollapsed)}
      </aside>

      {isMobileOpen && (
        <div className="fixed inset-0 z-[70] md:hidden" role="dialog" aria-modal="true" aria-label="Navigation menu">
          <button
            type="button"
            className="absolute inset-0 bg-slate-950/35"
            onClick={() => setIsMobileOpen(false)}
            aria-label="Close navigation"
          />
          <aside className="absolute inset-y-0 left-0 w-[min(88vw,320px)] bg-white shadow-2xl">
            {renderSidebar(false, true)}
          </aside>
        </div>
      )}
    </>
  );
};

export default Navbar;
