import React, { useState } from 'react';
import { Activity, Bot, Check, Command, Database, FileText, History, Loader2, Plus, Send, Settings2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { useAgent, AgentAutonomy, AgentMessage } from '../context/AgentContext';
import type { AppUser } from '../types';

const QUICK_PROMPTS = [
  { icon: Database, label: 'Review my lead databases', prompt: 'Review the lead databases available in this workspace. Summarize their names, sizes, and what campaign use cases they may support.' },
  { icon: FileText, label: 'Find product knowledge', prompt: 'Search the Knowledge Base for the most important product, pricing, and policy information. Summarize what is available and highlight gaps.' },
  { icon: Activity, label: 'Plan a campaign', prompt: 'Help me plan an outbound campaign. First inspect the available databases and email designs, then recommend a safe draft plan. Do not create or send anything.' },
];

function Orb({ small = false }: { small?: boolean }) {
  return <div className={'agent-orb relative shrink-0 ' + (small ? 'h-9 w-9' : 'h-16 w-16')}>
    <div className="agent-orb-core absolute inset-[24%] rounded-full" />
    <div className="agent-orb-ring agent-orb-ring-one absolute inset-[7%] rounded-full" />
    <div className="agent-orb-ring agent-orb-ring-two absolute inset-0 rounded-full" />
    <div className="absolute inset-[39%] rounded-full bg-white/90 blur-[1px]" />
  </div>;
}

function Messages({ messages, sending, compact }: { messages: AgentMessage[]; sending: boolean; compact?: boolean }) {
  return <div className={'agent-messages flex-1 min-h-0 overflow-y-auto ' + (compact ? 'px-3 py-4' : 'px-5 py-6')}>
    {messages.length === 0 && (
      <div className="flex h-full min-h-[250px] flex-col items-center justify-center text-center">
        <Orb />
        <div className="mt-5 text-lg font-semibold text-slate-900">Where should we start?</div>
        <p className="mt-2 max-w-sm text-sm leading-6 text-slate-400">Ask about your workspace, company knowledge, lead databases, or campaign planning.</p>
        {!compact && <div className="mt-6 grid w-full max-w-2xl grid-cols-1 gap-2 sm:grid-cols-3">
          {QUICK_PROMPTS.map((item) => {
            const Icon = item.icon;
            return <div key={item.label} className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-left">
              <Icon className="h-4 w-4 text-orange-600" />
              <div className="mt-2 text-xs font-semibold text-slate-200">{item.label}</div>
              <div className="mt-1 text-[11px] leading-4 text-slate-500">Select a starter prompt below</div>
            </div>;
          })}
        </div>}
      </div>
    )}
    <div className="mx-auto flex max-w-3xl flex-col gap-4">
      {messages.map((message) => (
        <div key={message.id} className={'agent-message-enter flex ' + (message.role === 'user' ? 'justify-end' : 'justify-start')}>
          {message.role === 'assistant' && <div className="mr-2 mt-1 flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border border-blue-200 bg-cyan-400/10"><Bot className="h-4 w-4 text-orange-600" /></div>}
          <div className={'max-w-[88%] rounded-2xl px-4 py-3 text-sm leading-6 ' + (message.role === 'user'
            ? 'rounded-br-md border border-orange-200 bg-cyan-400/10 text-slate-900'
            : 'rounded-bl-md border border-slate-200 bg-slate-50 text-slate-200')}>
            <div className="whitespace-pre-wrap break-words">{message.content}</div>
            {message.toolsUsed && message.toolsUsed.length > 0 && (
              <div className="mt-3 flex flex-wrap gap-1.5 border-t border-slate-200 pt-2">
                {message.toolsUsed.map((tool) => <span key={tool} className="rounded-md bg-orange-50 px-2 py-0.5 text-[10px] text-orange-700">{tool.replaceAll('_', ' ')}</span>)}
              </div>
            )}
          </div>
        </div>
      ))}
      {sending && <div className="flex items-center gap-2 text-xs text-orange-700"><Loader2 className="h-4 w-4 animate-spin" /> Agent is reasoning and checking workspace data…</div>}
    </div>
  </div>;
}

function ChatComposer({ moduleContext, compact }: { moduleContext: string; compact?: boolean }) {
  const { sendMessage, sending } = useAgent();
  const [value, setValue] = useState('');
  const submit = () => {
    if (!value.trim() || sending) return;
    const text = value;
    setValue('');
    void sendMessage(text, moduleContext);
  };
  return <div className={'border-t border-slate-200 ' + (compact ? 'p-3' : 'p-5')}>
    {!compact && <div className="mb-2 flex flex-wrap gap-2">
      {QUICK_PROMPTS.map((item) => <button key={item.label} type="button" onClick={() => { setValue(item.prompt); }} className="rounded-full border border-slate-200 px-3 py-1.5 text-[11px] text-slate-300 transition hover:border-orange-300 hover:bg-orange-50">{item.label}</button>)}
    </div>}
    <div className="flex items-end gap-2 rounded-2xl border border-orange-200 bg-white p-2 shadow-[0_0_24px_rgba(239,116,26,0.07)] focus-within:border-orange-400">
      <textarea value={value} onChange={(e) => setValue(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); submit(); } }} rows={compact ? 2 : 2} placeholder="Message your AI Agent…" className="max-h-32 min-h-[48px] flex-1 resize-y bg-transparent px-2 py-2 text-sm text-slate-900 outline-none placeholder:text-slate-600" />
      <button type="button" disabled={!value.trim() || sending} onClick={submit} className="mb-1 flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-orange-600 text-white shadow-lg shadow-orange-500/10 transition hover:brightness-110 disabled:cursor-not-allowed disabled:opacity-35"><Send className="h-4 w-4" /></button>
    </div>
    <div className="mt-2 flex items-center justify-between text-[10px] text-slate-500"><span>Enter to send · Shift + Enter for a new line</span><span>Read-only tools · workspace-scoped</span></div>
  </div>;
}

