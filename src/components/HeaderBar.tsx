import React, { useState, useEffect } from 'react';
import {
  PanelLeft,
  PanelLeftClose,
  Radio,
  MessageSquare,
  RefreshCw,
  LogOut,
  Shield,
  Inbox,
  Send,
  Users,
  Calendar,
  BookOpen,
  Sparkles,
  PlayCircle,
  Settings,
  Bot,
  Mail,
} from 'lucide-react';
import { WHATSAPP_BUSINESS_NUMBER_FORMATTED } from '../services/whatsappInboundService';
import { ActiveTab } from './Navbar';
import { AppUser } from '../types';

interface HeaderBarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  unreadCount: number;
  handoffCount: number;
  onResetSeedData: () => void;
  currentUser?: AppUser | null;
  onLogout?: () => void;
}

const TAB_TITLES: Record<ActiveTab, { title: string; icon: React.ReactNode }> = {
  inbox: { title: 'Unified Inbox', icon: <Inbox className="w-4 h-4 text-orange-600" /> },
  'auto-followup': { title: 'Auto Follow-Up Agent', icon: <Bot className="w-4 h-4 text-orange-600" /> },
  campaigns: { title: 'Outbound Campaigns', icon: <Send className="w-4 h-4 text-orange-600" /> },
  crm: { title: 'CRM & Lead Pipeline', icon: <Users className="w-4 h-4 text-orange-600" /> },
  scheduling: { title: 'Demo Scheduling Agent', icon: <Calendar className="w-4 h-4 text-orange-600" /> },
  knowledge: { title: 'Knowledge Base (RAG)', icon: <BookOpen className="w-4 h-4 text-orange-600" /> },
  playground: { title: 'AI Testing Playground', icon: <Sparkles className="w-4 h-4 text-orange-600" /> },
  scenarios: { title: 'E2E Walkthroughs', icon: <PlayCircle className="w-4 h-4 text-orange-600" /> },
  settings: { title: 'Settings & Channels', icon: <Settings className="w-4 h-4 text-orange-600" /> },
  'live-mailbox': { title: 'Live Mailbox & SMTP', icon: <Mail className="w-4 h-4 text-orange-600" /> },
};

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  setActiveTab,
  isCollapsed,
  onToggleCollapse,
  unreadCount,
  handoffCount,
  onResetSeedData,
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

  const currentTabMeta = TAB_TITLES[activeTab] || { title: 'Dashboard', icon: null };

  return (
    <header className="h-13 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-2xs shrink-0 select-none">
      {/* Left: Company Logo (Amaavigo), Collapse Sidebar Button & View Icon */}
      <div className="flex items-center space-x-3">
        {/* Company Logo: Amaavigo */}
        <div className="flex items-center space-x-2 border-r border-slate-200 pr-3">
          <img src="/amaavigo-logo.png" alt="Amaavigo" className="h-6 w-auto object-contain" />
        </div>

        <button
          onClick={onToggleCollapse}
          className="p-1.5 rounded-lg text-slate-500 hover:text-slate-900 hover:bg-slate-100 transition flex items-center justify-center border border-slate-200/60 shadow-2xs"
          title={isCollapsed ? 'Expand Sidebar' : 'Collapse Sidebar'}
        >
          {isCollapsed ? <PanelLeft className="w-4 h-4 text-orange-600" /> : <PanelLeftClose className="w-4 h-4" />}
        </button>

        {currentTabMeta.icon && (
          <div className="flex items-center">
            {currentTabMeta.icon}
          </div>
        )}
      </div>

      {/* Right: Live Channel Badges & Actions with Sign Out at Rightmost Corner */}
      <div className="flex items-center space-x-2 sm:space-x-3 text-xs">
        {/* Live Mailbox Status */}
        <button
          onClick={() => setActiveTab('live-mailbox')}
          className={`hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border text-xs transition ${
            activeTab === 'live-mailbox'
              ? 'bg-orange-50 border-orange-200 text-orange-700 font-semibold shadow-2xs'
              : 'bg-slate-50 border-slate-200/80 text-slate-600 hover:text-slate-900 hover:bg-slate-100'
          }`}
          title={`Live Mailbox: ${activeMailbox}`}
        >
          <Radio className="w-3.5 h-3.5 text-blue-500 animate-pulse shrink-0" />
          <span className="font-mono text-[11px] truncate max-w-[140px]">{activeMailbox}</span>
        </button>

        {/* Live WhatsApp Status */}
        <button
          onClick={() => setActiveTab('inbox')}
          className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs transition"
          title={`Live WhatsApp Business: ${WHATSAPP_BUSINESS_NUMBER_FORMATTED}`}
        >
          <MessageSquare className="w-3.5 h-3.5 text-emerald-500 animate-pulse shrink-0" />
          <span className="font-mono text-[11px] truncate">{WHATSAPP_BUSINESS_NUMBER_FORMATTED}</span>
        </button>

        {/* Handoff Alert Badge */}
        {handoffCount > 0 && (
          <button
            onClick={() => setActiveTab('inbox')}
            className="flex items-center space-x-1.5 px-2.5 py-1 rounded-full bg-orange-50 border border-orange-200 text-orange-800 font-bold text-[11px] shadow-2xs"
          >
            <span className="w-2 h-2 rounded-full bg-orange-500 animate-ping"></span>
            <span>{handoffCount} Handoff</span>
          </button>
        )}

        {/* Reset Demo Data Button */}
        <button
          onClick={onResetSeedData}
          title="Reset initial demo data (Campaigns, Leads, Knowledge Base)"
          className="flex items-center space-x-1.5 px-2.5 py-1 rounded-lg bg-slate-50 hover:bg-slate-100 text-slate-700 text-xs font-semibold border border-slate-200/80 shadow-2xs transition"
        >
          <RefreshCw className="w-3.5 h-3.5 text-slate-500" />
          <span className="hidden sm:inline">Reset Demo</span>
        </button>

        {/* Rightmost Corner: Sign Out Button */}
        {currentUser && onLogout && (
          <button
            onClick={onLogout}
            title="Sign Out"
            className="flex items-center space-x-1.5 px-3 py-1.5 rounded-lg bg-white hover:bg-red-50 text-slate-700 hover:text-red-600 border border-slate-200 hover:border-red-200 text-xs font-bold transition shadow-2xs shrink-0"
          >
            <LogOut className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Sign Out</span>
          </button>
        )}
      </div>
    </header>
  );
};

export default HeaderBar;
