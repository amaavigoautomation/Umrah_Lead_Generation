import { GoogleGenAI } from '@google/genai';
import { verifySmtpConnection, sendLiveEmail, getSmtpConfig, updateSmtpConfig } from './smtpService.js';
import { checkImapStatus, getImapConfig, updateImapConfig } from './imapService.js';
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
} from './inboundPipeline.js';
import {
  processLiveInboundWhatsApp,
  getRecentProcessedWhatsAppMessages,
  getWhatsAppTurnStates,
  getWhatsAppPipelineConfig,
  updateWhatsAppPipelineConfig,
  getWhatsAppGatewayStatus,
  TARGET_WHATSAPP_NUMBER,
  TARGET_WHATSAPP_NUMBER_DISPLAY,
} from './whatsappInboundPipeline.js';
import {
  initCampaignStore,
  getAllCampaigns,
  getCampaignById,
  getCampaignLeads,
  getCampaignRuns,
  createCampaign,
  startCampaign,
  pauseCampaign,
  restartCampaign,
  getAllTemplates,
  getTemplatesFromDbOrCache,
  getTemplateById,
  getTemplateFromDbById,
  saveTemplate,
  deleteTemplate,
  deleteCampaign,
  updateLeadDemoStatus,
  updateCampaignLeadStatus,
  generateAiEmailForLead,
  generateAiSamplePreviews,
} from './campaignService.js';
import { processWebsiteLeadSubmission } from './websiteLeadService.js';
import {
  initKnowledgeStore,
  getAllKnowledgeDocs,
  getPublishedKnowledgeDocs,
  saveKnowledgeDoc,
  deleteKnowledgeDoc,
  retrieveRelevantKnowledge as serverRetrieveKnowledge,
} from './knowledgeService.js';

/**
 * Universal API request handler that works in both:
 * 1. Vite Development Server (via connect middleware in vite-plugin-api.ts)
 * 2. Vercel Production Serverless Functions (via api/index.ts or api/inbound/whatsapp.ts)
 */
