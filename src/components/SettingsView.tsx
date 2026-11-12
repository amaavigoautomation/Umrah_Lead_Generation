import React, { useState } from 'react';
import {
  Activity,
  Bot,
  CheckCircle,
  ChevronRight,
  CreditCard,
  Mail,
  Plug,
  Save,
  Settings,
  Shield,
  ShieldCheck,
  Users,
  Zap,
} from 'lucide-react';
import { SystemSettings, Channel, ChannelMode, AppUser } from '../types';
import { UserManagementView } from './UserManagementView';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { InboundMailboxPanel } from './InboundMailboxPanel';
import { WebsiteWebhookPanel } from './WebsiteWebhookPanel';
import { ChatbotIntegrationPanel } from './ChatbotIntegrationPanel';
import { BillingView } from './BillingView';
import { ConnectedChannelsPanel } from './ConnectedChannelsPanel';
import { normalizeChannelMode } from '../shared/channelModes';

interface SettingsViewProps {
  settings: SystemSettings;
  onSaveSettings: (settings: SystemSettings) => void | Promise<void>;
  users?: AppUser[];
  usersLoading?: boolean;
  usersError?: string | null;
  onSaveUser?: (user: AppUser) => Promise<void>;
  onDeleteUser?: (userId: string) => Promise<void>;
  tenantId?: string;
  canEditEmail?: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  users,
  usersLoading,
  usersError,
  onSaveUser,
  onDeleteUser,
  tenantId,
  canEditEmail,
}) => {
  const [formData, setFormData] = useState<SystemSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeSection, setActiveSection] = useState<'overview' | 'ai' | 'channels' | 'email' | 'team' | 'billing'>('overview');
  const [handoffKeywordsText, setHandoffKeywordsText] = useState((settings.humanHandoffKeywords || []).join('\n'));
  const handoffRules = formData.humanHandoffRules || { explicitRequest: true, frustration: true, aiUnableToResolve: true, failureThreshold: 2 };

  React.useEffect(() => {
    setFormData(settings);
    setHandoffKeywordsText((settings.humanHandoffKeywords || []).join('\n'));
  }, [settings]);

  const channels: Channel[] = ['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'WEBSITE'];

  const handleModeChange = (channel: Channel, mode: ChannelMode) => {
    setFormData({
      ...formData,
      channelModes: {
        ...formData.channelModes,
        [channel]: mode,
      },
    });
  };

  const handleSave = async () => {
    setIsSavingSettings(true);
    setSaveError(null);
    setIsSaved(false);
    try {
      await onSaveSettings({ ...formData, humanHandoffEnabled: true, humanHandoffCustomPhrasesEnabled: formData.humanHandoffCustomPhrasesEnabled ?? true, humanHandoffKeywords: handoffKeywordsText.split('\n').map((v) => v.trim()).filter(Boolean), humanHandoffRules: { explicitRequest: Boolean(handoffRules.explicitRequest), frustration: Boolean(handoffRules.frustration), aiUnableToResolve: Boolean(handoffRules.aiUnableToResolve), failureThreshold: Number(handoffRules.failureThreshold) || 2 } });
      setIsSaved(true);
      setTimeout(() => setIsSaved(false), 2500);
    } catch (err: any) {
      setSaveError(err?.message || 'Settings could not be saved. Please try again.');
    } finally {
      setIsSavingSettings(false);
    }
  };

  const sectionItems = [
    { id: 'overview' as const, label: 'Overview', description: 'Workspace configuration at a glance', icon: <Activity className="h-4 w-4" /> },
    { id: 'ai' as const, label: 'AI & Automation', description: 'AI behaviour, handoff and runtime', icon: <Bot className="h-4 w-4" /> },
    { id: 'channels' as const, label: 'Channels & Integrations', description: 'Connected channels and website tools', icon: <Plug className="h-4 w-4" /> },
    { id: 'email' as const, label: 'Email & Mailboxes', description: 'Sending domain and inbound email', icon: <Mail className="h-4 w-4" /> },
    ...(canEditEmail ? [
      { id: 'team' as const, label: 'Team & Access', description: 'Users, roles and module access', icon: <Users className="h-4 w-4" /> },
      { id: 'billing' as const, label: 'Billing & Usage', description: 'Plan, consumption and payments', icon: <CreditCard className="h-4 w-4" /> },
    ] : []),
  ];
  const activeSectionMeta = sectionItems.find((item) => item.id === activeSection) || sectionItems[0];
  const modeCounts = channels.reduce((counts, channel) => {
    const mode = normalizeChannelMode(formData.channelModes?.[channel]);
    counts[mode] += 1;
    return counts;
  }, { AUTO: 0, REVIEW: 0, OFF: 0 });
  const overviewCards = sectionItems.filter((item) => item.id !== 'overview');

  return (
    <div className="w-full max-w-7xl mx-auto space-y-4 font-sans">
      <header className="rounded-2xl border border-slate-200 bg-white px-5 py-4 shadow-sm">
        <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-orange-600">
              <Settings className="h-5 w-5" />
              <span className="text-[10px] font-bold uppercase tracking-[0.18em]">Workspace configuration</span>
            </div>
            <h1 className="mt-1 text-xl font-extrabold text-slate-950 sm:text-2xl">Settings</h1>
            <p className="mt-1 max-w-2xl text-xs leading-relaxed text-slate-500">
              Manage AI behaviour, channels, email, team access and billing from one organized workspace.
            </p>
          </div>
          <div className="flex shrink-0 flex-col items-stretch gap-1 sm:items-end">
            {(activeSection === 'ai' || activeSection === 'email') && (
              <button
                type="button"
                onClick={handleSave}
                disabled={isSavingSettings || !canEditEmail}
                className="inline-flex items-center justify-center gap-2 rounded-xl bg-orange-500 px-4 py-2.5 text-xs font-bold text-white shadow-sm transition hover:bg-orange-600 disabled:cursor-not-allowed disabled:opacity-50"
                title={!canEditEmail ? 'Only workspace admins can save these settings' : 'Save AI, handoff, channel, email signature and runtime settings'}
              >
                {isSaved ? <CheckCircle className="h-4 w-4" /> : <Save className="h-4 w-4" />}
                <span>{isSavingSettings ? 'Saving changes…' : isSaved ? 'Changes saved' : 'Save settings'}</span>
              </button>
            )}
            {saveError ? <span role="alert" className="text-[11px] text-rose-600">{saveError}</span> : (
              (activeSection === 'ai' || activeSection === 'email') && <span className="text-[10px] text-slate-400">Saves AI modes, handoff, runtime preferences and email signature</span>
            )}
          </div>
        </div>
      </header>

      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[228px_minmax(0,1fr)]">
        <aside className="rounded-2xl border border-slate-200 bg-white p-2 shadow-sm lg:sticky lg:top-4">
          <div className="hidden px-3 pb-2 pt-2 text-[10px] font-bold uppercase tracking-[0.16em] text-slate-400 lg:block">Settings menu</div>
          <nav aria-label="Settings sections" className="flex gap-1.5 overflow-x-auto pb-1 lg:flex-col lg:overflow-visible lg:pb-0">
            {sectionItems.map((item) => (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveSection(item.id)}
                aria-current={activeSection === item.id ? 'page' : undefined}
                className={`group flex min-w-max items-center gap-2.5 rounded-xl border px-3 py-2.5 text-left transition lg:w-full ${activeSection === item.id ? 'border-orange-200 bg-orange-50 text-orange-800' : 'border-transparent text-slate-600 hover:border-slate-200 hover:bg-slate-50 hover:text-slate-900'}`}
              >
                <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${activeSection === item.id ? 'bg-white text-orange-600 shadow-sm' : 'bg-slate-100 text-slate-500 group-hover:text-slate-700'}`}>{item.icon}</span>
                <span className="min-w-0">
                  <span className="block whitespace-nowrap text-xs font-bold">{item.label}</span>
                  <span className={`hidden whitespace-normal text-[10px] leading-relaxed lg:block ${activeSection === item.id ? 'text-orange-700/80' : 'text-slate-400'}`}>{item.description}</span>
                </span>
                <ChevronRight className={`ml-auto hidden h-3.5 w-3.5 shrink-0 lg:block ${activeSection === item.id ? 'text-orange-500' : 'text-slate-300'}`} />
              </button>
            ))}
          </nav>
        </aside>

        <main className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-6">
          <div className="mb-5 flex flex-col gap-1 border-b border-slate-100 pb-4">
            <h2 className="text-lg font-extrabold text-slate-950">{activeSectionMeta.label}</h2>
            <p className="text-xs text-slate-500">{activeSectionMeta.description}</p>
          </div>

          {activeSection === 'overview' && (
            <div className="space-y-5">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="text-[11px] font-medium text-slate-500">AI response modes</span>
                  <div className="mt-2 text-2xl font-bold tabular-nums text-slate-950">{modeCounts.AUTO + modeCounts.REVIEW + modeCounts.OFF}<span className="ml-1 text-xs font-medium text-slate-400">channels</span></div>
                  <div className="mt-2 flex flex-wrap gap-1.5 text-[10px] font-bold">
                    <span className="rounded-full bg-orange-100 px-2 py-1 text-orange-800">AUTO {modeCounts.AUTO}</span>
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-700">REVIEW {modeCounts.REVIEW}</span>
                    <span className="rounded-full bg-slate-200 px-2 py-1 text-slate-600">OFF {modeCounts.OFF}</span>
                  </div>
                </div>
                <div className="rounded-xl border border-slate-200 bg-slate-50 p-4">
                  <span className="text-[11px] font-medium text-slate-500">Workspace team</span>
                  <div className="mt-2 text-lg font-bold text-slate-950">{users?.length ?? '—'}<span className="ml-1 text-xs font-medium text-slate-400">users</span></div>
                  <div className="mt-1 text-[11px] text-slate-500">{canEditEmail ? 'Manage roles and access below' : 'Team management is admin-only'}</div>
                </div>
              </div>
              <div>
                <div className="mb-3 flex items-center justify-between">
                  <h3 className="text-sm font-bold text-slate-900">Quick access</h3>
                  <span className="text-[10px] text-slate-400">Choose a settings area</span>
                </div>
                <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
                  {overviewCards.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() => setActiveSection(item.id)}
                      className="group flex items-start gap-3 rounded-xl border border-slate-200 p-4 text-left transition hover:border-orange-200 hover:bg-orange-50/40"
                    >
                      <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-slate-100 text-slate-600 transition group-hover:bg-orange-100 group-hover:text-orange-700">{item.icon}</span>
                      <span className="min-w-0 flex-1">
                        <span className="block text-xs font-bold text-slate-900">{item.label}</span>
                        <span className="mt-1 block text-[11px] leading-relaxed text-slate-500">{item.description}</span>
                      </span>
                      <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-slate-300 transition group-hover:text-orange-600" />
                    </button>
                  ))}
                </div>
              </div>
              <div className="flex items-start gap-2 rounded-xl border border-blue-100 bg-blue-50/60 p-3 text-xs text-blue-800">
                <ShieldCheck className="mt-0.5 h-4 w-4 shrink-0" />
                <span>Configuration is organized by task. Connected-channel setup, email domains, billing and team management retain their existing save and permission flows.</span>
              </div>
            </div>
          )}

          {activeSection === 'ai' && (
            <div className="space-y-5">
      {/* Human Handoff configuration */}
      <div className="bg-white border border-amber-200 rounded-2xl p-6 shadow-sm space-y-4">
        <div className="flex items-center gap-2"><Shield className="w-5 h-5 text-amber-600" /><h3 className="font-extrabold text-sm text-slate-900">Human Handoff</h3></div>
        <p className="text-xs text-slate-600 leading-relaxed">Built-in rules run independently. A handoff is silent, pauses AI replies and follow-ups for that conversation, and remains active until a person manually resumes AI.</p>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {([['explicitRequest','Explicit request for a human','Detect a clear request to speak to a person, representative, or support team.'],['frustration','Customer frustration','Escalate clear frustration and repeated complaints.'],] as const).map(([key,title,description]) => <div key={key} className="rounded-xl border border-slate-200 p-3 text-xs space-y-2">
            <label className="flex items-start gap-2"><input type="checkbox" checked={Boolean(handoffRules[key])} disabled={!canEditEmail} onChange={(e) => setFormData({ ...formData, humanHandoffRules: { ...handoffRules, [key]: e.target.checked } })} className="mt-0.5" /><span><strong className="block text-slate-800">{title}</strong>{description && <span className="text-slate-500">{description}</span>}</span></label>

          </div>)}
        </div>
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <label className="flex items-start gap-2 text-xs font-semibold text-slate-800"><input type="checkbox" checked={formData.humanHandoffCustomPhrasesEnabled ?? true} disabled={!canEditEmail} onChange={(e) => setFormData({ ...formData, humanHandoffCustomPhrasesEnabled: e.target.checked })} className="mt-0.5" /><span>Enable custom trigger phrases<span className="block mt-1 font-normal text-slate-500">Turn this off to ignore the phrases below without disabling built-in rules.</span></span></label>
          <label className="block text-xs font-semibold text-slate-700">Custom trigger phrases (one per line)</label>
          <textarea rows={4} value={handoffKeywordsText} disabled={!canEditEmail || formData.humanHandoffCustomPhrasesEnabled === false} onChange={(e) => { setHandoffKeywordsText(e.target.value); setFormData({ ...formData, humanHandoffKeywords: e.target.value.split('\n').map((v) => v.trim()).filter(Boolean) }); }} placeholder={'speak with the sales desk\ncall me about pricing'} className="w-full bg-white border border-slate-200 rounded-xl p-3 text-xs text-slate-800 focus:outline-none focus:border-orange-500 disabled:bg-slate-50" />
          <p className="text-[11px] text-slate-500">Matching is case-insensitive and phrase-based. Only admins can edit these settings.</p>
        </div>
      </div>

      {/* Production Channel Modes */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4">
        <h3 className="font-extrabold text-sm text-slate-900 flex items-center space-x-2">
          <Zap className="w-4 h-4 text-orange-500" />
          <span>Channel Operational Modes</span>
        </h3>
        <p className="text-xs text-slate-500 font-medium leading-relaxed">
          • <span className="text-orange-600 font-bold">AUTO:</span> Automatically generate,
          validate with RAG, and send replies.
          <br />• <span className="text-slate-900 font-bold">REVIEW:</span> Generate AI drafts
          requiring human verification prior to dispatch.
          <br />• <span className="text-slate-500 font-bold">OFF:</span> Do not generate, send, or
          create AI reply drafts. Incoming messages remain available in Unified Inbox.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {channels.map((ch) => {
            const currentMode = normalizeChannelMode(formData.channelModes?.[ch]);

            return (
              <div
                key={ch}
                className="bg-slate-50 p-4 rounded-xl border border-slate-200 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-bold text-xs text-slate-900 capitalize">
                    {ch.toLowerCase()}
                  </span>
                  <span
                    className={`text-[10px] px-2.5 py-0.5 rounded-full font-bold ${
                      currentMode === 'AUTO'
                        ? 'bg-orange-100 text-orange-800 border border-orange-200'
                        : currentMode === 'REVIEW'
                        ? 'bg-slate-900 text-white'
                        : 'bg-slate-200 text-slate-700'
                    }`}
                  >
                    {currentMode}
                  </span>
                </div>

                <div className="grid grid-cols-3 gap-1 text-[11px]">
                  {(['AUTO', 'REVIEW', 'OFF'] as ChannelMode[]).map((m) => (
                    <button
                      key={m}
                      disabled={!canEditEmail}
                      onClick={() => handleModeChange(ch, m)}
                      className={`py-1 rounded-lg text-center font-bold transition ${
                        currentMode === m
                          ? 'bg-orange-500 text-white shadow-xs'
                          : 'bg-white border border-slate-200 text-slate-600 hover:text-slate-900'
                      }`}
                    >
                      {m}
                    </button>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* Section 46 & 47: Debouncing, Idempotency & Webhooks */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4 text-slate-900">
        <h3 className="font-bold text-sm text-slate-900 font-display flex items-center space-x-2">
          <Shield className="w-4 h-4 text-orange-500" />
          <span>Idempotency & Debounce Engine (Section 46, 47 & 68)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-600 block mb-1 font-semibold">
              Debounce Waiting Window (seconds)
            </label>
            <input
              type="number"
              disabled={!canEditEmail}
              min={1}
              max={30}
              value={formData.debounceSeconds}
              onChange={(e) =>
                setFormData({ ...formData, debounceSeconds: parseInt(e.target.value) || 3 })
              }
              className="w-full bg-white border border-slate-200 rounded-xl p-2 text-slate-800 focus:outline-none focus:border-orange-500"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Batches bursts of messages arriving within this window into a single unified AI context.
            </span>
          </div>

          <div>
            <label className="text-slate-600 block mb-1 font-semibold">Webhook Endpoint URL</label>
            <input
              type="text"
              readOnly
              value={formData.webhookEndpoint}
              className="w-full bg-slate-50 border border-slate-200 rounded-xl p-2 text-slate-600 font-mono"
            />
            <span className="text-[11px] text-emerald-600 mt-1 block flex items-center space-x-1 font-medium">
              <CheckCircle className="w-3 h-3 text-emerald-500" />
              <span>Idempotency hash verification active for Meta, Apollo, & Email webhooks</span>
            </span>
          </div>
        </div>
      </div>


            </div>
          )}

          {activeSection === 'channels' && (
            <div className="space-y-5">
      <ConnectedChannelsPanel tenantId={tenantId} canEdit={canEditEmail} />

      {tenantId && canEditEmail && <WebsiteWebhookPanel tenantId={tenantId} canEdit />}
      {tenantId && canEditEmail && <ChatbotIntegrationPanel tenantId={tenantId} canEdit />}

            </div>
          )}

          {activeSection === 'email' && (
            <div className="space-y-5">
      {/* Section 41: Email Identities & Signature */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4 text-slate-900">
        <h3 className="font-bold text-sm text-slate-900 font-display flex items-center space-x-2">
          <Mail className="w-4 h-4 text-orange-500" />
          <span>Email Sending Identity & Signature (Section 41 & 44)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-600 block mb-1 font-semibold">Approved Sending Mailboxes</label>
            <div className="space-y-2">
              {(formData?.sendingAccounts || []).length === 0 ? (
                <div className="p-3 bg-slate-50 rounded-xl border border-dashed border-slate-200 text-slate-400 text-center">
                  No dedicated sending mailbox configured yet.
                </div>
              ) : (
                (formData?.sendingAccounts || []).map((acc) => (
                  <div
                    key={acc.id}
                    className="flex items-center justify-between p-2.5 bg-slate-50 rounded-xl border border-slate-200"
                  >
                    <div>
                      <span className="font-semibold text-slate-900 block">{acc.name}</span>
                      <span className="text-slate-500 font-mono text-[11px]">{acc.email}</span>
                    </div>
                    {acc.isDefault && (
                      <span className="px-2 py-0.5 rounded bg-orange-100 text-orange-800 text-[10px] font-bold">
                        Default
                      </span>
                    )}
                  </div>
                ))
              )}
            </div>
          </div>

          <div>
            <label className="text-slate-600 block mb-1 font-semibold">Configurable Outbound Email Signature</label>
            <textarea
              rows={4}
              disabled={!canEditEmail}
              value={formData?.emailSignature || ''}
              onChange={(e) => setFormData({ ...formData, emailSignature: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 resize-none font-mono focus:outline-none focus:border-orange-500"
            />
          </div>
        </div>
      </div>

      {tenantId && <EmailSettingsPanel tenantId={tenantId} canEdit={Boolean(canEditEmail)} />}
      {tenantId && canEditEmail && <InboundMailboxPanel tenantId={tenantId} canEdit />}

            </div>
          )}

          {activeSection === 'team' && canEditEmail && (
            <div className="space-y-5">
      {/* Workspace user management is admin-only. */}
      {tenantId && canEditEmail && users && onSaveUser && onDeleteUser && (
        <UserManagementView
          users={users}
          usersLoading={usersLoading}
          usersError={usersError}
          onSaveUser={onSaveUser}
          onDeleteUser={onDeleteUser}
        />
      )}

            </div>
          )}

          {activeSection === 'billing' && canEditEmail && (
            <div className="space-y-5">
      {tenantId && canEditEmail && <BillingView tenantId={tenantId} />}

            </div>
          )}
        </main>
      </div>
    </div>
  );
};