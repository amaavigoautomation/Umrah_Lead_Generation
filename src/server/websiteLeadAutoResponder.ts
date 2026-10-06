import {
  getDoc,
  getDocs,
  query,
  where,
  deleteDoc,
} from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import { sendLiveEmail, getSmtpConfig, fetchFirestoreSmtpConfig } from './smtpService.js';
import { Conversation, Contact, Message } from '../types/index.js';
import { hasThankYouEmailBeenSent, recordThankYouEmailSent } from './websiteLeadService.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

// Isolated per-tenant state tracking (no cross-tenant singletons)
const tenantRunningChecks = new Set<string>();
const tenantInFlightDispatches = new Map<string, Set<string>>();

function getInFlightSet(tenantId: string): Set<string> {
  let set = tenantInFlightDispatches.get(tenantId);
  if (!set) {
    set = new Set<string>();
    tenantInFlightDispatches.set(tenantId, set);
  }
  return set;
}

/**
 * Checks all website demo leads that have arrived in the Unified Inbox for the given tenant.
 * If a lead has an email address and has not received a verified live Thank You email over SMTP,
 * it automatically dispatches the live personalized email and records the delivery metadata in Firestore.
 */
export async function checkAndDispatchPendingWebsiteLeadEmails(
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<{
  processedCount: number;
  dispatchedCount: number;
}> {
  if (tenantRunningChecks.has(ctx.tenantId)) {
    return { processedCount: 0, dispatchedCount: 0 };
  }

  if (!isFirebaseConfigured || !db) {
    return { processedCount: 0, dispatchedCount: 0 };
  }

  tenantRunningChecks.add(ctx.tenantId);
  let processedCount = 0;
  let dispatchedCount = 0;

  try {
    const repo = tenantRepo(ctx);

    // 1. Ensure SMTP config is ready
    await fetchFirestoreSmtpConfig();
    const smtpCfg = getSmtpConfig();
    if (!smtpCfg.configured) {
      return { processedCount: 0, dispatchedCount: 0 };
    }

    // 2. Query tenant conversations
    const convsSnap = await getDocs(repo.conversations());
    const candidateConvs: Conversation[] = [];

    for (const d of convsSnap.docs) {
      const conv = d.data() as Conversation;
      // Identify website demo requests
      const isWebsiteLead =
        conv.conversationId?.startsWith('conv-web-') ||
        conv.channel === 'WEBSITE' ||
        (conv.conversationSummary && conv.conversationSummary.includes('Website Demo Request')) ||
        conv.subject?.includes('Website Demo Request');

      if (!isWebsiteLead) continue;

      if (conv.thankYouEmailSent) {
        continue;
      }

      // Allow 45 seconds for live webhook SMTP delivery to complete before considering it pending.
      const createdAtMs = conv.createdAt
        ? new Date(conv.createdAt).getTime()
        : conv.startedAt
        ? new Date(conv.startedAt).getTime()
        : 0;
      if (createdAtMs > 0 && Date.now() - createdAtMs < 45000) {
        continue;
      }

      // If customerEmail is present and has already received a thank-you email, mark conversation as sent and skip
      if (conv.customerEmail && conv.customerEmail.includes('@')) {
        const alreadySent = await hasThankYouEmailBeenSent(conv.customerEmail, ctx);
        if (alreadySent) {
          safeSetDoc(
            repo.conversationDoc(conv.conversationId),
            {
              thankYouEmailSent: true,
              thankYouSmtpMessageId: conv.thankYouSmtpMessageId || 'ALREADY_SENT_PREVIOUSLY',
            },
            { merge: true }
          ).catch(() => {});
          continue;
        }
      }

      candidateConvs.push(conv);
    }

    for (const conv of candidateConvs) {
      processedCount++;
      const result = await dispatchThankYouEmailForConversation(conv.conversationId, ctx);
      if (result.success) {
        dispatchedCount++;
      }
    }

    return { processedCount, dispatchedCount };
  } catch (err) {
    console.error(`[Website Auto-Responder] Error running check for tenant ${ctx.tenantId}:`, err);
    return { processedCount, dispatchedCount };
  } finally {
    tenantRunningChecks.delete(ctx.tenantId);
  }
}

/**
 * Dispatches a Thank You confirmation email for a specific website conversation
 */
export async function dispatchThankYouEmailForConversation(
  conversationId: string,
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  email?: string;
}> {
  if (!isFirebaseConfigured || !db) {
    return { success: false, error: 'Database is not initialized.' };
  }

  const inFlight = getInFlightSet(ctx.tenantId);
  if (inFlight.has(conversationId)) {
    return { success: true, messageId: 'IN_FLIGHT' };
  }

  try {
    const repo = tenantRepo(ctx);
    await fetchFirestoreSmtpConfig();
    const smtpCfg = getSmtpConfig();
    if (!smtpCfg.configured) {
      return { success: false, error: 'SMTP server credentials not configured.' };
    }

    // 1. Fetch conversation
    const convRef = repo.conversationDoc(conversationId);
    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) {
      return { success: false, error: `Conversation ${conversationId} not found in tenant ${ctx.tenantId}.` };
    }
    const conv = convSnap.data() as Conversation;

    // Fast-exit if already flagged as sent
    if (conv.thankYouEmailSent && conv.thankYouSmtpMessageId) {
      return { success: true, messageId: conv.thankYouSmtpMessageId, email: conv.customerEmail };
    }

    // 2. Check if a real delivered email or outbound message already exists for this conversation
    const msgsQuery = query(repo.messages(), where('conversationId', '==', conversationId));
    const msgsSnap = await getDocs(msgsQuery);

    let alreadyDelivered = Boolean(conv.thankYouEmailSent);
    let targetEmail = conv.customerEmail || '';
    let extractedDetails: {
      fullName?: string;
      companyName?: string;
      product?: string;
      teamSize?: string;
      phone?: string;
      city?: string;
      country?: string;
    } = {};

    let deliveredMsgDocId: string | null = null;
    let pendingMsgDocId: string | null = null;
    const staleDuplicateDocIds: string[] = [];

    msgsSnap.forEach((mDoc) => {
      const m = mDoc.data() as Message;
      const isOutboundThankYou =
        m.direction === 'OUTBOUND' &&
        (m.text?.includes('Thank you for requesting') ||
          m.text?.includes('We have received your requirements') ||
          m.text?.includes('As-salamu alaykum'));

      if (isOutboundThankYou) {
        alreadyDelivered = true;
        if (m.deliveryStatus === 'DELIVERED' || Boolean(m.smtpMessageId && m.smtpMessageId.startsWith('<'))) {
          if (!deliveredMsgDocId) {
            deliveredMsgDocId = mDoc.id;
            if (m.smtpMessageId && !conv.thankYouSmtpMessageId) {
              conv.thankYouSmtpMessageId = m.smtpMessageId;
            }
          } else {
            staleDuplicateDocIds.push(mDoc.id);
          }
        } else {
          if (!pendingMsgDocId) {
            pendingMsgDocId = mDoc.id;
          } else {
            staleDuplicateDocIds.push(mDoc.id);
          }
        }
      }

      if (!targetEmail && m.recipientEmail && m.recipientEmail.includes('@')) {
        targetEmail = m.recipientEmail;
      }
      if (m.direction === 'INBOUND' && m.text) {
        const emailMatch = m.text.match(/•\s*Email:\s*([^\s\n\r]+@[^\s\n\r]+)/i);
        if (emailMatch && emailMatch[1]) {
          targetEmail = emailMatch[1].trim();
        }
        const nameMatch = m.text.match(/•\s*Name:\s*([^\n\r(]+)/i);
        if (nameMatch && nameMatch[1]) {
          extractedDetails.fullName = nameMatch[1].trim();
        }
        const companyMatch = m.text.match(/•\s*Company:\s*([^\n\r(]+)/i);
        if (companyMatch && companyMatch[1]) {
          extractedDetails.companyName = companyMatch[1].trim();
        }
        const productMatch = m.text.match(/•\s*Product Interest:\s*([^\n\r]+)/i);
        if (productMatch && productMatch[1]) {
          extractedDetails.product = productMatch[1].trim();
        }
        const phoneMatch = m.text.match(/•\s*Phone:\s*([^\n\r]+)/i);
        if (phoneMatch && phoneMatch[1]) {
          extractedDetails.phone = phoneMatch[1].trim();
        }
      }
    });

    targetEmail = targetEmail.trim().toLowerCase();

    // 3. Fetch contact details to obtain real email if needed
    let contact: Contact | null = null;
    if ((!targetEmail || !targetEmail.includes('@')) && conv.contactId) {
      try {
        const contactRef = repo.contactDoc(conv.contactId);
        const contactSnap = await getDoc(contactRef);
        if (contactSnap.exists()) {
          contact = contactSnap.data() as Contact;
          if (contact.email && contact.email.includes('@') && !contact.email.includes('@umrah360.in')) {
            targetEmail = contact.email.trim().toLowerCase();
          }
        }
      } catch (cErr) {
        console.warn(`[Website Auto-Responder] Notice loading contact ${conv.contactId} for ${ctx.tenantId}:`, cErr);
      }
    }

    // 4. Strict Idempotency: Check if this email already received a thank-you email for this tenant
    if (targetEmail && targetEmail.includes('@')) {
      const emailAlreadySent = await hasThankYouEmailBeenSent(targetEmail, ctx);
      if (emailAlreadySent) {
        console.log(`[Website Auto-Responder] Recipient ${targetEmail} has already received a thank-you email for ${ctx.tenantId}. Suppressing duplicate.`);
        alreadyDelivered = true;
      }
    }

    if (alreadyDelivered) {
      if (pendingMsgDocId) {
        deleteDoc(repo.messageDoc(pendingMsgDocId)).catch(() => {});
      }
      for (const dupId of staleDuplicateDocIds) {
        deleteDoc(repo.messageDoc(dupId)).catch(() => {});
      }

      if (!conv.thankYouEmailSent) {
        safeSetDoc(
          convRef,
          {
            thankYouEmailSent: true,
            thankYouSmtpMessageId: conv.thankYouSmtpMessageId || 'verified_single',
            customerEmail: targetEmail,
          },
          { merge: true }
        ).catch(() => {});
      }

      return { success: true, messageId: conv.thankYouSmtpMessageId || 'already_delivered', email: targetEmail };
    }

    if (!targetEmail || !targetEmail.includes('@') || targetEmail.includes('@placeholder') || targetEmail.endsWith('@umrah360.in')) {
      return {
        success: false,
        error: `No valid customer email address found for lead in conversation ${conversationId}.`,
      };
    }

    if (inFlight.has(targetEmail)) {
      return { success: true, messageId: 'IN_FLIGHT_EMAIL', email: targetEmail };
    }

    inFlight.add(conversationId);
    inFlight.add(targetEmail);

    // 5. Construct personalized Thank You message
    const firstName =
      contact?.firstName ||
      extractedDetails.fullName?.split(/\s+/)[0] ||
      'there';
    const companyName =
      contact?.companyName ||
      extractedDetails.companyName ||
      'your agency';
    const product =
      extractedDetails.product ||
      contact?.tags?.find((t) => t !== 'WEBSITE_DEMO_FORM' && t !== 'UMRAH360_IN') ||
      'Umrah360 Platform';
    const phone = contact?.phone || extractedDetails.phone || '';

    const subject = `We have received your Umrah360 Demo Request - ${companyName}`;
    const emailBody = [
      `Dear ${firstName},`,
      ``,
      `Thank you for requesting a live demo of Umrah360 for ${companyName}!`,
      ``,
      `We have received your requirements:`,
      `- Product Interest: ${product}`,
      ...(contact?.city || contact?.country ? [`- Location: ${[contact?.city, contact?.country].filter(Boolean).join(', ')}`] : []),
      ...(contact?.teamSize ? [`- Team Size: ${contact.teamSize}`] : []),
      ...(contact?.branches ? [`- Multi-Branch Setup: ${contact.branches}`] : []),
      ``,
      `One of our senior pilgrimage software specialists will reach out to you shortly at ${phone || targetEmail} to coordinate a suitable time for your personalized walkthrough and answer any operational questions you have.`,
      ``,
      `If you have specific Saudi visa tracking, Makkah/Madinah hotel contracting, or B2B sub-agent workflows you would like to test, simply reply to this email.`,
      ``,
      `Warm regards,`,
      `The Umrah360 Team`,
      `https://umrah360.in`,
    ].join('\n');

    console.log(`[Website Auto-Responder] Dispatching single Thank You email to ${targetEmail} for ${companyName} (${ctx.tenantId})...`);

    // 6. Send Live Email via verified SMTP service
    const mailResult = await sendLiveEmail({
      tenantId: ctx.tenantId,
      to: targetEmail,
      subject,
      text: emailBody,
      headers: {
        'X-Conversation-Id': conversationId,
        'X-Lead-Id': conv.leadId || '',
        'X-Contact-Id': conv.contactId || '',
        'X-Tenant-Id': ctx.tenantId,
      },
    });

    if (!mailResult.success) {
      console.warn(`[Website Auto-Responder Error] SMTP delivery failed to ${targetEmail}:`, mailResult.error);
      return { success: false, error: mailResult.error || 'SMTP delivery failed', email: targetEmail };
    }

    const nowIso = new Date().toISOString();
    const autoReplyMsgId = pendingMsgDocId || `msg-thankyou-${conversationId}`;

    // 7. Record the verified outbound message in tenant Firestore
    const outboundMessage: Message = {
      messageId: autoReplyMsgId,
      conversationId,
      senderType: 'AI',
      senderName: 'Umrah360 Automation',
      senderEmail: smtpCfg.user || 'amaavigo@gmail.com',
      recipientEmail: targetEmail,
      channel: 'EMAIL',
      direction: 'OUTBOUND',
      text: emailBody,
      timestamp: nowIso,
      sentAt: nowIso,
      receivedAt: nowIso,
      aiReplied: true,
      deliveryStatus: 'DELIVERED',
      smtpMessageId: mailResult.messageId,
      emailDeliveredAt: nowIso,
    };

    await safeSetDoc(repo.messageDoc(autoReplyMsgId), outboundMessage, { merge: true });

    // Clean up any other duplicate doc IDs in Firestore
    for (const dupId of staleDuplicateDocIds) {
      if (dupId !== autoReplyMsgId) {
        deleteDoc(repo.messageDoc(dupId)).catch(() => {});
      }
    }

    // 8. Update conversation document
    await safeSetDoc(
      convRef,
      {
        thankYouEmailSent: true,
        thankYouEmailDeliveredAt: nowIso,
        thankYouSmtpMessageId: mailResult.messageId,
        customerEmail: targetEmail,
        lastMessageText: emailBody.slice(0, 160) + '...',
        lastMessageAt: nowIso,
        updatedAt: nowIso,
      },
      { merge: true }
    );

    // 9. Record in tenant persistent idempotency ledger
    await recordThankYouEmailSent(
      targetEmail,
      {
        leadId: conv.leadId,
        conversationId,
        smtpMessageId: mailResult.messageId,
      },
      ctx
    );

    console.log(`[Website Auto-Responder Success] ✓ Real Thank You email delivered to ${targetEmail} (Message ID: ${mailResult.messageId}) for tenant ${ctx.tenantId}!`);

    return {
      success: true,
      messageId: mailResult.messageId,
      email: targetEmail,
    };
  } catch (err: any) {
    console.error(`[Website Auto-Responder Exception] Error dispatching for ${conversationId} in tenant ${ctx.tenantId}:`, err);
    return { success: false, error: err?.message || 'Internal error' };
  } finally {
    inFlight.delete(conversationId);
  }
}
