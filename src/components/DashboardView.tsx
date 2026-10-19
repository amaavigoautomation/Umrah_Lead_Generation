import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Users, Send, CalendarCheck, Mail, Cpu, Loader2, ChevronDown } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, Cell, Area, AreaChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import LeadMap from './LeadMap';
import { getActiveClientId } from '../services/authService';

type Range = '30d' | '90d' | '12m';
interface DashData {
  scope: string;
  clients: Array<{ id: string; name: string; status: string }>;
  campaigns: Array<{ id: string; name: string; status: string }>;
  breakdown?: Array<{ id: string; name: string; totalLeads: number; activeCampaigns: number; demosScheduled: number; emailsSent: number; aiTokens: number }>;
  kpis: { totalLeads: number; activeCampaigns: number; demosScheduled: number; emailsSent: number; aiTokens: number };
  funnel: { total: number; sent: number; opened: number; clicked: number; replied: number; demoBooked: number; failed: number; bounced: number };
  growth: Array<{ label: string; added: number }>;
  growthBase: number;
  locations: { countries: Array<{ name: string; count: number }>; cities: Array<{ name: string; country: string; count: number }>; unknown: number; scanned: number; truncated: boolean };
  usageByMonth: Array<{ month: string; emails: number; tokens: number }>;
  empty?: boolean;
}

const nf = new Intl.NumberFormat('en-US');
const compact = (n: number) => (n >= 1e9 ? `${(n / 1e9).toFixed(1)}B` : n >= 1e6 ? `${(n / 1e6).toFixed(1)}M` : n >= 1e4 ? `${(n / 1e3).toFixed(1)}K` : nf.format(n));
const selectCls = 'text-xs font-semibold border border-slate-200 bg-white rounded-lg px-2.5 py-1.5 focus:outline-none focus:border-orange-500';

const Card: React.FC<{ title: string; hint?: string; right?: React.ReactNode; children: React.ReactNode; className?: string }> = ({ title, hint, right, children, className = '' }) => (
  <section className={`bg-white border border-slate-200 rounded-xl p-4 ${className}`}>
    <div className="flex items-start justify-between gap-2 mb-3">
      <div>
        <h3 className="text-sm font-bold text-slate-800">{title}</h3>
        {hint && <p className="text-[11px] text-slate-500 mt-0.5">{hint}</p>}
      </div>
      {right}
    </div>
    {children}
  </section>
);

const Kpi: React.FC<{ label: string; value: string; icon: React.ReactNode }> = ({ label, value, icon }) => (
  <div className="bg-white border border-slate-200 rounded-xl p-4 flex items-center gap-3">
    <div className="w-9 h-9 rounded-lg bg-orange-50 text-orange-600 flex items-center justify-center shrink-0">{icon}</div>
    <div className="min-w-0">
      <div className="text-xl font-bold text-slate-900 leading-tight">{value}</div>
      <div className="text-[11px] text-slate-500">{label}</div>
    </div>
  </div>
);

