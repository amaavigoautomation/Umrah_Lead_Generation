import React, { useCallback, useEffect, useState } from 'react';
import { Mail, CheckCircle2, Clock, AlertTriangle, Copy, Check, RefreshCw, Loader2, Trash2 } from 'lucide-react';

interface DnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
}

interface EmailView {
  domain?: string;
  status?: string;
  records?: DnsRecord[];
  fromName?: string;
  fromLocalPart?: string;
  fromAddress?: string;
  replyTo?: string;
  canSend: boolean;
  usingPlatformSender?: boolean;
  resendConfigured: boolean;
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

const CopyBtn: React.FC<{ text: string }> = ({ text }) => {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      title="Copy"
      onClick={() => {
        navigator.clipboard?.writeText(text);
        setDone(true);
        setTimeout(() => setDone(false), 1500);
      }}
      className="text-slate-400 hover:text-slate-700"
    >
      {done ? <Check className="w-4 h-4 text-emerald-600" /> : <Copy className="w-4 h-4" />}
    </button>
  );
};

const StatusPill: React.FC<{ status?: string }> = ({ status }) => {
  if (status === 'verified')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-emerald-50 text-emerald-700 rounded-full px-2.5 py-1">
        <CheckCircle2 className="w-3.5 h-3.5" /> Verified
      </span>
    );
  if (status === 'failed' || status === 'partially_failed')
    return (
      <span className="inline-flex items-center gap-1 text-xs font-semibold bg-red-50 text-red-700 rounded-full px-2.5 py-1">
        <AlertTriangle className="w-3.5 h-3.5" /> Failed
      </span>
    );
  return (
    <span className="inline-flex items-center gap-1 text-xs font-semibold bg-amber-50 text-amber-700 rounded-full px-2.5 py-1">
      <Clock className="w-3.5 h-3.5" /> Waiting for DNS
    </span>
  );
};

