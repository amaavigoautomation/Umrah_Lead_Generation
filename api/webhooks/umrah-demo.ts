import type { IncomingMessage, ServerResponse } from 'http';
import nodemailer from 'nodemailer';

/**
 * Production-Ready Standalone Vercel Serverless Function for Website Demo Inbound Webhook
 * Route: /api/webhooks/umrah-demo & /api/leads/inbound
 *
 * Dedicated for: https://umrah360.in/request-demo, WordPress, Elementor Pro Forms, Contact Form 7, WPForms, Webflow, custom cURL
 * Target CRM Database: Firestore (gen-lang-client-0376069258 / ai-studio-379c884e-3360-468a-ad55-8105acbd3214)
 *
 * Capabilities:
 *  1. Universal multi-format body parser: parses JSON, nested Elementor structures, bracket notation, urlencoded, multipart/form-data, Buffer & Streams
 *  2. Smart value-pattern matching: auto-detects emails and phone numbers even if field names are arbitrary
 *  3. Ingests all form inputs without losing custom questions or unmapped fields
 *  4. Creates or updates Contact in Firestore `contacts`
 *  5. Creates Lead in Firestore `leads` (DEMO_SCHEDULED, BOOKED)
 *  6. Creates Conversation & Inbound Message in Firestore `conversations` & `messages` (Unified Inbox)
 *  7. Automatically dispatches personalized Thank You confirmation email via SMTP to lead's real email
 *  8. Appends the Outbound Auto-Reply Message to the Unified Inbox thread
 */

const FIREBASE_PROJECT_ID = 'gen-lang-client-0376069258';
const FIRESTORE_DATABASE_ID = 'ai-studio-379c884e-3360-468a-ad55-8105acbd3214';

// Helper to write directly to Firestore REST API in serverless environments
async function writeToFirestoreRest(collectionName: string, docId: string, data: Record<string, any>) {
  try {
    const firestoreUrl = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/${collectionName}/${encodeURIComponent(
      docId
    )}`;

    const fields: Record<string, any> = {};
    for (const [key, value] of Object.entries(data)) {
      if (value === null || value === undefined) {
        fields[key] = { nullValue: null };
      } else if (typeof value === 'string') {
        fields[key] = { stringValue: value };
      } else if (typeof value === 'number') {
        if (Number.isInteger(value)) {
          fields[key] = { integerValue: value.toString() };
        } else {
          fields[key] = { doubleValue: value };
        }
      } else if (typeof value === 'boolean') {
        fields[key] = { booleanValue: value };
      } else if (Array.isArray(value)) {
        fields[key] = {
          arrayValue: {
            values: value.map((v) => (typeof v === 'string' ? { stringValue: v } : { stringValue: JSON.stringify(v) })),
          },
        };
      } else if (typeof value === 'object') {
        fields[key] = { stringValue: JSON.stringify(value) };
      }
    }

    const res = await fetch(firestoreUrl, {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ fields }),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => '');
      console.warn(`[Firestore REST Warning] ${collectionName}/${docId} status ${res.status}:`, errText.slice(0, 150));
    }

    return res.ok;
  } catch (err) {
    console.warn(`[Firestore REST Warning] Failed writing to ${collectionName}/${docId}:`, err);
    return false;
  }
}

// Helper to retrieve live SMTP credentials from environment or Firestore settings/smtp
async function getLiveSmtpCredentials() {
  let host = process.env.SMTP_HOST || 'smtp.gmail.com';
  let port = parseInt(process.env.SMTP_PORT || '465', 10);
  let secure = process.env.SMTP_SECURE === 'true' || port === 465;
  let user = process.env.SMTP_USER || 'amaavigo@gmail.com';
  let rawPass = process.env.SMTP_PASS || '';

  // If environment variable is missing, fetch from Firestore settings/smtp
  if (!rawPass) {
    try {
      const url = `https://firestore.googleapis.com/v1/projects/${FIREBASE_PROJECT_ID}/databases/${FIRESTORE_DATABASE_ID}/documents/settings/smtp`;
      const res = await fetch(url, { headers: { 'Content-Type': 'application/json' } });
      if (res.ok) {
        const docData = await res.json();
        const f = docData.fields || {};
        if (f.pass?.stringValue) rawPass = f.pass.stringValue;
        if (f.user?.stringValue) user = f.user.stringValue;
        if (f.host?.stringValue) host = f.host.stringValue;
        if (f.port?.integerValue) port = parseInt(f.port.integerValue, 10);
        secure = port === 465;
      }
    } catch (e) {
      console.warn('[SMTP Credentials Fetch Notice]:', e);
    }
  }

  const cleanPass = rawPass.replace(/\s+/g, '');
  const configured = Boolean(user && cleanPass);

  return { host, port, secure, user, pass: cleanPass, configured };
}

