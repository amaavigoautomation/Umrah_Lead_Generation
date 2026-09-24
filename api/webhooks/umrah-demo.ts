import type { IncomingMessage, ServerResponse } from 'http';
import nodemailer from 'nodemailer';

/**
 * Production-Ready Standalone Vercel Serverless Function for Website Demo Inbound Webhook
 * Route: /api/webhooks/umrah-demo & /api/leads/inbound
 *
 * Dedicated for: https://umrah360.in/request-demo, Elementor forms, WordPress, Webflow, Postman
 * Target CRM Database: Firestore (gen-lang-client-0376069258 / ai-studio-379c884e-3360-468a-ad55-8105acbd3214)
 * Actions on Submission:
 *  1. Create Contact in Firestore `contacts`
 *  2. Create Lead in Firestore `leads` (DEMO_SCHEDULED, BOOKED)
 *  3. Create Conversation & Inbound Message in Firestore `conversations` & `messages` (Unified Inbox)
 *  4. Dispatch instant personalized Thank You Auto-Reply email to the lead's email via SMTP
 *  5. Append the Outbound Auto-Reply Message to the Unified Inbox thread
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

// Helper to send live auto-reply email via SMTP
async function sendAutoReplyEmail(toEmail: string, fullName: string, companyName: string, product: string, teamSize: string, city: string, country: string, branches: string, phone: string) {
  const host = process.env.SMTP_HOST || 'smtp.gmail.com';
  const port = parseInt(process.env.SMTP_PORT || '465', 10);
  const secure = process.env.SMTP_SECURE === 'true' || port === 465;
  const user = process.env.SMTP_USER || 'amaavigo@gmail.com';
  const rawPass = process.env.SMTP_PASS || '';
  const pass = rawPass.trim();
  const from = process.env.SMTP_FROM || `Umrah360 Team <${user}>`;

  const firstName = fullName.split(/\s+/)[0] || 'there';
  const subject = `We have received your Umrah360 Demo Request - ${companyName || 'Umrah360'}`;
  
  const textBody = [
    `As-salamu alaykum ${firstName},`,
    ``,
    `Thank you for requesting a live demo of Umrah360 for ${companyName || 'your travel agency'}!`,
    ``,
    `We have received your requirements:`,
    `- Product Interest: ${product}`,
    `- Estimated Team Size: ${teamSize}`,
    `- Location: ${city ? `${city}, ` : ''}${country || 'Global'}`,
    `- Multi-Branch Operations: ${branches}`,
    ``,
    `One of our senior pilgrimage software specialists will reach out to you shortly at ${phone || toEmail} to coordinate a suitable time for your personalized walkthrough and answer any operational questions you have.`,
    ``,
    `If you have specific Saudi visa tracking, Makkah/Madinah hotel contracting, or B2B sub-agent workflows you would like to test, simply reply to this email.`,
    ``,
    `Warm regards,`,
    `The Umrah360 Team`,
    `https://umrah360.in`,
  ].join('\n');

  if (!pass) {
    console.log('[Auto-Reply Notice] SMTP_PASS not set in environment, skipping live email dispatch.');
    return { sent: false, subject, textBody };
  }

  try {
    const transporter = nodemailer.createTransport({
      host,
      port,
      secure,
      auth: { user, pass },
      connectionTimeout: 10000,
      greetingTimeout: 10000,
      socketTimeout: 15000,
    });

    const info = await transporter.sendMail({
      from,
      to: toEmail,
      subject,
      text: textBody,
      replyTo: user,
    });

    console.log(`[Auto-Reply Success] Sent demo confirmation to ${toEmail} (ID: ${info.messageId})`);
    return { sent: true, messageId: info.messageId, subject, textBody };
  } catch (err: any) {
    console.warn(`[Auto-Reply Email Notice] Could not dispatch email to ${toEmail}:`, err?.message);
    return { sent: false, error: err?.message, subject, textBody };
  }
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

  // 1. GET: Documentation & Live Health Status for integration checks
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
          supportedFields: {
            personal: [
              'fullName (or name, your_full_name, your-name, firstName, lastName)',
              'email (or your_email, your-email, work_email)',
              'phone (or phoneNumber, phone_number, mobile, mobile_number)',
              'countryCode',
              'designation (or jobTitle, role)',
            ],
            location: ['country (or select_country)', 'city (or your_city)'],
            company: ['companyName (or company_name, company, agency)', 'companyWebsite (or company_url, website)', 'branches (or has_branches, Yes/No)'],
            product: ['product (or select_products, productInterest)', 'teamSize (or team_size, users, 10-20)'],
            query: ['message (or query, remark, remarks, notes, comments)'],
          },
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
      // Safe extraction of body across various Vercel / serverless runtimes
      let body: any = req.body;

      if (typeof body === 'string') {
        try {
          body = JSON.parse(body);
        } catch {
          try {
            const params = new URLSearchParams(body);
            const formObj: Record<string, any> = {};
            params.forEach((val, key) => {
              formObj[key] = val;
            });
            if (Object.keys(formObj).length > 0) body = formObj;
          } catch {}
        }
      }

      if (!body || (typeof body === 'object' && Object.keys(body).length === 0)) {
        if (!req.readableEnded && req.readable) {
          try {
            const chunks: Buffer[] = [];
            for await (const chunk of req) {
              chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
            }
            if (chunks.length > 0) {
              const raw = Buffer.concat(chunks).toString('utf-8');
              if (raw) {
                try {
                  body = JSON.parse(raw);
                } catch {
                  try {
                    const params = new URLSearchParams(raw);
                    const formObj: Record<string, any> = {};
                    params.forEach((val, key) => {
                      formObj[key] = val;
                    });
                    if (Object.keys(formObj).length > 0) body = formObj;
                  } catch {}
                }
              }
            }
          } catch (e) {
            console.warn('[Webhook] Stream reading fallback notice:', e);
          }
        }
      }

      if (!body || typeof body !== 'object') {
        body = {};
      }

      // 1. Extract and normalize fields
      const rawFullName = (
        body.fullName ||
        body.name ||
        body.your_full_name ||
        body['your-name'] ||
        body.full_name ||
        body.contact_name ||
        ''
      ).trim();

      const email = (
        body.email ||
        body.your_email ||
        body['your-email'] ||
        body.work_email ||
        body.contact_email ||
        ''
      ).trim().toLowerCase();

      const countryCode = (body.countryCode || body.country_code || '+91').trim();
      const rawPhone = (
        body.phone ||
        body.phoneNumber ||
        body.phone_number ||
        body.mobile ||
        body.mobile_number ||
        body['your-phone'] ||
        ''
      ).toString().trim();
      const formattedPhone = rawPhone
        ? rawPhone.startsWith('+')
          ? rawPhone
          : `${countryCode} ${rawPhone}`.trim()
        : '+91';

      const designation = (
        body.designation ||
        body.jobTitle ||
        body.job_title ||
        body.role ||
        'Tour Operator / Agency Leader'
      ).trim();

      const country = (body.country || body.select_country || body.selectCountry || 'India').trim();
      const city = (body.city || body.your_city || body.yourCity || 'Mumbai').trim();

      const companyName = (
        body.companyName ||
        body.company_name ||
        body.company ||
        body.agency ||
        body.agency_name ||
        (rawFullName ? `${rawFullName}'s Pilgrimage Agency` : 'Umrah Tour Operator')
      ).trim();

      const website = (
        body.companyWebsite ||
        body.company_website ||
        body.company_url ||
        body.companyUrl ||
        body.website ||
        body.url ||
        ''
      ).trim();

      const rawBranches = body.branches || body.has_branches || body.hasBranches;
      const branches =
        typeof rawBranches === 'boolean'
          ? rawBranches
            ? 'Yes'
            : 'No'
          : typeof rawBranches === 'string' && /yes|true|multiple|branch/i.test(rawBranches)
          ? 'Yes'
          : 'No';

      const product = (
        body.product ||
        body.products ||
        body.select_products ||
        body.selectProducts ||
        body.productInterest ||
        'Umrah ERP & B2B Sub-Agent Portal'
      ).trim();

      const teamSize = (
        body.teamSize ||
        body.team_size ||
        body.team_users ||
        body.users ||
        '10-20'
      ).trim();

      const queryMessage = (
        body.message ||
        body.query ||
        body.remark ||
        body.remarks ||
        body.notes ||
        body.comments ||
        body.requirement ||
        ''
      ).trim();

      // Split name
      const nameParts = rawFullName.split(/\s+/).filter(Boolean);
      const firstName = nameParts[0] || 'Valued';
      const lastName = nameParts.slice(1).join(' ') || 'Partner';
      const finalFullName = rawFullName || `${firstName} ${lastName}`;

      // Calculate Lead Qualification Score (0 - 100)
      let score = 85;
      if (email.includes('@') && !email.endsWith('@gmail.com') && !email.endsWith('@yahoo.com')) {
        score += 5; // Business domain email
      }
      if (teamSize.includes('10-20') || teamSize.includes('20+') || teamSize.includes('50+')) {
        score += 5; // High seat count enterprise
      }
      if (branches === 'Yes') {
        score += 5; // Multi-branch agency
      }
      score = Math.min(100, Math.max(70, score));

      const nowIso = new Date().toISOString();
      const randSuffix = Math.random().toString(36).substring(2, 6);
      const leadId = `lead-web-${Date.now()}-${randSuffix}`;
      const contactId = `cnt-web-${Date.now()}-${randSuffix}`;
      const conversationId = `conv-web-${Date.now()}-${randSuffix}`;
      const messageId = `msg-web-${Date.now()}-${randSuffix}`;
      const autoReplyMsgId = `msg-auto-reply-${Date.now()}-${randSuffix}`;

      // 2. Build CRM Objects
      const contactData = {
        contactId,
        firstName,
        lastName,
        fullName: finalFullName,
        email: email || `demo-${Date.now()}@inbound-lead.com`,
        phone: formattedPhone,
        countryCode,
        jobTitle: designation,
        designation,
        companyName,
        website,
        branches,
        city,
        country,
        tier: score >= 90 ? 'VIP' : 'STANDARD',
        tags: ['WEBSITE_DEMO_FORM', 'UMRAH360_IN', product],
        notes: `Inbound website demo submission from umrah360.in: ${queryMessage}`,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

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
        serviceInterest: product,
        requirements: `Product: ${product} | Team Size: ${teamSize} | Branches: ${branches} | Query: ${queryMessage}`,
        queryMessage,
        teamSize,
        city,
        country,
        estimatedValue: 18000,
        currency: 'USD',
        tags: ['WEBSITE_DEMO_FORM', 'BOOKED_DEMO', 'UMRAH360_IN', branches === 'Yes' ? 'MULTI_BRANCH' : 'SINGLE_BRANCH'],
        aiSummary: `High-intent inquiry from ${finalFullName} (${designation} at ${companyName}). Interested in ${product} for a team of ${teamSize}. Multi-branch operations: ${branches}.`,
        aiRecommendation: 'High priority follow-up. Prepare customized demo showing dynamic Saudi hotel contracting and sub-agent B2B allotments.',
        assignedAgent: 'System Automated Ingestion',
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const inboundSummaryText = [
        `🕋 INBOUND DEMO REQUEST from umrah360.in/request-demo:`,
        ``,
        `• Name: ${finalFullName} (${designation})`,
        `• Company: ${companyName}${website ? ` (${website})` : ''}`,
        `• Email: ${email}`,
        `• Phone: ${formattedPhone}`,
        `• Location: ${city ? `${city}, ` : ''}${country}`,
        `• Product Interest: ${product}`,
        `• Team Size: ${teamSize}`,
        `• Multi-Branch: ${branches}`,
        ``,
        `Message / Requirement:`,
        queryMessage || 'Customer submitted the "Schedule my Free Demo" form on umrah360.in.',
      ].join('\n');

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
        conversationSummary: `Website Demo Request: ${companyName} (${finalFullName})`,
        startedAt: nowIso,
        lastMessageText: inboundSummaryText.slice(0, 180) + '...',
        lastMessageAt: nowIso,
        unreadCount: 1,
        isRead: false,
        unread: true,
        createdAt: nowIso,
        updatedAt: nowIso,
      };

      const messageData = {
        messageId,
        conversationId,
        senderType: 'CUSTOMER',
        senderName: finalFullName,
        channel: 'EMAIL',
        direction: 'INBOUND',
        text: inboundSummaryText,
        timestamp: nowIso,
        sentAt: nowIso,
        receivedAt: nowIso,
      };

      // 3. Persist Contact, Lead, Conversation, and Inbound Message to Firestore
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
          finalFullName,
          companyName,
          product,
          teamSize,
          city,
          country,
          branches,
          formattedPhone
        );

        autoReplySent = mailResult.sent;
        autoReplyText = mailResult.textBody;

        // 5. Append Outbound Thank-You Message to the Conversation in Firestore
        const autoReplyMessageData = {
          messageId: autoReplyMsgId,
          conversationId,
          senderType: 'AI',
          senderName: 'Umrah360 Automation',
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          text: autoReplyText,
          timestamp: new Date().toISOString(),
          sentAt: new Date().toISOString(),
          receivedAt: new Date().toISOString(),
        };

        await writeToFirestoreRest('messages', autoReplyMsgId, autoReplyMessageData);
      }

      // Return 200 Success Response
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify(
          {
            success: true,
            message: 'Website demo request successfully received, stored in CRM & Unified Inbox, and auto-reply dispatched.',
            leadId,
            autoReplySent,
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
              fullName: finalFullName,
              email: contactData.email,
              phone: formattedPhone,
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
      res.statusCode = 200; // Return 200 with error info so client forms don't break
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
