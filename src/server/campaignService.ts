import crypto from 'crypto';
import OpenAI from 'openai';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from '../services/knowledgeData.js';
import {
  collection,
  doc,
  getDocs,
  getDoc,
  setDoc,
  deleteDoc,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';
import { sendLiveEmail, getSmtpConfig } from './smtpService.js';
import { appendOutboundMessageToThread } from './inboundPipeline.js';
import {
  Campaign,
  CampaignLead,
  CampaignRun,
  EmailTemplate,
  CampaignSendHistory,
  DemoStatus,
  DemoSource,
} from '../types/index.js';

const companyResearchCache = new Map<string, any>();

/**
 * AI Personalization & Research Engine using Gemini and Umrah360 Knowledge Base
 */
export async function generateAiEmailForLead(lead: {
  name?: string;
  firstName?: string;
  lastName?: string;
  companyName?: string;
  email: string;
  phone?: string;
  designation?: string;
  website?: string;
}): Promise<{
  subject: string;
  body: string;
  researchData: {
    companySummary: string;
    relevantSignals: string[];
    companyType: string;
    confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  };
  selectedPainPoint: string;
  selectedCapabilities: string[];
  personalizationEvidence: string;
  qualityCheckStatus: 'PASSED' | 'FAILED';
}> {
  const leadName = lead.name || lead.firstName || lead.email.split('@')[0];
  const company = lead.companyName || `${leadName}'s Agency`;
  const companyKey = company.toLowerCase().trim();

  if (companyResearchCache.has(companyKey)) {
    const cached = companyResearchCache.get(companyKey);
    return generateEmailWithCachedResearch(lead, cached);
  }

  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) {
    const fallback = {
      subject: `Streamlining Operations & B2B Bookings for ${company}`,
      body: `Hi ${leadName},\n\nI noticed your operations at ${company}. Umrah360 provides tour operators with automated dynamic package builders, Makkah/Madinah hotel allotments, and B2B sub-agent portals.\n\nWould you be open to a 15-minute walkthrough this week?\n\nBest regards,\nUmrah360 Growth Team\nwww.umrah360.in`,
      researchData: {
        companySummary: `${company} operating in Hajj & Umrah pilgrimage travel.`,
        relevantSignals: ['Umrah travel agency', 'B2B/B2C pilgrimage operations'],
        companyType: 'Travel Agency / Tour Operator',
        confidence: 'MEDIUM' as const,
      },
      selectedPainPoint: 'Manual operations and spreadsheet dependency for package creation',
      selectedCapabilities: ['Dynamic Package Builder', 'B2B Sub-Agent Portal', 'Hotel Allotments'],
      personalizationEvidence: `Lead is at ${company} in pilgrimage sector.`,
      qualityCheckStatus: 'PASSED' as const,
    };
    companyResearchCache.set(companyKey, fallback.researchData);
    return fallback;
  }

  try {
    const openai = new OpenAI({ apiKey });
    const kbContext = INITIAL_KNOWLEDGE_DOCUMENTS.map((d) => `### ${d.title}\n${d.content}`).join('\n\n');

    const prompt = `You are an expert B2B sales development AI for Umrah360 (www.umrah360.in), the premier ERP and CRM platform for Hajj and Umrah tour operators.
Research the lead/company and generate a highly personalized, human-sounding cold outreach email.

LEAD DETAILS:
- Name: ${leadName}
- Company: ${company}
- Email: ${lead.email}
- Designation: ${lead.designation || 'Director / Owner'}
- Website: ${lead.website || 'Not provided'}

UMRAH360 KNOWLEDGE BASE (Product Truth):
${kbContext}

INSTRUCTIONS:
1. Research/Analyze the company based on its name, industry, and website domain if available. Identify company type, Hajj/Umrah relevance, B2B/B2C focus, and operational signals.
2. Identify the most relevant potential pain point (e.g., manual package creation, spreadsheet dependency, B2B sub-agent management, Visa/Nusuk tracking, hotel allotments).
3. Select 1-3 genuine Umrah360 capabilities from the knowledge base that directly address the pain point.
4. Generate 2-3 candidate subject lines internally and pick the single strongest, most natural, short, catchy, professional subject line.
5. Write a personalized opening demonstrating relevance to THIS company (avoiding generic "hope you're doing well", "I wanted to reach out", etc.).
6. Write a concise email body (80-180 words), professional, conversational, helpful, plain text ONLY (no markdown headings, no bullet points unless necessary).
7. Include a low-friction CTA (e.g. "Would you be open to a 15-minute walkthrough?").
8. Perform a quality check ensuring factual consistency, human tone, and clear CTA.

Output your response strictly as a JSON object:
{
  "subject": "...",
  "body": "...",
  "researchData": {
    "companySummary": "...",
    "relevantSignals": ["...", "..."],
    "companyType": "...",
    "confidence": "HIGH"
  },
  "selectedPainPoint": "...",
  "selectedCapabilities": ["...", "..."],
  "personalizationEvidence": "...",
  "qualityCheckStatus": "PASSED"
}
`;

    const candidateModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
    let text = '';

    for (const modelName of candidateModels) {
      try {
        const completion = await openai.chat.completions.create({
          model: modelName,
          messages: [{ role: 'user', content: prompt }],
          response_format: { type: 'json_object' },
          temperature: 0.3,
        });
        const content = completion.choices[0]?.message?.content;
        if (content) {
          text = content;
          break;
        }
      } catch (mErr: any) {
        console.warn(`[Campaign OpenAI ${modelName}] Notice:`, mErr?.message || mErr);
      }
    }
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      const parsed = JSON.parse(jsonMatch[0]);
      const result = {
        subject: parsed.subject || `Streamlining Operations for ${company}`,
        body: parsed.body || `Hi ${leadName},\n\nI noticed your work at ${company}...`,
        researchData: parsed.researchData || {
          companySummary: `${company} pilgrimage operations.`,
          relevantSignals: ['Umrah travel agency'],
          companyType: 'Travel Agency',
          confidence: 'MEDIUM',
        },
        selectedPainPoint: parsed.selectedPainPoint || 'Manual operations',
        selectedCapabilities: parsed.selectedCapabilities || ['Dynamic Package Builder'],
        personalizationEvidence: parsed.personalizationEvidence || company,
        qualityCheckStatus: 'PASSED' as const,
      };
      companyResearchCache.set(companyKey, result.researchData);
      return result;
    }
  } catch (err) {
    console.error('Error generating AI email with Gemini:', err);
  }

  const fallback = {
    subject: `Streamlining Operations & B2B Bookings for ${company}`,
    body: `Hi ${leadName},\n\nI noticed your operations at ${company}. Umrah360 provides tour operators with automated dynamic package builders, Makkah/Madinah hotel allotments, and B2B sub-agent portals.\n\nWould you be open to a 15-minute walkthrough this week?\n\nBest regards,\nUmrah360 Growth Team\nwww.umrah360.in`,
    researchData: {
      companySummary: `${company} operating in Hajj & Umrah pilgrimage travel.`,
      relevantSignals: ['Umrah travel agency'],
      companyType: 'Travel Agency',
      confidence: 'MEDIUM' as const,
    },
    selectedPainPoint: 'Manual operations and package creation',
    selectedCapabilities: ['Dynamic Package Builder', 'B2B Sub-Agent Portal'],
    personalizationEvidence: company,
    qualityCheckStatus: 'PASSED' as const,
  };
  companyResearchCache.set(companyKey, fallback.researchData);
  return fallback;
}

function generateEmailWithCachedResearch(lead: any, researchData: any) {
  const leadName = lead.name || lead.firstName || lead.email.split('@')[0];
  const company = lead.companyName || `${leadName}'s Agency`;
  return {
    subject: `Streamlining ${researchData.companyType || 'Pilgrimage'} Operations for ${company}`,
    body: `Hi ${leadName},\n\nGiven your focus on ${researchData.relevantSignals?.[0] || 'Umrah operations'} at ${company}, I wanted to share how Umrah360 automates dynamic package costing, hotel allotments, and B2B agent distribution.\n\nWould you be open to a quick 15-minute walkthrough this week?\n\nBest regards,\nUmrah360 Growth Team\nwww.umrah360.in`,
    researchData,
    selectedPainPoint: 'Operational coordination and manual package creation',
    selectedCapabilities: ['Dynamic Package Builder', 'B2B Sub-Agent Portal'],
    personalizationEvidence: company,
    qualityCheckStatus: 'PASSED' as const,
  };
}

// Predefined default starter templates
export const DEFAULT_EMAIL_TEMPLATES: EmailTemplate[] = [
  {
    templateId: 'tpl-b2b-portal',
    name: 'B2B Pilgrimage Portal & Sub-Agent Automation',
    subject: 'Umrah360 for {{company}} - Automate B2B Packages & Sub-Agent Bookings',
    body: `Hi {{name}},

I noticed you are leading operations at {{company}}. We work with top Umrah and Hajj tour operators across India to automate their dynamic package costing, Makkah & Madinah room allocations, and sub-agent B2B voucher distribution.

Most operators we speak with were spending 15+ hours weekly updating manual spreadsheets and WhatsApp groups for agent pricing. Umrah360 gives {{company}} an automated B2B portal with live supplier costs and compliant invoicing.

Would you be open to a 10-minute live platform walkthrough this week?

Regards,
Umrah360 Growth Team
www.umrah360.in`,
    createdAt: '2026-09-10T08:00:00Z',
    updatedAt: '2026-09-10T08:00:00Z',
  },
  {
    templateId: 'tpl-visa-allotments',
    name: 'Saudi Umrah Visa & Dynamic Hotel Costing',
    subject: 'Streamline Saudi Visa & Hotel Allotments for {{company}}',
    body: `Assalamu Alaikum {{name}},

Managing fluctuating Makkah Clock Tower allotments, Haramain train vouchers, and Saudi tourist/Umrah eVisas during peak season can overwhelm manual operations.

Umrah360 provides {{company}} with a centralized inventory hub where your team can generate instant custom quotes, lock contracted group blocks, and issue branded itineraries in seconds.

Can I share a short 3-minute video overview with your team at {{company}}?

Best regards,
Umrah360 Solutions Team
www.umrah360.in`,
    createdAt: '2026-09-11T09:00:00Z',
    updatedAt: '2026-09-11T09:00:00Z',
  },
  {
    templateId: 'tpl-enterprise-suite',
    name: 'Enterprise 20+ User Pilgrimage ERP',
    subject: 'Enterprise Pilgrimage Management Suite for {{company}}',
    body: `Dear {{name}},

As {{company}} scales its pilgrimage group volume, disconnected booking sheets lead to costly double-bookings and delayed client invoices.

Umrah360 is the leading cloud ERP purpose-built for high-volume Umrah agencies:
- Multi-tier B2B reseller commissions & ledger deposits
- Real-time inventory sync for 3/4/5-star Markaziyah hotels
- Instant PDF travel vouchers with your agency branding

Would you have 15 minutes for a live walkthrough tailored to {{company}}?

Warm regards,
Umrah360 Enterprise Team
www.umrah360.in`,
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-12T10:00:00Z',
  },
];

