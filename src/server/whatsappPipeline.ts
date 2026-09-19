import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import {
  sendLiveWhatsAppMessage,
  getWhatsAppConfig,
  normalizePhoneNumber,
  formatPhoneNumberForDisplay,
  WhatsAppSendResult,
} from './whatsappService.js';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from '../services/knowledgeData.js';

export interface WhatsAppInboundPayload {
  object?: string;
  entry?: Array<{
    id?: string;
    changes?: Array<{
      value?: {
        messaging_product?: string;
        metadata?: {
          display_phone_number?: string;
          phone_number_id?: string;
        };
        contacts?: Array<{
          profile?: { name?: string };
          wa_id?: string;
        }>;
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string | number;
          text?: { body?: string };
          type?: string;
        }>;
      };
      field?: string;
    }>;
  }>;
}

export interface WhatsAppPipelineResult {
  status: 'PROCESSED' | 'ALREADY_PROCESSED' | 'SAVED_HUMAN_MODE' | 'IGNORED_SELF' | 'ERROR';
  conversationId?: string;
  contactId?: string;
  leadId?: string;
  inboundMessageId?: string;
  outboundReplyMessageId?: string;
  aiReplyText?: string;
  mode?: 'AUTO' | 'HUMAN';
  error?: string;
  entities?: any;
}

// Memory and file storage for idempotency tracking
const PROCESSED_MSG_CACHE_FILE = path.join(process.cwd(), '.processed_whatsapp_messages.json');
const processedWhatsAppIds = new Set<string>();

function loadProcessedIds() {
  try {
    if (fs.existsSync(PROCESSED_MSG_CACHE_FILE)) {
      const data = JSON.parse(fs.readFileSync(PROCESSED_MSG_CACHE_FILE, 'utf-8'));
      if (Array.isArray(data)) {
        data.forEach((id: string) => processedWhatsAppIds.add(id));
      }
    }
  } catch (err) {
    console.warn('[WhatsApp Pipeline] Error loading processed message IDs:', err);
  }
}
loadProcessedIds();

function saveProcessedId(msgId: string) {
  if (!msgId) return;
  processedWhatsAppIds.add(msgId);
  try {
    const list = Array.from(processedWhatsAppIds).slice(-1000); // keep last 1000
    fs.writeFileSync(PROCESSED_MSG_CACHE_FILE, JSON.stringify(list, null, 2));
  } catch (err) {
    console.warn('[WhatsApp Pipeline] Error saving processed message ID:', err);
  }
}

// In-memory runtime state for contacts and conversations if offline or in dev
const runtimeWhatsAppConversations = new Map<string, any>();
const runtimeWhatsAppContacts = new Map<string, any>();
const runtimeWhatsAppMessages = new Map<string, any[]>();

// In-memory or persisted channel mode
let currentWhatsAppMode: 'AUTO' | 'HUMAN' = 'AUTO';

export function getPersistedWhatsAppMode(): 'AUTO' | 'HUMAN' {
  try {
    const modeFile = path.join(process.cwd(), '.whatsapp_mode.json');
    if (fs.existsSync(modeFile)) {
      const data = JSON.parse(fs.readFileSync(modeFile, 'utf-8'));
      if (data.mode === 'AUTO' || data.mode === 'HUMAN') {
        currentWhatsAppMode = data.mode;
      }
    }
  } catch {
    // default to AUTO
  }
  return currentWhatsAppMode;
}

export function setPersistedWhatsAppMode(mode: 'AUTO' | 'HUMAN') {
  currentWhatsAppMode = mode;
  try {
    const modeFile = path.join(process.cwd(), '.whatsapp_mode.json');
    fs.writeFileSync(modeFile, JSON.stringify({ mode, updatedAt: new Date().toISOString() }, null, 2));
    console.log(`[WhatsApp Pipeline] Persisted WhatsApp mode updated to: ${mode}`);
  } catch (err) {
    console.warn('[WhatsApp Pipeline] Failed to persist mode:', err);
  }
}

/**
 * Generates an AI response grounded in the Umrah360 Knowledge Base
 */
