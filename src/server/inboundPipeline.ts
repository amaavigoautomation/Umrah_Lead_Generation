import { AsyncLocalStorage } from 'node:async_hooks';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

let activeInboundCtx: TenantContext = DEFAULT_UMRAH_CTX;
export function setInboundActiveContext(ctx: TenantContext) {
  activeInboundCtx = ctx;
}
// Per-call tenant scope. Work started with runWithInboundCtx() always sees its own tenant, even if
// another request changes the global active context while it is awaiting.
const inboundCtxStore = new AsyncLocalStorage<TenantContext>();
export function runWithInboundCtx<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return inboundCtxStore.run(ctx, fn);
}
function getInboundCtx(): TenantContext {
  return inboundCtxStore.getStore() ?? activeInboundCtx;
}

/**
 * The shared IMAP mailbox (IMAP_* / SMTP_* env) belongs to exactly one workspace. Until per-workspace
 * mailboxes exist, only that workspace may poll it, read its results or change its settings.
 */
export function getImapOwnerTenantId(): string {
  return (process.env.IMAP_OWNER_TENANT_ID || 'umrah360').trim();
}
import OpenAI from 'openai';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sendLiveEmail, SendMailResult, getSmtpConfig } from './smtpService.js';
import { pollUnreadEmails, FetchedInboundEmail } from './imapService.js';
import { getPublishedKnowledgeDocs, initKnowledgeStore } from './knowledgeService.js';
import {
  initPersistentIdempotencyStore,
  isMessageAlreadyProcessed,
  recordProcessedInboundEmail,
  normalizeIdentifier,
} from './firestorePersistence.js';
import { handleIncomingCampaignLeadReply, runWithCampaignCtx } from './campaignService.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  limit,
  orderBy,
  query,
  where,
} from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import {
  detectDemoSchedulingIntent,
  processSchedulingConversationTurn,
} from './demoSchedulingService.js';
import { getTenantBrand } from './brandService.js';
import { classifyInboundMessage } from './messageClassifier.js';
import { brandAutomationSignature, brandIntro, brandFallbackAgency } from '../shared/brand.js';
import { sanitizeAiEmailText } from './emailSanitizer.js';

export interface ProcessedMessageRecord {
  gmailMessageId: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'PROSPECT' | 'AI' | 'AGENT';
  aiReplied: boolean;
  repliedAt?: string;
  repliedByMessageId?: string;
  firstSeenAt: string;
  subject?: string;
  from?: string;
}

export interface InboundCrmEntities {
  contact: {
    contactId: string;
    firstName: string;
    lastName: string;
    email: string;
    companyName: string;
    phone?: string;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
  };
  lead: {
    leadId: string;
    contactId: string;
    source: 'EMAIL';
    leadType: 'INBOUND';
    status: string;
    leadScore: number;
    intent: 'HIGH' | 'MEDIUM';
    buyingStage: string;
    serviceInterest: string;
    requirements: string[];
    aiSummary: string;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
  };
  conversation: {
    conversationId: string;
    contactId: string;
    leadId: string;
    channel: 'EMAIL';
    direction: 'INBOUND' | 'OUTBOUND';
    status: 'ACTIVE' | 'REVIEW';
    aiEnabled: boolean;
    humanHandoff: boolean;
    managementMode?: string;
    emailThreadId: string;
    gmailThreadId?: string;
    isRead?: boolean;
    readAt?: string;
    unread?: boolean;
    conversationSummary: string;
    startedAt: string;
    lastMessageAt: string;
    lastMessageText: string;
    unreadCount: number;
    draftReply?: any;
    createdAt: string;
    updatedAt: string;
  };
  incomingMessage: {
    messageId: string;
    gmailMessageId?: string;
    conversationId: string;
    channel: 'EMAIL';
    direction?: 'INBOUND' | 'OUTBOUND';
    senderType: 'CUSTOMER' | 'PROSPECT' | 'AGENT' | 'AI';
    senderName: string;
    senderEmail: string;
    text: string;
    timestamp: string;
    aiReplied?: boolean;
    repliedAt?: string;
    repliedByMessageId?: string;
    emailMeta: {
      subject: string;
      from: string;
      to: string;
      messageId: string;
      inReplyTo?: string;
    };
  };
  aiReplyMessage?: {
    messageId: string;
    gmailMessageId?: string;
    conversationId: string;
    channel: 'EMAIL';
    direction?: 'OUTBOUND';
    senderType: 'AI';
    senderName: string;
    senderEmail: string;
    text: string;
    timestamp: string;
    aiProcessed: boolean;
    aiGenerated: boolean;
    confidence: number;
    emailMeta: {
      subject: string;
      from: string;
      to: string;
      inReplyTo: string;
      messageId: string;
    };
  };
  allThreadMessages?: any[];
  activity: {
    activityId: string;
    leadId: string;
    contactId: string;
    type: string;
    title: string;
    description: string;
    timestamp: string;
  };
}

export interface ProcessedInboundEmailResult {
  messageId: string;
  from: string;
  fromName: string;
  to: string;
  subject: string;
  incomingText: string;
  replySubject: string;
  replyText: string;
  shouldSendAutoReply: boolean;
  replyDecisionReason: string;
  smtpDelivery: SendMailResult;
  handoffTriggered: boolean;
  handoffReason?: string;
  leadScore: number;
  intent: string;
  buyingStage: string;
  timestamp: string;
  tenantId?: string;
  crmEntities: InboundCrmEntities;
}

export interface ConversationTurnState {
  email: string;
  lastIncomingMessageId: string;
  lastIncomingText: string;
  lastRepliedMessageId?: string;
  replyCountForThisTurn: number;
  waitingForCustomerReply: boolean;
  lastAutoReplyTimestamp?: string;
  updatedAt: string;
}

// In-memory buffer of recently processed live emails for live dashboard inspectability
const recentProcessedEmails: ProcessedInboundEmailResult[] = [];

// Persistent in-memory thread storage keyed by conversationId
const conversationThreadMessagesMap = new Map<string, any[]>();

// Deduplication: Tracks individual message IDs that have already been responded to
const repliedMessageIds = new Set<string>();

// Conversation Turn tracker: Only reply ONCE per customer email turn, until customer replies again!
const conversationTurnMap = new Map<string, ConversationTurnState>();

// =========================================================================
// PERSISTENT GMAIL IDEMPOTENCY STORE (In-Memory + Firestore)
// =========================================================================
const processedRecordsMap = new Map<string, ProcessedMessageRecord>();
const inFlightMessageIds = new Set<string>();

// Pre-seed known historical messages to prevent re-replying on first start
const INITIAL_PROCESSED_SEEDS: ProcessedMessageRecord[] = [
  {
    gmailMessageId: '<cold-msg-001@umrah360.in>',
    direction: 'OUTBOUND',
    senderType: 'AGENT',
    aiReplied: false,
    firstSeenAt: '2026-09-12T10:20:00Z',
    subject: 'Umrah360 for ABC Travels - Automate B2B Packages & Visa Operations',
    from: 'sales@umrah360.in',
  },
  {
    gmailMessageId: '<rahul-reply-001@abctravels.in>',
    direction: 'INBOUND',
    senderType: 'PROSPECT',
    aiReplied: true,
    repliedAt: '2026-09-12T14:18:00Z',
    repliedByMessageId: '<ai-reply-001@umrah360.in>',
    firstSeenAt: '2026-09-12T14:15:00Z',
    subject: 'Re: Umrah360 for ABC Travels - Automate B2B Packages & Visa Operations',
    from: 'rahul@abctravels.in',
  },
  {
    gmailMessageId: '<ai-reply-001@umrah360.in>',
    direction: 'OUTBOUND',
    senderType: 'AI',
    aiReplied: false,
    firstSeenAt: '2026-09-12T14:18:00Z',
    subject: 'Re: Umrah360 for ABC Travels - Automate B2B Packages & Visa Operations',
    from: 'sales@umrah360.in',
  },
  {
    gmailMessageId: '<rahul-reply-002@abctravels.in>',
    direction: 'INBOUND',
    senderType: 'PROSPECT',
    aiReplied: true,
    repliedAt: '2026-09-13T11:12:00Z',
    repliedByMessageId: '<ai-reply-002@umrah360.in>',
    firstSeenAt: '2026-09-13T11:10:00Z',
    subject: 'Re: Umrah360 for ABC Travels - Automate B2B Packages & Visa Operations',
    from: 'rahul@abctravels.in',
  },
  {
    gmailMessageId: '<ai-reply-002@umrah360.in>',
    direction: 'OUTBOUND',
    senderType: 'AI',
    aiReplied: false,
    firstSeenAt: '2026-09-13T11:12:00Z',
    subject: 'Re: Umrah360 for ABC Travels - Automate B2B Packages & Visa Operations',
    from: 'sales@umrah360.in',
  },
  {
    gmailMessageId: '<farhan-inquiry-001@malikpilgrimages.co.uk>',
    direction: 'INBOUND',
    senderType: 'CUSTOMER',
    aiReplied: true,
    repliedAt: '2026-09-15T08:05:00Z',
    repliedByMessageId: '<concierge-reply-001@umrah360.in>',
    firstSeenAt: '2026-09-15T07:30:00Z',
    subject: 'Inquiry: ATOL Compliance & Haramain Rail Booking API',
    from: 'farhan@malikpilgrimages.co.uk',
  },
  {
    gmailMessageId: '<concierge-reply-001@umrah360.in>',
    direction: 'OUTBOUND',
    senderType: 'AGENT',
    aiReplied: false,
    firstSeenAt: '2026-09-15T08:05:00Z',
    subject: 'Re: Inquiry: ATOL Compliance & Haramain Rail Booking API',
    from: 'sales@umrah360.in',
  },
];

// Initialize map with seed records
for (const seed of INITIAL_PROCESSED_SEEDS) {
  processedRecordsMap.set(seed.gmailMessageId, seed);
  if (seed.aiReplied) {
    repliedMessageIds.add(seed.gmailMessageId);
  }
}

// Background sync from persistent Firestore ledger on module startup
initPersistentIdempotencyStore().then((stats) => {
  console.log(`[Inbound Pipeline] Idempotency store initialized with ${stats.totalLoaded} records (${stats.repliedCount} replied) from Firestore.`);
}).catch((err) => {
  console.warn('[Inbound Pipeline] Notice initializing Firestore idempotency store:', err);
});

export function recordProcessedMessage(record: ProcessedMessageRecord): void {
  const existing = processedRecordsMap.get(record.gmailMessageId);
  processedRecordsMap.set(record.gmailMessageId, {
    ...existing,
    ...record,
  });
  if (record.aiReplied) {
    repliedMessageIds.add(record.gmailMessageId);
  }

  // Persist to Firestore so server restarts / version restores retain idempotency
  recordProcessedInboundEmail({
    messageId: record.gmailMessageId,
    fromEmail: record.from || 'unknown@prospect.com',
    subject: record.subject || '',
    aiReplied: Boolean(record.aiReplied),
    replyMessageId: record.repliedByMessageId,
    status: record.aiReplied ? 'REPLIED' : 'PROCESSED',
    reason: record.aiReplied ? 'AI auto-reply dispatched' : 'Inbound email processed',
    timestamp: record.firstSeenAt || new Date().toISOString(),
  }, getInboundCtx()).catch((e) => console.warn('[Idempotency Store] Firestore record error:', e));
}

