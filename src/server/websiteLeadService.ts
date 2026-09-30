import { collection, doc, getDoc, getDocs, limit, query, where } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';
import { Contact, Lead, Conversation, Message } from '../types/index.js';
import { sendLiveEmail, getSmtpConfig, fetchFirestoreSmtpConfig } from './smtpService.js';
import { handleIncomingCampaignLeadReply } from './campaignService.js';

// In-memory cache + in-flight locks to guarantee strict single thank-you email delivery
const sentThankYouEmailsCache = new Set<string>();
const inFlightThankYouSends = new Set<string>();

/**
 * Checks whether a given lead email has already received a Thank You / Demo Walkthrough email.
 * Checks in-memory cache, the website_lead_thankyou_history collection, and conversations.
 */
export async function hasThankYouEmailBeenSent(rawEmail: string): Promise<boolean> {
  const clean = rawEmail?.trim().toLowerCase() || '';
  if (!clean || !clean.includes('@') || clean.endsWith('@umrah360.in')) return true;

  if (sentThankYouEmailsCache.has(clean)) {
    return true;
  }

  if (!isFirebaseConfigured || !db) return false;

  try {
    // 1. Check dedicated website_lead_thankyou_history document
    const emailKey = clean.replace(/[^a-z0-9_.-]/g, '_');
    const historyRef = doc(db, 'website_lead_thankyou_history', emailKey);
    const historySnap = await getDoc(historyRef);
    if (historySnap.exists()) {
      sentThankYouEmailsCache.add(clean);
      return true;
    }

    // 2. Check if any conversation with this email already has thankYouEmailSent == true
    const convQ = query(
      collection(db, 'conversations'),
      where('customerEmail', '==', clean),
      where('thankYouEmailSent', '==', true),
      limit(1)
    );
    const convSnap = await getDocs(convQ);
    if (!convSnap.empty) {
      sentThankYouEmailsCache.add(clean);
      return true;
    }

    // 3. Check if any contact with this email has thankYouEmailSent == true
    const contactQ = query(
      collection(db, 'contacts'),
      where('email', '==', clean),
      limit(1)
    );
    const contactSnap = await getDocs(contactQ);
    if (!contactSnap.empty) {
      const cData = contactSnap.docs[0].data() as any;
      if (cData.thankYouEmailSent) {
        sentThankYouEmailsCache.add(clean);
        return true;
      }
    }
  } catch (e) {
    console.warn('[Website Lead] Notice checking thank you history in Firestore:', e);
  }

  return false;
}

/**
 * Records that a thank you email was dispatched to a specific recipient address
 * in both memory and the persistent Firestore collection.
 */
export async function recordThankYouEmailSent(
  rawEmail: string,
  meta: { leadId?: string; conversationId?: string; smtpMessageId?: string }
): Promise<void> {
  const clean = rawEmail?.trim().toLowerCase() || '';
  if (!clean) return;
  sentThankYouEmailsCache.add(clean);

  if (!isFirebaseConfigured || !db) return;

  try {
    const emailKey = clean.replace(/[^a-z0-9_.-]/g, '_');
    const nowIso = new Date().toISOString();
    await safeSetDoc(
      doc(db, 'website_lead_thankyou_history', emailKey),
      {
        email: clean,
        leadId: meta.leadId || '',
        conversationId: meta.conversationId || '',
        sentAt: nowIso,
        smtpMessageId: meta.smtpMessageId || 'verified',
        status: 'DELIVERED',
      },
      { merge: true }
    );
  } catch (e) {
    console.warn('[Website Lead] Notice recording thank you history:', e);
  }
}

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
  duplicateThankYouSuppressed?: boolean;
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

    const lowerK = rawK.toLowerCase().trim();

    // Prevent Elementor/WordPress form metadata objects from polluting root keys like "name" or "id"
    if (lowerK === 'form' && typeof rawV === 'object' && rawV !== null) {
      if ((rawV as any).id) target['form_id'] = String((rawV as any).id).trim();
      if ((rawV as any).name) target['form_name'] = String((rawV as any).name).trim();
      continue;
    }
    if ((lowerK === 'post' || lowerK === 'page') && typeof rawV === 'object' && rawV !== null) {
      if ((rawV as any).id) target[`${lowerK}_id`] = String((rawV as any).id).trim();
      if ((rawV as any).title) target[`${lowerK}_title`] = String((rawV as any).title).trim();
      continue;
    }

    if (typeof rawV === 'string' || typeof rawV === 'number' || typeof rawV === 'boolean') {
      const strVal = String(rawV).trim();

      // If key is form_name or form-name, store under form_name, NOT name
      if (lowerK === 'form_name' || lowerK === 'form-name' || lowerK === 'formname' || lowerK === 'form_title') {
        target['form_name'] = strVal;
        continue;
      }

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
        if ((rawV as any).name && String((rawV as any).name).toLowerCase() !== 'form') {
          target[String((rawV as any).name)] = String(nestedVal).trim();
        }
        if ((rawV as any).label) target[String((rawV as any).label)] = String(nestedVal).trim();
      }
      flattenAllFields(rawV, target);
    }
  }

  return target;
}

