import {
  collection,
  doc,
  CollectionReference,
  DocumentReference,
  DocumentData,
} from 'firebase/firestore';
import { db } from '../firebase/config.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Validates that tenantId is valid and safe
 */
export function assertValidTenantId(tenantId: string): string {
  if (!tenantId || typeof tenantId !== 'string') {
    throw new Error('Tenant isolation violation: tenantId is missing or invalid');
  }
  const clean = tenantId.trim();
  if (clean.length === 0 || clean.includes('/') || clean.includes('..')) {
    throw new Error(`Tenant isolation violation: invalid tenantId "${tenantId}"`);
  }
  return clean;
}

/**
 * Tenant Repository: Strictly scopes all Firestore operations under `tenants/{tenantId}/...`
 */
export function tenantRepo(ctx: TenantContext) {
  const tenantId = assertValidTenantId(ctx.tenantId);
  const tenantDocPath = `tenants/${tenantId}`;

  return {
    ctx,
    tenantId,
    tenantDoc: () => doc(db, tenantDocPath),

    // Subcollections scoped under tenant
    contacts: () => collection(db, `${tenantDocPath}/contacts`),
    contactDoc: (id: string) => doc(db, `${tenantDocPath}/contacts`, id),

    leads: () => collection(db, `${tenantDocPath}/leads`),
    leadDoc: (id: string) => doc(db, `${tenantDocPath}/leads`, id),

    conversations: () => collection(db, `${tenantDocPath}/conversations`),
    conversationDoc: (id: string) => doc(db, `${tenantDocPath}/conversations`, id),

    // Messages can be stored directly under tenant messages or in conversation subcollection
    messages: (conversationId?: string) =>
      conversationId
        ? collection(db, `${tenantDocPath}/conversations/${conversationId}/messages`)
        : collection(db, `${tenantDocPath}/messages`),
    messageDoc: (messageId: string, conversationId?: string) =>
      conversationId
        ? doc(db, `${tenantDocPath}/conversations/${conversationId}/messages`, messageId)
        : doc(db, `${tenantDocPath}/messages`, messageId),

    campaigns: () => collection(db, `${tenantDocPath}/campaigns`),
    campaignDoc: (id: string) => doc(db, `${tenantDocPath}/campaigns`, id),

    campaignLeads: () => collection(db, `${tenantDocPath}/campaign_leads`),
    campaignLeadDoc: (id: string) => doc(db, `${tenantDocPath}/campaign_leads`, id),

    campaignRuns: () => collection(db, `${tenantDocPath}/campaign_runs`),
    campaignRunDoc: (id: string) => doc(db, `${tenantDocPath}/campaign_runs`, id),

    campaignSendHistory: () => collection(db, `${tenantDocPath}/campaign_send_history`),
    campaignSendHistoryDoc: (id: string) => doc(db, `${tenantDocPath}/campaign_send_history`, id),

    emailTemplates: () => collection(db, `${tenantDocPath}/email_templates`),
    emailTemplateDoc: (id: string) => doc(db, `${tenantDocPath}/email_templates`, id),

    knowledgeDocuments: () => collection(db, `${tenantDocPath}/knowledge_documents`),
    knowledgeDocumentDoc: (id: string) => doc(db, `${tenantDocPath}/knowledge_documents`, id),

    bookings: () => collection(db, `${tenantDocPath}/bookings`),
    bookingDoc: (id: string) => doc(db, `${tenantDocPath}/bookings`, id),

    leadActivities: () => collection(db, `${tenantDocPath}/lead_activities`),
    leadActivityDoc: (id: string) => doc(db, `${tenantDocPath}/lead_activities`, id),

    outboundProspects: () => collection(db, `${tenantDocPath}/outbound_prospects`),
    outboundProspectDoc: (id: string) => doc(db, `${tenantDocPath}/outbound_prospects`, id),

    outboundCampaigns: () => collection(db, `${tenantDocPath}/outbound_campaigns`),
    outboundCampaignDoc: (id: string) => doc(db, `${tenantDocPath}/outbound_campaigns`, id),

    processedInboundEmails: () => collection(db, `${tenantDocPath}/processed_inbound_emails`),
    processedInboundEmailDoc: (id: string) => doc(db, `${tenantDocPath}/processed_inbound_emails`, id),

    websiteLeadThankYouHistory: () => collection(db, `${tenantDocPath}/website_lead_thankyou_history`),
    websiteLeadThankYouHistoryDoc: (id: string) => doc(db, `${tenantDocPath}/website_lead_thankyou_history`, id),

    suppressions: () => collection(db, `${tenantDocPath}/suppressions`),
    suppressionDoc: (email: string) => doc(db, `${tenantDocPath}/suppressions`, email.toLowerCase().trim()),

    usageCol: () => collection(db, `${tenantDocPath}/usage`),
    usageDoc: (month: string) => doc(db, `${tenantDocPath}/usage`, month),

    auditLogs: () => collection(db, `${tenantDocPath}/audit_logs`),
    auditLogDoc: (id: string) => doc(db, `${tenantDocPath}/audit_logs`, id),

    jobs: () => collection(db, `${tenantDocPath}/jobs`),
    jobDoc: (jobName: string) => doc(db, `${tenantDocPath}/jobs`, jobName),

    settingsCol: () => collection(db, `${tenantDocPath}/settings`),
    settingsDoc: (docName: string) => doc(db, `${tenantDocPath}/settings`, docName),

    integrationsCol: () => collection(db, `${tenantDocPath}/integrations`),
    integrationDoc: (name: string) => doc(db, `${tenantDocPath}/integrations`, name),

    // Secrets (deny-all for clients, accessible only by server)
    secretsCol: () => collection(db, `${tenantDocPath}/secrets`),
    secretDoc: (name: string) => doc(db, `${tenantDocPath}/secrets`, name),

    // Generic scoped accessor
    collection: (colName: string) => collection(db, `${tenantDocPath}/${colName}`),
    doc: (colName: string, docId: string) => doc(db, `${tenantDocPath}/${colName}`, docId),
  };
}

