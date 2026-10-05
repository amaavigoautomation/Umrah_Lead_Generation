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
const tenantStatusCache = new Map<string, { status: 'active' | 'suspended' | 'missing'; cachedAt: number }>();
const CACHE_TTL_MS = 30_000;

async function getTenantStatus(tenantId: string): Promise<'active' | 'suspended' | 'missing'> {
  const cached = tenantStatusCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) return cached.status;

  const snap = await getAdminFirestore().collection('tenants').doc(tenantId).get();
  const status: 'active' | 'suspended' | 'missing' = !snap.exists
    ? 'missing'
    : snap.data()?.status === 'suspended'
      ? 'suspended'
      : 'active';
  tenantStatusCache.set(tenantId, { status, cachedAt: now });
  return status;
}

export function invalidateTenantStatusCache(tenantId: string) {
  tenantStatusCache.delete(tenantId);
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
  const tenantId: string | undefined = isPlatformAdmin ? PLATFORM_TENANT_ID : decoded.tenantId;

  if (!tenantId || typeof tenantId !== 'string') {
    return { ok: false, status: 403, error: 'User is not assigned to a workspace', code: 'NO_TENANT_ASSIGNED' };
  }

  if (!isPlatformAdmin) {
    try {
      const status = await getTenantStatus(tenantId);
      if (status === 'suspended') {
        return { ok: false, status: 403, error: 'This workspace is suspended', code: 'TENANT_SUSPENDED' };
      }
      if (status === 'missing') {
        return { ok: false, status: 403, error: 'Workspace not found', code: 'TENANT_NOT_FOUND' };
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
      tenantId,
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
