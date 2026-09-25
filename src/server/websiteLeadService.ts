import { collection, doc, getDocs, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';
import { Contact, Lead, Conversation, Message } from '../types/index.js';
import { sendLiveEmail, getSmtpConfig, fetchFirestoreSmtpConfig } from './smtpService.js';

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

// Recursively flattens nested Elementor Pro form objects, arrays, and bracket keys
function flattenAllFields(obj: any, target: Record<string, string> = {}): Record<string, string> {
  if (!obj || typeof obj !== 'object') return target;

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (item && typeof item === 'object') {
        const itemKey = item.id || item.name || item.field_id || item.key || item.label || `item_${i}`;
        const itemVal = item.value ?? item.val ?? item.raw_value ?? item.text ?? '';
        if (typeof itemVal === 'string' || typeof itemVal === 'number' || typeof itemVal === 'boolean') {
          target[String(itemKey)] = String(itemVal).trim();
        }
        flattenAllFields(item, target);
      } else if (typeof item === 'string' || typeof item === 'number') {
        target[`item_${i}`] = String(item).trim();
      }
    }
    return target;
  }

  for (const [rawK, rawV] of Object.entries(obj)) {
    if (rawV === null || rawV === undefined) continue;

    if (typeof rawV === 'string' || typeof rawV === 'number' || typeof rawV === 'boolean') {
      const strVal = String(rawV).trim();
      target[rawK] = strVal;

      // Extract bracket key e.g. "form_fields[name]" -> also set "name"
      const bracketMatch = rawK.match(/(?:form_fields|fields|entry|wpforms)\[([^\]]+)\]/i);
      if (bracketMatch && bracketMatch[1]) {
        target[bracketMatch[1]] = strVal;
      }
    } else if (typeof rawV === 'object') {
      const nestedVal = (rawV as any).value ?? (rawV as any).val ?? (rawV as any).raw_value ?? (rawV as any).text;
      if (typeof nestedVal === 'string' || typeof nestedVal === 'number' || typeof nestedVal === 'boolean') {
        target[rawK] = String(nestedVal).trim();
        if ((rawV as any).id) target[String((rawV as any).id)] = String(nestedVal).trim();
        if ((rawV as any).name) target[String((rawV as any).name)] = String(nestedVal).trim();
        if ((rawV as any).label) target[String((rawV as any).label)] = String(nestedVal).trim();
      }
      flattenAllFields(rawV, target);
    }
  }

  return target;
}

/**
 * Normalizes input from web forms, WordPress, Elementor, CF7, Webflow, or custom HTML forms.
 */