export const DEFAULT_CAMPAIGNS: Campaign[] = [
  {
    campaignId: 'camp-umrah-1448',
    name: 'Indian Umrah Operators 2026',
    type: 'EMAIL',
    campaignMode: 'PREDEFINED',
    deliveryMode: 'LIVE_SMTP',
    status: 'RUNNING',
    templateId: 'tpl-b2b-portal',
    templateName: 'B2B Pilgrimage Portal & Sub-Agent Automation',
    sourceFileName: '5_Sample_Pilgrimage_Tour_Operators.csv',
    totalLeads: 5,
    sentCount: 3,
    pendingCount: 2,
    failedCount: 0,
    repliedCount: 2,
    demoBookedCount: 1,
    currentRunId: 'run-umrah-1448-1',
    lastRunNumber: 1,
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-15T12:00:00Z',
    startedAt: '2026-09-12T10:05:00Z',
    stats: {
      totalLeads: 5,
      sent: 3,
      pending: 2,
      failed: 0,
      replied: 2,
      demoBooked: 1,
    },
  },
];

export const DEFAULT_CAMPAIGN_LEADS: CampaignLead[] = [
  {
    campaignLeadId: 'clead-umrah-1',
    campaignId: 'camp-umrah-1448',
    leadId: 'lead-tariq-mansoor',
    name: 'Tariq Al-Mansoor',
    firstName: 'Tariq',
    lastName: 'Al-Mansoor',
    companyName: 'Al-Mansoor Hajj & Umrah Services',
    email: 'tariq@mansoorhajj.com',
    phone: '+91 98201 11222',
    designation: 'Managing Director',
    sourceFile: '5_Sample_Pilgrimage_Tour_Operators.csv',
    rowNumber: 1,
    sendStatus: 'SENT',
    replyStatus: 'REPLIED',
    demoStatus: 'BOOKED',
    demoIntent: true,
    demoSource: 'AUTOMATIC',
    demoBookedAt: '2026-09-14T11:00:00Z',
    sendCount: 1,
    lastSentAt: '2026-09-13T10:15:00Z',
    repliedAt: '2026-09-14T09:30:00Z',
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-14T11:00:00Z',
  },
  {
    campaignLeadId: 'clead-umrah-2',
    campaignId: 'camp-umrah-1448',
    leadId: 'lead-rashid-farooqui',
    name: 'Rashid Farooqui',
    firstName: 'Rashid',
    lastName: 'Farooqui',
    companyName: 'Haramain Journeys Mumbai',
    email: 'rashid@haramainjourneys.in',
    phone: '+91 98202 33445',
    designation: 'Owner / Partner',
    sourceFile: '5_Sample_Pilgrimage_Tour_Operators.csv',
    rowNumber: 2,
    sendStatus: 'SENT',
    replyStatus: 'REPLIED',
    demoStatus: 'NOT_BOOKED',
    sendCount: 1,
    lastSentAt: '2026-09-13T10:20:00Z',
    repliedAt: '2026-09-14T14:10:00Z',
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-14T14:10:00Z',
  },
  {
    campaignLeadId: 'clead-umrah-3',
    campaignId: 'camp-umrah-1448',
    leadId: 'lead-zeeshan-malik',
    name: 'Zeeshan Malik',
    firstName: 'Zeeshan',
    lastName: 'Malik',
    companyName: 'Malik Pilgrimages UK',
    email: 'zeeshan@malikpilgrimages.co.uk',
    phone: '+44 7700 900123',
    designation: 'Operations Director',
    sourceFile: '5_Sample_Pilgrimage_Tour_Operators.csv',
    rowNumber: 3,
    sendStatus: 'SENT',
    replyStatus: 'NOT_REPLIED',
    demoStatus: 'NOT_BOOKED',
    sendCount: 1,
    lastSentAt: '2026-09-13T10:25:00Z',
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-13T10:25:00Z',
  },
  {
    campaignLeadId: 'clead-umrah-4',
    campaignId: 'camp-umrah-1448',
    leadId: 'lead-bilal-qureshi',
    name: 'Bilal Qureshi',
    firstName: 'Bilal',
    lastName: 'Qureshi',
    companyName: 'Al-Noor Tours Dubai',
    email: 'bilal@alnoortravels.ae',
    phone: '+971 50 123 4567',
    designation: 'General Manager',
    sourceFile: '5_Sample_Pilgrimage_Tour_Operators.csv',
    rowNumber: 4,
    sendStatus: 'PENDING',
    replyStatus: 'NOT_REPLIED',
    demoStatus: 'NOT_BOOKED',
    sendCount: 0,
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-12T10:00:00Z',
  },
  {
    campaignLeadId: 'clead-umrah-5',
    campaignId: 'camp-umrah-1448',
    leadId: 'lead-irfan-siddiqui',
    name: 'Irfan Siddiqui',
    firstName: 'Irfan',
    lastName: 'Siddiqui',
    companyName: 'Delhi Pilgrimage Consolidators',
    email: 'irfan@delhiumrah.in',
    phone: '+91 98111 55667',
    designation: 'CEO / Founder',
    sourceFile: '5_Sample_Pilgrimage_Tour_Operators.csv',
    rowNumber: 5,
    sendStatus: 'PENDING',
    replyStatus: 'NOT_REPLIED',
    demoStatus: 'NOT_BOOKED',
    sendCount: 0,
    createdAt: '2026-09-12T10:00:00Z',
    updatedAt: '2026-09-12T10:00:00Z',
  },
];

export const DEFAULT_CAMPAIGN_RUNS: CampaignRun[] = [
  {
    runId: 'run-umrah-1448-1',
    campaignId: 'camp-umrah-1448',
    runNumber: 1,
    status: 'RUNNING',
    templateId: 'tpl-b2b-portal',
    templateSubject: 'Umrah360 for {{company}} - Automate B2B Packages & Sub-Agent Bookings',
    totalLeads: 5,
    sentCount: 3,
    startedAt: '2026-09-12T10:05:00Z',
    createdAt: '2026-09-12T10:05:00Z',
  },
];

// In-Memory state caches
const campaignsMap = new Map<string, Campaign>();
const campaignLeadsMap = new Map<string, CampaignLead>(); // key: campaignLeadId
const campaignRunsMap = new Map<string, CampaignRun>(); // key: runId
const emailTemplatesMap = new Map<string, EmailTemplate>(); // key: templateId
const sendHistorySet = new Set<string>(); // key: `${campaignId}_${email.toLowerCase()}`

// Active sending abort flags per campaign
const activeCampaignAbortControllers = new Map<string, AbortController>();

let isCampaignStoreInitialized = false;

function ensureDefaultsInMemory() {
  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    if (!emailTemplatesMap.has(tpl.templateId)) {
      emailTemplatesMap.set(tpl.templateId, tpl);
    }
  }
  if (campaignsMap.size === 0) {
    for (const c of DEFAULT_CAMPAIGNS) {
      campaignsMap.set(c.campaignId, c);
    }
    for (const l of DEFAULT_CAMPAIGN_LEADS) {
      campaignLeadsMap.set(l.campaignLeadId, l);
    }
    for (const r of DEFAULT_CAMPAIGN_RUNS) {
      campaignRunsMap.set(r.runId, r);
    }
  }
}

/**
 * Synchronizes the in-memory campaign stores directly from Firestore.
 * Guarantees that all templates (predefined + custom) are preserved,
 * and any newly updated documents in Firestore are accurately reflected.
 */
