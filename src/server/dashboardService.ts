import { countDocs, getDocs, query, where, limit, orderByDocumentId, startAfterId, select } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Dashboard numbers for one client brand (a tenant), or several summed together.
 *
 * Everything is computed on demand from the tenant's own data (server-side COUNT/SUM aggregations where
 * possible, one field-projected scan for locations) and cached for a short time, so the dashboard costs
 * little and never needs a rollup job to stay correct.
 */

export type GrowthRange = '30d' | '90d' | '12m';

export interface TenantDashboard {
  kpis: { totalLeads: number; activeCampaigns: number; demosScheduled: number; emailsSent: number; aiTokens: number };
  funnel: { total: number; sent: number; opened: number; clicked: number; replied: number; demoBooked: number; failed: number; bounced: number };
  growth: Array<{ label: string; added: number }>;
  growthBase: number; // leads that existed before the first bucket
  locations: { countries: Array<{ name: string; count: number }>; cities: Array<{ name: string; country: string; count: number }>; unknown: number; scanned: number; truncated: boolean };
  usageByMonth: Array<{ month: string; emails: number; tokens: number }>;
}

const ctxFor = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: 'system@dashboard', role: 'admin' } as TenantContext);

const CACHE_MS = 60_000;
const cache = new Map<string, { at: number; value: any }>();
async function cached<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const hit = cache.get(key);
  if (hit && Date.now() - hit.at < CACHE_MS) return hit.value as T;
  const value = await fn();
  cache.set(key, { at: Date.now(), value });
  if (cache.size > 500) cache.delete(cache.keys().next().value as string);
  return value;
}

const COUNTRY_ALIASES: Record<string, string> = {
  uae: 'United Arab Emirates', 'u.a.e': 'United Arab Emirates', emirates: 'United Arab Emirates',
  usa: 'United States of America', us: 'United States of America', 'u.s.': 'United States of America', 'u.s.a': 'United States of America',
  'united states': 'United States of America', america: 'United States of America',
  uk: 'United Kingdom', 'u.k.': 'United Kingdom', england: 'United Kingdom', britain: 'United Kingdom', 'great britain': 'United Kingdom',
  ksa: 'Saudi Arabia', 'saudi': 'Saudi Arabia', 'korea': 'South Korea', russia: 'Russia', 'viet nam': 'Vietnam',
  'bharat': 'India', 'bangla desh': 'Bangladesh', 'türkiye': 'Turkey', turkiye: 'Turkey', czechia: 'Czechia', 'czech republic': 'Czechia',
};

export function normalizeCountry(raw: unknown): string {
  const t = String(raw ?? '').trim().replace(/\s+/g, ' ');
  if (!t) return '';
  const alias = COUNTRY_ALIASES[t.toLowerCase()];
  if (alias) return alias;
  return t.length <= 3 ? t.toUpperCase() : t.replace(/\b\w/g, (c) => c.toUpperCase()).replace(/\b(Of|And|The)\b/g, (c) => c.toLowerCase()).replace(/^the /i, '');
}

function growthBuckets(range: GrowthRange, now = new Date()): Array<{ label: string; from: string; to: string }> {
  const out: Array<{ label: string; from: string; to: string }> = [];
  if (range === '12m') {
    for (let i = 11; i >= 0; i--) {
      const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i, 1));
      const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - i + 1, 1));
      out.push({ label: start.toISOString().slice(0, 7), from: start.toISOString(), to: end.toISOString() });
    }
    return out;
  }
  const days = range === '30d' ? 30 : 90;
  const step = range === '30d' ? 1 : 7; // 90d is shown weekly
  const today = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const firstStart = today - (days - 1) * 86400000;
  for (let t = firstStart; t <= today; t += step * 86400000) {
    const end = Math.min(t + step * 86400000, today + 86400000);
    out.push({ label: new Date(t).toISOString().slice(0, 10), from: new Date(t).toISOString(), to: new Date(end).toISOString() });
  }
  return out;
}

async function mapLimit<T, R>(items: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  await Promise.all(
    Array.from({ length: Math.min(n, items.length) }, async () => {
      while (i < items.length) {
        const idx = i++;
        out[idx] = await fn(items[idx]);
      }
    })
  );
  return out;
}

