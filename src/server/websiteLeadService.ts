import { getDoc, getDocs, limit, query, where } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import { Contact, Lead, Conversation, Message } from '../types/index.js';
import { sendLiveEmail, getSmtpConfig, fetchFirestoreSmtpConfig } from './smtpService.js';
import { handleIncomingCampaignLeadReply } from './campaignService.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';
import { getTenantBrand } from './brandService.js';
import { brandFallbackAgency, brandDemoThankYouSubject, brandSpecialistLine, brandThankYouSignoff, brandDefaultSourceUrl, brandInboundHeading } from '../shared/brand.js';

const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

// In-memory cache + in-flight locks keyed by tenant to guarantee strict single thank-you email delivery
const tenantSentThankYouCaches = new Map<string, Set<string>>();
const tenantInFlightThankYouSends = new Map<string, Set<string>>();

function getSentCache(tenantId: string): Set<string> {
  let cache = tenantSentThankYouCaches.get(tenantId);
  if (!cache) {
    cache = new Set<string>();
    tenantSentThankYouCaches.set(tenantId, cache);
  }
  return cache;
}

function getInFlightSet(tenantId: string): Set<string> {
  let set = tenantInFlightThankYouSends.get(tenantId);
  if (!set) {
    set = new Set<string>();
    tenantInFlightThankYouSends.set(tenantId, set);
  }
  return set;
}

/**
 * Checks whether a given lead email has already received a Thank You / Demo Walkthrough email.
 * Checks in-memory cache, the website_lead_thankyou_history collection, and conversations.
 */
