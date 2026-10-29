import { setDoc } from './adminFirestore.js';
import { sanitizeForFirestore } from './firestoreUtils.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

export type ServerAuditModule = 'CAMPAIGNS' | 'CRM' | 'INBOX' | 'KNOWLEDGE' | 'SETTINGS' | 'AUTH' | 'SCHEDULING' | 'AI_ENGINE' | 'SYSTEM';
export type ServerAuditSeverity = 'INFO' | 'WARNING' | 'CRITICAL' | 'SECURITY';

export interface ServerAuditEntry {
  action: string;
  module: ServerAuditModule;
  description: string;
  severity?: ServerAuditSeverity;
  target?: { type: string; id: string; name?: string };
  metadata?: Record<string, unknown>;
  actor?: { userId?: string; name?: string; email?: string; role?: string };
}

/** Persist a tenant-scoped audit event. Audit failures must never break the primary workflow. */
export async function writeTenantAuditEvent(ctx: TenantContext, entry: ServerAuditEntry): Promise<void> {
  if (!ctx?.tenantId) return;
  const now = new Date().toISOString();
  const id = 'audit-' + Date.now() + '-' + Math.random().toString(36).slice(2, 8);
  const actor = entry.actor || {
    userId: ctx.uid || 'system',
    name: (ctx.email || '').split('@')[0] || 'System Automation',
    email: ctx.email || 'system@workspace.local',
    role: String(ctx.role || 'admin').toUpperCase(),
  };
  const record = {
    id, tenantId: ctx.tenantId, timestamp: now, action: entry.action, module: entry.module,
    severity: entry.severity || 'INFO', description: entry.description, actor,
    target: entry.target || null, metadata: entry.metadata || {},
  };
  try {
    await setDoc(tenantRepo(ctx).auditLogDoc(id), sanitizeForFirestore(record) as any, { merge: true });
  } catch (error) {
    console.error('[AuditLogger] Failed to persist tenant audit event:', { tenantId: ctx.tenantId, action: entry.action, error });
  }
}