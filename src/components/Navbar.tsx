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
  Database,
  Bot,
  RefreshCw,
  Mail,
  Radio,
  MessageSquare,
  Lock,
  LogOut,
  User,
  Shield,
} from 'lucide-react';
import { WHATSAPP_BUSINESS_NUMBER_FORMATTED } from '../services/whatsappInboundService';
import { AppUser } from '../types';

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

  return (
    <header className="bg-slate-900 text-white border-b border-slate-800 sticky top-0 z-40">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & Tagline */}
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center font-bold text-lg text-white shadow-md shadow-emerald-900/50">
              U
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <span className="font-bold text-lg tracking-tight text-white">Umrah360</span>
                <span className="text-xs px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 font-medium border border-emerald-500/30">
                  AI Platform
                </span>
              </div>
              <p className="text-xs text-slate-400 hidden sm:block">
                Inbound Lead Capture & Outbound Prospecting Engine
              </p>
            </div>
          </div>

          {/* System Status Indicators */}
          <div className="hidden lg:flex items-center space-x-3 text-xs">
            {/* Tenant Switcher & Plan Badge */}
            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-indigo-950/70 border border-indigo-800 text-indigo-300">
              <Shield className="w-3.5 h-3.5 text-indigo-400" />
              {allTenants.length > 1 && onSwitchTenant ? (
                <select
                  value={currentTenant?.id || 'umrah360'}
                  onChange={(e) => onSwitchTenant(e.target.value)}
                  className="bg-transparent text-xs font-semibold focus:outline-none cursor-pointer text-indigo-200"
                >
                  {allTenants.map((t) => (
                    <option key={t.id} value={t.id} className="bg-slate-900 text-white">
                      {t.name} ({t.plan || 'growth'})
                    </option>
                  ))}
                </select>
              ) : (
                <span className="font-semibold">
                  {currentTenant?.name || 'Umrah360 Flagship'} ({currentTenant?.plan || 'enterprise'})
                </span>
              )}
            </div>

            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-emerald-950/70 border border-emerald-800 text-emerald-300">
              <Bot className="w-3.5 h-3.5 text-emerald-400" />
              <span>Multi-Tenant Engine</span>
            </div>

            {isModuleAccessible('live-mailbox') && (
              <button
                onClick={() => setActiveTab('live-mailbox')}
                className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md border text-xs transition ${
                  activeTab === 'live-mailbox'
                    ? 'bg-blue-600 border-blue-500 text-white'
                    : 'bg-blue-950/70 border-blue-800 text-blue-300 hover:bg-blue-900/60'
                }`}
                title={`Live Mailbox & SMTP Connection for ${activeMailbox}`}
              >
                <Radio className="w-3.5 h-3.5 text-blue-400 animate-pulse" />
                <span className="font-mono">{activeMailbox}</span>
              </button>
            )}

            {isModuleAccessible('inbox') && (
              <button
                onClick={() => setActiveTab('inbox')}
                className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md border text-xs transition bg-emerald-950/70 border-emerald-800 text-emerald-300 hover:bg-emerald-900/60"
                title={`Live WhatsApp Business Inbound Line for ${WHATSAPP_BUSINESS_NUMBER_FORMATTED}`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-400 animate-pulse" />
                <span className="font-mono">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
              </button>
            )}

            {handoffCount > 0 && isModuleAccessible('inbox') && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 font-medium">
                <span>{handoffCount} Human Handoff</span>
              </div>
            )}
          </div>

          {/* Action to Seed / Reset Data + User Account Status */}
          <div className="flex items-center space-x-3">
            <button
              onClick={onResetSeedData}
              title="Reset initial demo data (Campaigns, Rahul Sharma thread, Knowledge Base)"
              className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span>Reset Demo</span>
            </button>

            {/* Current User Badge & Logout */}
            {currentUser && (
              <div className="flex items-center space-x-2 pl-2 sm:border-l border-slate-800">
                <div className="flex items-center space-x-2 bg-slate-800/90 border border-slate-700/80 px-2.5 py-1 rounded-lg">
                  <div className="w-6 h-6 rounded-full bg-emerald-600/30 text-emerald-300 border border-emerald-500/40 flex items-center justify-center font-bold text-xs">
                    {currentUser.name.charAt(0)}
                  </div>
                  <div className="hidden md:block text-left">
                    <div className="text-xs font-semibold text-white leading-tight truncate max-w-[120px]">
                      {currentUser.name}
                    </div>
                    <div className="text-[10px] text-emerald-400 font-mono flex items-center space-x-1">
                      <Shield className="w-2.5 h-2.5" />
                      <span>{currentUser.role}</span>
                    </div>
                  </div>
                </div>

                {onLogout && (
                  <button
                    onClick={onLogout}
                    title="Sign Out"
                    className="p-1.5 rounded-lg bg-slate-800 hover:bg-red-950/60 text-slate-400 hover:text-red-400 border border-slate-700 hover:border-red-800/60 transition"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Navigation Tabs with Lock State Detection */}
        <div className="flex space-x-1 overflow-x-auto py-2 scrollbar-none text-sm border-t border-slate-800/60">
          {/* 1. Unified Inbox */}
          <button
            onClick={() => setActiveTab('inbox')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('inbox')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'inbox'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Inbox className="w-4 h-4" />
            <span>Unified Inbox</span>
            {!isModuleAccessible('inbox') ? (
              <Lock className="w-3 h-3 text-amber-400 ml-1" />
            ) : unreadCount > 0 ? (
              <span className="ml-1.5 px-1.5 py-0.2 bg-emerald-400 text-slate-900 text-xs font-bold rounded-full">
                {unreadCount}
              </span>
            ) : null}
          </button>

          {/* 1.5 Auto Follow-Up Agent */}
          <button
            onClick={() => setActiveTab('auto-followup')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('auto-followup')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'auto-followup'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-emerald-400 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Bot className="w-4 h-4 text-emerald-400" />
            <span>Auto Follow-Up</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>

          {/* 2. Campaigns */}
          <button
            onClick={() => setActiveTab('campaigns')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('campaigns')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'campaigns'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>Campaigns</span>
            {!isModuleAccessible('campaigns') && <Lock className="w-3 h-3 text-amber-400 ml-1" />}
          </button>

          {/* 3. CRM & Leads */}
          <button
            onClick={() => setActiveTab('crm')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('crm')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'crm'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>CRM & Leads</span>
            {!isModuleAccessible('crm') && <Lock className="w-3 h-3 text-amber-400 ml-1" />}
          </button>

          {/* 4. Demo Scheduling Agent */}
          <button
            onClick={() => setActiveTab('scheduling')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('scheduling')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'scheduling'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Calendar className="w-4 h-4" />
            <span>Demo Scheduling</span>
            {!isModuleAccessible('scheduling') && <Lock className="w-3 h-3 text-amber-400 ml-1" />}
          </button>

          {/* 4. Knowledge Base (RAG) */}
          <button
            onClick={() => setActiveTab('knowledge')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('knowledge')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'knowledge'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Knowledge Base (RAG)</span>
            {!isModuleAccessible('knowledge') && <Lock className="w-3 h-3 text-amber-400 ml-1" />}
          </button>

          {/* 5. AI Testing */}
          <button
            onClick={() => setActiveTab('playground')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('playground')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'playground'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>AI Testing</span>
            {!isModuleAccessible('playground') && <Lock className="w-3 h-3 text-amber-400 ml-1" />}
          </button>

          {/* 6. E2E Walkthroughs */}
          <button
            onClick={() => setActiveTab('scenarios')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('scenarios')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'scenarios'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <PlayCircle className="w-4 h-4" />
            <span>E2E Walkthroughs</span>
            {!isModuleAccessible('scenarios') && <Lock className="w-3 h-3 text-amber-400 ml-1" />}
          </button>

          {/* 7. Channels & Settings */}
          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('settings')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'settings'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Channels & Settings</span>
            {!isModuleAccessible('settings') && <Lock className="w-3 h-3 text-amber-400 ml-1" />}
          </button>

          {/* 8. Live Mailbox & SMTP */}
          <button
            onClick={() => setActiveTab('live-mailbox')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              !isModuleAccessible('live-mailbox')
                ? 'opacity-40 text-slate-500 hover:opacity-70 bg-slate-900/40 cursor-pointer'
                : activeTab === 'live-mailbox'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-blue-300 hover:text-white hover:bg-blue-950/60 border border-blue-500/30'
            }`}
          >
            <Mail className="w-4 h-4 text-blue-400" />
            <span>Live Mailbox & SMTP</span>
            {!isModuleAccessible('live-mailbox') ? (
              <Lock className="w-3 h-3 text-amber-400 ml-1" />
            ) : (
              <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
            )}
          </button>
        </div>
      </div>
    </header>
  );
};