export async function processWebsiteLeadSubmission(
  rawInput: any
): Promise<ProcessedLeadResult> {
  const flatFields = flattenAllFields(rawInput || {});

  const findValue = (patterns: RegExp[]): string => {
    for (const pat of patterns) {
      for (const [k, v] of Object.entries(flatFields)) {
        if (!v) continue;
        const cleanK = k.toLowerCase().replace(/[-_\[\]\.\s]/g, '');
        if (pat.test(cleanK)) return v;
      }
    }
    return '';
  };

  // 1. Resolve & Validate Email
  let email = findValue([
    /^email$/,
    /^youremail$/,
    /^useremail$/,
    /^contactemail$/,
    /^workemail$/,
    /^emailaddress$/,
    /^mail$/,
    /email/,
    /mail/,
  ]).trim().toLowerCase();

  // Scan all values for an email regex if not found by key
  if (!email || !email.includes('@')) {
    const emailRegex = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
    for (const [, v] of Object.entries(flatFields)) {
      const match = v.match(emailRegex);
      if (match && match[0]) {
        email = match[0].trim().toLowerCase();
        break;
      }
    }
  }

  // 2. Resolve Full Name
  let rawFullName = findValue([
    /^fullname$/,
    /^yourfullname$/,
    /^name$/,
    /^yourname$/,
    /^contactname$/,
    /^leadname$/,
    /^clientname$/,
    /^username$/,
    /^author$/,
  ]).trim();

  let firstNamePart = findValue([/^firstname$/, /^fname$/, /^first$/]).trim();
  let lastNamePart = findValue([/^lastname$/, /^lname$/, /^last$/]).trim();

  if (!rawFullName && (firstNamePart || lastNamePart)) {
    rawFullName = `${firstNamePart} ${lastNamePart}`.trim();
  }

  if (!rawFullName && email) {
    const userPart = email.split('@')[0] || '';
    const cleanUserPart = userPart.replace(/[._\-0-9]/g, ' ').trim();
    if (cleanUserPart.length > 2) {
      rawFullName = cleanUserPart
        .split(' ')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' ');
    }
  }

  rawFullName = rawFullName || 'Inbound Website Lead';

  let firstName = firstNamePart;
  let lastName = lastNamePart;
  if (!firstName) {
    const parts = rawFullName.split(/\s+/);
    firstName = parts[0] || 'Partner';
    lastName = parts.slice(1).join(' ') || '';
  }

  // 3. Resolve Phone
  let rawPhone = findValue([
    /^phone$/,
    /^phonenumber$/,
    /^yourphone$/,
    /^mobile$/,
    /^mobilenumber$/,
    /^contactnumber$/,
    /^tel$/,
    /^telephone$/,
    /^whatsapp$/,
    /phone/,
    /mobile/,
    /whatsapp/,
  ]).trim();

  if (!rawPhone) {
    for (const [k, v] of Object.entries(flatFields)) {
      if (/id|date|time|nonce|token|zip|postal|lead/i.test(k)) continue;
      const cleanDigits = v.replace(/[\s\-\(\)\.]/g, '');
      if (/^\+?[0-9]{7,16}$/.test(cleanDigits) && !v.includes('@')) {
        rawPhone = v.trim();
        break;
      }
    }
  }

  const rawCountryCode = findValue([/^countrycode$/, /^code$/]).trim();
  let fullPhone = rawPhone;
  if (fullPhone && rawCountryCode && !fullPhone.startsWith('+')) {
    const cleanCode = rawCountryCode.startsWith('+') ? rawCountryCode : `+${rawCountryCode}`;
    fullPhone = `${cleanCode} ${fullPhone}`.trim();
  }

  // 4. Resolve Designation & Location
  const designation = (
    findValue([/^designation$/, /^jobtitle$/, /^job$/, /^role$/, /^position$/, /^title$/]) ||
    'Tour Operator / Agency Leader'
  ).trim();

  const country = (
    findValue([/^country$/, /^selectcountry$/, /^yourcountry$/, /^nation$/, /country/]) ||
    'India'
  ).trim();

  const city = findValue([/^city$/, /^yourcity$/, /^town$/, /city/]).trim();

  // 5. Resolve Company Info
  let companyName = findValue([
    /^companyname$/,
    /^company$/,
    /^agencyname$/,
    /^agency$/,
    /^organization$/,
    /^businessname$/,
    /^firm$/,
    /^operator$/,
    /^touroperator$/,
    /company/,
    /agency/,
  ]).trim();

  if (!companyName) {
    if (email) {
      const domainPart = email.split('@')[1] || '';
      if (domainPart && !['gmail.com', 'yahoo.com', 'outlook.com', 'hotmail.com', 'icloud.com'].includes(domainPart)) {
        const derived = domainPart.split('.')[0];
        companyName = derived.charAt(0).toUpperCase() + derived.slice(1) + ' Travels';
      }
    }
    if (!companyName) {
      companyName = `${firstName}'s Pilgrimage Agency`;
    }
  }

  const website = findValue([/^website$/, /^companywebsite$/, /^url$/, /^companyurl$/]).trim();

  const rawBranchesVal = findValue([/^branches$/, /^hasbranches$/, /^hasbranch$/, /^branch$/, /branch/]).trim();
  const branches =
    typeof rawBranchesVal === 'string' && /yes|true|multiple|branch/i.test(rawBranchesVal)
      ? 'Yes'
      : rawBranchesVal && /no|false|single/i.test(rawBranchesVal)
      ? 'No'
      : 'No';

  // 6. Resolve Product & Team Size
  const product = (
    findValue([
      /^product$/,
      /^products$/,
      /^selectproducts$/,
      /^productinterest$/,
      /^serviceinterest$/,
      /^solution$/,
      /^interest$/,
      /product/,
    ]) || 'Umrah360 ERP & B2B Sub-Agent Portal'
  ).trim();

  const teamSize = (
    findValue([/^teamsize$/, /^team$/, /^size$/, /^employees$/, /^users$/, /^capacity$/]) ||
    '5-10 Users'
  ).trim();

  // 7. Resolve Message / Query
  const message = findValue([
    /^message$/,
    /^yourmessage$/,
    /^query$/,
    /^notes$/,
    /^comments$/,
    /^remark$/,
    /^remarks$/,
    /^requirement$/,
    /^requirements$/,
    /^inquiry$/,
    /^description$/,
    /^details$/,
    /message/,
    /query/,
    /remark/,
    /comment/,
  ]).trim();

  const sourceUrl = findValue([/^sourceurl$/, /^source$/, /^referrer$/]) || 'https://umrah360.in/request-demo';

  // Unmapped fields
  const unmapped: string[] = [];
  const mappedValues = new Set([
    email,
    rawPhone,
    fullPhone,
    rawFullName,
    firstNamePart,
    lastNamePart,
    companyName,
    designation,
    city,
    country,
    product,
    teamSize,
    branches,
    message,
    website,
    sourceUrl,
  ]);

  for (const [k, v] of Object.entries(flatFields)) {
    if (!v) continue;
    if (mappedValues.has(v)) continue;
    const lowerK = k.toLowerCase().replace(/[-_\[\]\.\s]/g, '');
    if (/^(id|type|rawvalue|fieldid|fieldtype|key|label|formid|formname|action|submit|nonce|wpnonce|wphttpreferer|recaptcha|token|postid|referertitle)$/i.test(lowerK)) continue;
    if (k.length > 50 || v.length > 500) continue;
    unmapped.push(`• ${k}: ${v}`);
  }

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

  const inboundLines = [
    `🕋 INBOUND DEMO REQUEST from umrah360.in/request-demo:`,
    ``,
    `• Name: ${rawFullName} (${designation})`,
    `• Company: ${companyName}${website ? ` (${website})` : ''}`,
    `• Email: ${email || 'Not provided'}`,
    `• Phone: ${fullPhone || 'Not provided'}`,
    `• Location: ${city ? `${city}, ` : ''}${country}`,
    `• Product Interest: ${product}`,
    `• Team Size: ${teamSize}`,
    `• Multi-Branch: ${branches}`,
    ``,
    `Message / Query:`,
    message || 'Customer submitted the "Schedule my Free Demo" form for an operational walkthrough.',
  ];

  if (unmapped.length > 0) {
    inboundLines.push(``, `Additional Form Submission Data:`, ...unmapped);
  }

  const inboundDetailsText = inboundLines.join('\n');

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
  await fetchFirestoreSmtpConfig();
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
        const nowIso = new Date().toISOString();
        console.log(`[Website Lead] Dispatched auto-confirmation email to ${email} (Message ID: ${mailResult.messageId})`);

        // Also record this outbound message in Firestore
        const replyMsgId = `msg-thankyou-${conversationId}`;
        const autoReplyMessage: Message = {
          messageId: replyMsgId,
          conversationId,
          senderType: 'AI',
          senderName: 'Umrah360 Automation',
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          recipientEmail: email,
          deliveryStatus: 'DELIVERED',
          smtpMessageId: mailResult.messageId,
          emailDeliveredAt: nowIso,
          text: emailBody,
          timestamp: nowIso,
          sentAt: nowIso,
          aiReplied: true,
        };

        if (isFirebaseConfigured && db) {
          safeSetDoc(doc(db, 'messages', replyMsgId), autoReplyMessage, { merge: true }).catch(() => {});
          safeSetDoc(
            doc(db, 'conversations', conversationId),
            {
              thankYouEmailSent: true,
              thankYouEmailDeliveredAt: nowIso,
              thankYouSmtpMessageId: mailResult.messageId,
              customerEmail: email,
              lastMessageText: emailBody.slice(0, 160) + '...',
              lastMessageAt: nowIso,
              updatedAt: nowIso,
            },
            { merge: true }
          ).catch(() => {});
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
