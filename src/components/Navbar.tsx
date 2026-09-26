import React, { useState, useEffect } from 'react';
import {
  Inbox,
  Send,
  Users,
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
  Shield,
  Search,
  Bell,
  ChevronDown,
} from 'lucide-react';
import { WHATSAPP_BUSINESS_NUMBER_FORMATTED } from '../services/whatsappInboundService';
import { AppUser } from '../types';
import { Umrah360Logo } from './Umrah360Logo';

export type ActiveTab =
  | 'inbox'
  | 'campaigns'
  | 'crm'
  | 'knowledge'
  | 'playground'
  | 'scenarios'
  | 'settings'
  | 'live-mailbox';

interface NavbarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  unreadCount: number;
  handoffCount: number;
  onResetSeedData: () => void;
  isFirebaseActive: boolean;
  currentUser?: AppUser | null;
  onLogout?: () => void;
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
    if (!currentUser) return true;
    if (currentUser.accessLevel === 'ALL' || currentUser.role === 'ADMIN') return true;
    return currentUser.allowedModules.includes(tabId);
  };

  const navItems: { id: ActiveTab; label: string; icon: React.FC<{ className?: string }>; badge?: number | string }[] = [
    { id: 'inbox', label: 'Unified Inbox', icon: Inbox, badge: unreadCount > 0 ? unreadCount : undefined },
    { id: 'campaigns', label: 'Outbound Campaigns', icon: Send },
    { id: 'crm', label: 'CRM & Pipeline', icon: Users },
    { id: 'knowledge', label: 'Knowledge Base', icon: BookOpen },
    { id: 'playground', label: 'AI Studio & Playground', icon: Sparkles },
    { id: 'scenarios', label: 'Interactive Scenarios', icon: PlayCircle },
    { id: 'settings', label: 'Channels & Settings', icon: Settings },
    { id: 'live-mailbox', label: 'Live Mailbox & SMTP', icon: Mail },
  ];

  return (
    <header className="bg-white border-b border-slate-200/90 sticky top-0 z-40 shadow-sm">
      {/* Top Bar - Brand & Global Tools */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16 gap-4">
          
          {/* Zone 1: Umrah 360 Logo & OS Tagline */}
          <div className="flex items-center space-x-3">
            <button 
              onClick={() => setActiveTab('inbox')}
              className="hover:opacity-90 transition focus:outline-none flex items-center space-x-2"
            >
              <Umrah360Logo size="md" />
            </button>
            <div className="hidden xl:flex items-center space-x-2 pl-3 border-l border-slate-200">
              <span className="px-2.5 py-0.5 rounded-full bg-orange-50 text-orange-600 font-semibold text-xs border border-orange-200">
                CRM OS
              </span>
            </div>
          </div>

          {/* Zone 2: Search & Live Connection Badges */}
          <div className="hidden lg:flex items-center space-x-2.5 text-xs">
            {/* System Connection Badge */}
            <div
              className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full border text-xs font-medium ${
                isFirebaseActive
                  ? 'bg-emerald-50 border-emerald-200 text-emerald-800'
                  : 'bg-amber-50 border-amber-200 text-amber-800'
              }`}
            >
              <Database className="w-3.5 h-3.5 text-emerald-600" />
              <span>Firestore Sync</span>
            </div>

            {/* Gemini Model Badge */}
            <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-slate-100 border border-slate-200 text-slate-800 font-medium">
              <Bot className="w-3.5 h-3.5 text-orange-500" />
              <span>Gemini 2.5 AI</span>
            </div>

            {/* SMTP Live Status */}
            {isModuleAccessible('live-mailbox') && (
              <button
                onClick={() => setActiveTab('live-mailbox')}
                className={`flex items-center space-x-1.5 px-3 py-1.5 rounded-full border text-xs transition font-medium ${
                  activeTab === 'live-mailbox'
                    ? 'bg-slate-900 border-slate-900 text-white'
                    : 'bg-slate-50 border-slate-200 text-slate-700 hover:bg-slate-100'
                }`}
                title={`Live Mailbox & SMTP Connection for ${activeMailbox}`}
              >
                <Radio className="w-3.5 h-3.5 text-orange-500 animate-pulse" />
                <span className="font-mono text-[11px] truncate max-w-[140px]">{activeMailbox}</span>
              </button>
            )}

            {/* WhatsApp Line Status */}
            {isModuleAccessible('inbox') && (
              <button
                onClick={() => setActiveTab('inbox')}
                className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-emerald-50 border border-emerald-200 text-emerald-800 hover:bg-emerald-100/80 transition text-xs font-medium"
                title={`Live WhatsApp Business Line: ${WHATSAPP_BUSINESS_NUMBER_FORMATTED}`}
              >
                <MessageSquare className="w-3.5 h-3.5 text-emerald-600" />
                <span className="font-mono text-[11px]">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
              </button>
            )}

            {/* Human Handoff Badge */}
            {handoffCount > 0 && isModuleAccessible('inbox') && (
              <div className="flex items-center space-x-1.5 px-3 py-1.5 rounded-full bg-orange-100 border border-orange-300 text-orange-900 font-bold animate-bounce">
                <span>{handoffCount} Handoff Pending</span>
              </div>
            )}
          </div>

          {/* Zone 3: Actions & User Profile */}
          <div className="flex items-center space-x-3">
            {/* Reset Demo Button */}
            <button
              onClick={onResetSeedData}
              title="Reset initial demo data (Campaigns, Leads, Knowledge Base)"
              className="hidden sm:flex items-center space-x-1.5 px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition"
            >
              <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
              <span>Reset Data</span>
            </button>

            {/* User Profile Badge */}
            {currentUser && (
              <div className="flex items-center space-x-2 pl-2 border-l border-slate-200">
                <div className="flex items-center space-x-2.5 bg-slate-50 border border-slate-200/90 px-3 py-1.5 rounded-xl">
                  {/* User Avatar Circle */}
                  <div className="relative">
                    <div className="w-7 h-7 rounded-full bg-orange-500 text-white font-bold text-xs flex items-center justify-center shadow-sm">
                      {currentUser.name.charAt(0)}
                    </div>
                    <span className="absolute bottom-0 right-0 w-2 h-2 rounded-full bg-emerald-500 ring-2 ring-white" />
                  </div>

                  <div className="hidden md:block text-left">
                    <div className="flex items-center space-x-1.5">
                      <span className="text-xs font-bold text-slate-900 truncate max-w-[110px]">
                        {currentUser.name}
                      </span>
                      <span className="text-[10px] font-extrabold px-1.5 py-0.2 rounded bg-orange-100 text-orange-700 border border-orange-200">
                        {currentUser.role === 'ADMIN' ? 'HR002' : currentUser.role}
                      </span>
                    </div>
                    <div className="text-[10px] text-slate-500 font-medium">
                      {currentUser.role === 'ADMIN' ? 'Operations Lead' : 'Team Agent'}
                    </div>
                  </div>
                </div>

                {/* Logout Button */}
                {onLogout && (
                  <button
                    onClick={onLogout}
                    title="Sign Out"
                    className="p-2 rounded-xl bg-slate-100 hover:bg-slate-900 hover:text-white text-slate-600 border border-slate-200 transition"
                  >
                    <LogOut className="w-4 h-4" />
                  </button>
                )}
              </div>
            )}
          </div>
        </div>

        {/* Navigation Bar - Orange & Black Pill Theme */}
        <div className="flex items-center space-x-1.5 overflow-x-auto py-2.5 border-t border-slate-100 scrollbar-none">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            const isAccessible = isModuleAccessible(item.id);

            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center space-x-2 px-4 py-2 rounded-xl text-xs font-semibold whitespace-nowrap transition-all duration-150 ${
                  !isAccessible
                    ? 'opacity-40 text-slate-400 bg-slate-50 border border-slate-200/50 cursor-pointer'
                    : isActive
                    ? 'bg-orange-500 text-white shadow-md shadow-orange-500/20 font-bold'
                    : 'bg-slate-100/90 text-slate-700 hover:bg-slate-200/80 hover:text-slate-900'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-500'}`} />
                <span>{item.label}</span>

                {!isAccessible && <Lock className="w-3 h-3 text-amber-500 ml-1" />}

                {item.badge !== undefined && (
                  <span
                    className={`ml-1.5 px-2 py-0.5 text-[10px] font-extrabold rounded-full ${
                      isActive
                        ? 'bg-white text-orange-600'
                        : 'bg-slate-900 text-white'
                    }`}
                  >
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