export async function syncCampaignStoreFromFirestore(): Promise<void> {
  ensureDefaultsInMemory();

  if (!isFirebaseConfigured || !db) return;

  // Add 2.5s timeout wrapper to prevent hanging serverless responses on Vercel
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 2500));

  const syncPromise = (async () => {
    try {
      // Execute all 5 Firestore queries concurrently in parallel
      const [tplSnap, campSnap, leadsSnap, runsSnap, historySnap] = await Promise.all([
        getDocs(collection(db, 'email_templates')).catch(() => null),
        getDocs(collection(db, 'campaigns')).catch(() => null),
        getDocs(collection(db, 'campaign_leads')).catch(() => null),
        getDocs(collection(db, 'campaign_runs')).catch(() => null),
        getDocs(collection(db, 'campaign_send_history')).catch(() => null),
      ]);

      if (tplSnap) {
        const firestoreTplIds = new Set<string>();
        tplSnap.forEach((d) => {
          const data = d.data() as EmailTemplate;
          if (data && data.templateId) {
            firestoreTplIds.add(data.templateId);
            emailTemplatesMap.set(data.templateId, data);
          }
        });

        // Seed default predefined templates to Firestore if not already present
        for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
          if (!firestoreTplIds.has(tpl.templateId)) {
            safeSetDoc(doc(db, 'email_templates', tpl.templateId), tpl, { merge: true }).catch(() => {});
          }
        }
      }

      if (campSnap && !campSnap.empty) {
        campSnap.forEach((d) => {
          const data = d.data() as Campaign;
          if (data && data.campaignId) {
            campaignsMap.set(data.campaignId, data);
          }
        });
      } else if (campSnap && campSnap.empty) {
        // Seed default starter campaign into Firestore if collection is empty
        for (const c of DEFAULT_CAMPAIGNS) {
          campaignsMap.set(c.campaignId, c);
          safeSetDoc(doc(db, 'campaigns', c.campaignId), c, { merge: true }).catch(() => {});
        }
      }

      if (leadsSnap && !leadsSnap.empty) {
        leadsSnap.forEach((d) => {
          const data = d.data() as CampaignLead;
          if (data && data.campaignLeadId) {
            campaignLeadsMap.set(data.campaignLeadId, data);
          }
        });
      } else if (leadsSnap && leadsSnap.empty) {
        for (const l of DEFAULT_CAMPAIGN_LEADS) {
          campaignLeadsMap.set(l.campaignLeadId, l);
          safeSetDoc(doc(db, 'campaign_leads', l.campaignLeadId), l, { merge: true }).catch(() => {});
        }
      }

      if (runsSnap && !runsSnap.empty) {
        runsSnap.forEach((d) => {
          const data = d.data() as CampaignRun;
          if (data && data.runId) {
            campaignRunsMap.set(data.runId, data);
          }
        });
      } else if (runsSnap && runsSnap.empty) {
        for (const r of DEFAULT_CAMPAIGN_RUNS) {
          campaignRunsMap.set(r.runId, r);
          safeSetDoc(doc(db, 'campaign_runs', r.runId), r, { merge: true }).catch(() => {});
        }
      }

      if (historySnap) {
        historySnap.forEach((d) => {
          const data = d.data() as CampaignSendHistory;
          if (data && data.campaignId && data.email && data.status === 'SENT') {
            sendHistorySet.add(`${data.campaignId}_${data.email.toLowerCase()}`);
          }
        });
      }
    } catch (err) {
      console.warn('[Campaign Store] Notice syncing from Firestore:', err);
    }
  })();

  await Promise.race([syncPromise, timeoutPromise]);
}

/**
 * Initializes campaign data from Firestore, ensuring idempotency and cross-restart safety
 */
export async function initCampaignStore(forceSync: boolean = false) {
  if (!isCampaignStoreInitialized || forceSync) {
    isCampaignStoreInitialized = true;
    DEFAULT_EMAIL_TEMPLATES.forEach((tpl) => {
      if (!emailTemplatesMap.has(tpl.templateId)) {
        emailTemplatesMap.set(tpl.templateId, tpl);
      }
    });
    await syncCampaignStoreFromFirestore();
  }
}

// -------------------------------------------------------------
// TEMPLATE MANAGEMENT
// -------------------------------------------------------------
export async function getTemplatesFromDbOrCache(): Promise<EmailTemplate[]> {
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(collection(db, 'email_templates'));
      if (!snap.empty) {
        snap.forEach((d) => {
          const t = d.data() as EmailTemplate;
          if (t && t.templateId) {
            emailTemplatesMap.set(t.templateId, t);
          }
        });
      }
    } catch (err) {
      console.warn('[getTemplatesFromDbOrCache] Firestore templates lookup error:', err);
    }
  }
  return getAllTemplates();
}

export async function getTemplateFromDbById(templateId: string): Promise<EmailTemplate | undefined> {
  if (!templateId) return undefined;
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'email_templates', templateId));
      if (snap.exists()) {
        const t = snap.data() as EmailTemplate;
        emailTemplatesMap.set(templateId, t);
        return t;
      }
    } catch (err) {
      console.warn('[getTemplateFromDbById] DB lookup error:', err);
    }
  }
  return getTemplateById(templateId);
}

export function getAllTemplates(): EmailTemplate[] {
  // Always ensure default templates are included
  for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
    if (!emailTemplatesMap.has(tpl.templateId)) {
      emailTemplatesMap.set(tpl.templateId, tpl);
    }
  }
  return Array.from(emailTemplatesMap.values()).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

export function getTemplateById(templateId: string): EmailTemplate | undefined {
  if (!templateId) return undefined;
  const inMap = emailTemplatesMap.get(templateId);
  if (inMap) return inMap;
  const inDefault = DEFAULT_EMAIL_TEMPLATES.find((t) => t.templateId === templateId);
  if (inDefault) return inDefault;
  return getAllTemplates().find((t) => t.templateId === templateId);
}

export async function saveTemplate(template: Partial<EmailTemplate>): Promise<EmailTemplate> {
  const now = new Date().toISOString();
  const templateId = template.templateId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const existing = emailTemplatesMap.get(templateId);

  const isHtml = template.isHtml !== undefined
    ? template.isHtml
    : (template.format === 'html' || existing?.isHtml || false);

  const tpl: EmailTemplate = {
    templateId,
    name: (template.name || existing?.name || 'Untitled Template').trim(),
    subject: (template.subject || existing?.subject || 'Umrah360 Solutions for {{company}}').trim(),
    body: (template.body || existing?.body || '').trim(),
    htmlBody: template.htmlBody !== undefined ? template.htmlBody : existing?.htmlBody,
    format: template.format || (isHtml ? 'html' : 'text') || existing?.format || 'text',
    isHtml,
    attachments: template.attachments || existing?.attachments || [],
    createdAt: existing?.createdAt || template.createdAt || now,
    updatedAt: now,
  };

  // 1. First: Directly persist to Firestore DB
  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'email_templates', tpl.templateId), tpl, { merge: true });
      console.log(`[saveTemplate] Successfully stored template "${tpl.name}" (${tpl.templateId}) directly to DB with ${tpl.attachments?.length || 0} attachments.`);
    } catch (e) {
      console.warn('Failed to save template to Firestore:', e);
    }
  }

  // 2. Cache in memory
  emailTemplatesMap.set(tpl.templateId, tpl);

  return tpl;
}

export async function deleteTemplate(templateId: string): Promise<boolean> {
  emailTemplatesMap.delete(templateId);
  if (isFirebaseConfigured && db) {
    try {
      await deleteDoc(doc(db, 'email_templates', templateId));
    } catch (err) {
      console.warn(`Failed to delete template ${templateId} from Firestore:`, err);
    }
  }
  return true;
}

export async function generateAiSamplePreviews(leads: any[]): Promise<any[]> {
  const sampleLeads = (leads || []).slice(0, 3);
  const results: any[] = [];
  for (const lead of sampleLeads) {
    try {
      const generated = await generateAiEmailForLead(lead);
      results.push({
        lead,
        subject: generated.subject,
        body: generated.body,
        researchData: generated.researchData,
        selectedPainPoint: generated.selectedPainPoint,
        selectedCapabilities: generated.selectedCapabilities,
        personalizationEvidence: generated.personalizationEvidence,
      });
    } catch (e: any) {
      results.push({
        lead,
        subject: `Pilgrimage Operations & B2B Growth for ${lead.companyName || 'Your Agency'}`,
        body: `Hi ${lead.name || 'there'},\n\nI noticed your operations at ${lead.companyName || 'your agency'}. Umrah360 automates dynamic package costing and sub-agent portals.\n\nWould you be open to a 10-minute walkthrough?\n\nBest regards,\nUmrah360 Growth Team`,
      });
    }
  }
  return results;
}

// -------------------------------------------------------------
// CAMPAIGN MANAGEMENT
// -------------------------------------------------------------
export function getAllCampaigns(): Campaign[] {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  const campaigns = Array.from(campaignsMap.values());
  // Recalculate metrics on the fly from leads
  return campaigns.map((camp) => recalculateCampaignMetrics(camp.campaignId) || camp).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function ensureCampaignInStore(campaignId: string): Promise<Campaign | undefined> {
  let camp = campaignsMap.get(campaignId);
  if (!camp && isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'campaigns', campaignId));
      if (snap.exists()) {
        camp = snap.data() as Campaign;
        campaignsMap.set(campaignId, camp);

        const leadsSnap = await getDocs(collection(db, 'campaign_leads')).catch(() => null);
        if (leadsSnap) {
          leadsSnap.forEach((d) => {
            const l = d.data() as CampaignLead;
            if (l && l.campaignLeadId && l.campaignId === campaignId) {
              campaignLeadsMap.set(l.campaignLeadId, l);
            }
          });
        }
      }
    } catch (e) {
      console.warn('[ensureCampaignInStore] Lookup error:', e);
    }
  }
  return camp;
}

export function getCampaignById(campaignId: string): Campaign | undefined {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  const camp = campaignsMap.get(campaignId);
  return camp ? recalculateCampaignMetrics(campaignId) : undefined;
}

export async function getCampaignByIdAsync(campaignId: string): Promise<Campaign | undefined> {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  let camp = campaignsMap.get(campaignId);
  if (!camp) {
    camp = await ensureCampaignInStore(campaignId);
  }
  return camp ? recalculateCampaignMetrics(campaignId) : undefined;
}

export function getCampaignLeads(campaignId: string): CampaignLead[] {
  if (campaignLeadsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  let leads = Array.from(campaignLeadsMap.values())
    .filter((l) => l.campaignId === campaignId)
    .sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));

  if (leads.length === 0 && campaignId === 'camp-umrah-1448') {
    for (const l of DEFAULT_CAMPAIGN_LEADS) {
      campaignLeadsMap.set(l.campaignLeadId, l);
    }
    leads = Array.from(campaignLeadsMap.values())
      .filter((l) => l.campaignId === campaignId)
      .sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
  }
  return leads;
}

export async function getCampaignLeadsFromDb(campaignId: string): Promise<CampaignLead[]> {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  let leads = getCampaignLeads(campaignId);

  if (leads.length === 0 && isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(collection(db, 'campaign_leads')).catch(() => null);
      if (snap && !snap.empty) {
        snap.forEach((d) => {
          const l = d.data() as CampaignLead;
          if (l && l.campaignLeadId) {
            campaignLeadsMap.set(l.campaignLeadId, l);
          }
        });
        leads = getCampaignLeads(campaignId);
      }
    } catch (e) {
      console.warn('Error fetching campaign_leads from Firestore:', e);
    }
  }

  if (leads.length === 0 && campaignId === 'camp-umrah-1448') {
    for (const l of DEFAULT_CAMPAIGN_LEADS) {
      campaignLeadsMap.set(l.campaignLeadId, l);
    }
    leads = getCampaignLeads(campaignId);
  }

  return leads;
}

