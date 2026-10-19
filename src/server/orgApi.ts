import type { TenantContext } from '../types/tenant.js';
import {
  OrgError,
  adoptTenant,
  createClient,
  createOrg,
  getOrg,
  getOrgOverview,
  inviteOrgAdmin,
  listOrgs,
  updateClient,
  updateOrg,
} from './orgService.js';

/**
 * Organization (agency) API.
 *
 *   Organization admin (claims.orgId, role admin):
 *     GET   /api/org                       organization, plan, client list + cap usage, admins
 *     POST  /api/org/clients               create a client brand (402 upgrade_required at the plan's cap)
 *     PATCH /api/org/clients/:id           rename / suspend / reactivate a client brand
 *     POST  /api/org/admins                add another organization admin
 *
 *   Platform admin:
 *     GET   /api/orgs                      all organizations
 *     POST  /api/orgs                      create an organization (+ optionally invite its first admin)
 *     GET   /api/orgs/:id                  one organization's overview
 *     PATCH /api/orgs/:id                  rename / change plan / suspend
 *     POST  /api/orgs/:id/admins           add an organization admin
 *     POST  /api/orgs/:id/adopt-tenant     move an existing workspace under the organization
 *
 * Returns true when the request was handled here.
 */
export async function handleOrgApi(req: any, res: any, url: string, body: any, ctx: TenantContext): Promise<boolean> {
  const isOrgRoute = url === '/api/org' || url.startsWith('/api/org/');
  const isOrgsRoute = url === '/api/orgs' || url.startsWith('/api/orgs/');
  if (!isOrgRoute && !isOrgsRoute) return false;

  const send = (status: number, payload: any) => {
    res.statusCode = status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify(payload));
    return true;
  };
  const fail = (err: any) => {
    if (err instanceof OrgError) {
      return send(err.status, { error: err.message, ...(err.code ? { code: err.code } : {}), ...(err.extra || {}) });
    }
    console.error('[Org API error]:', err);
    return send(500, { error: err?.message || 'Organization request failed' });
  };

  // ---------------------------------------------------------------- platform admin
  if (isOrgsRoute) {
    if (!ctx.isPlatformAdmin) return send(403, { error: 'Platform admin only' });
    try {
      if (url === '/api/orgs' && req.method === 'GET') {
        return send(200, { orgs: await listOrgs() });
      }
      if (url === '/api/orgs' && req.method === 'POST') {
        const org = await createOrg({ name: body?.name, planId: body?.planId, contactEmail: body?.contactEmail });
        let admin: any = null;
        if (body?.adminEmail) {
          try {
            admin = await inviteOrgAdmin(org.id, { email: body.adminEmail, name: body.adminName });
          } catch (e: any) {
            // The organization exists; report the invite problem without losing it.
            return send(201, { org, adminError: e?.message || 'Could not invite the first admin', ...(e?.status ? { adminErrorStatus: e.status } : {}) });
          }
        }
        return send(201, { org, admin });
      }
      const m = url.match(/^\/api\/orgs\/([^/]+)(?:\/(admins|adopt-tenant))?$/);
      if (m) {
        const orgId = decodeURIComponent(m[1]);
        const sub = m[2];
        if (!sub && req.method === 'GET') return send(200, await getOrgOverview(orgId));
        if (!sub && req.method === 'PATCH') {
          return send(200, { org: await updateOrg(orgId, { name: body?.name, planId: body?.planId, status: body?.status }) });
        }
        if (sub === 'admins' && req.method === 'POST') {
          return send(201, { admin: await inviteOrgAdmin(orgId, { email: body?.email, name: body?.name, password: body?.password }) });
        }
        if (sub === 'adopt-tenant' && req.method === 'POST') {
          return send(200, { client: await adoptTenant(orgId, String(body?.tenantId || '').trim()) });
        }
      }
    } catch (err) {
      return fail(err);
    }
    return send(404, { error: 'Endpoint not found' });
  }

  // ---------------------------------------------------------------- organization admin
  if (!ctx.orgId) return send(403, { error: 'Organization admin only' });
  if (ctx.role !== 'admin') return send(403, { error: 'Organization admin only' });
  const orgId = ctx.orgId;

  try {
    if (url === '/api/org' && req.method === 'GET') {
      return send(200, await getOrgOverview(orgId));
    }
    if (url === '/api/org/clients' && req.method === 'POST') {
      const client = await createClient(orgId, { name: body?.name, timezone: body?.timezone, contactEmail: body?.contactEmail });
      return send(201, { client });
    }
    const cm = url.match(/^\/api\/org\/clients\/([^/]+)$/);
    if (cm && req.method === 'PATCH') {
      return send(200, { client: await updateClient(orgId, decodeURIComponent(cm[1]), { name: body?.name, status: body?.status }) });
    }
    if (url === '/api/org/admins' && req.method === 'POST') {
      // The organization must still exist (a deleted org's stale token must not keep creating admins).
      if (!(await getOrg(orgId))) return send(404, { error: 'Organization not found' });
      return send(201, { admin: await inviteOrgAdmin(orgId, { email: body?.email, name: body?.name, password: body?.password }) });
    }
  } catch (err) {
    return fail(err);
  }
  return send(404, { error: 'Endpoint not found' });
}
