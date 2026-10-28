import { useBrand } from '../context/BrandContext';
import React from 'react';
import {
  PanelLeft,
  PanelLeftClose,
  Radio,
  MessageSquare,
  LogOut,
  Shield,
  Inbox,
  Send,
  Users,
  Calendar,
  BookOpen,
  Images,
  Sparkles,
  Settings,
  Bot,
} from 'lucide-react';
import { ActiveTab } from './Navbar';
import { AppUser } from '../types';
import { useConnectedChannels } from '../hooks/useConnectedChannels';

interface HeaderBarProps {
  activeTab: ActiveTab;
  setActiveTab: (tab: ActiveTab) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
  unreadCount: number;
  handoffCount: number;
  /** Workspace whose connected email / WhatsApp number are shown in the header. */
  tenantId?: string;
  currentUser?: AppUser | null;
  onLogout?: () => void;
}

const TAB_TITLES: Record<ActiveTab, { title: string; icon: React.ReactNode }> = {
  inbox: { title: 'Unified Inbox', icon: <Inbox className="w-4 h-4 text-orange-600" /> },
  'auto-followup': { title: 'Auto Follow-Up Agent', icon: <Bot className="w-4 h-4 text-orange-600" /> },
  campaigns: { title: 'Outbound Campaigns', icon: <Send className="w-4 h-4 text-orange-600" /> },
  'company-assets': { title: 'Company Assets', icon: <Images className="w-4 h-4 text-orange-600" /> },
  crm: { title: 'CRM & Lead Pipeline', icon: <Users className="w-4 h-4 text-orange-600" /> },
  scheduling: { title: 'Demo Scheduling Agent', icon: <Calendar className="w-4 h-4 text-orange-600" /> },
  knowledge: { title: 'Knowledge Base (RAG)', icon: <BookOpen className="w-4 h-4 text-orange-600" /> },
  playground: { title: 'AI Testing Playground', icon: <Sparkles className="w-4 h-4 text-orange-600" /> },
  settings: { title: 'Settings & Channels', icon: <Settings className="w-4 h-4 text-orange-600" /> },
};

export const HeaderBar: React.FC<HeaderBarProps> = ({
  activeTab,
  setActiveTab,
  isCollapsed,
  onToggleCollapse,
  unreadCount,
  handoffCount,
  tenantId,
  currentUser,
  onLogout,
}) => {
  const { brand } = useBrand();
  const isUmrahBrand = brand.playbook === 'umrah360';
  // Only what THIS workspace has actually connected is shown. Nothing is shown when nothing is connected.
  const { mailbox: connectedMailbox, whatsapp: connectedWhatsApp } = useConnectedChannels(tenantId);

  const currentTabMeta = TAB_TITLES[activeTab] || { title: 'Dashboard', icon: null };

  return (
    <header className="h-13 bg-white border-b border-slate-200/90 px-4 sm:px-6 flex items-center justify-between sticky top-0 z-30 shadow-2xs shrink-0 select-none">
      {/* Left: Company Logo (Amaavigo), Collapse Sidebar Button & View Icon */}
      <div className="flex items-center space-x-3">
        {/* Company Logo: Amaavigo */}
        {(isUmrahBrand || brand.logoUrl) && (
          <div className="flex items-center space-x-2 border-r border-slate-200 pr-3">
            <img
              src={brand.logoUrl || '/amaavigo-logo.png'}
              alt={brand.logoUrl ? brand.companyName : 'Amaavigo'}
              className="h-6 w-auto object-contain"
            />
          </div>
        )}

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
        {/* Connected mailbox (this workspace only; hidden when none is connected) */}
        {connectedMailbox && (
          <div
            className="hidden sm:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border bg-slate-50 border-slate-200/80 text-slate-600 text-xs"
            title={`Connected mailbox: ${connectedMailbox}`}
          >
            <Radio className="w-3.5 h-3.5 text-blue-500 animate-pulse shrink-0" />
            <span className="font-mono text-[11px] truncate max-w-[180px]">{connectedMailbox}</span>
          </div>
        )}

        {/* Connected WhatsApp number (this workspace only; hidden when none is connected) */}
        {connectedWhatsApp && (
          <button
            onClick={() => setActiveTab('inbox')}
            className="hidden md:flex items-center space-x-1.5 px-2.5 py-1 rounded-lg border border-slate-200/80 bg-slate-50 text-slate-600 hover:text-slate-900 hover:bg-slate-100 text-xs transition"
            title={`Connected WhatsApp Business: ${connectedWhatsApp}`}
          >
            <MessageSquare className="w-3.5 h-3.5 text-emerald-500 animate-pulse shrink-0" />
            <span className="font-mono text-[11px] truncate">{connectedWhatsApp}</span>
          </button>
        )}

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
