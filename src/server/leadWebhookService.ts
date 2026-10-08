import crypto from 'node:crypto';
import { db, doc, getDoc } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import { isFirebaseConfigured } from '../firebase/config.js';

export interface CrmLeadWebhookConfig {
  webhookUrl: string;
  enabled: boolean;
  secret?: string;
  description?: string;
  lastTriggeredAt?: string;
  lastStatus?: number;
  lastStatusText?: string;
  lastError?: string;
  lastLeadName?: string;
  lastLeadCompany?: string;
  totalForwardedCount?: number;
  updatedAt?: string;
  updatedBy?: string;
}

export interface WebhookTestResult {
  success: boolean;
  statusCode: number;
  statusText: string;
  latencyMs: number;
  responseSnippet?: string;
  sentPayload: any;
  error?: string;
}

// In-memory cache for ultra-fast lookup and graceful offline/fallback support
const memoryWebhookConfigs = new Map<string, CrmLeadWebhookConfig>();

/**
 * Returns the tenant's CRM Outbound Lead Webhook configuration.
 * Unique for each client/tenant.
 */
export async function getCrmLeadWebhookConfig(tenantId: string): Promise<CrmLeadWebhookConfig> {
  const cleanTenant = (tenantId || 'umrah360').trim();

  // 1. Check in-memory cache first
  const cached = memoryWebhookConfigs.get(cleanTenant);

  // 2. Query Firestore if available
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'tenants', cleanTenant, 'settings', 'crm_lead_webhook'));
      if (snap && snap.exists()) {
        const data = snap.data() as CrmLeadWebhookConfig;
        const merged: CrmLeadWebhookConfig = {
          webhookUrl: data.webhookUrl || '',
          enabled: data.enabled ?? false,
          secret: data.secret || '',
          description: data.description || '',
          lastTriggeredAt: data.lastTriggeredAt,
          lastStatus: data.lastStatus,
          lastStatusText: data.lastStatusText,
          lastError: data.lastError,
          lastLeadName: data.lastLeadName,
          lastLeadCompany: data.lastLeadCompany,
          totalForwardedCount: data.totalForwardedCount || 0,
          updatedAt: data.updatedAt,
          updatedBy: data.updatedBy,
        };
        memoryWebhookConfigs.set(cleanTenant, merged);
        return merged;
      }
    } catch (err) {
      console.warn(`[Lead Webhook] Notice reading settings for ${cleanTenant}:`, err);
    }
  }

  // 3. Fallback to cached or empty default
  if (cached) return cached;

  const defaultCfg: CrmLeadWebhookConfig = {
    webhookUrl: '',
    enabled: false,
    secret: '',
    totalForwardedCount: 0,
  };
  memoryWebhookConfigs.set(cleanTenant, defaultCfg);
  return defaultCfg;
}

/**
 * Saves/updates the tenant's CRM Outbound Lead Webhook configuration.
 */
export async function saveCrmLeadWebhookConfig(
  tenantId: string,
  updates: Partial<CrmLeadWebhookConfig>,
  updatedBy?: string
): Promise<CrmLeadWebhookConfig> {
  const cleanTenant = (tenantId || 'umrah360').trim();
  const current = await getCrmLeadWebhookConfig(cleanTenant);

  let newUrl = current.webhookUrl;
  if (updates.webhookUrl !== undefined) {
    const trimmed = updates.webhookUrl.trim();
    if (trimmed) {
      try {
        const parsed = new URL(trimmed);
        if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
          throw new Error('Webhook URL must start with http:// or https://');
        }
        newUrl = trimmed;
      } catch (err: any) {
        throw new Error(err.message || 'Invalid webhook URL format');
      }
    } else {
      newUrl = '';
    }
  }

  const updatedConfig: CrmLeadWebhookConfig = {
    ...current,
    webhookUrl: newUrl,
    enabled: updates.enabled !== undefined ? Boolean(updates.enabled) : current.enabled,
    secret: updates.secret !== undefined ? updates.secret.trim() : (current.secret || ''),
    description: updates.description !== undefined ? updates.description.trim() : current.description,
    lastTriggeredAt: updates.lastTriggeredAt || current.lastTriggeredAt,
    lastStatus: updates.lastStatus !== undefined ? updates.lastStatus : current.lastStatus,
    lastStatusText: updates.lastStatusText || current.lastStatusText,
    lastError: updates.lastError !== undefined ? updates.lastError : current.lastError,
    lastLeadName: updates.lastLeadName || current.lastLeadName,
    lastLeadCompany: updates.lastLeadCompany || current.lastLeadCompany,
    totalForwardedCount: updates.totalForwardedCount !== undefined ? updates.totalForwardedCount : (current.totalForwardedCount || 0),
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy || current.updatedBy || 'admin',
  };

  memoryWebhookConfigs.set(cleanTenant, updatedConfig);

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(
        doc(db, 'tenants', cleanTenant, 'settings', 'crm_lead_webhook'),
        updatedConfig,
        { merge: true }
      );
    } catch (err) {
      console.warn(`[Lead Webhook] Notice saving settings for ${cleanTenant}:`, err);
    }
  }

  return updatedConfig;
}

