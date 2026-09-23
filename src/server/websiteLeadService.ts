import { collection, doc, getDocs, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';
import { Contact, Lead, Conversation, Message } from '../types/index.js';
import { sendLiveEmail, getSmtpConfig } from './smtpService.js';

export interface WebsiteLeadInput {
  // Personal
  fullName?: string;
  name?: string;
  your_full_name?: string;
  'your-name'?: string;
  firstName?: string;
  lastName?: string;

  // Contact
  email?: string;
  your_email?: string;
  'your-email'?: string;
  phone?: string;
  phoneNumber?: string;
  phone_number?: string;
  'your-phone'?: string;
  mobile?: string;
  countryCode?: string;
  country_code?: string;
  designation?: string;
  jobTitle?: string;
  job_title?: string;
  role?: string;

  // Location
  country?: string;
  select_country?: string;
  selectCountry?: string;
  city?: string;
  your_city?: string;
  yourCity?: string;

  // Company
  companyName?: string;
  company_name?: string;
  company?: string;
  agency?: string;
  companyWebsite?: string;
  company_website?: string;
  website?: string;
  branches?: string | boolean;
  has_branches?: string | boolean;
  hasBranches?: string | boolean;

  // Product
  product?: string;
  products?: string;
  select_products?: string;
  selectProducts?: string;
  productInterest?: string;
  serviceInterest?: string;
  teamSize?: string;
  team_size?: string;

  // Query
  message?: string;
  query?: string;
  notes?: string;
  comments?: string;
  message_here?: string;

  // Metadata
  sourceUrl?: string;
  referrer?: string;
}

export interface ProcessedLeadResult {
  success: boolean;
  message: string;
  contact: Contact;
  lead: Lead;
  conversation: Conversation;
  initialMessage: Message;
  autoConfirmationSent?: boolean;
}

/**
 * Normalizes input from web forms, WordPress, Elementor, CF7, Webflow, or custom HTML forms.
 */
export async function processWebsiteLeadSubmission(
  rawInput: WebsiteLeadInput
): Promise<ProcessedLeadResult> {
  const input = rawInput || {};

  // 1. Resolve Full Name
  const rawFullName = (
    input.fullName ||
    input.name ||
    input.your_full_name ||
    input['your-name'] ||
    (input.firstName ? `${input.firstName} ${input.lastName || ''}` : '') ||
    'Valued Pilgrim Partner'
  ).trim();

  let firstName = input.firstName?.trim() || '';
  let lastName = input.lastName?.trim() || '';

  if (!firstName) {
    const parts = rawFullName.split(/\s+/);
    firstName = parts[0] || 'Partner';
    lastName = parts.slice(1).join(' ') || '';
  }

  // 2. Resolve & Validate Email
  const email = (input.email || input.your_email || input['your-email'] || '')
    .trim()
    .toLowerCase();

  if (!email || !email.includes('@')) {
    throw new Error('A valid email address is required to submit a demo request.');
  }

  // 3. Resolve Phone with Country Code
  const rawCountryCode = (input.countryCode || input.country_code || '').trim();
  const rawPhone = (
    input.phone ||
    input.phoneNumber ||
    input.phone_number ||
    input['your-phone'] ||
    input.mobile ||
    ''
  ).trim();

  let fullPhone = rawPhone;
  if (rawCountryCode && !rawPhone.startsWith('+')) {
    const cleanCode = rawCountryCode.startsWith('+') ? rawCountryCode : `+${rawCountryCode}`;
    fullPhone = `${cleanCode} ${rawPhone}`.trim();
  }

  // 4. Resolve Designation & Location
  const designation = (
    input.designation ||
    input.jobTitle ||
    input.job_title ||
    input.role ||
    'Tour Operator / Agency Leader'
  ).trim();

  const country = (
    input.country ||
    input.select_country ||
    input.selectCountry ||
    'India'
  ).trim();

  const city = (
    input.city ||
    input.your_city ||
    input.yourCity ||
    ''
  ).trim();

  // 5. Resolve Company Info
  let companyName = (
    input.companyName ||
    input.company_name ||
    input.company ||
    input.agency ||
    ''
  ).trim();

  if (!companyName) {
    // Derive sensible company name from domain or user name
    const domainPart = email.split('@')[1] || '';
    if (domainPart && !['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'].includes(domainPart)) {
      const derived = domainPart.split('.')[0];
      companyName = derived.charAt(0).toUpperCase() + derived.slice(1) + ' Travels';
    } else {
      companyName = `${firstName}'s Pilgrimage Agency`;
    }
  }

  const website = (
    input.companyWebsite ||
    input.company_website ||
    input.website ||
    ''
  ).trim();

  const rawBranches = input.branches ?? input.has_branches ?? input.hasBranches;
  const branches =
    typeof rawBranches === 'boolean'
      ? rawBranches
        ? 'Yes'
        : 'No'
      : typeof rawBranches === 'string' && rawBranches.toLowerCase().includes('yes')
      ? 'Yes'
      : 'No';

  // 6. Resolve Product & Team Size
  const product = (
    input.product ||
    input.products ||
    input.select_products ||
    input.selectProducts ||
    input.productInterest ||
    input.serviceInterest ||
    'Umrah360 ERP & B2B Sub-Agent Portal'
  ).trim();

  const teamSize = (
    input.teamSize ||
    input.team_size ||
    '5-10 Users'
  ).trim();

  // 7. Resolve Message / Query
  const message = (
    input.message ||
    input.query ||
    input.notes ||
    input.comments ||
    input.message_here ||
    ''
  ).trim();

  const sourceUrl = (input.sourceUrl || input.referrer || 'https://umrah360.in/request-demo').trim();

  // 8. Lead Score Calculation
  let leadScore = 85; // Base high intent for direct inbound demo request
  if (teamSize.includes('10') || teamSize.includes('20') || teamSize.includes('Enterprise')) {
    leadScore += 10;
  }
  if (branches === 'Yes') {
    leadScore += 5;
  }
  if (website) {
    leadScore += 2;
  }
  leadScore = Math.min(100, Math.max(70, leadScore));

  const nowIso = new Date().toISOString();

  // -----------------------------------------------------------------
  // 9. Check or Create Contact in Firestore
  // -----------------------------------------------------------------
  let contactId = `contact-web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  let existingContactData: Partial<Contact> = {};

  if (isFirebaseConfigured && db) {
    try {
      const q = query(collection(db, 'contacts'), where('email', '==', email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const found = snap.docs[0].data() as Contact;
        contactId = found.contactId;
        existingContactData = found;
        console.log(`[Website Lead] Matching existing contact found: ${contactId} (${email})`);
      }
    } catch (e) {
      console.warn('[Website Lead] Note looking up existing contact:', e);
    }
  }

  const contact: Contact = {
    contactId,
    firstName: firstName || existingContactData.firstName || 'Partner',
    lastName: lastName || existingContactData.lastName || '',
    email,
    phone: fullPhone || existingContactData.phone || '',
    companyName: companyName || existingContactData.companyName || 'Umrah Tour Operator',
    jobTitle: designation || existingContactData.jobTitle || 'Agency Executive',
    country,
    city,
    website: website || existingContactData.website || '',
    branches,
    hasBranches: branches === 'Yes',
    teamSize,
    notes: message ? `Demo Inquiry: ${message}` : existingContactData.notes || '',
    createdAt: existingContactData.createdAt || nowIso,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
  };

  // -----------------------------------------------------------------
  // 10. Create Lead in Firestore
  // -----------------------------------------------------------------
  const leadId = `lead-web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const aiSummary = `Inbound Free Demo Request received from ${rawFullName} (${designation} at ${companyName}). Located in ${city ? `${city}, ` : ''}${country}. Interested in "${product}". Team size: ${teamSize}. Multi-branch agency: ${branches}. Customer query: "${message || 'Requested full platform walkthrough'}".`;

  const aiRecommendation = `High-intent inbound lead! Action required: Contact ${firstName} (${email} / ${fullPhone || 'phone'}) to confirm demo time slot for ${companyName} and prepare customized pricing for ${teamSize}.`;

  const requirements = [
    product,
    `Team Size: ${teamSize}`,
    branches === 'Yes' ? 'Multi-Branch Deployment' : 'Single Office',
    city ? `City: ${city}` : null,
    country ? `Country: ${country}` : null,
  ].filter(Boolean) as string[];

  const lead: Lead = {
    leadId,
    contactId,
    source: 'WEBSITE',
    leadType: 'INBOUND',
    status: 'DEMO_SCHEDULED',
    leadScore,
    intent: 'HIGH',
    buyingStage: 'CONSIDERATION',
    serviceInterest: product,
    requirements,
    budget: teamSize.includes('20') ? 'Enterprise Quote Required' : 'Standard Tier',
    timeline: 'Immediate / Upcoming Season',
    aiSummary,
    aiRecommendation,
    demoStatus: 'BOOKED',
    demoSource: 'AUTOMATIC',
    demoBookedAt: nowIso,
    country,
    city,
    website,
    branches,
    teamSize,
    productInterest: product,
    queryMessage: message,
    notes: message || `Demo requested on ${sourceUrl}`,
    sourceUrl,
    createdAt: nowIso,
    updatedAt: nowIso,
    lastActivityAt: nowIso,
  };

  // -----------------------------------------------------------------
  // 11. Create Conversation & Inbound Message in Firestore
  // -----------------------------------------------------------------
  const conversationId = `conv-web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const messageId = `msg-web-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;

  const inboundDetailsText = [
    `🕋 INBOUND DEMO REQUEST from umrah360.in/request-demo:`,
    ``,
    `• Name: ${rawFullName} (${designation})`,
    `• Company: ${companyName}${website ? ` (${website})` : ''}`,
    `• Email: ${email}`,
    `• Phone: ${fullPhone || 'Not provided'}`,
    `• Location: ${city ? `${city}, ` : ''}${country}`,
    `• Product Interest: ${product}`,
    `• Team Size: ${teamSize}`,
    `• Multi-Branch: ${branches}`,
    ``,
    `Message / Query:`,
    message || 'Customer submitted the "Schedule my Free Demo" form for an operational walkthrough.',
  ].join('\n');

  const conversation: Conversation = {
    conversationId,
    contactId,
    leadId,
    channel: 'WEBSITE',
    direction: 'INBOUND',
    status: 'ACTIVE',
    aiEnabled: true,
    humanHandoff: false,
    conversationSummary: `Website Demo Request: ${companyName} (${rawFullName})`,
    startedAt: nowIso,
    lastMessageAt: nowIso,
    lastMessageText: inboundDetailsText.slice(0, 180) + '...',
    unreadCount: 1,
    isRead: false,
    unread: true,
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  const initialMessage: Message = {
    messageId,
    conversationId,
    senderType: 'CUSTOMER',
    senderName: rawFullName,
    channel: 'WEBSITE',
    direction: 'INBOUND',
    text: inboundDetailsText,
    timestamp: nowIso,
    sentAt: nowIso,
    receivedAt: nowIso,
  };

  // -----------------------------------------------------------------
  // 12. Persist All Entities Directly to Firestore DB
  // -----------------------------------------------------------------
  if (isFirebaseConfigured && db) {
    try {
      await Promise.all([
        safeSetDoc(doc(db, 'contacts', contact.contactId), contact, { merge: true }),
        safeSetDoc(doc(db, 'leads', lead.leadId), lead, { merge: true }),
        safeSetDoc(doc(db, 'conversations', conversation.conversationId), conversation, { merge: true }),
        safeSetDoc(doc(db, 'messages', initialMessage.messageId), initialMessage, { merge: true }),
      ]);
      console.log(`[Website Lead] Successfully stored Lead "${companyName}" (${leadId}) and Contact (${contactId}) directly into Firestore DB!`);
    } catch (dbErr) {
      console.error('[Website Lead] Error writing to Firestore DB:', dbErr);
    }
  }

  // -----------------------------------------------------------------
  // 13. Dispatch Confirmation Email via SMTP if Configured
  // -----------------------------------------------------------------
  let autoConfirmationSent = false;
  const smtpConfig = getSmtpConfig();
  if (smtpConfig.configured && email) {
    try {
      const emailSubject = `We have received your Umrah360 Demo Request - ${companyName}`;
      const emailBody = [
        `As-salamu alaykum ${firstName},`,
        ``,
        `Thank you for requesting a live demo of Umrah360 for ${companyName}!`,
        ``,
        `We have received your requirements:`,
        `- Product: ${product}`,
        `- Team Size: ${teamSize}`,
        `- Location: ${city ? `${city}, ` : ''}${country}`,
        `- Multi-Branch Setup: ${branches}`,
        ``,
        `One of our senior pilgrimage software specialists will reach out to you shortly at ${fullPhone || email} to coordinate a suitable time for your personalized walkthrough and answer any operational questions you have.`,
        ``,
        `If you need immediate assistance or have specific visa/hotel allotment workflows you would like to test, simply reply to this email.`,
        ``,
        `Warm regards,`,
        `The Umrah360 Team`,
        `https://umrah360.in`,
      ].join('\n');

      const mailResult = await sendLiveEmail({
        to: email,
        subject: emailSubject,
        text: emailBody,
      });

      if (mailResult.success) {
        autoConfirmationSent = true;
        console.log(`[Website Lead] Dispatched auto-confirmation email to ${email}`);

        // Also record this outbound message in Firestore
        const replyMsgId = `msg-auto-reply-${Date.now()}`;
        const autoReplyMessage: Message = {
          messageId: replyMsgId,
          conversationId,
          senderType: 'AI',
          senderName: 'Umrah360 Automation',
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          text: emailBody,
          timestamp: new Date().toISOString(),
          sentAt: new Date().toISOString(),
          aiReplied: true,
        };

        if (isFirebaseConfigured && db) {
          safeSetDoc(doc(db, 'messages', replyMsgId), autoReplyMessage, { merge: true }).catch(() => {});
        }
      }
    } catch (smtpErr) {
      console.warn('[Website Lead] Notice sending auto-confirmation email:', smtpErr);
    }
  }

  return {
    success: true,
    message: `Lead for ${companyName} (${rawFullName}) successfully pushed to CRM!`,
    contact,
    lead,
    conversation,
    initialMessage,
    autoConfirmationSent,
  };
}
