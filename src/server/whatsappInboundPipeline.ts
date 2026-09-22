import { GoogleGenAI } from '@google/genai';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from '../services/knowledgeData.js';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { doc } from 'firebase/firestore';
import { safeSetDoc } from './firestoreUtils.js';

export const TARGET_WHATSAPP_NUMBER = '+919820252434';
export const TARGET_WHATSAPP_NUMBER_DISPLAY = '+91 98202 52434';

export interface ProcessedWhatsAppRecord {
  waMessageId: string;
  senderPhone: string;
  recipientPhone: string;
  direction: 'INBOUND' | 'OUTBOUND';
  senderType: 'CUSTOMER' | 'PROSPECT' | 'AI' | 'AGENT';
  aiReplied: boolean;
  repliedAt?: string;
  repliedByMessageId?: string;
  firstSeenAt: string;
  body: string;
  senderName?: string;
}

export interface InboundWhatsAppCrmEntities {
  contact: {
    contactId: string;
    firstName: string;
    lastName: string;
    email?: string;
    phone: string;
    whatsappUserId: string;
    companyName: string;
    jobTitle?: string;
    createdAt: string;
    updatedAt: string;
    lastActivityAt: string;
  };
  lead: {
    leadId: string;
    contactId: string;
    source: 'WHATSAPP';
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
    channel: 'WHATSAPP';
    direction: 'INBOUND' | 'OUTBOUND';
    status: 'ACTIVE' | 'REVIEW';
    aiEnabled: boolean;
    humanHandoff: boolean;
    managementMode?: string;
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
    conversationId: string;
    channel: 'WHATSAPP';
    direction: 'INBOUND';
    senderType: 'CUSTOMER' | 'PROSPECT' | 'AGENT' | 'AI';
    senderName: string;
    senderPhone: string;
    text: string;
    timestamp: string;
    aiReplied?: boolean;
    repliedAt?: string;
    repliedByMessageId?: string;
  };
  aiReplyMessage?: {
    messageId: string;
    conversationId: string;
    channel: 'WHATSAPP';
    direction: 'OUTBOUND';
    senderType: 'AI';
    senderName: string;
    senderPhone: string;
    text: string;
    timestamp: string;
    aiProcessed: boolean;
    aiGenerated: boolean;
    confidence: number;
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

export interface ProcessedInboundWhatsAppResult {
  messageId: string;
  from: string;
  fromName: string;
  to: string;
  incomingText: string;
  replyText: string;
  shouldSendAutoReply: boolean;
  replyDecisionReason: string;
  deliveryStatus: {
    success: boolean;
    channel: 'WHATSAPP';
    targetNumber: string;
    messageId?: string;
    providerUsed?: 'META_CLOUD_API' | 'TWILIO' | 'INTERNAL_CRM_LOG';
    error?: string;
  };
  handoffTriggered: boolean;
  handoffReason?: string;
  leadScore: number;
  intent: string;
  buyingStage: string;
  timestamp: string;
  crmEntities: InboundWhatsAppCrmEntities;
}

export interface WhatsAppConversationTurnState {
  phone: string;
  lastIncomingMessageId: string;
  lastIncomingText: string;
  lastRepliedMessageId?: string;
  replyCountForThisTurn: number;
  waitingForCustomerReply: boolean;
  lastAutoReplyTimestamp?: string;
  updatedAt: string;
}

// In-memory buffer of recently processed WhatsApp messages for live inspection
const recentProcessedWhatsApp: ProcessedInboundWhatsAppResult[] = [];

// Persistent in-memory thread storage keyed by conversationId
const waConversationThreadMessagesMap = new Map<string, any[]>();

// Deduplication map
const processedWaRecordsMap = new Map<string, ProcessedWhatsAppRecord>();
const inFlightWaMessageIds = new Set<string>();

// Turn tracker per phone number: Only reply ONCE per customer turn until they reply again!
const waConversationTurnMap = new Map<string, WhatsAppConversationTurnState>();

// Pipeline Configuration
export interface WhatsAppPipelineConfig {
  mode: 'AUTO' | 'REVIEW' | 'SIMULATION';
  targetBusinessNumber: string;
  autoReplyDebounceSeconds: number;
}

const pipelineConfig: WhatsAppPipelineConfig = {
  mode: 'AUTO',
  targetBusinessNumber: TARGET_WHATSAPP_NUMBER,
  autoReplyDebounceSeconds: 3,
};

export function getWhatsAppPipelineConfig(): WhatsAppPipelineConfig {
  return { ...pipelineConfig };
}

export function updateWhatsAppPipelineConfig(newConfig: Partial<WhatsAppPipelineConfig>): WhatsAppPipelineConfig {
  Object.assign(pipelineConfig, newConfig);
  return { ...pipelineConfig };
}

/**
 * Normalizes phone numbers to standard E.164-like alphanumeric format (e.g. +919820252434)
 */
export function normalizePhoneNumber(rawPhone: string): string {
  if (!rawPhone) return TARGET_WHATSAPP_NUMBER;
  const cleaned = rawPhone.trim().replace(/[^\d+]/g, '');
  if (cleaned.startsWith('+')) {
    return cleaned;
  }
  if (cleaned.length === 10) {
    return `+91${cleaned}`;
  }
  if (cleaned.startsWith('91') && cleaned.length === 12) {
    return `+${cleaned}`;
  }
  return `+${cleaned}`;
}

export function formatDisplayPhone(phone: string): string {
  const norm = normalizePhoneNumber(phone);
  if (norm.startsWith('+91') && norm.length === 13) {
    return `+91 ${norm.slice(3, 8)} ${norm.slice(8)}`;
  }
  return norm;
}

export function getRecentProcessedWhatsAppMessages(): ProcessedInboundWhatsAppResult[] {
  return [...recentProcessedWhatsApp];
}

export function getWhatsAppTurnStates(): Record<string, WhatsAppConversationTurnState> {
  const result: Record<string, WhatsAppConversationTurnState> = {};
  for (const [phone, state] of waConversationTurnMap.entries()) {
    result[phone] = { ...state };
  }
  return result;
}

export function getWhatsAppThreadMessages(conversationId: string): any[] {
  return waConversationThreadMessagesMap.get(conversationId) || [];
}

export interface WhatsAppGatewayStatus {
  provider: 'META_CLOUD_API' | 'TWILIO' | 'INTERNAL_CRM_LOG';
  configured: boolean;
  phoneNumber: string;
  phoneNumberFormatted: string;
  phoneNumberId?: string;
  businessAccountId?: string;
  webhookUrl: string;
  verifyToken: string;
}

export function getWhatsAppGatewayStatus(): WhatsAppGatewayStatus {
  const metaToken = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const businessAccountId = process.env.META_BUSINESS_ACCOUNT_ID || process.env.WHATSAPP_BUSINESS_ACCOUNT_ID;
  const verifyToken = process.env.META_WEBHOOK_VERIFY_TOKEN || process.env.WHATSAPP_VERIFY_TOKEN || 'umrah360_webhook_token';
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;

  if (metaToken && phoneId) {
    return {
      provider: 'META_CLOUD_API',
      configured: true,
      phoneNumber: TARGET_WHATSAPP_NUMBER,
      phoneNumberFormatted: TARGET_WHATSAPP_NUMBER_DISPLAY,
      phoneNumberId: phoneId,
      businessAccountId: businessAccountId,
      webhookUrl: '/api/inbound/whatsapp',
      verifyToken: verifyToken,
    };
  }

  if (twilioSid && twilioAuth) {
    return {
      provider: 'TWILIO',
      configured: true,
      phoneNumber: process.env.TWILIO_WHATSAPP_NUMBER || TARGET_WHATSAPP_NUMBER,
      phoneNumberFormatted: TARGET_WHATSAPP_NUMBER_DISPLAY,
      webhookUrl: '/api/inbound/whatsapp',
      verifyToken: verifyToken,
    };
  }

  return {
    provider: 'INTERNAL_CRM_LOG',
    configured: false,
    phoneNumber: TARGET_WHATSAPP_NUMBER,
    phoneNumberFormatted: TARGET_WHATSAPP_NUMBER_DISPLAY,
    webhookUrl: '/api/inbound/whatsapp',
    verifyToken: verifyToken,
  };
}

/**
 * Sends a real live outbound WhatsApp message if Meta Cloud API or Twilio credentials exist.
 * Otherwise logs to internal CRM.
 */
export async function sendLiveMetaWhatsAppMessage(
  recipientPhone: string,
  messageText: string
): Promise<{
  success: boolean;
  externalMessageId?: string;
  error?: string;
  providerUsed: 'META_CLOUD_API' | 'TWILIO' | 'INTERNAL_CRM_LOG';
}> {
  const metaToken = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN || process.env.WHATSAPP_TOKEN;
  const phoneId = process.env.META_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_NUMBER_ID;
  const twilioSid = process.env.TWILIO_ACCOUNT_SID;
  const twilioAuth = process.env.TWILIO_AUTH_TOKEN;
  const cleanPhone = recipientPhone.replace(/[^0-9]/g, '');

  if (metaToken && phoneId) {
    try {
      console.log(`[WhatsApp Outbound] Dispatching real WhatsApp message to +${cleanPhone} via Meta Cloud API...`);
      const response = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${metaToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: cleanPhone,
          type: 'text',
          text: {
            preview_url: false,
            body: messageText,
          },
        }),
      });

      const data: any = await response.json();
      if (response.ok && data.messages?.[0]?.id) {
        console.log(`[WhatsApp Outbound] Meta Cloud API dispatch success. Message ID: ${data.messages[0].id}`);
        return {
          success: true,
          externalMessageId: data.messages[0].id,
          providerUsed: 'META_CLOUD_API',
        };
      } else {
        console.error(`[WhatsApp Outbound] Meta Cloud API error:`, data);
        return {
          success: false,
          error: data.error?.message || 'Meta WhatsApp dispatch failed',
          providerUsed: 'META_CLOUD_API',
        };
      }
    } catch (err: any) {
      console.error(`[WhatsApp Outbound] Meta Cloud API fetch exception:`, err);
      return {
        success: false,
        error: err.message || 'Meta fetch failed',
        providerUsed: 'META_CLOUD_API',
      };
    }
  }

  if (twilioSid && twilioAuth) {
    try {
      console.log(`[WhatsApp Outbound] Dispatching real WhatsApp message to +${cleanPhone} via Twilio API...`);
      const fromNumber = process.env.TWILIO_WHATSAPP_NUMBER || TARGET_WHATSAPP_NUMBER;
      const twilioFrom = fromNumber.startsWith('whatsapp:') ? fromNumber : `whatsapp:${fromNumber}`;
      const twilioTo = `whatsapp:+${cleanPhone}`;

      const formData = new URLSearchParams();
      formData.append('From', twilioFrom);
      formData.append('To', twilioTo);
      formData.append('Body', messageText);

      const twilioUrl = `https://api.twilio.com/2010-04-01/Accounts/${twilioSid}/Messages.json`;
      const creds = Buffer.from(`${twilioSid}:${twilioAuth}`).toString('base64');

      const response = await fetch(twilioUrl, {
        method: 'POST',
        headers: {
          Authorization: `Basic ${creds}`,
          'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: formData.toString(),
      });

      const data: any = await response.json();
      if (response.ok && data.sid) {
        console.log(`[WhatsApp Outbound] Twilio dispatch success. SID: ${data.sid}`);
        return {
          success: true,
          externalMessageId: data.sid,
          providerUsed: 'TWILIO',
        };
      } else {
        return {
          success: false,
          error: data.message || 'Twilio WhatsApp dispatch failed',
          providerUsed: 'TWILIO',
        };
      }
    } catch (err: any) {
      return {
        success: false,
        error: err.message || 'Twilio fetch failed',
        providerUsed: 'TWILIO',
      };
    }
  }

  // Fallback: Internal CRM simulation mode
  console.log(`[WhatsApp Outbound] Note: Real Meta/Twilio credentials not configured in .env. Reply saved directly to Unified Inbox and Firestore CRM.`);
  return {
    success: true,
    externalMessageId: `sim-wa-${Date.now()}`,
    providerUsed: 'INTERNAL_CRM_LOG',
  };
}

