import React, { useState } from 'react';
import { Activity, ArrowUpRight, Bot, CalendarClock, Lightbulb, Loader2, Plus, Sparkles, WandSparkles, X } from 'lucide-react';
import { useAgent } from '../context/AgentContext';
import type { ActiveTab } from './Navbar';

interface DashboardAiHomeHeroProps {
  userName?: string;
  canUseAi: boolean;
  onNavigate: (tab: ActiveTab) => void;
}

const QUICK_TASKS = [
  { label: 'Analyze my workspace', prompt: 'Analyze my workspace performance. Review the available CRM, conversations, campaign, follow-up and demo data, then give me the most important insights and recommended next actions.' },
  { label: 'Plan a campaign', prompt: 'Help me plan a campaign using the lead databases and brand assets available in my workspace. Recommend an audience and campaign approach first. Do not send anything without my approval.' },
  { label: 'Find leads to follow up', prompt: 'Review my CRM leads and identify the highest-priority leads that need follow-up. Explain why each one needs attention and recommend the next action.' },
];

export const DashboardAiHomeHero: React.FC<DashboardAiHomeHeroProps> = ({ userName, canUseAi, onNavigate }) => {
  const { sending, loading, error, sendMessage, newConversation, clearError } = useAgent();
  const [prompt, setPrompt] = useState('');
  const [startingAgent, setStartingAgent] = useState(false);

  const openAgentWithMessage = async (message?: string) => {
    if (!canUseAi || sending || startingAgent) return;
    clearError();
    setStartingAgent(true);
    const conversationId = await newConversation('agent');
    if (!conversationId) {
      setStartingAgent(false);
      return;
    }
    if (message) setPrompt('');
    setStartingAgent(false);
    onNavigate('agent');
    if (message) {
      // Reuse the exact conversation created above; do not create a second chat.
      void sendMessage(message, 'agent', [], conversationId);
    }
  };

  const submit = async (event?: React.FormEvent<HTMLFormElement>, override?: string) => {
    event?.preventDefault();
    const message = String(override ?? prompt).trim();
    if (!message || sending || startingAgent || !canUseAi) return;
    await openAgentWithMessage(message);
  };

  const startFresh = async () => {
    if (!canUseAi || sending || startingAgent) return;
    setPrompt('');
    await openAgentWithMessage();
  };

  return (
    <section className="dashboard-ai-hero relative isolate overflow-hidden rounded-2xl border border-white/10 text-white">
      <div className="dashboard-ai-hero-glow" aria-hidden="true" />
      <div className="relative z-10 flex min-h-[370px] flex-col px-4 pb-7 pt-4 sm:min-h-[400px] sm:px-8 sm:pb-8 sm:pt-5">
        <div className="flex items-center justify-between gap-3">
          <button type="button" onClick={() => void submit(undefined, 'Help me create a complete brand kit for this workspace. Review the existing company profile, logo, brand colors, website and assets. Show me a recommended brand direction and what assets are missing before making changes.')} className="inline-flex items-center gap-2 rounded-full border border-white/20 bg-white/10 px-3.5 py-2 text-[10px] font-semibold text-white/90 shadow-sm backdrop-blur transition hover:bg-white/15 disabled:cursor-not-allowed disabled:opacity-40" disabled={!canUseAi}>
            <Sparkles className="h-3.5 w-3.5 text-fuchsia-200" /> Create a Brand Kit
          </button>
          <button type="button" onClick={() => onNavigate('agent')} className="inline-flex items-center gap-2 rounded-lg border border-white/20 bg-[#05051f]/75 px-3.5 py-2 text-[10px] font-semibold text-white shadow-sm backdrop-blur transition hover:border-white/40 hover:bg-[#11113a] disabled:cursor-not-allowed disabled:opacity-40" disabled={!canUseAi}>
            <WandSparkles className="h-3.5 w-3.5" /> Customize your AI
          </button>
        </div>

        <div className="mx-auto mt-8 w-full max-w-[820px] text-center sm:mt-8">
          <div className="mb-3 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1 text-[9px] font-bold uppercase tracking-[.18em] text-blue-100/90 backdrop-blur">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-300 shadow-[0_0_10px_rgba(110,231,183,.8)]" />
            Your AI workspace assistant
          </div>
          <h1 className="text-[30px] font-semibold leading-[1.1] tracking-[-.055em] text-white sm:text-[42px] lg:text-[48px]">
            Let&apos;s automate your success{userName ? ', ' + userName.split(' ')[0] : ''}.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[11px] leading-5 text-blue-100/75 sm:text-[12px]">
            Ask your AI Agent to understand your workspace, uncover opportunities and help you get work done.
          </p>

          <form onSubmit={(event) => void submit(event)} className="dashboard-ai-prompt mt-6 rounded-2xl border border-white/15 bg-[#05051f]/95 p-3 text-left shadow-[0_18px_55px_rgba(0,0,0,.38)] backdrop-blur-xl sm:mt-8 sm:p-4">
            <textarea
              value={prompt}
              disabled={!canUseAi || sending}
              onChange={(event) => setPrompt(event.target.value)}
              onKeyDown={(event) => { if (event.key === 'Enter' && !event.shiftKey) { event.preventDefault(); void submit(); } }}
              placeholder="What would you like to accomplish today?"
              rows={2}
              maxLength={4000}
              aria-label="Ask your AI Agent"
              className="min-h-[62px] w-full resize-none border-0 bg-transparent px-1 py-1 text-[13px] leading-6 text-white outline-none placeholder:text-slate-400 focus:ring-0 sm:min-h-[74px] sm:text-[14px]"
            />
            <div className="flex flex-wrap items-center justify-between gap-2 pt-2">
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => void startFresh()} title="Start a new AI conversation" className="inline-flex h-8 w-8 items-center justify-center rounded-lg border border-white/15 text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40" disabled={!canUseAi || startingAgent || sending}><Plus className="h-4 w-4" /></button>
                <button type="button" onClick={() => onNavigate('agent')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40" disabled={!canUseAi}><Bot className="h-3.5 w-3.5" /> Tools</button>
                <button type="button" onClick={() => setPrompt((value) => value ? value + ' Use the approved information and assets in my workspace as context.' : 'Use the approved information and assets in my workspace as context.')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40" disabled={!canUseAi}><Lightbulb className="h-3.5 w-3.5" /> Add context</button>
                <button type="button" onClick={() => void submit(undefined, 'Help me plan a task and schedule the next steps for my workspace. First ask me for any deadline or timing details you need.')} className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-white/15 px-2.5 text-[10px] font-medium text-slate-300 transition hover:bg-white/10 hover:text-white disabled:opacity-40" disabled={!canUseAi}><CalendarClock className="h-3.5 w-3.5" /> Schedule task</button>
              </div>
              <button type="submit" disabled={!canUseAi || !prompt.trim() || sending || startingAgent} aria-label="Send prompt to AI Agent" className="inline-flex h-9 w-9 items-center justify-center rounded-full bg-[#0848ef] text-white shadow-[0_4px_16px_rgba(8,72,239,.35)] transition hover:bg-[#2864ff] disabled:cursor-not-allowed disabled:opacity-45">
                {sending || startingAgent ? <Loader2 className="h-4 w-4 animate-spin" /> : <ArrowUpRight className="h-4 w-4" />}
              </button>
            </div>
          </form>

          <div className="mt-3 flex flex-wrap items-center justify-center gap-2">
            <span className="mr-1 text-[9px] text-blue-100/55">Try asking</span>
            {QUICK_TASKS.map((task) => <button key={task.label} type="button" onClick={() => setPrompt(task.prompt)} disabled={!canUseAi} className="rounded-full border border-white/15 bg-white/[.06] px-3 py-1.5 text-[9px] font-medium text-blue-50/85 transition hover:border-white/30 hover:bg-white/10">{task.label}</button>)}
          </div>

          {error && <div role="alert" className="mx-auto mt-3 flex max-w-[760px] items-start justify-between gap-3 rounded-lg border border-rose-300/25 bg-rose-950/50 px-3 py-2 text-left text-[10px] text-rose-100"><span>{error}</span><button type="button" onClick={clearError} aria-label="Dismiss AI error"><X className="h-3.5 w-3.5" /></button></div>}
          {!canUseAi && <div className="mt-4 inline-flex items-center gap-2 rounded-full border border-amber-200/20 bg-amber-100/10 px-3 py-1.5 text-[9px] text-amber-100/80">AI Agent access is restricted by your workspace role or plan. Contact your administrator for access.</div>}
          {canUseAi && <div className="mt-4 inline-flex items-center gap-1.5 text-[9px] text-blue-100/45"><Activity className="h-3 w-3" /> Connected to your existing workspace AI Agent {loading ? '· Syncing' : '· Ready'}</div>}
        </div>
      </div>
    </section>
  );
};

export default DashboardAiHomeHero;
