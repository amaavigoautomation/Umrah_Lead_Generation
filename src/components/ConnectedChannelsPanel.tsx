import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Instagram, MessageCircle, Facebook, RefreshCw, ExternalLink } from 'lucide-react';
import { auth } from '../firebase/config.js';

type Connection = {
  username?: string;
  status?: string;
  webhookSubscriptionStatus?: 'subscribed' | 'needs_setup';
  displayPhoneNumber?: string;
  verifiedName?: string;
  qualityRating?: string;
  pageName?: string;
};
type ChannelState = {
  connected: boolean;
  available?: boolean;
  missing?: string[];
  connection?: Connection | null;
  error?: string;
};
type ChannelsStatus = {
  instagram: ChannelState;
  whatsapp: ChannelState;
  messenger: ChannelState;
  metaClient?: { appId: string; whatsappConfigId: string; graphVersion: string };
};

const EMPTY: ChannelsStatus = {
  instagram: { connected: false },
  whatsapp: { connected: false },
  messenger: { connected: false },
};

declare global {
  interface Window {
    FB?: any;
    fbAsyncInit?: () => void;
  }
}

let fbSdkPromise: Promise<any> | null = null;
function loadFacebookSdk(appId: string, version: string): Promise<any> {
  if (window.FB) return Promise.resolve(window.FB);
  if (fbSdkPromise) return fbSdkPromise;
  fbSdkPromise = new Promise((resolve, reject) => {
    window.fbAsyncInit = () => {
      window.FB.init({ appId, autoLogAppEvents: true, xfbml: false, version });
      resolve(window.FB);
    };
    const script = document.createElement('script');
    script.src = 'https://connect.facebook.net/en_US/sdk.js';
    script.async = true;
    script.defer = true;
    script.crossOrigin = 'anonymous';
    script.onerror = () => {
      fbSdkPromise = null;
      reject(new Error('Could not load the Facebook sign-in. Check your connection or ad-blocker.'));
    };
    document.body.appendChild(script);
  });
  return fbSdkPromise;
}

interface Props {
  tenantId?: string;
  canEdit?: boolean;
}