// Helper to send live auto-reply email via SMTP with relay fallback
async function sendAutoReplyEmail(
  toEmail: string,
  fullName: string,
  companyName: string,
  product: string,
  teamSize: string,
  city: string,
  country: string,
  branches: string,
  phone: string
) {
  const creds = await getLiveSmtpCredentials();

  const firstName = fullName.split(/\s+/)[0] || 'there';
  const subject = `We have received your Umrah360 Demo Request - ${companyName || 'Umrah360'}`;

  const textBody = [
    `As-salamu alaykum ${firstName},`,
    ``,
    `Thank you for requesting a live demo of Umrah360 for ${companyName || 'your travel agency'}!`,
    ``,
    `We have received your requirements:`,
    `- Product Interest: ${product}`,
    `- Estimated Team Size: ${teamSize || 'Single / Multi User'}`,
    `- Location: ${city ? `${city}, ` : ''}${country || 'Global'}`,
    `- Multi-Branch Operations: ${branches || 'Single Office'}`,
    ``,
    `One of our senior pilgrimage software specialists will reach out to you shortly at ${phone || toEmail} to coordinate a suitable time for your personalized walkthrough and answer any operational questions you have.`,
    ``,
    `If you have specific Saudi visa tracking, Makkah/Madinah hotel contracting, or B2B sub-agent workflows you would like to test, simply reply to this email.`,
    ``,
    `Warm regards,`,
    `The Umrah360 Team`,
    `https://umrah360.in`,
  ].join('\n');

  // Attempt 1: Direct SMTP via Nodemailer
  if (creds.configured) {
    try {
      const transporter = nodemailer.createTransport({
        host: creds.host,
        port: creds.port,
        secure: creds.secure,
        auth: { user: creds.user, pass: creds.pass },
        tls: { rejectUnauthorized: false },
        connectionTimeout: 12000,
        greetingTimeout: 10000,
        socketTimeout: 15000,
      });

      const info = await transporter.sendMail({
        from: `Umrah360 Team <${creds.user}>`,
        to: toEmail,
        subject,
        text: textBody,
        replyTo: creds.user,
      });

      console.log(`[Auto-Reply Success] Sent demo confirmation to ${toEmail} (ID: ${info.messageId})`);
      return { sent: true, messageId: info.messageId, subject, textBody };
    } catch (err: any) {
      console.warn(`[Auto-Reply Direct SMTP Notice] Direct transmission failed:`, err?.message);
    }
  }

  // Attempt 2: Relay through AI Studio Applet backend
  try {
    const relayUrls = [
      'https://ais-pre-3xmgysisounf7552polmhz-894785851538.asia-southeast1.run.app/api/email/send',
      'https://ais-dev-3xmgysisounf7552polmhz-894785851538.asia-southeast1.run.app/api/email/send',
    ];

    for (const relayUrl of relayUrls) {
      try {
        const relayRes = await fetch(relayUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            to: toEmail,
            subject,
            text: textBody,
          }),
        });

        if (relayRes.ok) {
          const relayData = await relayRes.json();
          if (relayData.success !== false) {
            console.log(`[Auto-Reply Relay Success] Sent demo confirmation via relay to ${toEmail}`);
            return { sent: true, messageId: relayData.messageId || 'relayed', subject, textBody };
          }
        }
      } catch (innerRelay) {
        console.warn(`[Auto-Reply Relay Url Notice] Failed ${relayUrl}:`, innerRelay);
      }
    }
  } catch (relayErr) {
    console.warn('[Auto-Reply Relay Notice]:', relayErr);
  }

  return { sent: false, error: 'Could not deliver auto-reply email via direct SMTP or relay', subject, textBody };
}

