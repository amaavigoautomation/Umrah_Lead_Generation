import {
  collection,
  doc,
  getDoc,
  getDocs,
  query,
  where,
  limit,
  deleteDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';
import { sendLiveEmail, getSmtpConfig, fetchFirestoreSmtpConfig } from './smtpService.js';
import { Conversation, Contact, Message } from '../types/index.js';
import { hasThankYouEmailBeenSent, recordThankYouEmailSent } from './websiteLeadService.js';

let isRunningCheck = false;
const inFlightDispatches = new Set<string>();

/**
 * Checks all website demo leads that have arrived in the Unified Inbox.
 * If a lead has an email address and has not received a verified live Thank You email over SMTP,
 * it automatically dispatches the live personalized email and records the delivery metadata in Firestore.
 */
export async function checkAndDispatchPendingWebsiteLeadEmails(): Promise<{
  processedCount: number;
  dispatchedCount: number;
}> {
  if (isRunningCheck) {
    return { processedCount: 0, dispatchedCount: 0 };
  }

  if (!isFirebaseConfigured || !db) {
    return { processedCount: 0, dispatchedCount: 0 };
  }

  isRunningCheck = true;
  let processedCount = 0;
  let dispatchedCount = 0;

  try {
    // 1. Ensure SMTP config is ready
    await fetchFirestoreSmtpConfig();
    const smtpCfg = getSmtpConfig();
    if (!smtpCfg.configured) {
      // SMTP not configured yet, skip this run
      return { processedCount: 0, dispatchedCount: 0 };
    }

    // 2. Query conversations
    const convsSnap = await getDocs(collection(db, 'conversations'));
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

      // CRITICAL: Prevent race condition with live webhook or direct submission.
      // Allow 45 seconds for live webhook SMTP delivery to complete before considering it pending.
      const createdAtMs = conv.createdAt ? new Date(conv.createdAt).getTime() : (conv.startedAt ? new Date(conv.startedAt).getTime() : 0);
      if (createdAtMs > 0 && Date.now() - createdAtMs < 45000) {
        continue;
      }

      // If customerEmail is present and has already received a thank-you email, mark conversation as sent and skip
      if (conv.customerEmail && conv.customerEmail.includes('@')) {
        const alreadySent = await hasThankYouEmailBeenSent(conv.customerEmail);
        if (alreadySent) {
          safeSetDoc(
            doc(db, 'conversations', conv.conversationId),
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
      const result = await dispatchThankYouEmailForConversation(conv.conversationId);
      if (result.success) {
        dispatchedCount++;
      }
    }
  } catch (err) {
    console.warn('[Website Auto-Responder Notice]:', err);
  } finally {
    isRunningCheck = false;
  }

  return { processedCount, dispatchedCount };
}

/**
 * Dispatches a personalized Thank You / Demo Walkthrough confirmation email
 * directly to the email address of a lead in a specific conversation.
 * GUARANTEE: Exactly ONCE per email address across the entire platform.
 */
export async function dispatchThankYouEmailForConversation(conversationId: string): Promise<{
  success: boolean;
  messageId?: string;
  error?: string;
  email?: string;
}> {
  if (!isFirebaseConfigured || !db) {
    return { success: false, error: 'Database is not initialized.' };
  }

  if (inFlightDispatches.has(conversationId)) {
    return { success: true, messageId: 'IN_FLIGHT' };
  }

  try {
    await fetchFirestoreSmtpConfig();
    const smtpCfg = getSmtpConfig();
    if (!smtpCfg.configured) {
      return { success: false, error: 'SMTP server credentials not configured.' };
    }

    // 1. Fetch conversation
    const convRef = doc(db, 'conversations', conversationId);
    const convSnap = await getDoc(convRef);
    if (!convSnap.exists()) {
      return { success: false, error: `Conversation ${conversationId} not found.` };
    }
    const conv = convSnap.data() as Conversation;

    // Fast-exit if already flagged as sent
    if (conv.thankYouEmailSent && conv.thankYouSmtpMessageId) {
      return { success: true, messageId: conv.thankYouSmtpMessageId, email: conv.customerEmail };
    }

    // 2. Check if a real delivered email or outbound message already exists for this conversation
    const msgsQuery = query(collection(db, 'messages'), where('conversationId', '==', conversationId));
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

      // If we don't have targetEmail yet, check text or recipientEmail
      if (!targetEmail && m.recipientEmail && m.recipientEmail.includes('@')) {
        targetEmail = m.recipientEmail;
      }
      // Extract from inbound text if present
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
        const contactRef = doc(db, 'contacts', conv.contactId);
        const contactSnap = await getDoc(contactRef);
        if (contactSnap.exists()) {
          contact = contactSnap.data() as Contact;
          if (contact.email && contact.email.includes('@') && !contact.email.includes('@umrah360.in')) {
            targetEmail = contact.email.trim().toLowerCase();
          }
        }
      } catch (cErr) {
        console.warn(`[Website Auto-Responder] Notice loading contact ${conv.contactId}:`, cErr);
      }
    }

    // 4. Strict Idempotency: Check if this email already received a thank-you email ANYWHERE
    if (targetEmail && targetEmail.includes('@')) {
      const emailAlreadySent = await hasThankYouEmailBeenSent(targetEmail);
      if (emailAlreadySent) {
        console.log(`[Website Auto-Responder] Recipient ${targetEmail} has already received a thank-you email. Suppressing duplicate.`);
        alreadyDelivered = true;
      }
    }

    if (alreadyDelivered) {
      // Clean up any stale pending or duplicate unverified messages so only the delivered one remains
      if (pendingMsgDocId) {
        deleteDoc(doc(db, 'messages', pendingMsgDocId)).catch(() => {});
      }
      for (const dupId of staleDuplicateDocIds) {
        deleteDoc(doc(db, 'messages', dupId)).catch(() => {});
      }

      // Ensure conversation is flagged as sent
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

    if (inFlightDispatches.has(targetEmail)) {
      return { success: true, messageId: 'IN_FLIGHT_EMAIL', email: targetEmail };
    }

    inFlightDispatches.add(conversationId);
    inFlightDispatches.add(targetEmail);

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

    console.log(`[Website Auto-Responder] Dispatching single Thank You email to ${targetEmail} for ${companyName}...`);

    // 6. Send Live Email via verified SMTP service
    const mailResult = await sendLiveEmail({
      to: targetEmail,
      subject,
      text: emailBody,
      headers: {
        'X-Conversation-Id': conversationId,
        'X-Lead-Id': conv.leadId || '',
        'X-Contact-Id': conv.contactId || '',
      },
    });

    if (!mailResult.success) {
      console.warn(`[Website Auto-Responder Error] SMTP delivery failed to ${targetEmail}:`, mailResult.error);
      return { success: false, error: mailResult.error || 'SMTP delivery failed', email: targetEmail };
    }

    const nowIso = new Date().toISOString();
    const autoReplyMsgId = pendingMsgDocId || `msg-thankyou-${conversationId}`;

    // 7. Record the verified outbound message in Firestore
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

    await safeSetDoc(doc(db, 'messages', autoReplyMsgId), outboundMessage, { merge: true });

    // Clean up any other duplicate doc IDs in Firestore
    for (const dupId of staleDuplicateDocIds) {
      if (dupId !== autoReplyMsgId) {
        deleteDoc(doc(db, 'messages', dupId)).catch(() => {});
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

    // 9. Record in global persistent idempotency ledger
    await recordThankYouEmailSent(targetEmail, {
      leadId: conv.leadId,
      conversationId,
      smtpMessageId: mailResult.messageId,
    });

    console.log(`[Website Auto-Responder Success] ✓ Real Thank You email delivered to ${targetEmail} (Message ID: ${mailResult.messageId})!`);

    return {
      success: true,
      messageId: mailResult.messageId,
      email: targetEmail,
    };
  } catch (err: any) {
    console.error(`[Website Auto-Responder Exception] Error dispatching for ${conversationId}:`, err);
    return { success: false, error: err?.message || 'Internal error' };
  } finally {
    inFlightDispatches.delete(conversationId);
  }
}

