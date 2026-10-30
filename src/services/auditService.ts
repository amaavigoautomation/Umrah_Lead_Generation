import { db, isFirebaseConfigured } from '../firebase/config';
import { collection, doc, setDoc, getDocs, query, orderBy, limit as firestoreLimit } from 'firebase/firestore';
import { AuditLog, AuditModule, AuditSeverity, AuditActor, AuditTarget } from '../types';

export async function logAuditEvent(
  tenantId: string,
  entry: {
    action: string;
    module: AuditModule;
    severity?: AuditSeverity;
    description: string;
    actor?: Partial<AuditActor>;
    target?: AuditTarget;
    metadata?: Record<string, any>;
  }
): Promise<AuditLog | null> {
  if (!tenantId) return null;

  const id = `audit-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
  const timestamp = new Date().toISOString();

  const auditRecord: AuditLog = {
    id,
    tenantId,
    timestamp,
    action: entry.action,
    module: entry.module,
    severity: entry.severity || 'INFO',
    description: entry.description,
    actor: {
      userId: entry.actor?.userId || 'usr-system',
      name: entry.actor?.name || 'System / Admin',
      email: entry.actor?.email || 'admin@amaavigo.com',
      role: entry.actor?.role || 'ADMIN',
      ipAddress: entry.actor?.ipAddress || '127.0.0.1',
      userAgent: entry.actor?.userAgent || (typeof navigator !== 'undefined' ? navigator.userAgent : 'Server'),
    },
    target: entry.target,
    metadata: entry.metadata || {},
  };

  let persisted = false;
  try {
    const response = await fetch('/api/audit-logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(auditRecord),
    });
    if (!response.ok) throw new Error('Audit API returned HTTP ' + response.status);
    const result = await response.json();
    if (result && result.success === true) persisted = true;
    else throw new Error((result && result.error) || 'Audit API did not confirm persistence');
  } catch (err) {
    console.error('[AuditService] API write failed:', err);
  }

  if (!persisted && isFirebaseConfigured && db) {
    try {
      const colRef = collection(db, 'tenants', tenantId, 'audit_logs');
      await setDoc(doc(colRef, id), auditRecord);
      persisted = true;
    } catch (err) {
      console.error('[AuditService] Firestore write failed:', err);
    }
  }

  if (!persisted) {
    throw new Error('Audit event could not be saved. Check API and Firestore permissions.');
  }
  return auditRecord;
}

export function generateSampleAuditLogs(tenantId: string): AuditLog[] {
  const now = Date.now();
  const minute = 60 * 1000;
  const hour = 60 * minute;
  const day = 24 * hour;

  return [
    {
      id: 'audit-101',
      tenantId,
      timestamp: new Date(now - 5 * minute).toISOString(),
      action: 'TEMPLATE_EDIT_STRICT_HTML',
      module: 'CAMPAIGNS',
      severity: 'INFO',
      description: 'Updated template "Ramadan B2B Operator Outreach" strictly in HTML mode.',
      actor: {
        userId: 'usr-001',
        name: 'Parth (Sales)',
        email: 'sales@umrah360.in',
        role: 'ADMIN',
        ipAddress: '103.21.124.88',
      },
      target: {
        type: 'Template',
        id: 'tpl-ramadan-html',
        name: 'Ramadan B2B Operator Outreach',
      },
      metadata: {
        format: 'html',
        editorMode: 'HTML_STRICT_LOCKED',
        attachmentsCount: 1,
      },
    },
    {
      id: 'audit-102',
      tenantId,
      timestamp: new Date(now - 22 * minute).toISOString(),
      action: 'CAMPAIGN_RESTART_RUN',
      module: 'CAMPAIGNS',
      severity: 'INFO',
      description: 'Dispatched Follow-up Run #2 for campaign "Umrah Operators Outreach - Season 1448" to 5 unreplied leads.',
      actor: {
        userId: 'usr-001',
        name: 'Parth (Sales)',
        email: 'sales@umrah360.in',
        role: 'ADMIN',
        ipAddress: '103.21.124.88',
      },
      target: {
        type: 'Campaign',
        id: 'camp-1448-outreach',
        name: 'Umrah Operators Outreach - Season 1448',
      },
      metadata: {
        runNumber: 2,
        unrepliedLeadsCount: 5,
        skippedRepliedCount: 2,
      },
    },
    {
      id: 'audit-103',
      tenantId,
      timestamp: new Date(now - 45 * minute).toISOString(),
      action: 'LEAD_STATUS_UPDATE',
      module: 'CRM',
      severity: 'INFO',
      description: 'Marked lead "Tariq Al-Mansoor" (Al-Mansoor Hajj & Umrah) as DEMO_SCHEDULED.',
      actor: {
        userId: 'usr-002',
        name: 'Amaavigo Automation',
        email: 'automation@amaavigo.com',
        role: 'SPECIALIST',
        ipAddress: '182.72.10.15',
      },
      target: {
        type: 'Lead',
        id: 'lead-tariq-01',
        name: 'Tariq Al-Mansoor',
      },
      metadata: {
        previousStatus: 'NEW',
        newStatus: 'DEMO_SCHEDULED',
        leadScore: 92,
      },
    },
    {
      id: 'audit-104',
      tenantId,
      timestamp: new Date(now - 2 * hour).toISOString(),
      action: 'BRAND_ASSET_UPLOAD',
      module: 'SETTINGS',
      severity: 'INFO',
      description: 'Uploaded company asset "Amaavigo Official Logo.png" to Brand Assets.',
      actor: {
        userId: 'usr-001',
        name: 'Parth (Sales)',
        email: 'sales@umrah360.in',
        role: 'ADMIN',
        ipAddress: '103.21.124.88',
      },
      target: {
        type: 'Setting',
        id: 'asset-logo-01',
        name: 'Amaavigo Official Logo',
      },
      metadata: {
        category: 'LOGO',
        fileSize: '184 KB',
      },
    },
    {
      id: 'audit-105',
      tenantId,
      timestamp: new Date(now - 4 * hour).toISOString(),
      action: 'AI_AUTO_REPLY_DISPATCH',
      module: 'AI_ENGINE',
      severity: 'INFO',
      description: 'AI Personalization Engine auto-dispatched tailored walkthrough response to "Rashid Farooqui".',
      actor: {
        userId: 'usr-ai-agent',
        name: 'Umrah360 AI Assistant',
        email: 'ai-bot@umrah360.in',
        role: 'SPECIALIST',
        ipAddress: '10.0.4.12',
      },
      target: {
        type: 'Message',
        id: 'msg-ai-reply-99',
        name: 'Re: Umrah ERP Demo Inquiry',
      },
      metadata: {
        confidenceScore: 0.96,
        knowledgeSourcesUsed: ['Umrah360 Pricing & Features', 'Hotel Allotment Module'],
      },
    },
    {
      id: 'audit-106',
      tenantId,
      timestamp: new Date(now - 12 * hour).toISOString(),
      action: 'HUMAN_HANDOFF_TRIGGERED',
      module: 'INBOX',
      severity: 'WARNING',
      description: 'Human handoff triggered for thread "Zeeshan Malik" due to custom pricing inquiry.',
      actor: {
        userId: 'usr-ai-agent',
        name: 'Umrah360 AI Assistant',
        email: 'ai-bot@umrah360.in',
        role: 'SPECIALIST',
      },
      target: {
        type: 'Message',
        id: 'conv-zeeshan-01',
        name: 'Malik Pilgrimages UK Inquiry',
      },
      metadata: {
        handoffReason: 'CUSTOM_PRICING_REQUEST',
        triggerKeyword: 'discount rate',
      },
    },
    {
      id: 'audit-107',
      tenantId,
      timestamp: new Date(now - 1 * day).toISOString(),
      action: 'USER_LOGIN',
      module: 'AUTH',
      severity: 'INFO',
      description: 'User "automation@amaavigo.com" successfully authenticated via OAuth Google SSO.',
      actor: {
        userId: 'usr-002',
        name: 'Amaavigo Automation',
        email: 'automation@amaavigo.com',
        role: 'ADMIN',
        ipAddress: '182.72.10.15',
        userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)',
      },
      target: {
        type: 'User',
        id: 'usr-002',
        name: 'Amaavigo Automation',
      },
      metadata: {
        authMethod: 'GOOGLE_OAUTH_SSO',
      },
    },
    {
      id: 'audit-108',
      tenantId,
      timestamp: new Date(now - 2 * day).toISOString(),
      action: 'KNOWLEDGE_DOC_CREATE',
      module: 'KNOWLEDGE',
      severity: 'INFO',
      description: 'Added new knowledge article "Makkah & Madinah Hotel Allotment Workflow".',
      actor: {
        userId: 'usr-001',
        name: 'Parth (Sales)',
        email: 'sales@umrah360.in',
        role: 'ADMIN',
      },
      target: {
        type: 'KnowledgeDoc',
        id: 'kb-hotel-allotment',
        name: 'Makkah & Madinah Hotel Allotment Workflow',
      },
      metadata: {
        category: 'OPERATIONS',
        version: 1,
      },
    },
  ];
}
