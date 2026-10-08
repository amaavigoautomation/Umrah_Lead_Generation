import {
  Contact,
  Lead,
  Conversation,
  Message,
  KnowledgeDocument,
  ConversationMemory,
  IntentLevel,
  BuyingStage,
} from '../types';
import { retrieveRelevantKnowledge, RetrievedChunk } from './ragService';

export interface AiResponseResult {
  responseText: string;
  confidence: number;
  knowledgeSources: string[];
  humanHandoffTriggered: boolean;
  handoffReason?: string;
  classification?: string;
  ignored?: boolean;
  reason?: string;
  leadQualification: {
    isLead: boolean;
    leadScore: number;
    intent: IntentLevel;
    buyingStage: BuyingStage;
    requirements: string[];
    budget?: string | null;
    timeline?: string | null;
    nextAction: string;
  };
  memoryUpdate: Partial<ConversationMemory>;
}

/**
 * Returns only what the sender newly wrote: removes quoted earlier messages
 * ("On ... wrote:", "> ..." lines, Outlook "From:" headers, "Original Message")
 * and the sign-off/signature. Intent detection must run on this, never on the
 * full email body, because our own campaign email ("15-minute walkthrough",
 * "demo") is quoted inside every reply.
 * (Client-side copy of src/server/quotedText.ts)
 */
function stripQuotedEmailHistory(text: string): string {
  if (!text) return '';
  let t = String(text).replace(/\r\n/g, '\n');
  t = t.replace(/\n?On\s[\s\S]{0,300}?\swrote:[\s\S]*$/i, '');
  t = t.replace(/\n?-{2,}\s*(Original Message|Forwarded message)[\s\S]*$/i, '');
  t = t.replace(/\n?_{5,}[\s\S]*$/, '');
  t = t.replace(/\n?From:\s.*\n(?:Sent|Date|To|Subject):[\s\S]*$/i, '');
  t = t.replace(/^>.*$/gm, '');
  t = t.replace(/\n--\s*\n[\s\S]*$/, '');
  t = t.replace(/\n\s*(Regards|Best regards|Kind regards|Thanks|Thank you|Warm regards|Sincerely|Cheers),?\s*\n[\s\S]*$/i, '');
  return t.trim();
}

/**
 * Evaluates whether human handoff should be triggered immediately based on business rules
 */
export function checkHumanHandoffConditions(
  incomingMessage: string,
  _conversation: Partial<Conversation>,
  knowledgeChunks: RetrievedChunk[]
): { shouldHandoff: boolean; reason?: string } {
  const text = incomingMessage.toLowerCase();

  // 1. Explicit human request
  if (
    text.includes('human') ||
    text.includes('speak to an agent') ||
    text.includes('call me') ||
    text.includes('speak to a person') ||
    text.includes('talk to someone')
  ) {
    return { shouldHandoff: true, reason: 'Customer explicitly requested a human representative.' };
  }

  // 2. Pricing for 20+ users / enterprise custom pricing / contract negotiation
  const hasTwentyUsers = text.includes('20 user') || text.includes('20 seats') || text.includes('for 20') || text.includes('twenty');
  const wantsDiscountOrCustomPricing =
    (text.includes('pricing') || text.includes('cost') || text.includes('quote')) &&
    (hasTwentyUsers || text.includes('custom') || text.includes('discount') || text.includes('negotiat') || text.includes('annual contract'));

  if (wantsDiscountOrCustomPricing) {
    return {
      shouldHandoff: true,
      reason: 'Enterprise / custom pricing for 20+ users requires human sales qualification.',
    };
  }

  // 3. Unhappiness or complaint
  if (
    text.includes('angry') ||
    text.includes('unhappy') ||
    text.includes('terrible') ||
    text.includes('scam') ||
    text.includes('lawyer') ||
    text.includes('complaint')
  ) {
    return { shouldHandoff: true, reason: 'Customer sentiment flagged as dissatisfied / escalation needed.' };
  }

  // 4. Contractual / legal commitments
  if (text.includes('contractual guarantee') || text.includes('sla agreement') || text.includes('liability')) {
    return { shouldHandoff: true, reason: 'Contractual commitment or legal query requested.' };
  }

  // 5. Zero relevant knowledge found for technical or commercial query
  if (knowledgeChunks.length === 0 && (text.includes('how do you') || text.includes('can it') || text.includes('pricing'))) {
    return { shouldHandoff: true, reason: 'No confirmed information in knowledge base for specific query.' };
  }

  return { shouldHandoff: false };
}