function ConfigPanel({ compact = false }: { compact?: boolean }) {
  const { config, saveConfig, canManageConfig } = useAgent();
  const [preference, setPreference] = useState('');
  const [saving, setSaving] = useState(false);
  const updateAutonomy = async (autonomy: AgentAutonomy) => {
    setSaving(true);
    await saveConfig({ autonomy });
    setSaving(false);
  };
  const addPreference = async () => {
    const next = preference.trim();
    if (!next || !canManageConfig) return;
    setSaving(true);
    const ok = await saveConfig({ companyPreferences: [...config.companyPreferences, next].slice(0, 20) });
    if (ok) setPreference('');
    setSaving(false);
  };
  const removePreference = async (index: number) => {
    setSaving(true);
    await saveConfig({ companyPreferences: config.companyPreferences.filter((_, i) => i !== index) });
    setSaving(false);
  };
  return <div className={'space-y-4 ' + (compact ? '' : 'rounded-2xl border border-slate-200 bg-slate-50 p-4')}>
    <div>
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Settings2 className="h-4 w-4 text-orange-600" /> Agent autonomy</div>
      <p className="mt-1 text-xs leading-5 text-slate-500">This is the workspace policy for future registered actions. It never bypasses permissions or safety approvals.</p>
      <div className="mt-3 space-y-2">
        {([
          ['ask', 'Ask before everything', 'Request approval before each action.'],
          ['balanced', 'Balanced · recommended', 'New items may be prepared automatically; changes need approval.'],
          ['full', 'Full autonomy', 'Allow registered actions within the configured permission and safety boundaries.'],
        ] as [AgentAutonomy, string, string][]).map(([mode, title, subtitle]) => (
          <button key={mode} type="button" disabled={!canManageConfig || saving} onClick={() => void updateAutonomy(mode)} className={'w-full rounded-xl border p-3 text-left transition disabled:cursor-not-allowed disabled:opacity-60 ' + (config.autonomy === mode ? 'border-orange-400 bg-orange-50' : 'border-slate-200 bg-white hover:bg-slate-100')}>
            <div className="flex items-center justify-between gap-2 text-xs font-semibold text-slate-200"><span>{title}</span>{config.autonomy === mode && <Check className="h-4 w-4 text-orange-600" />}</div>
            <div className="mt-1 text-[11px] leading-4 text-slate-500">{subtitle}</div>
          </button>
        ))}
      </div>
      {!canManageConfig && <div className="mt-2 text-[10px] text-slate-600">Only workspace admins can change this policy.</div>}
    </div>
    <div className="border-t border-slate-200 pt-4">
      <div className="flex items-center gap-2 text-sm font-semibold text-slate-900"><Sparkles className="h-4 w-4 text-blue-600" /> Company memory</div>
      <p className="mt-1 text-xs leading-5 text-slate-500">Shared workspace preferences. Add only guidance the team has approved.</p>
      <div className="mt-3 space-y-2">
        {config.companyPreferences.map((item, index) => <div key={item + index} className="flex items-start gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"><span className="flex-1 text-xs leading-5 text-slate-300">{item}</span>{canManageConfig && <button type="button" disabled={saving} onClick={() => void removePreference(index)} className="text-slate-500 hover:text-rose-600" aria-label="Remove preference"><X className="h-3.5 w-3.5" /></button>}</div>)}
        {config.companyPreferences.length === 0 && <div className="rounded-lg border border-dashed border-slate-200 px-3 py-3 text-xs text-slate-600">No company preferences saved yet.</div>}
      </div>
      {canManageConfig && <div className="mt-3 flex gap-2"><input value={preference} onChange={(e) => setPreference(e.target.value)} maxLength={300} placeholder="Add an approved company preference…" className="min-w-0 flex-1 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-900 outline-none placeholder:text-slate-600 focus:border-orange-400" /><button type="button" disabled={!preference.trim() || saving} onClick={() => void addPreference()} className="rounded-lg bg-slate-100 px-3 text-xs font-semibold text-slate-900 disabled:opacity-40">Save</button></div>}
    </div>
    <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-[11px] leading-5 text-amber-800"><ShieldCheck className="mr-1 inline h-3.5 w-3.5" /> Current release: read-only tool registry. No campaigns, messages, settings, or other records can be changed from the Agent yet.</div>
  </div>;
}