const MAX_LOCATION_SCAN = 20000;

export async function getTenantDashboard(tenantId: string, opts: { campaignId?: string; range: GrowthRange }): Promise<TenantDashboard> {
  const empty: TenantDashboard = {
    kpis: { totalLeads: 0, activeCampaigns: 0, demosScheduled: 0, emailsSent: 0, aiTokens: 0 },
    funnel: { total: 0, sent: 0, opened: 0, clicked: 0, replied: 0, demoBooked: 0, failed: 0, bounced: 0 },
    growth: [],
    growthBase: 0,
    locations: { countries: [], cities: [], unknown: 0, scanned: 0, truncated: false },
    usageByMonth: [],
  };
  if (!isFirebaseConfigured) return empty;
  const campaignId = opts.campaignId || '';
  return cached(`dash:${tenantId}:${campaignId}:${opts.range}`, async () => {
    const repo = tenantRepo(ctxFor(tenantId));
    const leadsBase = campaignId ? query(repo.leads(), where('campaignId', '==', campaignId)) : repo.leads();
    const clBase = (...c: any[]) => query(repo.campaignLeads(), ...(campaignId ? [where('campaignId', '==', campaignId)] : []), ...c);

    const buckets = growthBuckets(opts.range);
    const [totalLeads, activeCampaigns, demosScheduled, usageSnap, f, growthCounts, growthBase, locations] = await Promise.all([
      countDocs(leadsBase),
      countDocs(query(repo.campaigns(), where('status', '==', 'RUNNING'))),
      countDocs(query(repo.bookings(), where('status', 'in', ['BOOKED', 'RESCHEDULED']))),
      getDocs(repo.usageCol()),
      Promise.all([
        countDocs(clBase()),
        countDocs(clBase(where('sendStatus', 'in', ['SENT', 'COMPLETED']))),
        countDocs(clBase(where('opened', '==', true))),
        countDocs(clBase(where('clicked', '==', true))),
        countDocs(clBase(where('replyStatus', '==', 'REPLIED'))),
        countDocs(clBase(where('demoStatus', '==', 'BOOKED'))),
        countDocs(clBase(where('sendStatus', '==', 'FAILED'))),
        countDocs(clBase(where('bounced', '==', true))),
      ]),
      mapLimit(buckets, 8, (b) => countDocs(query(leadsBase, where('createdAt', '>=', b.from), where('createdAt', '<', b.to)))),
      countDocs(query(leadsBase, where('createdAt', '<', buckets[0].from))),
      scanLocations(repo, campaignId),
    ]);

    const usageByMonth = usageSnap.docs
      .filter((d: any) => /^\d{4}-\d{2}$/.test(d.id))
      .map((d: any) => {
        const u = d.data() as any;
        return { month: d.id, emails: Number(u.solicitedEmailCount || 0) + Number(u.coldEmailCount || 0), tokens: Number(u.aiTotalTokens || 0) };
      })
      .sort((a: any, b: any) => a.month.localeCompare(b.month));

    return {
      kpis: {
        totalLeads,
        activeCampaigns,
        demosScheduled,
        emailsSent: usageByMonth.reduce((s: number, m: any) => s + m.emails, 0),
        aiTokens: usageByMonth.reduce((s: number, m: any) => s + m.tokens, 0),
      },
      funnel: { total: f[0], sent: f[1], opened: f[2], clicked: f[3], replied: f[4], demoBooked: f[5], failed: f[6], bounced: f[7] },
      growth: buckets.map((b, i) => ({ label: b.label, added: growthCounts[i] })),
      growthBase,
      locations,
      usageByMonth,
    } as TenantDashboard;
  });
}

