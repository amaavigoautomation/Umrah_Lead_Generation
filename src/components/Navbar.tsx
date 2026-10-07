import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Send,
  Users,
  Calendar,
  BookOpen,
  Sparkles,
  PlayCircle,
  Settings,
  Bot,
  RefreshCw,
  Mail,
  Radio,
  MessageSquare,
  Lock,
  LogOut,
  Shield,
} from 'lucide-react';
import { WHATSAPP_BUSINESS_NUMBER_FORMATTED } from '../services/whatsappInboundService';
import { AppUser } from '../types';
import { Umrah360Logo } from './Umrah360Logo';

export type ActiveTab =
  | 'inbox'
  | 'campaigns'
  | 'crm'
  | 'scheduling'
  | 'knowledge'
  | 'playground'
  | 'scenarios'
  | 'settings'
  | 'live-mailbox'
  | 'auto-followup';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  unreadCount: number;
  handoffCount: number;
  onResetSeedData: () => void;
  isFirebaseActive: boolean;
  currentUser?: AppUser | null;
  onLogout?: () => void;
  currentTenant?: { id: string; name: string; plan?: string; status?: string } | null;
  allTenants?: { id: string; name: string; plan?: string; status?: string }[];
  onSwitchTenant?: (tenantId: string) => void;
  /** True when the workspace's plan does not include this tab. */
  planLocked?: (tabId: ActiveTab) => boolean;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  unreadCount,
  handoffCount,
  onResetSeedData,
  isFirebaseActive,
  currentUser,
  onLogout,
  currentTenant,
  allTenants = [],
  onSwitchTenant,
  planLocked,
}) => {
  const [activeMailbox, setActiveMailbox] = useState<string>('amaavigo@gmail.com');

  useEffect(() => {
    fetch('/api/smtp/status')
      .then((res) => res.json())
      .then((data) => {
        if (data?.user) setActiveMailbox(data.user);
      })
      .catch(() => {});
  }, []);

  const isModuleAccessible = (tabId: ActiveTab): boolean => {
    if (planLocked?.(tabId)) return false;
    if (!currentUser) return true;
    if (currentUser.accessLevel === 'ALL' || currentUser.role === 'ADMIN') return true;
    return (currentUser.allowedModules || []).includes(tabId);
  };

  const getTabButtonClass = (tabId: ActiveTab) => {
    const accessible = isModuleAccessible(tabId);
    if (!accessible) {
      return 'opacity-40 text-slate-400 hover:opacity-60 cursor-pointer flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs md:text-sm font-medium';
    }
    if (activeTab === tabId) {
      return 'bg-gradient-to-r from-orange-500 to-amber-500 text-white shadow-xs font-semibold flex items-center space-x-2 px-3.5 py-1.5 rounded-lg text-xs md:text-sm transition-all';
    }
    return 'text-slate-600 hover:text-slate-900 hover:bg-slate-100/80 font-medium flex items-center space-x-2 px-3 py-1.5 rounded-lg text-xs md:text-sm transition-colors';
  };

  return (
    <header className="bg-white text-slate-800 border-b border-slate-200/90 sticky top-0 z-40 shadow-xs">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        {/* Top Header Row */}
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & System Info */}
          <div className="flex items-center space-x-4">
            <Umrah360Logo size="md" systemName="Umrah360" systemBadge="AI Platform" />
          </div>

          {/* System Status Indicators (Tenant, Mailbox, WhatsApp, Handoff) */}
          <div className="hidden lg:flex items-center space-x-2.5 text-xs">
            {/* Tenant Switcher & Plan Badge */}
            <div className="flex items-center space-x-1.5 px-3 py-1 rounded-lg bg-slate-50 border border-slate-200 text-slate-700">
              <Shield className="w-3.5 h-3.5 text-orange-500" />
              {allTenants.length > 1 && onSwitchTenant ? (
                <select
                  value={currentTenant?.id || 'umrah360'}
                  onChange={(e) => onSwitchTenant(e.target.value)}
                  className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer text-slate-800"
                >
                  {allTenants.map((t) => (
                    <option key={t.id} value={t.id} className="bg-white text-slate-900">
                      {t.name} ({t.plan || 'growth'})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold text-slate-800">
                  {currentTenant?.name || 'Umrah360'}
                </span>
              )}
              <span className="bg-orange-50 text-orange-700 border border-orange-200/70 text-[10px] font-bold px-1.5 py-0.2 rounded uppercase">
                {currentTenant?.plan || 'Enterprise'}
              </span>
            </div>

            {isModuleAccessible('live-mailbox') && (
              <button
                onClick={() => setActiveTab('live-mailbox')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs transition ${
                  activeTab === 'live-mailbox'
                    ? 'bg-orange-500 border-orange-500 text-white shadow-xs'
                    : 'bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
                }`}
                title={`Live Mailbox & SMTP Connection for ${activeMailbox}`}
              >
                <Radio className={`w-3.5 h-3.5 ${activeTab === 'live-mailbox' ? 'text-white' : 'text-blue-500'} animate-pulse`} />
                <span className="font-mono text-[11px] truncate max-w-[130px]">{activeMailbox}</span>
              </button>
            )}

            {isModuleAccessible('inbox') && (
              <button
                onClick={() => setActiveTab('inbox')}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs transition bg-slate-50 border-slate-200 text-slate-600 hover:text-slate-900 hover:bg-slate-100"
                title={`Live WhatsApp Business Inbound Line for ${WHATSAPP_BUSINESS_NUMBER_FORMATTED}`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-500 animate-pulse" />
                <span className="font-mono text-[11px]">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
              </button>
            )}

            {handoffCount > 0 && isModuleAccessible('inbox') && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200 text-orange-700 font-bold text-xs">
                <span className="w-1.5 h-1.5 rounded-full bg-orange-500 animate-ping"></span>
                <span>{handoffCount} Handoff</span>
              </div>
            )}
          </div>

          {/* Action to Seed / Reset Data + User Account Card */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onResetSeedData}
              title="Reset initial demo data (Campaigns, Leads, Knowledge Base)"
              className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200 shadow-xs transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>Reset Demo</span>
            </button>

            {/* Current User Badge & Status (Matches screenshot) */}
            {currentUser && (
              <div className="flex items-center space-x-2 pl-2 sm:border-l border-slate-200">
                <div className="flex flex-col text-right">
                  <div className="flex items-center justify-end space-x-1.5">
                    <span className="text-xs font-bold text-slate-900 leading-tight">
                      {currentUser.name}
                    </span>
                    <span className="bg-orange-50 text-orange-700 border border-orange-200/80 text-[10px] font-bold px-1.5 py-0.2 rounded">
                      {currentUser.role === 'ADMIN' ? 'ADMIN' : 'HR002'}
                    </span>
                  </div>
                  <div className="flex items-center justify-end space-x-1 mt-0.5">
                    <span className="w-1.5 h-1.5 rounded-full bg-orange-500"></span>
                    <span className="text-[10px] text-slate-500 font-medium">
                      {currentUser.role === 'ADMIN' ? 'Operations Specialist' : 'Lead Specialist'}
                    </span>
                  </div>
                </div>

                {onLogout && (
                  <button
                    onClick={onLogout}
                    title="Sign Out"
                    className="p-1.5 rounded-lg text-slate-400 hover:text-orange-600 hover:bg-orange-50 border border-transparent hover:border-orange-200 transition"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs Bar */}
        <div className="flex space-x-1.5 overflow-x-auto py-2 scrollbar-none text-sm border-t border-slate-100">
          {/* 1. Unified Inbox */}
          <button onClick={() => setActiveTab('inbox')} className={getTabButtonClass('inbox')}>
            <Inbox className="w-4 h-4" />
            <span>Unified Inbox</span>
            {!isModuleAccessible('inbox') ? (
              <Lock className="w-3 h-3 text-orange-400 ml-1" />
            ) : unreadCount > 0 ? (
              <span className="ml-1 px-1.5 py-0.2 bg-white text-orange-600 text-xs font-bold rounded-full">
                {unreadCount}
              </span>
            ) : null}
          </button>

          {/* 2. Auto Follow-Up Agent */}
          <button onClick={() => setActiveTab('auto-followup')} className={getTabButtonClass('auto-followup')}>
            <Bot className="w-4 h-4" />
            <span>Auto Follow-Up</span>
            {isModuleAccessible('auto-followup') && (
              <span className={`w-2 h-2 rounded-full ${activeTab === 'auto-followup' ? 'bg-white' : 'bg-orange-500'} animate-pulse`} />
            )}
          </button>

          {/* 3. Campaigns */}
          <button onClick={() => setActiveTab('campaigns')} className={getTabButtonClass('campaigns')}>
            <Send className="w-4 h-4" />
            <span>Campaigns</span>
            {!isModuleAccessible('campaigns') && <Lock className="w-3 h-3 text-orange-400 ml-1" />}
          </button>

          {/* 4. CRM & Leads */}
          <button onClick={() => setActiveTab('crm')} className={getTabButtonClass('crm')}>
            <Users className="w-4 h-4" />
            <span>CRM & Leads</span>
            {!isModuleAccessible('crm') && <Lock className="w-3 h-3 text-orange-400 ml-1" />}
          </button>

          {/* 5. Demo Scheduling Agent */}
          <button onClick={() => setActiveTab('scheduling')} className={getTabButtonClass('scheduling')}>
            <Calendar className="w-4 h-4" />
            <span>Demo Scheduling</span>
            {!isModuleAccessible('scheduling') && <Lock className="w-3 h-3 text-orange-400 ml-1" />}
          </button>

          {/* 6. Knowledge Base (RAG) */}
          <button onClick={() => setActiveTab('knowledge')} className={getTabButtonClass('knowledge')}>
            <BookOpen className="w-4 h-4" />
            <span>Knowledge Base</span>
            {!isModuleAccessible('knowledge') && <Lock className="w-3 h-3 text-orange-400 ml-1" />}
          </button>

          {/* 7. AI Testing Playground */}
          <button onClick={() => setActiveTab('playground')} className={getTabButtonClass('playground')}>
            <Sparkles className="w-4 h-4" />
            <span>AI Testing</span>
            {!isModuleAccessible('playground') && <Lock className="w-3 h-3 text-orange-400 ml-1" />}
          </button>

          {/* 8. E2E Walkthroughs */}
          <button onClick={() => setActiveTab('scenarios')} className={getTabButtonClass('scenarios')}>
            <PlayCircle className="w-4 h-4" />
            <span>E2E Walkthroughs</span>
            {!isModuleAccessible('scenarios') && <Lock className="w-3 h-3 text-orange-400 ml-1" />}
          </button>

          {/* 9. Channels & Settings */}
          <button onClick={() => setActiveTab('settings')} className={getTabButtonClass('settings')}>
            <Settings className="w-4 h-4" />
            <span>Settings</span>
            {!isModuleAccessible('settings') && <Lock className="w-3 h-3 text-orange-400 ml-1" />}
          </button>

          {/* 10. Live Mailbox & SMTP */}
          <button onClick={() => setActiveTab('live-mailbox')} className={getTabButtonClass('live-mailbox')}>
            <Mail className="w-4 h-4" />
            <span>Live Mailbox</span>
            {!isModuleAccessible('live-mailbox') ? (
              <Lock className="w-3 h-3 text-orange-400 ml-1" />
            ) : (
              <span className={`w-2 h-2 rounded-full ${activeTab === 'live-mailbox' ? 'bg-white' : 'bg-emerald-500'} animate-pulse`} />
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
export default Navbar;