// Detects whether a string is a product name, form title, or software feature rather than an actual human name
function isInvalidHumanName(val: string): boolean {
  if (!val || typeof val !== 'string') return true;
  const s = val.trim();
  if (s.length < 2) return true;
  const productOrFormKeywords = [
    'crm',
    'booking',
    'management',
    'group series',
    'erp',
    'portal',
    'software',
    'package',
    'solution',
    'license',
    'b2b',
    'allotment',
    'request demo',
    'demo request',
    'demo form',
    'inquiry form',
    'contact form',
    'series',
    'pilgrim',
    'agency leader',
    'tour operator',
    'partner',
    'system',
    'platform',
    'app',
    'application',
  ];
  const lower = s.toLowerCase();
  for (const kw of productOrFormKeywords) {
    if (lower.includes(kw)) return true;
  }
  return false;
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
    /^yourname$/,
    /^clientname$/,
    /^contactname$/,
    /^leadname$/,
    /^username$/,
    /^author$/,
  ]).trim();

  // If candidate is a product or form name, reject it and preserve it as detected product
  let detectedProductFromField = '';
  if (rawFullName && isInvalidHumanName(rawFullName)) {
    detectedProductFromField = rawFullName;
    rawFullName = '';
  }

  let firstNamePart = findValue([/^firstname$/, /^fname$/, /^first$/]).trim();
  let lastNamePart = findValue([/^lastname$/, /^lname$/, /^last$/]).trim();

  if (!rawFullName && (firstNamePart || lastNamePart)) {
    const combinedParts = `${firstNamePart} ${lastNamePart}`.trim();
    if (!isInvalidHumanName(combinedParts)) {
      rawFullName = combinedParts;
    }
  }

  // Next try standard name key if not yet resolved
  if (!rawFullName) {
    const candidateName = findValue([/^name$/]).trim();
    if (candidateName && !isInvalidHumanName(candidateName)) {
      rawFullName = candidateName;
    } else if (candidateName && isInvalidHumanName(candidateName) && !detectedProductFromField) {
      detectedProductFromField = candidateName;
    }
  }

  // If still not resolved or invalid, scan all flatFields entries for a genuine person name (e.g. wasim saikh)
  if (!rawFullName || isInvalidHumanName(rawFullName)) {
    for (const [k, v] of Object.entries(flatFields)) {
      if (!v) continue;
      const cleanK = k.toLowerCase().replace(/[-_\[\]\.\s]/g, '');
      if (
        /email|mail|phone|mobile|tel|city|country|state|zip|product|service|company|agency|message|query|remark|note|size|team|branch|form|post|page|nonce|token|url|ref|recaptcha/i.test(
          cleanK
        )
      ) {
        continue;
      }
      const trimmedV = v.trim();
      // Check if value matches genuine human name characteristics (2-40 chars, alpha, no digits, no @, not product)
      if (
        trimmedV.length >= 2 &&
        trimmedV.length <= 40 &&
        !trimmedV.includes('@') &&
        !/\d/.test(trimmedV) &&
        /^[a-zA-Z\s.'-]+$/.test(trimmedV) &&
        !isInvalidHumanName(trimmedV)
      ) {
        rawFullName = trimmedV;
        break;
      }
    }
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
  let product = (
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

  if (product === 'Umrah360 ERP & B2B Sub-Agent Portal' || !product) {
    if (detectedProductFromField) {
      product = detectedProductFromField;
    } else if (flatFields['form_name']) {
      product = flatFields['form_name'];
    }
  }

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

  // If this website lead is part of an outbound campaign, mark them as REPLIED & DEMO_BOOKED
  try {
    await handleIncomingCampaignLeadReply({
      fromEmail: email,
      fromPhone: fullPhone,
      subject: `Website Demo Request: ${companyName}`,
      body: message || 'Submitted website demo request form',
    });
  } catch (campErr) {
    console.warn('[Website Lead] Campaign lead reply hook notice:', campErr);
  }

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

  const cleanEmail = email ? email.trim().toLowerCase() : '';

  // -----------------------------------------------------------------
  // 11. Deduplication Gate: Check if this email already received a Thank You email
  // -----------------------------------------------------------------
  let alreadySent = false;
  let isInFlight = false;
  if (cleanEmail && cleanEmail.includes('@')) {
    alreadySent = await hasThankYouEmailBeenSent(cleanEmail);
    isInFlight = inFlightThankYouSends.has(cleanEmail);
  }

  const shouldSendThankYou = Boolean(
    cleanEmail &&
    cleanEmail.includes('@') &&
    !cleanEmail.endsWith('@umrah360.in') &&
    !alreadySent &&
    !isInFlight
  );

  let duplicateThankYouSuppressed = alreadySent || isInFlight;
  if (duplicateThankYouSuppressed) {
    console.log(
      `[Website Lead Idempotency] Thank you email already previously sent or in-flight for "${cleanEmail}". Strictly sending ONCE; suppressing duplicate email dispatch.`
    );
  }

  const conversation: Conversation = {
    conversationId,
    contactId,
    leadId,
    channel: 'WEBSITE',
    direction: 'INBOUND',
    status: 'ACTIVE',
    aiEnabled: false, // Explicitly false for website leads so generic AI never sends duplicate emails
    humanHandoff: false,
    conversationSummary: `Website Demo Request: ${companyName} (${rawFullName})`,
    subject: `Website Demo Request: ${companyName} (${product})`,
    customerEmail: cleanEmail,
    thankYouEmailSent: true, // Always marked true so background pollers NEVER duplicate this dispatch
    thankYouSmtpMessageId: alreadySent ? 'ALREADY_SENT_PREVIOUSLY' : undefined,
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
    senderEmail: cleanEmail,
    recipientEmail: 'sales@umrah360.in',
    channel: 'WEBSITE',
    direction: 'INBOUND',
    text: inboundDetailsText,
    timestamp: nowIso,
    sentAt: nowIso,
    receivedAt: nowIso,
    aiReplied: true, // Marked true so generic inbox auto-replier NEVER attempts an AI response
  };

  // -----------------------------------------------------------------
  // 12. Dispatch Confirmation Email via SMTP (Strictly ONCE per lead)
  // -----------------------------------------------------------------
  let autoConfirmationSent = false;
  let autoReplyMessage: Message | null = null;

  if (shouldSendThankYou) {
    inFlightThankYouSends.add(cleanEmail);
    try {
      await fetchFirestoreSmtpConfig();
      const smtpConfig = getSmtpConfig();

      if (smtpConfig.configured) {
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
          `One of our senior pilgrimage software specialists will reach out to you shortly at ${fullPhone || cleanEmail} to coordinate a suitable time for your personalized walkthrough and answer any operational questions you have.`,
          ``,
          `If you need immediate assistance or have specific visa/hotel allotment workflows you would like to test, simply reply to this email.`,
          ``,
          `Warm regards,`,
          `The Umrah360 Team`,
          `https://umrah360.in`,
        ].join('\n');

        console.log(`[Website Lead] Dispatching single Thank You email to ${cleanEmail} for ${companyName}...`);
        const mailResult = await sendLiveEmail({
          to: cleanEmail,
          subject: emailSubject,
          text: emailBody,
          headers: {
            'X-Conversation-Id': conversationId,
            'X-Lead-Id': leadId,
            'X-Contact-Id': contactId,
          },
        });

        if (mailResult.success) {
          autoConfirmationSent = true;
          const sentIso = new Date().toISOString();
          console.log(`[Website Lead Success] ✓ Live Thank You email delivered to ${cleanEmail} (ID: ${mailResult.messageId})!`);

          // Update conversation object
          conversation.thankYouEmailSent = true;
          conversation.thankYouEmailDeliveredAt = sentIso;
          conversation.thankYouSmtpMessageId = mailResult.messageId;

          // Record auto-confirmation outbound message
          const replyMsgId = `msg-thankyou-${conversationId}`;
          autoReplyMessage = {
            messageId: replyMsgId,
            conversationId,
            senderType: 'AI',
            senderName: 'Umrah360 Automation',
            senderEmail: smtpConfig.user || 'amaavigo@gmail.com',
            recipientEmail: cleanEmail,
            channel: 'EMAIL',
            direction: 'OUTBOUND',
            text: emailBody,
            timestamp: sentIso,
            sentAt: sentIso,
            receivedAt: sentIso,
            createdAt: sentIso,
            deliveryStatus: 'DELIVERED',
            smtpMessageId: mailResult.messageId,
            emailDeliveredAt: sentIso,
            aiReplied: true,
          };

          // Record in persistent history ledger so it can NEVER be sent again to this address
          await recordThankYouEmailSent(cleanEmail, {
            leadId,
            conversationId,
            smtpMessageId: mailResult.messageId,
          });
        } else {
          console.warn(`[Website Lead Warning] SMTP delivery attempt to ${cleanEmail} failed:`, mailResult.error);
        }
      } else {
        console.warn(`[Website Lead Notice] SMTP credentials not configured yet; skipping live email dispatch.`);
      }
    } catch (smtpErr) {
      console.warn('[Website Lead] Notice sending auto-confirmation email:', smtpErr);
    } finally {
      inFlightThankYouSends.delete(cleanEmail);
    }
  }

  // -----------------------------------------------------------------
  // 13. Persist All Entities Directly to Firestore DB
  // -----------------------------------------------------------------
  if (isFirebaseConfigured && db) {
    try {
      const writes: Promise<any>[] = [
        safeSetDoc(doc(db, 'contacts', contact.contactId), contact, { merge: true }),
        safeSetDoc(doc(db, 'leads', lead.leadId), lead, { merge: true }),
        safeSetDoc(doc(db, 'conversations', conversation.conversationId), conversation, { merge: true }),
        safeSetDoc(doc(db, 'messages', initialMessage.messageId), initialMessage, { merge: true }),
      ];

      if (autoReplyMessage) {
        writes.push(safeSetDoc(doc(db, 'messages', autoReplyMessage.messageId), autoReplyMessage, { merge: true }));
      }

      await Promise.all(writes);
      console.log(`[Website Lead] Successfully stored Lead "${companyName}" (${leadId}) directly into Firestore DB!`);
    } catch (dbErr) {
      console.error('[Website Lead] Error writing to Firestore DB:', dbErr);
    }
  }

  return {
    success: true,
    message: duplicateThankYouSuppressed
      ? `Lead for ${companyName} (${rawFullName}) saved in CRM. Thank-you email was already sent previously to ${cleanEmail} and preserved without duplicates.`
      : `Lead for ${companyName} (${rawFullName}) successfully pushed to CRM and thank-you confirmation delivered!`,
    contact,
    lead,
    conversation,
    initialMessage,
    autoConfirmationSent,
    duplicateThankYouSuppressed,
  };
}