/**
 * Generates an omnichannel AI response using server-side OpenAI or verified domain knowledge engine.
 *
 * allowBooking (default FALSE): when true, a demo-intent message is sent to the
 * calendar scheduling agent, which may create a real Google Calendar event + Meet
 * link. Automatic reply flows (App.tsx auto-reply engine) must NEVER set this.
 */
export async function generateOmnichannelResponse(params: {
  incomingMessage: string;
  contact: Contact;
  lead?: Lead;
  conversation: Conversation;
  recentMessages: Message[];
  knowledgeDocs: KnowledgeDocument[];
  signature?: string;
  allowBooking?: boolean;
}): Promise<AiResponseResult> {
  const {
    incomingMessage,
    contact,
    lead,
    conversation,
    recentMessages,
    knowledgeDocs,
    signature = 'Regards,\nUmrah360 Team',
    allowBooking = false,
  } = params;

  // Only what the customer newly wrote (no quoted campaign email / signature).
  // Falls back to the full text if stripping leaves nothing.
  const freshMessage = stripQuotedEmailHistory(incomingMessage) || incomingMessage;

  // Step 1: Intent detection & Knowledge retrieval (RAG)
  const knowledgeChunks = retrieveRelevantKnowledge(incomingMessage, knowledgeDocs, 3);
  const knowledgeSources = knowledgeChunks.map((c) => c.title);

  // Step 1.5: Demo scheduling via the calendar agent. OFF unless allowBooking is explicitly true.
  const isDemoIntent =
    allowBooking &&
    /(schedule\s+(a\s+)?(demo|meeting|call|walkthrough)|book\s+(a\s+)?(demo|call|meeting|slot)|want\s+(a\s+)?(demo|walkthrough)|give\s+me\s+(a\s+)?demo|reschedule|cancel\s+(the\s+)?(demo|meeting|call))/i.test(
      freshMessage
    );
  if (isDemoIntent) {
    try {
      const schedRes = await fetch('/api/calendar/schedule-turn', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messageText: freshMessage,
          conversationHistory: recentMessages.map((m) => ({
            role: m.senderType === 'CUSTOMER' || m.senderType === 'PROSPECT' ? 'user' : 'assistant',
            content: stripQuotedEmailHistory(m.text) || m.text,
          })),
          leadContext: {
            leadId: lead?.leadId,
            contactId: contact.contactId,
            leadName: `${contact.firstName} ${contact.lastName}`.trim(),
            leadEmail: contact.email,
            leadPhone: contact.phone,
            companyName: contact.companyName,
            channel: conversation.channel,
            conversationId: conversation.conversationId,
          },
        }),
      });

      if (schedRes.ok) {
        const schedData = await schedRes.json();
        if (schedData.handled && schedData.replyText) {
          return {
            responseText: schedData.replyText,
            confidence: 0.98,
            knowledgeSources: ['Google Calendar Real-Time Availability Engine'],
            humanHandoffTriggered: false,
            classification: 'DEMO_REQUEST',
            leadQualification: {
              isLead: true,
              leadScore: schedData.action === 'CONFIRMED_BOOKING' ? 98 : 90,
              intent: 'HIGH',
              buyingStage: 'DECISION',
              requirements: [...(lead?.requirements || []), 'Platform Walkthrough'],
              budget: lead?.budget || null,
              timeline: 'Immediate',
              nextAction: schedData.action === 'CONFIRMED_BOOKING' ? 'Attend booked Google Meet walkthrough' : 'Coordinate demo slot selection',
            },
            memoryUpdate: {
              customerFacts: [`Requested demo for ${contact.companyName}`],
              requirements: [...(lead?.requirements || []), 'Demo Scheduled'],
              buyingStage: 'DECISION',
              nextAction: 'Platform Demo',
            },
          };
        }
      }
    } catch (schedErr) {
      console.warn('Direct /api/calendar/schedule-turn call notice:', schedErr);
    }
  }

  // Step 2: Human handoff check (on the customer's new text only)
  const handoffCheck = checkHumanHandoffConditions(freshMessage, conversation, knowledgeChunks);

  // Try calling the server-side API first
  try {
    const apiResponse = await fetch('/api/ai/respond', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        incomingMessage,
        contact,
        lead,
        conversation,
        recentMessages: recentMessages.slice(-6),
        knowledgeChunks,
        handoffCheck,
        signature,
      }),
    });

    if (apiResponse.ok) {
      const data = await apiResponse.json();
      return data;
    }
  } catch (err) {
    console.warn('Backend /api/ai/respond call bypassed, executing intelligent domain fall-through:', err);
  }

  // Rule-based Domain Knowledge Engine (strictly grounded in approved Umrah360 documentation)
  const lowerMsg = freshMessage.toLowerCase();

  const channel = conversation?.channel || 'EMAIL';
  const isWebsite = channel === 'WEBSITE' || (conversation?.conversationId || '').startsWith('conv-web-');

  if (!isWebsite) {
    const fromLower = (contact?.email || "").toLowerCase().trim();
    const isBotOrNewsletter =
      fromLower.includes("no-reply") ||
      fromLower.includes("noreply") ||
      fromLower.includes("mailer-daemon") ||
      fromLower.includes("postmaster") ||
      fromLower.includes("newsletter") ||
      fromLower.includes("bounce") ||
      fromLower.includes("alerts@") ||
      fromLower.includes("notifications@") ||
      fromLower.includes("bot@") ||
      lowerMsg.includes("click here to unsubscribe") ||
      lowerMsg.includes("view in browser") ||
      lowerMsg.includes("unsubscribe here") ||
      lowerMsg.includes("manage your preferences");

    const hasRelevanceKeywords =
      lowerMsg.includes("b2b") ||
      lowerMsg.includes("b2c") ||
      lowerMsg.includes("portal") ||
      lowerMsg.includes("allotment") ||
      lowerMsg.includes("cost") ||
      lowerMsg.includes("pricing") ||
      lowerMsg.includes("package") ||
      lowerMsg.includes("software") ||
      lowerMsg.includes("platform") ||
      lowerMsg.includes("booking") ||
      lowerMsg.includes("enquiry") ||
      lowerMsg.includes("issue") ||
      lowerMsg.includes("problem") ||
      lowerMsg.includes("error") ||
      lowerMsg.includes("demo") ||
      lowerMsg.includes("interested") ||
      lowerMsg.includes("help") ||
      lowerMsg.includes("question") ||
      lowerMsg.includes("contact") ||
      lowerMsg.includes("support") ||
      lowerMsg.includes("sales") ||
      lowerMsg.includes("business") ||
      lowerMsg.includes("client") ||
      lowerMsg.includes("service") ||
      lowerMsg.includes("product") ||
      lowerMsg.includes("account") ||
      lowerMsg.includes("integration") ||
      lowerMsg.includes("partner");

    if (isBotOrNewsletter || !hasRelevanceKeywords) {
      console.log(`[Client Fallback Classifier] Ignored message: isBot=${isBotOrNewsletter}, hasRelevance=${hasRelevanceKeywords}`);
      return {
        responseText: "AI qualification filter: ignored (not a qualified customer inquiry, issue, or interest)",
        confidence: 0,
        knowledgeSources: [],
        humanHandoffTriggered: false,
        ignored: true,
        reason: "Message is classified as bot/newsletter or completely unrelated topic.",
        leadQualification: {
          isLead: false,
          leadScore: 0,
          intent: 'LOW',
          buyingStage: 'AWARENESS',
          requirements: [],
          nextAction: 'Ignore automated notification',
        },
        memoryUpdate: {},
      };
    }
  }

  // If handoff is triggered
  if (handoffCheck.shouldHandoff) {
    let responseText = '';
    if (lowerMsg.includes('20') || lowerMsg.includes('enterprise') || lowerMsg.includes('pricing')) {
      responseText = `Thank you for your interest, ${contact.firstName || 'there'}! For teams of 20+ users, our Enterprise tier includes custom dedicated cloud hosting, high-volume B2B sub-agent capacity, and tailored onboarding.\n\nBecause Enterprise packages are customized to your agency's transaction volume, I have connected our Senior Solutions Specialist to share a tailored proposal and schedule a short walkthrough. Someone will reach out to you shortly.\n\n${signature}`;
    } else {
      responseText = `I don't have confirmed information on that specific detail in our verified documentation. I'll connect you directly with our senior pilgrimage operations team so they can assist you personally.\n\n${signature}`;
    }

    return {
      responseText,
      confidence: 0.95,
      knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : ['Umrah360 Sales Policy'],
      humanHandoffTriggered: true,
      handoffReason: handoffCheck.reason,
      classification: lowerMsg.includes('pricing') ? 'PRICING_REQUEST' : 'QUESTION',
      leadQualification: {
        isLead: true,
        leadScore: Math.min(100, (lead?.leadScore || 65) + 15),
        intent: 'HIGH',
        buyingStage: 'CONSIDERATION',
        requirements: [...(lead?.requirements || []), 'Enterprise 20+ seats', 'Custom pricing'],
        budget: 'Enterprise Quote Required',
        timeline: 'Immediate',
        nextAction: 'Senior specialist follow-up for 20-seat Enterprise quote',
      },
      memoryUpdate: {
        customerFacts: [`Interested in Umrah360 for ${contact.companyName || 'agency'}`, 'Inquired about 20-user Enterprise plan'],
        requirements: ['20+ user seats', 'Custom quote'],
        buyingStage: 'CONSIDERATION',
        nextAction: 'Human handoff - custom pricing quote',
      },
    };
  }

  // General questions using approved knowledge
  let responseText = '';
  const newRequirements: string[] = [...(lead?.requirements || [])];
  let intent: IntentLevel = lead?.intent || 'MEDIUM';
  let buyingStage: BuyingStage = lead?.buyingStage || 'AWARENESS';
  let leadScore = lead?.leadScore || 60;
  let classification = 'QUESTION';

  if (lowerMsg.includes('b2b') || lowerMsg.includes('agent') || lowerMsg.includes('sub-agent')) {
    classification = 'QUESTION';
    intent = 'HIGH';
    buyingStage = 'CONSIDERATION';
    leadScore = Math.max(leadScore, 85);
    newRequirements.push('B2B Sub-Agent Portal');
    responseText = `Yes! Umrah360 provides a complete white-label B2B Sub-Agent Portal. It allows tour operators to distribute packages to external travel agents, manage custom multi-tier markups, establish real-time credit wallets, and enable agents to generate branded PDF vouchers instantly with their own agency logo.\n\nWould you like to see how sub-agent allotments and credit limits are configured?\n\n${signature}`;
  } else if (
    lowerMsg.includes('what') &&
    (lowerMsg.includes('software') || lowerMsg.includes('umrah360') || lowerMsg.includes('does') || lowerMsg.includes('tell me'))
  ) {
    classification = 'QUESTION';
    leadScore = Math.max(leadScore, 75);
    responseText = `Umrah360 is an all-in-one cloud ERP and CRM software purpose-built for Hajj and Umrah tour operators. It streamlines your entire business from lead management and customized FIT package creation to Saudi visa tracking, dynamic costing, multi-currency invoicing, and B2B sub-agent distribution.\n\nAre you currently handling your operations through spreadsheets or looking to upgrade from another system?\n\n${signature}`;
  } else if (lowerMsg.includes('price') || lowerMsg.includes('pricing') || lowerMsg.includes('cost') || lowerMsg.includes('plan')) {
    classification = 'PRICING_REQUEST';
    intent = 'HIGH';
    buyingStage = 'CONSIDERATION';
    leadScore = Math.max(leadScore, 80);
    responseText = `Here is our approved subscription pricing:\n• Starter Plan: $199/month (up to 3 users) — includes B2C CRM, FIT package builder, and invoicing.\n• Growth Plan: $499/month (up to 10 users) — includes everything in Starter plus the complete B2B Sub-Agent Portal, dynamic multi-currency costing, and automated alerts.\n• Enterprise Plan: For 20+ users, custom quotes with dedicated cloud hosting and SLA guarantees are available through our team.\n\nHow many team members would be using the software at ${contact.companyName || 'your agency'}?\n\n${signature}`;
  } else if (lowerMsg.includes('demo') || lowerMsg.includes('schedule') || lowerMsg.includes('call')) {
    classification = 'DEMO_REQUEST';
    intent = 'HIGH';
    buyingStage = 'DECISION';
    leadScore = Math.max(leadScore, 92);
    responseText = `We would be glad to give you a personalized 1-on-1 walkthrough of Umrah360 tailored to ${contact.companyName || 'your business'}!\n\nOur solutions specialist can show you how to generate a custom Makkah/Madinah package and manage sub-agent vouchers. When would be a good time for a 20-minute Google Meet or Zoom call?\n\n${signature}`;
  } else if (lowerMsg.includes('not interested') || lowerMsg.includes('unsubscribe') || lowerMsg.includes('remove')) {
    classification = 'UNSUBSCRIBE';
    intent = 'LOW';
    responseText = `Understood. We have updated your preferences and will stop all automated communications. Thank you for your time.\n\n${signature}`;
  } else if (knowledgeChunks.length > 0) {
    const chunk = knowledgeChunks[0];
    responseText = `Based on Umrah360's verified capabilities:\n\n${chunk.relevantExcerpt}\n\nPlease let me know if you would like more details or if you'd like to explore a live demonstration.\n\n${signature}`;
  } else {
    responseText = `Thank you for reaching out! Umrah360 is built specifically to automate Hajj and Umrah tour operations, including B2B reseller portals, dynamic package pricing, and Saudi visa management.\n\nCould you let us know what specific operational challenge you're looking to solve?\n\n${signature}`;
  }

  return {
    responseText,
    confidence: 0.94,
    knowledgeSources,
    humanHandoffTriggered: false,
    classification,
    leadQualification: {
      isLead: true,
      leadScore,
      intent,
      buyingStage,
      requirements: Array.from(new Set(newRequirements)),
      budget: lead?.budget || null,
      timeline: lead?.timeline || 'Within 1 month',
      nextAction: intent === 'HIGH' ? 'Schedule platform demo' : 'Follow up with product brochure',
    },
    memoryUpdate: {
      customerFacts: [`Engaged regarding ${classification}`, `Operates ${contact.companyName || 'pilgrimage agency'}`],
      requirements: Array.from(new Set(newRequirements)),
      buyingStage,
      nextAction: intent === 'HIGH' ? 'Schedule demo' : 'Provide product information',
    },
  };
}