export async function handleCoreApi(req: any, res: any): Promise<boolean> {
  // Normalize URL and Pathname
  const rawUrl = req.url || '';
  let pathname = rawUrl;
  try {
    const parsed = new URL(rawUrl.startsWith('/') ? 'http://localhost' + rawUrl : rawUrl);
    pathname = parsed.pathname;
  } catch {
    pathname = rawUrl.split('?')[0];
  }

  if (!pathname.startsWith('/api/') && pathname !== '/api') {
    const cleanPath = pathname.startsWith('/') ? pathname : '/' + pathname;
    pathname = '/api' + cleanPath;
  }

  if (pathname.length > 4 && pathname.endsWith('/')) {
    pathname = pathname.slice(0, -1);
  }

  let url = pathname;

  // Set standard API headers and CORS
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Parse JSON body if not pre-parsed
  let body: any = req.body;
  if (!body && (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT')) {
    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
      }
      const rawBody = Buffer.concat(chunks).toString('utf-8');
      if (rawBody) {
        try {
          body = JSON.parse(rawBody);
        } catch {
          // If not standard JSON, parse as urlencoded form data
          try {
            const params = new URLSearchParams(rawBody);
            const formObj: Record<string, any> = {};
            params.forEach((val, key) => {
              formObj[key] = val;
            });
            if (Object.keys(formObj).length > 0) {
              body = formObj;
            }
          } catch {
            // unable to parse form
          }
        }
      }
    } catch (e) {
      // Body parse error
    }
  }
  if (!body) body = {};

  // 1. Health check
  if (url === '/api/health' || url.startsWith('/api/health?')) {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'Umrah360 AI Omnichannel Engine',
        geminiModel: 'gemini-3.8-flash',
        geminiKeyPresent: Boolean(process.env.GEMINI_API_KEY),
        whatsAppGateway: getWhatsAppGatewayStatus(),
        websiteWebhook: {
          endpoint: '/api/webhooks/umrah-demo',
          status: 'ready',
        },
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  // 1.5. Website Inbound Demo Lead Webhook (/api/webhooks/umrah-demo, /api/leads/webhook, /api/leads/inbound)
  const isWebsiteWebhook =
    url === '/api/webhooks/umrah-demo' ||
    url.startsWith('/api/webhooks/umrah-demo?') ||
    url === '/api/leads/webhook' ||
    url.startsWith('/api/leads/webhook?') ||
    url === '/api/leads/inbound' ||
    url.startsWith('/api/leads/inbound?');

  if (isWebsiteWebhook) {
    if (req.method === 'POST') {
      try {
        console.log('[Inbound Webhook] Received website demo request from umrah360.in:', {
          name: body.fullName || body.name || body.your_full_name,
          email: body.email || body.your_email,
          company: body.companyName || body.company_name || body.company,
          phone: body.phone || body.phoneNumber,
        });

        const result = await processWebsiteLeadSubmission(body);
        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return true;
      } catch (err: any) {
        console.error('[Inbound Webhook] Error processing lead submission:', err);
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            success: false,
            error: err?.message || 'Failed to process website lead submission',
          })
        );
        return true;
      }
    } else if (req.method === 'GET') {
      // Documentation & schema check for developers or webhook monitors
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          service: 'Umrah360 Website Demo Lead Ingestion Webhook',
          status: 'active',
          acceptedMethods: ['POST'],
          description: 'Directly pushes leads from umrah360.in/request-demo form into Firestore DB and CRM pipeline',
          supportedFields: {
            yourDetails: ['fullName (or name, your_full_name)', 'email', 'designation', 'country', 'phone (or phoneNumber)', 'city'],
            aboutYourCompany: ['companyName (or company)', 'website (or companyWebsite)', 'branches (Yes / No)'],
            product: ['product (or select_products, productInterest)', 'teamSize (e.g. 5-10, 10-20, 20+)'],
            messageQuery: ['message (or query, notes)'],
          },
          samplePayload: {
            fullName: 'Mohammad Al-Bakhla',
            email: 'demo@bakhlatours.com',
            designation: 'Managing Director',
            country: 'India',
            phone: '+91 9820252434',
            city: 'Mumbai',
            companyName: 'Bakhla Tours & Travels Pvt. Ltd.',
            website: 'https://bakhlatours.com',
            branches: 'Yes',
            product: 'Umrah ERP & B2B Sub-Agent Portal',
            teamSize: '10-20',
            message: 'We handle 3,500 pilgrims yearly. Interested in B2B booking engine.',
          },
        })
      );
      return true;
    }
  }

  // 2. AI Respond endpoint (/api/ai/respond)
  if ((url === '/api/ai/respond' || url.startsWith('/api/ai/respond?')) && req.method === 'POST') {
    const { incomingMessage, contact, lead, conversation, recentMessages, knowledgeChunks, handoffCheck, signature } = body;

    // If handoff was already identified as necessary by rule
    if (handoffCheck?.shouldHandoff) {
      const isTwentyUsers = incomingMessage?.toLowerCase().includes('20') || incomingMessage?.toLowerCase().includes('enterprise');
      const handoffResponse = isTwentyUsers
        ? `Thank you for your interest, ${contact?.firstName || 'there'}! For teams of 20+ users, our Enterprise tier includes dedicated cloud hosting, unlimited B2B sub-agent capacity, and custom onboarding.\n\nBecause Enterprise accounts are customized to your agency's transaction volume, I have connected our Senior Solutions Specialist to share a tailored proposal and schedule a short walkthrough. Someone will reach out to you shortly.\n\n${signature || 'Regards,\nUmrah360 Team'}`
        : `I don't have confirmed information on that specific detail in our verified documentation. I'll connect you directly with our senior pilgrimage operations team so they can assist you personally.\n\n${signature || 'Regards,\nUmrah360 Team'}`;

      res.statusCode = 200;
      res.end(
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
      return true;
    }

    // If Gemini API Key is available, invoke gemini-3.8-flash
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
          res.end(
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
          return true;
        }
      } catch (geminiError) {
        console.warn('Gemini API call failed, using fallback:', geminiError);
      }
    }

    // Fallback response if Gemini API key is missing or errored
    const isPilgrimRetail = /myself|family|retail|booking experience|customized package|customize a package|makkah.*hotel|flight.*hotel|transfer.*meal|online payment|direct booking/i.test(incomingMessage || '');
    const isB2b = incomingMessage?.toLowerCase().includes('b2b') || incomingMessage?.toLowerCase().includes('agent');
    const isPricing = incomingMessage?.toLowerCase().includes('price') || incomingMessage?.toLowerCase().includes('cost');
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
    res.end(
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
    return true;
  }

  // 3. AI Qualify endpoint (/api/ai/qualify)
  if ((url === '/api/ai/qualify' || url.startsWith('/api/ai/qualify?')) && req.method === 'POST') {
    const { jobTitle, companyName, industry, location } = body;
    const isDecisionMaker = /founder|owner|director|ceo|managing director|partner|proprietor/i.test(jobTitle || '');
    const isPilgrimage = /umrah|hajj|pilgrimage|travel|tour/i.test(`${industry} ${companyName}`);

    let score = 55;
    if (isDecisionMaker) score += 25;
    if (isPilgrimage) score += 15;
    if (/india|uae|saudi|uk/i.test(location || '')) score += 5;

    const qualified = score >= 75;

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        qualified,
        score,
        reason: qualified
          ? `Relevant decision maker (${jobTitle}) at an Umrah travel company (${companyName}).`
          : `Job title (${jobTitle}) or company (${companyName}) does not meet primary target ICP.`,
        recommended: qualified,
      })
    );
    return true;
  }

  // 4. Knowledge Base CRUD & Synchronization (/api/knowledge)
  if (url === '/api/knowledge' || url.startsWith('/api/knowledge?') || url.startsWith('/api/knowledge/')) {
    await initKnowledgeStore();

    if (req.method === 'GET') {
      const documents = getAllKnowledgeDocs();
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, documents, count: documents.length }));
      return true;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const saved = await saveKnowledgeDoc(body);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, document: saved, message: 'Article successfully saved and active in RAG' }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to save knowledge document' }));
      }
      return true;
    }

    if (req.method === 'DELETE') {
      let docId = '';
      const pathMatch = url.match(/^\/api\/knowledge\/([a-zA-Z0-9_-]+)$/);
      if (pathMatch) {
        docId = pathMatch[1];
      } else if (url.includes('?')) {
        const parsedUrl = new URL(url, 'http://localhost');
        docId = parsedUrl.searchParams.get('id') || '';
      }
      if (!docId && body?.id) {
        docId = body.id;
      }

      if (!docId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'Knowledge document ID required' }));
        return true;
      }

      const deleted = await deleteKnowledgeDoc(docId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: deleted, deletedId: docId }));
      return true;
    }
  }

  // 4.5. AI Test Playground (/api/ai/test)
  if ((url === '/api/ai/test' || url.startsWith('/api/ai/test?')) && req.method === 'POST') {
    const { message, contact, lead, conversation, signature } = body;
    const isTwentyUsers = /20 user|twenty|20 seat|enterprise/i.test(message || '');
    const isB2b = /b2b|agent|reseller|wholesaler/i.test(message || '');

    // Retrieve live grounded chunks from memory cache (0ms)
    const chunks = serverRetrieveKnowledge(message || '', 3);
    const knowledgeSources = chunks.map((c) => c.title);

    if (isTwentyUsers) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          responseText: `Thank you for your inquiry! For 20+ users, our Enterprise plan provides dedicated cloud infrastructure, custom B2B sub-agent networks, and personalized onboarding. Because this requires custom volume assessment, I'm transferring you to our Senior Solutions Specialist.\n\n${signature || 'Regards,\nUmrah360 Team'}`,
          confidence: 0.96,
          humanHandoff: true,
          handoffReason: 'Enterprise 20+ users requires custom volume quote',
          leadScore: 95,
          intent: 'HIGH',
          buyingStage: 'DECISION',
          knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : ['Umrah360 Official Subscription Plans & Approved Pricing'],
        })
      );
      return true;
    }

    if (process.env.GEMINI_API_KEY) {
      try {
        const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });
        const systemInstruction = `You are the AI conversation engine for Umrah360 (www.umrah360.in).
CRITICAL RULES:
1. Ground your response strictly in the provided Approved Knowledge Chunks. NEVER fabricate features, pricing, or guarantees.
2. Keep your reply concise, professional, warm, and helpful.
3. Plain text only. No markdown formatting symbols in emails.
4. Sign off with: ${signature || 'Regards,\nUmrah360 Team'}`;

        const prompt = `APPROVED KNOWLEDGE CHUNKS:
${chunks.map((c) => `[${c.title}]: ${c.relevantExcerpt}`).join('\n\n')}

CUSTOMER MESSAGE:
"${message}"

Generate a helpful, grounded response.`;

        const response = await ai.models.generateContent({
          model: 'gemini-3.8-flash',
          contents: prompt,
          config: { systemInstruction, temperature: 0.3 },
        });

        if (response.text && response.text.trim().length > 10) {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              responseText: response.text.trim(),
              confidence: 0.96,
              humanHandoff: false,
              leadScore: isB2b ? 88 : 80,
              intent: 'HIGH',
              buyingStage: 'CONSIDERATION',
              knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : ['Umrah360 Platform Knowledge Base'],
            })
          );
          return true;
        }
      } catch (e) {
        console.warn('AI Test playground Gemini fallback:', e);
      }
    }

    // Dynamic grounded fallback
    let responseText = '';
    if (chunks.length > 0) {
      responseText = `Based on Umrah360's verified documentation:\n\n${chunks[0].relevantExcerpt}\n\nPlease let us know if you would like a guided demo or specific details for your agency.\n\n${signature || 'Regards,\nUmrah360 Team'}`;
    } else if (isB2b) {
      responseText = `Yes! Umrah360 includes a full B2B Sub-Agent Portal allowing your partner agencies to search contracted hotel allotments and issue white-label PDF vouchers directly.\n\n${signature || 'Regards,\nUmrah360 Team'}`;
    } else {
      responseText = `Umrah360 automates pilgrimage tour operations, dynamic package pricing, and Saudi visa workflows.\n\n${signature || 'Regards,\nUmrah360 Team'}`;
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        responseText,
        confidence: 0.94,
        humanHandoff: false,
        leadScore: isB2b ? 88 : 75,
        intent: 'HIGH',
        buyingStage: 'CONSIDERATION',
        knowledgeSources,
      })
    );
    return true;
  }

  // 5. SMTP & Email Sending Operations
  if (url === '/api/smtp/config') {
    if (req.method === 'GET') {
      const config = getSmtpConfig();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          configured: config.configured,
          host: config.host || '',
          port: config.port,
          secure: config.secure,
          user: config.user,
          from: config.from,
          hasPassword: Boolean(config.pass),
        })
      );
      return true;
    } else if (req.method === 'POST') {
      const updated = updateSmtpConfig({
        host: body.host,
        port: body.port ? parseInt(body.port, 10) : undefined,
        secure: body.secure,
        user: body.user,
        pass: body.pass,
        from: body.from,
      });
      // Also update IMAP password if same user
      if (body.pass) {
        updateImapConfig({
          user: body.user || updated.user,
          pass: body.pass,
        });
      }
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          configured: updated.configured,
          host: updated.host,
          port: updated.port,
          user: updated.user,
          hasPassword: Boolean(updated.pass),
        })
      );
      return true;
    }
  }

  if (url === '/api/smtp/status' && req.method === 'GET') {
    const config = getSmtpConfig();
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        configured: config.configured,
        host: config.host || '(not set)',
        port: config.port,
        secure: config.secure,
        user: config.user,
        from: config.from,
        passConfigured: Boolean(config.pass),
        hasPassword: Boolean(config.pass),
      })
    );
    return true;
  }

  if (url === '/api/smtp/verify' && req.method === 'POST') {
    const result = await verifySmtpConnection();
    res.statusCode = result.verified ? 200 : 400;
    res.end(JSON.stringify({ success: result.verified, ...result }));
    return true;
  }

  if ((url === '/api/smtp/send' || url === '/api/email/send') && req.method === 'POST') {
    const { to, subject, html, text, inReplyTo, conversationId, leadId, senderName } = body;
    if (!to || !subject || (!html && !text)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'Missing to, subject, or message body' }));
      return true;
    }

    const sendResult = await sendLiveEmail({
      to,
      subject,
      html,
      text,
      inReplyTo,
    });

    if (sendResult.success) {
      if (conversationId) {
        appendOutboundMessageToThread(conversationId, {
          text: text || (html ? html.replace(/<[^>]*>?/gm, '') : ''),
          to,
          subject,
          externalMessageId: sendResult.messageId,
          senderName: senderName || 'Umrah360 AI',
        });
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, messageId: sendResult.messageId }));
      return true;
    } else {
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: sendResult.error }));
      return true;
    }
  }

  // 6. IMAP Operations
  if (url === '/api/imap/config') {
    if (req.method === 'GET') {
      const config = getImapConfig();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          configured: config.configured,
          host: config.host || '',
          port: config.port,
          secure: config.secure,
          user: config.user,
          hasPassword: Boolean(config.pass),
        })
      );
      return true;
    } else if (req.method === 'POST') {
      const updated = updateImapConfig({
        host: body.host,
        port: body.port ? parseInt(body.port, 10) : undefined,
        secure: body.secure,
        user: body.user,
        pass: body.pass,
      });
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          configured: updated.configured,
          host: updated.host,
          port: updated.port,
          user: updated.user,
          hasPassword: Boolean(updated.pass),
        })
      );
      return true;
    }
  }
  if (url === '/api/imap/status' && req.method === 'GET') {
    const config = getImapConfig();
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        configured: config.configured,
        host: config.host || '(not set)',
        port: config.port,
        secure: config.secure,
        user: config.user,
        passConfigured: Boolean(config.pass),
      })
    );
    return true;
  }

  if (url === '/api/imap/verify' && req.method === 'POST') {
    const result = await checkImapStatus();
    res.statusCode = result.verified ? 200 : 400;
    res.end(JSON.stringify({ success: result.verified, ...result }));
    return true;
  }

  if (url === '/api/imap/poll' && req.method === 'POST') {
    const result = await pollAndProcessImapMailbox();
    res.statusCode = result.success ? 200 : 500;
    res.end(JSON.stringify(result));
    return true;
  }

  // 7. Inbound Email Webhook
  if (url === '/api/inbound/history' && req.method === 'GET') {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        history: getRecentProcessedEmails(),
        turnStates: getConversationTurnStates(),
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  if (url === '/api/inbound/config') {
    if (req.method === 'GET') {
      res.statusCode = 200;
      res.end(JSON.stringify(getPipelineConfig()));
      return true;
    }
    if (req.method === 'POST' || req.method === 'PATCH') {
      const updated = updatePipelineConfig(body);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, config: updated }));
      return true;
    }
  }

  if (url === '/api/inbound/email' && req.method === 'POST') {
    const { from, fromName, to, subject, body: emailBody, companyName, phone, inReplyTo, messageId, isTestSimulation } = body;

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
    res.end(JSON.stringify({ success: true, result }));
    return true;
  }

  // 8. Meta WhatsApp Cloud API Webhook Handshake & Message Ingestion
  if (
    url.startsWith('/api/inbound/whatsapp') ||
    url.startsWith('/api/whatsapp/inbound') ||
    url.startsWith('/api/whatsapp/webhook') ||
    url.startsWith('/api/whatsapp/status')
  ) {
    // Meta WhatsApp Cloud API verification handshake (GET with hub.challenge or hub.mode)
    if (
      req.method === 'GET' &&
      (url.includes('hub.challenge') ||
        url.includes('hub_challenge') ||
        url.includes('hub.mode') ||
        url.includes('hub_mode'))
    ) {
      const parsedUrl = new URL(url, 'http://localhost:3000');
      const mode = parsedUrl.searchParams.get('hub.mode') || parsedUrl.searchParams.get('hub_mode');
      const verifyToken =
        parsedUrl.searchParams.get('hub.verify_token') || parsedUrl.searchParams.get('hub_verify_token');
      const challenge =
        parsedUrl.searchParams.get('hub.challenge') || parsedUrl.searchParams.get('hub_challenge');
      const expectedToken =
        process.env.META_WEBHOOK_VERIFY_TOKEN ||
        process.env.WHATSAPP_VERIFY_TOKEN ||
        'umrah360_webhook_token';

      if (verifyToken && verifyToken !== expectedToken) {
        console.warn('[WhatsApp Webhook] Invalid verify_token provided by Meta:', verifyToken);
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Forbidden: Invalid verification token');
        return true;
      }

      console.log('[WhatsApp Webhook] Meta challenge verification succeeded. Responding with challenge:', challenge);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end(challenge || 'ok');
      return true;
    }

    if (url === '/api/inbound/whatsapp/status' || url === '/api/whatsapp/status' || url.startsWith('/api/whatsapp/status?')) {
      const gateway = getWhatsAppGatewayStatus();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          targetNumber: TARGET_WHATSAPP_NUMBER,
          formattedNumber: TARGET_WHATSAPP_NUMBER_DISPLAY,
          gateway,
          timestamp: new Date().toISOString(),
        })
      );
      return true;
    }

    if (url === '/api/inbound/whatsapp/history' || url.startsWith('/api/whatsapp/history')) {
      const history = getRecentProcessedWhatsAppMessages();
      const turnStates = getWhatsAppTurnStates();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          targetNumber: TARGET_WHATSAPP_NUMBER,
          formattedNumber: TARGET_WHATSAPP_NUMBER_DISPLAY,
          history,
          turnStates,
          timestamp: new Date().toISOString(),
        })
      );
      return true;
    }

    if (url === '/api/inbound/whatsapp/config') {
      if (req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify(getWhatsAppPipelineConfig()));
        return true;
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const updated = updateWhatsAppPipelineConfig(body);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, config: updated }));
        return true;
      }
    }

    if (req.method === 'GET') {
      const cfg = getWhatsAppPipelineConfig();
      const gateway = getWhatsAppGatewayStatus();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          service: 'Umrah360 Inbound WhatsApp Webhook',
          status: 'online',
          targetNumber: TARGET_WHATSAPP_NUMBER,
          formattedNumber: TARGET_WHATSAPP_NUMBER_DISPLAY,
          gateway,
          config: cfg,
        })
      );
      return true;
    }

    // Process POST WhatsApp message
    if (req.method === 'POST') {
      const result = await processLiveInboundWhatsApp(body);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
      return true;
    }
  }

  // 9. Campaign Management Endpoints
  // Templates endpoints (supports both /api/templates and /api/campaign-templates)
  if ((url === '/api/templates' || url === '/api/campaign-templates') && req.method === 'GET') {
    await initCampaignStore();
    const tpls = await getTemplatesFromDbOrCache();
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, templates: tpls }));
    return true;
  }

  if ((url === '/api/templates' || url === '/api/campaign-templates') && req.method === 'POST') {
    try {
      await initCampaignStore();
      const saved = await saveTemplate(body);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, template: saved }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to save template' }));
    }
    return true;
  }

  const templateMatch = url.match(/^\/api\/(?:campaign-)?templates\/([a-zA-Z0-9_-]+)$/);
  if (templateMatch) {
    const templateId = templateMatch[1];
    await initCampaignStore();

    if (req.method === 'GET') {
      const tpl = await getTemplateFromDbById(templateId);
      if (!tpl) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Template not found' }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, template: tpl }));
      }
      return true;
    }

    if (req.method === 'DELETE') {
      try {
        await deleteTemplate(templateId);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, deletedTemplateId: templateId }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err?.message || 'Failed to delete template' }));
      }
      return true;
    }
  }

  // Campaigns endpoints
  if (url === '/api/campaigns' && req.method === 'GET') {
    await initCampaignStore();
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, campaigns: getAllCampaigns() }));
    return true;
  }

  if (url === '/api/campaigns' && req.method === 'POST') {
    try {
      const created = await createCampaign(body);
      res.statusCode = 201;
      res.end(JSON.stringify({ success: true, campaign: created.campaign, leads: created.leads }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to create campaign' }));
    }
    return true;
  }

  if (url === '/api/campaigns/ai-generate-preview' && req.method === 'POST') {
    try {
      const samples = await generateAiSamplePreviews(body.leads || []);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, samples }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to generate AI previews' }));
    }
    return true;
  }

  const campaignStartMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/start$/);
  if (campaignStartMatch && req.method === 'POST') {
    const campaignId = campaignStartMatch[1];
    try {
      const started = await startCampaign(campaignId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, campaign: started }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to start campaign' }));
    }
    return true;
  }

  const campaignPauseMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/pause$/);
  if (campaignPauseMatch && req.method === 'POST') {
    const campaignId = campaignPauseMatch[1];
    try {
      const paused = await pauseCampaign(campaignId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, campaign: paused }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to pause campaign' }));
    }
    return true;
  }

  const campaignRestartPreviewMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/restart-preview$/);
  if (campaignRestartPreviewMatch && req.method === 'GET') {
    const campaignId = campaignRestartPreviewMatch[1];
    await initCampaignStore();
    const camp = getCampaignById(campaignId);
    if (!camp) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Campaign not found' }));
      return true;
    }
    const leads = getCampaignLeads(campaignId);
    const repliedLeads = leads.filter((l) => l.replyStatus === 'REPLIED');
    const unrepliedLeads = leads.filter((l) => l.replyStatus !== 'REPLIED');
    const allQualified = leads.length > 0 && repliedLeads.length === leads.length;
    const nextRunNumber = (camp.lastRunNumber || 0) + 1;

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        campaignId,
        nextRunNumber,
        totalLeads: leads.length,
        unrepliedCount: unrepliedLeads.length,
        repliedCount: repliedLeads.length,
        allQualified,
        unrepliedLeads,
        repliedLeads,
      })
    );
    return true;
  }

  const campaignRestartMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/restart$/);
  if (campaignRestartMatch && req.method === 'POST') {
    const campaignId = campaignRestartMatch[1];
    try {
      const restarted = await restartCampaign(campaignId, body);
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          campaign: restarted.campaign,
          run: restarted.run,
          targetLeadsCount: restarted.targetLeadsCount,
          alreadyRepliedCount: restarted.alreadyRepliedCount,
          allQualified: restarted.allQualified,
          message: restarted.message,
        })
      );
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to restart campaign' }));
    }
    return true;
  }

  const campaignLeadsMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/leads$/);
  if (campaignLeadsMatch && req.method === 'GET') {
    const campaignId = campaignLeadsMatch[1];
    await initCampaignStore();
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, leads: getCampaignLeads(campaignId) }));
    return true;
  }

  const campaignRunsMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/runs$/);
  if (campaignRunsMatch && req.method === 'GET') {
    const campaignId = campaignRunsMatch[1];
    await initCampaignStore();
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, runs: getCampaignRuns(campaignId) }));
    return true;
  }

  const campaignSingleMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)$/);
  if (campaignSingleMatch) {
    const campaignId = campaignSingleMatch[1];
    await initCampaignStore();

    if (req.method === 'GET') {
      const camp = getCampaignById(campaignId);
      if (!camp) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Campaign not found' }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, campaign: camp }));
      }
      return true;
    }

    if (req.method === 'DELETE') {
      try {
        await deleteCampaign(campaignId);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, deletedCampaignId: campaignId }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err?.message || 'Failed to delete campaign' }));
      }
      return true;
    }
  }

  const leadStatusMatch = url.match(/^\/api\/campaigns\/lead\/([a-zA-Z0-9_-]+)\/status$/);
  if (leadStatusMatch && (req.method === 'PATCH' || req.method === 'POST')) {
    const leadId = leadStatusMatch[1];
    const { sendStatus, replyStatus, demoStatus, lastError } = body;
    const updated = await updateCampaignLeadStatus({ leadId, sendStatus, replyStatus, demoStatus, lastError });
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, lead: updated }));
    return true;
  }

  const demoStatusMatch = url.match(/^\/api\/campaigns\/lead\/([a-zA-Z0-9_-]+)\/demo-status$/);
  if (demoStatusMatch && req.method === 'PATCH') {
    const leadId = demoStatusMatch[1];
    const { demoStatus, demoSource = 'MANUAL' } = body;
    const updated = await updateLeadDemoStatus({ leadId, demoStatus, demoSource });
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, lead: updated }));
    return true;
  }

  // Not handled by core API routes
  return false;
}
