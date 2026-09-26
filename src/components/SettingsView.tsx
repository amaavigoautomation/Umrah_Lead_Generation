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

interface SettingsViewProps {
  settings: SystemSettings;
  onSaveSettings: (settings: SystemSettings) => void;
  onResetSeedData: () => void;
  users?: AppUser[];
  onSaveUser?: (user: AppUser) => Promise<void>;
  onDeleteUser?: (userId: string) => Promise<void>;
}

export const SettingsView: React.FC<SettingsViewProps> = ({
  settings,
  onSaveSettings,
  onResetSeedData,
  users,
  onSaveUser,
  onDeleteUser,
}) => {
  const [formData, setFormData] = useState<SystemSettings>(settings);
  const [isSaved, setIsSaved] = useState(false);

  React.useEffect(() => {
    setFormData(settings);
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

      {/* User Management & Access Control (Firestore app_users) */}
      {users && onSaveUser && onDeleteUser && (
        <UserManagementView
          users={users}
          onSaveUser={onSaveUser}
          onDeleteUser={onDeleteUser}
        />
      )}

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