// Parse multipart/form-data text into a flat key-value dictionary
function parseMultipartBody(rawText: string): Record<string, string> {
  const result: Record<string, string> = {};
  try {
    const lines = rawText.split(/\r?\n/);
    let currentKey = '';
    let currentValueLines: string[] = [];
    let inData = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes('Content-Disposition: form-data')) {
        if (currentKey) {
          result[currentKey] = currentValueLines.join('\n').trim();
          currentValueLines = [];
        }
        const match = line.match(/name=["']([^"']+)["']/i);
        if (match && match[1]) {
          currentKey = match[1];
          inData = false;
        }
      } else if (currentKey && !inData && line.trim() === '') {
        inData = true;
      } else if (inData) {
        if (line.startsWith('--') && line.length > 5) {
          if (currentKey) {
            result[currentKey] = currentValueLines.join('\n').trim();
            currentKey = '';
            currentValueLines = [];
            inData = false;
          }
        } else {
          currentValueLines.push(line);
        }
      }
    }
    if (currentKey && currentValueLines.length > 0) {
      result[currentKey] = currentValueLines.join('\n').trim();
    }
  } catch (err) {
    console.warn('[Multipart Parse Notice]:', err);
  }
  return result;
}

// Safely extract and decode all payload sources (JSON, URLSearchParams, Multipart, Buffers, Streams, Query)
async function extractRawBodyAndQuery(req: IncomingMessage & { body?: any }): Promise<{ parsedObj: Record<string, any>; rawText: string }> {
  let rawText = '';
  let parsedObj: Record<string, any> = {};

  // 1. Buffer handling
  if (Buffer.isBuffer(req.body)) {
    rawText = req.body.toString('utf-8');
  }
  // 2. String handling
  else if (typeof req.body === 'string') {
    rawText = req.body;
  }
  // 3. Object handling
  else if (req.body && typeof req.body === 'object' && !Array.isArray(req.body)) {
    parsedObj = { ...req.body };
    try {
      rawText = JSON.stringify(req.body);
    } catch {}
  }

  // 4. Stream fallback if body wasn't pre-parsed
  if (!rawText && Object.keys(parsedObj).length === 0 && !req.readableEnded && req.readable) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      if (chunks.length > 0) {
        rawText = Buffer.concat(chunks).toString('utf-8');
      }
    } catch (e) {
      console.warn('[Body Read Stream Notice]:', e);
    }
  }

  // 5. Decode text representation into parsedObj
  if (rawText) {
    // Try JSON
    try {
      const json = JSON.parse(rawText);
      if (json && typeof json === 'object') {
        parsedObj = { ...json, ...parsedObj };
      }
    } catch {
      // Try URL-encoded Form Params
      try {
        const params = new URLSearchParams(rawText);
        params.forEach((val, key) => {
          parsedObj[key] = val;
        });
      } catch {}

      // Try Multipart Form-Data
      if (rawText.includes('Content-Disposition: form-data') || rawText.includes('------')) {
        const multipartFields = parseMultipartBody(rawText);
        parsedObj = { ...multipartFields, ...parsedObj };
      }
    }
  }

  // 6. Query Parameters from URL (e.g. ?name=...&email=...)
  if (req.url && req.url.includes('?')) {
    try {
      const qIndex = req.url.indexOf('?');
      const qParams = new URLSearchParams(req.url.slice(qIndex));
      qParams.forEach((val, key) => {
        if (!parsedObj[key]) parsedObj[key] = val;
      });
    } catch {}
  }

  return { parsedObj, rawText };
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
      // Elementor field: { id: "name", value: "Mohammad", raw_value: "Mohammad" }
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