async function generateWhatsAppAiReply(params: {
  customerName: string;
  customerPhone: string;
  incomingText: string;
  conversationHistory: Array<{ senderType: string; text: string; timestamp: string }>;
}): Promise<{ replyText: string; handoffTriggered: boolean; handoffReason?: string }> {
  const { customerName, customerPhone, incomingText, conversationHistory } = params;
  const config = getWhatsAppConfig();
  const greetingName = customerName ? customerName.split(' ')[0] : 'there';

  const isTwentyUsers = /20\s*(\+|plus)?\s*(users?|seats?|agents?|licenses?)|enterprise/i.test(incomingText);
  let handoffTriggered = isTwentyUsers;
  let handoffReason = isTwentyUsers ? 'Enterprise 20+ user inquiry requiring custom volume quotation' : undefined;

  const kbGroundingText = INITIAL_KNOWLEDGE_DOCUMENTS.map(
    (doc) => `=== [${doc.category}] ${doc.title} ===\n${doc.content}`
  ).join('\n\n');

  const formattedHistory = conversationHistory
    .map((m) => `[${m.senderType === 'CUSTOMER' ? 'Customer' : 'Umrah360 AI'} - ${m.timestamp}]: ${m.text}`)
    .join('\n');

  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are the official WhatsApp AI Concierge for Umrah360 (www.umrah360.in) communicating from official WhatsApp number ${config.displayPhoneNumber}.

OFFICIAL UMRAH360 KNOWLEDGE BASE (GROUND TRUTH):
${kbGroundingText}

THREAD HISTORY WITH THIS CUSTOMER:
${formattedHistory || '(No previous messages in thread)'}

NEW INCOMING WHATSAPP MESSAGE:
From: ${customerName} (${customerPhone})
Message Body:
${incomingText}

CRITICAL INSTRUCTIONS FOR WHATSAPP RESPONSE:
1. Ground all answers strictly in the Umrah360 knowledge base.
2. Tone & Format:
   - Friendly, warm, concise, and professional (ideal for WhatsApp reading).
   - Use clear paragraphs. Keep sentences crisp.
   - If first message: Start with a brief greeting like "Assalamu Alaikum ${greetingName}," or "Hello ${greetingName},".
   - If follow-up in thread: Continue naturally without repeating greetings or platform introductions.
3. Pricing & Features:
   - B2B Sub-Agent portal with dynamic costing, custom markups, credit limits, and instant PDF vouchers with agency logo.
   - Plans: Starter ($199/mo up to 3 users) | Growth ($499/mo up to 10 users) | Enterprise for 20+ users.
   - If 20+ users requested: Confirm that our enterprise solutions team will prepare a custom volume quote and assist with onboarding.
4. Keep the message under 150 words so it is easy to read on mobile.
5. End warmly with "Umrah360 Team (www.umrah360.in)".`;

      const candidateModels = ['gemini-2.5-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
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

          if (response?.text && response.text.trim().length > 15) {
            return {
              replyText: response.text.trim(),
              handoffTriggered,
              handoffReason,
            };
          }
        } catch (modelErr: any) {
          console.warn(`[WhatsApp Gemini ${modelName}] Attempt failed:`, modelErr?.message?.slice(0, 80));
        }
      }
    } catch (geminiErr) {
      console.warn('[WhatsApp Gemini] Fallback to domain response engine:', geminiErr);
    }
  }

  // Domain Grounded Knowledge Fallback
  let fallbackReply = '';
  const lower = incomingText.toLowerCase();

  if (lower.includes('b2b') || lower.includes('sub-agent') || lower.includes('sub agent') || lower.includes('voucher')) {
    fallbackReply = `Assalamu Alaikum ${greetingName}, yes! Umrah360 provides a complete white-label B2B Sub-Agent Portal. Your sub-agents get their own login with assigned credit limits, live package inventory, and automated PDF vouchers with your agency branding.\n\nWould you like a live 20-minute walkthrough demo?`;
  } else if (lower.includes('price') || lower.includes('cost') || lower.includes('plan') || lower.includes('subscription')) {
    if (isTwentyUsers) {
      fallbackReply = `Assalamu Alaikum ${greetingName}, for agencies with 20+ users, Umrah360 offers an Enterprise Custom Plan with dedicated account management, custom GDS integrations, and volume pricing. Our senior team will connect with you shortly with full details.`;
    } else {
      fallbackReply = `Assalamu Alaikum ${greetingName}, Umrah360 plans are tailored for pilgrimage operators:\n• Starter: $199/mo (up to 3 users)\n• Growth: $499/mo (up to 10 users)\n• Enterprise: Custom quote for 20+ users\n\nAll plans include dynamic package costing, Makkah/Madinah room allotments, and sub-agent portals.`;
    }
  } else if (lower.includes('demo') || lower.includes('meeting') || lower.includes('call')) {
    fallbackReply = `Walaikum Assalam ${greetingName}, we would be delighted to schedule a personalized live demonstration for your team. What day and time work best for you this week?`;
  } else {
    fallbackReply = `Assalamu Alaikum ${greetingName}, thank you for contacting Umrah360! We are the enterprise travel CRM & package automation platform built specifically for Umrah & Hajj operators.\n\nHow can we assist your agency operations today? (e.g. B2B Sub-Agent portals, Dynamic Costing sheets, or Multi-Currency pricing)`;
  }

  return {
    replyText: fallbackReply,
    handoffTriggered,
    handoffReason,
  };
}

/**
 * Main Inbound WhatsApp Processing Pipeline
 * Handles webhook payloads from Meta or simulated inbound messages.
 */
export async function processInboundWhatsAppMessage(params: {
  fromPhone: string;
  fromName?: string;
  text: string;
  messageId: string;
  timestamp?: string | number;
  displayPhoneNumber?: string;
  phoneNumberId?: string;
  forceMode?: 'AUTO' | 'HUMAN';
}): Promise<WhatsAppPipelineResult> {
  const {
    fromPhone,
    fromName = 'WhatsApp Traveler',
    text,
    messageId,
    timestamp,
    displayPhoneNumber,
    phoneNumberId,
    forceMode,
  } = params;

  const config = getWhatsAppConfig();
  const normalizedFrom = normalizePhoneNumber(fromPhone);
  const normalizedBusiness = normalizePhoneNumber(config.displayPhoneNumber);

  if (!normalizedFrom || !text || text.trim() === '') {
    return {
      status: 'ERROR',
      error: 'Missing phone number or message body',
    };
  }

  // 1. Idempotency Check
  if (messageId && processedWhatsAppIds.has(messageId)) {
    console.log(`[WhatsApp Pipeline] Message ${messageId} already processed. Skipping duplicate.`);
    return {
      status: 'ALREADY_PROCESSED',
      inboundMessageId: messageId,
    };
  }

  // 2. Self-Loop Check (Do not reply to messages originating from our own business phone number)
  if (normalizedFrom === normalizedBusiness) {
    console.log(`[WhatsApp Pipeline] Message from business number ${normalizedFrom} detected. Ignoring to prevent loop.`);
    return {
      status: 'IGNORED_SELF',
      inboundMessageId: messageId,
    };
  }

  // Save ID in deduplication cache
  saveProcessedId(messageId);

  // Parse Timestamp (Meta provides epoch seconds or millis)
  let isoTimestamp: string;
  if (typeof timestamp === 'number') {
    isoTimestamp = new Date(timestamp > 10000000000 ? timestamp : timestamp * 1000).toISOString();
  } else if (timestamp && !isNaN(Number(timestamp))) {
    const num = Number(timestamp);
    isoTimestamp = new Date(num > 10000000000 ? num : num * 1000).toISOString();
  } else if (timestamp) {
    isoTimestamp = new Date(timestamp).toISOString();
  } else {
    isoTimestamp = new Date().toISOString();
  }

  const nowIso = new Date().toISOString();

  // 3. Find or Create CRM Contact
  const contactId = `contact-wa-${normalizedFrom}`;
  const nameParts = fromName.trim().split(' ');
  const firstName = nameParts[0] || 'WhatsApp';
  const lastName = nameParts.slice(1).join(' ') || 'Partner';
  const displayPhone = formatPhoneNumberForDisplay(normalizedFrom);

  const contact = runtimeWhatsAppContacts.get(contactId) || {
    contactId,
    firstName,
    lastName,
    email: `${normalizedFrom}@whatsapp.umrah360.in`,
    phone: displayPhone,
    companyName: `${firstName}'s Pilgrimage Agency`,
    whatsappUserId: normalizedFrom,
    createdAt: isoTimestamp,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
  };
  contact.updatedAt = nowIso;
  contact.lastActivityAt = nowIso;
  runtimeWhatsAppContacts.set(contactId, contact);

  // 4. Find or Create CRM Lead
  const leadId = `lead-wa-${normalizedFrom}`;
  const lead = {
    leadId,
    contactId,
    source: 'WHATSAPP',
    leadType: 'INBOUND',
    status: 'ENGAGED',
    leadScore: 84,
    intent: 'HIGH',
    buyingStage: 'CONSIDERATION',
    serviceInterest: 'WhatsApp Inbound Umrah Inquiry',
    requirements: ['WhatsApp Operations', 'B2B Packages'],
    aiSummary: `Customer contacted on WhatsApp: "${text.slice(0, 100)}..."`,
    createdAt: isoTimestamp,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
  };

  // 5. Find or Create Conversation Thread
  const conversationId = `conv-wa-${normalizedFrom}`;
  let conversation = runtimeWhatsAppConversations.get(conversationId);

  const activeMode = forceMode || getPersistedWhatsAppMode();
  const isAuto = activeMode === 'AUTO';

  if (!conversation) {
    conversation = {
      conversationId,
      contactId,
      leadId,
      channel: 'WHATSAPP',
      direction: 'INBOUND',
      status: 'ACTIVE',
      aiEnabled: isAuto,
      humanHandoff: !isAuto,
      managementMode: isAuto ? 'AI' : 'HUMAN',
      customerPhone: normalizedFrom,
      whatsappMessageId: messageId,
      isRead: false,
      unread: true,
      unreadCount: 1,
      startedAt: isoTimestamp,
      lastMessageAt: isoTimestamp,
      lastMessageText: text,
      createdAt: isoTimestamp,
      updatedAt: nowIso,
    };
  } else {
    // Thread Continuity: Update existing conversation
    conversation.lastMessageAt = isoTimestamp;
    conversation.lastMessageText = text;
    conversation.unreadCount = (conversation.unreadCount || 0) + 1;
    conversation.isRead = false;
    conversation.unread = true;
    conversation.updatedAt = nowIso;
    if (forceMode) {
      conversation.aiEnabled = isAuto;
      conversation.humanHandoff = !isAuto;
      conversation.managementMode = isAuto ? 'AI' : 'HUMAN';
    }
  }
  runtimeWhatsAppConversations.set(conversationId, conversation);

  // 6. SAVE INCOMING CUSTOMER MESSAGE BEFORE INVOKING AI
  const customerMsgId = `msg-wa-${messageId || Date.now()}`;
  const customerMessage = {
    messageId: customerMsgId,
    conversationId,
    channel: 'WHATSAPP',
    senderType: 'CUSTOMER',
    senderName: `${firstName} ${lastName}`,
    senderPhone: normalizedFrom,
    fromPhone: normalizedFrom,
    toPhone: normalizedBusiness,
    whatsappMessageId: messageId,
    text,
    timestamp: isoTimestamp,
    direction: 'INBOUND',
    createdAt: nowIso,
    receivedAt: isoTimestamp,
    whatsappMeta: {
      from: normalizedFrom,
      to: normalizedBusiness,
      displayPhoneNumber: config.displayPhoneNumber,
      messageId,
      profileName: fromName,
      timestamp: isoTimestamp,
    },
  };

  const existingThreadMsgs = runtimeWhatsAppMessages.get(conversationId) || [];
  existingThreadMsgs.push(customerMessage);
  runtimeWhatsAppMessages.set(conversationId, existingThreadMsgs);

  console.log(`[WhatsApp Pipeline] Saved incoming customer message ${customerMsgId} from ${normalizedFrom}`);

  // 7. Check Mode for AI Reply Execution
  // If Human mode is active on system or conversation, stop and return
  const isHumanTakeover = conversation.humanHandoff || !conversation.aiEnabled || activeMode === 'HUMAN';

  if (isHumanTakeover) {
    console.log(`[WhatsApp Pipeline] WhatsApp channel is in HUMAN mode. Saved message to inbox. Skipping AI reply.`);
    return {
      status: 'SAVED_HUMAN_MODE',
      conversationId,
      contactId,
      leadId,
      inboundMessageId: customerMsgId,
      mode: 'HUMAN',
      entities: {
        contact,
        lead,
        conversation,
        message: customerMessage,
      },
    };
  }

  // 8. AUTO MODE: Generate Grounded AI Response
  console.log(`[WhatsApp Pipeline] WhatsApp channel is in AUTO mode. Consulting Umrah360 knowledge base...`);
  const conversationHistory = existingThreadMsgs.map((m) => ({
    senderType: m.senderType,
    text: m.text,
    timestamp: m.timestamp,
  }));

  const aiResult = await generateWhatsAppAiReply({
    customerName: `${firstName} ${lastName}`,
    customerPhone: normalizedFrom,
    incomingText: text,
    conversationHistory,
  });

  // Check if handoff was triggered inside AI analysis
  if (aiResult.handoffTriggered) {
    conversation.humanHandoff = true;
    conversation.aiEnabled = false;
    conversation.managementMode = 'HUMAN';
    lead.intent = 'HIGH';
    lead.leadScore = 95;
    lead.buyingStage = 'DECISION';
  }

  // 9. Dispatch AI Response via Meta WhatsApp Cloud API
  const sendResult: WhatsAppSendResult = await sendLiveWhatsAppMessage(
    normalizedFrom,
    aiResult.replyText,
    phoneNumberId
  );

  const aiMsgId = `msg-wa-ai-${Date.now()}`;
  const aiMessage = {
    messageId: aiMsgId,
    conversationId,
    channel: 'WHATSAPP',
    senderType: 'AI',
    senderName: 'Umrah360 AI',
    fromPhone: normalizedBusiness,
    toPhone: normalizedFrom,
    whatsappMessageId: sendResult.messageId,
    text: aiResult.replyText,
    timestamp: sendResult.timestamp,
    direction: 'OUTBOUND',
    aiGenerated: true,
    confidence: 0.98,
    knowledgeSources: ['Umrah360 Core Specs', 'B2B Packages & Pricing Engine'],
    sentAt: sendResult.timestamp,
    createdAt: nowIso,
    whatsappMeta: {
      from: normalizedBusiness,
      to: normalizedFrom,
      displayPhoneNumber: config.displayPhoneNumber,
      messageId: sendResult.messageId,
      timestamp: sendResult.timestamp,
    },
  };

  existingThreadMsgs.push(aiMessage);
  runtimeWhatsAppMessages.set(conversationId, existingThreadMsgs);

  // Update conversation lastMessage
  conversation.lastMessageAt = sendResult.timestamp;
  conversation.lastMessageText = aiResult.replyText;
  conversation.updatedAt = nowIso;
  runtimeWhatsAppConversations.set(conversationId, conversation);

  console.log(`[WhatsApp Pipeline] Auto-reply dispatched and saved for ${normalizedFrom}. AI MsgId: ${aiMsgId}`);

  return {
    status: 'PROCESSED',
    conversationId,
    contactId,
    leadId,
    inboundMessageId: customerMsgId,
    outboundReplyMessageId: aiMsgId,
    aiReplyText: aiResult.replyText,
    mode: 'AUTO',
    entities: {
      contact,
      lead,
      conversation,
      customerMessage,
      aiMessage,
    },
  };
}

