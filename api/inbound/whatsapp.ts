import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Production-Ready, Zero-Dependency Vercel Serverless Function for Meta WhatsApp Webhook
 * Route: /api/inbound/whatsapp
 * 
 * - Handles Meta's GET verification handshake instantly (hub.challenge & hub.verify_token)
 * - Handles Meta's POST incoming messages, generates AI response with Gemini, and auto-replies via Meta Cloud API
 */

const TARGET_WHATSAPP_NUMBER = '+919820252434';
const DEFAULT_VERIFY_TOKEN = 'umrah360_webhook_token';

// Knowledge base for grounded Umrah360 AI responses
const UMRAH360_SYSTEM_PROMPT = `You are the AI conversation assistant for Umrah360 (www.umrah360.in), the leading all-in-one ERP and CRM software purpose-built for Hajj and Umrah tour operators.
CRITICAL RULES:
1. Ground your responses strictly in verified Umrah360 capabilities:
   - Umrah360 is B2B / B2C pilgrimage software for travel agencies (FIT package builder, Saudi visa tracking, hotel allotments in Makkah & Madinah, Haramain train / private GMC transport, dynamic costing, and white-label B2B Sub-Agent portals).
   - Starter Plan: $199/month (up to 3 users)
   - Growth Plan: $499/month (up to 10 users)
   - Enterprise Plan: For teams with 20+ users, custom quotes with dedicated cloud hosting and SLA guarantees are provided. You MUST NOT quote arbitrary numbers for 20+ users. State that an Enterprise Specialist will provide a tailored quote.
2. Keep replies concise, helpful, and formatted naturally for WhatsApp (short paragraphs, professional tone).
3. Do NOT use markdown symbols like **, ##, or bullet hashes. Write clean, natural text suitable for WhatsApp mobile chats.
4. Sign off with:
Regards,
Umrah360 Team`;

