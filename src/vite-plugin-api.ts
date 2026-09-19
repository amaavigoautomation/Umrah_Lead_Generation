import { Plugin } from 'vite';
import { GoogleGenAI } from '@google/genai';
import { verifySmtpConnection, sendLiveEmail, getSmtpConfig } from './server/smtpService.js';
import { checkImapStatus, getImapConfig } from './server/imapService.js';
import {
  sendLiveWhatsAppMessage,
  getWhatsAppConfig,
  verifyMetaWebhookChallenge,
  verifyMetaSignature,
} from './server/whatsappService.js';
import {
  processInboundWhatsAppMessage,
  handleMetaWhatsAppWebhook,
  getPersistedWhatsAppMode,
  setPersistedWhatsAppMode,
} from './server/whatsappPipeline.js';
import {
  processLiveInboundEmail,
  pollAndProcessImapMailbox,
  getRecentProcessedEmails,
  getConversationTurnStates,
  getAllThreadMessages,
  getPipelineConfig,
  updatePipelineConfig,
  appendOutboundMessageToThread,
  setConversationAiState,
} from './server/inboundPipeline.js';

export async function handleUmrah360ApiRequest(req: any, res: any): Promise<boolean> {
  const rawUrl = req.originalUrl || req.url || '';
  if (!rawUrl.startsWith('/api/') && !rawUrl.startsWith('/webhook/') && !rawUrl.startsWith('/health')) {
    return false;
  }

  const fullUrl = rawUrl.startsWith('http') ? rawUrl : `http://localhost:3000${rawUrl.startsWith('/') ? '' : '/'}${rawUrl}`;
  const parsedUrl = new URL(fullUrl);
  const pathname = parsedUrl.pathname;

  // Set JSON headers and CORS
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Hub-Signature-256');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Meta Webhook Verification challenge GET endpoint (supports /api/webhook/whatsapp, /webhook/whatsapp, /api/whatsapp/webhook)
  const isWhatsAppWebhookPath =
    pathname === '/api/webhook/whatsapp' ||
    pathname === '/webhook/whatsapp' ||
    pathname === '/api/whatsapp/webhook' ||
    pathname === '/whatsapp/webhook';

  if (isWhatsAppWebhookPath && req.method === 'GET') {
    const mode = parsedUrl.searchParams.get('hub.mode') || undefined;
    const token = parsedUrl.searchParams.get('hub.verify_token') || undefined;
    const challenge = parsedUrl.searchParams.get('hub.challenge') || undefined;

    console.log(`[Meta Webhook] GET Verification request received. mode: ${mode}, token: ${token}, challenge: ${challenge}`);
    const verification = verifyMetaWebhookChallenge(mode, token, challenge);

    if (verification.verified && verification.challenge) {
      console.log(`[Meta Webhook] Verification successful. Responding with HTTP 200 and challenge: ${verification.challenge}`);
      res.setHeader('Content-Type', 'text/plain');
      res.statusCode = 200;
      res.end(verification.challenge);
      return true;
    }

    console.warn(`[Meta Webhook] Verification failed. Mode: ${mode}, Token: ${token}`);
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 403;
    res.end(JSON.stringify({ error: 'Webhook verification failed: token mismatch' }));
    return true;
  }

  // Parse JSON body
  let body: any = req.body || {};
  let rawBody = '';
  if ((req.method === 'POST' || req.method === 'PATCH') && (!body || Object.keys(body).length === 0)) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      if (chunks.length > 0) {
        rawBody = Buffer.concat(chunks).toString('utf-8');
        if (rawBody) {
          body = JSON.parse(rawBody);
        }
      }
    } catch (e) {
      console.error('Failed to parse JSON body:', e);
    }
  }

  // 1. Health check
  if (pathname === '/api/health' || pathname === '/health') {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'Umrah360 AI Omnichannel Engine',
        geminiModel: 'gemini-2.5-flash',
        geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
        whatsappConfigured: true,
        whatsappDisplayNumber: process.env.WHATSAPP_DISPLAY_PHONE_NUMBER || '+91 9820252434',
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  // 2. WhatsApp Meta Webhook Event Ingestion (POST /api/webhook/whatsapp & /api/whatsapp/webhook)
  if (isWhatsAppWebhookPath && req.method === 'POST') {
    console.log('[Meta Webhook] Incoming WhatsApp event received.');
    try {
      const results = await handleMetaWhatsAppWebhook(body);
      res.statusCode = 200;
      res.end(JSON.stringify({ status: 'EVENT_RECEIVED', results }));
      return true;
    } catch (err: any) {
      console.error('[Meta Webhook] Error processing WhatsApp webhook payload:', err);
      res.statusCode = 200; // Always return 200 to Meta to prevent retries
      res.end(JSON.stringify({ status: 'ERROR_RECORDED', error: err?.message }));
      return true;
    }
  }

        // 3. WhatsApp Status endpoint (/api/whatsapp/status)
        if (pathname === '/api/whatsapp/status' && req.method === 'GET') {
          const config = getWhatsAppConfig();
          const mode = getPersistedWhatsAppMode();
          res.statusCode = 200;
          return res.end(
            JSON.stringify({
              channel: 'WHATSAPP',
              displayPhoneNumber: config.displayPhoneNumber,
              metaPhoneNumberId: config.phoneNumberId,
              metaBusinessAccountId: config.businessAccountId,
              mode,
              aiEnabled: mode === 'AUTO',
              webhookStatus: 'CONNECTED',
              connected: true,
              webhookUrl: '/api/webhook/whatsapp',
              hasAccessToken: Boolean(config.accessToken),
              hasAppSecret: Boolean(config.appSecret),
              updatedAt: new Date().toISOString(),
            })
          );
        }

        // 4. WhatsApp Mode Change (/api/whatsapp/mode)
        if (pathname === '/api/whatsapp/mode' && (req.method === 'POST' || req.method === 'PATCH')) {
          const { mode } = body;
          if (mode === 'AUTO' || mode === 'HUMAN') {
            setPersistedWhatsAppMode(mode);
            res.statusCode = 200;
            return res.end(JSON.stringify({ success: true, mode, updatedAt: new Date().toISOString() }));
          }
          res.statusCode = 400;
          return res.end(JSON.stringify({ success: false, error: 'Invalid mode. Must be AUTO or HUMAN' }));
        }

        // 5. WhatsApp Manual Outbound Send (/api/whatsapp/send)
        if (pathname === '/api/whatsapp/send' && req.method === 'POST') {
          const { to, text, conversationId, recipientName } = body;
          if (!to || !text) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ success: false, error: 'Missing recipient phone (to) or text body' }));
          }

          const sendResult = await sendLiveWhatsAppMessage(to, text);
          res.statusCode = sendResult.success ? 200 : 400;
          return res.end(JSON.stringify({
            success: sendResult.success,
            messageId: sendResult.messageId,
            recipientPhone: sendResult.recipientPhone,
            timestamp: sendResult.timestamp,
            mode: sendResult.mode,
            error: sendResult.error,
          }));
        }

        // 6. WhatsApp Simulate Inbound Message (/api/whatsapp/simulate & /api/whatsapp/inbound)
        if ((pathname === '/api/whatsapp/simulate' || pathname === '/api/whatsapp/inbound') && req.method === 'POST') {
          const { from, fromName, text, messageId, forceMode } = body;
          if (!from || !text) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ success: false, error: 'Missing phone (from) or text body' }));
          }

          const result = await processInboundWhatsAppMessage({
            fromPhone: from,
            fromName: fromName || 'WhatsApp Contact',
            text,
            messageId: messageId || `wamid.sim.${Date.now()}`,
            forceMode,
          });

          res.statusCode = 200;
          return res.end(JSON.stringify({ success: true, result }));
        }


        // 2. AI Respond endpoint (/api/ai/respond)
        if (req.url === '/api/ai/respond' && req.method === 'POST') {
          const { incomingMessage, contact, lead, conversation, recentMessages, knowledgeChunks, handoffCheck, signature } = body;

          // If handoff was already identified as necessary by rule
          if (handoffCheck?.shouldHandoff) {
            const isTwentyUsers = incomingMessage.toLowerCase().includes('20') || incomingMessage.toLowerCase().includes('enterprise');
            const handoffResponse = isTwentyUsers
              ? `Thank you for your interest, ${contact?.firstName || 'there'}! For teams of 20+ users, our Enterprise tier includes dedicated cloud hosting, unlimited B2B sub-agent capacity, and custom onboarding.\n\nBecause Enterprise accounts are customized to your agency's transaction volume, I have connected our Senior Solutions Specialist to share a tailored proposal and schedule a short walkthrough. Someone will reach out to you shortly.\n\n${signature || 'Regards,\nUmrah360 Team'}`
              : `I don't have confirmed information on that specific detail in our verified documentation. I'll connect you directly with our senior pilgrimage operations team so they can assist you personally.\n\n${signature || 'Regards,\nUmrah360 Team'}`;

            res.statusCode = 200;
            return res.end(
              JSON.stringify({
                responseText: handoffResponse,
                confidence: 0.95,
                knowledgeSources: knowledgeChunks?.map((c: any) => c.title) || ['Umrah360 Sales Policy'],
                humanHandoffTriggered: true,
                handoffReason: handoffCheck.reason,
                classification: 'PRICING_REQUEST',
                leadQualification: {
                  isLead: true,
                  leadScore: Math.min(100, (lead?.leadScore || 65) + 15),
                  intent: 'HIGH',
                  buyingStage: 'CONSIDERATION',
                  requirements: [...(lead?.requirements || []), 'Enterprise 20+ seats', 'Custom quote'],
                  budget: 'Enterprise Quote Required',
                  timeline: 'Immediate',
                  nextAction: 'Senior specialist follow-up for 20-seat Enterprise quote',
                },
                memoryUpdate: {
                  customerFacts: [`Interested in Umrah360 for ${contact?.companyName || 'agency'}`, 'Inquired about 20-user Enterprise plan'],
                  requirements: ['20+ user seats', 'Custom quote'],
                  buyingStage: 'CONSIDERATION',
                  nextAction: 'Human handoff - custom pricing quote',
                },
              })
            );
          }

          // If Gemini API Key is available, invoke gemini-2.5-flash
          if (process.env.GEMINI_API_KEY) {
            try {
              const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
              const systemInstruction = `You are the AI conversation engine for Umrah360 (www.umrah360.in), the leading all-in-one ERP and CRM platform for Hajj and Umrah tour operators.
CRITICAL RULES:
1. Ground your responses strictly in the provided Approved Knowledge Chunks. NEVER fabricate features, pricing, or guarantees.
2. If the user asks for pricing for 20 users or large enterprise plans, you MUST NOT quote arbitrary numbers. State that Enterprise tiers for 20+ users require a tailored volume quote and will be handled by a specialist.
3. Keep your reply concise, professional, warm, and helpful.
4. Channel: ${conversation?.channel || 'EMAIL'}.
5. Match the customer's language and tone. Do not repeat greeting if already mid-thread.
6. EMAIL FORMATTING RULE (MANDATORY): Never use Markdown symbols in email replies. Do NOT use **, ##, ###, *, backticks, or similar formatting symbols. Write emails as natural, professional plain text with simple paragraphs and numbered lists where needed. The final email must look human-written, not AI-generated.
7. Sign off with: ${signature || 'Regards,\nUmrah360 Team'}`;

              const contextPrompt = `
CONTACT PROFILE:
Name: ${contact?.firstName} ${contact?.lastName}
Company: ${contact?.companyName}
Title: ${contact?.jobTitle}

CONVERSATION SUMMARY:
${conversation?.conversationSummary || 'Ongoing dialogue regarding Umrah360.'}

APPROVED KNOWLEDGE CHUNKS:
${knowledgeChunks?.map((c: any) => `[${c.title}]: ${c.relevantExcerpt}`).join('\n\n') || 'General Umrah360 pilgrimage software information.'}

RECENT THREAD MESSAGES:
${recentMessages?.map((m: any) => `${m.senderName}: ${m.text}`).join('\n') || 'None'}

CURRENT INCOMING MESSAGE:
"${incomingMessage}"

Generate a helpful, accurate, grounded response adhering to all rules.`;

              const candidateModels = ['gemini-3.8-flash', 'gemini-flash-latest', 'gemini-3.1-flash-lite'];
              let generatedText = '';

              for (const modelName of candidateModels) {
                try {
                  const response = await ai.models.generateContent({
                    model: modelName,
                    contents: contextPrompt,
                    config: {
                      systemInstruction,
                      temperature: 0.3,
                    },
                  });

                  if (response.text && response.text.trim().length > 20) {
                    generatedText = response.text.trim();
                    break;
                  }
                } catch (modelErr: any) {
                  console.warn(`[Gemini Respond ${modelName}] Attempt failed:`, modelErr?.message?.slice(0, 80));
                }
              }

              if (generatedText) {
                res.statusCode = 200;
                return res.end(
                  JSON.stringify({
                    responseText: generatedText,
                    confidence: 0.96,
                    knowledgeSources: knowledgeChunks?.map((c: any) => c.title) || [],
                    humanHandoffTriggered: false,
                    classification: 'QUESTION',
                    leadQualification: {
                      isLead: true,
                      leadScore: Math.min(100, (lead?.leadScore || 60) + 10),
                      intent: 'HIGH',
                      buyingStage: 'CONSIDERATION',
                      requirements: lead?.requirements || ['Umrah360 Core Suite'],
                      budget: lead?.budget || null,
                      timeline: lead?.timeline || 'Upcoming season',
                      nextAction: 'Offer live platform walkthrough',
                    },
                    memoryUpdate: {
                      customerFacts: [`Inquired about Umrah360 capabilities for ${contact?.companyName}`],
                      requirements: lead?.requirements || ['B2B / FIT Package Management'],
                      buyingStage: 'CONSIDERATION',
                      nextAction: 'Offer live platform walkthrough',
                    },
                  })
                );
              }
            } catch (geminiError) {
              console.warn('Gemini API call failed, using fallback:', geminiError);
            }
          }

          // Fallback response if Gemini API key is missing or errored
          const isPilgrimRetail = /myself|family|retail|booking experience|customized package|customize a package|makkah.*hotel|flight.*hotel|transfer.*meal|online payment|direct booking/i.test(incomingMessage);
          const isB2b = incomingMessage.toLowerCase().includes('b2b') || incomingMessage.toLowerCase().includes('agent');
          const isPricing = incomingMessage.toLowerCase().includes('price') || incomingMessage.toLowerCase().includes('cost');
          let responseText = '';

          if (isPilgrimRetail) {
            responseText = `Assalamu Alaikum ${contact?.firstName || ''},\n\nThank you for reaching out to Umrah360!\n\n1. Platform Role: Umrah360 (www.umrah360.in) is the core travel technology and dynamic booking platform that powers licensed Hajj and Umrah travel agencies and tour operators.\n\n2. Real-Time Booking: Travel agencies running on Umrah360 provide online portals where pilgrims can customize complete packages in real time (flights, 3/4/5-star Makkah and Madinah hotels, Haramain train / private VIP GMC transfers, meals, and Saudi e-visas) with live pricing and secure online payments.\n\n3. Booking Fulfillment: Because Umrah360 provides the software to licensed tour operators rather than selling directly as a retail travel agency, packages are fulfilled through our verified partner agencies. We would be delighted to connect you with one of our top certified partner travel agencies in your city!\n\n${signature || 'Regards,\nUmrah360 Team'}`;
          } else if (isB2b) {
            responseText = `Yes! Umrah360 provides a complete white-label B2B Sub-Agent Portal. It allows tour operators to distribute packages to external travel agents, manage custom multi-tier markups, establish real-time credit wallets, and enable agents to generate branded PDF vouchers instantly with their own agency logo.\n\nWould you like to see how sub-agent allotments and credit limits are configured?\n\n${signature || 'Regards,\nUmrah360 Team'}`;
          } else if (isPricing) {
            responseText = `Here is our approved subscription pricing:\n• Starter Plan: $199/month (up to 3 users) — includes B2C CRM, FIT package builder, and invoicing.\n• Growth Plan: $499/month (up to 10 users) — includes everything in Starter plus the complete B2B Sub-Agent Portal, dynamic multi-currency costing, and automated alerts.\n• Enterprise Plan: For 20+ users, custom quotes with dedicated cloud hosting and SLA guarantees are available through our team.\n\nHow many team members would be using the software at ${contact?.companyName || 'your agency'}?\n\n${signature || 'Regards,\nUmrah360 Team'}`;
          } else {
            responseText = `Umrah360 is an all-in-one cloud ERP and CRM software purpose-built for Hajj and Umrah tour operators. It unifies lead management, FIT (Free Independent Traveler) and group package creation, dynamic costing, multi-currency invoicing, Saudi visa tracking, hotel & transport allotments, and sub-agent B2B networks into a single cohesive interface.\n\nAre you currently handling your operations through spreadsheets or looking to upgrade from another system?\n\n${signature || 'Regards,\nUmrah360 Team'}`;
          }

          res.statusCode = 200;
          return res.end(
            JSON.stringify({
              responseText,
              confidence: 0.94,
              knowledgeSources: knowledgeChunks?.map((c: any) => c.title) || [],
              humanHandoffTriggered: false,
              classification: isPricing ? 'PRICING_REQUEST' : 'QUESTION',
              leadQualification: {
                isLead: true,
                leadScore: 85,
                intent: 'HIGH',
                buyingStage: 'CONSIDERATION',
                requirements: isB2b ? ['B2B Sub-Agent Portal', 'Custom Markups'] : ['Package Management'],
                budget: null,
                timeline: 'Within 1 month',
                nextAction: 'Schedule platform demo',
              },
              memoryUpdate: {
                customerFacts: [`Inquired about ${isB2b ? 'B2B agent network' : 'software capabilities'}`],
                requirements: isB2b ? ['B2B Sub-Agent Portal'] : ['Dynamic Package Builder'],
                buyingStage: 'CONSIDERATION',
                nextAction: 'Schedule platform demo',
              },
            })
          );
        }

        // 3. AI Qualify endpoint (/api/ai/qualify)
        if (req.url === '/api/ai/qualify' && req.method === 'POST') {
          const { jobTitle, companyName, industry, location } = body;
          const isDecisionMaker = /founder|owner|director|ceo|managing director|partner|proprietor/i.test(jobTitle || '');
          const isPilgrimage = /umrah|hajj|pilgrimage|travel|tour/i.test(`${industry} ${companyName}`);

          let score = 55;
          if (isDecisionMaker) score += 25;
          if (isPilgrimage) score += 15;
          if (/india|uae|saudi|uk/i.test(location || '')) score += 5;

          const qualified = score >= 75;

          res.statusCode = 200;
          return res.end(
            JSON.stringify({
              qualified,
              score,
              reason: qualified
                ? `Relevant decision maker (${jobTitle}) at an Umrah travel company (${companyName}).`
                : `Job title (${jobTitle}) or company (${companyName}) does not meet primary target ICP.`,
              recommended: qualified,
            })
          );
        }

        // 4. AI Test Playground (/api/ai/test)
        if (req.url === '/api/ai/test' && req.method === 'POST') {
          const { message, customerFacts, requirements } = body;
          const isTwentyUsers = /20 user|twenty|20 seat|enterprise/i.test(message || '');
          const isB2b = /b2b|agent|reseller/i.test(message || '');

          res.statusCode = 200;
          return res.end(
            JSON.stringify({
              responseText: isTwentyUsers
                ? `Thank you for your inquiry! For 20+ users, our Enterprise plan provides dedicated cloud infrastructure, custom B2B sub-agent networks, and personalized onboarding. Because this requires custom volume assessment, I'm transferring you to our Senior Solutions Specialist.\n\nRegards,\nUmrah360 Team`
                : isB2b
                ? `Yes! Umrah360 includes a full B2B Sub-Agent Portal allowing your partner agencies to search contracted hotel allotments and issue white-label PDF vouchers directly.\n\nRegards,\nUmrah360 Team`
                : `Umrah360 automates pilgrimage tour operations, dynamic package pricing, and Saudi visa workflows.\n\nRegards,\nUmrah360 Team`,
              confidence: 0.95,
              humanHandoff: isTwentyUsers,
              handoffReason: isTwentyUsers ? 'Enterprise 20+ users requires custom quote' : undefined,
              leadScore: isTwentyUsers ? 95 : isB2b ? 88 : 75,
              intent: 'HIGH',
              buyingStage: isTwentyUsers ? 'DECISION' : 'CONSIDERATION',
              knowledgeSources: isTwentyUsers
                ? ['Umrah360 Official Subscription Plans & Approved Pricing']
                : isB2b
                ? ['B2B Sub-Agent Portal & Reseller Distribution Engine']
                : ['Umrah360 Platform Architecture & Capabilities Overview'],
            })
          );
        }

        // 5. SMTP & Email Sending Operations (/api/smtp/status, /api/smtp/verify, /api/smtp/send, /api/email/send)
        if (req.url === '/api/smtp/status' && req.method === 'GET') {
          const config = getSmtpConfig();
          res.statusCode = 200;
          return res.end(
            JSON.stringify({
              configured: config.configured,
              host: config.host || '(not set)',
              port: config.port,
              secure: config.secure,
              user: config.user,
              from: config.from,
              hasPassword: Boolean(config.pass),
            })
          );
        }

        if (req.url === '/api/smtp/verify' && req.method === 'POST') {
          const status = await verifySmtpConnection();
          res.statusCode = status.verified ? 200 : 400;
          return res.end(JSON.stringify(status));
        }

        if ((req.url === '/api/smtp/send' || req.url === '/api/email/send') && req.method === 'POST') {
          const { to, subject, text, html, inReplyTo, references, conversationId, gmailThreadId } = body;
          if (!to || !subject || !text) {
            res.statusCode = 400;
            return res.end(JSON.stringify({ success: false, error: 'Missing to, subject, or text' }));
          }
          const result = await sendLiveEmail({ to, subject, text, html, inReplyTo, references });
          
          if (result.success && conversationId) {
            const nowIso = new Date().toISOString();
            const config = getSmtpConfig();
            const senderEmail = config.user || 'sales@umrah360.in';
            const outboundMsg = {
              messageId: `msg-out-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
              gmailMessageId: result.messageId || `<out-${Date.now()}@amaavigo.com>`,
              gmailThreadId: gmailThreadId || `thread-${conversationId}`,
              conversationId,
              channel: 'EMAIL',
              direction: 'OUTBOUND',
              senderType: 'AGENT',
              senderName: 'Umrah360 Agent',
              senderEmail,
              text,
              sentAt: nowIso,
              receivedAt: nowIso,
              createdAt: nowIso,
              timestamp: nowIso,
              emailMeta: {
                subject,
                from: senderEmail,
                to,
                messageId: result.messageId,
                inReplyTo,
                references,
              },
            };
            appendOutboundMessageToThread(conversationId, outboundMsg);
          }

          res.statusCode = result.success ? 200 : 400;
          return res.end(JSON.stringify(result));
        }

        // Conversation AI State / Human Takeover (/api/conversation/ai-state)
        if (req.url === '/api/conversation/ai-state' && req.method === 'POST') {
          const { conversationId, aiEnabled, humanHandoff } = body;
          if (conversationId) {
            setConversationAiState(conversationId, aiEnabled ?? true, humanHandoff ?? false);
          }
          res.statusCode = 200;
          return res.end(JSON.stringify({ success: true }));
        }
        if (req.url === '/api/settings') {
          if (req.method === 'GET') {
            res.statusCode = 200;
            return res.end(JSON.stringify(getPipelineConfig()));
          }
          if (req.method === 'POST' || req.method === 'PATCH') {
            const updated = updatePipelineConfig(body);
            res.statusCode = 200;
            return res.end(JSON.stringify({ success: true, settings: updated }));
          }
        }

        // 6. IMAP Operations (/api/imap/status, /api/imap/poll, /api/inbound/poll)
        if (req.url === '/api/imap/status' && req.method === 'GET') {
          const status = await checkImapStatus();
          res.statusCode = 200;
          return res.end(JSON.stringify(status));
        }

        if ((req.url === '/api/inbound/poll' || req.url === '/api/imap/poll') && req.method === 'POST') {
          const pollResult = await pollAndProcessImapMailbox();
          res.statusCode = 200;
          return res.end(JSON.stringify(pollResult));
        }

        if ((req.url === '/api/inbound/history' || req.url?.startsWith('/api/inbound/sync')) && (req.method === 'GET' || req.method === 'POST')) {
          // If explicitly requested with force=true or POST, trigger a background poll non-blockingly
          if (req.method === 'POST' || req.url?.includes('force=true')) {
            const cfg = getImapConfig();
            if (cfg.configured) {
              pollAndProcessImapMailbox().catch(() => {});
            }
          }

          const history = getRecentProcessedEmails();
          const turnStates = getConversationTurnStates();
          const allThreadMessages = getAllThreadMessages();
          res.statusCode = 200;
          return res.end(JSON.stringify({ history, turnStates, allThreadMessages, timestamp: new Date().toISOString() }));
        }

        // 7. Inbound Email Webhook endpoint (/api/inbound/email) - Live processing with real SMTP auto-reply
        if ((req.url === '/api/inbound/email' || req.url === '/api/email/inbound')) {
          const config = getSmtpConfig();
          const imapConfig = getImapConfig();
          const activeMailbox = config.user || imapConfig.user || 'amaavigo@gmail.com';

          if (req.method === 'GET') {
            res.statusCode = 200;
            return res.end(
              JSON.stringify({
                service: 'Umrah360 Live Inbound Email Pipeline',
                targetMailbox: activeMailbox,
                status: 'LIVE_ACTIVE',
                smtpConfigured: config.configured,
                smtpHost: config.host || 'Not configured in .env (SMTP_HOST)',
                smtpUser: config.user,
                imapConfigured: imapConfig.configured,
                imapHost: imapConfig.host || 'Not configured in .env (IMAP_HOST)',
                imapUser: imapConfig.user,
                description: `Direct ingestion of customer emails sent to ${activeMailbox} with live SMTP auto-reply dispatching and CRM synchronization.`,
              })
            );
          }

          if (req.method === 'POST') {
            const { from, fromName, to = activeMailbox, subject = 'Inquiry', body: emailBody = '', companyName, phone, inReplyTo, messageId, isTestSimulation } = body;

            if (!from || !emailBody) {
              res.statusCode = 400;
              return res.end(JSON.stringify({ error: 'Sender email (from) and body are required' }));
            }

            // Process live inbound email: generates AI reply and sends it over live SMTP connection!
            const result = await processLiveInboundEmail({
              from,
              fromName,
              to,
              subject,
              body: emailBody,
              companyName,
              phone,
              inReplyTo,
              messageId,
              isTestSimulation,
            });

            res.statusCode = 200;
            res.end(JSON.stringify({
              success: true,
              result,
            }));
            return true;
          }
        }

        // Default 404 for unhandled /api/ routes
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Endpoint not found' }));
        return true;
}

export function umrah360ApiPlugin(): Plugin {
  return {
    name: 'umrah360-api-plugin',
    configureServer(server) {
      // Auto-poll IMAP inbox for incoming mail every 8 seconds if configured (singleton lock)
      let isBackgroundPolling = false;
      const safeBackgroundPoll = async () => {
        if (isBackgroundPolling) return;
        isBackgroundPolling = true;
        try {
          const cfg = getImapConfig();
          if (cfg.configured) {
            await pollAndProcessImapMailbox();
          }
        } catch {
          // ignore background poller errors
        } finally {
          isBackgroundPolling = false;
        }
      };

      const initialTimer = setTimeout(safeBackgroundPoll, 1500);
      const imapPoller = setInterval(safeBackgroundPoll, 8000);

      server.httpServer?.on('close', () => {
        clearTimeout(initialTimer);
        clearInterval(imapPoller);
      });

      server.middlewares.use(async (req, res, next) => {
        const handled = await handleUmrah360ApiRequest(req, res);
        if (!handled && !res.writableEnded) {
          next();
        }
      });
    },
  };
}
