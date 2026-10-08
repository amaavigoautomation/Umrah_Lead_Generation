import React, { useState } from 'react';
import {
  Settings,
  Shield,
  Mail,
  Zap,
  CheckCircle,
  Save,
  Radio,
  Clock,
  Key,
  Globe,
  Database,
  RefreshCw,
} from 'lucide-react';
import { SystemSettings, Channel, ChannelMode, AppUser } from '../types';
import { UserManagementView } from './UserManagementView';
import { EmailSettingsPanel } from './EmailSettingsPanel';
import { InboundMailboxPanel } from './InboundMailboxPanel';
import { WebsiteWebhookPanel } from './WebsiteWebhookPanel';
import { BrandSettingsPanel } from './BrandSettingsPanel';
import { BillingView } from './BillingView';

interface SettingsViewProps {
  settings: SystemSettings;
  onSaveSettings: (settings: SystemSettings) => void;
  onResetSeedData: () => void;
  users?: AppUser[];
  onSaveUser?: (user: AppUser) => Promise<void>;
  onDeleteUser?: (userId: string) => Promise<void>;
  tenantId?: string;
  canEditEmail?: boolean;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onResetSeedData,
  users,
  onSaveUser,
  onDeleteUser,
  tenantId,
  canEditEmail,
}) => {
  const [formData, setFormData] = useState<SystemSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  const [openAiKeyInput, setOpenAiKeyInput] = useState('');
  const [isOpenAiConfigured, setIsOpenAiConfigured] = useState(false);
  const [maskedOpenAiKey, setMaskedOpenAiKey] = useState('');
  const [isSavingOpenAiKey, setIsSavingOpenAiKey] = useState(false);
  const [openAiKeySaveStatus, setOpenAiKeySaveStatus] = useState<string | null>(null);

  React.useEffect(() => {
    setFormData(settings);
  }, [settings]);

  React.useEffect(() => {
    // Fetch current OpenAI key status
    fetch('/api/ai/openai-key')
      .then((res) => res.json())
      .then((data) => {
        if (data) {
          setIsOpenAiConfigured(Boolean(data.configured));
          if (data.maskedKey) setMaskedOpenAiKey(data.maskedKey);
        }
      })
      .catch((err) => console.warn('Notice loading OpenAI key status:', err));
  }, []);

  const handleSaveOpenAiKey = async () => {
    if (!openAiKeyInput.trim()) return;
    setIsSavingOpenAiKey(true);
    setOpenAiKeySaveStatus(null);
    try {
      const res = await fetch('/api/ai/openai-key', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ apiKey: openAiKeyInput.trim() }),
      });
      const data = await res.json();
      if (res.ok && data.success) {
        setIsOpenAiConfigured(true);
        setMaskedOpenAiKey(`${openAiKeyInput.trim().slice(0, 7)}...${openAiKeyInput.trim().slice(-4)}`);
        setOpenAiKeyInput('');
        setOpenAiKeySaveStatus('OpenAI API Key saved & active!');
      } else {
        setOpenAiKeySaveStatus('Failed to save API key');
      }
    } catch (err: any) {
      setOpenAiKeySaveStatus(err?.message || 'Error saving key');
    } finally {
      setIsSavingOpenAiKey(false);
      setTimeout(() => setOpenAiKeySaveStatus(null), 3500);
    }
  };

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

  const handleSave = () => {
    onSaveSettings(formData);
    setIsSaved(true);
    setTimeout(() => setIsSaved(false), 2500);
  };

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6 font-sans">
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <Settings className="w-6 h-6 text-orange-500" />
            <h2 className="text-xl font-extrabold text-slate-900">System Settings & Channel Configurations</h2>
          </div>
          <p className="text-xs text-slate-500 mt-1 font-medium">
            Configure operational modes (AUTO, REVIEW, SIMULATION), verified email identities,
            and debounce intervals.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition shadow-md shadow-orange-500/20"
        >
          {isSaved ? <CheckCircle className="w-4 h-4 text-white" /> : <Save className="w-4 h-4" />}
          <span>{isSaved ? 'Saved!' : 'Save Settings'}</span>
        </button>
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
          <br />• <span className="text-slate-500 font-bold">SIMULATION:</span> Analyze incoming
          prompts for insights without drafting responses.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {channels.map((ch) => {
            const currentMode = formData.channelModes[ch] || 'AUTO';

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
                  {(['AUTO', 'REVIEW', 'SIMULATION'] as ChannelMode[]).map((m) => (
                    <button
                      key={m}
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

      {/* OpenAI AI Model & API Key Configuration */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs space-y-4 text-slate-900">
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-2">
            <Key className="w-5 h-5 text-orange-500" />
            <h3 className="font-extrabold text-sm text-slate-900 font-display">OpenAI Engine & API Credentials</h3>
          </div>
          <span
            className={`text-xs px-2.5 py-1 rounded-full font-bold flex items-center space-x-1.5 ${
              isOpenAiConfigured
                ? 'bg-orange-50 text-orange-700 border border-orange-200'
                : 'bg-amber-50 text-amber-700 border border-amber-200'
            }`}
          >
            <span className={`w-2 h-2 rounded-full ${isOpenAiConfigured ? 'bg-orange-500 animate-pulse' : 'bg-amber-400'}`} />
            <span>{isOpenAiConfigured ? 'OpenAI Model Active' : 'API Key Required'}</span>
          </span>
        </div>

        <p className="text-xs text-slate-600 leading-relaxed">
          OpenAI models (<strong className="text-orange-600">gpt-4o</strong>, <strong className="text-orange-600">gpt-4o-mini</strong>) power the
          real-time Email Auto-Responder, Universal Demo Scheduling Agent, Outbound Personalization, and WhatsApp Inbound channels.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[11px] text-slate-500 font-medium block">Default Production Model</span>
            <span className="text-xs font-mono font-bold text-orange-600 mt-0.5 block">gpt-4o-mini / gpt-4o</span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[11px] text-slate-500 font-medium block">Active Key Status</span>
            <span className="text-xs font-mono font-bold text-slate-800 mt-0.5 block">
              {isOpenAiConfigured ? (maskedOpenAiKey || 'Active in Environment') : 'Not Configured'}
            </span>
          </div>
          <div className="bg-slate-50 p-3 rounded-xl border border-slate-200">
            <span className="text-[11px] text-slate-500 font-medium block">Active Integrations</span>
            <span className="text-xs font-semibold text-slate-800 mt-0.5 block">Email, Demo Agent, WhatsApp, Campaigns</span>
          </div>
        </div>

        <div className="pt-2 border-t border-slate-100 space-y-2">
          <label className="text-xs font-semibold text-slate-700 block">
            Update or Provide OpenAI API Key
          </label>
          <div className="flex flex-col sm:flex-row gap-2">
            <input
              type="password"
              value={openAiKeyInput}
              onChange={(e) => setOpenAiKeyInput(e.target.value)}
              placeholder="sk-proj-..."
              className="flex-1 bg-white border border-slate-200 rounded-xl px-3 py-2 text-xs text-slate-900 font-mono focus:outline-none focus:border-orange-500"
            />
            <button
              onClick={handleSaveOpenAiKey}
              disabled={isSavingOpenAiKey || !openAiKeyInput.trim()}
              className="px-4 py-2 bg-orange-500 hover:bg-orange-600 disabled:opacity-50 text-white rounded-xl text-xs font-bold transition flex items-center justify-center space-x-1.5 cursor-pointer shadow-xs"
            >
              {isSavingOpenAiKey ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
              <span>{isSavingOpenAiKey ? 'Saving...' : 'Save OpenAI Key'}</span>
            </button>
          </div>
          {openAiKeySaveStatus && (
            <p className={`text-xs font-semibold mt-1 ${openAiKeySaveStatus.includes('active') || openAiKeySaveStatus.includes('saved') ? 'text-orange-600' : 'text-amber-600'}`}>
              ✓ {openAiKeySaveStatus}
            </p>
          )}
        </div>
      </div>

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
              {formData.sendingAccounts.map((acc) => (
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
              ))}
            </div>
          </div>

          <div>
            <label className="text-slate-600 block mb-1 font-semibold">Configurable Outbound Email Signature</label>
            <textarea
              rows={4}
              value={formData.emailSignature}
              onChange={(e) => setFormData({ ...formData, emailSignature: e.target.value })}
              className="w-full bg-white border border-slate-200 rounded-xl p-2.5 text-xs text-slate-800 resize-none font-mono focus:outline-none focus:border-orange-500"
            />
          </div>
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

      {tenantId && canEditEmail && <BillingView />}

      {tenantId && <EmailSettingsPanel tenantId={tenantId} canEdit={Boolean(canEditEmail)} />}

      {tenantId && canEditEmail && <InboundMailboxPanel tenantId={tenantId} canEdit />}

      {tenantId && <BrandSettingsPanel tenantId={tenantId} canEdit={canEditEmail} />}
      {tenantId && canEditEmail && <WebsiteWebhookPanel tenantId={tenantId} canEdit />}

      {/* User Management & Access Control (Firestore app_users) */}
      {users && onSaveUser && onDeleteUser && (
        <UserManagementView
          users={users}
          onSaveUser={onSaveUser}
          onDeleteUser={onDeleteUser}
        />
      )}

      {/* Database Reset & Cloud Details */}
      <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-xs flex flex-col sm:flex-row sm:items-center justify-between gap-4 text-slate-900">
        <div>
          <h4 className="font-bold text-sm text-slate-900 font-display flex items-center space-x-2">
            <Database className="w-4 h-4 text-orange-500" />
            <span>Firestore Persistence & Data Reset</span>
          </h4>
          <p className="text-xs text-slate-500 mt-0.5">
            Reset all collections back to the official Umrah360 seed data (Indian Umrah Operators,
            Rahul Sharma thread, and Published Knowledge Base).
          </p>
        </div>

        <button
          onClick={onResetSeedData}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold border border-slate-200 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reset Initial Demo Data</span>
        </button>
      </div>
    </div>
  );
};