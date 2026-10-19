import type { TenantContext } from '../types/tenant.js';
import { getTenantDashboard, mergeDashboards, listCampaignOptions, type GrowthRange } from './dashboardService.js';
import { listClients } from './orgService.js';

/**
 * GET /api/dashboard?client=<tenantId|all>&campaignId=<id>&range=30d|90d|12m
 *
 * - Workspace user: their own workspace (the client param is ignored, so it can never reach another tenant).
 * - Organization admin: any client of THEIR organization, or "all" (summed, with a per-client breakdown).
 * - Platform admin: the workspace selected with X-Tenant-Id.
 */
export async function handleDashboardApi(req: any, res: any, url: string, ctx: TenantContext): Promise<boolean> {
  if (url !== '/api/dashboard') return false;
  const send = (status: number, payload: any) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return true;
  };
  if (req.method !== 'GET') return send(405, { error: 'Method not allowed' });

  const params = new URL(req.url || '/', 'http://x').searchParams;
  const rangeIn = params.get('range');
  const range: GrowthRange = rangeIn === '90d' || rangeIn === '12m' ? rangeIn : '30d';
  const campaignId = (params.get('campaignId') || '').slice(0, 200);
  const clientParam = params.get('client') || '';

  try {
    // Organization admin (no fixed workspace): choose among the org's clients.
    if (ctx.orgId && !ctx.isPlatformAdmin) {
      const clients = (await listClients(ctx.orgId)).filter((c) => c.status !== 'deleted');
      const options = clients.map((c) => ({ id: c.id, name: c.name, status: c.status }));
      const wanted = clientParam && clientParam !== 'all' ? clientParam : ctx.tenantId && !clientParam ? ctx.tenantId : 'all';
      if (wanted !== 'all') {
        const client = clients.find((c) => c.id === wanted);
        if (!client) return send(403, { error: 'That client does not belong to your organization' });
        const [data, campaigns] = await Promise.all([getTenantDashboard(wanted, { campaignId, range }), listCampaignOptions(wanted)]);
        return send(200, { scope: wanted, clients: options, campaigns, range, ...data });
      }
      if (!clients.length) return send(200, { scope: 'all', clients: options, campaigns: [], range, empty: true });
      // Campaign filter only makes sense for one client.
      const parts = await Promise.all(clients.map((c) => getTenantDashboard(c.id, { range })));
      const merged = mergeDashboards(parts);
      const breakdown = clients.map((c, i) => ({
        id: c.id,
        name: c.name,
        totalLeads: parts[i].kpis.totalLeads,
        activeCampaigns: parts[i].kpis.activeCampaigns,
        demosScheduled: parts[i].kpis.demosScheduled,
        emailsSent: parts[i].kpis.emailsSent,
        aiTokens: parts[i].kpis.aiTokens,
      }));
      return send(200, { scope: 'all', clients: options, campaigns: [], breakdown, range, ...merged });
    }

    if (!ctx.tenantId) return send(400, { error: 'Select a client first.', code: 'TENANT_REQUIRED' });
    const [data, campaigns] = await Promise.all([getTenantDashboard(ctx.tenantId, { campaignId, range }), listCampaignOptions(ctx.tenantId)]);
    return send(200, { scope: ctx.tenantId, clients: [], campaigns, range, ...data });
  } catch (err: any) {
    console.error('[Dashboard API error]:', err);
    return send(500, { error: err?.message || 'Could not load the dashboard' });
  }
}