export function getCampaignRuns(campaignId: string): CampaignRun[] {
  if (campaignRunsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  let runs = Array.from(campaignRunsMap.values())
    .filter((r) => r.campaignId === campaignId)
    .sort((a, b) => b.runNumber - a.runNumber);

  if (runs.length === 0 && campaignId === 'camp-umrah-1448') {
    for (const r of DEFAULT_CAMPAIGN_RUNS) {
      campaignRunsMap.set(r.runId, r);
    }
    runs = Array.from(campaignRunsMap.values())
      .filter((r) => r.campaignId === campaignId)
      .sort((a, b) => b.runNumber - a.runNumber);
  }
  return runs;
}

/**
 * Deletes a campaign and all associated leads, runs, and send history
 */
export async function deleteCampaign(campaignId: string): Promise<boolean> {
  await ensureCampaignInStore(campaignId);

  // 1. If campaign is currently running, halt background execution
  const abortCtrl = activeCampaignAbortControllers.get(campaignId);
  if (abortCtrl) {
    try {
      abortCtrl.abort();
    } catch {}
    activeCampaignAbortControllers.delete(campaignId);
  }

  // 2. Delete all leads belonging to this campaign
  const leads = getCampaignLeads(campaignId);
  for (const lead of leads) {
    campaignLeadsMap.delete(lead.campaignLeadId);
    if (isFirebaseConfigured && db) {
      deleteDoc(doc(db, 'campaign_leads', lead.campaignLeadId)).catch(() => {});
    }
  }

  // 3. Delete all runs belonging to this campaign
  const runs = getCampaignRuns(campaignId);
  for (const run of runs) {
    campaignRunsMap.delete(run.runId);
    if (isFirebaseConfigured && db) {
      deleteDoc(doc(db, 'campaign_runs', run.runId)).catch(() => {});
    }
  }

  // 4. Clean up send history set for this campaign
  for (const key of Array.from(sendHistorySet)) {
    if (key.startsWith(`${campaignId}_`)) {
      sendHistorySet.delete(key);
    }
  }

  // 5. Delete campaign from memory and Firestore
  campaignsMap.delete(campaignId);
  if (isFirebaseConfigured && db) {
    await deleteDoc(doc(db, 'campaigns', campaignId)).catch(() => {});
  }

  console.log(`[Campaign Engine] Successfully deleted campaign ${campaignId} (${leads.length} leads, ${runs.length} runs).`);
  return true;
}

/**
 * Creates a new Campaign with uploaded leads and selected template
 */
export async function createCampaign(params: {
  name: string;
  type?: 'EMAIL' | 'WHATSAPP' | 'WHATSAPP_EMAIL';
  campaignMode?: 'PREDEFINED' | 'AI_GENERATED';
  deliveryMode?: 'LIVE_SMTP' | 'SIMULATION';
  templateId?: string;
  templateName?: string;
  templateSubject?: string;
  templateBody?: string;
  sourceFileName?: string;
  leads: Array<{
    name?: string;
    firstName?: string;
    lastName?: string;
    companyName?: string;
    email: string;
    phone?: string;
    designation?: string;
    rowNumber?: number;
  }>;
  startImmediately?: boolean;
}): Promise<{ campaign: Campaign; leads: CampaignLead[] }> {
  await initCampaignStore();

  const campaignName = (params.name || '').trim();
  if (!campaignName) {
    throw new Error('Campaign name is required.');
  }

  const rawLeads = Array.isArray(params.leads) ? params.leads : [];
  if (rawLeads.length === 0) {
    throw new Error('At least one lead is required to create a campaign.');
  }

  const now = new Date().toISOString();
  const campaignId = `camp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const mode = params.campaignMode || 'PREDEFINED';
  const deliveryMode = params.deliveryMode || 'LIVE_SMTP';

  // Dynamically resolve the selected template directly from Firestore DB
  let selectedTemplate: EmailTemplate | undefined;
  if (params.templateId) {
    if (isFirebaseConfigured && db) {
      try {
        const snap = await getDoc(doc(db, 'email_templates', params.templateId));
        if (snap.exists()) {
          selectedTemplate = snap.data() as EmailTemplate;
          emailTemplatesMap.set(params.templateId, selectedTemplate);
          console.log(`[createCampaign] Successfully loaded template "${selectedTemplate.name}" directly from DB.`);
        }
      } catch (err) {
        console.warn('Direct Firestore template lookup note in createCampaign:', err);
      }
    }
    if (!selectedTemplate) {
      selectedTemplate = getTemplateById(params.templateId);
    }
  }

  // If payload provided full template content directly, construct and register it immediately
  if (!selectedTemplate && params.templateId && params.templateBody) {
    selectedTemplate = {
      templateId: params.templateId,
      name: params.templateName || 'Custom Template',
      subject: params.templateSubject || 'Umrah360 Solutions for {{company}}',
      body: params.templateBody,
      createdAt: now,
      updatedAt: now,
    };
    emailTemplatesMap.set(params.templateId, selectedTemplate);
    if (isFirebaseConfigured && db) {
      safeSetDoc(doc(db, 'email_templates', params.templateId), selectedTemplate).catch(() => {});
    }
  }

  if (!selectedTemplate && mode === 'PREDEFINED') {
    const allAvailable = getAllTemplates();
    selectedTemplate = allAvailable.length > 0 ? allAvailable[0] : DEFAULT_EMAIL_TEMPLATES[0];
  }

  const finalTemplateId = mode === 'AI_GENERATED' ? undefined : (selectedTemplate?.templateId || params.templateId);
  const finalTemplateName = mode === 'AI_GENERATED' ? 'AI Intelligent Personalization' : (selectedTemplate?.name || params.templateName || 'Predefined Template');

  const initialCampaign: Campaign = {
    campaignId,
    name: params.name,
    type: params.type || 'EMAIL',
    campaignMode: mode,
    deliveryMode,
    status: 'DRAFT',
    templateId: finalTemplateId,
    templateName: finalTemplateName,
    sourceFileName: params.sourceFileName || 'Uploaded Leads',
    totalLeads: params.leads.length,
    sentCount: 0,
    pendingCount: params.leads.length,
    failedCount: 0,
    repliedCount: 0,
    demoBookedCount: 0,
    createdAt: now,
    updatedAt: now,
    lastRunNumber: 0,
  };

  campaignsMap.set(campaignId, initialCampaign);

  // Process leads
  const createdLeads: CampaignLead[] = [];
  params.leads.forEach((l, idx) => {
    const cleanEmail = (l.email || '').trim().toLowerCase();
    if (!cleanEmail) return;

    const rowNum = l.rowNumber || idx + 1;
    const campaignLeadId = `clead-${campaignId}-${idx + 1}`;
    const leadId = `lead-${cleanEmail.replace(/[^a-z0-9]/gi, '_')}`;

    const leadName = l.name || [l.firstName, l.lastName].filter(Boolean).join(' ') || cleanEmail.split('@')[0];
    const company = l.companyName || `${leadName}'s Agency`;

    let initialSubject: string | undefined = undefined;
    let initialBody: string | undefined = undefined;

    if (mode === 'PREDEFINED' && selectedTemplate) {
      const personalized = personalizeTemplate(selectedTemplate, {
        name: leadName,
        firstName: l.firstName || leadName.split(' ')[0],
        lastName: l.lastName || leadName.split(' ').slice(1).join(' '),
        companyName: company,
        designation: l.designation || 'Director / Owner',
        email: cleanEmail,
      });
      initialSubject = personalized.subject;
      initialBody = personalized.body;
    }

    const cLead: CampaignLead = {
      campaignLeadId,
      campaignId,
      leadId,
      name: leadName,
      firstName: l.firstName || leadName.split(' ')[0],
      lastName: l.lastName || leadName.split(' ').slice(1).join(' '),
      companyName: company,
      email: cleanEmail,
      phone: l.phone,
      designation: l.designation || 'Director / Owner',
      sourceFile: params.sourceFileName || 'Uploaded Leads',
      rowNumber: rowNum,
      sendStatus: 'PENDING',
      replyStatus: 'NOT_REPLIED',
      demoStatus: 'NOT_BOOKED',
      demoIntent: false,
      sendCount: 0,
      generatedSubject: initialSubject,
      generatedBody: initialBody,
      createdAt: now,
      updatedAt: now,
    };

    campaignLeadsMap.set(campaignLeadId, cLead);
    createdLeads.push(cLead);
  });

  // Sync to Firestore synchronously before responding
  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'campaigns', campaignId), initialCampaign);
      // Batch write leads concurrently
      const leadPromises = createdLeads.map((cl) => safeSetDoc(doc(db, 'campaign_leads', cl.campaignLeadId), cl));
      await Promise.allSettled(leadPromises);
    } catch (e) {
      console.warn('Firestore write notice during campaign creation:', e);
    }
  }

  // If user requested to start immediately
  if (params.startImmediately) {
    startCampaign(campaignId).catch((err) => {
      console.error('Error starting campaign immediately:', err);
    });
  }

  return { campaign: initialCampaign, leads: createdLeads };
}

/**
 * Start or resume a campaign
 */
