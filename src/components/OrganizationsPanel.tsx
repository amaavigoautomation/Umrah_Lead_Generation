import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, Loader2 } from 'lucide-react';

interface OrgRow {
  id: string;
  name: string;
  status: string;
  planId?: string;
  contactEmail?: string;
  clientCount?: number;
}
interface PlanLite { id: string; name: string }

async function api<T = any>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, { ...init, headers: { 'Content-Type': 'application/json', ...(init?.headers || {}) } });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data?.error || `Request failed (${res.status})`);
  return data as T;
}

const inputCls = 'w-full bg-white border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:border-orange-500';

/** Platform admin: manage organizations (agencies) and the client workspaces under them. */
const OrganizationsPanel: React.FC<{ plans: PlanLite[] }> = ({ plans }) => {
  const [orgs, setOrgs] = useState<OrgRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [form, setForm] = useState({ name: '', planId: '', adminEmail: '', adminName: '' });
  const [adoptFor, setAdoptFor] = useState<Record<string, string>>({});
  const [adminFor, setAdminFor] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    try {
      setOrgs((await api<{ orgs: OrgRow[] }>('/api/orgs')).orgs || []);
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setLoading(false);
    }
  }, []);
  useEffect(() => { load(); }, [load]);

  const run = async (fn: () => Promise<any>, ok: string) => {
    setBusy(true);
    setMsg('');
    try {
      const r = await fn();
      setMsg(r?.adminError ? `Organization created, but the admin invite failed: ${r.adminError}` : ok);
      await load();
    } catch (e: any) {
      setMsg(e.message);
    } finally {
      setBusy(false);
    }
  };

  const create = (e: React.FormEvent) => {
    e.preventDefault();
    run(async () => {
      const r = await api('/api/orgs', { method: 'POST', body: JSON.stringify(form) });
      setForm({ name: '', planId: '', adminEmail: '', adminName: '' });
      return r;
    }, 'Organization created.');
  };

  return (
    <main className="max-w-6xl mx-auto px-4 sm:px-6 py-6 space-y-5">
      <form onSubmit={create} className="bg-white border border-slate-200 rounded-xl p-4 grid sm:grid-cols-5 gap-2 items-end">
        <div className="sm:col-span-1"><label className="text-xs font-semibold">Organization</label>
          <input className={inputCls} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} required /></div>
        <div><label className="text-xs font-semibold">Plan</label>
          <select className={inputCls} value={form.planId} onChange={(e) => setForm({ ...form, planId: e.target.value })}>
            <option value="">No plan yet</option>
            {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
          </select></div>
        <div><label className="text-xs font-semibold">First admin email</label>
          <input type="email" className={inputCls} value={form.adminEmail} onChange={(e) => setForm({ ...form, adminEmail: e.target.value })} /></div>
        <div><label className="text-xs font-semibold">Admin name</label>
          <input className={inputCls} value={form.adminName} onChange={(e) => setForm({ ...form, adminName: e.target.value })} /></div>
        <button disabled={busy || !form.name.trim()} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold disabled:opacity-50 flex items-center justify-center gap-1.5">
          {busy ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Plus className="w-3.5 h-3.5" />} Create
        </button>
      </form>
      {msg && <p className="text-sm text-slate-700 bg-slate-100 rounded-lg px-3 py-2">{msg}</p>}

      {loading ? <p className="text-sm text-slate-500">Loading…</p> : orgs.length === 0 ? (
        <p className="text-sm text-slate-500">No organizations yet.</p>
      ) : (
        <ul className="space-y-3">
          {orgs.map((o) => (
            <li key={o.id} className="bg-white border border-slate-200 rounded-xl p-4">
              <div className="flex flex-wrap items-center gap-3 justify-between">
                <div className="flex items-center gap-2 font-semibold"><Building2 className="w-4 h-4 text-orange-600" />{o.name}
                  <span className="text-xs font-normal text-slate-500">{o.id} · {o.clientCount ?? 0} clients</span>
                  {o.status === 'suspended' && <span className="text-xs text-red-600 font-bold">Suspended</span>}
                </div>
                <div className="flex items-center gap-2">
                  <select className="border border-slate-200 rounded-lg px-2 py-1 text-sm" value={o.planId || ''} disabled={busy}
                    onChange={(e) => run(() => api(`/api/orgs/${o.id}`, { method: 'PATCH', body: JSON.stringify({ planId: e.target.value }) }), 'Plan updated.')}>
                    <option value="">No plan</option>
                    {plans.map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}
                  </select>
                  <button disabled={busy} className="text-xs px-3 py-1.5 rounded-lg border border-slate-200 font-bold"
                    onClick={() => run(() => api(`/api/orgs/${o.id}`, { method: 'PATCH', body: JSON.stringify({ status: o.status === 'suspended' ? 'active' : 'suspended' }) }), 'Status updated.')}>
                    {o.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                  </button>
                </div>
              </div>
              <div className="mt-3 grid sm:grid-cols-2 gap-2">
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/orgs/${o.id}/admins`, { method: 'POST', body: JSON.stringify({ email: adminFor[o.id] }) }), 'Admin invited.'); }}>
                  <input type="email" placeholder="Add admin email" className={inputCls} value={adminFor[o.id] || ''} onChange={(e) => setAdminFor({ ...adminFor, [o.id]: e.target.value })} />
                  <button disabled={busy || !adminFor[o.id]} className="text-xs px-3 rounded-lg border border-slate-200 font-bold disabled:opacity-50">Invite</button>
                </form>
                <form className="flex gap-2" onSubmit={(e) => { e.preventDefault(); run(() => api(`/api/orgs/${o.id}/adopt-tenant`, { method: 'POST', body: JSON.stringify({ tenantId: adoptFor[o.id] }) }), 'Workspace moved into the organization.'); }}>
                  <input placeholder="Existing workspace id to adopt" className={inputCls} value={adoptFor[o.id] || ''} onChange={(e) => setAdoptFor({ ...adoptFor, [o.id]: e.target.value })} />
                  <button disabled={busy || !adoptFor[o.id]} className="text-xs px-3 rounded-lg border border-slate-200 font-bold disabled:opacity-50">Adopt</button>
                </form>
              </div>
            </li>
          ))}
        </ul>
      )}
    </main>
  );
};

export default OrganizationsPanel;
