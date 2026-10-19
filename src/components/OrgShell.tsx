import React, { useCallback, useEffect, useState } from 'react';
import { Building2, Plus, LogOut, ArrowRight, Loader2, UserPlus, Lock } from 'lucide-react';
import { setActiveClientId } from '../services/authService';

export interface OrgClient {
  id: string;
  name: string;
  status: string;
  timezone?: string;
  createdAt?: string;
}

export interface OrgOverview {
  org: { id: string; name: string; status: string };
  plan: { id: string; name: string };
  billing?: { status: string; locked: boolean };
  limits: { maxClients: number };
  usedClients: number;
  clients: OrgClient[];
  admins: { email: string; name?: string }[];
}

const UNLIMITED_FROM = 1e9;
export const formatCap = (n: number) => (n >= UNLIMITED_FROM ? 'Unlimited' : String(n));

export async function fetchOrgOverview(): Promise<OrgOverview | null> {
  try {
    const r = await fetch('/api/org');
    return r.ok ? await r.json() : null;
  } catch {
    return null;
  }
}

/** Home screen for organization (agency) admins: pick a client brand, add a new one, add another admin. */
const OrgShell: React.FC<{ email: string; onLogout: () => void }> = ({ email, onLogout }) => {
  const [data, setData] = useState<OrgOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [upgrade, setUpgrade] = useState(false);
  const [adminEmail, setAdminEmail] = useState('');
  const [adminMsg, setAdminMsg] = useState('');

  const load = useCallback(async () => {
    setData(await fetchOrgOverview());
    setLoading(false);
  }, []);
  useEffect(() => {
    load();
  }, [load]);

  const createClient = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!name.trim()) return;
    setBusy(true);
    setError('');
    setUpgrade(false);
    try {
      const r = await fetch('/api/org/clients', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ name }) });
      const d = await r.json().catch(() => ({}));
      if (r.status === 402 && d.code === 'upgrade_required') {
        setUpgrade(true);
        setError(d.error || 'Client limit reached.');
      } else if (!r.ok) {
        setError(d.error || 'Could not create the client.');
      } else {
        setName('');
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  const addAdmin = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!adminEmail.trim()) return;
    setBusy(true);
    setAdminMsg('');
    try {
      const r = await fetch('/api/org/admins', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: adminEmail }) });
      const d = await r.json().catch(() => ({}));
      setAdminMsg(r.ok ? 'Invitation sent.' : d.error || 'Could not add the admin.');
      if (r.ok) {
        setAdminEmail('');
        await load();
      }
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <div className="min-h-screen flex items-center justify-center bg-slate-50 text-slate-500 text-sm">Loading…</div>;

  if (!data) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center bg-slate-50 text-slate-700 gap-3 p-6 text-center">
        <p className="text-sm">We couldn't load your organization. Contact your administrator.</p>
        <button onClick={onLogout} className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold">Sign out</button>
      </div>
    );
  }

  const locked = data.org.status === 'suspended' || !!data.billing?.locked;
  const atCap = data.usedClients >= data.limits.maxClients;

  return (
    <div className="min-h-screen bg-slate-50 text-slate-900">
      <header className="bg-white border-b border-slate-200 px-4 sm:px-8 h-14 flex items-center justify-between">
        <div className="flex items-center gap-2 font-bold">
          <Building2 className="w-5 h-5 text-orange-600" />
          {data.org.name}
          <span className="ml-2 text-[11px] font-semibold px-2 py-0.5 rounded-full bg-orange-50 text-orange-700 border border-orange-200">{data.plan.name}</span>
        </div>
        <div className="flex items-center gap-3 text-xs text-slate-500">
          <span className="hidden sm:inline">{email}</span>
          <button onClick={onLogout} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 bg-white hover:bg-red-50 hover:text-red-600 font-bold">
            <LogOut className="w-3.5 h-3.5" /> Sign Out
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 sm:p-8 space-y-6">
        {locked && (
          <div className="flex items-center gap-2 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
            <Lock className="w-4 h-4 shrink-0" />
            {data.org.status === 'suspended' ? 'This organization is suspended.' : 'Your organization plan is not active.'} Contact the platform administrator.
          </div>
        )}

        <section>
          <div className="flex items-end justify-between mb-3">
            <h2 className="text-lg font-bold">Your clients</h2>
            <span className="text-xs text-slate-500">
              {data.usedClients} of {formatCap(data.limits.maxClients)} used
            </span>
          </div>
          {data.clients.length === 0 ? (
            <p className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-6 text-center">No clients yet. Add your first one below.</p>
          ) : (
            <ul className="grid sm:grid-cols-2 gap-3">
              {data.clients.map((c) => (
                <li key={c.id}>
                  <button
                    disabled={locked || c.status === 'suspended'}
                    onClick={() => setActiveClientId(c.id)}
                    className="w-full text-left bg-white border border-slate-200 rounded-xl p-4 hover:border-orange-300 hover:shadow-sm transition flex items-center justify-between disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    <div>
                      <div className="font-semibold">{c.name}</div>
                      <div className="text-xs text-slate-500">{c.status === 'suspended' ? 'Suspended' : 'Active'}</div>
                    </div>
                    <ArrowRight className="w-4 h-4 text-orange-600" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><Plus className="w-4 h-4" /> Add a client</h3>
          <form onSubmit={createClient} className="flex gap-2">
            <input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} placeholder="Client or brand name" disabled={locked || busy}
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            <button disabled={locked || busy || !name.trim() || atCap}
              className="px-4 py-2 rounded-lg bg-orange-500 text-white text-sm font-bold disabled:opacity-50 flex items-center gap-1.5">
              {busy && <Loader2 className="w-3.5 h-3.5 animate-spin" />} Create
            </button>
          </form>
          {atCap && !error && <p className="mt-2 text-xs text-amber-700">You've reached your plan's client limit. Upgrade your plan to add more clients.</p>}
          {error && (
            <p className={`mt-2 text-xs ${upgrade ? 'text-amber-700' : 'text-red-600'}`}>
              {error} {upgrade && 'Contact your platform administrator to upgrade your plan.'}
            </p>
          )}
        </section>

        <section className="bg-white border border-slate-200 rounded-xl p-4">
          <h3 className="font-semibold mb-2 flex items-center gap-2"><UserPlus className="w-4 h-4" /> Organization admins</h3>
          <ul className="text-sm text-slate-600 mb-3 space-y-0.5">
            {data.admins.map((a) => <li key={a.email}>{a.name ? `${a.name} · ` : ''}{a.email}</li>)}
          </ul>
          <form onSubmit={addAdmin} className="flex gap-2">
            <input type="email" value={adminEmail} onChange={(e) => setAdminEmail(e.target.value)} placeholder="Email of another admin"
              className="flex-1 px-3 py-2 rounded-lg border border-slate-300 text-sm" />
            <button disabled={busy || !adminEmail.trim()} className="px-4 py-2 rounded-lg border border-slate-300 text-sm font-bold disabled:opacity-50">Add admin</button>
          </form>
          {adminMsg && <p className="mt-2 text-xs text-slate-600">{adminMsg}</p>}
        </section>
      </main>
    </div>
  );
};

export default OrgShell;
