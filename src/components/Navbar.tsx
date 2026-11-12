import React, { useState, useEffect } from 'react';
import {
  Inbox,
  LayoutDashboard,
  Send,
  Mail,
  Users,
  Calendar,
  BookOpen,
  Sparkles,
  Bot,
  Database,
  Radio,
  MessageSquare,
  Lock,
  LogOut,
  Shield,
  Menu,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  ChevronLeft,
  ChevronRight,
  ChevronDown,
  FileBarChart,
  Building2,
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
  /** True when the workspace's plan does not include this tab. */
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
  const [internalCollapsed, setInternalCollapsed] = useState<boolean>(false);
  const [isMobileOpen, setIsMobileOpen] = useState<boolean>(false);

  const isCollapsed = controlledIsCollapsed !== undefined ? controlledIsCollapsed : internalCollapsed;

  const handleToggle = () => {
    if (onToggleCollapse) {
      onToggleCollapse();
    } else {
      setInternalCollapsed((prev) => !prev);
    }
  };

  const isModuleAccessible = (tabId: ActiveTab): boolean => {
    if (planLocked?.(tabId)) return false;
    // Database is shared by authenticated workspace users; deletion is admin-only on the server.
    if (tabId === 'dashboard' || tabId === 'database' || tabId === 'workspace' || tabId === 'company-profile') return true;
    if (!currentUser) return true;
    if (currentUser.accessLevel === 'ALL' || currentUser.role === 'ADMIN') return true;
    if (tabId === 'email-design-studio' && (currentUser.allowedModules || []).includes('settings')) return true;
    return (currentUser.allowedModules || []).includes(tabId);
  };

  type NavItem = {
    id: ActiveTab;
    label: string;
    icon: React.ReactNode;
    badgeCount?: number;
    hasPulse?: boolean;
  };

  const navGroups: { id: string; label: string; icon: React.ReactNode; items: NavItem[] }[] = [
    {
      id: 'conversation',
      label: 'Conversation',
      icon: <MessageSquare className="w-4 h-4 shrink-0" />,
      items: [
        { id: 'inbox', label: 'Unified Inbox', icon: <Inbox className="w-4 h-4 shrink-0" />, badgeCount: unreadCount },
      ],
    },
    {
      id: 'ai',
      label: 'AI',
      icon: <Bot className="w-4 h-4 shrink-0" />,
      items: [
        { id: 'agent', label: 'AI Agent', icon: <Sparkles className="w-4 h-4 shrink-0" />, hasPulse: true },
        { id: 'auto-followup', label: 'Auto Follow-Up Agent', icon: <Bot className="w-4 h-4 shrink-0" />, hasPulse: true },
        { id: 'scheduling', label: 'Demo Scheduling Agent', icon: <Calendar className="w-4 h-4 shrink-0" /> },
        { id: 'playground', label: 'AI Testing', icon: <Sparkles className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      id: 'sales',
      label: 'Sales',
      icon: <Users className="w-4 h-4 shrink-0" />,
      items: [
        { id: 'crm', label: 'CRM', icon: <Users className="w-4 h-4 shrink-0" /> },
      ],
    },
    {
      id: 'marketing',
      label: 'Marketing',
      icon: <Send className="w-4 h-4 shrink-0" />,
      items: [
        { id: 'campaigns', label: 'Campaigns', icon: <Send className="w-4 h-4 shrink-0" /> },
        { id: 'email-design-studio', label: 'Template Studio', icon: <Mail className="w-4 h-4 shrink-0" /> },
        { id: 'campaign-reports', label: 'AI Campaign Report', icon: <FileBarChart className="w-4 h-4 shrink-0" /> },
      ],
    },
  ];

  const standaloneItems: NavItem[] = [
    { id: 'dashboard', label: 'Dashboard', icon: <LayoutDashboard className="w-4 h-4 shrink-0" /> },
    { id: 'database', label: 'Database', icon: <Database className="w-4 h-4 shrink-0" /> },
    { id: 'knowledge', label: 'Knowledge Base', icon: <BookOpen className="w-4 h-4 shrink-0" /> },
    { id: 'workspace', label: 'Workspace', icon: <Building2 className="w-4 h-4 shrink-0" /> },
  ];

  const [expandedGroups, setExpandedGroups] = useState<Record<string, boolean>>({
    conversation: true,
  });

  useEffect(() => {
    const activeGroup = navGroups.find((group) => group.items.some((item) => item.id === activeTab));
    if (activeGroup) {
      setExpandedGroups((current) => current[activeGroup.id] ? current : { ...current, [activeGroup.id]: true });
    }
  }, [activeTab]);

  const toggleNavGroup = (groupId: string) => {
    if (isCollapsed) {
      handleToggle();
      setExpandedGroups((current) => ({ ...current, [groupId]: true }));
      return;
    }
    setExpandedGroups((current) => ({ ...current, [groupId]: !current[groupId] }));
  };

  const renderNavItem = (item: NavItem, nested = false) => {
    const accessible = isModuleAccessible(item.id);
    const isActive = activeTab === item.id;

    return (
      <button
        key={item.id}
        type="button"
        onClick={() => handleSelectTab(item.id)}
        title={isCollapsed ? item.label : undefined}
        aria-current={isActive ? 'page' : undefined}
        className={`w-full flex items-center ${
          isCollapsed ? 'justify-center px-0 py-2.5' : nested ? 'justify-between px-3 py-2' : 'justify-between px-3 py-2.5'
        } rounded-xl text-xs transition-all ${
          !accessible
            ? 'opacity-40 text-slate-400 hover:opacity-60 cursor-pointer'
            : isActive
            ? 'bg-gradient-to-r from-[#ef741a] to-[#f97316] text-white shadow-2xs font-semibold'
            : 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 font-medium'
        } ${nested && !isCollapsed ? 'min-h-9' : ''}`}
      >
        <div className={`flex items-center ${isCollapsed ? 'justify-center' : 'space-x-2.5'} truncate`}>
          <span className={isActive ? 'text-white' : 'text-slate-500'}>{item.icon}</span>
          {!isCollapsed && <span className="truncate">{item.label}</span>}
        </div>
        {!isCollapsed ? (
          <div className="flex items-center space-x-1 shrink-0">
            {!accessible ? (
              <Lock className="w-3.5 h-3.5 text-orange-400" />
            ) : item.badgeCount && item.badgeCount > 0 ? (
              <span className={`px-1.5 py-0.2 ${isActive ? 'bg-white text-orange-600' : 'bg-orange-500 text-white'} text-[10px] font-bold rounded-full`}>
                {item.badgeCount}
              </span>
            ) : item.hasPulse ? (
              <span className={`w-2 h-2 rounded-full ${isActive ? 'bg-white' : 'bg-orange-500'} animate-pulse`} />
            ) : null}
          </div>
        ) : item.badgeCount && item.badgeCount > 0 ? (
          <span className="absolute top-1 right-1 w-2 h-2 bg-orange-500 rounded-full" />
        ) : null}
      </button>
    );
  };

  const handleSelectTab = (tabId: ActiveTab) => {
    setActiveTab(tabId);
    setIsMobileOpen(false);
  };

  const sidebarContent = (
    <div className="flex flex-col h-full justify-between bg-white text-slate-800 border-r border-slate-200/90 select-none transition-all duration-200">
      {/* Top Header & Brand */}
      <div className="p-3 border-b border-slate-100 space-y-3">
        <div className="flex items-center justify-between">
          {!isCollapsed ? (
            <div className="flex items-center justify-between w-full">
              <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} />
              <button
                onClick={handleToggle}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition hidden md:flex items-center justify-center"
                title="Collapse Sidebar"
              >
                <PanelLeftClose className="w-4 h-4" />
              </button>
              <button
                onClick={() => setIsMobileOpen(false)}
                className="md:hidden p-1.5 text-slate-400 hover:text-slate-700 rounded-lg"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
          ) : (
            <div className="flex items-center justify-between w-full px-1">
              {brand.playbook === 'umrah360' && !brand.logoUrl ? (
                <img src="/amaavigo-logo.png" alt="Logo" className="h-6 w-auto object-contain" />
              ) : brand.logoUrl ? (
                <img src={brand.logoUrl} alt={brand.companyName} className="h-6 w-auto object-contain" />
              ) : (
                <span className="w-6 h-6 rounded-full bg-[#fef6f3] border border-[#fed7aa] text-[#ef741a] text-xs font-bold flex items-center justify-center">
                  {(brand.companyName || '?').charAt(0).toUpperCase()}
                </span>
              )}
              <button
                onClick={handleToggle}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 hover:bg-slate-100 transition hidden md:flex items-center justify-center"
                title="Expand Sidebar"
              >
                <PanelLeftOpen className="w-4 h-4 text-slate-600" />
              </button>
            </div>
          )}
        </div>

        {/* Tenant Switcher & Plan Status (Expanded mode only) */}
        {!isCollapsed && (
          <div className="flex items-center justify-between px-2.5 py-1.5 rounded-lg bg-slate-50 border border-slate-200/80 text-xs">
            <div className="flex items-center space-x-1.5 truncate">
              <Shield className="w-3.5 h-3.5 text-[#ef741a] shrink-0" />
              {allTenants.length > 1 && onSwitchTenant ? (
                <select
                  value={currentTenant?.id || ''}
                  onChange={(e) => onSwitchTenant(e.target.value)}
                  className="bg-transparent text-[11px] font-semibold focus:outline-none cursor-pointer text-slate-800 truncate"
                >
                  {allTenants.map((t) => (
                    <option key={t.id} value={t.id} className="bg-white text-slate-900">
                      {t.name} ({t.plan || 'growth'})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold text-slate-800 text-[11px] truncate">
                  {currentTenant?.name || brand.companyName}
                </span>
              )}
            </div>
            <span className="bg-[#fef6f3] text-[#ef741a] border border-[#fed7aa] text-[9px] font-bold px-1.5 py-0.2 rounded uppercase shrink-0">
              {currentTenant?.plan || 'Enterprise'}
            </span>
          </div>
        )}
      </div>

      {/* Navigation List */}
      <div className="flex-1 px-2 py-3 space-y-1 overflow-y-auto scrollbar-none">
        {!isCollapsed && (
          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider px-2.5 mb-1.5">
            Menu
          </div>
        )}

        {renderNavItem(standaloneItems[0])}

        <div className={isCollapsed ? 'my-2 border-t border-slate-100' : 'my-3 border-t border-slate-100'} />

        {navGroups.map((group) => {
          const isExpanded = expandedGroups[group.id] === true;
          const containsActiveTab = group.items.some((item) => item.id === activeTab);
          const isEntireGroupLocked = group.items.every((item) => !isModuleAccessible(item.id));

          return (
            <div key={group.id} className="space-y-1">
              <button
                type="button"
                onClick={() => toggleNavGroup(group.id)}
                title={isCollapsed ? group.label : undefined}
                aria-expanded={!isCollapsed && isExpanded}
                className={`w-full flex items-center rounded-xl text-xs font-semibold transition-all ${
                  isCollapsed ? 'justify-center px-0 py-2.5' : 'justify-between px-3 py-2.5'
                } ${
                  containsActiveTab
                    ? 'bg-orange-50 text-orange-800'
                    : 'text-slate-500 hover:bg-slate-100/80 hover:text-slate-800'
                }`}
              >
                <span className={`flex items-center truncate ${isCollapsed ? 'justify-center' : 'gap-2.5'}`}>
                  <span className={containsActiveTab ? 'text-orange-600' : 'text-slate-500'}>{group.icon}</span>
                  {!isCollapsed && <span>{group.label}</span>}
                </span>
                {!isCollapsed && (
                  <span className="flex items-center gap-1.5">
                    {isEntireGroupLocked && <Lock className="h-3.5 w-3.5 text-orange-400" />}
                    <ChevronDown className={`h-3.5 w-3.5 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                  </span>
                )}
                {isCollapsed && containsActiveTab && <span className="absolute top-1 right-1 h-2 w-2 rounded-full bg-orange-500" />}
              </button>

              {isExpanded && !isCollapsed && (
                <div className="ml-4 space-y-1 border-l border-slate-200 pl-2">
                  {group.items.map((item) => renderNavItem(item, true))}
                </div>
              )}
            </div>
          );
        })}

        <div className={isCollapsed ? 'my-2 border-t border-slate-100' : 'my-3 border-t border-slate-100'} />
        {standaloneItems.slice(1).map((item) => renderNavItem(item))}
      </div>

      {/* Footer Section */}
      <div className="p-2 border-t border-slate-200/90 bg-slate-50/50 space-y-2">
        <button
          onClick={handleToggle}
          title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
          className="w-full flex items-center justify-center p-2 rounded-xl bg-slate-100/90 hover:bg-slate-200/80 text-slate-600 hover:text-slate-900 transition text-xs font-semibold gap-2 border border-slate-200/80 shadow-2xs"
        >
          {isCollapsed ? (
            <ChevronRight className="w-4 h-4 text-orange-600" />
          ) : (
            <>
              <ChevronLeft className="w-4 h-4 text-orange-600" />
              <span>Collapse Sidebar</span>
            </>
          )}
        </button>

        {!isCollapsed && currentUser && (
          <div className="flex items-center justify-between p-2 rounded-xl bg-white border border-slate-200/80 shadow-2xs">
            <div className="flex flex-col truncate pr-1">
              <div className="flex items-center space-x-1.5 truncate">
                <span className="text-xs font-bold text-slate-900 truncate leading-tight">
                  {currentUser.name}
                </span>
                <span className="bg-orange-50 text-orange-700 border border-orange-200/80 text-[9px] font-bold px-1.5 py-0.2 rounded shrink-0">
                  {currentUser.role === 'ADMIN' ? 'ADMIN' : 'HR002'}
                </span>
              </div>
            </div>

            {onLogout && (
              <button
                onClick={onLogout}
                title="Sign Out"
                className="p-1 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition shrink-0"
              >
                <LogOut className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        )}

        {isCollapsed && currentUser && onLogout && (
          <div className="flex justify-center py-1">
            <button
              onClick={onLogout}
              title={`Sign Out (${currentUser.name})`}
              className="p-2 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 transition"
            >
              <LogOut className="w-4 h-4" />
            </button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* Mobile Top Navigation Header */}
      <div className="md:hidden bg-white border-b border-slate-200 px-4 py-2.5 flex items-center justify-between sticky top-0 z-30 shadow-2xs">
        <Umrah360Logo size="sm" systemBadge="" showSubtitle={false} />

        <div className="flex items-center space-x-2">
          {unreadCount > 0 && (
            <span className="px-2 py-0.5 bg-orange-500 text-white text-[10px] font-bold rounded-full">
              {unreadCount}
            </span>
          )}
          <button
            onClick={() => setIsMobileOpen(true)}
            className="p-2 text-slate-700 hover:bg-slate-100 rounded-xl border border-slate-200"
          >
            <Menu className="w-5 h-5" />
          </button>
        </div>
      </div>

      {/* Desktop Persistent Left Sidebar (Collapsible) */}
      <aside
        className={`hidden md:block ${
          isCollapsed ? 'w-16' : 'w-60'
        } h-screen sticky top-0 shrink-0 z-40 transition-all duration-200`}
      >
        {sidebarContent}
      </aside>

      {/* Mobile Slide-Over Drawer */}
      {isMobileOpen && (
        <div className="fixed inset-0 z-50 md:hidden flex">
          <div
            className="fixed inset-0 bg-slate-900/50 backdrop-blur-xs transition-opacity"
            onClick={() => setIsMobileOpen(false)}
          />
          <div className="relative w-64 max-w-full h-full shadow-2xl z-10">
            {sidebarContent}
          </div>
        </div>
      )}
    </>
  );
};

export default Navbar;