/**
 * Builds a standardized payload representing a qualified lead for third-party CRMs.
 */
export function buildOutboundLeadPayload(tenantId: string, data: {
  lead: any;
  contact?: any;
  conversation?: any;
  source?: string;
  event?: string;
}) {
  const now = new Date().toISOString();
  const lead = data.lead || {};
  const contact = data.contact || {};

  return {
    event: data.event || 'lead.created',
    eventVersion: '1.0',
    timestamp: now,
    tenantId,
    lead: {
      leadId: lead.leadId || `lead-${Date.now()}`,
      source: lead.source || data.source || 'EMAIL',
      leadType: lead.leadType || 'INBOUND',
      status: lead.status || 'QUALIFIED',
      intent: lead.intent || 'HIGH',
      leadScore: lead.leadScore || 85,
      buyingStage: lead.buyingStage || 'ENGAGED',
      serviceInterest: lead.serviceInterest || 'General Inquiry',
      requirements: Array.isArray(lead.requirements) ? lead.requirements : [],
      budget: lead.budget || null,
      timeline: lead.timeline || null,
      aiSummary: lead.aiSummary || 'Qualified customer inquiry received via omnichannel pipeline.',
      createdAt: lead.createdAt || now,
      updatedAt: lead.updatedAt || now,
    },
    contact: {
      contactId: contact.contactId || lead.contactId || `cnt-${Date.now()}`,
      firstName: contact.firstName || 'Inquirer',
      lastName: contact.lastName || '',
      email: contact.email || '',
      phone: contact.phone || '',
      companyName: contact.companyName || `${contact.firstName || 'Client'}'s Agency`,
      jobTitle: contact.jobTitle || 'Director / Decision Maker',
      city: contact.city || lead.city || '',
      country: contact.country || lead.country || '',
    },
    meta: {
      forwardedFrom: 'AI Studio Omnichannel CRM',
      clientWorkspace: tenantId,
      dispatchedAt: now,
    },
  };
}

/**
 * Computes an optional HMAC-SHA256 signature for payload verification.
 */
function createSignature(payload: string, secret?: string): string {
  if (!secret) return '';
  return crypto.createHmac('sha256', secret).update(payload).digest('hex');
}

/**
 * Tests an external webhook URL with a sample lead payload.
 */
export async function testCrmLeadWebhook(
  tenantId: string,
  targetUrl: string,
  secret?: string
): Promise<WebhookTestResult> {
  const trimmedUrl = (targetUrl || '').trim();
  if (!trimmedUrl) {
    throw new Error('Please provide a webhook URL to test');
  }

  const sampleLead = {
    leadId: `lead-sample-${Date.now()}`,
    source: 'EMAIL',
    leadType: 'INBOUND',
    status: 'QUALIFIED',
    intent: 'HIGH',
    leadScore: 92,
    buyingStage: 'EVALUATING',
    serviceInterest: 'Custom B2B Pilgrimage Package & Portal Integration',
    requirements: ['Multi-currency bookings', '10 user seats', 'API CRM Sync'],
    aiSummary: 'Verified sample lead triggered from CRM Webhook Testing Console.',
    createdAt: new Date().toISOString(),
  };

  const sampleContact = {
    contactId: `cnt-sample-${Date.now()}`,
    firstName: 'Tariq',
    lastName: 'Al-Mansoor',
    email: 'tariq.mansoor@example-travels.com',
    phone: '+91 98201 12345',
    companyName: 'Al-Mansoor Holidays & Tours Pvt Ltd',
    jobTitle: 'Managing Director',
    city: 'Mumbai',
    country: 'India',
  };

  const payload = buildOutboundLeadPayload(tenantId, {
    lead: sampleLead,
    contact: sampleContact,
    source: 'TEST_DISPATCH',
    event: 'lead.test_ping',
  });

  const payloadString = JSON.stringify(payload, null, 2);
  const signature = createSignature(payloadString, secret);

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'User-Agent': 'AI-Studio-CRM-Outbound-Webhook/1.0',
    'X-Tenant-ID': tenantId,
    'X-Webhook-Event': 'lead.test_ping',
    'X-Webhook-Delivery': `del-${Date.now()}`,
  };

  if (secret) {
    headers['X-Webhook-Secret'] = secret;
    if (signature) headers['X-Signature-SHA256'] = signature;
  }

  const startTime = Date.now();
  try {
    const res = await fetch(trimmedUrl, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: AbortSignal.timeout(10000), // 10s timeout
    });

    const latencyMs = Date.now() - startTime;
    let snippet = '';
    try {
      const text = await res.text();
      snippet = text.slice(0, 500);
    } catch {}

    const isOk = res.status >= 200 && res.status < 300;

    // Record last status
    await saveCrmLeadWebhookConfig(tenantId, {
      lastTriggeredAt: new Date().toISOString(),
      lastStatus: res.status,
      lastStatusText: res.statusText || (isOk ? 'OK' : 'Error'),
      lastError: isOk ? undefined : `HTTP ${res.status}: ${snippet || res.statusText}`,
      lastLeadName: `${sampleContact.firstName} ${sampleContact.lastName}`,
      lastLeadCompany: sampleContact.companyName,
    }).catch(() => {});

    return {
      success: isOk,
      statusCode: res.status,
      statusText: res.statusText || (isOk ? 'OK' : 'Failed'),
      latencyMs,
      responseSnippet: snippet,
      sentPayload: payload,
      error: isOk ? undefined : `Server returned status code ${res.status}`,
    };
  } catch (err: any) {
    const latencyMs = Date.now() - startTime;
    const errorMsg = err?.message || 'Connection failed or timed out';

    await saveCrmLeadWebhookConfig(tenantId, {
      lastTriggeredAt: new Date().toISOString(),
      lastStatus: 0,
      lastStatusText: 'Failed',
      lastError: errorMsg,
      lastLeadName: `${sampleContact.firstName} ${sampleContact.lastName}`,
      lastLeadCompany: sampleContact.companyName,
    }).catch(() => {});

    return {
      success: false,
      statusCode: 0,
      statusText: 'Connection Error',
      latencyMs,
      sentPayload: payload,
      error: errorMsg,
    };
  }
}