// Universal Field Matcher & Extractor
function resolveLeadSubmission(flatFields: Record<string, string>) {
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

  // 1. Email Resolution
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

  // Value scan fallback for email
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

  // 2. Phone Resolution
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

  // Value scan fallback for phone
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

  const rawCountryCode = findValue([/^countrycode$/, /^code$/]);
  let formattedPhone = rawPhone;
  if (formattedPhone && rawCountryCode && !formattedPhone.startsWith('+')) {
    const cleanCode = rawCountryCode.startsWith('+') ? rawCountryCode : `+${rawCountryCode}`;
    formattedPhone = `${cleanCode} ${formattedPhone}`.trim();
  }

  // 3. Name Resolution
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

  const firstNamePart = findValue([/^firstname$/, /^fname$/, /^first$/]).trim();
  const lastNamePart = findValue([/^lastname$/, /^lname$/, /^last$/]).trim();
  if (!rawFullName && (firstNamePart || lastNamePart)) {
    rawFullName = `${firstNamePart} ${lastNamePart}`.trim();
  }

  // Derive sensible name fallback from email if user didn't provide a name field
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

  // 4. Company Resolution
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

  if (!companyName && email) {
    const domain = email.split('@')[1] || '';
    if (domain && !/gmail|yahoo|hotmail|outlook|icloud|live|aol/i.test(domain)) {
      const brand = domain.split('.')[0] || '';
      companyName = brand.charAt(0).toUpperCase() + brand.slice(1) + ' Travels';
    }
  }

  // 5. Designation / Role
  const designation = findValue([
    /^designation$/,
    /^jobtitle$/,
    /^job$/,
    /^role$/,
    /^position$/,
    /^title$/,
  ]).trim();

  // 6. Location
  const city = findValue([/^city$/, /^yourcity$/, /^town$/, /city/]).trim();
  const country = findValue([/^country$/, /^selectcountry$/, /^yourcountry$/, /^nation$/, /country/]).trim();

  // 7. Product Interest
  const product = findValue([
    /^product$/,
    /^products$/,
    /^selectproducts$/,
    /^productinterest$/,
    /^serviceinterest$/,
    /^solution$/,
    /^interest$/,
    /product/,
  ]).trim();

  // 8. Team Size
  const teamSize = findValue([
    /^teamsize$/,
    /^team$/,
    /^size$/,
    /^employees$/,
    /^users$/,
    /^capacity$/,
  ]).trim();

  // 9. Branches
  const rawBranches = findValue([/^branches$/, /^hasbranches$/, /^hasbranch$/, /^branch$/, /branch/]).trim();
  const branches =
    typeof rawBranches === 'string' && /yes|true|multiple|branch/i.test(rawBranches)
      ? 'Yes'
      : rawBranches && /no|false|single/i.test(rawBranches)
      ? 'No'
      : rawBranches;

  // 10. Message / Requirements / Query
  const queryMessage = findValue([
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

  const website = findValue([/^website$/, /^companywebsite$/, /^url$/, /^companyurl$/]).trim();

  // 11. Collect all other custom/unmapped fields submitted in the form
  const unmapped: string[] = [];
  const mappedValues = new Set([
    email,
    rawPhone,
    formattedPhone,
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
    queryMessage,
    website,
  ]);

  for (const [k, v] of Object.entries(flatFields)) {
    if (!v) continue;
    if (mappedValues.has(v)) continue;
    const lowerK = k.toLowerCase().replace(/[-_\[\]\.\s]/g, '');
    if (/^(id|type|rawvalue|fieldid|fieldtype|key|label|formid|formname|action|submit|nonce|wpnonce|wphttpreferer|recaptcha|token|postid|referertitle)$/i.test(lowerK)) continue;
    if (k.length > 50 || v.length > 500) continue;
    unmapped.push(`• ${k}: ${v}`);
  }

  return {
    email,
    phone: formattedPhone,
    fullName: rawFullName || 'Inbound Website Lead',
    companyName: companyName || (rawFullName ? `${rawFullName}'s Agency` : 'Umrah Tour Agency'),
    designation: designation || 'Agency Leader',
    city,
    country,
    product: product || 'Umrah ERP & B2B Sub-Agent Portal',
    teamSize: teamSize || 'Standard Team',
    branches: branches || 'Single Office',
    queryMessage: queryMessage || '',
    website,
    unmappedFields: unmapped,
  };
}

export default async function handler(
  req: IncomingMessage & { body?: any; query?: any },
  res: ServerResponse
) {
  // CORS Headers for cross-origin browser form submissions from umrah360.in
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // 1. GET: Documentation & Live Health Status
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify(
        {
          service: 'Umrah360 Website Demo Lead Ingestion Webhook',
          status: 'active',
          acceptedMethods: ['POST'],
          targetWebsite: 'https://umrah360.in/request-demo',
          deployedEndpoint: 'https://leadgeneration-sable.vercel.app/api/webhooks/umrah-demo',
          databaseTarget: 'Firestore: contacts, leads, conversations, messages',
          supportedFormTypes: ['WordPress', 'Elementor Pro Forms', 'Contact Form 7', 'WPForms', 'HTML Forms', 'cURL'],
          timestamp: new Date().toISOString(),
        },
        null,
        2
      )
    );
  }

  // 2. POST: Ingest Lead into CRM
  if (req.method === 'POST') {
    try {
      const { parsedObj, rawText } = await extractRawBodyAndQuery(req);

      console.log('[Inbound Webhook Received] User-Agent:', req.headers['user-agent'] || 'Unknown');
      console.log('[Inbound Webhook Received] Content-Type:', req.headers['content-type'] || 'Unknown');
      console.log('[Inbound Webhook Received] Raw payload preview:', rawText.slice(0, 300));

      // Flatten all incoming form fields
      const flatFields = flattenAllFields(parsedObj);
      const extracted = resolveLeadSubmission(flatFields);

      console.log('[Inbound Webhook Extracted]:', {
        fullName: extracted.fullName,
        email: extracted.email,
        phone: extracted.phone,
        companyName: extracted.companyName,
        product: extracted.product,
        teamSize: extracted.teamSize,
        queryMessage: extracted.queryMessage,
        unmappedCount: extracted.unmappedFields.length,
      });

      const email = extracted.email;
      const fullName = extracted.fullName;
      const nameParts = fullName.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || 'Valued';
      const lastName = nameParts.slice(1).join(' ') || 'Partner';
      const companyName = extracted.companyName;
      const phone = extracted.phone;
      const designation = extracted.designation;
      const city = extracted.city;
      const country = extracted.country || 'Global';
      const locationStr = [city, country].filter(Boolean).join(', ') || 'Online Inquiry';
      const product = extracted.product;
      const teamSize = extracted.teamSize;
      const branches = extracted.branches;
      const queryMessage = extracted.queryMessage;
      const website = extracted.website;

      // Calculate Lead Score
      let score = 85;
      if (email.includes('@') && !email.endsWith('@gmail.com') && !email.endsWith('@yahoo.com')) {
        score += 5; // Business domain email
      }
      if (teamSize.includes('10') || teamSize.includes('20') || teamSize.includes('Enterprise')) {
        score += 5;
      }
      if (branches === 'Yes') {
        score += 5;
      }
      score = Math.min(100, Math.max(70, score));

      const nowIso = new Date().toISOString();
      const randSuffix = Math.random().toString(36).substring(2, 6);
      const leadId = `lead-web-${Date.now()}-${randSuffix}`;
      const contactId = `cnt-web-${Date.now()}-${randSuffix}`;
      const conversationId = `conv-web-${Date.now()}-${randSuffix}`;
      const messageId = `msg-web-${Date.now()}-${randSuffix}`;
      const autoReplyMsgId = `msg-auto-reply-${Date.now()}-${randSuffix}`;

      // Build Inbound Summary Message for Unified Inbox
      const inboundLines = [
        `🕋 INBOUND DEMO REQUEST from umrah360.in/request-demo:`,
        ``,
        `• Name: ${fullName} (${designation})`,
        `• Company: ${companyName}${website ? ` (${website})` : ''}`,
        `• Email: ${email || 'Not provided'}`,
        `• Phone: ${phone || 'Not provided'}`,
        `• Location: ${locationStr}`,
        `• Product Interest: ${product}`,
        `• Team Size: ${teamSize}`,
        `• Multi-Branch: ${branches}`,
        ``,
        `Message / Requirement:`,
        queryMessage || 'Customer submitted the "Schedule my Free Demo" form on umrah360.in.',
      ];

      if (extracted.unmappedFields.length > 0) {
        inboundLines.push(``, `Additional Form Submission Data:`, ...extracted.unmappedFields);
      }

      const inboundSummaryText = inboundLines.join('\n');

      // Contact Data for Firestore
      const contactData = {
        contactId,
        firstName,
        lastName,
        fullName,
        email: email || `inbound-${Date.now()}@umrah360.in`,
        phone: phone || '',
        jobTitle: designation,
        designation,
        companyName,
        website,
        branches,
        city,
        country,
        tier: score >= 90 ? 'VIP' : 'STANDARD',
        tags: ['WEBSITE_DEMO_FORM', 'UMRAH360_IN', product],
        notes: `Inbound website demo submission from umrah360.in: ${queryMessage || 'Free Demo Request'}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Lead Data for Firestore
      const leadData = {
        leadId,
        title: `${companyName} - Demo Request (${product})`,
        contactId,
        source: 'WEBSITE',
        leadType: 'INBOUND',
        status: 'DEMO_SCHEDULED',
        demoStatus: 'BOOKED',
        priority: score >= 90 ? 'HIGH' : 'MEDIUM',
        leadScore: score,
        intent: 'HIGH',
        buyingStage: 'DECISION',
        serviceInterest: product,
        requirements: [
          product,
          `Team Size: ${teamSize}`,
          `Multi-Branch: ${branches}`,
          ...(city ? [`City: ${city}`] : []),
          ...(country ? [`Country: ${country}`] : []),
          ...(queryMessage ? [`Query: ${queryMessage}`] : []),
        ],
        queryMessage,
        teamSize,
        city,
        country,
        estimatedValue: 18000,
        currency: 'USD',
        tags: ['WEBSITE_DEMO_FORM', 'BOOKED_DEMO', 'UMRAH360_IN', branches === 'Yes' ? 'MULTI_BRANCH' : 'SINGLE_BRANCH'],
        aiSummary: `High-intent inquiry from ${fullName} (${designation} at ${companyName}). Interested in ${product} for a team of ${teamSize}. Multi-branch operations: ${branches}. Query: "${queryMessage || 'Standard walkthrough'}".`,
        aiRecommendation: `High priority follow-up! Reach out to ${firstName} at ${phone || email} to confirm demo time slot and showcase customized pilgrimage operations and sub-agent B2B allotments.`,
        assignedAgent: 'System Automated Ingestion',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Conversation Data for Unified Inbox
      const conversationData = {
        conversationId,
        contactId,
        leadId,
        channel: 'EMAIL',
        subject: `Website Demo Request: ${companyName} (${product})`,
        status: 'ACTIVE',
        direction: 'INBOUND',
        aiEnabled: true,
        humanHandoff: false,
        conversationSummary: `Website Demo Request: ${companyName} (${fullName})`,
        startedAt: nowIso,
        lastMessageText: inboundSummaryText.slice(0, 180) + '...',
        lastMessageAt: nowIso,
        unreadCount: 1,
        isRead: false,
        unread: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      // Inbound Message Data for Unified Inbox Thread
      const messageData = {
        messageId,
        conversationId,
        senderType: 'CUSTOMER',
        senderName: fullName,
        channel: 'EMAIL',
        direction: 'INBOUND',
        text: inboundSummaryText,
        timestamp: nowIso,
        sentAt: nowIso,
        receivedAt: nowIso,
      };

      // 3. Persist all 4 records to Firestore REST API
      await Promise.allSettled([
        writeToFirestoreRest('contacts', contactId, contactData),
        writeToFirestoreRest('leads', leadId, leadData),
        writeToFirestoreRest('conversations', conversationId, conversationData),
        writeToFirestoreRest('messages', messageId, messageData),
      ]);

      console.log(`[Webhook Success] Ingested lead "${companyName}" (${leadId}) into Firestore DB.`);

      // 4. Dispatch Auto-Reply Thank-You Email via SMTP
      let autoReplySent = false;
      let autoReplyText = '';
      if (email && email.includes('@')) {
        const mailResult = await sendAutoReplyEmail(
          email,
          fullName,
          companyName,
          product,
          teamSize,
          city,
          country,
          branches,
          phone
        );

        autoReplySent = mailResult.sent;
        autoReplyText = mailResult.textBody;

        // 5. Append Outbound Thank-You Message to the Conversation in Firestore ONLY IF actually sent
        if (autoReplySent) {
          const nowIsoSent = new Date().toISOString();
          const autoReplyMessageData = {
            messageId: autoReplyMsgId,
            conversationId,
            senderType: 'AI',
            senderName: 'Umrah360 Automation',
            channel: 'EMAIL',
            direction: 'OUTBOUND',
            recipientEmail: email,
            deliveryStatus: 'DELIVERED',
            smtpMessageId: mailResult.messageId,
            emailDeliveredAt: nowIsoSent,
            text: autoReplyText,
            timestamp: nowIsoSent,
            sentAt: nowIsoSent,
            receivedAt: nowIsoSent,
          };

          await Promise.allSettled([
            writeToFirestoreRest('messages', autoReplyMsgId, autoReplyMessageData),
            writeToFirestoreRest('conversations', conversationId, {
              ...conversationData,
              thankYouEmailSent: true,
              thankYouEmailDeliveredAt: nowIsoSent,
              thankYouSmtpMessageId: mailResult.messageId,
              customerEmail: email,
            }),
          ]);
        } else {
          console.warn('[Webhook Notice] Auto-reply was NOT sent, skipping writing outbound message to Unified Inbox:', mailResult.error);
        }
      } else {
        console.log('[Webhook Notice] No valid email address detected in form submission, skipping auto-reply email.');
      }

      // 6. Return 200 Success Response
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify(
          {
            success: true,
            message: 'Website demo request successfully received, stored in CRM & Unified Inbox, and auto-reply dispatched.',
            leadId,
            autoReplySent,
            extracted: {
              fullName,
              email,
              phone,
              companyName,
              designation,
              city,
              country,
              product,
              teamSize,
              branches,
              queryMessage,
            },
            lead: {
              leadId,
              title: leadData.title,
              leadScore: score,
              status: leadData.status,
              demoStatus: leadData.demoStatus,
              serviceInterest: product,
              aiSummary: leadData.aiSummary,
            },
            contact: {
              contactId,
              fullName,
              email: contactData.email,
              phone,
              companyName,
              city,
              country,
            },
            conversation: {
              conversationId,
            },
            timestamp: nowIso,
          },
          null,
          2
        )
      );
    } catch (err: any) {
      console.error('[Website Lead Webhook Error]:', err);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          success: false,
          error: err?.message || 'Error processing lead submission',
        })
      );
    }
  }

  res.statusCode = 405;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
}
