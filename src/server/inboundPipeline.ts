import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { sendLiveEmail, SendMailResult, getSmtpConfig } from './smtpService.js';
import { pollUnreadEmails, FetchedInboundEmail } from './imapService.js';
import { getPublishedKnowledgeDocs } from './knowledgeService.js';
import {
  initPersistentIdempotencyStore,
  isMessageAlreadyProcessed,
  recordProcessedInboundEmail,
  normalizeIdentifier,
} from './firestorePersistence.js';
import { handleIncomingCampaignLeadReply } from './campaignService.js';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { doc } from 'firebase/firestore';
import { safeSetDoc } from './firestoreUtils.js';

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
// PERSISTENT GMAIL IDEMPOTENCY STORE
// =========================================================================
const IDEMPOTENCY_FILE = path.join(process.cwd(), '.processed_gmail_messages.json');
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

// Load persisted state from disk and Firestore
try {
  if (fs.existsSync(IDEMPOTENCY_FILE)) {
    const raw = fs.readFileSync(IDEMPOTENCY_FILE, 'utf-8');
    const parsed = JSON.parse(raw);
    if (Array.isArray(parsed)) {
      for (const item of parsed) {
        if (item && item.gmailMessageId) {
          processedRecordsMap.set(item.gmailMessageId, item);
          if (item.aiReplied) {
            repliedMessageIds.add(item.gmailMessageId);
          }
        }
      }
    }
  } else {
    // Write initial seed records to disk
    const items = Array.from(processedRecordsMap.values());
    fs.writeFileSync(IDEMPOTENCY_FILE, JSON.stringify(items, null, 2), 'utf-8');
  }
} catch (err) {
  console.warn('[Idempotency Store] Warning loading idempotency file:', err);
}

// Background sync from persistent Firestore ledger on module startup
initPersistentIdempotencyStore().then((stats) => {
  console.log(`[Inbound Pipeline] Idempotency store initialized with ${stats.totalLoaded} records (${stats.repliedCount} replied) from Firestore.`);
}).catch((err) => {
  console.warn('[Inbound Pipeline] Notice initializing Firestore idempotency store:', err);
});

function saveProcessedRecordsToDisk(): void {
  try {
    const items = Array.from(processedRecordsMap.values());
    fs.writeFileSync(IDEMPOTENCY_FILE, JSON.stringify(items, null, 2), 'utf-8');
  } catch (err) {
    console.warn('[Idempotency Store] Warning persisting idempotency file:', err);
  }
}

export function recordProcessedMessage(record: ProcessedMessageRecord): void {
  const existing = processedRecordsMap.get(record.gmailMessageId);
  processedRecordsMap.set(record.gmailMessageId, {
    ...existing,
    ...record,
  });
  if (record.aiReplied) {
    repliedMessageIds.add(record.gmailMessageId);
  }
  saveProcessedRecordsToDisk();

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
  }).catch((e) => console.warn('[Idempotency Store] Firestore record error:', e));
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
  saveProcessedRecordsToDisk();

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
  }).catch((e) => console.warn('[Idempotency Store] Firestore markMessageAsReplied error:', e));
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

export function getRecentProcessedEmails(): ProcessedInboundEmailResult[] {
  return [...recentProcessedEmails];
}

export function getConversationTurnStates(): Record<string, ConversationTurnState> {
  const result: Record<string, ConversationTurnState> = {};
  for (const [k, v] of conversationTurnMap.entries()) {
    result[k] = v;
  }
  return result;
}

export function getThreadMessages(conversationId: string): any[] {
  return [...(conversationThreadMessagesMap.get(conversationId) || [])];
}