/**
 * Forwards a real lead to the tenant's configured outbound webhook.
 * Non-blocking, fails gracefully without breaking the primary CRM flow.
 */
export async function dispatchLeadToExternalWebhook(
  tenantId: string,
  data: {
    lead: any;
    contact?: any;
    conversation?: any;
    source?: string;
    event?: string;
  }
): Promise<{ success: boolean; attempted: boolean; error?: string }> {
  const cleanTenant = (tenantId || 'umrah360').trim();

  try {
    const config = await getCrmLeadWebhookConfig(cleanTenant);
    if (!config.enabled || !config.webhookUrl) {
      return { success: false, attempted: false };
    }

    const payload = buildOutboundLeadPayload(cleanTenant, data);
    const payloadString = JSON.stringify(payload);
    const signature = createSignature(payloadString, config.secret);

    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'User-Agent': 'AI-Studio-CRM-Outbound-Webhook/1.0',
      'X-Tenant-ID': cleanTenant,
      'X-Webhook-Event': data.event || 'lead.created',
      'X-Webhook-Delivery': `del-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    };

    if (config.secret) {
      headers['X-Webhook-Secret'] = config.secret;
      if (signature) headers['X-Signature-SHA256'] = signature;
    }

    const contactName = `${data.contact?.firstName || ''} ${data.contact?.lastName || ''}`.trim() || 'Qualified Lead';
    const company = data.contact?.companyName || data.lead?.companyName || 'Agency Prospect';

    const res = await fetch(config.webhookUrl, {
      method: 'POST',
      headers,
      body: payloadString,
      signal: AbortSignal.timeout(10000),
    });

    const isOk = res.status >= 200 && res.status < 300;
    let snippet = '';
    try {
      const text = await res.text();
      snippet = text.slice(0, 300);
    } catch {}

    const newCount = (config.totalForwardedCount || 0) + (isOk ? 1 : 0);

    await saveCrmLeadWebhookConfig(cleanTenant, {
      lastTriggeredAt: new Date().toISOString(),
      lastStatus: res.status,
      lastStatusText: res.statusText || (isOk ? 'OK' : 'Error'),
      lastError: isOk ? undefined : `HTTP ${res.status}: ${snippet || res.statusText}`,
      lastLeadName: contactName,
      lastLeadCompany: company,
      totalForwardedCount: newCount,
    });

    console.log(
      `[CRM Outbound Webhook] Dispatched lead "${contactName}" (${data.lead?.leadId}) to ${config.webhookUrl} for tenant ${cleanTenant}. Status: ${res.status}`
    );

    return { success: isOk, attempted: true };
  } catch (err: any) {
    console.warn(`[CRM Outbound Webhook] Notice forwarding lead for ${cleanTenant}:`, err?.message || err);
    return { success: false, attempted: true, error: err?.message };
  }
}
