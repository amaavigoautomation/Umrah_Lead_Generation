import React, { useCallback, useEffect, useState } from 'react';
import { Instagram, MessageCircle, Facebook, RefreshCw, ExternalLink } from 'lucide-react';
import { auth } from '../firebase/config.js';

type ChannelState = {
  connected: boolean;
  available?: boolean;
  connection?: { username?: string; status?: string; webhookSubscriptionStatus?: 'subscribed' | 'needs_setup' } | null;
  error?: string;
};
type ChannelsStatus = { instagram: ChannelState; whatsapp: ChannelState; messenger: ChannelState };

const EMPTY: ChannelsStatus = {
  instagram: { connected: false },
  whatsapp: { connected: false, available: false },
  messenger: { connected: false, available: false },
};

interface Props {
  tenantId?: string;
  canEdit?: boolean;
}

export const ConnectedChannelsPanel: React.FC<Props> = ({ tenantId, canEdit }) => {
  const [status, setStatus] = useState<ChannelsStatus>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const api = async (path: string, method: 'GET' | 'POST' = 'GET') => {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in again before managing channels.');
    const token = await user.getIdToken();
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify({}) } : {}),
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(data.error || 'Request failed.');
    return data;
  };

  const refresh = useCallback(async () => {
    if (!tenantId) return;
    try {
      const data = await api('/api/channels/status');
      setStatus({ ...EMPTY, ...data });
    } catch (error: any) {
      setMessage(error?.message || 'Could not load channel status.');
    }
  }, [tenantId]);

  useEffect(() => {
    const result = new URLSearchParams(window.location.search).get('instagram');
    if (result === 'connected') setMessage('Instagram account connected.');
    if (result === 'error') setMessage('Instagram authorization was not completed. Please try again.');
    refresh();
  }, [refresh]);

  if (!tenantId) return null;

  const connectInstagram = async () => {
    setBusy('instagram');
    setMessage(null);
    try {
      const data = await api('/api/instagram/connect', 'POST');
      window.location.href = data.authorizationUrl;
    } catch (error: any) {
      setMessage(error?.message || 'Could not start Instagram authorization.');
      setBusy(null);
    }
  };

  const disconnectInstagram = async () => {
    if (!window.confirm('Disconnect Instagram from this workspace? Existing inbox history will be retained.')) return;
    setBusy('instagram');
    setMessage(null);
    try {
      await api('/api/instagram/disconnect', 'POST');
      setMessage('Instagram disconnected.');
      await refresh();
    } catch (error: any) {
      setMessage(error?.message || 'Could not disconnect Instagram.');
    } finally {
      setBusy(null);
    }
  };

  const badge = (s: ChannelState) =>
    s.connected
      ? { text: 'CONNECTED', cls: 'bg-emerald-50 text-emerald-700' }
      : s.available === false
      ? { text: 'SETUP PENDING', cls: 'bg-amber-50 text-amber-700' }
      : { text: 'NOT CONNECTED', cls: 'bg-slate-100 text-slate-600' };

  const ig = status.instagram;
  const igBadge = badge(ig);
  const igSetupMissing = ig.available === false;

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-4 text-slate-900">
      <div className="flex items-center justify-between gap-3">
        <div>
          <h3 className="font-extrabold text-sm">Connected Channels</h3>
          <p className="text-xs text-slate-500 mt-1">
            Link this workspace&apos;s own WhatsApp, Instagram and Messenger accounts. Messages from each appear in the Unified Inbox and CRM.
          </p>
        </div>
        <button onClick={refresh} className="shrink-0 rounded-xl border border-slate-200 px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50">
          Refresh status
        </button>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* WhatsApp */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-emerald-50 p-2"><MessageCircle className="w-4 h-4 text-emerald-600" /></div>
              <span className="font-bold text-sm">WhatsApp</span>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${badge(status.whatsapp).cls}`}>{badge(status.whatsapp).text}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Connect your WhatsApp Business number through Meta&apos;s sign-up pop-up. Per-workspace connection is the next step to be enabled on this server.
          </p>
          <button disabled className="w-full rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-500 cursor-not-allowed">Connect WhatsApp</button>
        </div>

        {/* Instagram */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-pink-50 p-2"><Instagram className="w-4 h-4 text-pink-600" /></div>
              <span className="font-bold text-sm">Instagram</span>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${igBadge.cls}`}>{igBadge.text}</span>
          </div>
          {ig.connected ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2.5 text-xs">
              <p className="font-bold text-emerald-900">@{ig.connection?.username || 'Instagram account'}</p>
              {ig.connection?.webhookSubscriptionStatus === 'needs_setup' && (
                <p className="mt-1 font-semibold text-amber-700">Webhook subscription not confirmed. Check the Meta app&apos;s Instagram messaging webhook before testing DMs.</p>
              )}
            </div>
          ) : (
            <p className="text-[11px] leading-relaxed text-slate-500">
              {igSetupMissing
                ? 'The Meta Instagram app is not configured on this server yet (META_INSTAGRAM_APP_ID / SECRET / REDIRECT_URI).'
                : 'Connect a Professional Instagram account to receive and answer DMs.'}
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            {!ig.connected ? (
              <button
                onClick={connectInstagram}
                disabled={busy === 'instagram' || !canEdit || igSetupMissing}
                className="inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 disabled:opacity-50"
              >
                {busy === 'instagram' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Instagram className="w-3.5 h-3.5" />}
                {busy === 'instagram' ? 'Connecting…' : 'Connect Instagram'}
                <ExternalLink className="w-3 h-3" />
              </button>
            ) : (
              <>
                <button onClick={connectInstagram} disabled={busy === 'instagram' || !canEdit} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 disabled:opacity-50">Reconnect</button>
                <button onClick={disconnectInstagram} disabled={busy === 'instagram' || !canEdit} className="rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 disabled:opacity-50">Disconnect</button>
              </>
            )}
          </div>
        </div>

        {/* Messenger */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-blue-50 p-2"><Facebook className="w-4 h-4 text-blue-600" /></div>
              <span className="font-bold text-sm">Messenger</span>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${badge(status.messenger).cls}`}>{badge(status.messenger).text}</span>
          </div>
          <p className="text-[11px] leading-relaxed text-slate-500">
            Link a Facebook Page so customers can message it. Per-workspace connection is the next step to be enabled on this server.
          </p>
          <button disabled className="w-full rounded-xl bg-slate-200 px-3 py-2 text-xs font-bold text-slate-500 cursor-not-allowed">Connect Facebook Page</button>
        </div>
      </div>

      {!canEdit && <p className="text-[11px] text-slate-500">Only workspace admins can connect or disconnect channels.</p>}
      <p className="text-[11px] leading-relaxed text-slate-500">
        Each channel runs in the mode you pick under Channel Operational Modes below (AUTO / REVIEW / SIMULATION).
      </p>
      {message && <p role="status" className="text-xs font-semibold text-slate-600">{message}</p>}
    </div>
  );
};