export function getAllThreadMessages(): Record<string, any[]> {
  const result: Record<string, any[]> = {};
  for (const [k, v] of conversationThreadMessagesMap.entries()) {
    result[k] = [...v];
  }
  return result;
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

  // Determine if this is a follow-up turn in an ongoing dialogue
  const customerMessagesCount = threadHistory
    ? threadHistory.filter((m: any) => m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT').length
    : 1;
  const isFollowUpTurn = customerMessagesCount > 1 || (threadHistory && threadHistory.length > 1);

  // Format complete loaded thread context for deep AI analysis
  const formattedThreadContext = (threadHistory && threadHistory.length > 0)
    ? threadHistory.map((m: any, idx: number) => {
        const isCustomer = m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT';
        const roleLabel = isCustomer ? `CUSTOMER (${m.senderName || from})` : 'AI ASSISTANT (Umrah360)';
        return `[Message ${idx + 1} - ${roleLabel} at ${m.timestamp}]:\n${m.text}`;
      }).join('\n\n')
    : `[Message 1 - CUSTOMER (${fromName || from})]:\n${body}`;

  // Intent classification
  const isIndividualPilgrimOrFamily =
    /myself|my family|for family|for myself|as a customer|planning umrah|booking experience|customized package|customize a package|book a customized|hotels in makkah|flights.*hotels|transfers.*meals.*visa|real-time.*availability|online payment|entire booking.*online|go through a travel agency|direct booking|retail/i.test(
      combinedText
    );
  const isTwentyUsers = /20 user|20 seat|25 user|twenty user|enterprise/i.test(combinedText);
  const isB2bPortal = /b2b|sub-agent|reseller|credit limit|wallet|allotment|offline block/i.test(combinedText);
  const isSaaSPricing = !isIndividualPilgrimOrFamily && /pricing|price|cost|quote|subscription|rate|\$15|\$199|\$499/i.test(combinedText);

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

  const targetMailbox = process.env.SMTP_USER || process.env.IMAP_USER || 'amaavigo@gmail.com';
  const senderGreetingName = fromName ? fromName.split(' ')[0] : from.split('@')[0];

  // Prepare full knowledgebase grounding text from dynamic published knowledge documents
  const publishedDocs = getPublishedKnowledgeDocs();
  const kbGroundingText = publishedDocs.map(
    (doc) => `=== [${doc.category}] ${doc.title} ===\n${doc.content}`
  ).join('\n\n');

  // Attempt Gemini generation if GEMINI_API_KEY is available
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are the official AI automation representative for Umrah360 (www.umrah360.in), responding to an email on behalf of ${targetMailbox}.

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
     • Greet briefly and warmly: "Walaikum Assalam ${senderGreetingName},"
   - If this is TURN 1 (Brand new customer inquiry):
     • Greet with: "Assalamu Alaikum ${senderGreetingName},"
     • Clearly explain that Umrah360 is the enterprise technology platform that powers licensed travel agencies, and on partner agencies' websites pilgrims can customize real-time hotels, flights, and Saudi e-visas.
2. ACCURACY & POLICIES:
   - Ground all answers strictly in the Umrah360 knowledge base.
   - If asking about partner travel agencies in their city/region, confirm we have authorized partner agencies and ask for their travel dates and group size to connect them.
   - If travel agency asking about B2B/SaaS plans: Mention Lite ($15/user/month billed annually) and Growth.
   - If 20+ users: Explicitly mention Enterprise volume licensing and senior specialist follow-up.
3. Keep the response polite, helpful, crisp, and professional.
4. EMAIL FORMATTING RULE (MANDATORY): Never use Markdown symbols in email replies. Do NOT use **, ##, ###, *, backticks, or similar formatting symbols. Write emails as natural, professional plain text with simple paragraphs and numbered lists where needed. The final email must look human-written, not AI-generated.
5. Conclude with:
Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;

      // Try candidate models with graceful fallback
      const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
      for (const modelName of candidateModels) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Model timeout after 14s')), 14000)
          );
          const response: any = await Promise.race([
            ai.models.generateContent({
              model: modelName,
              contents: prompt,
            }),
            timeoutPromise,
          ]);

          if (response?.text && response.text.trim().length > 30) {
            return {
              replyText: response.text.trim(),
              handoffTriggered,
              handoffReason,
              leadScore,
              buyingStage,
            };
          }
        } catch (modelErr: any) {
          console.warn(`[Gemini ${modelName}] Attempt failed:`, modelErr?.message?.slice(0, 80));
        }
      }
    } catch (geminiErr) {
      console.warn('[Gemini Pipeline] Fallback to domain-grounded knowledge response:', geminiErr);
    }
  }

  // Domain-grounded fallback response engine (100% accurate to umrah360.in)
  let replyText = '';

  if (isFollowUpTurn) {
    if (/mumbai|delhi|bangalore|hyderabad|chennai|kolkata|lucknow|ahmedabad|kashmir|london|dubai|partner|agency|agencies|recommend|which/i.test(combinedText)) {
      replyText = `Walaikum Assalam ${senderGreetingName},

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
      replyText = `Walaikum Assalam ${senderGreetingName},

Thank you for following up!

To assist you with your pilgrimage planning: on booking platforms powered by Umrah360, your customized itinerary is generated with live availability and transparent pricing through our licensed partner travel agencies.

Could you please share your travel month and group size so we can connect you directly with a verified local specialist?

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
    }
  } else if (isIndividualPilgrimOrFamily) {
    replyText = `Assalamu Alaikum ${senderGreetingName},

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
    replyText = `Assalamu Alaikum ${senderGreetingName},

Thank you for your interest in Umrah360!

For enterprise teams of 20+ user seats, Umrah360 provides tailored volume licensing, dedicated cloud infrastructure, unlimited sub-agent distribution, and custom SLA commitments.

Because Enterprise accounts are customized to your agency's transaction volume, I have escalated your inquiry to our Senior Solutions Specialist to share a tailored proposal and schedule a short walkthrough. Someone will reach out to you directly shortly.

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
  } else if (isB2bPortal) {
    replyText = `Assalamu Alaikum ${senderGreetingName},

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
    replyText = `Assalamu Alaikum ${senderGreetingName},

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
    replyText = `Assalamu Alaikum ${senderGreetingName},

Thank you for contacting Umrah360!

Umrah360 (www.umrah360.in) is the leading all-in-one cloud ERP, CRM, and dynamic packaging platform purpose-built for Hajj and Umrah tour operators, travel agencies, and consolidators. It unifies lead management, FIT and group package creation, dynamic multi-currency costing (SAR/USD/INR), Saudi visa tracking, hotel & transport allotments, and sub-agent B2B distribution into a single cohesive system.

Are you currently handling your operations through spreadsheets or looking to upgrade your agency technology?

Regards,
Umrah360 Automation Team
${targetMailbox}
www.umrah360.in`;
  }

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
  companyName?: string;
  phone?: string;
  isTestSimulation?: boolean;
}): Promise<ProcessedInboundEmailResult> {
  const targetMailbox = process.env.SMTP_USER || process.env.IMAP_USER || 'amaavigo@gmail.com';
  const incomingMsgId = resolveGmailMessageId(payload, targetMailbox);
  const replySubject = payload.subject.toLowerCase().startsWith('re:') ? payload.subject : `Re: ${payload.subject}`;
  const nowIso = new Date().toISOString();
  const senderEmail = payload.from.toLowerCase().trim();

  const safeId = senderEmail.replace(/[^a-z0-9]/gi, '_');
  const contactId = `contact-${safeId}`;
  const leadId = `lead-${safeId}`;
  const conversationId = `conv-${safeId}`;
  const threadId = `thread-${safeId}`;

  const displayName = payload.fromName || payload.from.split('@')[0];
  const nameParts = displayName.split(' ');
  const firstName = nameParts[0] || 'Inbound';
  const lastName = nameParts.slice(1).join(' ') || 'Prospect';

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
        contact: { contactId, firstName, lastName, email: payload.from, companyName: payload.companyName || 'Umrah360 Internal', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
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
  const firestoreCheck = await isMessageAlreadyProcessed(incomingMsgId, payload.from);
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
    try {
      await handleIncomingCampaignLeadReply({
        fromEmail: payload.from,
        subject: payload.subject,
        body: payload.body,
        gmailMessageId: incomingMsgId,
        gmailThreadId: threadId,
      });
    } catch (campaignErr) {
      console.warn('[Unified Inbox] Campaign lead tracking hook notice:', campaignErr);
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
    // RULE 6: EVALUATE CHANNEL MODE
    // =========================================================================
    let shouldSendAutoReply = false;
    let replyDecisionReason = '';

    if (pipelineConfig.emailMode === 'SIMULATION') {
      shouldSendAutoReply = false;
      replyDecisionReason = 'Email channel mode is SIMULATION: auto-reply disabled; messages route to human agent.';
    } else if (pipelineConfig.emailMode === 'REVIEW') {
      shouldSendAutoReply = false;
      replyDecisionReason = 'Email channel mode is REVIEW: AI response drafted for human approval prior to dispatch.';
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

    if (shouldSendAutoReply && smtpResult.success) {
      // 1. Mark incoming customer message as replied in memory and thread ONLY when SMTP send succeeds
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

      // 2. Mark in persistent idempotency store
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
        senderName: 'Umrah360 AI Automation',
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
        smtpStatus: 'DELIVERED',
      };

      thread.push(aiReplyMessage);
      console.log(`[Unified Inbox Idempotency] Successfully generated and delivered AI auto-reply to message ${incomingMsgId}.`);
    } else if (shouldSendAutoReply) {
      // SMTP delivery failed: DO NOT mark as replied, store as DELIVERY_FAILED so retry is allowed
      incomingMessage.aiReplied = false;
      const threadMsg = thread.find(
        (m) => m.gmailMessageId === incomingMsgId || m.messageId === incomingMessage.messageId
      );
      if (threadMsg) {
        threadMsg.aiReplied = false;
      }

      // Save draft AI reply message in thread with DELIVERY_FAILED status
      aiReplyMessage = {
        messageId: `msg-failed-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@amaavigo.com`,
        gmailMessageId: aiMsgId,
        gmailThreadId: threadId,
        conversationId,
        channel: 'EMAIL' as const,
        direction: 'OUTBOUND' as const,
        senderType: 'AI' as const,
        senderName: 'Umrah360 AI Automation',
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
        smtpStatus: smtpResult.simulated ? 'SIMULATED' : 'DELIVERY_FAILED',
        smtpError: smtpResult.error || 'SMTP delivery failed',
      };

      thread.push(aiReplyMessage);
      console.warn(`[Unified Inbox Delivery Failure] Delivery failed for message ${incomingMsgId}: ${smtpResult.error}. Retaining aiReplied=false for retry.`);
    }

    // =========================================================================
    // RULE 10: BUILD FULL CRM ENTITIES
    // =========================================================================
    const crmEntities: InboundCrmEntities = {
      contact: {
        contactId,
        firstName,
        lastName,
        email: payload.from,
        companyName: payload.companyName || `${firstName}'s Pilgrimage Agency`,
        phone: payload.phone || '+91 98200 12345',
        createdAt: nowIso,
        updatedAt: nowIso,
        lastActivityAt: nowIso,
      },
      lead: {
        leadId,
        contactId,
        source: 'EMAIL',
        leadType: 'INBOUND',
        status: aiResult.handoffTriggered ? 'HUMAN_HANDOFF' : 'ENGAGED',
        leadScore: aiResult.leadScore,
        intent: aiResult.leadScore >= 80 ? 'HIGH' : 'MEDIUM',
        buyingStage: aiResult.buyingStage,
        serviceInterest: payload.subject,
        requirements: [payload.subject],
        aiSummary: `Inbound email to ${targetMailbox}: "${payload.subject}". Intent: HIGH, Score: ${aiResult.leadScore}/100.`,
        createdAt: nowIso,
        updatedAt: nowIso,
        lastActivityAt: nowIso,
      },
      conversation: {
        conversationId,
        contactId,
        leadId,
        channel: 'EMAIL',
        direction: 'INBOUND',
        status: pipelineConfig.emailMode === 'REVIEW' ? 'REVIEW' : 'ACTIVE',
        aiEnabled: pipelineConfig.emailMode === 'AUTO' && !aiResult.handoffTriggered,
        humanHandoff: pipelineConfig.emailMode !== 'AUTO' || aiResult.handoffTriggered,
        managementMode: (pipelineConfig.emailMode === 'AUTO' && !aiResult.handoffTriggered) ? 'AI' : 'HUMAN',
        emailThreadId: threadId,
        gmailThreadId: threadId,
        isRead: false,
        readAt: undefined,
        unread: true,
        unreadCount: 1,
        conversationSummary: `Email dialogue with ${displayName} (${payload.from}). Subject: "${payload.subject}".`,
        startedAt: nowIso,
        lastMessageAt: nowIso,
        lastMessageText: (shouldSendAutoReply && smtpResult.success) ? aiResult.replyText.slice(0, 120) : payload.body.slice(0, 120),
        draftReply: pipelineConfig.emailMode === 'REVIEW' ? {
          draftId: `draft-${Date.now()}`,
          text: aiResult.replyText,
          subject: replySubject,
          generatedAt: nowIso,
          status: 'PENDING' as const,
        } : undefined,
        createdAt: nowIso,
        updatedAt: nowIso,
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
      crmEntities,
    };

    recentProcessedEmails.unshift(record);
    if (recentProcessedEmails.length > 50) {
      recentProcessedEmails.pop();
    }

    // Persist CRM entities to Firestore once at arrival time
    if (isFirebaseConfigured && db && crmEntities) {
      try {
        if (crmEntities.contact) {
          safeSetDoc(doc(db, 'contacts', crmEntities.contact.contactId), crmEntities.contact, { merge: true }).catch(() => {});
        }
        if (crmEntities.lead) {
          safeSetDoc(doc(db, 'leads', crmEntities.lead.leadId), crmEntities.lead, { merge: true }).catch(() => {});
        }
        if (crmEntities.conversation) {
          safeSetDoc(doc(db, 'conversations', crmEntities.conversation.conversationId), crmEntities.conversation, { merge: true }).catch(() => {});
        }
        if (crmEntities.incomingMessage) {
          safeSetDoc(doc(db, 'messages', crmEntities.incomingMessage.messageId), crmEntities.incomingMessage, { merge: true }).catch(() => {});
        }
        if (crmEntities.aiReplyMessage) {
          safeSetDoc(doc(db, 'messages', crmEntities.aiReplyMessage.messageId), crmEntities.aiReplyMessage, { merge: true }).catch(() => {});
        }
        if (crmEntities.activity) {
          safeSetDoc(doc(db, 'lead_activities', crmEntities.activity.activityId), crmEntities.activity).catch(() => {});
        }
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

/**
 * Polls IMAP inbox automation@amaavigo.com, processes all new emails, and dispatches real SMTP replies!
 */
export async function pollAndProcessImapMailbox(): Promise<{
  success: boolean;
  polledCount: number;
  results: ProcessedInboundEmailResult[];
  error?: string;
}> {
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
      });
      processedResults.push(result);
    }

    return {
      success: true,
      polledCount: processedResults.length,
      results: processedResults,
    };
  } catch (err: any) {
    console.error('[IMAP Pipeline Error]:', err);
    return {
      success: false,
      polledCount: 0,
      results: [],
      error: err.message || 'Error processing IMAP inbox',
    };
  }
}