export const AgentWorkspace: React.FC<{ currentUser: AppUser }> = ({ currentUser }) => {
  const { conversations, activeConversationId, messages, loading, sending, error, canManageConfig, selectConversation, newConversation, clearError, refresh } = useAgent();
  const [showSettings, setShowSettings] = useState(false);
  return <div className="agent-shell min-h-[calc(100vh-105px)] overflow-hidden rounded-3xl border border-slate-200 bg-white text-slate-900 shadow-2xl">
    <div className="agent-grid relative flex min-h-[calc(100vh-105px)] flex-col">
      <div className="relative flex items-center justify-between border-b border-slate-200 px-5 py-4 sm:px-7">
        <div className="flex items-center gap-3"><Orb small /><div><div className="flex items-center gap-2 text-base font-bold tracking-tight">AI Agent <span className="rounded-full border border-orange-200 bg-orange-50 px-2 py-0.5 text-[9px] font-semibold uppercase tracking-[0.18em] text-orange-700">Workspace</span></div><div className="mt-0.5 text-[11px] text-slate-500">Context-aware assistant · secure execution boundary</div></div></div>
        <div className="flex items-center gap-2"><div className="hidden items-center gap-1.5 rounded-full border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[10px] text-emerald-700 sm:flex"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500 shadow-[0_0_9px_rgba(110,231,183,.8)]" /> Workspace connected</div><button type="button" onClick={() => setShowSettings((x) => !x)} className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Settings2 className="h-4 w-4" /></button><button type="button" onClick={() => void refresh()} className="rounded-xl border border-slate-200 p-2 text-slate-400 hover:bg-slate-100 hover:text-slate-900"><Activity className="h-4 w-4" /></button></div>
      </div>
      <div className="grid min-h-0 flex-1 lg:grid-cols-[250px_minmax(0,1fr)_300px]">
        <aside className="hidden border-r border-slate-200 p-4 lg:block">
          <button type="button" onClick={() => void newConversation('agent')} className="flex w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-orange-500 to-orange-600 px-3 py-2.5 text-xs font-bold text-white shadow-lg shadow-orange-500/10"><Plus className="h-4 w-4" /> New conversation</button>
          <div className="mt-6 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.18em] text-slate-600"><History className="h-3.5 w-3.5" /> Recent conversations</div>
          <div className="mt-3 space-y-1.5">
            {conversations.map((item) => <button key={item.id} type="button" onClick={() => void selectConversation(item.id)} className={'w-full rounded-xl px-3 py-2.5 text-left transition ' + (activeConversationId === item.id ? 'bg-orange-50 text-orange-700' : 'text-slate-400 hover:bg-slate-100 hover:text-slate-900')}><div className="truncate text-xs font-medium">{item.title || 'New conversation'}</div><div className="mt-1 text-[10px] text-slate-600">{new Date(item.updatedAt || item.createdAt).toLocaleDateString()}</div></button>)}
            {conversations.length === 0 && !loading && <div className="px-2 py-3 text-xs text-slate-600">Your recent tasks will appear here.</div>}
          </div>
          <div className="mt-6 rounded-xl border border-slate-200 bg-slate-50 p-3"><div className="flex items-center gap-2 text-xs font-semibold text-slate-300"><Command className="h-3.5 w-3.5 text-orange-600" /> Workspace context</div><div className="mt-2 text-[11px] leading-5 text-slate-500">The Agent can inspect approved company profile, published knowledge, lead database summaries, assets, and email designs.</div></div>
        </aside>
        <section className="flex min-h-[520px] min-w-0 flex-col">
          <div className="flex items-center justify-between border-b border-slate-200 px-4 py-3 sm:px-5"><div className="truncate text-xs font-semibold text-slate-300">{conversations.find((x) => x.id === activeConversationId)?.title || 'New workspace task'}</div><div className="flex items-center gap-2"><span className="text-[10px] text-slate-600">{currentUser.name}</span><button type="button" onClick={() => void newConversation('agent')} className="rounded-lg border border-slate-200 p-1.5 text-slate-400 hover:text-slate-900 lg:hidden"><Plus className="h-3.5 w-3.5" /></button></div></div>
          <Messages messages={messages} sending={sending} />
          <ChatComposer moduleContext="agent" />
        </section>
        <aside className="hidden border-l border-slate-200 p-4 xl:block">
          <div className="mb-3 flex items-center justify-between"><div className="text-xs font-bold uppercase tracking-[0.16em] text-slate-500">Policy & memory</div><ShieldCheck className="h-4 w-4 text-orange-600" /></div>
          <ConfigPanel />
          {showSettings && <div className="mt-3 rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs text-slate-300">Agent settings are visible to workspace admins. {canManageConfig ? 'Changes are saved to this workspace.' : 'Contact an admin to change them.'}</div>}
        </aside>
      </div>
      {showSettings && <div className="border-t border-slate-200 p-4 xl:hidden"><ConfigPanel /></div>}
      {error && <div className="flex items-center justify-between border-t border-rose-200 bg-rose-50 px-4 py-2 text-xs text-rose-700"><span>{error}</span><button type="button" onClick={clearError}><X className="h-3.5 w-3.5" /></button></div>}
      {loading && <div className="absolute right-4 top-20 flex items-center gap-2 rounded-full border border-slate-200 bg-white px-3 py-1.5 text-[10px] text-slate-400"><Loader2 className="h-3 w-3 animate-spin" /> Syncing conversations</div>}
    </div>
  </div>;
};