export async function startCampaign(campaignId: string): Promise<Campaign> {
  const campaign = await ensureCampaignInStore(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // If campaign was COMPLETED or DRAFT without run, create a run
  const now = new Date().toISOString();
  let currentRunId = campaign.currentRunId;

  if (!currentRunId || campaign.status === 'COMPLETED' || campaign.status === 'DRAFT') {
    const nextRunNumber = (campaign.lastRunNumber || 0) + 1;
    currentRunId = `run-${campaignId}-${nextRunNumber}`;
    const allAvailable = getAllTemplates();
    const activeTemplateId = campaign.templateId || (allAvailable.length > 0 ? allAvailable[0].templateId : DEFAULT_EMAIL_TEMPLATES[0].templateId);
    const newRun: CampaignRun = {
      runId: currentRunId,
      campaignId,
      runNumber: nextRunNumber,
      status: 'RUNNING',
      templateId: activeTemplateId,
      totalLeads: campaign.totalLeads,
      sentCount: campaign.sentCount,
      startedAt: now,
      createdAt: now,
    };
    campaignRunsMap.set(currentRunId, newRun);
    campaign.currentRunId = currentRunId;
    campaign.lastRunNumber = nextRunNumber;

    if (isFirebaseConfigured && db) {
      safeSetDoc(doc(db, 'campaign_runs', currentRunId), newRun).catch(() => {});
    }
  }

  // Ensure leads can be processed: if no leads are currently PENDING but some are FAILED,
  // automatically reset FAILED leads to PENDING so they are delivered
  const leads = getCampaignLeads(campaignId);
  const pendingLeads = leads.filter((l) => l.sendStatus === 'PENDING');
  if (pendingLeads.length === 0) {
    const failedLeads = leads.filter((l) => l.sendStatus === 'FAILED');
    if (failedLeads.length > 0) {
      console.log(`[Campaign Engine] Automatically resetting ${failedLeads.length} failed leads to PENDING for campaign ${campaignId}`);
      for (const fl of failedLeads) {
        fl.sendStatus = 'PENDING';
        fl.lastError = undefined;
        fl.updatedAt = now;
        if (isFirebaseConfigured && db) {
          safeSetDoc(doc(db, 'campaign_leads', fl.campaignLeadId), fl, { merge: true }).catch(() => {});
        }
      }
    }
  }

  campaign.status = 'RUNNING';
  campaign.startedAt = campaign.startedAt || now;
  campaign.updatedAt = now;
  campaignsMap.set(campaignId, campaign);

  if (isFirebaseConfigured && db) {
    safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
  }

  // Synchronously process initial batch for immediate dispatch on Vercel & dev server
  const batchRes = await processNextCampaignSendBatch(campaignId, 3).catch((err) => {
    console.warn(`[Campaign Engine] Note processing initial batch on start:`, err);
    return null;
  });

  // Also trigger background sending engine for dev environment
  executeCampaignSendingEngine(campaignId).catch(() => {});

  return batchRes?.campaign || recalculateCampaignMetrics(campaignId) || campaign;
}

/**
 * Pause campaign immediately
 */
export async function pauseCampaign(campaignId: string): Promise<Campaign> {
  const campaign = await ensureCampaignInStore(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // Trigger abort controller to stop further sends
  const abortCtrl = activeCampaignAbortControllers.get(campaignId);
  if (abortCtrl) {
    abortCtrl.abort();
    activeCampaignAbortControllers.delete(campaignId);
  }

  const now = new Date().toISOString();
  campaign.status = 'PAUSED';
  campaign.updatedAt = now;

  if (campaign.currentRunId) {
    const run = campaignRunsMap.get(campaign.currentRunId);
    if (run && run.status === 'RUNNING') {
      run.status = 'PAUSED';
      if (isFirebaseConfigured && db) {
        setDoc(doc(db, 'campaign_runs', run.runId), run, { merge: true }).catch(() => {});
      }
    }
  }

  campaignsMap.set(campaignId, campaign);

  if (isFirebaseConfigured && db) {
    setDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
  }

  return campaign;
}

/**
 * Restart campaign:
 * - Does NOT create a duplicate campaign in UI.
 * - Retains identity, name, leads, and history.
 * - Creates a new campaignRun (tracks runId, campaignId, runNumber, status, templateId, startedAt, etc.)
 * - Safe Intelligent Follow-up Logic:
 *   1. Leads who have ALREADY REPLIED (replyStatus === 'REPLIED') are PRESERVED and EXCLUDED from sending (0 new emails sent to them).
 *   2. Leads who have NOT replied (replyStatus !== 'REPLIED', whether previous send failed or had no reply) are QUEUED (sendStatus = 'PENDING') for this follow-up run.
 *   3. If ALL leads have replied (allQualified = true, 0 unreplied leads), no emails are sent and the run records that all leads have qualified.
 */
export async function restartCampaign(
  campaignId: string,
  options?: { resetFailedOnly?: boolean; newTemplateId?: string }
): Promise<{
  campaign: Campaign;
  run: CampaignRun;
  targetLeadsCount: number;
  alreadyRepliedCount: number;
  allQualified: boolean;
  message: string;
}> {
  const campaign = await ensureCampaignInStore(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // Halt any currently active send loops for this campaign
  const existingAbort = activeCampaignAbortControllers.get(campaignId);
  if (existingAbort) {
    existingAbort.abort();
    activeCampaignAbortControllers.delete(campaignId);
  }

  const now = new Date().toISOString();
  const nextRunNumber = (campaign.lastRunNumber || 0) + 1;
  const newRunId = `run-${campaignId}-${nextRunNumber}`;
  const allAvailable = getAllTemplates();
  const templateId = options?.newTemplateId || campaign.templateId || (allAvailable.length > 0 ? allAvailable[0].templateId : DEFAULT_EMAIL_TEMPLATES[0].templateId);

  // Mark previous run as COMPLETED if it was running or paused
  if (campaign.currentRunId) {
    const prevRun = campaignRunsMap.get(campaign.currentRunId);
    if (prevRun && (prevRun.status === 'RUNNING' || prevRun.status === 'PAUSED')) {
      prevRun.status = 'COMPLETED';
      prevRun.completedAt = now;
      if (isFirebaseConfigured && db) {
        setDoc(doc(db, 'campaign_runs', prevRun.runId), prevRun, { merge: true }).catch(() => {});
      }
    }
  }

  const leads = getCampaignLeads(campaignId);
  const repliedLeads = leads.filter((l) => l.replyStatus === 'REPLIED');
  const unrepliedLeads = leads.filter((l) => l.replyStatus !== 'REPLIED');

  const allQualified = leads.length > 0 && repliedLeads.length === leads.length;
  let targetLeadsCount = 0;
  let message = '';

  if (allQualified) {
    // All leads have replied and qualified: 0 emails will be dispatched
    message = `All ${leads.length} lead(s) in this campaign have replied & qualified. No one will receive an email in Run #${nextRunNumber}.`;
    console.log(`[Campaign Engine] Restart requested for campaign ${campaignId}, but ALL leads have already replied. Disagreeing to send any duplicate emails.`);

    const newRun: CampaignRun = {
      runId: newRunId,
      campaignId,
      runNumber: nextRunNumber,
      status: 'COMPLETED',
      templateId,
      totalLeads: leads.length,
      sentCount: 0,
      startedAt: now,
      completedAt: now,
      createdAt: now,
    };
    campaignRunsMap.set(newRunId, newRun);

    campaign.currentRunId = newRunId;
    campaign.lastRunNumber = nextRunNumber;
    campaign.status = 'COMPLETED';
    campaign.completedAt = now;
    campaign.templateId = templateId;
    campaign.updatedAt = now;
    campaignsMap.set(campaignId, campaign);

    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
      setDoc(doc(db, 'campaign_runs', newRunId), newRun).catch(() => {});
    }

    recalculateCampaignMetrics(campaignId);

    return {
      campaign,
      run: newRun,
      targetLeadsCount: 0,
      alreadyRepliedCount: repliedLeads.length,
      allQualified: true,
      message,
    };
  }

  // Queue unreplied leads for the new follow-up run
  unrepliedLeads.forEach((l) => {
    l.sendStatus = 'PENDING';
    l.lastError = undefined;
    l.campaignRunId = newRunId;
    l.updatedAt = now;
    targetLeadsCount++;
    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'campaign_leads', l.campaignLeadId), l, { merge: true }).catch(() => {});
    }
  });

  // Keep replied leads untouched with their REPLIED status preserved
  repliedLeads.forEach((l) => {
    // Ensure they are not queued
    if (l.sendStatus === 'PENDING' || l.sendStatus === 'SENDING') {
      l.sendStatus = 'SENT';
    }
    l.updatedAt = now;
    if (isFirebaseConfigured && db) {
      setDoc(doc(db, 'campaign_leads', l.campaignLeadId), l, { merge: true }).catch(() => {});
    }
  });

  const newRun: CampaignRun = {
    runId: newRunId,
    campaignId,
    runNumber: nextRunNumber,
    status: 'RUNNING',
    templateId,
    totalLeads: leads.length,
    sentCount: 0,
    startedAt: now,
    createdAt: now,
  };
  campaignRunsMap.set(newRunId, newRun);

  campaign.currentRunId = newRunId;
  campaign.lastRunNumber = nextRunNumber;
  campaign.status = 'RUNNING';
  campaign.templateId = templateId;
  campaign.updatedAt = now;
  campaignsMap.set(campaignId, campaign);

  if (isFirebaseConfigured && db) {
    setDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
    setDoc(doc(db, 'campaign_runs', newRunId), newRun).catch(() => {});
  }

  recalculateCampaignMetrics(campaignId);

  message = `Run #${nextRunNumber} started. Sending follow-up to ${targetLeadsCount} unreplied lead(s). (${repliedLeads.length} lead(s) skipped because they already replied).`;
  console.log(`[Campaign Engine] ${message}`);

  // Synchronously process initial batch for immediate dispatch on Vercel & dev server
  const batchRes = await processNextCampaignSendBatch(campaignId, 3).catch((err) => {
    console.warn(`[Campaign Engine] Note processing initial batch on restart:`, err);
    return null;
  });

  // Also trigger background sending engine for dev environment
  executeCampaignSendingEngine(campaignId, newRunId).catch(() => {});

  return {
    campaign: batchRes?.campaign || recalculateCampaignMetrics(campaignId) || campaign,
    run: newRun,
    targetLeadsCount,
    alreadyRepliedCount: repliedLeads.length,
    allQualified: false,
    message,
  };
}

