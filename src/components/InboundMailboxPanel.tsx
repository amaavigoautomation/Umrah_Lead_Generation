import React, { useCallback, useEffect, useState } from 'react';
import { Inbox, CheckCircle2, AlertTriangle, PauseCircle, Loader2, RefreshCw, Plug, Unplug, Eye, EyeOff } from 'lucide-react';

interface InboundView {
  enabled: boolean;
  host?: string;
  port?: number;
  user?: string;
  processNewInquiries: boolean;
  status: 'not_configured' | 'connected' | 'error' | 'auth_failed' | 'paused';
  lastError?: string;
  lastErrorAt?: string;
  lastPolledAt?: string;
  lastSuccessAt?: string;
  connectedAt?: string;
  hasPassword: boolean;
}

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

const inputCls =
  'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none focus:border-orange-500 focus:ring-2 focus:ring-orange-500/20';
const btnPrimary =
  'inline-flex items-center gap-2 bg-orange-600 hover:bg-orange-700 disabled:opacity-50 text-white text-sm font-semibold rounded-lg px-4 py-2 transition-colors';
const btnGhost =
  'inline-flex items-center gap-2 border border-slate-200 hover:bg-slate-50 disabled:opacity-50 text-slate-700 text-sm font-semibold rounded-lg px-4 py-2 transition-colors';

const PROVIDERS: { id: string; label: string; host: string; port: number; help?: string }[] = [
  { id: 'gmail', label: 'Gmail / Google Workspace', host: 'imap.gmail.com', port: 993, help: 'Turn on 2-Step Verification, then create an App password at myaccount.google.com/apppasswords and use it below.' },
  { id: 'outlook', label: 'Outlook / Microsoft 365', host: 'outlook.office365.com', port: 993, help: 'Your Microsoft admin must allow IMAP. Use an app password if your account has multi-factor sign-in.' },
  { id: 'zoho', label: 'Zoho Mail', host: 'imap.zoho.com', port: 993, help: 'Enable IMAP in Zoho Mail settings and use an app-specific password.' },
  { id: 'yahoo', label: 'Yahoo Mail', host: 'imap.mail.yahoo.com', port: 993, help: 'Create an app password in Yahoo account security.' },
  { id: 'custom', label: 'Other (custom server)', host: '', port: 993 },
];

function ago(iso?: string) {
  if (!iso) return 'never';
  const s = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 1000));
  if (s < 60) return 'just now';
  if (s < 3600) return `${Math.floor(s / 60)} min ago`;
  if (s < 86400) return `${Math.floor(s / 3600)} h ago`;
  return `${Math.floor(s / 86400)} d ago`;
}

const Pill: React.FC<{ status: InboundView['status'] }> = ({ status }) => {
  if (status === 'connected')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full px-2.5 py-1">
        <CheckCircle2 className="w-3.5 h-3.5" /> Connected
      </span>
    );
  if (status === 'paused')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-slate-100 text-slate-600 rounded-full px-2.5 py-1">
        <PauseCircle className="w-3.5 h-3.5" /> Paused
      </span>
    );
  if (status === 'auth_failed' || status === 'error')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-700 rounded-full px-2.5 py-1">
        <AlertTriangle className="w-3.5 h-3.5" /> {status === 'auth_failed' ? 'Sign-in failed' : 'Problem'}
      </span>
    );
  return null;
};