async function scanLocations(repo: ReturnType<typeof tenantRepo>, campaignId: string): Promise<TenantDashboard['locations']> {
  const countries = new Map<string, number>();
  const cities = new Map<string, { name: string; country: string; count: number }>();
  let unknown = 0;
  let scanned = 0;
  let last = '';
  let truncated = false;
  const base = campaignId ? query(repo.leads(), where('campaignId', '==', campaignId)) : repo.leads();
  for (;;) {
    const snap = await getDocs(query(base, orderByDocumentId(), ...(last ? [startAfterId(last)] : []), select('country', 'city'), limit(1000)));
    for (const d of snap.docs) {
      const x = d.data() as any;
      const c = normalizeCountry(x.country);
      if (!c) unknown++;
      else {
        countries.set(c, (countries.get(c) || 0) + 1);
        const city = String(x.city ?? '').trim().replace(/\b\w/g, (m: string) => m.toUpperCase());
        if (city) {
          const k = `${c}|${city.toLowerCase()}`;
          const e = cities.get(k) || { name: city, country: c, count: 0 };
          e.count++;
          cities.set(k, e);
        }
      }
    }
    scanned += snap.docs.length;
    if (snap.docs.length < 1000) break;
    last = snap.docs[snap.docs.length - 1].id;
    if (scanned >= MAX_LOCATION_SCAN) {
      truncated = true;
      break;
    }
  }
  return {
    countries: [...countries].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
    cities: [...cities.values()].sort((a, b) => b.count - a.count).slice(0, 50),
    unknown,
    scanned,
    truncated,
  };
}

/** Sum several clients' dashboards into one ("All clients"). */
export function mergeDashboards(list: TenantDashboard[]): TenantDashboard {
  const first = list[0];
  const sum = <K extends keyof TenantDashboard['kpis']>(k: K) => list.reduce((s, d) => s + d.kpis[k], 0);
  const fk = ['total', 'sent', 'opened', 'clicked', 'replied', 'demoBooked', 'failed', 'bounced'] as const;
  const countries = new Map<string, number>();
  const cities = new Map<string, { name: string; country: string; count: number }>();
  const usage = new Map<string, { month: string; emails: number; tokens: number }>();
  for (const d of list) {
    d.locations.countries.forEach((c) => countries.set(c.name, (countries.get(c.name) || 0) + c.count));
    d.locations.cities.forEach((c) => {
      const k = `${c.country}|${c.name.toLowerCase()}`;
      const e = cities.get(k) || { ...c, count: 0 };
      e.count += c.count;
      cities.set(k, e);
    });
    d.usageByMonth.forEach((m) => {
      const e = usage.get(m.month) || { month: m.month, emails: 0, tokens: 0 };
      e.emails += m.emails;
      e.tokens += m.tokens;
      usage.set(m.month, e);
    });
  }
  return {
    kpis: { totalLeads: sum('totalLeads'), activeCampaigns: sum('activeCampaigns'), demosScheduled: sum('demosScheduled'), emailsSent: sum('emailsSent'), aiTokens: sum('aiTokens') },
    funnel: Object.fromEntries(fk.map((k) => [k, list.reduce((s, d) => s + d.funnel[k], 0)])) as TenantDashboard['funnel'],
    growth: first.growth.map((g, i) => ({ label: g.label, added: list.reduce((s, d) => s + (d.growth[i]?.added || 0), 0) })),
    growthBase: list.reduce((s, d) => s + d.growthBase, 0),
    locations: {
      countries: [...countries].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count),
      cities: [...cities.values()].sort((a, b) => b.count - a.count).slice(0, 50),
      unknown: list.reduce((s, d) => s + d.locations.unknown, 0),
      scanned: list.reduce((s, d) => s + d.locations.scanned, 0),
      truncated: list.some((d) => d.locations.truncated),
    },
    usageByMonth: [...usage.values()].sort((a, b) => a.month.localeCompare(b.month)),
  };
}

/** Campaign choices for the funnel filter (id + name), for one tenant. */
export async function listCampaignOptions(tenantId: string): Promise<Array<{ id: string; name: string; status: string }>> {
  if (!isFirebaseConfigured) return [];
  const repo = tenantRepo(ctxFor(tenantId));
  const snap = await getDocs(query(repo.campaigns(), limit(300)));
  return snap.docs
    .map((d: any) => ({ id: d.id, name: String(d.data().name || d.id), status: String(d.data().status || '') }))
    .sort((a: any, b: any) => a.name.localeCompare(b.name));
}