export function getProcessedMessageRecord(gmailMessageId: string): ProcessedMessageRecord | undefined {
  if (!gmailMessageId) return undefined;
  return processedRecordsMap.get(gmailMessageId.trim());
}

export function markMessageAsReplied(gmailMessageId: string, replyMessageId?: string): void {
  if (!gmailMessageId) return;
  const cleanId = gmailMessageId.trim();
  const existing = processedRecordsMap.get(cleanId);
  const nowIso = new Date().toISOString();
  processedRecordsMap.set(cleanId, {
    gmailMessageId: cleanId,
    direction: existing?.direction || 'INBOUND',
    senderType: existing?.senderType || 'CUSTOMER',
    aiReplied: true,
    repliedAt: nowIso,
    repliedByMessageId: replyMessageId,
    firstSeenAt: existing?.firstSeenAt || nowIso,
    subject: existing?.subject,
    from: existing?.from,
  });
  repliedMessageIds.add(cleanId);
  if (replyMessageId) {
    const cleanReplyId = replyMessageId.trim();
    repliedMessageIds.add(cleanReplyId);
    processedRecordsMap.set(cleanReplyId, {
      gmailMessageId: cleanReplyId,
      direction: 'OUTBOUND',
      senderType: 'AI',
      aiReplied: false,
      firstSeenAt: nowIso,
    });
  }

  // Persist to Firestore immediately
  recordProcessedInboundEmail({
    messageId: cleanId,
    fromEmail: existing?.from || 'unknown@prospect.com',
    subject: existing?.subject || '',
    aiReplied: true,
    replyMessageId,
    status: 'REPLIED',
    reason: 'AI auto-reply dispatched via SMTP',
    timestamp: nowIso,
  }, getInboundCtx()).catch((e) => console.warn('[Idempotency Store] Firestore markMessageAsReplied error:', e));
}

export function isGmailMessageReplied(gmailMessageId: string): boolean {
  if (!gmailMessageId) return false;
  const cleanId = gmailMessageId.trim();
  const record = processedRecordsMap.get(cleanId);
  if (record && record.direction === 'INBOUND' && (record.senderType === 'CUSTOMER' || record.senderType === 'PROSPECT') && record.aiReplied) {
    return true;
  }
  return repliedMessageIds.has(cleanId);
}

export function resolveGmailMessageId(payload: {
  messageId?: string;
  gmailMessageId?: string;
  id?: string;
  from?: string;
  to?: string;
  subject?: string;
  body?: string;
}, targetMailbox: string): string {
  const candidate = payload.gmailMessageId || payload.messageId || payload.id;
  if (candidate && typeof candidate === 'string' && candidate.trim().length > 0) {
    return candidate.trim();
  }
  // Deterministic fallback hash: identical email payloads will ALWAYS produce the exact same ID
  const domain = targetMailbox.includes('@') ? targetMailbox.split('@')[1] : 'amaavigo.com';
  const cleanFrom = (payload.from || '').toLowerCase().trim();
  const cleanSubj = (payload.subject || '').toLowerCase().trim();
  const cleanBody = (payload.body || '').trim().slice(0, 300);
  const hash = crypto.createHash('sha256').update(`${cleanFrom}|${cleanSubj}|${cleanBody}`).digest('hex').slice(0, 16);
  return `<msg-hash-${hash}@${domain}>`;
}

export interface PipelineConfig {
  emailMode: 'AUTO' | 'REVIEW' | 'SIMULATION';
  sendingAccount: string;
  emailSignature: string;
}

const pipelineConfig: PipelineConfig = {
  emailMode: 'AUTO',
  sendingAccount: process.env.SMTP_USER || process.env.IMAP_USER || 'amaavigo@gmail.com',
  emailSignature: 'Regards,\nUmrah360 Automation Team\nwww.umrah360.in',
};

export function getPipelineConfig(): PipelineConfig {
  return { ...pipelineConfig };
}

export function updatePipelineConfig(newConfig: Partial<PipelineConfig>): PipelineConfig {
  Object.assign(pipelineConfig, newConfig);
  console.log('[InboundPipeline] Updated runtime pipeline config:', pipelineConfig);
  return { ...pipelineConfig };
}

const conversationHumanHandoffMap = new Map<string, boolean>();
const conversationAiStateMap = new Map<string, boolean>();

export function setConversationAiState(conversationId: string, aiEnabled: boolean, humanHandoff: boolean): void {
  conversationAiStateMap.set(conversationId, aiEnabled);
  conversationHumanHandoffMap.set(conversationId, humanHandoff);
  console.log(`[Human Takeover State] Updated conversation ${conversationId}: aiEnabled=${aiEnabled}, humanHandoff=${humanHandoff}`);
}

export function isConversationHumanManaged(conversationId: string): boolean {
  return conversationHumanHandoffMap.get(conversationId) === true || conversationAiStateMap.get(conversationId) === false;
}

export function appendOutboundMessageToThread(conversationId: string, message: any): any[] {
  let thread = conversationThreadMessagesMap.get(conversationId);
  if (!thread) {
    thread = [];
    conversationThreadMessagesMap.set(conversationId, thread);
  }
  
  // Deduplicate strictly by gmailMessageId or messageId or matching content/direction
  const existingIdx = thread.findIndex(m => {
    if (message.messageId && m.messageId === message.messageId) return true;
    if (message.gmailMessageId && m.gmailMessageId === message.gmailMessageId && !m.gmailMessageId.startsWith('<out-')) return true;
    if (m.direction === 'OUTBOUND' && message.direction === 'OUTBOUND' && m.text === message.text && Math.abs(new Date(m.timestamp).getTime() - new Date(message.timestamp).getTime()) < 15000) return true;
    return false;
  });

  if (existingIdx >= 0) {
    thread[existingIdx] = { ...thread[existingIdx], ...message };
  } else {
    thread.push(message);
  }

  if (message.gmailMessageId && !message.gmailMessageId.startsWith('<out-')) {
    repliedMessageIds.add(message.gmailMessageId);
  }
  return [...thread];
}

export function getRecentProcessedEmails(tenantId?: string): ProcessedInboundEmailResult[] {
  return tenantId ? recentProcessedEmails.filter((r) => r.tenantId === tenantId) : [...recentProcessedEmails];
}

function conversationIdsForTenant(tenantId: string): Set<string> {
  const ids = new Set<string>();
  for (const r of recentProcessedEmails) {
    if (r.tenantId === tenantId && r.crmEntities?.conversation?.conversationId) ids.add(r.crmEntities.conversation.conversationId);
  }
  return ids;
}

export function getConversationTurnStates(tenantId?: string): Record<string, ConversationTurnState> {
  const result: Record<string, ConversationTurnState> = {};
  const allowed = tenantId ? conversationIdsForTenant(tenantId) : null;
  for (const [k, v] of conversationTurnMap.entries()) {
    if (allowed && !allowed.has(k)) continue;
    result[k] = v;
  }
  return result;
}

export function getThreadMessages(conversationId: string): any[] {
  return [...(conversationThreadMessagesMap.get(conversationId) || [])];
}

export function getAllThreadMessages(tenantId?: string): Record<string, any[]> {
  const result: Record<string, any[]> = {};
  const allowed = tenantId ? conversationIdsForTenant(tenantId) : null;
  for (const [k, v] of conversationThreadMessagesMap.entries()) {
    if (allowed && !allowed.has(k)) continue;
    result[k] = [...v];
  }
  return result;
}

export interface MatchedConversationContext {
  conversationId: string;
  contactId: string;
  leadId: string;
  threadId: string;
  conversation?: any;
  contact?: any;
  lead?: any;
  isExisting: boolean;
  matchedBy: 'inReplyTo' | 'references' | 'customerEmail' | 'contactEmail' | 'subject' | 'memory' | 'new';
}

/**
 * Resolves whether an incoming email is a reply to an existing conversation
 * (such as a website demo request thank-you email, prior outbound email, or ongoing thread).
 * Checks In-Reply-To / References headers, Firestore message records, conversation customer emails,
 * contact records, and in-memory threads so replies continue in the SAME thread instead of creating a new chat.
 */