export const InboundMailboxPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const base = `/api/tenants/${encodeURIComponent(tenantId)}/inbound`;
  const [view, setView] = useState<InboundView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [editing, setEditing] = useState(false);

  const [provider, setProvider] = useState('gmail');
  const [host, setHost] = useState('imap.gmail.com');
  const [port, setPort] = useState(993);
  const [user, setUser] = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw] = useState(false);
  const [newInquiries, setNewInquiries] = useState(false);

  const connected = Boolean(view && view.status !== 'not_configured');

  const apply = (v: InboundView) => {
    setView(v);
    if (v.host) {
      const p = PROVIDERS.find((x) => x.host === v.host);
      setProvider(p ? p.id : 'custom');
      setHost(v.host);
      setPort(v.port || 993);
    }
    setUser(v.user || '');
    setNewInquiries(Boolean(v.processNewInquiries));
    setPassword('');
  };

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      apply(await api<InboundView>(base));
      setError(null);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [base, tenantId]);

  useEffect(() => {
    load();
  }, [load]);

  const run = async (key: string, path: string, body?: any, okMsg?: string) => {
    setBusy(key);
    setError(null);
    setNotice(null);
    try {
      const v = await api<InboundView>(path ? `${base}/${path}` : base, { method: 'POST', body: JSON.stringify(body || {}) });
      apply(v);
      if (okMsg) setNotice(okMsg);
      return v;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  const pickProvider = (id: string) => {
    setProvider(id);
    const p = PROVIDERS.find((x) => x.id === id);
    if (p && id !== 'custom') {
      setHost(p.host);
      setPort(p.port);
    }
  };

  if (loading && !view) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading inbound mailbox…
      </div>
    );
  }

  const showForm = !connected || editing;
  const help = PROVIDERS.find((p) => p.id === provider)?.help;

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
            <Inbox className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Inbound mailbox</h3>
            <p className="text-sm text-slate-500">Connect your own inbox so customer replies reach your workspace.</p>
          </div>
        </div>
        {view && <Pill status={view.status} />}
      </div>

      {error && <div className="text-sm bg-red-50 border border-red-100 text-red-700 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-sm bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-lg px-3 py-2">{notice}</div>}

      {connected && view && (view.status === 'error' || view.status === 'auth_failed') && view.lastError && (
        <div className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-lg px-3 py-2">
          {view.lastError}
          {view.status === 'auth_failed' && ' Re-enter the password below to resume.'}
        </div>
      )}

      {connected && view && !editing && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-sm">
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <div className="text-xs text-slate-500">Mailbox</div>
              <div className="font-medium text-slate-900 break-all">{view.user}</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <div className="text-xs text-slate-500">Server</div>
              <div className="font-medium text-slate-900">
                {view.host}:{view.port}
              </div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <div className="text-xs text-slate-500">Last checked</div>
              <div className="font-medium text-slate-900">{ago(view.lastPolledAt)}</div>
            </div>
            <div className="bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <div className="text-xs text-slate-500">Last successful check</div>
              <div className="font-medium text-slate-900">{ago(view.lastSuccessAt)}</div>
            </div>
          </div>

          <label className="flex items-start gap-3 text-sm">
            <input
              type="checkbox"
              className="mt-1"
              checked={view.processNewInquiries}
              disabled={!canEdit || busy === 'options'}
              onChange={(e) => run('options', 'options', { processNewInquiries: e.target.checked }, 'Saved.')}
            />
            <span>
              <span className="font-medium text-slate-900">Also handle brand-new enquiries</span>
              <span className="block text-slate-500">
                Off (recommended): only replies to your campaigns and existing contacts are picked up, so personal or unrelated email is ignored. On: any
                new email from someone we don't know can start a conversation and get an AI reply.
              </span>
            </span>
          </label>

          <p className="text-xs text-slate-500">
            We only read new mail. Nothing is marked as read, moved or deleted, and mail already in the inbox when you connected is never processed.
          </p>

          <div className="flex flex-wrap gap-2">
            <button className={btnGhost} disabled={!canEdit || busy === 'poll'} onClick={() => run('poll', 'poll', {}, 'Checked for new mail.')}>
              {busy === 'poll' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Check now
            </button>
            <button className={btnGhost} disabled={!canEdit || busy === 'test'} onClick={() => run('test', 'test', {}, 'Connection works.')}>
              {busy === 'test' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />} Test connection
            </button>
            <button
              className={btnGhost}
              disabled={!canEdit || busy === 'options'}
              onClick={() => run('options', 'options', { enabled: view.status === 'paused' }, view.status === 'paused' ? 'Resumed.' : 'Paused.')}
            >
              {view.status === 'paused' ? 'Resume' : 'Pause'}
            </button>
            <button className={btnGhost} disabled={!canEdit} onClick={() => setEditing(true)}>
              Change mailbox / password
            </button>
            <button
              className={`${btnGhost} text-red-700`}
              disabled={!canEdit || busy === 'disconnect'}
              onClick={() => {
                if (window.confirm('Disconnect this mailbox? Its saved password is deleted and replies will stop arriving.')) {
                  run('disconnect', 'disconnect', {}, 'Mailbox disconnected.');
                }
              }}
            >
              {busy === 'disconnect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Unplug className="w-4 h-4" />} Disconnect
            </button>
          </div>
        </section>
      )}

      {showForm && (
        <section className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-500">Email provider</span>
              <select className={inputCls} value={provider} disabled={!canEdit} onChange={(e) => pickProvider(e.target.value)}>
                {PROVIDERS.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.label}
                  </option>
                ))}
              </select>
            </label>
            {provider === 'custom' && (
              <>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">IMAP server</span>
                  <input className={inputCls} placeholder="imap.yourhost.com" value={host} disabled={!canEdit} onChange={(e) => setHost(e.target.value)} />
                </label>
                <label className="block">
                  <span className="text-xs font-medium text-slate-500">Port</span>
                  <select className={inputCls} value={port} disabled={!canEdit} onChange={(e) => setPort(Number(e.target.value))}>
                    <option value={993}>993 (SSL/TLS, recommended)</option>
                    <option value={143}>143 (STARTTLS)</option>
                  </select>
                </label>
              </>
            )}
            <label className="block">
              <span className="text-xs font-medium text-slate-500">Mailbox email address</span>
              <input
                className={inputCls}
                type="email"
                autoComplete="off"
                placeholder="sales@yourcompany.com"
                value={user}
                disabled={!canEdit}
                onChange={(e) => setUser(e.target.value)}
              />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">
                Password / app password{view?.hasPassword ? ' (leave blank to keep the saved one)' : ''}
              </span>
              <div className="relative">
                <input
                  className={`${inputCls} pr-10`}
                  type={showPw ? 'text' : 'password'}
                  autoComplete="new-password"
                  value={password}
                  disabled={!canEdit}
                  onChange={(e) => setPassword(e.target.value)}
                />
                <button
                  type="button"
                  className="absolute right-2 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-700"
                  onClick={() => setShowPw((s) => !s)}
                  title={showPw ? 'Hide' : 'Show'}
                >
                  {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </label>
          </div>

          {help && <p className="text-sm text-slate-500">{help}</p>}

          {!connected && (
            <label className="flex items-start gap-3 text-sm">
              <input type="checkbox" className="mt-1" checked={newInquiries} disabled={!canEdit} onChange={(e) => setNewInquiries(e.target.checked)} />
              <span className="text-slate-600">Also handle brand-new enquiries (not just replies). You can change this later.</span>
            </label>
          )}

          <div className="flex gap-2">
            <button
              className={btnPrimary}
              disabled={!canEdit || !user.trim() || !host.trim() || (!password && !(view?.hasPassword && editing)) || busy === 'connect'}
              onClick={async () => {
                const v = await run(
                  'connect',
                  '',
                  { host, port, user, password, ...(connected ? {} : { processNewInquiries: newInquiries }) },
                  'Connected. New replies will now be picked up automatically.'
                );
                if (v) setEditing(false);
              }}
            >
              {busy === 'connect' ? <Loader2 className="w-4 h-4 animate-spin" /> : <Plug className="w-4 h-4" />} Test &amp; connect
            </button>
            {editing && (
              <button className={btnGhost} onClick={() => setEditing(false)}>
                Cancel
              </button>
            )}
          </div>
          <p className="text-xs text-slate-500">
            Your password is encrypted and only used to read new mail. It is never shown again. We sign in once to check the details before saving.
          </p>
        </section>
      )}
    </div>
  );
};
