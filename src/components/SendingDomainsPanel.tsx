import React, { useCallback, useEffect, useState } from 'react';
import { Globe, Plus, Trash2, Pencil, RefreshCw, CheckCircle, AlertCircle, Building2, X } from 'lucide-react';
import type { SendingIdentityWithUsage, Client } from '../types';

interface SendingDomainsPanelProps {
  /** Platform administrators see every client's identities and can manage clients. */
  isPlatformAdmin: boolean;
  /** Called after the client list is (re)loaded so other panels (e.g. user management) can reuse it. */
  onClientsLoaded?: (clients: Client[]) => void;
}

interface ResendDomain {
  name: string;
  status: string;
}

const emptyForm = {
  identityId: '',
  clientId: '',
  label: '',
  fromEmail: '',
  fromName: '',
  replyTo: '',
  dailyCap: 50,
  isActive: true,
};

export const SendingDomainsPanel: React.FC<SendingDomainsPanelProps> = ({ isPlatformAdmin, onClientsLoaded }) => {
  const [identities, setIdentities] = useState<SendingIdentityWithUsage[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [domains, setDomains] = useState<ResendDomain[] | null>(null);
  const [resendConfigured, setResendConfigured] = useState(true);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [form, setForm] = useState<typeof emptyForm | null>(null);
  const [saving, setSaving] = useState(false);
  const [newClientName, setNewClientName] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch('/api/sending-identities?domains=1');
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not load sending domains.');
      setIdentities(data.identities || []);
      setResendConfigured(Boolean(data.resendConfigured));
      setDomains(Array.isArray(data.domains) ? data.domains : null);
      if (Array.isArray(data.clients)) {
        setClients(data.clients);
        onClientsLoaded?.(data.clients);
      }
    } catch (e: any) {
      setError(e?.message || 'Could not load sending domains.');
    } finally {
      setLoading(false);
    }
  }, [onClientsLoaded]);

  useEffect(() => {
    load();
  }, [load]);

  const flash = (msg: string) => {
    setNotice(msg);
    setTimeout(() => setNotice(null), 3500);
  };

  const clientName = (clientId: string) =>
    clientId === 'platform' ? 'Platform' : clients.find((c) => c.clientId === clientId)?.name || clientId;

  const saveForm = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!form) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch('/api/sending-identities', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          identityId: form.identityId || undefined,
          clientId: form.clientId || undefined,
          label: form.label,
          fromEmail: form.fromEmail,
          fromName: form.fromName,
          replyTo: form.replyTo,
          dailyCap: Number(form.dailyCap),
          isActive: form.isActive,
        }),
      });
      const data = await res.json();
      if (!res.ok || !data?.success) throw new Error(data?.error || 'Could not save.');
      setForm(null);
      flash('Sending identity saved.');
      await load();
    } catch (err: any) {
      setError(err?.message || 'Could not save.');
    } finally {
      setSaving(false);
    }
  };

  const toggleActive = async (i: SendingIdentityWithUsage) => {
    const res = await fetch('/api/sending-identities', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ...i, isActive: !i.isActive }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data?.error || 'Could not update.');
    await load();
  };

  const remove = async (i: SendingIdentityWithUsage) => {
    if (!window.confirm(`Remove ${i.fromEmail}? Campaigns will stop sending from it.`)) return;
    const res = await fetch('/api/sending-identities', {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ identityId: i.identityId }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) setError(data?.error || 'Could not delete.');
    await load();
  };

  const addClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newClientName.trim()) return;
    const res = await fetch('/api/clients', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: newClientName.trim() }),
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok || !data?.success) {
      setError(data?.error || 'Could not add client.');
      return;
    }
    setNewClientName('');
    flash(`Client "${data.client.name}" added.`);
    await load();
  };

  const totalCap = identities.filter((i) => i.isActive).reduce((a, i) => a + i.dailyCap, 0);
  const totalSent = identities.reduce((a, i) => a + i.sentToday, 0);

  const inputCls =
    'w-full bg-slate-50 border border-slate-200 rounded-lg p-2 text-xs text-slate-800 focus:outline-none focus:border-orange-500';

  return (
    <div className="bg-white border border-slate-200 rounded-2xl p-6 shadow-sm space-y-5 font-sans">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
        <div>
          <div className="flex items-center space-x-2">
            <Globe className="w-5 h-5 text-orange-500" />
            <h3 className="font-extrabold text-slate-900 text-base">Sending Domains</h3>
          </div>
          <p className="text-xs text-slate-500 font-medium mt-0.5">
            Campaigns send through Resend and rotate across the active addresses below. Each address has a daily cap —
            keep it low while a new domain warms up.
          </p>
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={load}
            className="p-2.5 rounded-xl border border-slate-200 text-slate-600 hover:bg-slate-50"
            title="Refresh"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setForm({ ...emptyForm, clientId: isPlatformAdmin ? 'platform' : '' })}
            className="flex items-center space-x-1.5 px-4 py-2.5 rounded-xl bg-orange-500 hover:bg-orange-600 text-white text-xs font-bold transition shadow-md shadow-orange-500/20"
          >
            <Plus className="w-4 h-4" />
            <span>Add sending address</span>
          </button>
        </div>
      </div>

      {!resendConfigured && (
        <div className="p-3 bg-amber-50 border border-amber-200 rounded-xl text-amber-900 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span>RESEND_API_KEY is not set on the server, so no emails can be sent yet.</span>
        </div>
      )}
      {error && (
        <div className="p-3 bg-red-50 border border-red-200 rounded-xl text-red-800 text-xs flex items-center space-x-2">
          <AlertCircle className="w-4 h-4 shrink-0" />
          <span className="flex-1">{error}</span>
          <button onClick={() => setError(null)}>
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      )}
      {notice && (
        <div className="p-3 bg-orange-50 border border-orange-200 rounded-xl text-orange-900 text-xs flex items-center space-x-2 font-bold">
          <CheckCircle className="w-4 h-4 text-orange-600 shrink-0" />
          <span>{notice}</span>
        </div>
      )}

      <div className="grid grid-cols-3 gap-3 text-center">
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div className="text-lg font-extrabold text-slate-900">{identities.filter((i) => i.isActive).length}</div>
          <div className="text-[11px] text-slate-500 font-medium">Active addresses</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div className="text-lg font-extrabold text-slate-900">{totalCap.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 font-medium">Emails / day capacity</div>
        </div>
        <div className="bg-slate-50 border border-slate-200 rounded-xl p-3">
          <div className="text-lg font-extrabold text-slate-900">{totalSent.toLocaleString()}</div>
          <div className="text-[11px] text-slate-500 font-medium">Sent today (UTC)</div>
        </div>
      </div>

      <div className="overflow-x-auto border border-slate-200 rounded-xl">
        <table className="w-full text-left text-xs">
          <thead className="bg-slate-50 text-slate-600 font-bold uppercase tracking-wider text-[10px]">
            <tr>
              {isPlatformAdmin && <th className="p-3">Client</th>}
              <th className="p-3">Address</th>
              <th className="p-3">Today / cap</th>
              <th className="p-3">Status</th>
              <th className="p-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {identities.length === 0 && (
              <tr>
                <td colSpan={isPlatformAdmin ? 5 : 4} className="p-6 text-center text-slate-500">
                  {loading ? 'Loading…' : 'No sending addresses yet. Add one on a domain verified in Resend.'}
                </td>
              </tr>
            )}
            {identities.map((i) => {
              const pct = Math.min(100, Math.round((i.sentToday / Math.max(1, i.dailyCap)) * 100));
              return (
                <tr key={i.identityId} className="hover:bg-slate-50">
                  {isPlatformAdmin && <td className="p-3 font-semibold text-slate-700">{clientName(i.clientId)}</td>}
                  <td className="p-3">
                    <div className="font-semibold text-slate-900">{i.fromName}</div>
                    <div className="font-mono text-[11px] text-slate-500">{i.fromEmail}</div>
                    {i.replyTo && <div className="text-[10px] text-slate-400">replies → {i.replyTo}</div>}
                  </td>
                  <td className="p-3 min-w-[140px]">
                    <div className="text-[11px] text-slate-700 font-semibold">
                      {i.sentToday.toLocaleString()} / {i.dailyCap.toLocaleString()}
                    </div>
                    <div className="h-1.5 bg-slate-100 rounded-full mt-1 overflow-hidden">
                      <div className="h-full bg-orange-500" style={{ width: `${pct}%` }} />
                    </div>
                  </td>
                  <td className="p-3">
                    <button
                      onClick={() => toggleActive(i)}
                      className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                        i.isActive
                          ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                          : 'bg-slate-100 text-slate-500 border-slate-200'
                      }`}
                    >
                      {i.isActive ? 'Active' : 'Paused'}
                    </button>
                  </td>
                  <td className="p-3 text-right space-x-1 whitespace-nowrap">
                    <button
                      onClick={() =>
                        setForm({
                          identityId: i.identityId,
                          clientId: i.clientId,
                          label: i.label,
                          fromEmail: i.fromEmail,
                          fromName: i.fromName,
                          replyTo: i.replyTo || '',
                          dailyCap: i.dailyCap,
                          isActive: i.isActive,
                        })
                      }
                      className="p-1.5 rounded-lg text-slate-500 hover:bg-slate-100"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => remove(i)} className="p-1.5 rounded-lg text-red-500 hover:bg-red-50">
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {domains && (
        <div className="text-[11px] text-slate-500">
          <span className="font-bold text-slate-700">Domains in your Resend account: </span>
          {domains.length === 0
            ? 'none yet'
            : domains.map((d) => (
                <span
                  key={d.name}
                  className={`inline-block mr-1.5 px-1.5 py-0.5 rounded border font-mono ${
                    d.status === 'verified'
                      ? 'bg-emerald-50 border-emerald-200 text-emerald-700'
                      : 'bg-amber-50 border-amber-200 text-amber-700'
                  }`}
                >
                  {d.name} · {d.status}
                </span>
              ))}
        </div>
      )}

      {isPlatformAdmin && (
        <div className="border-t border-slate-100 pt-4 space-y-3">
          <div className="flex items-center space-x-2">
            <Building2 className="w-4 h-4 text-orange-500" />
            <h4 className="font-extrabold text-slate-900 text-sm">Clients</h4>
          </div>
          <div className="flex flex-wrap gap-2">
            {clients.length === 0 && <span className="text-xs text-slate-500">No clients yet.</span>}
            {clients.map((c) => (
              <span key={c.clientId} className="px-2.5 py-1 rounded-lg bg-slate-50 border border-slate-200 text-xs font-semibold text-slate-700">
                {c.name}
              </span>
            ))}
          </div>
          <form onSubmit={addClient} className="flex gap-2">
            <input
              value={newClientName}
              onChange={(e) => setNewClientName(e.target.value)}
              placeholder="New client name"
              className={inputCls}
            />
            <button className="px-4 rounded-lg bg-slate-900 text-white text-xs font-bold shrink-0">Add client</button>
          </form>
        </div>
      )}

      {form && (
        <div className="fixed inset-0 bg-slate-900/40 flex items-center justify-center p-4 z-50">
          <form onSubmit={saveForm} className="bg-white rounded-2xl p-6 w-full max-w-md space-y-3 shadow-xl text-xs">
            <div className="flex items-center justify-between">
              <h4 className="font-extrabold text-slate-900 text-sm">
                {form.identityId ? 'Edit sending address' : 'Add sending address'}
              </h4>
              <button type="button" onClick={() => setForm(null)}>
                <X className="w-4 h-4 text-slate-400" />
              </button>
            </div>

            {isPlatformAdmin && (
              <div>
                <label className="block mb-1 font-medium text-slate-700">Client</label>
                <select
                  className={inputCls}
                  value={form.clientId}
                  onChange={(e) => setForm({ ...form, clientId: e.target.value })}
                >
                  <option value="platform">Platform (our own mail)</option>
                  {clients.map((c) => (
                    <option key={c.clientId} value={c.clientId}>
                      {c.name}
                    </option>
                  ))}
                </select>
              </div>
            )}

            <div>
              <label className="block mb-1 font-medium text-slate-700">From email *</label>
              <input
                className={inputCls}
                type="email"
                required
                value={form.fromEmail}
                onChange={(e) => setForm({ ...form, fromEmail: e.target.value })}
                placeholder="sales@yourdomain.com"
              />
              <p className="text-[10px] text-slate-500 mt-1">The domain must be verified in the Resend account.</p>
            </div>
            <div>
              <label className="block mb-1 font-medium text-slate-700">From name</label>
              <input
                className={inputCls}
                value={form.fromName}
                onChange={(e) => setForm({ ...form, fromName: e.target.value })}
                placeholder="Acme Travel"
              />
            </div>
            <div>
              <label className="block mb-1 font-medium text-slate-700">Reply-To (where replies should land)</label>
              <input
                className={inputCls}
                type="email"
                value={form.replyTo}
                onChange={(e) => setForm({ ...form, replyTo: e.target.value })}
                placeholder="you@yourcompany.com"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block mb-1 font-medium text-slate-700">Daily cap</label>
                <input
                  className={inputCls}
                  type="number"
                  min={1}
                  value={form.dailyCap}
                  onChange={(e) => setForm({ ...form, dailyCap: Number(e.target.value) })}
                />
              </div>
              <div>
                <label className="block mb-1 font-medium text-slate-700">Label</label>
                <input
                  className={inputCls}
                  value={form.label}
                  onChange={(e) => setForm({ ...form, label: e.target.value })}
                  placeholder="optional"
                />
              </div>
            </div>
            <label className="flex items-center space-x-2 text-slate-700 font-medium">
              <input
                type="checkbox"
                checked={form.isActive}
                onChange={(e) => setForm({ ...form, isActive: e.target.checked })}
              />
              <span>Active</span>
            </label>
            <div className="flex justify-end gap-2 pt-2">
              <button type="button" onClick={() => setForm(null)} className="px-4 py-2 rounded-lg border border-slate-200 text-slate-600 font-bold">
                Cancel
              </button>
              <button
                disabled={saving}
                className="px-4 py-2 rounded-lg bg-orange-500 hover:bg-orange-600 text-white font-bold disabled:opacity-50"
              >
                {saving ? 'Saving…' : 'Save'}
              </button>
            </div>
          </form>
        </div>
      )}
    </div>
  );
};