export default async function handler(req: IncomingMessage & { body?: any; query?: any }, res: ServerResponse) {
  // CORS & standard headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // =========================================================================
  // 1. Meta Webhook Verification Handshake (GET)
  // =========================================================================
  if (req.method === 'GET') {
    try {
      // In Vercel, req.url contains full query string (e.g., /api/inbound/whatsapp?hub.mode=subscribe&...)
      const requestUrl = req.url || '';
      const dummyBase = 'https://leadgeneration-sable.vercel.app';
      const parsedUrl = new URL(requestUrl.startsWith('/') ? `${dummyBase}${requestUrl}` : requestUrl);

      const mode = parsedUrl.searchParams.get('hub.mode') || parsedUrl.searchParams.get('hub_mode');
      const verifyToken =
        parsedUrl.searchParams.get('hub.verify_token') ||
        parsedUrl.searchParams.get('hub_verify_token') ||
        parsedUrl.searchParams.get('verify_token');
      const challenge =
        parsedUrl.searchParams.get('hub.challenge') ||
        parsedUrl.searchParams.get('hub_challenge') ||
        parsedUrl.searchParams.get('challenge');

      const expectedToken =
        process.env.META_WEBHOOK_VERIFY_TOKEN ||
        process.env.WHATSAPP_VERIFY_TOKEN ||
        DEFAULT_VERIFY_TOKEN;

      console.log(`[WhatsApp Webhook GET] Mode: ${mode}, Token: ${verifyToken}, Challenge present: ${Boolean(challenge)}`);

      // If Meta sends a verifyToken, validate it
      if (verifyToken && verifyToken !== expectedToken) {
        console.warn(`[WhatsApp Webhook GET] Token mismatch: expected "${expectedToken}", got "${verifyToken}"`);
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        return res.end('Forbidden: Invalid verification token');
      }

      // If challenge parameter exists, return it directly as plain text (Required by Meta)
      if (challenge) {
        console.log(`[WhatsApp Webhook GET] Responding with Meta challenge: ${challenge}`);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        return res.end(challenge);
      }

      // Health / Status ping
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          status: 'online',
          service: 'Umrah360 WhatsApp Webhook Engine',
          targetNumber: TARGET_WHATSAPP_NUMBER,
          metaConfigured: Boolean(process.env.META_ACCESS_TOKEN && process.env.META_PHONE_NUMBER_ID),
          geminiConfigured: Boolean(process.env.GEMINI_API_KEY),
          timestamp: new Date().toISOString(),
        })
      );
    } catch (err: any) {
      console.error('[WhatsApp Webhook GET Error]:', err);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('OK');
    }
  }

  // =========================================================================
  // 2. Incoming WhatsApp Message Ingestion & Auto-Reply (POST)
  // =========================================================================
  if (req.method === 'POST') {
    try {
      // Parse body if not pre-parsed by Vercel
      let body = req.body;
      if (!body) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (raw) {
          try {
            body = JSON.parse(raw);
          } catch {
            body = {};
          }
        }
      }
      if (!body) body = {};

      console.log('[WhatsApp Webhook POST] Received payload:', JSON.stringify(body).slice(0, 300));

      // Extract message from Meta Cloud API payload
      const entry = body.entry?.[0];
      const change = entry?.changes?.[0];
      const value = change?.value;
      const incomingMsg = value?.messages?.[0];

      if (!incomingMsg) {
        // May be a status receipt (delivered, read, sent) or test ping
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ success: true, message: 'Event acknowledged' }));
      }

      const senderPhone = incomingMsg.from; // e.g. "919820252434"
      const messageText = incomingMsg.text?.body || (incomingMsg.type === 'button' ? incomingMsg.button?.text : '') || '';
      const messageId = incomingMsg.id;
      const senderName = value?.contacts?.[0]?.profile?.name || 'Pilgrim';
      const metadataPhoneId = value?.metadata?.phone_number_id || process.env.META_PHONE_NUMBER_ID;

      console.log(`[WhatsApp Inbound] Message from +${senderPhone} (${senderName}): "${messageText}"`);

      // Generate AI Response
      let replyText = '';
      const isTwentyUsers = /20 user|twenty|20 seat|enterprise/i.test(messageText);
      const isPricing = /price|cost|rate|pricing|subscription|quote/i.test(messageText);

      if (isTwentyUsers) {
        replyText = `Thank you for your inquiry, ${senderName}!\n\nFor teams of 20+ users, our Enterprise tier provides dedicated cloud hosting, custom B2B sub-agent capacity, dynamic volume pricing, and SLA guarantees.\n\nBecause Enterprise accounts are customized to your agency's transaction volume, I have connected our Senior Solutions Specialist to provide a tailored proposal. Someone will reach out to you shortly.\n\nRegards,\nUmrah360 Team`;
      } else if (process.env.GEMINI_API_KEY) {
        try {
          const geminiUrl = `https://generativelanguage.googleapis.com/v1beta/models/gemini-2.5-flash:generateContent?key=${process.env.GEMINI_API_KEY}`;
          const geminiPayload = {
            contents: [
              {
                role: 'user',
                parts: [
                  {
                    text: `${UMRAH360_SYSTEM_PROMPT}\n\nIncoming WhatsApp message from ${senderName} (+${senderPhone}):\n"${messageText}"\n\nGenerate a helpful, grounded response:`,
                  },
                ],
              },
            ],
            generationConfig: {
              temperature: 0.3,
              maxOutputTokens: 500,
            },
          };

          const geminiRes = await fetch(geminiUrl, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(geminiPayload),
          });

          if (geminiRes.ok) {
            const geminiData: any = await geminiRes.json();
            replyText = geminiData.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
          } else {
            console.warn('[Gemini Call Failed]:', await geminiRes.text());
          }
        } catch (geminiErr) {
          console.error('[Gemini Exception]:', geminiErr);
        }
      }

      // Fallback response if Gemini wasn't available
      if (!replyText) {
        if (isPricing) {
          replyText = `Assalamu Alaikum ${senderName},\n\nHere are our official Umrah360 subscription tiers:\n• Starter Plan: $199/month (up to 3 users) - includes B2C CRM, FIT package builder, and invoicing.\n• Growth Plan: $499/month (up to 10 users) - includes full B2B Sub-Agent Portal, dynamic multi-currency costing, and automated alerts.\n• Enterprise Plan: For 20+ users, custom volume pricing with dedicated infrastructure.\n\nHow many team members would be using the system at your agency?\n\nRegards,\nUmrah360 Team`;
        } else {
          replyText = `Assalamu Alaikum ${senderName},\n\nThank you for contacting Umrah360 (www.umrah360.in)!\n\nUmrah360 is an all-in-one cloud ERP and CRM platform purpose-built for Hajj and Umrah tour operators. It unifies lead management, FIT and group package creation, dynamic costing, Saudi visa tracking, and sub-agent B2B networks into a single interface.\n\nAre you currently handling your operations through spreadsheets or looking to upgrade from another system?\n\nRegards,\nUmrah360 Team`;
        }
      }

      // Dispatch Outbound WhatsApp Message via Meta Cloud API
      const metaToken = process.env.META_ACCESS_TOKEN || process.env.WHATSAPP_API_TOKEN;
      const phoneId = metadataPhoneId || process.env.META_PHONE_NUMBER_ID;

      if (metaToken && phoneId && senderPhone) {
        const cleanRecipient = senderPhone.replace(/[^0-9]/g, '');
        console.log(`[WhatsApp Outbound] Sending reply to +${cleanRecipient} via Meta Cloud API...`);

        const sendRes = await fetch(`https://graph.facebook.com/v21.0/${phoneId}/messages`, {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${metaToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            messaging_product: 'whatsapp',
            recipient_type: 'individual',
            to: cleanRecipient,
            type: 'text',
            text: {
              preview_url: false,
              body: replyText,
            },
          }),
        });

        const sendData: any = await sendRes.json();
        console.log('[WhatsApp Outbound Result]:', sendData);
      } else {
        console.warn('[WhatsApp Outbound] Skipping live dispatch - missing META_ACCESS_TOKEN or META_PHONE_NUMBER_ID');
      }

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          success: true,
          replied: Boolean(replyText),
          replyText,
          senderPhone,
        })
      );
    } catch (postErr: any) {
      console.error('[WhatsApp Webhook POST Error]:', postErr);
      // Return 200 so Meta doesn't redundantly retry
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ success: false, error: postErr?.message }));
    }
  }

  res.statusCode = 405;
  res.end('Method Not Allowed');
}