export const AgentFloatingCompanion: React.FC<{ hidden?: boolean; moduleContext: string }> = ({ hidden, moduleContext }) => {
  const [open, setOpen] = useState(false);
  const { messages, sending, error, clearError, newConversation, conversations, activeConversationId, selectConversation } = useAgent();
  if (hidden) return null;
  return <div className="fixed bottom-5 right-5 z-[80]">
    {open && <div className="agent-float-panel mb-3 flex h-[min(690px,calc(100vh-110px))] w-[min(430px,calc(100vw-28px))] flex-col overflow-hidden rounded-2xl border border-orange-200 bg-white text-slate-900 shadow-[0_18px_60px_rgba(15,23,42,.14)]">
      <div className="flex items-center justify-between border-b border-slate-200 bg-slate-50 px-4 py-3"><div className="flex items-center gap-2"><Orb small /><div><div className="text-sm font-bold">AI Companion</div><div className="text-[10px] text-slate-500">Context: {moduleContext}</div></div></div><div className="flex items-center gap-1"><button type="button" onClick={() => void newConversation(moduleContext)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900" title="New chat"><Plus className="h-4 w-4" /></button><button type="button" onClick={() => setOpen(false)} className="rounded-lg p-2 text-slate-500 hover:bg-slate-100 hover:text-slate-900"><X className="h-4 w-4" /></button></div></div>
      <div className="flex gap-1 overflow-x-auto border-b border-slate-200 px-3 py-2">{conversations.slice(0, 4).map((item) => <button type="button" key={item.id} onClick={() => void selectConversation(item.id)} className={'max-w-[130px] truncate rounded-lg px-2 py-1 text-[10px] ' + (activeConversationId === item.id ? 'bg-orange-50 text-orange-700' : 'text-slate-500 hover:bg-slate-100')}>{item.title}</button>)}</div>
      <Messages messages={messages} sending={sending} compact />
      <ChatComposer moduleContext={moduleContext} compact />
      {error && <div className="flex items-center justify-between bg-rose-50 px-3 py-2 text-[10px] text-rose-700"><span>{error}</span><button type="button" onClick={clearError}><X className="h-3 w-3" /></button></div>}
    </div>}
    <button type="button" onClick={() => setOpen((x) => !x)} className="group flex items-center gap-3 rounded-full border border-orange-200 bg-white/95 px-3 py-2.5 text-xs font-semibold text-slate-900 shadow-[0_8px_28px_rgba(239,116,26,.18)] backdrop-blur transition hover:-translate-y-0.5 hover:border-orange-300">
      <Orb small /><span className="pr-1">Ask AI Agent</span><span className="h-2 w-2 rounded-full bg-orange-500 shadow-[0_0_9px_rgba(34,211,238,.9)]" />
    </button>
  </div>;
};
