import React from 'react';
import {
  PanelLeftClose,
  PanelLeftOpen,
  Radio,
  MessageSquare,
  LogOut,
  Inbox,
  AlertCircle,
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
  tenantId?: string;
  currentUser?: AppUser | null;
  onLogout?: () => void;
}

const PAGE_META: Record<ActiveTab, { section: string; title: string; description: string }> = {
  inbox: { section: 'CONVERSATIONS', title: 'Unified Inbox', description: 'Manage every customer conversation in one workspace.' },
  agent: { section: 'AI WORKSPACE', title: 'AI Agent', description: 'Work with your AI assistant, tools, and generated deliverables.' },
  'auto-followup': { section: 'SALES OPERATIONS', title: 'Auto Follow-Up', description: 'Monitor scheduled follow-ups and execution outcomes.' },
  database: { section: 'GROWTH', title: 'Lead Database', description: 'Organize prospect lists and campaign-ready audiences.' },
  campaigns: { section: 'GROWTH', title: 'Campaigns', description: 'Build, manage, and measure outbound campaigns.' },
  'campaign-reports': { section: 'GROWTH', title: 'Campaign Reports', description: 'Review campaign performance and AI-generated analysis.' },
  crm: { section: 'SALES OPERATIONS', title: 'CRM & Leads', description: 'Manage your pipeline, ownership, and next sales actions.' },
  scheduling: { section: 'SALES OPERATIONS', title: 'Demo Scheduling', description: 'Coordinate consultations, availability, and booked meetings.' },
  knowledge: { section: 'AI WORKSPACE', title: 'Knowledge Base', description: 'Manage the sources that ground your AI responses.' },
  playground: { section: 'AI WORKSPACE', title: 'AI Testing', description: 'Test responses and validate your AI configuration.' },
  'audit-logs': { section: 'ADMINISTRATION', title: 'Audit Logs', description: 'Review important changes and workspace activity.' },
  'company-profile': { section: 'ADMINISTRATION', title: 'Company Profile', description: 'Manage workspace identity and brand information.' },
  settings: { section: 'ADMINISTRATION', title: 'Settings', description: 'Configure your workspace, team, and connected services.' },
  'email-design-studio': { section: 'GROWTH', title: 'Email Design Studio', description: 'Create, edit, and prepare branded email experiences.' },
};

const initialsFor = (user?: AppUser | null) =>
  (user?.name || user?.email || 'U')
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]?.toUpperCase() || '')
    .join('');

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
  const { mailbox, whatsapp } = useConnectedChannels(tenantId);
  const meta = PAGE_META[activeTab];

  return (
    <header className="hidden h-[76px] shrink-0 items-center justify-between border-b border-slate-200 bg-white px-5 lg:px-7 md:flex">
      <div className="flex min-w-0 items-center gap-4">
        <button
          type="button"
          onClick={onToggleCollapse}
          title={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          aria-label={isCollapsed ? 'Expand navigation' : 'Collapse navigation'}
          className={`${activeTab === "inbox" ? "hidden" : "flex"} h-9 w-9 shrink-0 items-center justify-center rounded-lg border border-slate-200 text-slate-500 transition hover:border-slate-300 hover:bg-slate-50 hover:text-slate-900`}
        >
          {isCollapsed ? <PanelLeftOpen className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
        </button>
        <div className="min-w-0">
          <div className="mb-0.5 text-[9px] font-semibold uppercase tracking-[0.16em] text-slate-400">{meta.section}</div>
          <div className="truncate text-[17px] font-semibold leading-5 tracking-tight text-slate-900">{meta.title}</div>
          <div className="mt-0.5 truncate text-[11px] text-slate-500">{meta.description}</div>
        </div>
      </div>

      <div className="flex shrink-0 items-center gap-2.5">
        {mailbox && (
          <div
            title={'Connected mailbox: ' + mailbox}
            className="hidden max-w-[210px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 xl:flex"
          >
            <Radio className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span className="truncate text-[11px] font-medium text-slate-600">{mailbox}</span>
          </div>
        )}
        {whatsapp && (
          <button
            type="button"
            onClick={() => setActiveTab('inbox')}
            title={'Connected WhatsApp Business: ' + whatsapp}
            className="hidden max-w-[185px] items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2.5 py-2 transition hover:bg-slate-100 xl:flex"
          >
            <MessageSquare className="h-3.5 w-3.5 shrink-0 text-emerald-600" />
            <span className="truncate text-[11px] font-medium text-slate-600">{whatsapp}</span>
          </button>
        )}
        {unreadCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('inbox')}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-slate-200 px-3 text-[11px] font-medium text-slate-600 transition hover:bg-slate-50"
            title="Open unread conversations"
          >
            <Inbox className="h-3.5 w-3.5" />
            <span className="tabular-nums">{unreadCount > 99 ? '99+' : unreadCount}</span>
          </button>
        )}
        {handoffCount > 0 && (
          <button
            type="button"
            onClick={() => setActiveTab('inbox')}
            className="inline-flex h-9 items-center gap-2 rounded-lg border border-rose-200 bg-rose-50 px-3 text-[11px] font-semibold text-rose-700 transition hover:bg-rose-100"
            title="Open conversations waiting for human handoff"
          >
            <AlertCircle className="h-3.5 w-3.5" />
            <span className="tabular-nums">{handoffCount} handoff</span>
          </button>
        )}
        {currentUser && (
          <div className="ml-1 flex items-center gap-2 border-l border-slate-200 pl-3">
            <div className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-900 text-[10px] font-semibold text-white">
              {initialsFor(currentUser) || 'U'}
            </div>
            <div className="hidden min-w-0 xl:block">
              <div className="max-w-[130px] truncate text-[11px] font-semibold text-slate-800">{currentUser.name}</div>
              <div className="text-[10px] text-slate-500">{currentUser.role === 'ADMIN' ? 'Administrator' : currentUser.role === 'SALES' ? 'Sales' : 'Workspace member'}</div>
            </div>
            {onLogout && (
              <button
                type="button"
                onClick={onLogout}
                title="Sign out"
                aria-label="Sign out"
                className="ml-1 rounded-lg p-2 text-slate-400 transition hover:bg-rose-50 hover:text-rose-600"
              >
                <LogOut className="h-4 w-4" />
              </button>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default HeaderBar;