export async function findExistingConversationForInboundEmail(params: {
  senderEmail: string;
  inReplyTo?: string;
  references?: string[] | string;
  subject?: string;
  companyName?: string;
}): Promise<MatchedConversationContext> {
  const cleanEmail = (params.senderEmail || '').toLowerCase().trim();
  const safeId = cleanEmail.replace(/[^a-z0-9]/gi, '_') || `lead_${Date.now()}`;

  // Gather all candidate message IDs from In-Reply-To and References
  const candidateIds = new Set<string>();
  if (params.inReplyTo && params.inReplyTo.trim()) {
    const raw = params.inReplyTo.trim();
    candidateIds.add(raw);
    const unbracketed = raw.replace(/^<|>$/g, '').trim();
    if (unbracketed) candidateIds.add(unbracketed);
    candidateIds.add(`<${unbracketed}>`);
  }

  if (params.references) {
    const rawRefs = Array.isArray(params.references)
      ? params.references
      : typeof params.references === 'string'
      ? params.references.split(/\s+/)
      : [];
    for (const ref of rawRefs) {
      if (typeof ref === 'string' && ref.trim()) {
        const r = ref.trim();
        candidateIds.add(r);
        const unb = r.replace(/^<|>$/g, '').trim();
        if (unb) {
          candidateIds.add(unb);
          candidateIds.add(`<${unb}>`);
        }
      }
    }
  }

  let matchedConvId: string | null = null;
  let matchedBy: MatchedConversationContext['matchedBy'] = 'new';

  // 1. In-memory check by candidate message IDs across active threads
  if (candidateIds.size > 0) {
    for (const [cId, msgs] of conversationThreadMessagesMap.entries()) {
      const found = msgs.some((m: any) => {
        if (!m) return false;
        return (
          (m.smtpMessageId && candidateIds.has(m.smtpMessageId)) ||
          (m.gmailMessageId && candidateIds.has(m.gmailMessageId)) ||
          (m.messageId && candidateIds.has(m.messageId)) ||
          (m.emailMeta?.messageId && candidateIds.has(m.emailMeta.messageId)) ||
          (m.emailMeta?.inReplyTo && candidateIds.has(m.emailMeta.inReplyTo))
        );
      });
      if (found) {
        matchedConvId = cId;
        matchedBy = 'inReplyTo';
        console.log(`[Thread Matcher] In-memory match found by In-Reply-To/References for conversation ${cId}`);
        break;
      }
    }
  }

  // 2. Firestore query by candidate message IDs (smtpMessageId / thankYouSmtpMessageId)
  if (!matchedConvId && isFirebaseConfigured && db && candidateIds.size > 0) {
    try {
      for (const candId of Array.from(candidateIds)) {
        if (!candId) continue;

        // Check messages collection for smtpMessageId
        const msgSnap = await getDocs(
          query(tenantRepo(getInboundCtx()).messages(), where('smtpMessageId', '==', candId), limit(1))
        );
        if (!msgSnap.empty) {
          const docData = msgSnap.docs[0].data();
          if (docData?.conversationId) {
            matchedConvId = docData.conversationId;
            matchedBy = 'inReplyTo';
            console.log(`[Thread Matcher] Firestore message smtpMessageId match found: ${matchedConvId}`);
            break;
          }
        }

        // Check messages collection for gmailMessageId
        const gmailSnap = await getDocs(
          query(tenantRepo(getInboundCtx()).messages(), where('gmailMessageId', '==', candId), limit(1))
        );
        if (!gmailSnap.empty) {
          const docData = gmailSnap.docs[0].data();
          if (docData?.conversationId) {
            matchedConvId = docData.conversationId;
            matchedBy = 'inReplyTo';
            console.log(`[Thread Matcher] Firestore message gmailMessageId match found: ${matchedConvId}`);
            break;
          }
        }

        // Check conversations collection for thankYouSmtpMessageId
        const convSnap = await getDocs(
          query(tenantRepo(getInboundCtx()).conversations(), where('thankYouSmtpMessageId', '==', candId), limit(1))
        );
        if (!convSnap.empty) {
          matchedConvId = convSnap.docs[0].id;
          matchedBy = 'inReplyTo';
          console.log(`[Thread Matcher] Firestore conversation thankYouSmtpMessageId match found: ${matchedConvId}`);
          break;
        }

        // Check conversations collection for emailThreadId
        const threadSnap = await getDocs(
          query(tenantRepo(getInboundCtx()).conversations(), where('emailThreadId', '==', candId), limit(1))
        );
        if (!threadSnap.empty) {
          matchedConvId = threadSnap.docs[0].id;
          matchedBy = 'references';
          console.log(`[Thread Matcher] Firestore conversation emailThreadId match found: ${matchedConvId}`);
          break;
        }
      }
    } catch (err) {
      console.warn('[Thread Matcher] Notice querying candidate IDs from Firestore:', err);
    }
  }

  // 3. Fallback: Match by customerEmail in Firestore conversations
  if (!matchedConvId && isFirebaseConfigured && db && cleanEmail) {
    try {
      const emailSnap = await getDocs(
        query(tenantRepo(getInboundCtx()).conversations(), where('customerEmail', '==', cleanEmail), limit(5))
      );

      if (!emailSnap.empty) {
        const candidateConvs = emailSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
        const websiteConv = candidateConvs.find(
          (c) =>
            c.channel === 'WEBSITE' ||
            c.conversationId?.startsWith('conv-web-') ||
            c.thankYouEmailSent === true ||
            c.conversationSummary?.toLowerCase().includes('website demo')
        );

        if (websiteConv) {
          matchedConvId = websiteConv.id || websiteConv.conversationId;
          matchedBy = 'customerEmail';
          console.log(`[Thread Matcher] Matched website demo conversation for ${cleanEmail}: ${matchedConvId}`);
        } else {
          candidateConvs.sort(
            (a, b) =>
              new Date(b.lastMessageAt || b.updatedAt || b.createdAt || 0).getTime() -
              new Date(a.lastMessageAt || a.updatedAt || a.createdAt || 0).getTime()
          );
          matchedConvId = candidateConvs[0].id || candidateConvs[0].conversationId;
          matchedBy = 'customerEmail';
          console.log(`[Thread Matcher] Matched recent conversation for ${cleanEmail}: ${matchedConvId}`);
        }
      }
    } catch (err) {
      console.warn('[Thread Matcher] Notice querying conversations by customerEmail:', err);
    }
  }

  // 4. Fallback: Match via Contact's email in Firestore contacts
  let foundContactDoc: any = null;
  if (isFirebaseConfigured && db && cleanEmail) {
    try {
      const contactSnap = await getDocs(
        query(tenantRepo(getInboundCtx()).contacts(), where('email', '==', cleanEmail), limit(1))
      );
      if (!contactSnap.empty) {
        foundContactDoc = { id: contactSnap.docs[0].id, ...contactSnap.docs[0].data() };
        if (!matchedConvId) {
          const convByContactSnap = await getDocs(
            query(tenantRepo(getInboundCtx()).conversations(), where('contactId', '==', foundContactDoc.id), limit(5))
          );
          if (!convByContactSnap.empty) {
            const list = convByContactSnap.docs.map((d) => ({ id: d.id, ...d.data() } as any));
            const webConv = list.find(
              (c) =>
                c.channel === 'WEBSITE' ||
                c.conversationId?.startsWith('conv-web-') ||
                c.thankYouEmailSent === true
            );
            const chosen = webConv || list[0];
            matchedConvId = chosen.id || chosen.conversationId;
            matchedBy = 'contactEmail';
            console.log(`[Thread Matcher] Matched conversation via Contact ${foundContactDoc.id}: ${matchedConvId}`);
          }
        }
      }
    } catch (err) {
      console.warn('[Thread Matcher] Notice querying contacts by email:', err);
    }
  }

  // 5. In-memory fallback: Scan thread sender emails
  if (!matchedConvId && cleanEmail) {
    for (const [cId, msgs] of conversationThreadMessagesMap.entries()) {
      const match = msgs.some(
        (m: any) =>
          (m.senderEmail && m.senderEmail.toLowerCase().trim() === cleanEmail) ||
          (m.recipientEmail && m.recipientEmail.toLowerCase().trim() === cleanEmail)
      );
      if (match) {
        matchedConvId = cId;
        matchedBy = 'memory';
        console.log(`[Thread Matcher] In-memory match found by email ${cleanEmail}: ${matchedConvId}`);
        break;
      }
    }
  }

  // 6. Fetch complete conversation, lead, and contact data if matched
  let loadedConversation: any = null;
  let loadedLead: any = null;

  if (matchedConvId && isFirebaseConfigured && db) {
    try {
      const cSnap = await getDoc(tenantRepo(getInboundCtx()).conversationDoc(matchedConvId));
      if (cSnap.exists()) {
        loadedConversation = { id: cSnap.id, ...cSnap.data() };
      }
    } catch (err) {
      console.warn('[Thread Matcher] Notice fetching conversation doc:', err);
    }
  }

  const effectiveContactId =
    loadedConversation?.contactId || foundContactDoc?.contactId || foundContactDoc?.id || `contact-${safeId}`;
  const effectiveLeadId =
    loadedConversation?.leadId || (foundContactDoc as any)?.leadId || `lead-${safeId}`;

  if (effectiveContactId && !foundContactDoc && isFirebaseConfigured && db) {
    try {
      const cSnap = await getDoc(tenantRepo(getInboundCtx()).contactDoc(effectiveContactId));
      if (cSnap.exists()) {
        foundContactDoc = { id: cSnap.id, ...cSnap.data() };
      }
    } catch {}
  }

  if (effectiveLeadId && isFirebaseConfigured && db) {
    try {
      const lSnap = await getDoc(tenantRepo(getInboundCtx()).leadDoc(effectiveLeadId));
      if (lSnap.exists()) {
        loadedLead = { id: lSnap.id, ...lSnap.data() };
      }
    } catch {}
  }

  // 7. Ensure in-memory thread has all previous messages from Firestore
  const finalConvId = matchedConvId || `conv-${safeId}`;
  let thread = conversationThreadMessagesMap.get(finalConvId);

  if ((!thread || thread.length === 0) && isFirebaseConfigured && db && matchedConvId) {
    try {
      const msgsSnap = await getDocs(
        query(tenantRepo(getInboundCtx()).messages(), where('conversationId', '==', finalConvId))
      );
      const loaded: any[] = [];
      msgsSnap.forEach((d) => loaded.push({ id: d.id, ...d.data() }));
      loaded.sort(
        (a, b) =>
          new Date(a.sentAt || a.timestamp || a.createdAt || 0).getTime() -
          new Date(b.sentAt || b.timestamp || b.createdAt || 0).getTime()
      );
      conversationThreadMessagesMap.set(finalConvId, loaded);
      console.log(`[Thread Matcher] Populated in-memory thread with ${loaded.length} prior messages for ${finalConvId}`);
    } catch (err) {
      console.warn('[Thread Matcher] Notice loading prior messages from Firestore:', err);
    }
  }

  return {
    conversationId: finalConvId,
    contactId: effectiveContactId,
    leadId: effectiveLeadId,
    threadId: loadedConversation?.emailThreadId || loadedConversation?.gmailThreadId || `thread-${safeId}`,
    conversation: loadedConversation,
    contact: foundContactDoc,
    lead: loadedLead,
    isExisting: Boolean(matchedConvId),
    matchedBy,
  };
}