/**
 * Parses a standard Meta Webhook request body and processes all messages
 */
export async function handleMetaWhatsAppWebhook(body: WhatsAppInboundPayload): Promise<WhatsAppPipelineResult[]> {
  const results: WhatsAppPipelineResult[] = [];

  if (!body?.entry || !Array.isArray(body.entry)) {
    return results;
  }

  for (const entry of body.entry) {
    if (!entry.changes || !Array.isArray(entry.changes)) continue;

    for (const change of entry.changes) {
      const val = change.value;
      if (!val || !val.messages || !Array.isArray(val.messages)) continue;

      const metadata = val.metadata;
      const displayPhoneNumber = metadata?.display_phone_number;
      const phoneNumberId = metadata?.phone_number_id;

      const contactProfile = val.contacts?.[0]?.profile?.name || 'WhatsApp Customer';

      for (const msg of val.messages) {
        if (msg.type !== 'text' || !msg.text?.body) {
          // If non-text (e.g. image/location/sticker), handle gracefully
          continue;
        }

        const res = await processInboundWhatsAppMessage({
          fromPhone: msg.from || '',
          fromName: contactProfile,
          text: msg.text.body,
          messageId: msg.id || `wamid.${Date.now()}`,
          timestamp: msg.timestamp,
          displayPhoneNumber,
          phoneNumberId,
        });

        results.push(res);
      }
    }
  }

  return results;
}
