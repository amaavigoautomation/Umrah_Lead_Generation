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
  Menu,
  X,
} from 'lucide-react';
import { AppUser } from '../types';
import { Umrah360Logo } from './Umrah360Logo';

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
  planLocked?: (tabId: ActiveTab) => boolean;
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
  planLocked,
}) => {
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);

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
    <div className="flex h-full w-[56px] shrink-0 flex-col items-center overflow-hidden bg-[#05051f] text-white select-none">
      <div className="flex h-[56px] w-full shrink-0 items-center justify-center border-b border-white/10">
        <button type="button" onClick={() => handleSelectTab('dashboard')} title="Go to Home dashboard" aria-label="Go to Home dashboard" className="flex h-full w-full items-center justify-center transition hover:bg-white/[.06] focus-visible:outline focus-visible:outline-2 focus-visible:outline-inset focus-visible:outline-blue-400">
          <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} lightOnDark compactMark />
        </button>
      </div>
      <nav aria-label="Main modules" className="flex min-h-0 w-full flex-1 flex-col items-center gap-2 overflow-y-auto py-3">
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
      {onLogout && (
        <div className="flex w-full shrink-0 items-center justify-center border-t border-white/10 py-3">
          <button type="button" onClick={onLogout} title={currentUser ? 'Sign out (' + currentUser.name + ')' : 'Sign out'} aria-label="Sign out"
            className="flex h-9 w-9 items-center justify-center rounded-lg text-slate-300 transition hover:bg-white/10 hover:text-white">
            <LogOut className="h-4 w-4" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      <div className="sticky top-0 z-30 flex items-center justify-between border-b border-white/10 bg-[#05051f] px-4 py-2.5 text-white shadow-2xs md:hidden">
        <button type="button" onClick={() => handleSelectTab('dashboard')} title="Go to Home dashboard" aria-label="Go to Home dashboard" className="rounded-md px-1 py-1"><Umrah360Logo size="sm" systemBadge="" showSubtitle={false} lightOnDark compactMark /></button>
        <div className="flex items-center gap-2">
          {unreadCount > 0 && <span className="rounded-full bg-orange-500 px-2 py-0.5 text-[10px] font-bold text-white">{unreadCount}</span>}
          <button type="button" onClick={() => setIsMobileOpen(true)} className="rounded-xl border border-white/20 p-2 text-white hover:bg-white/10" aria-label="Open navigation">
            <Menu className="h-5 w-5" />
          </button>
        </div>
      </div>

      <aside className="sticky top-0 z-40 hidden h-screen w-[56px] shrink-0 md:block">
        {sidebarContent}
      </aside>

      {isMobileOpen && (
        <div className="fixed inset-0 z-50 flex md:hidden">
          <button type="button" aria-label="Close navigation" onClick={() => setIsMobileOpen(false)} className="fixed inset-0 bg-slate-900/50 backdrop-blur-[2px]" />
          <div className="relative z-10 h-full w-[56px] shrink-0 shadow-2xl">{sidebarContent}</div>
        </div>
      )}
    </>
  );
};

export default Navbar;