export async function generateAutoReplyText(params: {
  from: string;
  fromName?: string;
  subject: string;
  body: string;
  companyName?: string;
  threadHistory?: any[];
}): Promise<{ replyText: string; handoffTriggered: boolean; handoffReason?: string; leadScore: number; buyingStage: string }> {
  const { from, fromName, subject, body, companyName, threadHistory } = params;
  const combinedText = `${subject}\n${body}`.toLowerCase();
  const brand = await getTenantBrand(getInboundCtx().tenantId);
  const isUmrah = brand.playbook === 'umrah360';

  // =========================================================================
  // UNIVERSAL DEMO SCHEDULING AGENT INTERCEPTION
  // =========================================================================
  if (detectDemoSchedulingIntent(body) || detectDemoSchedulingIntent(subject)) {
    try {
      const historyTurns = (threadHistory || []).map((m: any) => ({
        role: (m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT' ? 'user' : 'assistant') as 'user' | 'assistant',
        content: m.text || '',
      }));

      const schedulingTurn = await processSchedulingConversationTurn({
        automated: true,
        messageText: `${subject}\n${body}`,
        conversationHistory: historyTurns,
        leadContext: {
          leadEmail: from,
          leadName: fromName || from.split('@')[0],
          companyName: companyName || `${fromName || 'Client'}'s ${isUmrah ? 'Agency' : 'Company'}`,
          channel: 'EMAIL',
        },
      });

      if (schedulingTurn.handled && schedulingTurn.replyText) {
        return {
          replyText: schedulingTurn.replyText,
          handoffTriggered: false,
          leadScore: schedulingTurn.action === 'CONFIRMED_BOOKING' ? 98 : 88,
          buyingStage: 'DECISION',
        };
      }
    } catch (schedErr) {
      console.warn('[Demo Scheduling Inbound Email Warning]:', schedErr);
    }
  }

  // Determine if this is a follow-up turn in an ongoing dialogue
  const customerMessagesCount = threadHistory
    ? threadHistory.filter((m: any) => m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT').length
    : 1;
  const isFollowUpTurn = customerMessagesCount > 1 || (threadHistory && threadHistory.length > 1);

  // Format complete loaded thread context for deep AI analysis
  const formattedThreadContext = (threadHistory && threadHistory.length > 0)
    ? threadHistory.map((m: any, idx: number) => {
        const isCustomer = m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT';
        const roleLabel = isCustomer ? `CUSTOMER (${m.senderName || from})` : `AI ASSISTANT (${brand.companyName})`;
        return `[Message ${idx + 1} - ${roleLabel} at ${m.timestamp}]:\n${m.text}`;
      }).join('\n\n')
    : `[Message 1 - CUSTOMER (${fromName || from})]:\n${body}`;

  // Intent classification
  const isIndividualPilgrimOrFamily = isUmrah &&
    /myself|my family|for family|for myself|as a customer|planning umrah|booking experience|customized package|customize a package|book a customized|hotels in makkah|flights.*hotels|transfers.*meals.*visa|real-time.*availability|online payment|entire booking.*online|go through a travel agency|direct booking|retail/i.test(
      combinedText
    );
  const isTwentyUsers = isUmrah && /20 user|20 seat|25 user|twenty user|enterprise/i.test(combinedText);
  const isB2bPortal = isUmrah && /b2b|sub-agent|reseller|credit limit|wallet|allotment|offline block/i.test(combinedText);
  const isSaaSPricing = !isIndividualPilgrimOrFamily && (isUmrah ? /pricing|price|cost|quote|subscription|rate|\$15|\$199|\$499/i : /pricing|price|cost|quote|subscription|rate/i).test(combinedText);

  let handoffTriggered = false;
  let handoffReason: string | undefined;
  let leadScore = 75;
  let buyingStage = 'AWARENESS';

  if (isTwentyUsers) {
    handoffTriggered = true;
    handoffReason = 'Enterprise 20+ user deployment detected - requires volume quote';
    leadScore = 95;
    buyingStage = 'DECISION';
  } else if (isB2bPortal) {
    leadScore = 88;
    buyingStage = 'CONSIDERATION';
  } else if (isIndividualPilgrimOrFamily) {
    leadScore = 90;
    buyingStage = 'CONSIDERATION';
  } else if (isSaaSPricing) {
    leadScore = 82;
    buyingStage = 'CONSIDERATION';
  }

  const targetMailbox = isUmrah ? (process.env.SMTP_USER || process.env.IMAP_USER || 'amaavigo@gmail.com') : (brand.salesEmail || '');
  const senderGreetingName = fromName ? fromName.split(' ')[0] : from.split('@')[0];

  // Prepare full knowledgebase grounding text from dynamic published knowledge documents
  await initKnowledgeStore(getInboundCtx()).catch(() => 0);
  const publishedDocs = getPublishedKnowledgeDocs(getInboundCtx());
  const kbGroundingText = publishedDocs.map(
    (doc) => `=== [${doc.category}] ${doc.title} ===\n${doc.content}`
  ).join('\n\n');

  // Attempt OpenAI generation if OPENAI_API_KEY (or fallback key) is available
  const openAiApiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (openAiApiKey) {
    try {
      const openai = new OpenAI({ apiKey: openAiApiKey });
      const umrahPrompt = `You are the official AI automation representative for Umrah360 (www.umrah360.in), responding to an email on behalf of ${targetMailbox}.

OFFICIAL UMRAH360 KNOWLEDGE BASE (GROUND TRUTH):
${kbGroundingText}

COMPLETE LOADED CONVERSATION THREAD CONTEXT (${threadHistory?.length || 1} message(s)):
${formattedThreadContext}

LATEST INCOMING CUSTOMER MESSAGE TO RESPOND TO:
From: ${fromName || from} (${from})
Company: ${companyName || 'Not specified'}
Subject: ${subject}
Latest Message Body:
${body}

CRITICAL INSTRUCTIONS FOR AI ANALYSIS & REPLY:
1. THREAD CONTINUITY & CONTEXT:
   - If this is a FOLLOW-UP REPLY (Turn 2 or later, customer replying to previous email):
     • Maintain natural conversational continuity with the earlier messages in this thread.
     • DO NOT restart with a generic welcome ("Thank you for reaching out to Umrah360") or repetitive platform definitions if already covered.
     • Directly answer the customer's specific follow-up questions (e.g. recommending partner travel agencies in Mumbai/Delhi/Bangalore, explaining how packages are customized, providing dates or booking instructions).
     • Greet with a formal professional greeting: "Dear ${senderGreetingName},"
   - If this is TURN 1 (Brand new customer inquiry):
     • Greet with a formal professional greeting: "Dear ${senderGreetingName},"
     • Clearly explain that Umrah360 is the enterprise technology platform that powers licensed travel agencies, and on partner agencies' websites pilgrims can customize real-time hotels, flights, and Saudi e-visas.
2. ACCURACY & POLICIES:
   - Ground all answers strictly in the Umrah360 knowledge base.
   - If asking about partner travel agencies in their city/region, confirm we have authorized partner agencies and ask for their travel dates and group size to connect them.
   - If travel agency asking about B2B/SaaS plans: Mention Lite ($15/user/month billed annually) and Growth.
   - If 20+ users: Explicitly mention Enterprise volume licensing and senior specialist follow-up.
3. Keep the response polite, helpful, crisp, and professional.
4. FORMATTING & GREETING RULES (MANDATORY): Never use Markdown symbols in email replies. Do NOT use **, ##, ###, *, backticks, or similar formatting symbols. Write emails as natural, professional plain text. Use formal greetings ONLY (e.g., "Dear [Name]," or "Hello [Name],"). NEVER use Muslim/religious greetings such as "Assalamu Alaikum", "Walaikum Assalam", "Salam", etc.
5. Conclude with:
Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;

      const genericPrompt = `You are the official AI automation representative for ${brandIntro(brand)}${brand.industryDescription ? `, serving ${brand.industryDescription}` : ''}, responding to an email${targetMailbox ? ` on behalf of ${targetMailbox}` : ''}.

OFFICIAL ${brand.companyName.toUpperCase()} KNOWLEDGE BASE (GROUND TRUTH):
${kbGroundingText || '(No knowledge documents have been published yet.)'}

COMPLETE LOADED CONVERSATION THREAD CONTEXT (${threadHistory?.length || 1} message(s)):
${formattedThreadContext}

LATEST INCOMING CUSTOMER MESSAGE TO RESPOND TO:
From: ${fromName || from} (${from})
Company: ${companyName || 'Not specified'}
Subject: ${subject}
Latest Message Body:
${body}

CRITICAL INSTRUCTIONS:
1. THREAD CONTINUITY: ${isFollowUpTurn ? 'This is a follow-up. Continue naturally from the earlier messages, do not repeat introductions, and answer the specific follow-up questions.' : 'This is a brand new inquiry. Briefly welcome the customer and answer their question.'} Greet with a formal professional greeting: "Dear ${senderGreetingName},"
2. ACCURACY: Ground every answer strictly in the knowledge base above. NEVER invent features, prices, dates or guarantees. If the knowledge base does not contain the answer, say you will connect them with a specialist from ${brand.companyName} and ask for any details needed.
3. Keep the response polite, helpful, crisp, and professional.
4. FORMATTING (MANDATORY): Never use Markdown symbols (**, ##, ###, *, backticks). Write natural plain text.
5. Conclude with:
${brandAutomationSignature(brand)}${targetMailbox ? `\n${targetMailbox}` : ''}`;

      const prompt = isUmrah ? umrahPrompt : genericPrompt;

      const candidateModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
      for (const modelName of candidateModels) {
        try {
          const completion = await openai.chat.completions.create({
            model: modelName,
            messages: [{ role: 'user', content: prompt }],
            temperature: 0.3,
          });

          const rawText = completion.choices[0]?.message?.content?.trim() || '';
          if (rawText.length > 30) {
            const replyText = sanitizeAiEmailText(rawText, senderGreetingName);
            return {
              replyText,
              handoffTriggered,
              handoffReason,
              leadScore,
              buyingStage,
            };
          }
        } catch (modelErr: any) {
          console.warn(`[OpenAI Inbound ${modelName}] Notice:`, modelErr?.message || modelErr);
        }
      }
    } catch (openAiErr) {
      console.warn('[OpenAI Pipeline] Fallback to domain-grounded knowledge response:', openAiErr);
    }
  }

  // Generic (non-Umrah360) workspaces: neutral fallback grounded only in the company's own knowledge base.
  if (!isUmrah) {
    const words = Array.from(new Set(combinedText.split(/[^a-z0-9]+/).filter((w) => w.length > 3)));
    let best: { score: number; text: string } = { score: 0, text: '' };
    for (const d of publishedDocs) {
      const hay = `${d.title} ${d.content}`.toLowerCase();
      const score = words.reduce((n, w) => n + (hay.includes(w) ? 1 : 0), 0);
      if (score > best.score) best = { score, text: String(d.content || '').trim().slice(0, 600) };
    }
    const sig = `${brandAutomationSignature(brand)}${targetMailbox ? `\n${targetMailbox}` : ''}`;
    const genericReply = best.score >= 2
      ? `Dear ${senderGreetingName},\n\nThank you for contacting ${brand.companyName}!\n\n${best.text}\n\nCould you tell us a little more about what you are looking for${companyName ? ` at ${companyName}` : ''} so we can help you further?\n\n${sig}`
      : `Dear ${senderGreetingName},\n\nThank you for contacting ${brand.companyName}! We have received your message and one of our specialists will get back to you shortly.\n\nTo help us respond faster, please share a few details about what you are looking for.\n\n${sig}`;
    return {
      replyText: sanitizeAiEmailText(genericReply, senderGreetingName),
      handoffTriggered,
      handoffReason,
      leadScore,
      buyingStage,
    };
  }

  // Domain-grounded fallback response engine (100% accurate to umrah360.in)
  let replyText = '';

  if (isFollowUpTurn) {
    if (/mumbai|delhi|bangalore|hyderabad|chennai|kolkata|lucknow|ahmedabad|kashmir|london|dubai|partner|agency|agencies|recommend|which/i.test(combinedText)) {
      replyText = `Dear ${senderGreetingName},

Thank you for your follow-up!

We partner with premier licensed Hajj & Umrah travel agencies across major hubs including Mumbai, Delhi, Bangalore, Hyderabad, and internationally. 

Our authorized partner travel agencies in your region utilize Umrah360 to provide:
• Real-time inventory and pricing for Swissotel Makkah, Pullman Zamzam, Clock Tower, and Markaziyah hotels
• Private VIP GMC/Yukon airport transfers and Haramain High-Speed Train tickets
• Saudi tourist and Umrah eVisa processing with transparent invoicing

To connect you directly with our top authorized partner travel specialist in your city, could you please let us know:
1. Your tentative travel dates or preferred month
2. Number of family members traveling (adults and children)
3. Preferred room sharing (Quad, Triple, Double)

Once you share these details, we will connect you directly so they can prepare your customized family package itinerary!

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
    } else {
      replyText = `Dear ${senderGreetingName},

Thank you for following up!

To assist you with your pilgrimage planning: on booking platforms powered by Umrah360, your customized itinerary is generated with live availability and transparent pricing through our licensed partner travel agencies.

Could you please share your travel month and group size so we can connect you directly with a verified local specialist?

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
    }
  } else if (isIndividualPilgrimOrFamily) {
    replyText = `Dear ${senderGreetingName},

Thank you for reaching out to Umrah360!

To address your questions regarding booking an Umrah package:

1. Platform Role & Booking Experience:
Umrah360 (www.umrah360.in) is the core travel technology and booking software platform that powers licensed Hajj and Umrah tour operators, travel agencies, and consolidators. 

Travel agencies running on Umrah360 are equipped with modern consumer-facing booking engines where pilgrims and families can indeed customize and book complete packages online in real time—including flights, Makkah & Madinah hotels (such as Swissotel, Pullman Zamzam, Clock Tower, and Markaziyah properties), ground transfers (Haramain High-Speed Train and private VIP GMCs), meal plans, Ziyarat tours, and Saudi e-Visas.

2. Real-Time Availability & Online Payment:
Yes, on platforms powered by Umrah360, prices and room allotments are connected to live inventory feeds, and the entire document submission (passport/visa) and payment process can be completed securely online.

3. How to Make Your Booking:
Because Umrah360 is the enterprise technology provider rather than a retail travel agency, customer bookings are legally fulfilled and serviced through one of our licensed, certified partner travel agencies. 

Our team would be delighted to connect you directly with one of our top verified partner travel agencies in your city who will assist you and your family with customized itinerary planning and transparent pricing. 

Could you please share your preferred travel dates, departure city, and family group size so we can connect you with the ideal partner?

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
  } else if (isTwentyUsers) {
    replyText = `Dear ${senderGreetingName},

Thank you for your interest in Umrah360!

For enterprise teams of 20+ user seats, Umrah360 provides tailored volume licensing, dedicated cloud infrastructure, unlimited sub-agent distribution, and custom SLA commitments.

Because Enterprise accounts are customized to your agency's transaction volume, I have escalated your inquiry to our Senior Solutions Specialist to share a tailored proposal and schedule a short walkthrough. Someone will reach out to you directly shortly.

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
  } else if (isB2bPortal) {
    replyText = `Dear ${senderGreetingName},

Thank you for contacting Umrah360!

Yes, Umrah360 provides a comprehensive white-label B2B Sub-Agent Portal built specifically for Umrah and Hajj tour operators. With our B2B portal, you can:
• Set custom markup & commission tiers per sub-agent category
• Manage live credit limits, wallets, and ledger deposits
• Allow sub-agents to search contracted inventory and instantly issue branded PDF vouchers with their own agency logo
• Upload custom negotiated hotel blocks and transport contracts with blackout dates alongside online inventory

Would you like to schedule a 15-minute live platform walkthrough this week?

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
  } else if (isSaaSPricing) {
    replyText = `Dear ${senderGreetingName},

Thank you for reaching out to Umrah360!

Here is our approved subscription pricing structure for pilgrimage travel businesses:
• Umrah360 Lite Plan: Starting at $15/user/month (billed annually) — includes dynamic package creation, multiple departures, unlimited pilgrim bookings, CRM lead manager, and invoicing/billing.
• Umrah360 Pro / Growth Plan: Includes everything in Lite plus the complete B2B Sub-Agent Portal, dynamic multi-currency costing, hotel extranets with blackout dates, and automated WhatsApp/SMS alerts.
• Enterprise Plan: For 20+ users, custom quotes with dedicated cloud hosting and SLA guarantees are available through our senior team.

How many team members would be using the software at ${companyName || 'your agency'}?

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
  } else {
    replyText = `Dear ${senderGreetingName},

Thank you for contacting Umrah360!

Umrah360 (www.umrah360.in) is the leading all-in-one cloud ERP, CRM, and dynamic packaging platform purpose-built for Hajj and Umrah tour operators, travel agencies, and consolidators. It unifies lead management, FIT and group package creation, dynamic multi-currency costing (SAR/USD/INR), Saudi visa tracking, hotel & transport allotments, and sub-agent B2B distribution into a single cohesive system.

Are you currently handling your operations through spreadsheets or looking to upgrade your agency technology?

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
  }

  replyText = sanitizeAiEmailText(replyText, senderGreetingName);

  return {
    replyText,
    handoffTriggered,
    handoffReason,
    leadScore,
    buyingStage,
  };
}

/**
 * Handles incoming email: generates AI reply, enforces single-reply turn logic,
 * dispatches over live SMTP when valid, and produces complete CRM synchronization entities.
 */
export async function processLiveInboundEmail(payload: {
  from: string;
  fromName?: string;
  to?: string;
  subject: string;
  body: string;
  messageId?: string;
  gmailMessageId?: string;
  id?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  senderType?: 'CUSTOMER' | 'PROSPECT' | 'AI' | 'AGENT';
  inReplyTo?: string;
  references?: string[] | string;
  companyName?: string;
  phone?: string;
  isTestSimulation?: boolean;
  /** The mailbox this email was read from (a workspace's own IMAP inbox). Defaults to the platform mailbox. */
  ownMailbox?: string;
}): Promise<ProcessedInboundEmailResult> {
  const brand = await getTenantBrand(getInboundCtx().tenantId);
  const isUmrahBrand = brand.playbook === 'umrah360';
  const targetMailbox = payload.ownMailbox || process.env.SMTP_USER || process.env.IMAP_USER || 'amaavigo@gmail.com';
  const incomingMsgId = resolveGmailMessageId(payload, targetMailbox);
  const replySubject = payload.subject.toLowerCase().startsWith('re:') ? payload.subject : `Re: ${payload.subject}`;
  const nowIso = new Date().toISOString();
  const senderEmail = payload.from.toLowerCase().trim();

  // Match existing conversation thread (e.g. website demo request or ongoing email dialogue)
  const matched = await findExistingConversationForInboundEmail({
    senderEmail,
    inReplyTo: payload.inReplyTo,
    references: payload.references,
    subject: payload.subject,
    companyName: payload.companyName,
  });

  const conversationId = matched.conversationId;
  const contactId = matched.contactId;
  const leadId = matched.leadId;
  const threadId = matched.threadId;

  console.log(
    `[Inbound Thread Matcher] Email from "${senderEmail}" (MsgID: ${incomingMsgId}) resolved to conversation: ${conversationId} (isExisting: ${matched.isExisting}, matchedBy: ${matched.matchedBy})`
  );

  const displayName =
    payload.fromName ||
    (matched.contact?.firstName && matched.contact?.lastName
      ? `${matched.contact.firstName} ${matched.contact.lastName}`
      : matched.contact?.firstName) ||
    payload.from.split('@')[0];
  const nameParts = displayName.split(' ');
  const firstName = matched.contact?.firstName || nameParts[0] || 'Inbound';
  const lastName = matched.contact?.lastName || nameParts.slice(1).join(' ') || 'Prospect';

  // AI-to-AI / self-email loop prevention & Outbound check
  const fromLower = senderEmail;
  const targetMailboxLower = targetMailbox.toLowerCase();
  const isSelf = fromLower === targetMailboxLower || 
                 fromLower === 'sales@umrah360.in' || 
                 fromLower === 'amaavigo@gmail.com' ||
                 fromLower.includes('mailer-daemon') ||
                 fromLower.includes('postmaster') ||
                 fromLower.includes('no-reply');

  const isOutbound = payload.direction === 'OUTBOUND' ||
                     payload.senderType === 'AI' ||
                     payload.senderType === 'AGENT' ||
                     isSelf;

  // Ensure thread exists in memory
  let thread = conversationThreadMessagesMap.get(conversationId);
  if (!thread) {
    thread = [];
    conversationThreadMessagesMap.set(conversationId, thread);
  }

  // =========================================================================
  // RULE 1: OUTBOUND EMAIL EVENTS ARE SAVED BUT NEVER TRIGGER AI
  // =========================================================================
  if (isOutbound) {
    console.log(`[Unified Inbox] Outbound/Internal email event detected from ${payload.from} (ID: ${incomingMsgId}). Recording without AI reply.`);
    
    // Store in persistent record store as OUTBOUND
    recordProcessedMessage({
      gmailMessageId: incomingMsgId,
      direction: 'OUTBOUND',
      senderType: (payload.senderType === 'AI' ? 'AI' : 'AGENT'),
      aiReplied: false,
      firstSeenAt: nowIso,
      subject: payload.subject,
      from: payload.from,
    });

    const outboundMessage = {
      messageId: incomingMsgId.startsWith('<') ? `msg-out-${incomingMsgId.replace(/[^a-z0-9]/gi, '_')}` : incomingMsgId,
      gmailMessageId: incomingMsgId,
      gmailThreadId: threadId,
      conversationId,
      channel: 'EMAIL' as const,
      direction: 'OUTBOUND' as const,
      senderType: payload.senderType === 'AI' ? ('AI' as const) : ('AGENT' as const),
      senderName: displayName,
      senderEmail: payload.from,
      text: payload.body,
      timestamp: nowIso,
      sentAt: nowIso,
      receivedAt: nowIso,
      createdAt: nowIso,
      aiReplied: false,
      emailMeta: {
        subject: payload.subject,
        from: payload.from,
        to: targetMailbox,
        messageId: incomingMsgId,
        inReplyTo: payload.inReplyTo,
      },
    };

    const alreadyInThread = thread.some(
      (m) => m.messageId === outboundMessage.messageId || m.gmailMessageId === incomingMsgId || m.emailMeta?.messageId === incomingMsgId
    );
    if (!alreadyInThread) {
      thread.push(outboundMessage);
    }

    return {
      messageId: incomingMsgId,
      from: payload.from,
      fromName: displayName,
      to: targetMailbox,
      subject: payload.subject,
      incomingText: payload.body,
      replySubject,
      replyText: '',
      shouldSendAutoReply: false,
      replyDecisionReason: 'Outbound or system email event stored. AI never triggers on outbound messages.',
      smtpDelivery: { success: false, simulated: false, error: 'Outbound message event; auto-reply not applicable.' },
      handoffTriggered: false,
      leadScore: 0,
      intent: 'MEDIUM',
      buyingStage: 'ENGAGED',
      timestamp: nowIso,
      crmEntities: {
        contact: { contactId, firstName, lastName, email: payload.from, companyName: payload.companyName || (isUmrahBrand ? 'Umrah360 Internal' : `${brand.companyName} Internal`), createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        lead: { leadId, contactId, source: 'EMAIL', leadType: 'INBOUND', status: 'ENGAGED', leadScore: 50, intent: 'MEDIUM', buyingStage: 'ENGAGED', serviceInterest: payload.subject, requirements: [], aiSummary: 'Outbound message event', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        conversation: { conversationId, contactId, leadId, channel: 'EMAIL', direction: 'OUTBOUND', status: 'ACTIVE', aiEnabled: false, humanHandoff: false, emailThreadId: threadId, conversationSummary: `Outbound email: ${payload.subject}`, startedAt: nowIso, lastMessageAt: nowIso, lastMessageText: payload.body.slice(0, 120), unreadCount: 0, createdAt: nowIso, updatedAt: nowIso },
        incomingMessage: outboundMessage,
        activity: { activityId: `act-out-${Date.now()}`, leadId, contactId, type: 'AGENT_REPLIED', title: 'Outbound Email Sent', description: `Sent message ${incomingMsgId}`, timestamp: nowIso },
        allThreadMessages: [...thread],
      }
    };
  }

  // =========================================================================
  // RULE 2: STRICT PERSISTENT IDEMPOTENCY CHECK BEFORE GENERATING OR SENDING
  // Check:
  // 1. In-memory processedRecordsMap & active conversation thread
  // 2. Persistent Firestore idempotency collection (cross-restore & cold-start safe)
  // 3. Conversation Turn State (never auto-reply multiple times to the same customer turn)
  // If this message has already received an AI reply or was baselined:
  // → STOP processing immediately
  // → DO NOT generate AI response
  // → DO NOT send SMTP email.
  // =========================================================================
  const existingRecord = getProcessedMessageRecord(incomingMsgId);
  const isRecordAlreadyReplied =
    existingRecord &&
    existingRecord.direction === 'INBOUND' &&
    (existingRecord.senderType === 'CUSTOMER' || existingRecord.senderType === 'PROSPECT') &&
    existingRecord.aiReplied === true;

  const isThreadMsgAlreadyReplied = thread.some(
    (m) =>
      (m.gmailMessageId === incomingMsgId || m.emailMeta?.messageId === incomingMsgId) &&
      m.direction === 'INBOUND' &&
      (m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT') &&
      m.aiReplied === true
  );

  // Check persistent Firestore store
  const firestoreCheck = await isMessageAlreadyProcessed(incomingMsgId, payload.from, getInboundCtx());
  const isFirestoreRepliedOrBaselined = Boolean(
    firestoreCheck.processed &&
    (firestoreCheck.replied || firestoreCheck.reason?.includes('BASELINE') || firestoreCheck.reason?.includes('status: REPLIED'))
  );

  // Check Conversation Turn Map
  const turnState = conversationTurnMap.get(senderEmail);
  const isTurnAlreadyReplied = Boolean(
    turnState &&
    turnState.waitingForCustomerReply &&
    (turnState.lastRepliedMessageId === incomingMsgId || normalizeIdentifier(turnState.lastRepliedMessageId) === normalizeIdentifier(incomingMsgId))
  );

  // IDEMPOTENCY GATE:
  if (isRecordAlreadyReplied || isThreadMsgAlreadyReplied || isFirestoreRepliedOrBaselined || isTurnAlreadyReplied) {
    const reasonDetail = isFirestoreRepliedOrBaselined
      ? `Firestore persistent record: ${firestoreCheck.reason || 'Already processed/baselined'}`
      : isTurnAlreadyReplied
      ? `Turn state: already replied to customer turn for message ${turnState?.lastRepliedMessageId}`
      : `Memory state: already replied (aiReplied=true)`;

    console.log(`[Unified Inbox Idempotency] STOP: Suppressing duplicate email to ${payload.from} for message ${incomingMsgId}. Reason: ${reasonDetail}`);
    return {
      messageId: incomingMsgId,
      from: payload.from,
      fromName: displayName,
      to: targetMailbox,
      subject: payload.subject,
      incomingText: payload.body,
      replySubject,
      replyText: '',
      shouldSendAutoReply: false,
      replyDecisionReason: `Strict idempotency enforced: message ${incomingMsgId} already replied or baselined. ${reasonDetail}`,
      smtpDelivery: {
        success: false,
        simulated: false,
        error: `Already replied or baselined for message ${incomingMsgId}`,
      },
      handoffTriggered: false,
      leadScore: 85,
      intent: 'HIGH',
      buyingStage: 'ENGAGED',
      timestamp: nowIso,
      crmEntities: {
        contact: { contactId, firstName, lastName, email: payload.from, companyName: payload.companyName || `${firstName}'s Agency`, phone: payload.phone || '', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        lead: { leadId, contactId, source: 'EMAIL', leadType: 'INBOUND', status: 'ENGAGED', leadScore: 85, intent: 'HIGH', buyingStage: 'ENGAGED', serviceInterest: payload.subject, requirements: [payload.subject], aiSummary: `Duplicate event ignored for message ${incomingMsgId}`, createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        conversation: { conversationId, contactId, leadId, channel: 'EMAIL', direction: 'INBOUND', status: 'ACTIVE', aiEnabled: true, humanHandoff: false, emailThreadId: threadId, gmailThreadId: threadId, conversationSummary: `Email dialogue with ${displayName}`, startedAt: nowIso, lastMessageAt: nowIso, lastMessageText: payload.body.slice(0, 120), unreadCount: 0, createdAt: nowIso, updatedAt: nowIso },
        incomingMessage: {
          messageId: `msg-in-${incomingMsgId.replace(/[^a-z0-9]/gi, '_')}`,
          gmailMessageId: incomingMsgId,
          conversationId,
          channel: 'EMAIL',
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
          senderName: displayName,
          senderEmail: payload.from,
          text: payload.body,
          timestamp: nowIso,
          aiReplied: true,
          emailMeta: { subject: payload.subject, from: payload.from, to: targetMailbox, messageId: incomingMsgId }
        },
        activity: { activityId: `act-dup-${Date.now()}`, leadId, contactId, type: 'NOTE_ADDED', title: 'Duplicate Inbound Email Ignored', description: `Message ${incomingMsgId} already processed and replied.`, timestamp: nowIso },
        allThreadMessages: [...thread],
      }
    };
  }

  // =========================================================================
  // RULE 3: IN-FLIGHT CONCURRENCY LOCK
  // Ensure rapid concurrent webhooks for the exact same message do not race
  // =========================================================================
  if (inFlightMessageIds.has(incomingMsgId) && !payload.isTestSimulation) {
    console.log(`[Unified Inbox Idempotency] In-flight concurrency lock active for message ${incomingMsgId}. Aborting parallel execution.`);
    return {
      messageId: incomingMsgId,
      from: payload.from,
      fromName: displayName,
      to: targetMailbox,
      subject: payload.subject,
      incomingText: payload.body,
      replySubject,
      replyText: '',
      shouldSendAutoReply: false,
      replyDecisionReason: `In-flight duplicate for message ${incomingMsgId}. Execution blocked to prevent duplicate reply.`,
      smtpDelivery: { success: false, simulated: false, error: 'In-flight duplicate' },
      handoffTriggered: false,
      leadScore: 85,
      intent: 'HIGH',
      buyingStage: 'ENGAGED',
      timestamp: nowIso,
      crmEntities: {
        contact: { contactId, firstName, lastName, email: payload.from, companyName: payload.companyName || `${firstName}'s Agency`, createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        lead: { leadId, contactId, source: 'EMAIL', leadType: 'INBOUND', status: 'ENGAGED', leadScore: 85, intent: 'HIGH', buyingStage: 'ENGAGED', serviceInterest: payload.subject, requirements: [], aiSummary: 'In-flight lock applied', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        conversation: { conversationId, contactId, leadId, channel: 'EMAIL', direction: 'INBOUND', status: 'ACTIVE', aiEnabled: true, humanHandoff: false, emailThreadId: threadId, conversationSummary: `Dialogue with ${displayName}`, startedAt: nowIso, lastMessageAt: nowIso, lastMessageText: payload.body.slice(0, 120), unreadCount: 0, createdAt: nowIso, updatedAt: nowIso },
        incomingMessage: { messageId: incomingMsgId, conversationId, channel: 'EMAIL', senderType: 'CUSTOMER', senderName: displayName, senderEmail: payload.from, text: payload.body, timestamp: nowIso, emailMeta: { subject: payload.subject, from: payload.from, to: targetMailbox, messageId: incomingMsgId } },
        activity: { activityId: `act-inflight-${Date.now()}`, leadId, contactId, type: 'NOTE_ADDED', title: 'In-Flight Duplicate Ignored', description: `Message ${incomingMsgId} already currently processing.`, timestamp: nowIso },
        allThreadMessages: [...thread],
      }
    };
  }

  inFlightMessageIds.add(incomingMsgId);

  try {
    // =========================================================================
    // RULE 4: SAVE NEW INBOUND CUSTOMER MESSAGE
    // When a genuinely new customer email arrives or customer sends a new reply:
    // -> Save it with aiReplied = false
    // =========================================================================
    const incomingMessage = {
      messageId: `msg-in-${incomingMsgId.replace(/[^a-z0-9]/gi, '_')}`,
      gmailMessageId: incomingMsgId,
      gmailThreadId: threadId,
      conversationId,
      channel: 'EMAIL' as const,
      direction: 'INBOUND' as const,
      senderType: 'CUSTOMER' as const,
      senderName: displayName,
      senderEmail: payload.from,
      text: payload.body,
      timestamp: nowIso,
      sentAt: nowIso,
      receivedAt: nowIso,
      createdAt: nowIso,
      aiReplied: false,
      emailMeta: {
        subject: payload.subject,
        from: payload.from,
        to: targetMailbox,
        messageId: incomingMsgId,
        inReplyTo: payload.inReplyTo,
      },
    };

    // Append to conversation thread if not already present
    const existingIndex = thread.findIndex(
      (m) => m.messageId === incomingMessage.messageId || m.gmailMessageId === incomingMsgId || m.emailMeta?.messageId === incomingMsgId
    );
    if (existingIndex < 0) {
      thread.push(incomingMessage);
    } else {
      thread[existingIndex] = {
        ...thread[existingIndex],
        ...incomingMessage,
        aiReplied: thread[existingIndex].aiReplied || false,
      };
    }

    // Record message in persistent store with aiReplied = false
    recordProcessedMessage({
      gmailMessageId: incomingMsgId,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      aiReplied: false,
      firstSeenAt: nowIso,
      subject: payload.subject,
      from: payload.from,
    });

    // Hook into Outbound Campaign System: track lead reply and detect demo booking intent
    let campaignReplyResult: { isCampaignLead: boolean; campaignLead?: any; campaignId?: string; campaignName?: string; demoDetected?: boolean } = { isCampaignLead: false };
    try {
      // Match the lead inside THIS inbound's workspace, not whichever tenant last made an API call.
      campaignReplyResult = await runWithCampaignCtx(getInboundCtx(), () => handleIncomingCampaignLeadReply({
        fromEmail: payload.from,
        fromPhone: payload.phone,
        subject: payload.subject,
        body: payload.body,
        gmailMessageId: incomingMsgId,
        gmailThreadId: threadId,
      }));
    } catch (campaignErr) {
      console.warn('[Unified Inbox] Campaign lead tracking hook notice:', campaignErr);
    }

    // Auto Follow-Up: the lead replied, so any pending follow-up for this conversation is cancelled.
    // Dynamic import avoids a circular dependency (the follow-up service imports this module).
    try {
      const { handleLeadReplyEvent } = await import('./autoFollowUpService.js');
      await handleLeadReplyEvent(getInboundCtx(), { leadId, conversationId });
    } catch (fuErr) {
      console.warn('[Unified Inbox] Auto follow-up cancel hook notice:', fuErr);
    }

    // =========================================================================
    // HUMAN TAKEOVER CHECK (TAKE OVER / HUMAN MODE)
    // If conversation is in HUMAN mode (humanHandoff=true or aiEnabled=false):
    // -> Incoming email is saved and shown in inbox
    // -> MUST NOT trigger Gemini or send an AI reply
    // =========================================================================
    if (isConversationHumanManaged(conversationId)) {
      console.log(`[Human Takeover] Conversation ${conversationId} is in HUMAN managed mode (aiEnabled=false / humanHandoff=true). Incoming email saved and shown in inbox, AI reply suppressed.`);
      inFlightMessageIds.delete(incomingMsgId);
      return {
        messageId: incomingMsgId,
        from: payload.from,
        fromName: displayName,
        to: targetMailbox,
        subject: payload.subject,
        incomingText: payload.body,
        replySubject,
        replyText: '',
        shouldSendAutoReply: false,
        replyDecisionReason: 'Human Takeover active: incoming email saved and shown in inbox, but AI reply suppressed in human-managed mode.',
        smtpDelivery: { success: false, simulated: false, error: 'Human Takeover active - AI reply suppressed' },
        handoffTriggered: true,
        leadScore: 80,
        intent: 'HIGH',
        buyingStage: 'ENGAGED',
        timestamp: nowIso,
        crmEntities: {
          contact: { contactId, firstName, lastName, email: payload.from, companyName: payload.companyName || `${firstName}'s Agency`, createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
          lead: { leadId, contactId, source: 'EMAIL', leadType: 'INBOUND', status: 'ENGAGED', leadScore: 80, intent: 'HIGH', buyingStage: 'ENGAGED', serviceInterest: payload.subject, requirements: [], aiSummary: 'Human Takeover active - message saved in inbox', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
          conversation: { conversationId, contactId, leadId, channel: 'EMAIL', direction: 'INBOUND', status: 'ACTIVE', aiEnabled: false, humanHandoff: true, emailThreadId: threadId, conversationSummary: `Email dialogue with ${displayName}`, startedAt: nowIso, lastMessageAt: nowIso, lastMessageText: payload.body.slice(0, 120), unreadCount: 1, createdAt: nowIso, updatedAt: nowIso },
          incomingMessage,
          activity: { activityId: `act-human-${Date.now()}`, leadId, contactId, type: 'NOTE_ADDED', title: 'Inbound Email (Human Managed)', description: `Received message ${incomingMsgId} during Human Takeover. AI reply suppressed.`, timestamp: nowIso },
          allThreadMessages: [...thread],
        }
      };
    }

    // =========================================================================
    // RULE 5: LOAD COMPLETE MULTI-TURN THREAD CONTEXT
    // =========================================================================
    const completeThreadContext = [...thread];
    console.log(`[Unified Inbox] Loaded complete thread context for ${conversationId} (${completeThreadContext.length} messages)`);

    // =========================================================================
    // RULE 6: EVALUATE CHANNEL MODE AND RUN AI QUALIFICATION CHECK
    // =========================================================================
    const qualification = await classifyInboundMessage({
      subject: payload.subject,
      body: payload.body,
      from: payload.from,
      channel: 'EMAIL',
      companyName: brand.companyName,
      isFollowUp: thread.length > 1 || /^\s*re:/i.test(payload.subject || ''),
    });

    let shouldSendAutoReply = false;
    let replyDecisionReason = '';

    if (pipelineConfig.emailMode === 'SIMULATION') {
      shouldSendAutoReply = false;
      replyDecisionReason = 'Email channel mode is SIMULATION: auto-reply disabled; messages route to human agent.';
    } else if (pipelineConfig.emailMode === 'REVIEW') {
      shouldSendAutoReply = false;
      replyDecisionReason = 'Email channel mode is REVIEW: AI response drafted for human approval prior to dispatch.';
    } else if (!qualification.qualifies) {
      shouldSendAutoReply = false;
      replyDecisionReason = `AI qualification filter: ignored (${qualification.reason})`;
    } else {
      shouldSendAutoReply = true;
      replyDecisionReason = payload.isTestSimulation
        ? 'Live test simulation triggered - dispatching verified SMTP reply.'
        : 'Genuinely new inbound customer message received - generating AI reply ONCE.';
    }

    // Re-check AI state immediately before generating/sending any reply (so already-queued AI jobs cannot send a reply after Human Takeover)
    if (isConversationHumanManaged(conversationId)) {
      console.log(`[Human Takeover] Second state check: conversation ${conversationId} is human managed. Aborting generated AI reply.`);
      inFlightMessageIds.delete(incomingMsgId);
      return {
        messageId: incomingMsgId,
        from: payload.from,
        fromName: displayName,
        to: targetMailbox,
        subject: payload.subject,
        incomingText: payload.body,
        replySubject,
        replyText: '',
        shouldSendAutoReply: false,
        replyDecisionReason: 'Human Takeover active (second check): AI reply aborted after Human Takeover.',
        smtpDelivery: { success: false, simulated: false, error: 'Human Takeover active - AI reply aborted' },
        handoffTriggered: true,
        leadScore: 80,
        intent: 'HIGH',
        buyingStage: 'ENGAGED',
        timestamp: nowIso,
        crmEntities: {
          contact: { contactId, firstName, lastName, email: payload.from, companyName: payload.companyName || `${firstName}'s Agency`, createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
          lead: { leadId, contactId, source: 'EMAIL', leadType: 'INBOUND', status: 'ENGAGED', leadScore: 80, intent: 'HIGH', buyingStage: 'ENGAGED', serviceInterest: payload.subject, requirements: [], aiSummary: 'Human Takeover active - reply aborted', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
          conversation: { conversationId, contactId, leadId, channel: 'EMAIL', direction: 'INBOUND', status: 'ACTIVE', aiEnabled: false, humanHandoff: true, emailThreadId: threadId, conversationSummary: `Email dialogue with ${displayName}`, startedAt: nowIso, lastMessageAt: nowIso, lastMessageText: payload.body.slice(0, 120), unreadCount: 1, createdAt: nowIso, updatedAt: nowIso },
          incomingMessage,
          activity: { activityId: `act-human-2-${Date.now()}`, leadId, contactId, type: 'NOTE_ADDED', title: 'AI Reply Aborted (Human Takeover)', description: `AI reply aborted for message ${incomingMsgId} due to Human Takeover.`, timestamp: nowIso },
          allThreadMessages: [...thread],
        }
      };
    }

    // =========================================================================
    // RULE 7: GENERATE AI REPLY ONCE
    // Only generate if we are sending or drafting a review
    // =========================================================================
    const aiResult = await generateAutoReplyText({
      from: payload.from,
      fromName: payload.fromName,
      subject: payload.subject,
      body: payload.body,
      companyName: payload.companyName,
      threadHistory: completeThreadContext, // Full multi-turn conversation context
    });

    // =========================================================================
    // RULE 8: DISPATCH SMTP REPLY ONCE
    // =========================================================================
    let smtpResult: SendMailResult;

    if (shouldSendAutoReply) {
      smtpResult = await sendLiveEmail({
        tenantId: getInboundCtx().tenantId,
        to: payload.from,
        subject: replySubject,
        text: aiResult.replyText,
        inReplyTo: incomingMsgId,
        references: [incomingMsgId, ...(payload.inReplyTo ? [payload.inReplyTo] : [])],
      });
    } else {
      smtpResult = {
        success: false,
        simulated: pipelineConfig.emailMode === 'SIMULATION',
        error: replyDecisionReason,
      };
    }

    // =========================================================================
    // RULE 9: MARK GMAIL MESSAGE AS PROCESSED / REPLIED
    // Save AI reply and update idempotency key immediately!
    // =========================================================================
    let aiReplyMessage: any = undefined;
    const aiMsgId = (smtpResult.success && smtpResult.messageId)
      ? smtpResult.messageId
      : `<reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@amaavigo.com>`;

    if (shouldSendAutoReply) {
      // 1. Mark incoming customer message as replied in memory and thread
      incomingMessage.aiReplied = true;
      (incomingMessage as any).repliedAt = nowIso;
      (incomingMessage as any).repliedByMessageId = aiMsgId;

      const threadMsg = thread.find(
        (m) => m.gmailMessageId === incomingMsgId || m.messageId === incomingMessage.messageId
      );
      if (threadMsg) {
        threadMsg.aiReplied = true;
        threadMsg.repliedAt = nowIso;
        threadMsg.repliedByMessageId = aiMsgId;
      }

      // 2. Mark in persistent idempotency store (persists to disk)
      markMessageAsReplied(incomingMsgId, aiMsgId);

      // 3. Update Conversation Turn Tracker
      conversationTurnMap.set(senderEmail, {
        email: senderEmail,
        lastIncomingMessageId: incomingMsgId,
        lastIncomingText: payload.body,
        lastRepliedMessageId: incomingMsgId,
        replyCountForThisTurn: 1,
        waitingForCustomerReply: true,
        lastAutoReplyTimestamp: nowIso,
        updatedAt: nowIso,
      });

      // 4. Save AI reply to thread
      aiReplyMessage = {
        messageId: `msg-reply-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@amaavigo.com`,
        gmailMessageId: aiMsgId,
        gmailThreadId: threadId,
        conversationId,
        channel: 'EMAIL' as const,
        direction: 'OUTBOUND' as const,
        senderType: 'AI' as const,
        senderName: isUmrahBrand ? 'Umrah360 AI Automation' : `${brand.aiAgentName} Automation`,
        senderEmail: targetMailbox,
        text: aiResult.replyText,
        timestamp: nowIso,
        sentAt: nowIso,
        receivedAt: nowIso,
        createdAt: nowIso,
        aiProcessed: true,
        aiGenerated: true,
        confidence: 0.96,
        emailMeta: {
          subject: replySubject,
          from: targetMailbox,
          to: payload.from,
          inReplyTo: incomingMsgId,
          references: [incomingMsgId, ...(payload.inReplyTo ? [payload.inReplyTo] : [])],
          messageId: aiMsgId,
        },
        smtpStatus: smtpResult.success ? 'DELIVERED' : (smtpResult.simulated ? 'SIMULATED' : 'DELIVERY_FAILED'),
        smtpError: smtpResult.success ? undefined : (smtpResult.error || 'SMTP delivery pending configuration'),
      };

      thread.push(aiReplyMessage);
      console.log(`[Unified Inbox Idempotency] Successfully generated and stored AI auto-reply to message ${incomingMsgId}. SMTP status: ${smtpResult.success ? 'Delivered' : smtpResult.error}`);
    }

    // =========================================================================
    // RULE 10: BUILD FULL CRM ENTITIES
    // =========================================================================
    const isOutboundCampaignMatch = campaignReplyResult.isCampaignLead ||
      matched.lead?.leadType === 'OUTBOUND' ||
      Boolean(matched.lead?.campaignId) ||
      Boolean(matched.conversation?.campaignId);

    const effectiveCampaignId = campaignReplyResult.campaignId ||
      campaignReplyResult.campaignLead?.campaignId ||
      matched.lead?.campaignId ||
      matched.conversation?.campaignId;

    const effectiveCampaignName = campaignReplyResult.campaignName ||
      matched.lead?.campaignName ||
      'Outbound Campaign';

    const crmEntities: InboundCrmEntities = {
      contact: {
        ...(matched.contact || {}),
        contactId,
        firstName,
        lastName,
        email: payload.from,
        companyName: matched.contact?.companyName || payload.companyName || brandFallbackAgency(brand, firstName),
        phone: matched.contact?.phone || payload.phone || (isUmrahBrand ? '+91 98200 12345' : ''),
        createdAt: matched.contact?.createdAt || nowIso,
        updatedAt: nowIso,
        lastActivityAt: nowIso,
      },
      lead: {
        ...(matched.lead || {}),
        leadId,
        contactId,
        source: matched.lead?.source || 'EMAIL',
        leadType: isOutboundCampaignMatch ? 'OUTBOUND' : (matched.lead?.leadType || 'INBOUND'),
        campaignId: effectiveCampaignId,
        campaignName: isOutboundCampaignMatch ? effectiveCampaignName : matched.lead?.campaignName,
        status: matched.lead?.status || (aiResult.handoffTriggered ? 'HUMAN_HANDOFF' : 'ENGAGED'),
        leadScore: Math.max(matched.lead?.leadScore || 75, aiResult.leadScore),
        intent: 'HIGH',
        buyingStage: matched.lead?.buyingStage || aiResult.buyingStage,
        serviceInterest: matched.lead?.serviceInterest || (isOutboundCampaignMatch ? `Outbound Campaign: ${effectiveCampaignName}` : payload.subject),
        requirements: matched.lead?.requirements || [payload.subject],
        aiSummary: matched.lead?.aiSummary || (isOutboundCampaignMatch ? `Outbound campaign reply received for "${effectiveCampaignName}".` : `Inbound email to ${targetMailbox}: "${payload.subject}". Intent: HIGH, Score: ${aiResult.leadScore}/100.`),
        createdAt: matched.lead?.createdAt || nowIso,
        updatedAt: nowIso,
        lastActivityAt: nowIso,
      },
      conversation: {
        ...(matched.conversation || {}),
        conversationId,
        contactId,
        leadId,
        campaignId: effectiveCampaignId,
        channel: matched.conversation?.channel || 'EMAIL',
        direction: 'INBOUND',
        status: pipelineConfig.emailMode === 'REVIEW' ? 'REVIEW' : 'ACTIVE',
        aiEnabled: matched.conversation?.aiEnabled !== undefined ? matched.conversation.aiEnabled : (pipelineConfig.emailMode === 'AUTO' && !aiResult.handoffTriggered),
        humanHandoff: matched.conversation?.humanHandoff !== undefined ? matched.conversation.humanHandoff : (pipelineConfig.emailMode !== 'AUTO' || aiResult.handoffTriggered),
        managementMode: (pipelineConfig.emailMode === 'AUTO' && !aiResult.handoffTriggered) ? 'AI' : 'HUMAN',
        emailThreadId: threadId,
        gmailThreadId: threadId,
        isRead: false,
        readAt: undefined,
        unread: true,
        unreadCount: (matched.conversation?.unreadCount || 0) + 1,
        conversationSummary: matched.conversation?.conversationSummary || `Email dialogue with ${displayName} (${payload.from}). Subject: "${payload.subject}".`,
        startedAt: matched.conversation?.startedAt || nowIso,
        lastMessageAt: nowIso,
        lastMessageText: (shouldSendAutoReply && smtpResult.success) ? aiResult.replyText.slice(0, 120) : payload.body.slice(0, 120),
        draftReply: pipelineConfig.emailMode === 'REVIEW' ? {
          draftId: `draft-${Date.now()}`,
          text: aiResult.replyText,
          subject: replySubject,
          generatedAt: nowIso,
          status: 'PENDING' as const,
        } : undefined,
        createdAt: matched.conversation?.createdAt || nowIso,
        updatedAt: nowIso,
        customerEmail: senderEmail,
        thankYouEmailSent: matched.conversation?.thankYouEmailSent !== undefined ? matched.conversation.thankYouEmailSent : true,
        thankYouEmailDeliveredAt: matched.conversation?.thankYouEmailDeliveredAt,
        thankYouSmtpMessageId: matched.conversation?.thankYouSmtpMessageId,
      },
      incomingMessage,
      aiReplyMessage,
      allThreadMessages: [...thread],
      activity: {
        activityId: `act-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        leadId,
        contactId,
        type: 'PROSPECT_REPLIED',
        title: `Inbound Email from ${displayName}`,
        description: `Subject: "${payload.subject}". Auto-reply status: ${shouldSendAutoReply ? (smtpResult.success ? 'Delivered via SMTP' : `Failed: ${smtpResult.error}`) : replyDecisionReason}`,
        timestamp: nowIso,
      },
    };

    const record: ProcessedInboundEmailResult = {
      messageId: incomingMsgId,
      from: payload.from,
      fromName: displayName,
      to: targetMailbox,
      subject: payload.subject,
      incomingText: payload.body,
      replySubject,
      replyText: aiResult.replyText,
      shouldSendAutoReply,
      replyDecisionReason,
      smtpDelivery: smtpResult,
      handoffTriggered: aiResult.handoffTriggered,
      handoffReason: aiResult.handoffReason,
      leadScore: aiResult.leadScore,
      intent: 'HIGH',
      buyingStage: aiResult.buyingStage,
      timestamp: nowIso,
      tenantId: getInboundCtx().tenantId,
      crmEntities,
    };

    recentProcessedEmails.unshift(record);
    if (recentProcessedEmails.length > 50) {
      recentProcessedEmails.pop();
    }

    // Persist CRM entities to Firestore once at arrival time (only if the message qualifies)
    if (isFirebaseConfigured && db && crmEntities && !qualification.qualifies) {
      console.log(`[Inbound Pipeline] Message ${incomingMsgId} is unqualified/ignored. Skipping CRM persistence so no lead/contact is created.`);
    } else if (isFirebaseConfigured && db && crmEntities) {
      try {
        // Await every write: on serverless hosts the function can be frozen right after the
        // response is sent, which would silently drop un-awaited writes (reply never saved).
        const writes: Promise<unknown>[] = [];
        if (crmEntities.contact) {
          writes.push(safeSetDoc(tenantRepo(getInboundCtx()).contactDoc(crmEntities.contact.contactId), crmEntities.contact, { merge: true }));
        }
        if (crmEntities.lead) {
          writes.push(safeSetDoc(tenantRepo(getInboundCtx()).leadDoc(crmEntities.lead.leadId), crmEntities.lead, { merge: true }));
        }
        if (crmEntities.conversation) {
          writes.push(safeSetDoc(tenantRepo(getInboundCtx()).conversationDoc(crmEntities.conversation.conversationId), crmEntities.conversation, { merge: true }));
        }
        if (crmEntities.incomingMessage) {
          writes.push(safeSetDoc(tenantRepo(getInboundCtx()).messageDoc(crmEntities.incomingMessage.messageId), crmEntities.incomingMessage, { merge: true }));
        }
        if (crmEntities.aiReplyMessage) {
          writes.push(safeSetDoc(tenantRepo(getInboundCtx()).messageDoc(crmEntities.aiReplyMessage.messageId), crmEntities.aiReplyMessage, { merge: true }));
        }
        if (crmEntities.activity) {
          writes.push(safeSetDoc(tenantRepo(getInboundCtx()).leadActivityDoc(crmEntities.activity.activityId), crmEntities.activity));
        }
        await Promise.all(writes);
      } catch (err) {
        console.warn('[Inbound Pipeline] Notice syncing CRM entities to Firestore:', err);
      }
    }

    return record;
  } finally {
    // Release in-flight concurrency lock
    inFlightMessageIds.delete(incomingMsgId);
  }
}

let isImapPollingActive = false;
let lastImapPollTimestamp = 0;
const IMAP_POLL_MIN_INTERVAL_MS = 15000; // 15s cooldown to prevent IMAP and proxy rate limit exceeding

/**
 * Polls IMAP inbox automation@amaavigo.com, processes all new emails, and dispatches real SMTP replies!
 */
export async function pollAndProcessImapMailbox(forceOrCtx: boolean | TenantContext = false): Promise<{
  success: boolean;
  polledCount: number;
  results: ProcessedInboundEmailResult[];
  error?: string;
}> {
  const force = forceOrCtx === true;
  const callerCtx = typeof forceOrCtx === 'object' ? forceOrCtx : getInboundCtx();

  // The shared mailbox only ever belongs to its owner workspace. Any other workspace is a no-op,
  // otherwise its login would pull the owner's customer emails into the wrong tenant.
  if (callerCtx.tenantId !== getImapOwnerTenantId()) {
    return { success: true, polledCount: 0, results: [] };
  }
  return runWithInboundCtx(callerCtx, () => pollImapForOwner(force));
}

async function pollImapForOwner(force: boolean): Promise<{
  success: boolean;
  polledCount: number;
  results: ProcessedInboundEmailResult[];
  error?: string;
}> {
  const now = Date.now();
  if (isImapPollingActive) {
    return {
      success: true,
      polledCount: 0,
      results: getRecentProcessedEmails(getInboundCtx().tenantId).slice(0, 10),
    };
  }

  if (!force && now - lastImapPollTimestamp < IMAP_POLL_MIN_INTERVAL_MS) {
    return {
      success: true,
      polledCount: 0,
      results: getRecentProcessedEmails(getInboundCtx().tenantId).slice(0, 10),
    };
  }

  isImapPollingActive = true;
  lastImapPollTimestamp = now;

  try {
    const imapResult = await pollUnreadEmails(true);

    if (!imapResult.success) {
      return {
        success: false,
        polledCount: 0,
        results: [],
        error: imapResult.error,
      };
    }

    const processedResults: ProcessedInboundEmailResult[] = [];

    for (const email of imapResult.emails) {
      console.log(`[IMAP Inbound] Found live email from ${email.from}: "${email.subject}"`);
      const result = await processLiveInboundEmail({
        from: email.from,
        fromName: email.fromName,
        to: email.to,
        subject: email.subject,
        body: email.text || '',
        messageId: email.messageId,
        inReplyTo: email.inReplyTo,
        references: email.references,
      });
      processedResults.push(result);
    }

    return {
      success: true,
      polledCount: processedResults.length,
      results: processedResults,
    };
  } catch (err: any) {
    console.error('[IMAP Inbound] Error during scheduled mailbox poll:', err?.message || err);
    return {
      success: false,
      polledCount: 0,
      results: [],
      error: err?.message || 'IMAP polling failed',
    };
  } finally {
    isImapPollingActive = false;
  }
}