/**
 * Generate intelligent, grounded auto-reply text specifically formatted for WhatsApp.
 */
export async function generateWhatsAppAutoReplyText(params: {
  fromPhone: string;
  fromName?: string;
  body: string;
  companyName?: string;
  threadHistory?: any[];
}): Promise<{
  replyText: string;
  handoffTriggered: boolean;
  handoffReason?: string;
  leadScore: number;
  buyingStage: string;
}> {
  const { fromPhone, fromName, body, companyName, threadHistory } = params;
  const combinedText = body.toLowerCase();

  // Intent classification
  const isIndividualPilgrimOrFamily =
    /myself|my family|for family|for myself|as a customer|planning umrah|booking experience|customized package|customize a package|book a customized|hotels in makkah|flights.*hotels|transfers.*meals.*visa|real-time.*availability|online payment|direct booking|retail|pax|vip package|ramadan/i.test(
      combinedText
    );
  const isTwentyUsers = /20 user|20 seat|25 user|twenty user|enterprise|volume quote|corporate rate/i.test(combinedText);
  const isB2bPortal = /b2b|sub-agent|reseller|credit limit|wallet|allotment|offline block|agent markup/i.test(combinedText);
  const isDynamicCosting = /dynamic costing|costing|rail|haramain|train|fare|forex|currency|sar|usd|gbp/i.test(combinedText);
  const isVisa = /visa|evisa|e-visa|saudi visa|tracking|biometrics|nusuk/i.test(combinedText);

  let handoffTriggered = false;
  let handoffReason: string | undefined;
  let leadScore = 78;
  let buyingStage = 'AWARENESS';

  if (isTwentyUsers) {
    handoffTriggered = true;
    handoffReason = 'Enterprise 20+ user deployment detected via WhatsApp - requires tailored volume quotation';
    leadScore = 95;
    buyingStage = 'DECISION';
  } else if (isB2bPortal) {
    leadScore = 90;
    buyingStage = 'CONSIDERATION';
  } else if (isDynamicCosting) {
    leadScore = 86;
    buyingStage = 'CONSIDERATION';
  } else if (isIndividualPilgrimOrFamily) {
    leadScore = 88;
    buyingStage = 'CONSIDERATION';
  }

  const senderGreetingName = fromName ? fromName.split(' ')[0] : 'Brother / Sister';

  // Knowledge base grounding summary
  const kbGroundingText = INITIAL_KNOWLEDGE_DOCUMENTS.map(
    (doc) => `[DOCUMENT: ${doc.title} (${doc.category})]\n${doc.content}`
  ).join('\n\n');

  // Format thread context
  const formattedThreadContext = (threadHistory && threadHistory.length > 0)
    ? threadHistory.map((m: any, idx: number) => {
        const isCustomer = m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT';
        const role = isCustomer ? `Customer (${m.senderName || fromPhone})` : 'Umrah360 AI Assistant';
        return `[Msg ${idx + 1} - ${role} at ${m.timestamp}]: ${m.text}`;
      }).join('\n')
    : `[Msg 1 - Customer (${fromName || fromPhone})]: ${body}`;

  // Attempt Gemini generation
  if (process.env.GEMINI_API_KEY) {
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
      const prompt = `You are the official Umrah360 WhatsApp AI Assistant representing Umrah360 (+919820252434 / www.umrah360.in).
Umrah360 is the leading all-in-one ERP, CRM, and distribution platform for Umrah and Hajj tour operators and travel agencies.

GROUND TRUTH KNOWLEDGE BASE:
${kbGroundingText}

CONVERSATION THREAD HISTORY:
${formattedThreadContext}

LATEST INCOMING WHATSAPP MESSAGE:
Sender: ${fromName || 'Inquirer'} (${fromPhone})
Company: ${companyName || 'Not specified'}
Message: "${body}"

INSTRUCTIONS FOR WHATSAPP RESPONSE:
1. Greet warmly with polite Islamic greeting: "Assalamu Alaikum ${senderGreetingName},"
2. Tone: Professional, warm, crisp, and direct. Format specifically for WhatsApp (use clean short paragraphs, bullet points with emojis like 🕋 ✈️ 🏨 📋, bold key terms with single asterisks *like this*).
3. If asking about B2B Sub-Agent Portal: Explain agent credit wallets, custom markup tiers, white-label PDF vouchers with agency logos, and offline Makkah hotel allotment management.
4. If asking about Dynamic Costing / Rail / Visas: Explain real-time Haramain train costing, automated Saudi eVisa status tracking, and multi-currency SAR/USD exchange rate hedging.
5. If asking about 20+ users / enterprise: Acknowledge their team size warmly, state that 20+ seat deployments receive customized volume rates and a dedicated account manager, and offer to schedule a live Zoom walkthrough.
6. If pilgrim / family asking about booking: Confirm our authorized partner agencies in India/UK/Middle East can customize their exact 5-star or budget package, and ask for tentative travel dates and group size.
7. Sign off politely as:
"Umrah360 Team
WhatsApp: +91 98202 52434
www.umrah360.in"`;

      const candidateModels = ['gemini-2.5-flash', 'gemini-3.8-flash', 'gemini-flash-latest'];
      for (const modelName of candidateModels) {
        try {
          const timeoutPromise = new Promise<never>((_, reject) =>
            setTimeout(() => reject(new Error('Timeout')), 12000)
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
        } catch (mErr: any) {
          console.warn(`[WhatsApp Gemini ${modelName}] Attempt failed:`, mErr?.message?.slice(0, 80));
        }
      }
    } catch (gErr) {
      console.warn('[WhatsApp Gemini] Fallback to domain knowledge engine:', gErr);
    }
  }

  // Domain-grounded fallback response engine
  let replyText = '';

  if (isTwentyUsers) {
    replyText = `Assalamu Alaikum ${senderGreetingName},

Thank you for contacting Umrah360 WhatsApp Business (+91 98202 52434)!

For agency deployments with *20+ user seats*, we provide custom Enterprise volume pricing, dedicated cloud hosting, customized SLA guarantees, and priority API rate limits.

📋 *Enterprise Package Highlights:*
• Unlimited sub-agent logins & white-label portals
• Dedicated onboarding specialist & staff training
• Custom integrations (Accounting, Amadeus, Sabre, Payment Gateways)

Our Senior Enterprise Solutions Manager will contact you shortly with a personalized quotation. When would be a convenient time for a quick 15-minute introductory call?

Best regards,
*Umrah360 Enterprise Team*
WhatsApp: +91 98202 52434
www.umrah360.in`;
  } else if (isB2bPortal) {
    replyText = `Assalamu Alaikum ${senderGreetingName},

Thank you for contacting Umrah360 (+91 98202 52434)!

Yes, Umrah360 includes a comprehensive *B2B Sub-Agent Distribution Portal* built specifically for wholesale Umrah operators:

• *White-Label Agent Portals:* Sub-agents can log in, view your approved package inventory, and issue PDF vouchers with *their own agency branding*.
• *Credit Wallets & Limits:* Set prepaid credit balances or post-paid credit ceilings with automated booking stops.
• *Offline Hotel Allotments:* Upload contracted Makkah & Madinah hotel blocks (Swissotel, Clock Tower, etc.) with blackout dates.
• *Configurable Markup Tiers:* Assign Tier-A, Tier-B, and Tier-C agent commission margins automatically.

Would you like us to send a 5-minute video walkthrough or set up a live interactive sandbox for ${companyName || 'your agency'}?

Warm regards,
*Umrah360 AI Assistant*
WhatsApp: +91 98202 52434
www.umrah360.in`;
  } else if (isDynamicCosting || isVisa) {
    replyText = `Assalamu Alaikum ${senderGreetingName},

Thank you for messaging Umrah360 on WhatsApp (+91 98202 52434)!

Our platform includes end-to-end operational tools for Umrah operators:

🚄 *Dynamic Group Costing & Rail:*
• Instantly calculates per-pax costing for Haramain High-Speed Train tickets, VIP GMC coaches, and bus transfers.
• Live multi-currency exchange conversion (SAR, INR, USD, GBP) with configurable hedge buffers.

📋 *Automated Saudi Visa Tracking:*
• Batch upload passport copies with instant OCR data extraction.
• Real-time tracking of Saudi eVisa application status and direct attachment to pilgrim vouchers.

Would you like to see a sample dynamic costing sheet or schedule a platform demo?

Warm regards,
*Umrah360 AI Assistant*
WhatsApp: +91 98202 52434
www.umrah360.in`;
  } else if (isIndividualPilgrimOrFamily) {
    replyText = `Assalamu Alaikum ${senderGreetingName},

Thank you for reaching out to Umrah360 on WhatsApp (+91 98202 52434)!

Umrah360 powers top licensed Hajj & Umrah travel agencies across India and internationally. Our authorized partner operators provide:

🕋 *Customized Umrah Packages:*
• Choice of 5-star luxury (Swissotel, Pullman Zamzam, Fairmont Clock Tower) or budget walking-distance hotels in Makkah & Madinah.
• Complete visa processing, Haramain train booking, private airport transfers, and guided Ziyarat.
• Transparent breakdown with no hidden fees.

To connect you with our authorized partner specialist for your city, please let us know:
1. Tentative travel month or dates
2. Total number of passengers (adults/children)
3. Room preference (Quad, Triple, Double)

Best regards,
*Umrah360 Pilgrim Support*
WhatsApp: +91 98202 52434
www.umrah360.in`;
  } else {
    replyText = `Assalamu Alaikum ${senderGreetingName},

Thank you for connecting with Umrah360 on WhatsApp (+91 98202 52434)!

Umrah360 is the leading cloud ERP & CRM platform purpose-built for Hajj and Umrah tour operators. We automate:
• Custom FIT & Group package costing
• B2B sub-agent portals with credit wallets
• Saudi eVisa management & Nusuk tracking
• Real-time Makkah/Madinah hotel room allotment tracking

How can we assist ${companyName || 'your travel agency'} today? Feel free to ask about our software modules or pricing!

Warm regards,
*Umrah360 AI Assistant*
WhatsApp: +91 98202 52434
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
 * Main function: Process Live Inbound WhatsApp Message sent to +919820252434.
 * Works exactly like the email inbound pipeline:
 * 1. Idempotency & deduplication checks
 * 2. Outbound / Self message handling
 * 3. Human Takeover / Mode evaluation
 * 4. Contact resolution by phone
 * 5. CRM Lead creation/linking
 * 6. Conversation creation/linking
 * 7. AI Auto-reply generation with RAG
 * 8. Outbound reply dispatch
 * 9. Lead activity logging
 * 10. Single-source Firestore persistence
 */
export async function processLiveInboundWhatsApp(payload: {
  from: string;
  fromName?: string;
  to?: string;
  body: string;
  messageId?: string;
  companyName?: string;
  direction?: 'INBOUND' | 'OUTBOUND';
  senderType?: 'CUSTOMER' | 'PROSPECT' | 'AI' | 'AGENT';
  isTestSimulation?: boolean;
}): Promise<ProcessedInboundWhatsAppResult> {
  const targetNumber = TARGET_WHATSAPP_NUMBER;
  const targetNumberFormatted = TARGET_WHATSAPP_NUMBER_DISPLAY;
  const nowIso = new Date().toISOString();

  const senderPhone = normalizePhoneNumber(payload.from);
  const targetPhone = normalizePhoneNumber(payload.to || targetNumber);
  const incomingMsgId = payload.messageId || `wa-msg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;

  const safePhoneId = senderPhone.replace(/[^a-z0-9]/gi, '_');
  const contactId = `contact-wa-${safePhoneId}`;
  const leadId = `lead-wa-${safePhoneId}`;
  const conversationId = `conv-wa-${safePhoneId}`;

  const displayName = payload.fromName || formatDisplayPhone(senderPhone);
  const nameParts = displayName.split(' ');
  const firstName = nameParts[0] || 'WhatsApp';
  const lastName = nameParts.slice(1).join(' ') || 'User';

  // Check Outbound or Self message
  const isSelf = senderPhone === targetPhone || senderPhone === normalizePhoneNumber(TARGET_WHATSAPP_NUMBER);
  const isOutbound = payload.direction === 'OUTBOUND' || payload.senderType === 'AI' || payload.senderType === 'AGENT' || isSelf;

  // Ensure thread exists in memory
  let thread = waConversationThreadMessagesMap.get(conversationId);
  if (!thread) {
    thread = [];
    waConversationThreadMessagesMap.set(conversationId, thread);
  }

  // =========================================================================
  // RULE 1: OUTBOUND WHATSAPP EVENTS ARE SAVED BUT NEVER TRIGGER AI
  // =========================================================================
  if (isOutbound) {
    console.log(`[WhatsApp Pipeline] Outbound message detected from ${senderPhone}. Recording without AI trigger.`);
    const outboundMsg = {
      messageId: incomingMsgId,
      conversationId,
      channel: 'WHATSAPP' as const,
      direction: 'OUTBOUND' as const,
      senderType: payload.senderType === 'AI' ? ('AI' as const) : ('AGENT' as const),
      senderName: 'Umrah360 Support (+91 98202 52434)',
      senderPhone: targetNumber,
      text: payload.body,
      timestamp: nowIso,
      sentAt: nowIso,
      receivedAt: nowIso,
      createdAt: nowIso,
      aiReplied: false,
    };

    thread.push(outboundMsg);

    return {
      messageId: incomingMsgId,
      from: senderPhone,
      fromName: displayName,
      to: targetNumber,
      incomingText: payload.body,
      replyText: '',
      shouldSendAutoReply: false,
      replyDecisionReason: 'Outbound WhatsApp event stored. AI does not auto-reply to outbound messages.',
      deliveryStatus: {
        success: true,
        channel: 'WHATSAPP',
        targetNumber: senderPhone,
        messageId: incomingMsgId,
      },
      handoffTriggered: false,
      leadScore: 0,
      intent: 'MEDIUM',
      buyingStage: 'ENGAGED',
      timestamp: nowIso,
      crmEntities: {
        contact: { contactId, firstName, lastName, phone: senderPhone, whatsappUserId: senderPhone, companyName: payload.companyName || 'Umrah360 Internal', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        lead: { leadId, contactId, source: 'WHATSAPP', leadType: 'INBOUND', status: 'ENGAGED', leadScore: 50, intent: 'MEDIUM', buyingStage: 'ENGAGED', serviceInterest: 'WhatsApp Inquiry', requirements: [], aiSummary: 'Outbound message recorded', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        conversation: { conversationId, contactId, leadId, channel: 'WHATSAPP', direction: 'OUTBOUND', status: 'ACTIVE', aiEnabled: false, humanHandoff: false, conversationSummary: `Outbound WhatsApp to ${displayName}`, startedAt: nowIso, lastMessageAt: nowIso, lastMessageText: payload.body.slice(0, 120), unreadCount: 0, createdAt: nowIso, updatedAt: nowIso },
        incomingMessage: outboundMsg as any,
        activity: { activityId: `act-wa-out-${Date.now()}`, leadId, contactId, type: 'AGENT_REPLIED', title: 'Outbound WhatsApp Sent', description: `Message dispatched to ${senderPhone}`, timestamp: nowIso },
        allThreadMessages: [...thread],
      }
    };
  }

  // =========================================================================
  // RULE 2: DEDUPLICATION & TURN TRACKING
  // =========================================================================
  const existingRecord = processedWaRecordsMap.get(incomingMsgId);
  const isAlreadyReplied = existingRecord && existingRecord.aiReplied;
  const turnState = waConversationTurnMap.get(senderPhone);
  const isTurnAlreadyReplied = Boolean(
    turnState && turnState.waitingForCustomerReply && turnState.lastRepliedMessageId === incomingMsgId
  );

  if (isAlreadyReplied || isTurnAlreadyReplied) {
    console.log(`[WhatsApp Idempotency] Message ${incomingMsgId} from ${senderPhone} already replied. Skipping duplicate.`);
    return {
      messageId: incomingMsgId,
      from: senderPhone,
      fromName: displayName,
      to: targetNumber,
      incomingText: payload.body,
      replyText: existingRecord?.body || '',
      shouldSendAutoReply: false,
      replyDecisionReason: 'Idempotency filter: already processed or customer turn already received auto-reply.',
      deliveryStatus: {
        success: true,
        channel: 'WHATSAPP',
        targetNumber: senderPhone,
        messageId: incomingMsgId,
      },
      handoffTriggered: false,
      leadScore: 75,
      intent: 'HIGH',
      buyingStage: 'ENGAGED',
      timestamp: nowIso,
      crmEntities: {
        contact: { contactId, firstName, lastName, phone: senderPhone, whatsappUserId: senderPhone, companyName: payload.companyName || `${firstName}'s Agency`, createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        lead: { leadId, contactId, source: 'WHATSAPP', leadType: 'INBOUND', status: 'ENGAGED', leadScore: 75, intent: 'HIGH', buyingStage: 'ENGAGED', serviceInterest: 'WhatsApp Inquiry', requirements: [], aiSummary: 'Duplicate message filtered', createdAt: nowIso, updatedAt: nowIso, lastActivityAt: nowIso },
        conversation: { conversationId, contactId, leadId, channel: 'WHATSAPP', direction: 'INBOUND', status: 'ACTIVE', aiEnabled: true, humanHandoff: false, conversationSummary: `WhatsApp dialogue with ${displayName}`, startedAt: nowIso, lastMessageAt: nowIso, lastMessageText: payload.body.slice(0, 120), unreadCount: 0, createdAt: nowIso, updatedAt: nowIso },
        incomingMessage: {
          messageId: incomingMsgId,
          conversationId,
          channel: 'WHATSAPP',
          direction: 'INBOUND',
          senderType: 'CUSTOMER',
          senderName: displayName,
          senderPhone,
          text: payload.body,
          timestamp: nowIso,
          aiReplied: true,
        },
        activity: { activityId: `act-wa-dup-${Date.now()}`, leadId, contactId, type: 'PROSPECT_REPLIED', title: 'WhatsApp Message (Filtered Duplicate)', description: 'Message already received reply', timestamp: nowIso },
        allThreadMessages: [...thread],
      }
    };
  }

  // =========================================================================
  // RULE 3: INCOMING MESSAGE INGESTION
  // =========================================================================
  const incomingMessage = {
    messageId: incomingMsgId,
    conversationId,
    channel: 'WHATSAPP' as const,
    direction: 'INBOUND' as const,
    senderType: 'CUSTOMER' as const,
    senderName: displayName,
    senderPhone,
    text: payload.body,
    timestamp: nowIso,
    sentAt: nowIso,
    receivedAt: nowIso,
    createdAt: nowIso,
    aiReplied: false,
  };

  thread.push(incomingMessage);

  // =========================================================================
  // RULE 4: GENERATE GROUNDED AI REPLY
  // =========================================================================
  const aiResult = await generateWhatsAppAutoReplyText({
    fromPhone: senderPhone,
    fromName: payload.fromName,
    body: payload.body,
    companyName: payload.companyName,
    threadHistory: [...thread],
  });

  const shouldSendAutoReply = pipelineConfig.mode !== 'SIMULATION';
  const replyDecisionReason = pipelineConfig.mode === 'SIMULATION'
    ? 'WhatsApp mode is SIMULATION: auto-reply held for agent inspection'
    : 'New inbound customer message to +919820252434 - AI reply dispatched';

  let aiReplyMessage: any = undefined;
  const replyMsgId = `wa-reply-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  if (shouldSendAutoReply) {
    incomingMessage.aiReplied = true;
    (incomingMessage as any).repliedAt = nowIso;
    (incomingMessage as any).repliedByMessageId = replyMsgId;

    aiReplyMessage = {
      messageId: replyMsgId,
      conversationId,
      channel: 'WHATSAPP' as const,
      direction: 'OUTBOUND' as const,
      senderType: 'AI' as const,
      senderName: `Umrah360 AI (${targetNumberFormatted})`,
      senderPhone: targetNumber,
      text: aiResult.replyText,
      timestamp: nowIso,
      sentAt: nowIso,
      receivedAt: nowIso,
      createdAt: nowIso,
      aiProcessed: true,
      aiGenerated: true,
      confidence: 0.97,
    };

    thread.push(aiReplyMessage);

    // Record in processed map
    processedWaRecordsMap.set(incomingMsgId, {
      waMessageId: incomingMsgId,
      senderPhone,
      recipientPhone: targetNumber,
      direction: 'INBOUND',
      senderType: 'CUSTOMER',
      aiReplied: true,
      repliedAt: nowIso,
      repliedByMessageId: replyMsgId,
      firstSeenAt: nowIso,
      body: payload.body,
      senderName: displayName,
    });

    // Update Turn Tracker
    waConversationTurnMap.set(senderPhone, {
      phone: senderPhone,
      lastIncomingMessageId: incomingMsgId,
      lastIncomingText: payload.body,
      lastRepliedMessageId: incomingMsgId,
      replyCountForThisTurn: 1,
      waitingForCustomerReply: true,
      lastAutoReplyTimestamp: nowIso,
      updatedAt: nowIso,
    });
  }

  // Live dispatch via Meta Cloud API / Twilio (or internal CRM if credentials not yet provided)
  let outboundDispatch: {
    success: boolean;
    externalMessageId?: string;
    error?: string;
    providerUsed: 'META_CLOUD_API' | 'TWILIO' | 'INTERNAL_CRM_LOG';
  } = {
    success: true,
    externalMessageId: replyMsgId,
    providerUsed: 'INTERNAL_CRM_LOG',
  };

  if (shouldSendAutoReply && aiReplyMessage) {
    outboundDispatch = await sendLiveMetaWhatsAppMessage(senderPhone, aiResult.replyText);
    aiReplyMessage.externalMessageId = outboundDispatch.externalMessageId;
    aiReplyMessage.providerUsed = outboundDispatch.providerUsed;
  }

  // =========================================================================
  // RULE 5: BUILD COMPLETE CRM ENTITIES
  // =========================================================================
  const crmEntities: InboundWhatsAppCrmEntities = {
    contact: {
      contactId,
      firstName,
      lastName,
      phone: senderPhone,
      whatsappUserId: senderPhone,
      companyName: payload.companyName || `${firstName}'s Agency`,
      jobTitle: 'Tour Operator / Inquirer',
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
    },
    lead: {
      leadId,
      contactId,
      source: 'WHATSAPP',
      leadType: 'INBOUND',
      status: aiResult.handoffTriggered ? 'HUMAN_HANDOFF' : 'ENGAGED',
      leadScore: aiResult.leadScore,
      intent: aiResult.leadScore >= 85 ? 'HIGH' : 'MEDIUM',
      buyingStage: aiResult.buyingStage,
      serviceInterest: payload.body.slice(0, 60),
      requirements: [payload.body.slice(0, 80)],
      aiSummary: `WhatsApp message to ${targetNumberFormatted}: "${payload.body.slice(0, 90)}...". Score: ${aiResult.leadScore}/100.`,
      createdAt: nowIso,
      updatedAt: nowIso,
      lastActivityAt: nowIso,
    },
    conversation: {
      conversationId,
      contactId,
      leadId,
      channel: 'WHATSAPP',
      direction: 'INBOUND',
      status: pipelineConfig.mode === 'REVIEW' ? 'REVIEW' : 'ACTIVE',
      aiEnabled: pipelineConfig.mode === 'AUTO' && !aiResult.handoffTriggered,
      humanHandoff: pipelineConfig.mode !== 'AUTO' || aiResult.handoffTriggered,
      managementMode: (pipelineConfig.mode === 'AUTO' && !aiResult.handoffTriggered) ? 'AI' : 'HUMAN',
      isRead: false,
      unread: true,
      unreadCount: 1,
      conversationSummary: `WhatsApp chat with ${displayName} (${formatDisplayPhone(senderPhone)}).`,
      startedAt: nowIso,
      lastMessageAt: nowIso,
      lastMessageText: (shouldSendAutoReply && aiReplyMessage) ? aiResult.replyText.slice(0, 100) : payload.body.slice(0, 100),
      draftReply: pipelineConfig.mode === 'REVIEW' ? {
        draftId: `draft-wa-${Date.now()}`,
        text: aiResult.replyText,
        generatedAt: nowIso,
        status: 'PENDING',
      } : undefined,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    incomingMessage,
    aiReplyMessage,
    allThreadMessages: [...thread],
    activity: {
      activityId: `act-wa-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      leadId,
      contactId,
      type: 'PROSPECT_REPLIED',
      title: `Inbound WhatsApp from ${displayName}`,
      description: `Inquiry sent to ${targetNumberFormatted}. Auto-reply: ${shouldSendAutoReply ? 'Dispatched via AI' : replyDecisionReason}`,
      timestamp: nowIso,
    },
  };

  const result: ProcessedInboundWhatsAppResult = {
    messageId: incomingMsgId,
    from: senderPhone,
    fromName: displayName,
    to: targetNumber,
    incomingText: payload.body,
    replyText: aiResult.replyText,
    shouldSendAutoReply,
    replyDecisionReason,
    deliveryStatus: {
      success: outboundDispatch.success,
      channel: 'WHATSAPP',
      targetNumber: senderPhone,
      messageId: outboundDispatch.externalMessageId || replyMsgId,
      providerUsed: outboundDispatch.providerUsed,
      error: outboundDispatch.error,
    },
    handoffTriggered: aiResult.handoffTriggered,
    handoffReason: aiResult.handoffReason,
    leadScore: aiResult.leadScore,
    intent: 'HIGH',
    buyingStage: aiResult.buyingStage,
    timestamp: nowIso,
    crmEntities,
  };

  recentProcessedWhatsApp.unshift(result);
  if (recentProcessedWhatsApp.length > 50) {
    recentProcessedWhatsApp.pop();
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
        safeSetDoc(doc(db, 'lead_activities', crmEntities.activity.activityId), crmEntities.activity, { merge: true }).catch(() => {});
      }
    } catch (fsErr) {
      console.error('[WhatsApp Pipeline] Firestore persistence warning:', fsErr);
    }
  }

  return result;
}