export type TenantRepository = ReturnType<typeof tenantRepo>;

// =========================================================================
// EXPLICIT GLOBAL ROUTING HELPERS (Allowed outside tenantRepo)
// =========================================================================

export function globalTenantsCol(): CollectionReference<DocumentData> {
  return collection(db, 'tenants');
}

export function globalTenantDoc(tenantId: string): DocumentReference<DocumentData> {
  return doc(db, 'tenants', assertValidTenantId(tenantId));
}

export function globalUsersCol(): CollectionReference<DocumentData> {
  return collection(db, 'users');
}

export function globalUserDoc(uid: string): DocumentReference<DocumentData> {
  return doc(db, 'users', uid);
}

export function globalWebhookRoutesCol(): CollectionReference<DocumentData> {
  return collection(db, 'webhook_routes');
}

export function globalWebhookRouteDoc(webhookId: string): DocumentReference<DocumentData> {
  return doc(db, 'webhook_routes', webhookId);
}

export function globalChannelRoutesCol(): CollectionReference<DocumentData> {
  return collection(db, 'channel_routes');
}

export function globalChannelRouteDoc(phoneNumberId: string): DocumentReference<DocumentData> {
  return doc(db, 'channel_routes', phoneNumberId);
}

export function globalDomainRoutesCol(): CollectionReference<DocumentData> {
  return collection(db, 'domain_routes');
}

export function globalDomainRouteDoc(domain: string): DocumentReference<DocumentData> {
  return doc(db, 'domain_routes', domain.toLowerCase().trim());
}

export function globalEmailRoutesCol(): CollectionReference<DocumentData> {
  return collection(db, 'email_routes');
}

export function globalEmailRouteDoc(resendEmailId: string): DocumentReference<DocumentData> {
  return doc(db, 'email_routes', resendEmailId);
}
