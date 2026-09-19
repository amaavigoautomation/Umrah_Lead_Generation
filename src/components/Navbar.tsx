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
} from 'lucide-react';

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
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  unreadCount,
  handoffCount,
  onResetSeedData,
  isFirebaseActive,
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
          <div className="hidden lg:flex items-center space-x-4 text-xs">
            <div
              className={`flex items-center space-x-1.5 px-2.5 py-1 rounded-md border ${
                isFirebaseActive
                  ? 'bg-emerald-950/60 border-emerald-800 text-emerald-300'
                  : 'bg-amber-950/60 border-amber-800 text-amber-300'
              }`}
            >
              <Database className="w-3.5 h-3.5" />
              <span>Firestore: gen-lang-client-0376069258</span>
            </div>

            <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-slate-800 border border-slate-700 text-slate-300">
              <Bot className="w-3.5 h-3.5 text-blue-400" />
              <span>Gemini 2.5 Flash</span>
            </div>

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
              <span className="font-mono">{activeMailbox} (Live)</span>
            </button>

            {handoffCount > 0 && (
              <div className="flex items-center space-x-1.5 px-2.5 py-1 rounded-md bg-amber-500/20 border border-amber-500/40 text-amber-300 font-medium">
                <span>{handoffCount} Human Handoff</span>
              </div>
            )}
          </div>

          {/* Action to Seed / Reset Data */}
          <div className="flex items-center space-x-2">
            <button
              onClick={onResetSeedData}
              title="Reset initial demo data (Campaigns, Rahul Sharma thread, Knowledge Base)"
              className="flex items-center space-x-1.5 px-3 py-1.5 rounded-md bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium border border-slate-700 transition"
            >
              <RefreshCw className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">Reset Demo</span>
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 overflow-x-auto py-2 scrollbar-none text-sm border-t border-slate-800/60">
          <button
            onClick={() => setActiveTab('inbox')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'inbox'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Inbox className="w-4 h-4" />
            <span>Unified Inbox</span>
            {unreadCount > 0 && (
              <span className="ml-1.5 px-1.5 py-0.2 bg-emerald-400 text-slate-900 text-xs font-bold rounded-full">
                {unreadCount}
              </span>
            )}
          </button>

          <button
            onClick={() => setActiveTab('campaigns')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'campaigns'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Send className="w-4 h-4" />
            <span>Outbound & Apollo</span>
          </button>

          <button
            onClick={() => setActiveTab('crm')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'crm'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Users className="w-4 h-4" />
            <span>CRM & Leads</span>
          </button>

          <button
            onClick={() => setActiveTab('knowledge')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'knowledge'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Knowledge Base (RAG)</span>
          </button>

          <button
            onClick={() => setActiveTab('playground')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'playground'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Sparkles className="w-4 h-4" />
            <span>AI Testing</span>
          </button>

          <button
            onClick={() => setActiveTab('scenarios')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'scenarios'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <PlayCircle className="w-4 h-4" />
            <span>E2E Walkthroughs</span>
          </button>

          <button
            onClick={() => setActiveTab('settings')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'settings'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-300 hover:text-white hover:bg-slate-800'
            }`}
          >
            <Settings className="w-4 h-4" />
            <span>Channels & Settings</span>
          </button>

          <button
            onClick={() => setActiveTab('live-mailbox')}
            className={`flex items-center space-x-2 px-3.5 py-1.5 rounded-md font-medium whitespace-nowrap transition ${
              activeTab === 'live-mailbox'
                ? 'bg-blue-600 text-white shadow-sm'
                : 'text-blue-300 hover:text-white hover:bg-blue-950/60 border border-blue-500/30'
            }`}
          >
            <Mail className="w-4 h-4 text-blue-400" />
            <span>Live Mailbox & SMTP</span>
            <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          </button>
        </div>
      </div>
    </header>
  );
};