/**
 * Synchronously processes a batch of pending emails for a campaign.
 * Built for Vercel Serverless Function lifecycle: each call processes up to `maxBatchSize` leads,
 * dispatches emails via SMTP/Simulation, updates Firestore, and returns updated campaign state.
 */
export async function processNextCampaignSendBatch(
  campaignId: string,
  maxBatchSize: number = 3
): Promise<{
  campaign: Campaign;
  processedCount: number;
  remainingPendingCount: number;
}> {
  const campaign = await ensureCampaignInStore(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const currentRunId = campaign.currentRunId || `run-${campaignId}-1`;
  const selectedTplId = campaign.templateId || '';
  let template = getTemplateById(selectedTplId);
  if (!template && selectedTplId && isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(doc(db, 'email_templates', selectedTplId));
      if (snap.exists()) {
        template = snap.data() as EmailTemplate;
        emailTemplatesMap.set(selectedTplId, template);
      }
    } catch (err) {}
  }
  if (!template) {
    template = DEFAULT_EMAIL_TEMPLATES.find((t) => t.templateId === selectedTplId) || DEFAULT_EMAIL_TEMPLATES[0];
  }

  const leads = await getCampaignLeadsFromDb(campaignId);
  const pendingLeads = leads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED');

  if (pendingLeads.length === 0) {
    const now = new Date().toISOString();
    campaign.status = 'COMPLETED';
    campaign.completedAt = now;
    campaign.updatedAt = now;

    const run = campaignRunsMap.get(currentRunId);
    if (run) {
      run.status = 'COMPLETED';
      run.completedAt = now;
      if (isFirebaseConfigured && db) {
        safeSetDoc(doc(db, 'campaign_runs', run.runId), run, { merge: true }).catch(() => {});
      }
    }

    if (isFirebaseConfigured && db) {
      safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
    }

    const finalCamp = recalculateCampaignMetrics(campaignId) || campaign;
    return { campaign: finalCamp, processedCount: 0, remainingPendingCount: 0 };
  }

  const batchToProcess = pendingLeads.slice(0, maxBatchSize);
  let processedCount = 0;

  for (const lead of batchToProcess) {
    if (lead.replyStatus === 'REPLIED') {
      lead.sendStatus = 'SENT';
      continue;
    }

    const runHistoryKey = `${campaignId}_${currentRunId}_${lead.email.toLowerCase()}`;
    if (sendHistorySet.has(runHistoryKey)) {
      lead.sendStatus = 'SENT';
      continue;
    }

    let subject = '';
    let body = '';
    let activeAttachments: any[] = [];
    let htmlContent: string | undefined = undefined;

    if (campaign.campaignMode === 'AI_GENERATED' && !campaign.templateId) {
      if (!lead.generatedBody) {
        lead.generationStatus = 'GENERATING';
        const aiResult = await generateAiEmailForLead(lead);
        lead.researchData = aiResult.researchData;
        lead.selectedPainPoint = aiResult.selectedPainPoint;
        lead.selectedCapabilities = aiResult.selectedCapabilities;
        lead.personalizationEvidence = aiResult.personalizationEvidence;
        lead.generatedSubject = aiResult.subject;
        lead.generatedBody = aiResult.body;
        lead.qualityCheckStatus = aiResult.qualityCheckStatus;
        lead.generationStatus = 'READY_TO_SEND';
      }
      subject = lead.generatedSubject || `Streamlining Operations for ${lead.companyName}`;
      body = lead.generatedBody || `Hi ${lead.name},\n\nI noticed your operations at ${lead.companyName}.`;
    } else {
      let activeTpl = getTemplateById(template.templateId);
      if (!activeTpl) activeTpl = template;
      const personalized = personalizeTemplate(activeTpl, lead);
      subject = personalized.subject;
      body = personalized.body;
      htmlContent = personalized.html;

      if (activeTpl.attachments && activeTpl.attachments.length > 0) {
        activeAttachments = activeTpl.attachments.map((att: any) => ({
          filename: att.name || att.filename || 'attachment',
          contentType: att.type || att.contentType,
          dataUrl: att.dataUrl,
          content: att.base64 || att.content,
          encoding: att.base64 ? 'base64' : undefined,
        }));
      }
      lead.generatedSubject = subject;
      lead.generatedBody = body;
    }

    lead.sendStatus = 'SENDING';
    lead.updatedAt = new Date().toISOString();

    const smtpConfig = getSmtpConfig();
    const senderFrom = smtpConfig.from || smtpConfig.user || 'sales@umrah360.in';
    const conversationId = lead.conversationId || `conv-${lead.leadId}`;
    const gmailThreadId = lead.gmailThreadId || `thread-${lead.leadId}`;

    try {
      const isSimulationMode = campaign.deliveryMode === 'SIMULATION';
      const sendResult = isSimulationMode
        ? {
            success: true,
            messageId: `<sim-camp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@umrah360.in>`,
            simulated: true,
          }
        : await sendLiveEmail({
            to: lead.email,
            subject: subject,
            text: body,
            html: htmlContent,
            attachments: activeAttachments.length > 0 ? activeAttachments : undefined,
          });

      const now = new Date().toISOString();

      if (sendResult.success) {
        const sentMsgId = sendResult.messageId || `<camp-${Date.now()}@umrah360.in>`;
        lead.sendStatus = 'SENT';
        lead.sendCount = (lead.sendCount || 0) + 1;
        lead.lastSentAt = now;
        lead.gmailMessageId = sentMsgId;
        lead.gmailThreadId = gmailThreadId;
        lead.conversationId = conversationId;
        lead.lastError = undefined;
        lead.updatedAt = now;

        sendHistorySet.add(runHistoryKey);
        sendHistorySet.add(`${campaignId}_${lead.email.toLowerCase()}`);

        const historyRecord: CampaignSendHistory = {
          historyId: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          campaignId,
          campaignRunId: currentRunId,
          campaignLeadId: lead.campaignLeadId,
          email: lead.email,
          templateId: template.templateId,
          subject: subject,
          gmailMessageId: sentMsgId,
          sentAt: now,
          status: 'SENT',
        };

        const currentRun = campaignRunsMap.get(currentRunId);
        if (currentRun) {
          currentRun.sentCount = (currentRun.sentCount || 0) + 1;
        }

        appendOutboundMessageToThread(conversationId, {
          messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
          gmailMessageId: sentMsgId,
          gmailThreadId,
          conversationId,
          channel: 'EMAIL',
          direction: 'OUTBOUND',
          senderType: 'AGENT',
          senderName: 'Umrah360 Growth Team',
          senderEmail: senderFrom,
          text: body,
          sentAt: now,
          receivedAt: now,
          createdAt: now,
          timestamp: now,
          emailMeta: {
            subject: subject,
            from: senderFrom,
            to: lead.email,
            messageId: sentMsgId,
          },
        });

        if (isFirebaseConfigured && db) {
          safeSetDoc(doc(db, 'campaign_leads', lead.campaignLeadId), lead, { merge: true }).catch(() => {});
          safeSetDoc(doc(db, 'campaign_send_history', historyRecord.historyId), historyRecord).catch(() => {});
          if (currentRun) {
            safeSetDoc(doc(db, 'campaign_runs', currentRun.runId), currentRun, { merge: true }).catch(() => {});
          }
        }
        processedCount++;
      } else {
        lead.sendStatus = 'FAILED';
        lead.lastError = sendResult.error || 'SMTP delivery failure';
        lead.updatedAt = now;

        if (isFirebaseConfigured && db) {
          safeSetDoc(doc(db, 'campaign_leads', lead.campaignLeadId), lead, { merge: true }).catch(() => {});
        }

        if (sendResult.isDailyLimitExceeded) {
          campaign.status = 'PAUSED';
          campaign.lastError = 'Gmail Daily Sending Limit reached. Campaign paused.';
          campaign.updatedAt = now;
          if (isFirebaseConfigured && db) {
            safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
          }
          break;
        }
      }
    } catch (err: any) {
      lead.sendStatus = 'FAILED';
      lead.lastError = err?.message || 'Unexpected sending exception';
      lead.updatedAt = new Date().toISOString();

      if (isFirebaseConfigured && db) {
        safeSetDoc(doc(db, 'campaign_leads', lead.campaignLeadId), lead, { merge: true }).catch(() => {});
      }
    }
  }

  const updatedLeads = getCampaignLeads(campaignId);
  const remainingPending = updatedLeads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED');

  if (remainingPending.length === 0) {
    const now = new Date().toISOString();
    campaign.status = 'COMPLETED';
    campaign.completedAt = now;
    campaign.updatedAt = now;

    const run = campaignRunsMap.get(currentRunId);
    if (run) {
      run.status = 'COMPLETED';
      run.completedAt = now;
      if (isFirebaseConfigured && db) {
        safeSetDoc(doc(db, 'campaign_runs', run.runId), run, { merge: true }).catch(() => {});
      }
    }

    if (isFirebaseConfigured && db) {
      safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
    }
  }

  const updatedCampaign = recalculateCampaignMetrics(campaignId) || campaign;
  return {
    campaign: updatedCampaign,
    processedCount,
    remainingPendingCount: remainingPending.length,
  };
}

/**
 * Sequential / Controlled Sending Engine with strict reply checks and per-run tracking
 */
