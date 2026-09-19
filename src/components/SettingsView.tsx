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
  Smartphone,
  Bot,
  UserCheck,
  Send,
  Sparkles,
} from 'lucide-react';
import { SystemSettings, Channel, ChannelMode, WhatsAppMode } from '../types';

interface SettingsViewProps {
  settings: SystemSettings;
  onSaveSettings: (settings: SystemSettings) => void;
  onResetSeedData: () => void;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onResetSeedData,
}) => {
  const [formData, setFormData] = useState<SystemSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);
  const [simPhone, setSimPhone] = useState('+91 98100 23456');
  const [simName, setSimName] = useState('Rahul Sharma');
  const [simText, setSimText] = useState('Assalamu Alaikum, does Umrah360 provide dynamic package costing for sub-agents?');
  const [simStatus, setSimStatus] = useState<string | null>(null);

  React.useEffect(() => {
    setFormData(settings);
  }, [settings]);

  const channels: Channel[] = ['WHATSAPP', 'EMAIL', 'INSTAGRAM', 'FACEBOOK', 'LINKEDIN', 'WEBSITE'];

  const handleWhatsAppModeChange = (mode: WhatsAppMode) => {
    const nextSettings: SystemSettings = {
      ...formData,
      whatsappMode: mode,
      channelModes: {
        ...formData.channelModes,
        WHATSAPP: mode === 'AUTO' ? 'AUTO' : 'REVIEW',
      },
      whatsappConfig: {
        ...(formData.whatsappConfig || {
          channel: 'WHATSAPP',
          displayPhoneNumber: '+91 9820252434',
          metaPhoneNumberId: '104829102849102',
          metaBusinessAccountId: '2948102948190',
          webhookStatus: 'CONNECTED',
          connected: true,
          webhookUrl: '/api/webhook/whatsapp',
        }),
        mode,
        aiEnabled: mode === 'AUTO',
        updatedAt: new Date().toISOString(),
      },
    };
    setFormData(nextSettings);
    onSaveSettings(nextSettings);
  };

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

  const handleTestWhatsAppSimulation = async () => {
    setSimStatus('Sending...');
    try {
      const res = await fetch('/api/whatsapp/simulate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: simPhone,
          fromName: simName,
          text: simText,
          forceMode: formData.whatsappMode || 'AUTO',
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSimStatus(
          formData.whatsappMode === 'AUTO'
            ? 'Success! Inbound received & AI replied via WhatsApp pipeline.'
            : 'Success! Inbound saved to Unified Inbox in HUMAN mode.'
        );
      } else {
        setSimStatus(`Failed: ${data.error || 'Unknown error'}`);
      }
    } catch (err: any) {
      setSimStatus(`Error: ${err?.message}`);
    }
    setTimeout(() => setSimStatus(null), 5000);
  };

  const currentWhatsAppMode: WhatsAppMode = formData.whatsappMode || (formData.channelModes.WHATSAPP === 'AUTO' ? 'AUTO' : 'HUMAN');

  return (
    <div className="max-w-5xl mx-auto p-4 space-y-6">
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex items-center justify-between">
        <div>
          <div className="flex items-center space-x-2">
            <Settings className="w-6 h-6 text-emerald-500" />
            <h2 className="text-xl font-bold text-white">System Settings & Channel Configurations</h2>
          </div>
          <p className="text-xs text-slate-400 mt-1">
            Configure WhatsApp Business Account, operational channel modes (AUTO vs HUMAN), verified email identities,
            and debounce intervals.
          </p>
        </div>

        <button
          onClick={handleSave}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition shadow-md"
        >
          {isSaved ? <CheckCircle className="w-4 h-4 text-white" /> : <Save className="w-4 h-4" />}
          <span>{isSaved ? 'Saved!' : 'Save Settings'}</span>
        </button>
      </div>

      {/* WHATSAPP BUSINESS ACCOUNT & LIVE CHANNEL CARD */}
      <div className="bg-slate-900 border border-emerald-800/60 rounded-xl p-6 shadow-lg space-y-5">
        <div className="flex items-start justify-between">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-xl bg-emerald-950/80 border border-emerald-700/60 flex items-center justify-center text-emerald-400">
              <Smartphone className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center space-x-2">
                <h3 className="font-bold text-base text-white">WhatsApp Business Cloud Account</h3>
                <span className="px-2 py-0.5 rounded-full bg-emerald-500/20 text-emerald-400 text-[10px] font-bold border border-emerald-500/30 flex items-center space-x-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span>CONNECTED</span>
                </span>
              </div>
              <p className="text-xs text-slate-400 mt-0.5">
                Official Meta WhatsApp Business Cloud API integration powering the live Unified Inbox & CRM.
              </p>
            </div>
          </div>

          <div className="text-right">
            <span className="text-[11px] text-slate-400 block font-medium">Connected Business Number</span>
            <span className="text-sm font-bold text-emerald-400 font-mono tracking-wide">
              {formData.whatsappConfig?.displayPhoneNumber || '+91 9820252434'}
            </span>
          </div>
        </div>

        {/* WhatsApp Mode Selector (AUTO vs HUMAN) */}
        <div className="p-4 bg-slate-800/70 border border-slate-700/80 rounded-xl space-y-3">
          <div className="flex items-center justify-between">
            <label className="text-xs font-bold text-white uppercase tracking-wider flex items-center space-x-1.5">
              <Zap className="w-3.5 h-3.5 text-amber-400" />
              <span>WhatsApp Inbound Management Mode</span>
            </label>
            <span className="text-[11px] text-slate-400">
              Persisted in Firestore & server-side runtime
            </span>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <button
              type="button"
              onClick={() => handleWhatsAppModeChange('AUTO')}
              className={`p-3.5 rounded-xl border text-left transition flex items-start space-x-3 ${
                currentWhatsAppMode === 'AUTO'
                  ? 'bg-emerald-950/60 border-emerald-500 shadow-md'
                  : 'bg-slate-900/60 border-slate-700/80 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-2 rounded-lg mt-0.5 ${currentWhatsAppMode === 'AUTO' ? 'bg-emerald-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <Bot className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-xs text-white">AUTO Mode (Default)</span>
                  {currentWhatsAppMode === 'AUTO' && (
                    <span className="px-1.5 py-0.2 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-semibold">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  Incoming WhatsApp messages from pilgrimage operators automatically consult the Umrah360 Knowledge Base and receive instant, grounded AI replies via Meta Cloud API.
                </p>
              </div>
            </button>

            <button
              type="button"
              onClick={() => handleWhatsAppModeChange('HUMAN')}
              className={`p-3.5 rounded-xl border text-left transition flex items-start space-x-3 ${
                currentWhatsAppMode === 'HUMAN'
                  ? 'bg-amber-950/60 border-amber-500 shadow-md'
                  : 'bg-slate-900/60 border-slate-700/80 hover:bg-slate-800/60'
              }`}
            >
              <div className={`p-2 rounded-lg mt-0.5 ${currentWhatsAppMode === 'HUMAN' ? 'bg-amber-600 text-white' : 'bg-slate-800 text-slate-400'}`}>
                <UserCheck className="w-4 h-4" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <span className="font-bold text-xs text-white">HUMAN Mode (Manual)</span>
                  {currentWhatsAppMode === 'HUMAN' && (
                    <span className="px-1.5 py-0.2 rounded bg-amber-500/20 text-amber-400 text-[10px] font-semibold">
                      Active
                    </span>
                  )}
                </div>
                <p className="text-[11px] text-slate-300 mt-1 leading-relaxed">
                  Incoming messages are saved immediately and shown in the Unified Inbox, but AI does NOT auto-reply. Operators review and type manual replies directly.
                </p>
              </div>
            </button>
          </div>
        </div>

        {/* Technical Configuration & Security Metadata */}
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/60">
            <span className="text-slate-400 text-[11px] block">Display Phone Number</span>
            <span className="font-mono text-emerald-400 font-semibold mt-0.5 block">+91 9820252434</span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Configurable Channel Identity</span>
          </div>

          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/60">
            <span className="text-slate-400 text-[11px] block">Meta Phone Number ID</span>
            <span className="font-mono text-slate-200 font-medium mt-0.5 block truncate">
              {formData.whatsappConfig?.metaPhoneNumberId || '104829102849102'}
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Meta Cloud API Endpoint Target</span>
          </div>

          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/60">
            <span className="text-slate-400 text-[11px] block">Meta Business Account ID</span>
            <span className="font-mono text-slate-200 font-medium mt-0.5 block truncate">
              {formData.whatsappConfig?.metaBusinessAccountId || '2948102948190'}
            </span>
            <span className="text-[10px] text-slate-500 mt-0.5 block">WABA Portfolio ID</span>
          </div>

          <div className="p-3 bg-slate-800/50 rounded-lg border border-slate-700/60">
            <span className="text-slate-400 text-[11px] block">Meta Webhook Callback</span>
            <span className="font-mono text-slate-200 font-medium mt-0.5 block truncate">/api/webhook/whatsapp</span>
            <span className="text-[10px] text-emerald-400 mt-0.5 block">Verified with Challenge</span>
          </div>
        </div>

        {/* Server-Side Credentials Security Notice */}
        <div className="p-3 bg-slate-800/40 rounded-lg border border-slate-700/50 flex items-start space-x-2 text-[11px] text-slate-400">
          <Shield className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
          <div>
            <strong className="text-slate-200">Server-Side Credentials Protection:</strong> Meta Access Tokens (`META_ACCESS_TOKEN`), App Secrets (`META_APP_SECRET`), and Webhook Verify Tokens (`META_WEBHOOK_VERIFY_TOKEN`) are securely managed server-side and never exposed to browser client code.
          </div>
        </div>

        {/* Quick Inbound WhatsApp Test Simulator */}
        <div className="p-4 bg-slate-950/60 rounded-xl border border-slate-800 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center space-x-2 text-xs font-semibold text-slate-200">
              <Sparkles className="w-4 h-4 text-purple-400" />
              <span>Test Inbound WhatsApp Webhook Message</span>
            </div>
            {simStatus && (
              <span className="text-xs text-purple-300 font-medium animate-pulse">{simStatus}</span>
            )}
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <input
              type="text"
              placeholder="Sender Name"
              value={simName}
              onChange={(e) => setSimName(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
            />
            <input
              type="text"
              placeholder="Sender Phone (+91 98100 23456)"
              value={simPhone}
              onChange={(e) => setSimPhone(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200"
            />
            <button
              type="button"
              onClick={handleTestWhatsAppSimulation}
              className="px-3 py-2 rounded-lg bg-purple-600 hover:bg-purple-500 text-white text-xs font-semibold flex items-center justify-center space-x-1.5 transition shadow-sm"
            >
              <Send className="w-3.5 h-3.5" />
              <span>Send Inbound Webhook</span>
            </button>
          </div>
          <textarea
            rows={2}
            value={simText}
            onChange={(e) => setSimText(e.target.value)}
            className="w-full bg-slate-900 border border-slate-700 rounded-lg p-2 text-xs text-slate-200 resize-none font-mono"
          />
        </div>
      </div>

      {/* Section 60 & 61: Production Channel Modes */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center space-x-2">
          <Zap className="w-4 h-4 text-amber-400" />
          <span>All Omnichannel Operational Modes</span>
        </h3>
        <p className="text-xs text-slate-400">
          • <span className="text-emerald-400 font-semibold">AUTO:</span> Automatically generate,
          validate with RAG, and send replies.
          <br />• <span className="text-blue-400 font-semibold">REVIEW:</span> Generate AI drafts
          requiring human verification prior to dispatch.
          <br />• <span className="text-slate-400 font-semibold">SIMULATION:</span> Analyze incoming
          prompts for insights without drafting responses.
        </p>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 pt-2">
          {channels.map((ch) => {
            const currentMode = formData.channelModes[ch] || 'AUTO';

            return (
              <div
                key={ch}
                className="bg-slate-800/60 p-4 rounded-xl border border-slate-700/60 space-y-2.5"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-xs text-white capitalize">
                    {ch.toLowerCase()}
                  </span>
                  <span
                    className={`text-[10px] px-2 py-0.5 rounded-full font-bold ${
                      currentMode === 'AUTO'
                        ? 'bg-emerald-500/20 text-emerald-400'
                        : currentMode === 'REVIEW'
                        ? 'bg-blue-500/20 text-blue-400'
                        : 'bg-slate-700 text-slate-300'
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
                      className={`py-1 rounded text-center font-medium transition ${
                        currentMode === m
                          ? 'bg-emerald-600 text-white'
                          : 'bg-slate-800 text-slate-400 hover:text-slate-200'
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

      {/* Section 41: Email Identities & Signature */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center space-x-2">
          <Mail className="w-4 h-4 text-blue-400" />
          <span>Email Sending Identity & Signature (Section 41 & 44)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-400 block mb-1">Approved Sending Mailboxes</label>
            <div className="space-y-2">
              {formData.sendingAccounts.map((acc) => (
                <div
                  key={acc.id}
                  className="flex items-center justify-between p-2.5 bg-slate-800 rounded-lg border border-slate-700"
                >
                  <div>
                    <span className="font-semibold text-white block">{acc.name}</span>
                    <span className="text-slate-400 font-mono text-[11px]">{acc.email}</span>
                  </div>
                  {acc.isDefault && (
                    <span className="px-2 py-0.5 rounded bg-emerald-500/20 text-emerald-400 text-[10px] font-bold">
                      Default
                    </span>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Configurable Outbound Email Signature</label>
            <textarea
              rows={4}
              value={formData.emailSignature}
              onChange={(e) => setFormData({ ...formData, emailSignature: e.target.value })}
              className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 resize-none font-mono"
            />
          </div>
        </div>
      </div>

      {/* Section 46 & 47: Debouncing, Idempotency & Webhooks */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg space-y-4">
        <h3 className="font-bold text-sm text-white flex items-center space-x-2">
          <Shield className="w-4 h-4 text-purple-400" />
          <span>Idempotency & Debounce Engine (Section 46, 47 & 68)</span>
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
          <div>
            <label className="text-slate-400 block mb-1">
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
              className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-200"
            />
            <span className="text-[11px] text-slate-500 mt-1 block">
              Batches bursts of messages arriving within this window into a single unified AI context.
            </span>
          </div>

          <div>
            <label className="text-slate-400 block mb-1">Webhook Endpoint URL</label>
            <input
              type="text"
              readOnly
              value={formData.webhookEndpoint}
              className="w-full bg-slate-800 border border-slate-700 rounded-md p-2 text-slate-400 font-mono"
            />
            <span className="text-[11px] text-emerald-400 mt-1 block flex items-center space-x-1">
              <CheckCircle className="w-3 h-3" />
              <span>Idempotency hash verification active for Meta, Apollo, & Email webhooks</span>
            </span>
          </div>
        </div>
      </div>

      {/* Database Reset & Cloud Details */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-6 shadow-lg flex flex-col sm:flex-row sm:items-center justify-between gap-4">
        <div>
          <h4 className="font-bold text-sm text-white flex items-center space-x-2">
            <Database className="w-4 h-4 text-emerald-400" />
            <span>Firestore Persistence & Data Reset</span>
          </h4>
          <p className="text-xs text-slate-400 mt-0.5">
            Reset all collections back to the official Umrah360 seed data (Indian Umrah Operators,
            Rahul Sharma thread, and Published Knowledge Base).
          </p>
        </div>

        <button
          onClick={onResetSeedData}
          className="flex items-center space-x-1.5 px-4 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition"
        >
          <RefreshCw className="w-3.5 h-3.5" />
          <span>Reset Initial Demo Data</span>
        </button>
      </div>
    </div>
  );
};