/**
 * AI Lead Qualification for Outbound Apollo Prospects (Section 10)
 */
export async function qualifyApolloProspect(params: {
  jobTitle: string;
  companyName: string;
  industry: string;
  companySize: string;
  location: string;
}): Promise<{ qualified: boolean; score: number; reason: string; recommended: boolean }> {
  const { jobTitle, companyName, industry, location } = params;

  // Title fit: Founder, Owner, Director, CEO, Managing Director, Partner
  const isDecisionMaker = /founder|owner|director|ceo|managing director|partner|proprietor|head of operations|travel consultant/i.test(
    jobTitle
  );

  // Industry fit: Umrah, Hajj, Pilgrimage, Travel, Tours, Tourism, Hospitality
  const isPilgrimageOrTravel = /umrah|hajj|pilgrimage|travel|tour|tourism|holiday/i.test(
    `${industry} ${companyName}`
  );

  let score = 50;
  if (isDecisionMaker) score += 25;
  if (isPilgrimageOrTravel) score += 20;
  if (/india|uae|saudi|uk|indonesia|pakistan|bangladesh|egypt/i.test(location)) score += 5;

  const qualified = score >= 75;
  const reason = qualified
    ? `Relevant decision maker (${jobTitle}) at a pilgrimage/travel company (${companyName}) in target market.`
    : `Candidate title (${jobTitle}) or company (${companyName}) does not meet primary target criteria.`;

  return {
    qualified,
    score,
    reason,
    recommended: qualified,
  };
}