export async function hasThankYouEmailBeenSent(
  rawEmail: string,
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<boolean> {
  const clean = rawEmail?.trim().toLowerCase() || '';
  if (!clean || !clean.includes('@') || clean.endsWith('@umrah360.in')) return true;

  const sentCache = getSentCache(ctx.tenantId);
  if (sentCache.has(clean)) {
    return true;
  }

  if (!isFirebaseConfigured || !db) return false;

  try {
    const repo = tenantRepo(ctx);
    // 1. Check dedicated website_lead_thankyou_history document
    const emailKey = clean.replace(/[^a-z0-9_.-]/g, '_');
    const historyRef = repo.websiteLeadThankYouHistoryDoc(emailKey);
    const historySnap = await getDoc(historyRef);
    if (historySnap.exists()) {
      sentCache.add(clean);
      return true;
    }

    // 2. Check if any conversation with this email already has thankYouEmailSent == true
    const convQ = query(
      repo.conversations(),
      where('customerEmail', '==', clean),
      where('thankYouEmailSent', '==', true),
      limit(1)
    );
    const convSnap = await getDocs(convQ);
    if (!convSnap.empty) {
      sentCache.add(clean);
      return true;
    }

    // 3. Check if any contact with this email has thankYouEmailSent == true
    const contactQ = query(
      repo.contacts(),
      where('email', '==', clean),
      limit(1)
    );
    const contactSnap = await getDocs(contactQ);
    if (!contactSnap.empty) {
      const cData = contactSnap.docs[0].data() as any;
      if (cData.thankYouEmailSent) {
        sentCache.add(clean);
        return true;
      }
    }
  } catch (e) {
    console.warn(`[Website Lead] Notice checking thank you history for tenant ${ctx.tenantId}:`, e);
  }

  return false;
}

/**
 * Records that a thank you email was dispatched to a specific recipient address
 * in both memory and the persistent Firestore collection.
 */
export async function recordThankYouEmailSent(
  rawEmail: string,
  meta: { leadId?: string; conversationId?: string; smtpMessageId?: string },
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<void> {
  const clean = rawEmail?.trim().toLowerCase() || '';
  if (!clean) return;
  const sentCache = getSentCache(ctx.tenantId);
  sentCache.add(clean);

  if (!isFirebaseConfigured || !db) return;

  try {
    const repo = tenantRepo(ctx);
    const emailKey = clean.replace(/[^a-z0-9_.-]/g, '_');
    const nowIso = new Date().toISOString();
    await safeSetDoc(
      repo.websiteLeadThankYouHistoryDoc(emailKey),
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
    console.warn(`[Website Lead] Notice recording thank you history for ${ctx.tenantId}:`, e);
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

  const setOrAppend = (k: string, v: any) => {
    if (v === null || v === undefined) return;
    const cleanK = String(k).trim();
    const cleanV = String(v).trim();
    if (!cleanK || !cleanV) return;

    if (target[cleanK]) {
      const existing = target[cleanK];
      if (!existing.toLowerCase().includes(cleanV.toLowerCase())) {
        target[cleanK] = `${existing}, ${cleanV}`;
      }
    } else {
      target[cleanK] = cleanV;
    }
  };

  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const item = obj[i];
      if (item && typeof item === 'object') {
        const itemKey = item.id || item.name || item.field_id || item.key || item.label || `item_${i}`;
        const itemVal = item.value ?? item.val ?? item.raw_value ?? item.text ?? '';
        if (typeof itemVal === 'string' || typeof itemVal === 'number' || typeof itemVal === 'boolean') {
          setOrAppend(String(itemKey), itemVal);
        } else if (Array.isArray(itemVal)) {
          for (const subVal of itemVal) {
            setOrAppend(String(itemKey), subVal);
          }
        }
        flattenAllFields(item, target);
      } else if (typeof item === 'string' || typeof item === 'number') {
        setOrAppend(`item_${i}`, item);
      }
    }
    return target;
  }

  for (const [rawK, rawV] of Object.entries(obj)) {
    if (rawV === null || rawV === undefined) continue;

    const lowerK = rawK.toLowerCase().trim();

    // Prevent Elementor/WordPress form metadata objects from polluting root keys like "name" or "id"
    if (lowerK === 'form' && typeof rawV === 'object' && rawV !== null) {
      if ((rawV as any).id) setOrAppend('form_id', (rawV as any).id);
      if ((rawV as any).name) setOrAppend('form_name', (rawV as any).name);
      continue;
    }
    if ((lowerK === 'post' || lowerK === 'page') && typeof rawV === 'object' && rawV !== null) {
      if ((rawV as any).id) setOrAppend(`${lowerK}_id`, (rawV as any).id);
      if ((rawV as any).title) setOrAppend(`${lowerK}_title`, (rawV as any).title);
      continue;
    }

    if (Array.isArray(rawV)) {
      for (const arrItem of rawV) {
        if (typeof arrItem === 'string' || typeof arrItem === 'number' || typeof arrItem === 'boolean') {
          setOrAppend(rawK, arrItem);
        } else if (arrItem && typeof arrItem === 'object') {
          const itemVal = arrItem.value ?? arrItem.val ?? arrItem.raw_value ?? arrItem.text;
          if (itemVal) setOrAppend(rawK, itemVal);
          flattenAllFields(arrItem, target);
        }
      }
    } else if (typeof rawV === 'string' || typeof rawV === 'number' || typeof rawV === 'boolean') {
      const strVal = String(rawV).trim();

      // If key is form_name or form-name, store under form_name, NOT name
      if (lowerK === 'form_name' || lowerK === 'form-name' || lowerK === 'formname' || lowerK === 'form_title') {
        setOrAppend('form_name', strVal);
        continue;
      }

      setOrAppend(rawK, strVal);

      // Extract bracket key e.g. "form_fields[name]" -> also set "name"
      const bracketMatch = rawK.match(/(?:form_fields|fields|entry|wpforms)\[([^\]]+)\]/i);
      if (bracketMatch && bracketMatch[1]) {
        setOrAppend(bracketMatch[1], strVal);
      }
    } else if (typeof rawV === 'object') {
      const nestedVal = (rawV as any).value ?? (rawV as any).val ?? (rawV as any).raw_value ?? (rawV as any).text;
      if (typeof nestedVal === 'string' || typeof nestedVal === 'number' || typeof nestedVal === 'boolean') {
        setOrAppend(rawK, nestedVal);
        if ((rawV as any).id) setOrAppend(String((rawV as any).id), nestedVal);
        const innerName = String((rawV as any).name || '').trim();
        if (innerName && innerName.toLowerCase() !== 'form' && innerName.length > 2) {
          setOrAppend(innerName, nestedVal);
        }
        if ((rawV as any).label) setOrAppend(String((rawV as any).label), nestedVal);
      }
      flattenAllFields(rawV, target);
    }
  }

  return target;
}

// Detects whether a string is a product name, designation, form title, or software feature rather than an actual human name
function isInvalidHumanName(val: string): boolean {
  if (!val || typeof val !== 'string') return true;
  const s = val.trim();
  if (s.length < 2) return true;

  // Single-word 2-letter designations or role titles that are NOT human names
  const designationsAndTitles = new Set([
    'vp', 'ceo', 'cto', 'cfo', 'coo', 'md', 'gm', 'hr', 'it', 'pr',
    'director', 'manager', 'founder', 'owner', 'partner', 'head', 'executive',
    'president', 'proprietor', 'admin', 'lead', 'officer', 'chief', 'agent'
  ]);

  const lower = s.toLowerCase();
  if (designationsAndTitles.has(lower)) return true;

  const productOrFormKeywords = [
    'crm', 'booking', 'management', 'group series', 'erp', 'portal', 'software',
    'package', 'solution', 'license', 'b2b', 'allotment', 'request demo',
    'demo request', 'demo form', 'inquiry form', 'contact form', 'series',
    'pilgrim', 'agency leader', 'tour operator', 'partner', 'system', 'platform',
    'app', 'application', 'vice president', 'head of sales', 'decision maker'
  ];

  for (const kw of productOrFormKeywords) {
    if (lower.includes(kw)) return true;
  }
  return false;
}

/**
 * Normalizes input from web forms, WordPress, Elementor, CF7, Webflow, or custom HTML forms.
 */
export async function processWebsiteLeadSubmission(
  rawInput: any,
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<ProcessedLeadResult> {
  const brand = await getTenantBrand(ctx.tenantId);
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
    /^your_full_name$/,
    /^yourname$/,
    /^your_name$/,
    /^clientname$/,
    /^contactname$/,
    /^leadname$/,
    /^username$/,
    /^personname$/,
    /^applicantname$/,
  ]).trim();

  // If candidate is a product, designation or form title, reject it
  let detectedProductFromField = '';
  if (rawFullName && isInvalidHumanName(rawFullName)) {
    if (isInvalidHumanName(rawFullName)) {
      detectedProductFromField = rawFullName;
    }
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
    const candidateName = findValue([/^name$/, /^full_name$/]).trim();
    if (candidateName && !isInvalidHumanName(candidateName)) {
      rawFullName = candidateName;
    } else if (candidateName && isInvalidHumanName(candidateName) && !detectedProductFromField) {
      detectedProductFromField = candidateName;
    }
  }

  // Fallback scan across flatFields for genuine person name, skipping keys that are designations or metadata
  if (!rawFullName || isInvalidHumanName(rawFullName)) {
    for (const [k, v] of Object.entries(flatFields)) {
      if (!v) continue;
      const cleanK = k.toLowerCase().replace(/[-_\[\]\.\s]/g, '');
      if (
        /email|mail|phone|mobile|tel|city|country|state|zip|product|service|company|agency|message|query|remark|note|size|team|branch|form|post|page|nonce|token|url|ref|recaptcha|designation|job|title|role|position/i.test(
          cleanK
        )
      ) {
        continue;
      }
      const trimmedV = v.trim();
      if (
        trimmedV.length >= 3 &&
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

  const rawCountryCode = findValue([/^countrycode$/, /^callingcode$/, /^code$/]).trim();
  let fullPhone = rawPhone;
  if (fullPhone && rawCountryCode && !fullPhone.startsWith('+')) {
    const cleanCode = rawCountryCode.startsWith('+') ? rawCountryCode : `+${rawCountryCode}`;
    fullPhone = `${cleanCode} ${fullPhone}`.trim();
  }

  // 4. Resolve Designation & Location
  const designation = (
    findValue([/^designation$/, /^jobtitle$/, /^job_title$/, /^job$/, /^role$/, /^position$/, /^title$/]) ||
    'Tour Operator / Agency Leader'
  ).trim();

  const city = findValue([/^city$/, /^yourcity$/, /^your_city$/, /^town$/, /city/]).trim();

  // Explicit country name keys check FIRST
  let country = findValue([
    /^countryname$/,
    /^country_name$/,
    /^yourcountryname$/,
    /^selectcountryname$/,
    /^nationname$/,
    /^countrytext$/,
    /^country_text$/
  ]).trim();

  if (!country) {
    country = findValue([
      /^country$/,
      /^selectcountry$/,
      /^yourcountry$/,
      /^nation$/
    ]).trim();
  }

  // Country ID / Calling code lookup map
  const numericCountryMap: Record<string, string> = {
    '101': 'India',
    '194': 'Saudi Arabia',
    '221': 'United Arab Emirates',
    '232': 'United Kingdom',
    '233': 'United States',
    '163': 'Pakistan',
    '100': 'Indonesia',
    '132': 'Malaysia',
    '18': 'Bangladesh',
    '58': 'Egypt',
    '220': 'Turkey',
    '91': 'India',
    '+91': 'India',
    '1': 'United States',
    '+1': 'United States',
    '44': 'United Kingdom',
    '+44': 'United Kingdom',
    '966': 'Saudi Arabia',
    '+966': 'Saudi Arabia',
    '971': 'United Arab Emirates',
    '+971': 'United Arab Emirates',
  };

  if (!country || /^\+?\d+$/.test(country)) {
    const altCountryName = findValue([/countryname/i, /country_name/i, /countrytext/i]);
    if (altCountryName && !/^\+?\d+$/.test(altCountryName)) {
      country = altCountryName.trim();
    } else if (country && numericCountryMap[country]) {
      country = numericCountryMap[country];
    } else {
      country = 'India';
    }
  }

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
      companyName = brandFallbackAgency(brand, firstName);
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

  // 6. Resolve Product & Team Size (gathering ALL selected products)
  const productValues: string[] = [];
  for (const [k, v] of Object.entries(flatFields)) {
    if (!v) continue;
    const lowerK = k.toLowerCase().replace(/[-_\[\]\.\s]/g, '');
    if (
      /product|products|selectproduct|serviceinterest|productinterest|solution|interest/i.test(lowerK)
    ) {
      const parts = String(v).split(/[,;\n]/).map((p) => p.trim()).filter(Boolean);
      for (const p of parts) {
        if (
          p &&
          !productValues.some((pv) => pv.toLowerCase() === p.toLowerCase()) &&
          !/select|choose|default/i.test(p)
        ) {
          productValues.push(p);
        }
      }
    }
  }

  let product = productValues.length > 0 ? productValues.join(', ') : '';

  if (!product) {
    product = (
      findValue([
        /^product$/,
        /^products$/,
        /^selectproducts$/,
        /^productinterest$/,
        /^serviceinterest$/,
        /^solution$/,
        /^interest$/,
        /product/,
      ]) || brand.defaultProduct
    ).trim();
  }

  if (product === brand.defaultProduct || !product) {
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

  const sourceUrl = findValue([/^sourceurl$/, /^source$/, /^referrer$/]) || brandDefaultSourceUrl(brand);

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
      const repo = tenantRepo(ctx);
      const q = query(repo.contacts(), where('email', '==', email));
      const snap = await getDocs(q);
      if (!snap.empty) {
        const found = snap.docs[0].data() as Contact;
        contactId = found.contactId;
        existingContactData = found;
        console.log(`[Website Lead] Matching existing contact found: ${contactId} (${email}) for tenant ${ctx.tenantId}`);
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
    demoStatus: 'NOT_BOOKED',
    demoSource: undefined,
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
    brandInboundHeading(brand),
    ``,
    `• Name: ${rawFullName}${designation && designation.toLowerCase() !== rawFullName.toLowerCase() ? ` (${designation})` : ''}`,
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
  const inFlightSet = getInFlightSet(ctx.tenantId);
  if (cleanEmail && cleanEmail.includes('@')) {
    alreadySent = await hasThankYouEmailBeenSent(cleanEmail, ctx);
    isInFlight = inFlightSet.has(cleanEmail);
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
    recipientEmail: brand.salesEmail || 'sales@umrah360.in',
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
    inFlightSet.add(cleanEmail);
    try {
      await fetchFirestoreSmtpConfig();
      const smtpConfig = getSmtpConfig();

      if (smtpConfig.configured) {
        const emailSubject = brandDemoThankYouSubject(brand, companyName);
        const emailBody = [
          `Hello ${firstName},`,
          ``,
          `Thank you for requesting a live demo of ${brand.companyName} for ${companyName}!`,
          ``,
          `We have received your requirements:`,
          `- Product: ${product}`,
          `- Team Size: ${teamSize}`,
          `- Location: ${city ? `${city}, ` : ''}${country}`,
          `- Multi-Branch Setup: ${branches}`,
          ``,
          brandSpecialistLine(brand, fullPhone || cleanEmail),
          ``,
          brand.playbook === 'umrah360'
            ? `If you need immediate assistance or have specific visa/hotel allotment workflows you would like to test, simply reply to this email.`
            : `If you need immediate assistance, simply reply to this email.`,
          ``,
          `Warm regards,`,
          ...brandThankYouSignoff(brand),
        ].join('\n');

        console.log(`[Website Lead] Dispatching single Thank You email to ${cleanEmail} for ${companyName}...`);
        const mailResult = await sendLiveEmail({
          tenantId: ctx.tenantId,
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
            senderName: brand.senderName,
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
          }, ctx);
        } else {
          console.warn(`[Website Lead Warning] SMTP delivery attempt to ${cleanEmail} failed:`, mailResult.error);
        }
      } else {
        console.warn(`[Website Lead Notice] SMTP credentials not configured yet; skipping live email dispatch.`);
      }
    } catch (smtpErr) {
      console.warn('[Website Lead] Notice sending auto-confirmation email:', smtpErr);
    } finally {
      inFlightSet.delete(cleanEmail);
    }
  }

  // -----------------------------------------------------------------
  // 13. Persist All Entities Directly to Firestore DB
  // -----------------------------------------------------------------
  if (isFirebaseConfigured && db) {
    try {
      const repo = tenantRepo(ctx);
      const writes: Promise<any>[] = [
        safeSetDoc(repo.contactDoc(contact.contactId), contact, { merge: true }),
        safeSetDoc(repo.leadDoc(lead.leadId), lead, { merge: true }),
        safeSetDoc(repo.conversationDoc(conversation.conversationId), conversation, { merge: true }),
        safeSetDoc(repo.messageDoc(initialMessage.messageId), initialMessage, { merge: true }),
      ];

      if (autoReplyMessage) {
        writes.push(safeSetDoc(repo.messageDoc(autoReplyMessage.messageId), autoReplyMessage, { merge: true }));
      }

      await Promise.all(writes);
      console.log(`[Website Lead] Successfully stored Lead "${companyName}" (${leadId}) directly into Firestore DB for tenant ${ctx.tenantId}!`);
    } catch (dbErr) {
      console.error(`[Website Lead] Error writing to Firestore DB for ${ctx.tenantId}:`, dbErr);
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