export const ConnectedChannelsPanel: React.FC<Props> = ({ tenantId, canEdit }) => {
  const [status, setStatus] = useState<ChannelsStatus>(EMPTY);
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [pages, setPages] = useState<{ id: string; name: string }[] | null>(null);
  const [selectedPage, setSelectedPage] = useState('');
  const userTokenRef = useRef('');

  const api = async (path: string, method: 'GET' | 'POST' = 'GET', body?: unknown) => {
    const user = auth.currentUser;
    if (!user) throw new Error('Please sign in again before managing channels.');
    const token = await user.getIdToken();
    const response = await fetch(path, {
      method,
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(method === 'POST' ? { body: JSON.stringify(body ?? {}) } : {}),
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

  const run = async (key: string, fn: () => Promise<void>) => {
    setBusy(key);
    setMessage(null);
    try {
      await fn();
    } catch (error: any) {
      setMessage(error?.message || 'Something went wrong.');
    } finally {
      setBusy(null);
    }
  };

  // ---- Instagram (redirect flow) ----
  const connectInstagram = () =>
    run('instagram', async () => {
      const data = await api('/api/instagram/connect', 'POST');
      window.location.href = data.authorizationUrl;
    });

  const checkInstagram = () =>
    run('instagram', async () => {
      const data = await api('/api/instagram/diagnose', 'POST');
      const bits = [
        data.accountType ? `Account type: ${data.accountType}.` : '',
        Array.isArray(data.subscribedFields) ? `Subscribed events: ${(data.subscribedFields as string[]).join(', ') || 'none'}.` : '',
        data.summary || '',
      ].filter(Boolean);
      setMessage(bits.join(' '));
    });

  const testInstagram = () =>
    run('instagram', async () => {
      await api('/api/instagram/test-event', 'POST');
      setMessage('Test message created. Open the Unified Inbox: a conversation called "Instagram User" should show "Test message from Settings…". If it does, our side works.');
    });

  const disconnectInstagram = () => {
    if (!window.confirm('Disconnect Instagram from this workspace? Existing inbox history will be retained.')) return;
    return run('instagram', async () => {
      await api('/api/instagram/disconnect', 'POST');
      setMessage('Instagram disconnected.');
      await refresh();
    });
  };

  // ---- WhatsApp Business App + Cloud API (Coexistence only) ----
  const connectWhatsApp = () =>
    run('whatsapp', async () => {
      const cfg = status.metaClient;
      if (!cfg?.appId || !cfg.whatsappConfigId) {
        throw new Error('WhatsApp Coexistence is not configured. Ask the platform administrator to set a current Embedded Signup v4 configuration.');
      }
      const FB = await loadFacebookSdk(cfg.appId, cfg.graphVersion || 'v23.0');

      const session = await new Promise<{ code: string; wabaId: string; phoneNumberId?: string; event: string }>((resolve, reject) => {
        let code = '';
        let wabaId = '';
        let phoneNumberId = '';
        let completionEvent = '';
        let settled = false;

        const cleanup = () => {
          window.removeEventListener('message', onMessage);
          window.clearTimeout(timer);
        };
        const fail = (error: Error) => {
          if (settled) return;
          settled = true;
          cleanup();
          reject(error);
        };
        const finish = () => {
          if (settled || !code || !wabaId || completionEvent !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') return;
          settled = true;
          cleanup();
          resolve({
            code,
            wabaId,
            event: completionEvent,
            ...(phoneNumberId ? { phoneNumberId } : {}),
          });
        };
        const onMessage = (event: MessageEvent) => {
          let host = '';
          try {
            host = new URL(event.origin).hostname.toLowerCase();
          } catch {
            return;
          }
          if (!(host === 'facebook.com' || host.endsWith('.facebook.com'))) return;
          try {
            const data = typeof event.data === 'string' ? JSON.parse(event.data) : event.data;
            if (data?.type !== 'WA_EMBEDDED_SIGNUP') return;

            if (data.event === 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
              completionEvent = data.event;
              wabaId = String(data.data?.waba_id || '');
              phoneNumberId = String(data.data?.phone_number_id || '');
              finish();
            } else if (['FINISH', 'FINISH_ONLY_WABA', 'FINISH_OBO_MIGRATION', 'FINISH_GRANT_ONLY_API_ACCESS'].includes(String(data.event))) {
              fail(new Error('Meta did not complete WhatsApp Business App Coexistence. To protect the phone app, Amaavigo will not connect this number through API-only setup. Try again with the existing number in WhatsApp Business; if Meta says it is ineligible, cancel the flow.'));
            } else if (data.event === 'CANCEL' || data.event === 'ERROR') {
              const details = String(data.data?.error_message || data.data?.error_user_msg || '');
              fail(new Error(details || 'WhatsApp Coexistence was cancelled or is unavailable for this number. No API-only connection was saved.'));
            }
          } catch {
            // Ignore unrelated postMessage payloads.
          }
        };
        const timer = window.setTimeout(() => {
          fail(new Error('WhatsApp Coexistence timed out. If Meta did not offer the existing WhatsApp Business App flow, cancel and try again later.'));
        }, 5 * 60_000);

        window.addEventListener('message', onMessage);
        FB.login(
          (response: any) => {
            if (response?.authResponse?.code) {
              code = String(response.authResponse.code);
              finish();
            } else if (!settled) {
              fail(new Error('WhatsApp Coexistence was not completed. No API-only connection was saved.'));
            }
          },
          {
            config_id: cfg.whatsappConfigId,
            response_type: 'code',
            override_default_response_type: true,
            // Current Embedded Signup v4: request the WhatsApp Business App onboarding path.
            extras: { setup: {}, featureType: 'whatsapp_business_app_onboarding' },
          }
        );
      });

      const result = await api('/api/whatsapp/connect', 'POST', session);
      const sync = result?.connection?.coexistenceSync;
      const syncFailed = sync && (sync.contacts?.status !== 'requested' || sync.history?.status !== 'requested');
      setMessage(
        syncFailed
          ? 'WhatsApp Business is connected in Coexistence and the phone app remains active. Meta could not start all contact/history sync tasks; check the Meta webhook configuration.'
          : 'WhatsApp Business is connected in Coexistence. The phone app remains active; Meta is starting contact/history sync. Messaging charges are billed to the client’s own Meta messaging account.'
      );
      await refresh();
    });

  const disconnectWhatsApp = () => {
    if (!window.confirm('Disconnect WhatsApp from this workspace? Existing inbox history will be retained.')) return;
    return run('whatsapp', async () => {
      await api('/api/whatsapp/disconnect', 'POST');
      setMessage('WhatsApp disconnected.');
      await refresh();
    });
  };

  // ---- Messenger (Facebook login pop-up, then pick a Page) ----
  const connectMessenger = () =>
    run('messenger', async () => {
      const cfg = status.metaClient;
      if (!cfg?.appId) throw new Error('Messenger sign-in is not configured on this server.');
      const FB = await loadFacebookSdk(cfg.appId, cfg.graphVersion || 'v23.0');
      const accessToken: string = await new Promise((resolve, reject) => {
        FB.login(
          (response: any) => {
            if (response?.authResponse?.accessToken) resolve(String(response.authResponse.accessToken));
            else reject(new Error('Facebook sign-in was not completed.'));
          },
          { scope: 'pages_show_list,pages_messaging,pages_manage_metadata' }
        );
      });
      userTokenRef.current = accessToken;
      const data = await api('/api/messenger/pages', 'POST', { userToken: accessToken });
      const found: { id: string; name: string }[] = data.pages || [];
      if (!found.length) throw new Error('No Facebook Pages found for that login. Make sure you manage a Page and granted access.');
      if (found.length === 1) {
        await api('/api/messenger/connect', 'POST', { userToken: accessToken, pageId: found[0].id });
        userTokenRef.current = '';
        setMessage(`Messenger connected to ${found[0].name}.`);
        await refresh();
      } else {
        setPages(found);
        setSelectedPage(found[0].id);
      }
    });

  const confirmPage = () =>
    run('messenger', async () => {
      await api('/api/messenger/connect', 'POST', { userToken: userTokenRef.current, pageId: selectedPage });
      userTokenRef.current = '';
      setPages(null);
      setMessage('Messenger Page connected.');
      await refresh();
    });

  const disconnectMessenger = () => {
    if (!window.confirm('Disconnect this Facebook Page from the workspace? Existing inbox history will be retained.')) return;
    return run('messenger', async () => {
      await api('/api/messenger/disconnect', 'POST');
      setMessage('Messenger disconnected.');
      await refresh();
    });
  };

  const badge = (s: ChannelState) =>
    s.connected
      ? { text: 'CONNECTED', cls: 'bg-emerald-50 text-emerald-700' }
      : s.available === false
      ? { text: 'SETUP PENDING', cls: 'bg-amber-50 text-amber-700' }
      : { text: 'NOT CONNECTED', cls: 'bg-slate-100 text-slate-600' };

  const missingNote = (s: ChannelState) =>
    s.available === false && s.missing?.length ? (
      <p className="text-[11px] leading-relaxed text-amber-700">
        Not set up on this server yet. Missing: <span className="font-mono">{s.missing.join(', ')}</span>
      </p>
    ) : null;

  const { instagram: ig, whatsapp: wa, messenger: fb } = status;
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const disabledBase = 'disabled:opacity-50 disabled:cursor-not-allowed';

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
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${badge(wa).cls}`}>{badge(wa).text}</span>
          </div>
          {wa.connected ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2.5 text-xs">
              <p className="font-bold text-emerald-900">{wa.connection?.displayPhoneNumber || 'WhatsApp number'}</p>
              {wa.connection?.verifiedName && <p className="text-emerald-700 mt-0.5">{wa.connection.verifiedName}</p>}
              {wa.connection?.qualityRating && <p className="text-emerald-700 mt-0.5">Quality: {wa.connection.qualityRating}</p>}
            </div>
          ) : (
            missingNote(wa) || (
              <p className="text-[11px] leading-relaxed text-slate-500">
                Connect an existing WhatsApp Business App number. This is Coexistence-only: keep using the phone app while Amaavigo handles API messaging. If Meta asks to move the number to API-only or marks it ineligible, cancel the flow. Meta messaging charges belong to the client’s own Meta billing account.
              </p>
            )
          )}
          <div className="flex flex-wrap gap-2">
            {!wa.connected ? (
              <button onClick={connectWhatsApp} disabled={busy === 'whatsapp' || !canEdit || wa.available === false} className={`inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 ${disabledBase}`}>
                {busy === 'whatsapp' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <MessageCircle className="w-3.5 h-3.5" />}
                {busy === 'whatsapp' ? 'Connecting…' : 'Connect WhatsApp'}
                <ExternalLink className="w-3 h-3" />
              </button>
            ) : (
              <>
                <button onClick={connectWhatsApp} disabled={busy === 'whatsapp' || !canEdit} className={`rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 ${disabledBase}`}>Reconnect</button>
                <button onClick={disconnectWhatsApp} disabled={busy === 'whatsapp' || !canEdit} className={`rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 ${disabledBase}`}>Disconnect</button>
              </>
            )}
          </div>
        </div>

        {/* Instagram */}
        <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="rounded-lg bg-pink-50 p-2"><Instagram className="w-4 h-4 text-pink-600" /></div>
              <span className="font-bold text-sm">Instagram</span>
            </div>
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${badge(ig).cls}`}>{badge(ig).text}</span>
          </div>
          {ig.connected ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2.5 text-xs">
              <p className="font-bold text-emerald-900">@{ig.connection?.username || 'Instagram account'}</p>
              {ig.connection?.webhookSubscriptionStatus === 'needs_setup' && (
                <p className="mt-1 font-semibold text-amber-700">Webhook subscription not confirmed. Check the Meta app&apos;s Instagram messaging webhook before testing DMs.</p>
              )}
            </div>
          ) : (
            missingNote(ig) || (
              <p className="text-[11px] leading-relaxed text-slate-500">Connect a Professional Instagram account to receive and answer DMs.</p>
            )
          )}
          <div className="flex flex-wrap gap-2">
            {!ig.connected ? (
              <button onClick={connectInstagram} disabled={busy === 'instagram' || !canEdit || ig.available === false} className={`inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 ${disabledBase}`}>
                {busy === 'instagram' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Instagram className="w-3.5 h-3.5" />}
                {busy === 'instagram' ? 'Connecting…' : 'Connect Instagram'}
                <ExternalLink className="w-3 h-3" />
              </button>
            ) : (
              <>
                <button onClick={connectInstagram} disabled={busy === 'instagram' || !canEdit} className={`rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 ${disabledBase}`}>Reconnect</button>
                <button onClick={checkInstagram} disabled={busy === 'instagram' || !canEdit} className={`rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 ${disabledBase}`}>Check webhook</button>
                <button onClick={testInstagram} disabled={busy === 'instagram' || !canEdit} className={`rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 ${disabledBase}`}>Send test message</button>
                <button onClick={disconnectInstagram} disabled={busy === 'instagram' || !canEdit} className={`rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 ${disabledBase}`}>Disconnect</button>
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
            <span className={`rounded-full px-2.5 py-1 text-[10px] font-bold ${badge(fb).cls}`}>{badge(fb).text}</span>
          </div>
          {fb.connected ? (
            <div className="rounded-lg border border-emerald-100 bg-emerald-50/60 p-2.5 text-xs">
              <p className="font-bold text-emerald-900">{fb.connection?.pageName || 'Facebook Page'}</p>
              {fb.connection?.webhookSubscriptionStatus === 'needs_setup' && (
                <p className="mt-1 font-semibold text-amber-700">Webhook subscription not confirmed. Check the Meta app&apos;s Messenger webhook before testing messages.</p>
              )}
            </div>
          ) : pages ? (
            <div className="space-y-2">
              <p className="text-[11px] text-slate-600 font-semibold">Choose the Page to connect:</p>
              <select value={selectedPage} onChange={(e) => setSelectedPage(e.target.value)} className="w-full rounded-lg border border-slate-200 bg-white px-2 py-2 text-xs">
                {pages.map((p) => (<option key={p.id} value={p.id}>{p.name}</option>))}
              </select>
              <div className="flex gap-2">
                <button onClick={confirmPage} disabled={busy === 'messenger' || !selectedPage} className={`rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 ${disabledBase}`}>Connect this Page</button>
                <button onClick={() => { setPages(null); userTokenRef.current = ''; }} className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50">Cancel</button>
              </div>
            </div>
          ) : (
            missingNote(fb) || (
              <p className="text-[11px] leading-relaxed text-slate-500">Link a Facebook Page so customers can message it. You must be an admin of the Page.</p>
            )
          )}
          {!pages && (
            <div className="flex flex-wrap gap-2">
              {!fb.connected ? (
                <button onClick={connectMessenger} disabled={busy === 'messenger' || !canEdit || fb.available === false} className={`inline-flex items-center gap-2 rounded-xl bg-orange-500 px-3 py-2 text-xs font-bold text-white hover:bg-orange-600 ${disabledBase}`}>
                  {busy === 'messenger' ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Facebook className="w-3.5 h-3.5" />}
                  {busy === 'messenger' ? 'Connecting…' : 'Connect Facebook Page'}
                  <ExternalLink className="w-3 h-3" />
                </button>
              ) : (
                <>
                  <button onClick={connectMessenger} disabled={busy === 'messenger' || !canEdit} className={`rounded-xl border border-slate-200 bg-white px-3 py-2 text-xs font-bold text-slate-700 hover:bg-slate-50 ${disabledBase}`}>Reconnect</button>
                  <button onClick={disconnectMessenger} disabled={busy === 'messenger' || !canEdit} className={`rounded-xl border border-rose-200 bg-white px-3 py-2 text-xs font-bold text-rose-700 hover:bg-rose-50 ${disabledBase}`}>Disconnect</button>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {!canEdit && <p className="text-[11px] text-slate-500">Only workspace admins can connect or disconnect channels.</p>}
      <p className="text-[11px] leading-relaxed text-slate-500">
        Each channel runs in the mode you pick under Channel Operational Modes below (AUTO / REVIEW / SIMULATION).
      </p>

      <details className="rounded-xl border border-slate-200 bg-slate-50 p-3 text-[11px] text-slate-600">
        <summary className="cursor-pointer font-bold text-slate-700">Meta app setup values (for the platform owner)</summary>
        <div className="mt-2 space-y-1.5 leading-relaxed">
          <p>WhatsApp + Messenger webhook callback URL: <span className="font-mono break-all">{origin}/api/webhooks/meta</span></p>
          <p>Instagram webhook callback URL: <span className="font-mono break-all">{origin}/api/webhooks/instagram</span></p>
          <p>Instagram OAuth redirect URI: <span className="font-mono break-all">{origin}/api/instagram/oauth/callback</span></p>
          <p>Verify token: the value of <span className="font-mono">META_WEBHOOK_VERIFY_TOKEN</span> (WhatsApp/Messenger) or <span className="font-mono">META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN</span> (Instagram).</p>
          <p>Webhook fields: <span className="font-mono">messages</span> on the WhatsApp Business Account and Page objects.</p>
          <p>Also add this site&apos;s domain to the Meta app&apos;s allowed domains for Facebook Login.</p>
        </div>
      </details>

      {message && <p role="status" className="text-xs font-semibold text-slate-600">{message}</p>}
    </div>
  );
};