export const EmailSettingsPanel: React.FC<{ tenantId: string; canEdit: boolean }> = ({ tenantId, canEdit }) => {
  const base = `/api/tenants/${encodeURIComponent(tenantId)}/email`;
  const [view, setView] = useState<EmailView | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [domainInput, setDomainInput] = useState('');
  const [fromName, setFromName] = useState('');
  const [local, setLocal] = useState('');
  const [replyTo, setReplyTo] = useState('');
  const [confirmRemove, setConfirmRemove] = useState(false);

  const removeDomain = async () => {
    setBusy('remove');
    setError(null);
    setNotice(null);
    try {
      apply(await api<EmailView>(`${base}/domain`, { method: 'DELETE' }));
      setNotice('Domain removed from your workspace and from Resend.');
    } catch (e: any) {
      setError(e.message);
    } finally {
      setConfirmRemove(false);
      setBusy(null);
    }
  };

  const apply =(v: EmailView) => {
    setView(v);
    setFromName(v.fromName || '');
    setLocal(v.fromLocalPart || '');
    setReplyTo(v.replyTo || '');
  };

  const load = useCallback(async () => {
    if (!tenantId) return;
    setLoading(true);
    try {
      apply(await api<EmailView>(base));
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
      const v = await api<EmailView>(`${base}/${path}`, { method: 'POST', body: JSON.stringify(body || {}) });
      apply(v);
      if (okMsg) setNotice(okMsg);
      return v;
    } catch (e: any) {
      setError(e.message);
    } finally {
      setBusy(null);
    }
  };

  if (loading && !view) {
    return (
      <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm text-sm text-slate-500 flex items-center gap-2">
        <Loader2 className="w-4 h-4 animate-spin" /> Loading email settings…
      </div>
    );
  }

  const hasDomain = Boolean(view?.domain);
  const verified = view?.status === 'verified';

  return (
    <div className="bg-white border border-slate-200/90 rounded-2xl p-6 shadow-sm space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center">
            <Mail className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-bold text-slate-900">Email sending</h3>
            <p className="text-sm text-slate-500">Send campaigns and replies from your own domain.</p>
          </div>
        </div>
        {hasDomain && <StatusPill status={view?.status} />}
      </div>

      {error && <div className="text-sm bg-red-50 border border-red-100 text-red-700 rounded-lg px-3 py-2">{error}</div>}
      {notice && <div className="text-sm bg-emerald-50 border border-emerald-100 text-emerald-700 rounded-lg px-3 py-2">{notice}</div>}

      {view && !view.resendConfigured && (
        <div className="text-sm bg-amber-50 border border-amber-100 text-amber-800 rounded-lg px-3 py-2">
          Email sending isn't enabled on this platform yet. Ask your platform administrator.
        </div>
      )}

      {view?.usingPlatformSender && (
        <div className="text-sm bg-slate-50 border border-slate-200 text-slate-600 rounded-lg px-3 py-2">
          Emails currently go out from the platform's shared address. Add and verify your own domain below to switch.
        </div>
      )}

      {/* Step 1 */}
      <section className="space-y-3">
        <h4 className="text-sm font-semibold text-slate-900">1. Your domain</h4>
        {hasDomain ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-3 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
              <span className="text-sm font-medium text-slate-900">{view?.domain}</span>
              {canEdit && !confirmRemove && (
                <button
                  type="button"
                  className="inline-flex items-center gap-1.5 text-sm font-semibold text-red-600 hover:text-red-700"
                  onClick={() => setConfirmRemove(true)}
                >
                  <Trash2 className="w-4 h-4" /> Remove domain
                </button>
              )}
            </div>
            {confirmRemove && (
              <div className="text-sm bg-red-50 border border-red-200 text-red-900 rounded-lg p-3 space-y-2">
                <p>
                  Remove <strong>{view?.domain}</strong>? It is deleted from Resend as well, so email from this domain stops sending
                  {view?.canSend ? ' right away' : ''} until you add and verify a domain again. You'll need to re-add the DNS records if you add it back.
                </p>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="inline-flex items-center gap-1.5 bg-red-600 hover:bg-red-700 disabled:opacity-50 text-white text-xs font-bold rounded-lg px-3 py-1.5"
                    disabled={busy === 'remove'}
                    onClick={removeDomain}
                  >
                    {busy === 'remove' ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />} Yes, remove it
                  </button>
                  <button
                    type="button"
                    className="border border-red-200 text-red-800 hover:bg-red-100 text-xs font-semibold rounded-lg px-3 py-1.5"
                    disabled={busy === 'remove'}
                    onClick={() => setConfirmRemove(false)}
                  >
                    Keep it
                  </button>
                </div>
              </div>
            )}
          </div>
        ) : (
          <div className="flex gap-2">
            <input
              className={inputCls}
              placeholder="yourcompany.com"
              value={domainInput}
              disabled={!canEdit}
              onChange={(e) => setDomainInput(e.target.value)}
            />
            <button
              className={btnPrimary}
              disabled={!canEdit || !domainInput.trim() || busy === 'domain'}
              onClick={() => run('domain', 'domain', { domain: domainInput }, 'Domain added. Now add the DNS records below.')}
            >
              {busy === 'domain' && <Loader2 className="w-4 h-4 animate-spin" />} Add domain
            </button>
          </div>
        )}
      </section>

      {/* Step 2 */}
      {hasDomain && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-900">2. Add these DNS records</h4>
          {!verified && (
            <p className="text-sm text-slate-500">
              Add each record at your domain provider (GoDaddy, Cloudflare, Namecheap, etc.), then click Verify. DNS changes can take a few minutes to
              a few hours.
            </p>
          )}
          <div className="overflow-x-auto border border-slate-200 rounded-lg">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-500 text-xs uppercase">
                <tr>
                  <th className="text-left px-3 py-2">Type</th>
                  <th className="text-left px-3 py-2">Name</th>
                  <th className="text-left px-3 py-2">Value</th>
                  <th className="text-left px-3 py-2">Status</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {(view?.records || []).map((r, i) => (
                  <tr key={i}>
                    <td className="px-3 py-2 font-medium text-slate-700 whitespace-nowrap">
                      {r.type}
                      {r.priority != null && <span className="text-slate-400"> · {r.priority}</span>}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-slate-700 break-all">{r.name}</code>
                        <CopyBtn text={r.name} />
                      </div>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2">
                        <code className="text-xs text-slate-700 break-all">{r.value}</code>
                        <CopyBtn text={r.value} />
                      </div>
                    </td>
                    <td className="px-3 py-2 whitespace-nowrap">
                      <span className={r.status === 'verified' ? 'text-emerald-600 font-medium' : 'text-slate-500'}>{r.status || 'pending'}</span>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {!verified && (
            <button className={btnGhost} disabled={!canEdit || busy === 'verify'} onClick={() => run('verify', 'verify', {}, 'Checked. Status updated.')}>
              {busy === 'verify' ? <Loader2 className="w-4 h-4 animate-spin" /> : <RefreshCw className="w-4 h-4" />} Verify DNS
            </button>
          )}
        </section>
      )}

      {/* Step 3 */}
      {hasDomain && (
        <section className="space-y-3">
          <h4 className="text-sm font-semibold text-slate-900">3. Choose your sender</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <label className="block">
              <span className="text-xs font-medium text-slate-500">From name</span>
              <input className={inputCls} placeholder="Acme Sales" value={fromName} disabled={!canEdit} onChange={(e) => setFromName(e.target.value)} />
            </label>
            <label className="block">
              <span className="text-xs font-medium text-slate-500">From address</span>
              <div className="flex items-center">
                <input className={`${inputCls} rounded-r-none`} placeholder="sales" value={local} disabled={!canEdit} onChange={(e) => setLocal(e.target.value)} />
                <span className="px-3 py-2 text-sm text-slate-500 bg-slate-50 border border-l-0 border-slate-200 rounded-r-lg">@{view?.domain}</span>
              </div>
            </label>
            <label className="block sm:col-span-2">
              <span className="text-xs font-medium text-slate-500">Reply-to (where customer replies should arrive)</span>
              <input className={inputCls} placeholder="inbox@yourcompany.com" value={replyTo} disabled={!canEdit} onChange={(e) => setReplyTo(e.target.value)} />
            </label>
          </div>
          <button
            className={btnPrimary}
            disabled={!canEdit || !local.trim() || busy === 'sender'}
            onClick={() => run('sender', 'sender', { fromName, fromLocalPart: local, replyTo }, 'Sender saved.')}
          >
            {busy === 'sender' && <Loader2 className="w-4 h-4 animate-spin" />} Save sender
          </button>
          {view?.canSend ? (
            <p className="text-sm text-emerald-700">Emails will be sent as {view.fromAddress}.</p>
          ) : (
            <p className="text-sm text-slate-500">Sending stays off until your domain is verified and a sender is saved.</p>
          )}
        </section>
      )}
    </div>
  );
};