const DashboardView: React.FC = () => {
  const [data, setData] = useState<DashData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [client, setClient] = useState<string>(() => getActiveClientId() || '');
  const [campaignId, setCampaignId] = useState('');
  const [range, setRange] = useState<Range>('30d');
  const [growthMode, setGrowthMode] = useState<'cumulative' | 'incremental'>('cumulative');

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const q = new URLSearchParams({ range });
      if (client) q.set('client', client);
      if (campaignId && client !== 'all') q.set('campaignId', campaignId);
      const r = await fetch(`/api/dashboard?${q}`);
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || 'Could not load the dashboard');
      setData(d);
    } catch (e: any) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, [client, campaignId, range]);
  useEffect(() => {
    load();
  }, [load]);

  const isOrg = (data?.clients?.length ?? 0) > 0;
  const funnelRows = useMemo(() => {
    if (!data) return [];
    const f = data.funnel;
    return [
      { stage: 'Sent', value: f.sent, color: '#94a3b8' },
      { stage: 'Opened', value: f.opened, color: '#60a5fa' },
      { stage: 'Clicked', value: f.clicked, color: '#818cf8' },
      { stage: 'Replied', value: f.replied, color: '#34d399' },
      { stage: 'Demo booked', value: f.demoBooked, color: '#f97316' },
    ];
  }, [data]);
  const growthRows = useMemo(() => {
    if (!data) return [];
    let run = data.growthBase;
    return data.growth.map((g) => ({ label: g.label, added: g.added, total: (run += g.added) }));
  }, [data]);
  const topCountries = data?.locations.countries.slice(0, 10) ?? [];
  const maxCountry = Math.max(1, ...topCountries.map((c) => c.count));
  const leastCountries = data ? [...data.locations.countries].slice(-5).reverse() : [];

  return (
    <div className="space-y-4 max-w-7xl mx-auto">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-lg font-bold text-slate-900">Dashboard</h2>
        <div className="flex flex-wrap items-center gap-2">
          <select className={selectCls} value={range} onChange={(e) => setRange(e.target.value as Range)} aria-label="Date range">
            <option value="30d">Last 30 days</option>
            <option value="90d">Last 90 days</option>
            <option value="12m">Last 12 months</option>
          </select>
          {isOrg && (
            <label className="relative flex items-center">
              <select className={`${selectCls} pr-7 appearance-none`} value={data?.scope === 'all' ? 'all' : data?.scope || client || 'all'}
                onChange={(e) => { setClient(e.target.value); setCampaignId(''); }} aria-label="Client">
                <option value="all">All clients</option>
                {data!.clients.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
              <ChevronDown className="w-3.5 h-3.5 absolute right-2 pointer-events-none text-slate-500" />
            </label>
          )}
        </div>
      </div>

      {error && <p className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{error}</p>}
      {loading && !data && <div className="flex items-center gap-2 text-sm text-slate-500 py-10 justify-center"><Loader2 className="w-4 h-4 animate-spin" /> Loading dashboard…</div>}

      {data && data.empty && <p className="text-sm text-slate-500 bg-white border border-dashed border-slate-300 rounded-xl p-8 text-center">No clients yet. Add a client to see data here.</p>}

      {data && !data.empty && (
        <div className={loading ? 'opacity-60 transition-opacity' : 'transition-opacity'}>
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
            <Kpi label="Total leads" value={nf.format(data.kpis.totalLeads)} icon={<Users className="w-4 h-4" />} />
            <Kpi label="Active campaigns" value={nf.format(data.kpis.activeCampaigns)} icon={<Send className="w-4 h-4" />} />
            <Kpi label="Demos scheduled" value={nf.format(data.kpis.demosScheduled)} icon={<CalendarCheck className="w-4 h-4" />} />
            <Kpi label="Emails sent" value={nf.format(data.kpis.emailsSent)} icon={<Mail className="w-4 h-4" />} />
            <Kpi label="AI tokens used" value={compact(data.kpis.aiTokens)} icon={<Cpu className="w-4 h-4" />} />
          </div>

          {data.breakdown && (
            <Card title="Per client" hint="Emails and AI tokens are tracked separately for each client." className="mt-4">
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead><tr className="text-left text-slate-500 border-b border-slate-100">
                    <th className="py-1.5 pr-3">Client</th><th className="pr-3 text-right">Leads</th><th className="pr-3 text-right">Active campaigns</th>
                    <th className="pr-3 text-right">Demos</th><th className="pr-3 text-right">Emails sent</th><th className="text-right">AI tokens</th>
                  </tr></thead>
                  <tbody>
                    {data.breakdown.map((b) => (
                      <tr key={b.id} className="border-b border-slate-50 hover:bg-slate-50 cursor-pointer" onClick={() => setClient(b.id)}>
                        <td className="py-1.5 pr-3 font-semibold text-slate-800">{b.name}</td>
                        <td className="pr-3 text-right">{nf.format(b.totalLeads)}</td><td className="pr-3 text-right">{b.activeCampaigns}</td>
                        <td className="pr-3 text-right">{b.demosScheduled}</td><td className="pr-3 text-right">{nf.format(b.emailsSent)}</td>
                        <td className="text-right">{compact(b.aiTokens)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}

          <div className="grid lg:grid-cols-2 gap-4 mt-4">
            <Card
              title="Email funnel"
              hint="Opens are estimates (mail apps pre-load images); clicks and replies are confirmed."
              right={data.campaigns.length > 0 ? (
                <select className={selectCls} value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
                  <option value="">All campaigns</option>
                  {data.campaigns.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </select>
              ) : undefined}
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={funnelRows} layout="vertical" margin={{ left: 10, right: 24 }}>
                    <CartesianGrid horizontal={false} stroke="#f1f5f9" />
                    <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} />
                    <YAxis type="category" dataKey="stage" width={85} tick={{ fontSize: 11 }} />
                    <Tooltip cursor={{ fill: '#f8fafc' }} />
                    <Bar dataKey="value" name="Leads" radius={[0, 4, 4, 0]} label={{ position: 'right', fontSize: 11 }}>
                      {funnelRows.map((r) => <Cell key={r.stage} fill={r.color} />)}
                    </Bar>
                  </BarChart>
                </ResponsiveContainer>
              </div>
              <div className="flex gap-3 mt-2 text-[11px]">
                <span className="px-2 py-0.5 rounded-full bg-red-50 text-red-700 border border-red-100">Failed {nf.format(data.funnel.failed)}</span>
                <span className="px-2 py-0.5 rounded-full bg-amber-50 text-amber-700 border border-amber-100">Bounced {nf.format(data.funnel.bounced)}</span>
                <span className="text-slate-500">of {nf.format(data.funnel.total)} in campaign{campaignId ? '' : 's'}</span>
              </div>
            </Card>

            <Card
              title="Lead growth"
              right={
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-[11px] font-semibold">
                  {(['cumulative', 'incremental'] as const).map((m) => (
                    <button key={m} onClick={() => setGrowthMode(m)} className={`px-2.5 py-1 capitalize ${growthMode === m ? 'bg-orange-500 text-white' : 'bg-white text-slate-600'}`}>{m}</button>
                  ))}
                </div>
              }
            >
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  {growthMode === 'cumulative' ? (
                    <AreaChart data={growthRows} margin={{ left: -10, right: 8 }}>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Area type="monotone" dataKey="total" name="Total leads" stroke="#f97316" fill="#fed7aa" />
                    </AreaChart>
                  ) : (
                    <BarChart data={growthRows} margin={{ left: -10, right: 8 }}>
                      <CartesianGrid vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="label" tick={{ fontSize: 10 }} minTickGap={24} />
                      <YAxis allowDecimals={false} tick={{ fontSize: 10 }} />
                      <Tooltip />
                      <Bar dataKey="added" name="New leads" fill="#f97316" radius={[3, 3, 0, 0]} />
                    </BarChart>
                  )}
                </ResponsiveContainer>
              </div>
            </Card>
          </div>

          <Card title="Where your leads are" hint={data.locations.truncated ? `Based on the first ${nf.format(data.locations.scanned)} leads.` : undefined} className="mt-4">
            {data.locations.countries.length === 0 ? (
              <p className="text-sm text-slate-500">No lead locations yet.{data.locations.unknown > 0 && ` ${nf.format(data.locations.unknown)} leads have no country.`}</p>
            ) : (
              <div className="grid lg:grid-cols-5 gap-4">
                <div className="lg:col-span-3"><LeadMap countries={data.locations.countries} /></div>
                <div className="lg:col-span-2 space-y-4 text-xs">
                  <div>
                    <div className="font-bold text-slate-700 mb-1.5">Most leads</div>
                    {topCountries.map((c) => (
                      <div key={c.name} className="flex items-center gap-2 mb-1">
                        <span className="w-28 truncate text-slate-700">{c.name}</span>
                        <span className="flex-1 h-2 bg-slate-100 rounded"><span className="block h-2 rounded bg-orange-400" style={{ width: `${(c.count / maxCountry) * 100}%` }} /></span>
                        <span className="w-10 text-right tabular-nums text-slate-600">{nf.format(c.count)}</span>
                      </div>
                    ))}
                  </div>
                  {data.locations.countries.length > 10 && (
                    <div>
                      <div className="font-bold text-slate-700 mb-1.5">Fewest leads</div>
                      {leastCountries.map((c) => (
                        <div key={c.name} className="flex justify-between text-slate-600"><span>{c.name}</span><span className="tabular-nums">{nf.format(c.count)}</span></div>
                      ))}
                    </div>
                  )}
                  {data.locations.cities.length > 0 && (
                    <div>
                      <div className="font-bold text-slate-700 mb-1.5">Top cities</div>
                      {data.locations.cities.slice(0, 6).map((c) => (
                        <div key={`${c.country}-${c.name}`} className="flex justify-between text-slate-600"><span>{c.name}, {c.country}</span><span className="tabular-nums">{nf.format(c.count)}</span></div>
                      ))}
                    </div>
                  )}
                  {data.locations.unknown > 0 && <p className="text-slate-400">{nf.format(data.locations.unknown)} leads have no country.</p>}
                </div>
              </div>
            )}
          </Card>

          {data.usageByMonth.length > 0 && (
            <Card title="Emails and AI tokens by month" className="mt-4">
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.usageByMonth.slice(-12)} margin={{ left: -10, right: 8 }}>
                    <CartesianGrid vertical={false} stroke="#f1f5f9" />
                    <XAxis dataKey="month" tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="e" allowDecimals={false} tick={{ fontSize: 10 }} />
                    <YAxis yAxisId="t" orientation="right" tick={{ fontSize: 10 }} tickFormatter={compact} />
                    <Tooltip />
                    <Bar yAxisId="e" dataKey="emails" name="Emails" fill="#f97316" radius={[3, 3, 0, 0]} />
                    <Bar yAxisId="t" dataKey="tokens" name="AI tokens" fill="#818cf8" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
          )}
        </div>
      )}
    </div>
  );
};

export default DashboardView;