async function executeCampaignSendingEngine(campaignId: string, expectedRunId?: string) {
  const abortCtrl = new AbortController();
  activeCampaignAbortControllers.set(campaignId, abortCtrl);

  try {
    const campaign = campaignsMap.get(campaignId);
    if (!campaign) return;

    const currentRunId = expectedRunId || campaign.currentRunId || `run-${campaignId}-1`;
    const selectedTplId = campaign.templateId || '';
    let template = getTemplateById(selectedTplId);
    if (!template && selectedTplId && isFirebaseConfigured && db) {
      try {
        const snap = await getDoc(doc(db, 'email_templates', selectedTplId));
        if (snap.exists()) {
          template = snap.data() as EmailTemplate;
          emailTemplatesMap.set(selectedTplId, template);
        }
      } catch (err) {
        console.warn('Firestore fallback lookup note for template:', err);
      }
    }
    if (!template) {
      template = DEFAULT_EMAIL_TEMPLATES.find((t) => t.templateId === selectedTplId) || DEFAULT_EMAIL_TEMPLATES[0];
    }
    const leads = getCampaignLeads(campaignId);

    // Candidates: only leads with sendStatus === 'PENDING' AND replyStatus !== 'REPLIED'
    const pendingLeads = leads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED');
    console.log(
      `[Campaign Engine] Starting send batch for "${campaign.name}" [Run: ${currentRunId}] using template "${template.name}" (${template.templateId}) (${pendingLeads.length} leads pending, ${leads.filter(l => l.replyStatus === 'REPLIED').length} replied/excluded)...`
    );

    if (pendingLeads.length === 0) {
      // Nothing to send, finish run
      const now = new Date().toISOString();
      campaign.status = 'COMPLETED';
      campaign.completedAt = now;
      campaign.updatedAt = now;

      const run = campaignRunsMap.get(currentRunId);
      if (run) {
        run.status = 'COMPLETED';
        run.completedAt = now;
        if (isFirebaseConfigured && db) {
          safeSetDoc(doc(db, 'campaign_runs', run.runId), run, { merge: true }).catch(() => {});
        }
      }

      if (isFirebaseConfigured && db) {
        safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
      }
      return;
    }

    for (const lead of pendingLeads) {
      // 1. Check if paused or aborted
      if (abortCtrl.signal.aborted) {
        console.log(`[Campaign Engine] Aborting execution for campaign ${campaignId} (paused/stopped).`);
        break;
      }

      const freshCampaign = campaignsMap.get(campaignId);
      if (!freshCampaign || freshCampaign.status !== 'RUNNING') {
        console.log(`[Campaign Engine] Campaign ${campaignId} is no longer RUNNING. Halting.`);
        break;
      }

      // 2. Strict Reply Check:
      // If the lead has replied at any point, NEVER send to them!
      if (lead.replyStatus === 'REPLIED') {
        console.log(`[Campaign Engine] SKIPPING lead ${lead.email} because they have already REPLIED & qualified.`);
        lead.sendStatus = 'SENT';
        continue;
      }

      // 3. Prevent duplicate send within the SAME run
      const runHistoryKey = `${campaignId}_${currentRunId}_${lead.email.toLowerCase()}`;
      if (sendHistorySet.has(runHistoryKey)) {
        console.log(`[Campaign Engine] SKIPPING already-sent lead ${lead.email} for run ${currentRunId}.`);
        lead.sendStatus = 'SENT';
        continue;
      }

      // 4. Subject and Body generation (Predefined vs AI Generated)
      let subject = '';
      let body = '';

      const currentCamp = campaignsMap.get(campaignId) || campaign;
      const targetTplId = currentCamp.templateId || template.templateId;

      let activeAttachments: any[] = [];
      let htmlContent: string | undefined = undefined;

      if (currentCamp.campaignMode === 'AI_GENERATED' && !currentCamp.templateId) {
        if (!lead.generatedBody) {
          lead.generationStatus = 'GENERATING';
          const aiResult = await generateAiEmailForLead(lead);
          lead.researchData = aiResult.researchData;
          lead.selectedPainPoint = aiResult.selectedPainPoint;
          lead.selectedCapabilities = aiResult.selectedCapabilities;
          lead.personalizationEvidence = aiResult.personalizationEvidence;
          lead.generatedSubject = aiResult.subject;
          lead.generatedBody = aiResult.body;
          lead.qualityCheckStatus = aiResult.qualityCheckStatus;
          lead.generationStatus = 'READY_TO_SEND';
        }
        subject = lead.generatedSubject || `Streamlining Operations for ${lead.companyName}`;
        body = lead.generatedBody || `Hi ${lead.name},\n\nI noticed your operations at ${lead.companyName}.`;
      } else {
        // Strictly resolve and personalize the exact selected template
        let activeTpl = getTemplateById(targetTplId);
        if (!activeTpl && targetTplId && isFirebaseConfigured && db) {
          try {
            const snap = await getDoc(doc(db, 'email_templates', targetTplId));
            if (snap.exists()) {
              activeTpl = snap.data() as EmailTemplate;
              emailTemplatesMap.set(targetTplId, activeTpl);
            }
          } catch (err) {}
        }
        if (!activeTpl) {
          activeTpl = template;
        }
        console.log(`[Campaign Engine] [Send to ${lead.email}] Applying exact template "${activeTpl.name}" (ID: ${activeTpl.templateId}) with ${activeTpl.attachments?.length || 0} attachments`);
        const personalized = personalizeTemplate(activeTpl, lead);
        subject = personalized.subject;
        body = personalized.body;
        htmlContent = personalized.html;

        if (activeTpl.attachments && activeTpl.attachments.length > 0) {
          activeAttachments = activeTpl.attachments.map((att: any) => ({
            filename: att.name || att.filename || 'attachment',
            contentType: att.type || att.contentType,
            dataUrl: att.dataUrl,
            content: att.base64 || att.content,
            encoding: att.base64 ? 'base64' : undefined,
          }));
        }

        lead.generatedSubject = subject;
        lead.generatedBody = body;
      }

      // 5. Mark SENDING
      lead.sendStatus = 'SENDING';
      lead.updatedAt = new Date().toISOString();

      const smtpConfig = getSmtpConfig();
      const senderFrom = smtpConfig.from || smtpConfig.user || 'sales@umrah360.in';
      const conversationId = lead.conversationId || `conv-${lead.leadId}`;
      const gmailThreadId = lead.gmailThreadId || `thread-${lead.leadId}`;

      try {
        const isSimulationMode = campaign.deliveryMode === 'SIMULATION';
        console.log(`[Campaign Engine] [Run ${currentRunId}] Dispatching email to ${lead.email} ("${subject}") [Mode: ${isSimulationMode ? 'Simulation' : 'Live SMTP'}] with ${activeAttachments.length} attachments...`);
        
        const sendResult = isSimulationMode
          ? {
              success: true,
              messageId: `<sim-camp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@umrah360.in>`,
              simulated: true,
            }
          : await sendLiveEmail({
              to: lead.email,
              subject: subject,
              text: body,
              html: htmlContent,
              attachments: activeAttachments.length > 0 ? activeAttachments : undefined,
            });

        const now = new Date().toISOString();

        if (sendResult.success) {
          const sentMsgId = sendResult.messageId || `<camp-${Date.now()}@umrah360.in>`;
          lead.sendStatus = 'SENT';
          lead.sendCount = (lead.sendCount || 0) + 1;
          lead.lastSentAt = now;
          lead.gmailMessageId = sentMsgId;
          lead.gmailThreadId = gmailThreadId;
          lead.conversationId = conversationId;
          lead.lastError = undefined;
          lead.updatedAt = now;

          // Record in send history ledger for this run
          sendHistorySet.add(runHistoryKey);
          sendHistorySet.add(`${campaignId}_${lead.email.toLowerCase()}`);

          const historyRecord: CampaignSendHistory = {
            historyId: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            campaignId,
            campaignRunId: currentRunId,
            campaignLeadId: lead.campaignLeadId,
            email: lead.email,
            templateId: template.templateId,
            subject: subject,
            gmailMessageId: sentMsgId,
            sentAt: now,
            status: 'SENT',
          };

          // Increment run sent count
          const currentRun = campaignRunsMap.get(currentRunId);
          if (currentRun) {
            currentRun.sentCount = (currentRun.sentCount || 0) + 1;
          }

          // Synchronize with Unified Inbox thread
          appendOutboundMessageToThread(conversationId, {
            messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            gmailMessageId: sentMsgId,
            gmailThreadId,
            conversationId,
            channel: 'EMAIL',
            direction: 'OUTBOUND',
            senderType: 'AGENT',
            senderName: 'Umrah360 Growth Team',
            senderEmail: senderFrom,
            text: body,
            sentAt: now,
            receivedAt: now,
            createdAt: now,
            timestamp: now,
            emailMeta: {
              subject: subject,
              from: senderFrom,
              to: lead.email,
              messageId: sentMsgId,
            },
          });

          // Sync lead & history to Firestore
          if (isFirebaseConfigured && db) {
            safeSetDoc(doc(db, 'campaign_leads', lead.campaignLeadId), lead, { merge: true }).catch(() => {});
            safeSetDoc(doc(db, 'campaign_send_history', historyRecord.historyId), historyRecord).catch(() => {});
            if (currentRun) {
              safeSetDoc(doc(db, 'campaign_runs', currentRun.runId), currentRun, { merge: true }).catch(() => {});
            }
          }

          console.log(`[Campaign Engine] Successfully dispatched to ${lead.email} (ID: ${sentMsgId}) in run ${currentRunId}`);
        } else {
          lead.sendStatus = 'FAILED';
          lead.lastError = sendResult.error || 'SMTP delivery failure';
          lead.updatedAt = now;

          if (isFirebaseConfigured && db) {
            safeSetDoc(doc(db, 'campaign_leads', lead.campaignLeadId), lead, { merge: true }).catch(() => {});
          }
          console.warn(`[Campaign Engine] Failed to dispatch to ${lead.email}: ${sendResult.error}`);

          // If daily quota is exceeded, pause campaign to prevent further quota errors
          if (sendResult.isDailyLimitExceeded) {
            console.warn(`[Campaign Engine] Halting campaign ${campaignId} due to Gmail Daily Sending Limit (550 5.4.5).`);
            campaign.status = 'PAUSED';
            campaign.lastError = 'Gmail Daily Sending Limit (550 5.4.5) reached on amaavigo@gmail.com. Campaign paused. Resets automatically in 24 hours, or you can run in Test Simulation mode.';
            campaign.updatedAt = now;
            if (isFirebaseConfigured && db) {
              safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
            }
            break;
          }
        }
      } catch (err: any) {
        lead.sendStatus = 'FAILED';
        lead.lastError = err?.message || 'Unexpected sending exception';
        lead.updatedAt = new Date().toISOString();

        if (isFirebaseConfigured && db) {
          safeSetDoc(doc(db, 'campaign_leads', lead.campaignLeadId), lead, { merge: true }).catch(() => {});
        }
        console.error(`[Campaign Engine] Error sending to ${lead.email}:`, err);
      }

      // Recalculate metrics
      recalculateCampaignMetrics(campaignId);

      // Controlled pacing delay (e.g. 1.2s delay to avoid mail server rate-limits)
      await new Promise((resolve) => setTimeout(resolve, 1200));
    }

    // Check completion status
    const remainingPending = getCampaignLeads(campaignId).filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED');
    if (remainingPending.length === 0) {
      const now = new Date().toISOString();
      campaign.status = 'COMPLETED';
      campaign.completedAt = now;
      campaign.updatedAt = now;

      if (currentRunId) {
        const run = campaignRunsMap.get(currentRunId);
        if (run) {
          run.status = 'COMPLETED';
          run.completedAt = now;
          if (isFirebaseConfigured && db) {
            safeSetDoc(doc(db, 'campaign_runs', run.runId), run, { merge: true }).catch(() => {});
          }
        }
      }

      if (isFirebaseConfigured && db) {
        safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }).catch(() => {});
      }
      console.log(`[Campaign Engine] Campaign ${campaign.name} [Run: ${currentRunId}] marked COMPLETED.`);
    }
  } finally {
    activeCampaignAbortControllers.delete(campaignId);
  }
}

