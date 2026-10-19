import type { Request, Response, NextFunction } from 'express';
import { getAdminAuth, getAdminFirestore } from './firebaseAdmin.js';
import type { TenantContext, UserRole } from '../types/tenant.js';
import { createTenantLogger } from './logger.js';

declare global {
  namespace Express {
    interface Request {
      tenantCtx?: TenantContext;
    }
  }
}

const PLATFORM_TENANT_ID = 'platform';

// (Not a discriminated union: this project compiles without strictNullChecks,
// where union narrowing on `ok` does not work.)
export interface AuthResult {
  ok: boolean;
  ctx?: TenantContext;
  status?: number;
  error?: string;
  code?: string;
}

// Short cache so we don't read Firestore on every request. Fails CLOSED.
type TenantInfo = { status: 'active' | 'suspended' | 'missing'; orgId?: string };
const tenantStatusCache = new Map<string, { info: TenantInfo; cachedAt: number }>();
const orgStatusCache = new Map<string, { status: 'active' | 'suspended' | 'missing'; cachedAt: number }>();
const CACHE_TTL_MS = 30_000;

async function getTenantInfo(tenantId: string): Promise<TenantInfo> {
  const cached = tenantStatusCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.info;

  const snap = await getAdminFirestore().collection('tenants').doc(tenantId).get();
  const data: any = snap.exists ? snap.data() : undefined;
  const info: TenantInfo = !snap.exists
    ? { status: 'missing' }
    : { status: data?.status === 'suspended' ? 'suspended' : 'active', orgId: typeof data?.orgId === 'string' && data.orgId ? data.orgId : undefined };
  tenantStatusCache.set(tenantId, { info, cachedAt: now });
  return info;
}

async function getOrgStatus(orgId: string): Promise<'active' | 'suspended' | 'missing'> {
  const cached = orgStatusCache.get(orgId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.status;
  const snap = await getAdminFirestore().collection('orgs').doc(orgId).get();
  const status: 'active' | 'suspended' | 'missing' = !snap.exists ? 'missing' : snap.data()?.status === 'suspended' ? 'suspended' : 'active';
  orgStatusCache.set(orgId, { status, cachedAt: now });
  return status;
}

export function invalidateTenantStatusCache(tenantId: string) {
  tenantStatusCache.delete(tenantId);
}

export function invalidateOrgStatusCache(orgId: string) {
  orgStatusCache.delete(orgId);
}

export function extractBearerToken(req: { headers: Record<string, any> }): string | null {
  const header = req.headers['authorization'];
  if (typeof header !== 'string') return null;
  const parts = header.split(' ');
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
    const t = parts[1].trim();
    return t && t !== 'null' && t !== 'undefined' ? t : null;
  }
  return null;
}

/**
 * Framework-agnostic authentication. Verifies the Firebase ID token (including
 * revocation / disabled-user check) and builds the TenantContext from the
 * token's custom claims ONLY. Nothing in the request (headers, body, query)
 * can change which tenant the caller belongs to.
 */
export async function authenticateRequest(req: { headers: Record<string, any> }): Promise<AuthResult> {
  const token = extractBearerToken(req);
  if (!token) {
    return { ok: false, status: 401, error: 'Authentication required', code: 'AUTH_MISSING' };
  }

  let decoded: any;
  try {
    decoded = await getAdminAuth().verifyIdToken(token, true);
  } catch (err: any) {
    const code = err?.code || 'AUTH_TOKEN_INVALID';
    return { ok: false, status: 401, error: 'Invalid or expired session', code };
  }

  const isPlatformAdmin = decoded.platformAdmin === true;
  const claimOrgId: string | undefined = !isPlatformAdmin && typeof decoded.orgId === 'string' && decoded.orgId ? decoded.orgId : undefined;

  let tenantId: string | undefined;
  if (isPlatformAdmin) {
    tenantId = PLATFORM_TENANT_ID;
  } else if (claimOrgId) {
    // Organization admin: the client brand they are working in is chosen per request (X-Tenant-Id), and the
    // server verifies below that it really belongs to THEIR organization. No header = organization-level only.
    const raw = req.headers['x-tenant-id'];
    const requested = typeof raw === 'string' ? raw.trim() : '';
    tenantId = requested;
  } else {
    tenantId = decoded.tenantId;
  }

  if (!claimOrgId && (!tenantId || typeof tenantId !== 'string')) {
    return { ok: false, status: 403, error: 'User is not assigned to a workspace', code: 'NO_TENANT_ASSIGNED' };
  }

  if (!isPlatformAdmin) {
    try {
      if (claimOrgId) {
        const orgStatus = await getOrgStatus(claimOrgId);
        if (orgStatus === 'missing') {
          return { ok: false, status: 403, error: 'Organization not found', code: 'ORG_NOT_FOUND' };
        }
        if (orgStatus === 'suspended') {
          return { ok: false, status: 403, error: 'This organization is suspended', code: 'ORG_SUSPENDED' };
        }
      }
      if (tenantId) {
        const info = await getTenantInfo(tenantId);
        if (info.status === 'missing') {
          return { ok: false, status: 403, error: 'Workspace not found', code: 'TENANT_NOT_FOUND' };
        }
        if (claimOrgId && info.orgId !== claimOrgId) {
          // Never reveal whether the workspace exists: same answer for "not yours" and "does not exist".
          return { ok: false, status: 403, error: 'You do not have access to this client', code: 'TENANT_FORBIDDEN' };
        }
        if (info.status === 'suspended') {
          return { ok: false, status: 403, error: 'This workspace is suspended', code: 'TENANT_SUSPENDED' };
        }
        // A regular user of a client brand is also blocked while the whole organization is suspended.
        if (!claimOrgId && info.orgId) {
          const orgStatus = await getOrgStatus(info.orgId);
          if (orgStatus === 'suspended') {
            return { ok: false, status: 403, error: 'This organization is suspended', code: 'ORG_SUSPENDED' };
          }
        }
      }
    } catch (err) {
      createTenantLogger('system').error({ err }, 'Tenant status lookup failed');
      return { ok: false, status: 503, error: 'Could not verify workspace', code: 'TENANT_LOOKUP_FAILED' };
    }
  }

  const role: UserRole = isPlatformAdmin
    ? 'platformAdmin'
    : decoded.role === 'admin'
      ? 'admin'
      : 'member';

  return {
    ok: true,
    ctx: {
      tenantId: tenantId || '',
      ...(claimOrgId ? { orgId: claimOrgId } : {}),
      uid: decoded.uid,
      email: decoded.email || '',
      role,
      isPlatformAdmin,
    },
  };
}

/** Express middleware wrapper. */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const result = await authenticateRequest(req as any);
  if (!result.ok) {
    res.status(result.status).json({ error: result.error, code: result.code });
    return;
  }
  req.tenantCtx = result.ctx!;
  next();
}

export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.tenantCtx;
    if (!ctx) {
      res.status(401).json({ error: 'Authentication required' });
      return;
    }
    if (ctx.isPlatformAdmin || allowedRoles.includes(ctx.role)) return next();
    res.status(403).json({ error: 'Insufficient permissions' });
  };
}
