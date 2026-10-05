import type { Request, Response, NextFunction } from 'express';
import { getAdminAuth } from './firebaseAdmin.js';
import { globalTenantDoc, globalUserDoc } from './tenantRepo.js';
import { getDoc } from 'firebase/firestore';
import type { TenantContext, UserRole } from '../types/tenant.js';
import { createTenantLogger } from './logger.js';

// Extend Express Request type with TenantContext for vercel
declare global {
  namespace Express {
    interface Request {
      tenantCtx?: TenantContext;
    }
  }
}

// In-memory tenant status cache to avoid hitting Firestore on every single request
const tenantStatusCache = new Map<string, { status: 'active' | 'suspended'; cachedAt: number }>();
const CACHE_TTL_MS = 60_000; // 1 minute

async function getCachedTenantStatus(tenantId: string): Promise<'active' | 'suspended'> {
  const cached = tenantStatusCache.get(tenantId);
  const now = Date.now();
  if (cached && now - cached.cachedAt < CACHE_TTL_MS) {
    return cached.status;
  }

  try {
    const snap = await getDoc(globalTenantDoc(tenantId));
    if (snap.exists()) {
      const data = snap.data();
      const status = data.status === 'suspended' ? 'suspended' : 'active';
      tenantStatusCache.set(tenantId, { status, cachedAt: now });
      return status;
    }
    // If tenant record does not exist yet (e.g. bootstrap/migration phase), default to active
    return 'active';
  } catch (err) {
    console.warn(`[AuthMiddleware] Error fetching tenant status for ${tenantId}:`, err);
    return 'active';
  }
}

export function invalidateTenantStatusCache(tenantId: string) {
  tenantStatusCache.delete(tenantId);
}

/**
 * Extracts Bearer token from Authorization header
 */
function extractBearerToken(req: Request): string | null {
  const authHeader = req.headers.authorization;
  if (!authHeader) return null;
  const parts = authHeader.split(' ');
  if (parts.length === 2 && /^bearer$/i.test(parts[0])) {
    return parts[1].trim();
  }
  return null;
}

/**
 * Core requireAuth Middleware
 */
export async function requireAuth(req: Request, res: Response, next: NextFunction): Promise<void> {
  const token = extractBearerToken(req);

  if (!token) {
    res.status(401).json({
      error: 'Unauthorized: Missing or invalid Authorization header with Bearer token',
    });
    return;
  }

  try {
    const auth = getAdminAuth();
    let decodedToken: any;

    try {
      decodedToken = await auth.verifyIdToken(token);
    } catch (verifyErr: any) {
      // In development or test environments, check for development/service token
      if (process.env.NODE_ENV !== 'production' && token.startsWith('dev-tenant-')) {
        const parts = token.split(':');
        decodedToken = {
          uid: parts[1] || 'dev-user',
          email: 'dev@umrah360.in',
          tenantId: parts[2] || 'umrah360',
          role: (parts[3] as UserRole) || 'admin',
          platformAdmin: parts[3] === 'platformAdmin',
        };
      } else {
        res.status(401).json({
          error: 'Unauthorized: Invalid or expired Firebase ID token',
          code: verifyErr?.code || 'AUTH_TOKEN_INVALID',
        });
        return;
      }
    }

    const isPlatformAdmin = Boolean(decodedToken.platformAdmin);
    let tenantId = decodedToken.tenantId;
    let role: UserRole = decodedToken.role || 'member';

    // If platformAdmin and requesting a specific tenant via header, scope to that tenant
    if (isPlatformAdmin) {
      const targetTenantHeader = req.headers['x-tenant-id'];
      if (typeof targetTenantHeader === 'string' && targetTenantHeader.trim()) {
        tenantId = targetTenantHeader.trim();
      } else if (!tenantId) {
        tenantId = 'platform';
      }
      role = 'platformAdmin';
    }

    if (!tenantId) {
      res.status(403).json({
        error: 'Forbidden: User is not assigned to any tenant',
        code: 'NO_TENANT_ASSIGNED',
      });
      return;
    }

    // Check if tenant is suspended
    if (!isPlatformAdmin && tenantId !== 'platform') {
      const tenantStatus = await getCachedTenantStatus(tenantId);
      if (tenantStatus === 'suspended') {
        res.status(403).json({
          error: 'Forbidden: Tenant workspace is currently suspended',
          code: 'TENANT_SUSPENDED',
        });
        return;
      }
    }

    const ctx: TenantContext = {
      tenantId,
      uid: decodedToken.uid,
      email: decodedToken.email || '',
      role,
      isPlatformAdmin,
    };

    req.tenantCtx = ctx;
    next();
  } catch (error: any) {
    const logger = createTenantLogger('system');
    logger.error({ err: error }, 'Authentication verification failed');
    res.status(401).json({
      error: 'Unauthorized: Authentication failed',
      details: error?.message || 'Token verification error',
    });
  }
}

/**
 * Middleware factory for role-based authorization
 */
export function requireRole(...allowedRoles: UserRole[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    const ctx = req.tenantCtx;
    if (!ctx) {
      res.status(401).json({ error: 'Unauthorized: Missing tenant context' });
      return;
    }

    if (ctx.isPlatformAdmin) {
      return next();
    }

    if (!allowedRoles.includes(ctx.role)) {
      res.status(403).json({
        error: `Forbidden: Requires one of [${allowedRoles.join(', ')}] role`,
        userRole: ctx.role,
      });
      return;
    }

    next();
  };
}