/**
 * Replaces variables in subject and body
 */
export function personalizeTemplate(
  template: EmailTemplate,
  lead: { name?: string; firstName?: string; lastName?: string; companyName?: string; designation?: string; email: string }
): { subject: string; body: string; html?: string; attachments?: any[] } {
  const name = lead.name || lead.firstName || lead.email.split('@')[0];
  const firstName = lead.firstName || name.split(' ')[0];
  const lastName = lead.lastName || name.split(' ').slice(1).join(' ');
  const company = lead.companyName || `${name}'s Agency`;
  const designation = lead.designation || 'Director';

  const replaceVars = (str: string) => {
    return (str || '')
      .replace(/\{\{\s*name\s*\}\}/gi, name)
      .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
      .replace(/\{\{\s*lastName\s*\}\}/gi, lastName)
      .replace(/\{\{\s*company\s*\}\}/gi, company)
      .replace(/\{\{\s*companyName\s*\}\}/gi, company)
      .replace(/\{\{\s*designation\s*\}\}/gi, designation)
      .replace(/\{\{\s*jobTitle\s*\}\}/gi, designation)
      .replace(/\{\{\s*email\s*\}\}/gi, lead.email);
  };

  const subject = replaceVars(template.subject);
  const rawBody = template.body || '';
  const body = replaceVars(rawBody);

  const rawHtml = template.htmlBody || (template.isHtml || template.format === 'html' ? template.body : undefined);
  const html = rawHtml ? replaceVars(rawHtml) : undefined;

  return {
    subject,
    body,
    html,
    attachments: template.attachments || [],
  };
}

/**
 * Recalculates metrics for a campaign from its leads
 */
export function recalculateCampaignMetrics(campaignId: string): Campaign | undefined {
  const camp = campaignsMap.get(campaignId);
  if (!camp) return undefined;

  const leads = getCampaignLeads(campaignId);
  const total = leads.length;
  const sent = leads.filter((l) => l.sendStatus === 'SENT').length;
  const pending = leads.filter((l) => l.sendStatus === 'PENDING').length;
  const failed = leads.filter((l) => l.sendStatus === 'FAILED').length;
  const replied = leads.filter((l) => l.replyStatus === 'REPLIED').length;
  const demoBooked = leads.filter((l) => l.demoStatus === 'BOOKED').length;

  camp.totalLeads = total;
  camp.sentCount = sent;
  camp.pendingCount = pending;
  camp.failedCount = failed;
  camp.repliedCount = replied;
  camp.demoBookedCount = demoBooked;
  camp.stats = {
    totalLeads: total,
    sent,
    pending,
    failed,
    replied,
    demoBooked,
  };

  return camp;
}

/**
 * Manual or Automatic Demo Status Update: Single source of truth
 */
export async function updateLeadDemoStatus(params: {
  leadId: string;
  demoStatus: DemoStatus;
  demoSource: DemoSource;
}): Promise<CampaignLead | null> {
  await initCampaignStore();

  // Find corresponding campaign lead
  const targetLead = Array.from(campaignLeadsMap.values()).find(
    (l) => l.leadId === params.leadId || l.campaignLeadId === params.leadId
  );

  if (!targetLead) return null;

  const now = new Date().toISOString();
  targetLead.demoStatus = params.demoStatus;
  targetLead.demoSource = params.demoSource;
  targetLead.demoBookedAt = params.demoStatus === 'BOOKED' ? now : undefined;
  targetLead.updatedAt = now;

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'campaign_leads', targetLead.campaignLeadId), targetLead, { merge: true });
      await safeSetDoc(doc(db, 'leads', targetLead.leadId), {
        demoStatus: params.demoStatus,
        demoSource: params.demoSource,
        demoBookedAt: targetLead.demoBookedAt,
        status: params.demoStatus === 'BOOKED' ? 'DEMO_BOOKED' : 'ENGAGED',
        updatedAt: now,
      }, { merge: true });
    } catch (e) {
      console.warn('Firestore update warning for demo status:', e);
    }
  }

  // Recalculate campaign metrics immediately
  recalculateCampaignMetrics(targetLead.campaignId);

  return targetLead;
}

/**
 * Hooks into incoming emails to identify if sender is a campaign lead.
 * If yes, updates replyStatus = 'REPLIED' and analyzes for demo booking!
 */
export async function handleIncomingCampaignLeadReply(params: {
  fromEmail: string;
  subject: string;
  body: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
}): Promise<{ isCampaignLead: boolean; campaignLead?: CampaignLead; demoDetected?: boolean }> {
  await initCampaignStore();

  const cleanFrom = (params.fromEmail || '').trim().toLowerCase();
  const matchedLead = Array.from(campaignLeadsMap.values()).find(
    (l) => l.email.toLowerCase() === cleanFrom
  );

  if (!matchedLead) {
    return { isCampaignLead: false };
  }

  const now = new Date().toISOString();
  matchedLead.replyStatus = 'REPLIED';
  matchedLead.repliedAt = now;
  matchedLead.updatedAt = now;
  if (params.gmailMessageId) matchedLead.gmailMessageId = params.gmailMessageId;
  if (params.gmailThreadId) matchedLead.gmailThreadId = params.gmailThreadId;

  // Demo intent check:
  // Detect demo intent, but only book if confirmed
  const text = `${params.subject} ${params.body}`.toLowerCase();
  const hasDemoIntent = /book a demo|schedule a demo|demo tomorrow|book the demo|yes.*demo|interested in a demo|platform walkthrough|live demo/i.test(
    text
  );

  if (hasDemoIntent) {
    matchedLead.demoIntent = true;
    // Automatic booking detection: only when an appointment confirmation or calendar scheduled event is present
    const hasConfirmedBooking = /calendar.*confirmed|appointment.*scheduled|booked for|demo scheduled|meeting invite accepted/i.test(
      text
    );

    if (hasConfirmedBooking) {
      matchedLead.demoStatus = 'BOOKED';
      matchedLead.demoSource = 'AUTOMATIC';
      matchedLead.demoBookedAt = now;
    }
  }

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'campaign_leads', matchedLead.campaignLeadId), matchedLead, { merge: true });
    } catch {}
  }

  recalculateCampaignMetrics(matchedLead.campaignId);

  return {
    isCampaignLead: true,
    campaignLead: matchedLead,
    demoDetected: matchedLead.demoStatus === 'BOOKED',
  };
}

/**
 * Update a lead's send or reply status directly (useful for testing scenarios and CRM operations)
 */
export async function updateCampaignLeadStatus(params: {
  leadId: string;
  sendStatus?: 'PENDING' | 'SENDING' | 'SENT' | 'FAILED' | 'PAUSED' | 'COMPLETED';
  replyStatus?: 'NOT_REPLIED' | 'REPLIED';
  demoStatus?: DemoStatus;
  demoSource?: DemoSource;
  lastError?: string;
}): Promise<CampaignLead | null> {
  await initCampaignStore();

  const targetLead = Array.from(campaignLeadsMap.values()).find(
    (l) => l.leadId === params.leadId || l.campaignLeadId === params.leadId
  );

  if (!targetLead) return null;

  const now = new Date().toISOString();
  if (params.sendStatus) {
    targetLead.sendStatus = params.sendStatus;
    if (params.sendStatus === 'FAILED') {
      targetLead.lastError = params.lastError || 'Delivery failure';
    } else if (params.sendStatus === 'PENDING') {
      targetLead.lastError = undefined;
    } else if (params.sendStatus === 'SENT') {
      targetLead.lastSentAt = targetLead.lastSentAt || now;
      targetLead.sendCount = (targetLead.sendCount || 0) + 1;
    }
  }

  if (params.replyStatus) {
    targetLead.replyStatus = params.replyStatus;
    if (params.replyStatus === 'REPLIED') {
      targetLead.repliedAt = targetLead.repliedAt || now;
    } else {
      targetLead.repliedAt = undefined;
    }
  }

  if (params.demoStatus) {
    targetLead.demoStatus = params.demoStatus;
    targetLead.demoBookedAt = params.demoStatus === 'BOOKED' ? now : undefined;
  }

  if (params.demoSource) {
    targetLead.demoSource = params.demoSource;
  }

  targetLead.updatedAt = now;

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'campaign_leads', targetLead.campaignLeadId), targetLead, { merge: true });
    } catch (e) {
      console.warn('Firestore update warning for lead status:', e);
    }
  }

  recalculateCampaignMetrics(targetLead.campaignId);

  return targetLead;
}
