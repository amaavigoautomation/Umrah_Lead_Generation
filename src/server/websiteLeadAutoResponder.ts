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

let isRunningCheck = false;

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

    convsSnap.forEach((d) => {
      const conv = d.data() as Conversation;
      // Identify website demo requests
      const isWebsiteLead =
        conv.conversationId?.startsWith('conv-web-') ||
        conv.channel === 'WEBSITE' ||
        (conv.conversationSummary && conv.conversationSummary.includes('Website Demo Request')) ||
        conv.subject?.includes('Website Demo Request');

      if (isWebsiteLead && !conv.thankYouEmailSent) {
        candidateConvs.push(conv);
      }
    });

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

    // 2. Check if a real delivered email already exists for this conversation
    const msgsQuery = query(collection(db, 'messages'), where('conversationId', '==', conversationId));
    const msgsSnap = await getDocs(msgsQuery);

    let alreadyDelivered = Boolean(conv.thankYouEmailSent && conv.thankYouSmtpMessageId);
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
        if (m.deliveryStatus === 'DELIVERED' || Boolean(m.smtpMessageId && m.smtpMessageId.startsWith('<'))) {
          if (!deliveredMsgDocId) {
            deliveredMsgDocId = mDoc.id;
            alreadyDelivered = true;
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
            thankYouSmtpMessageId: conv.thankYouSmtpMessageId || 'verified',
            customerEmail: targetEmail,
          },
          { merge: true }
        ).catch(() => {});
      }

      return { success: true, messageId: conv.thankYouSmtpMessageId, email: targetEmail };
    }

    // 3. Fetch contact details to obtain real email
    let contact: Contact | null = null;
    if (conv.contactId) {
      try {
        const contactRef = doc(db, 'contacts', conv.contactId);
        const contactSnap = await getDoc(contactRef);
        if (contactSnap.exists()) {
          contact = contactSnap.data() as Contact;
          if (contact.email && contact.email.includes('@') && !contact.email.includes('@umrah360.in')) {
            targetEmail = contact.email;
          }
        }
      } catch (cErr) {
        console.warn(`[Website Auto-Responder] Notice loading contact ${conv.contactId}:`, cErr);
      }
    }

    if (!targetEmail || !targetEmail.includes('@') || targetEmail.includes('@placeholder') || targetEmail.endsWith('@umrah360.in')) {
      return {
        success: false,
        error: `No valid customer email address found for lead in conversation ${conversationId}.`,
      };
    }

    // 4. Construct personalized Thank You message
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
      `As-salamu alaykum ${firstName},`,
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

    console.log(`[Website Auto-Responder] Dispatching real Thank You email to ${targetEmail} for ${companyName}...`);

    // 5. Send Live Email via verified SMTP service
    const mailResult = await sendLiveEmail({
      to: targetEmail,
      subject,
      text: emailBody,
    });

    if (!mailResult.success) {
      console.warn(`[Website Auto-Responder Error] SMTP delivery failed to ${targetEmail}:`, mailResult.error);
      return { success: false, error: mailResult.error || 'SMTP delivery failed', email: targetEmail };
    }

    const nowIso = new Date().toISOString();
    const autoReplyMsgId = pendingMsgDocId || `msg-thankyou-${conversationId}`;

    // 6. Record the verified outbound message in Firestore (reusing existing doc ID if pending)
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

    // 7. Update conversation document
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

    console.log(`[Website Auto-Responder Success] ✓ Real Thank You email delivered to ${targetEmail} (Message ID: ${mailResult.messageId})!`);

    return {
      success: true,
      messageId: mailResult.messageId,
      email: targetEmail,
    };
  } catch (err: any) {
    console.error(`[Website Auto-Responder Exception] Error dispatching for ${conversationId}:`, err);
    return { success: false, error: err?.message || 'Internal error' };
  }
}
