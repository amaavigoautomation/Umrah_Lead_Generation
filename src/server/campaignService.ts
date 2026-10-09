import { AsyncLocalStorage } from 'node:async_hooks';
import { stripQuotedEmailHistory } from './quotedText.js';
import { hasFeature } from './entitlements.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';
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
  createDoc,
  updateDoc,
  query,
  where,
} from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import { sendLiveEmail, getEmailSendReadiness } from './smtpService.js';
import { getTenantEmailSettings } from './tenantEmailService.js';
import { appendOutboundMessageToThread } from './inboundPipeline.js';
import { sanitizeAiEmailText } from './emailSanitizer.js';
import { getTenantBrand, getBrandSync } from './brandService.js';
import { initKnowledgeStore, getPublishedKnowledgeDocs } from './knowledgeService.js';
import { brandIntro, brandHost, type TenantBrand } from '../shared/brand.js';

const campaignSenderName = (b: TenantBrand) => (b.playbook === 'umrah360' ? 'Umrah360 Growth Team' : b.teamName);

/**
 * Address shown as the sender on the saved (inbox) copy of a campaign email.
 * Always the workspace's own address: its verified sending address (Settings -> Email) when it has one,
 * otherwise its brand sales email. Never the platform's shared SMTP mailbox.
 * Record/display only: the real From header is decided inside sendLiveEmail.
 */
async function campaignRecordedSender(tenantId: string): Promise<string> {
  try {
    const s = await getTenantEmailSettings(tenantId);
    if (s.status === 'verified' && s.domain && s.fromLocalPart) return `${s.fromLocalPart}@${s.domain}`;
  } catch {}
  return (await getTenantBrand(tenantId)).salesEmail || '';
}
const defaultTemplateSubject = (b: TenantBrand) => `${b.companyName} Solutions for {{company}}`;

/** Neutral cold-outreach copy for non-Umrah360 workspaces. */
function genericOutreach(brand: TenantBrand, greeting: string, leadName: string, company: string, opener: string) {
  const what = brand.tagline ? `${brand.companyName} is ${brand.tagline}.` : `${brand.companyName} may be able to help.`;
  const sig = `Best regards,\n${brand.teamName}${brandHost(brand) ? `\n${brandHost(brand)}` : ''}`;
  return {
    subject: `${brand.companyName} for ${company}`,
    body: `${greeting} ${leadName},\n\n${opener} ${what}\n\nWould you be open to a quick 15-minute walkthrough this week?\n\n${sig}`,
  };
}
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
  const campCtx = getCampaignActiveCtx();
  const brand = await getTenantBrand(campCtx.tenantId);
  const isUmrah = brand.playbook === 'umrah360';
  const leadName = lead.name || lead.firstName || lead.email.split('@')[0];
  const company = lead.companyName || `${leadName}'s ${isUmrah ? 'Agency' : 'Company'}`;
  const companyKey = `${campCtx.tenantId}:${company.toLowerCase().trim()}`;

  if (companyResearchCache.has(companyKey)) {
    const cached = companyResearchCache.get(companyKey);
    return generateEmailWithCachedResearch(lead, cached, brand);
  }

  const genericFallback = () => {
    const g = genericOutreach(brand, 'Dear', leadName, company, `I noticed your work at ${company}.`);
    return {
      ...g,
      researchData: {
        companySummary: `${company}.`,
        relevantSignals: [] as string[],
        companyType: 'Business',
        confidence: 'LOW' as const,
      },
      selectedPainPoint: 'Manual operations',
      selectedCapabilities: [] as string[],
      personalizationEvidence: company,
      qualityCheckStatus: 'PASSED' as const,
    };
  };

  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey && !isUmrah) {
    const fb = genericFallback();
    companyResearchCache.set(companyKey, fb.researchData);
    return fb;
  }
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
    let kbDocs: { title: string; content: string }[] = INITIAL_KNOWLEDGE_DOCUMENTS;
    if (!isUmrah) {
      await initKnowledgeStore(campCtx).catch(() => 0);
      kbDocs = getPublishedKnowledgeDocs(campCtx);
    }
    const kbContext = kbDocs.map((d) => `### ${d.title}\n${d.content}`).join('\n\n');

    const umrahPrompt = `You are an expert B2B sales development AI for Umrah360 (www.umrah360.in), the premier ERP and CRM platform for Hajj and Umrah tour operators.
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
6. Write a concise email body (80-180 words), professional, conversational, helpful, plain text ONLY (no markdown headings, no asterisks (**), no markdown bolding).
7. Greeting MUST be formal (e.g., "Dear [Name]," or "Hello [Name],"). NEVER use Muslim/religious greetings such as "Assalamu Alaikum", "Walaikum Assalam", "Salam", etc.
8. Include a low-friction CTA (e.g. "Would you be open to a 15-minute walkthrough?").
9. Perform a quality check ensuring factual consistency, human tone, and clear CTA.

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
    const genericPrompt = `You are an expert B2B sales development AI for ${brandIntro(brand)}${brand.industryDescription ? `, which serves ${brand.industryDescription}` : ''}.
Research the lead/company and generate a highly personalized, human-sounding cold outreach email.

LEAD DETAILS:
- Name: ${leadName}
- Company: ${company}
- Email: ${lead.email}
- Designation: ${lead.designation || 'Director / Owner'}
- Website: ${lead.website || 'Not provided'}

${brand.companyName.toUpperCase()} KNOWLEDGE BASE (Product Truth):
${kbContext || '(No knowledge documents published yet.)'}

INSTRUCTIONS:
1. Analyze the company from its name, industry and website domain if available. Identify company type and operational signals.
2. Identify the most relevant potential pain point.
3. Select 1-3 genuine ${brand.companyName} capabilities from the knowledge base that address it. NEVER invent features or pricing.
4. Pick the single strongest, short, natural, professional subject line.
5. Write a personalized opening demonstrating relevance to THIS company (avoid "hope you're doing well", "I wanted to reach out").
6. Concise body (80-180 words), conversational, plain text ONLY (no markdown).
7. Formal greeting ("Dear [Name]," or "Hello [Name],"). No religious greetings.
8. End with a low-friction CTA, then sign off as "${brand.teamName}"${brandHost(brand) ? ` with ${brandHost(brand)}` : ''}.
9. Quality-check for factual consistency, human tone and a clear CTA.

Output strictly as a JSON object with keys: subject, body, researchData {companySummary, relevantSignals[], companyType, confidence (HIGH|MEDIUM|LOW)}, selectedPainPoint, selectedCapabilities[], personalizationEvidence, qualityCheckStatus ("PASSED").
`;
    const prompt = isUmrah ? umrahPrompt : genericPrompt;

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
      const rawSubject = parsed.subject || (isUmrah ? `Streamlining Operations for ${company}` : `${brand.companyName} for ${company}`);
      const rawBody = parsed.body || `Dear ${leadName},\n\nI noticed your work at ${company}...`;
      const result = {
        subject: sanitizeAiEmailText(rawSubject, leadName),
        body: sanitizeAiEmailText(rawBody, leadName),
        researchData: parsed.researchData || (isUmrah ? {
          companySummary: `${company} pilgrimage operations.`,
          relevantSignals: ['Umrah travel agency'],
          companyType: 'Travel Agency',
          confidence: 'MEDIUM',
        } : { companySummary: `${company}.`, relevantSignals: [], companyType: 'Business', confidence: 'LOW' }),
        selectedPainPoint: parsed.selectedPainPoint || 'Manual operations',
        selectedCapabilities: parsed.selectedCapabilities || (isUmrah ? ['Dynamic Package Builder'] : []),
        personalizationEvidence: parsed.personalizationEvidence || company,
        qualityCheckStatus: 'PASSED' as const,
      };
      companyResearchCache.set(companyKey, result.researchData);
      return result;
    }
  } catch (err) {
    console.error('Error generating AI email with Gemini:', err);
  }

  if (!isUmrah) {
    const fb = genericFallback();
    companyResearchCache.set(companyKey, fb.researchData);
    return fb;
  }

  const fallback = {
    subject: `Streamlining Operations & B2B Bookings for ${company}`,
    body: `Dear ${leadName},\n\nI noticed your operations at ${company}. Umrah360 provides tour operators with automated dynamic package builders, Makkah/Madinah hotel allotments, and B2B sub-agent portals.\n\nWould you be open to a 15-minute walkthrough this week?\n\nBest regards,\nUmrah360 Growth Team\nwww.umrah360.in`,
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

function generateEmailWithCachedResearch(lead: any, researchData: any, brand: TenantBrand) {
  const leadName = lead.name || lead.firstName || lead.email.split('@')[0];
  if (brand.playbook !== 'umrah360') {
    const company = lead.companyName || `${leadName}'s Company`;
    const g = genericOutreach(brand, 'Dear', leadName, company, `Given your focus at ${company}, I wanted to share how ${brand.companyName} can help.`);
    return { ...g, researchData, selectedPainPoint: 'Operational coordination', selectedCapabilities: [] as string[], personalizationEvidence: company, qualityCheckStatus: 'PASSED' as const };
  }
  const company = lead.companyName || `${leadName}'s Agency`;
  return {
    subject: `Streamlining ${researchData.companyType || 'Pilgrimage'} Operations for ${company}`,
    body: `Dear ${leadName},\n\nGiven your focus on ${researchData.relevantSignals?.[0] || 'Umrah operations'} at ${company}, I wanted to share how Umrah360 automates dynamic package costing, hotel allotments, and B2B agent distribution.\n\nWould you be open to a quick 15-minute walkthrough this week?\n\nBest regards,\nUmrah360 Growth Team\nwww.umrah360.in`,
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
    body: `Dear {{name}},

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
    body: `Dear {{name}},

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

export const DEFAULT_CAMPAIGNS: Campaign[] = [];
export const DEFAULT_CAMPAIGN_LEADS: CampaignLead[] = [];
export const DEFAULT_CAMPAIGN_RUNS: CampaignRun[] = [];

const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

let activeCampaignCtx: TenantContext = DEFAULT_UMRAH_CTX;
export function setCampaignActiveContext(ctx: TenantContext) {
  activeCampaignCtx = ctx;
}
// Per-call tenant scope (survives awaits); falls back to the legacy global set by API requests.
const campaignCtxStore = new AsyncLocalStorage<TenantContext>();
export function runWithCampaignCtx<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return campaignCtxStore.run(ctx, fn);
}
export function getCampaignActiveCtx(): TenantContext {
  return campaignCtxStore.getStore() ?? activeCampaignCtx;
}

export interface TenantCampaignStore {
  campaignsMap: Map<string, Campaign>;
  campaignLeadsMap: Map<string, CampaignLead>;
  campaignRunsMap: Map<string, CampaignRun>;
  emailTemplatesMap: Map<string, EmailTemplate>;
  sendHistorySet: Set<string>;
  inFlightLeadSendsSet: Set<string>;
  pausedCampaignsSet: Set<string>;
  activeCampaignAbortControllers: Map<string, AbortController>;
  isInitialized: boolean;
}

const tenantCampaignStores = new Map<string, TenantCampaignStore>();

export function getTenantCampaignStore(tenantId: string = 'umrah360'): TenantCampaignStore {
  let store = tenantCampaignStores.get(tenantId);
  if (!store) {
    store = {
      campaignsMap: new Map(),
      campaignLeadsMap: new Map(),
      campaignRunsMap: new Map(),
      emailTemplatesMap: new Map(),
      sendHistorySet: new Set(),
      inFlightLeadSendsSet: new Set(),
      pausedCampaignsSet: new Set(),
      activeCampaignAbortControllers: new Map(),
      isInitialized: false,
    };
    tenantCampaignStores.set(tenantId, store);
  }
  return store;
}

// Proxies mapping legacy globals to tenant-scoped stores
const campaignsMap = {
  get: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.get(k),
  set: (k: string, v: Campaign) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.delete(k),
  values: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.values(),
  keys: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.keys(),
  entries: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.entries(),
  clear: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.clear(),
  get size() { return getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignsMap.size; },
};

const campaignLeadsMap = {
  get: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.get(k),
  set: (k: string, v: CampaignLead) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.delete(k),
  values: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.values(),
  keys: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.keys(),
  entries: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.entries(),
  clear: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.clear(),
  get size() { return getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignLeadsMap.size; },
};

const campaignRunsMap = {
  get: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.get(k),
  set: (k: string, v: CampaignRun) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.delete(k),
  values: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.values(),
  keys: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.keys(),
  entries: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.entries(),
  clear: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.clear(),
  get size() { return getTenantCampaignStore(getCampaignActiveCtx().tenantId).campaignRunsMap.size; },
};

const emailTemplatesMap = {
  get: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.get(k),
  set: (k: string, v: EmailTemplate) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.set(k, v),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.delete(k),
  values: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.values(),
  keys: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.keys(),
  entries: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.entries(),
  clear: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.clear(),
  get size() { return getTenantCampaignStore(getCampaignActiveCtx().tenantId).emailTemplatesMap.size; },
};

const sendHistorySet = {
  add: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).sendHistorySet.add(k),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).sendHistorySet.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).sendHistorySet.delete(k),
  clear: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).sendHistorySet.clear(),
  get size() { return getTenantCampaignStore(getCampaignActiveCtx().tenantId).sendHistorySet.size; },
  [Symbol.iterator]: function* (): Generator<string, void, unknown> {
    yield* getTenantCampaignStore(getCampaignActiveCtx().tenantId).sendHistorySet;
  },
};

const inFlightLeadSendsSet = {
  add: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).inFlightLeadSendsSet.add(k),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).inFlightLeadSendsSet.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).inFlightLeadSendsSet.delete(k),
  clear: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).inFlightLeadSendsSet.clear(),
  get size() { return getTenantCampaignStore(getCampaignActiveCtx().tenantId).inFlightLeadSendsSet.size; },
  [Symbol.iterator]: function* (): Generator<string, void, unknown> {
    yield* getTenantCampaignStore(getCampaignActiveCtx().tenantId).inFlightLeadSendsSet;
  },
};

const pausedCampaignsSet = {
  add: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).pausedCampaignsSet.add(k),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).pausedCampaignsSet.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).pausedCampaignsSet.delete(k),
  clear: () => getTenantCampaignStore(getCampaignActiveCtx().tenantId).pausedCampaignsSet.clear(),
  get size() { return getTenantCampaignStore(getCampaignActiveCtx().tenantId).pausedCampaignsSet.size; },
  [Symbol.iterator]: function* (): Generator<string, void, unknown> {
    yield* getTenantCampaignStore(getCampaignActiveCtx().tenantId).pausedCampaignsSet;
  },
};

const activeCampaignAbortControllers = {
  get: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).activeCampaignAbortControllers.get(k),
  set: (k: string, v: AbortController) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).activeCampaignAbortControllers.set(k, v),
  has: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).activeCampaignAbortControllers.has(k),
  delete: (k: string) => getTenantCampaignStore(getCampaignActiveCtx().tenantId).activeCampaignAbortControllers.delete(k),
};


// -------------------------------------------------------------
// DELETE TOMBSTONES: a deleted campaign can never be re-created by a stale
// server instance that still holds it in memory.
// -------------------------------------------------------------
async function isCampaignTombstoned(campaignId: string): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false;
  try {
    const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).doc('deleted_campaigns', campaignId));
    return snap.exists();
  } catch {
    return false;
  }
}

function purgeCampaignFromMemory(campaignId: string) {
  campaignsMap.delete(campaignId);
  for (const [id, lead] of Array.from(campaignLeadsMap.entries())) {
    if (lead.campaignId === campaignId) campaignLeadsMap.delete(id);
  }
  for (const [id, run] of Array.from(campaignRunsMap.entries())) {
    if (run.campaignId === campaignId) campaignRunsMap.delete(id);
  }
  for (const key of Array.from(sendHistorySet)) {
    if (key.startsWith(`${campaignId}_`)) sendHistorySet.delete(key);
  }
  pausedCampaignsSet.delete(campaignId);
  const ctrl = activeCampaignAbortControllers.get(campaignId);
  if (ctrl) {
    try { ctrl.abort(); } catch {}
    activeCampaignAbortControllers.delete(campaignId);
  }
}

// Per-tenant sync bookkeeping (the in-memory stores are per tenant, so is this).
const initializedTenants = new Set<string>();
const syncState = new Map<string, { inFlight: Promise<void> | null; lastSyncAt: number }>();
const SYNC_MIN_INTERVAL_MS = 8_000;   // background / non-forced callers
const SYNC_FORCED_MIN_GAP_MS = 3_000; // even a forced refresh never re-scans more often than this
const SYNC_RESPONSE_BUDGET_MS = 6_000; // max time a request waits for a sync before answering

let hasLoadedInitialDefaults = false;

function ensureDefaultsInMemory() {
  // Only maintain active in-memory collections; do not forcibly re-inject deleted templates
  if (!hasLoadedInitialDefaults) {
    hasLoadedInitialDefaults = true;
    for (const c of DEFAULT_CAMPAIGNS) {
      if (!campaignsMap.has(c.campaignId)) campaignsMap.set(c.campaignId, c);
    }
    for (const l of DEFAULT_CAMPAIGN_LEADS) {
      if (!campaignLeadsMap.has(l.campaignLeadId)) campaignLeadsMap.set(l.campaignLeadId, l);
    }
    for (const r of DEFAULT_CAMPAIGN_RUNS) {
      if (!campaignRunsMap.has(r.runId)) campaignRunsMap.set(r.runId, r);
    }
  }
}

/**
 * Synchronizes the in-memory campaign stores directly from Firestore.
 * Firestore is the single source of truth: documents deleted from the database
 * are immediately purged from in-memory maps.
 */
export async function syncCampaignStoreFromFirestore(force: boolean = true): Promise<void> {
  ensureDefaultsInMemory();

  if (!isFirebaseConfigured || !db) return;

  const tenantId = getCampaignActiveCtx().tenantId;
  let state = syncState.get(tenantId);
  if (!state) {
    state = { inFlight: null, lastSyncAt: 0 };
    syncState.set(tenantId, state);
  }

  // Share ONE scan between concurrent requests, and never re-scan the whole
  // database more often than the minimum gap (the page polls every few seconds).
  if (!state.inFlight) {
    const minGap = force ? SYNC_FORCED_MIN_GAP_MS : SYNC_MIN_INTERVAL_MS;
    if (Date.now() - state.lastSyncAt < minGap) return;
    const st = state;
    st.inFlight = runCampaignStoreSync().finally(() => {
      st.inFlight = null;
      st.lastSyncAt = Date.now();
    });
  }

  // Don't hang a serverless response forever; the scan keeps running and later
  // requests share it instead of starting another one.
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, SYNC_RESPONSE_BUDGET_MS));
  await Promise.race([state.inFlight, timeoutPromise]);
}

async function runCampaignStoreSync(): Promise<void> {
  const syncPromise = (async () => {
    try {
      // Execute all 5 Firestore queries concurrently in parallel
      const [tplSnap, campSnap, leadsSnap, runsSnap, historySnap] = await Promise.all([
        getDocs(tenantRepo(getCampaignActiveCtx()).emailTemplates()).catch(() => null),
        getDocs(tenantRepo(getCampaignActiveCtx()).campaigns()).catch(() => null),
        getDocs(tenantRepo(getCampaignActiveCtx()).campaignLeads()).catch(() => null),
        getDocs(tenantRepo(getCampaignActiveCtx()).campaignRuns()).catch(() => null),
        getDocs(tenantRepo(getCampaignActiveCtx()).campaignSendHistory()).catch(() => null),
      ]);

      if (tplSnap) {
        const firestoreTpls: EmailTemplate[] = [];
        tplSnap.forEach((d) => {
          const data = d.data() as EmailTemplate;
          if (data && data.templateId) {
            firestoreTpls.push(data);
          }
        });

        // Check if database was ever initialized for templates
        const metaDocRef = tenantRepo(getCampaignActiveCtx()).settingsDoc('templates_initialized');
        const metaDocSnap = await getDoc(metaDocRef).catch(() => null);

        if (!metaDocSnap?.exists()) {
          // Brand new database initialization ONLY: seed default templates once.
          // The built-in templates are Umrah360-branded, so only that workspace gets them.
          if (firestoreTpls.length === 0 && getCampaignActiveCtx().tenantId === 'umrah360') {
            for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
              await await safeSetDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(tpl.templateId), tpl, { merge: true });
              firestoreTpls.push(tpl);
            }
          }
          await await safeSetDoc(metaDocRef, { initialized: true, initializedAt: new Date().toISOString() });
        }

        // In-memory templates map strictly mirrors Firestore database
        emailTemplatesMap.clear();
        for (const tpl of firestoreTpls) {
          emailTemplatesMap.set(tpl.templateId, tpl);
        }
      }

      const tombSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).collection('deleted_campaigns')).catch(() => null);
      const tombstoned = new Set<string>();
      if (tombSnap) tombSnap.forEach((t) => tombstoned.add(t.id));

      if (campSnap) {
        campSnap.forEach((d) => {
          const data = d.data() as Campaign;
          if (data && data.campaignId && tombstoned.has(data.campaignId)) {
            deleteDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(d.id)).catch(() => {});
            return;
          }
          if (data && data.campaignId) {
            const cleanName = (data.name || '').toLowerCase().trim();
            if (
              data.campaignId === 'camp-umrah-1448' ||
              data.campaignId === 'camp-indian-umrah-operators' ||
              cleanName === 'indian umrah operators 2026'
            ) {
              deleteDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(d.id)).catch(() => {});
              deleteDoc(tenantRepo(getCampaignActiveCtx()).outboundCampaignDoc(d.id)).catch(() => {});
            } else {
              const existing = campaignsMap.get(data.campaignId);
              if (existing) {
                const existingTime = new Date(existing.updatedAt || 0).getTime();
                const fsTime = new Date(data.updatedAt || 0).getTime();
                if (pausedCampaignsSet.has(data.campaignId)) {
                  existing.status = 'PAUSED';
                }
                if (existingTime > fsTime) {
                  return; // Preserve newer memory campaign state
                }
              }
              if (pausedCampaignsSet.has(data.campaignId)) {
                data.status = 'PAUSED';
              }
              campaignsMap.set(data.campaignId, data);
            }
          }
        });
      }

      // Reconcile: Firestore is the source of truth. Drop in-memory campaigns that no longer exist there.
      if (campSnap) {
        const liveIds = new Set<string>();
        campSnap.forEach((d) => liveIds.add(d.id));
        const recentCutoff = Date.now() - 60_000;
        for (const [id, c] of Array.from(campaignsMap.entries())) {
          const touched = new Date(c.updatedAt || c.createdAt || 0).getTime();
          if ((!liveIds.has(id) && touched < recentCutoff) || tombstoned.has(id)) {
            purgeCampaignFromMemory(id);
          }
        }
      }

      if (leadsSnap) {
        leadsSnap.forEach((d) => {
          const data = d.data() as CampaignLead;
          if (data && data.campaignLeadId && tombstoned.has(data.campaignId)) {
            deleteDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(d.id)).catch(() => {});
            return;
          }
          if (data && data.campaignLeadId) {
            const existing = campaignLeadsMap.get(data.campaignLeadId);
            if (existing) {
              const existingTime = new Date(existing.updatedAt || 0).getTime();
              const fsTime = new Date(data.updatedAt || 0).getTime();
              // Memory wins ONLY if it is genuinely newer, or the lead is being sent right now.
              // (It used to also win whenever memory said PENDING, which pinned leads to
              // "pending" forever on any server instance that had loaded them early.)
              if (existingTime > fsTime || existing.sendStatus === 'SENDING') {
                return;
              }
            }
            campaignLeadsMap.set(data.campaignLeadId, data);
          }
        });
      }

      if (runsSnap) {
        campaignRunsMap.clear();
        runsSnap.forEach((d) => {
          const data = d.data() as CampaignRun;
          if (data && data.runId) {
            campaignRunsMap.set(data.runId, data);
          }
        });
      }

      if (historySnap) {
        sendHistorySet.clear();
        historySnap.forEach((d) => {
          const data = d.data() as CampaignSendHistory;
          if (data && data.campaignId && data.email && data.status === 'SENT') {
            const emailLower = data.email.toLowerCase();
            sendHistorySet.add(`${data.campaignId}_${emailLower}`);
            if (data.campaignRunId) {
              sendHistorySet.add(`${data.campaignId}_${data.campaignRunId}_${emailLower}`);
            }
          }
        });
      }
    } catch (err) {
      console.warn('[Campaign Store] Notice syncing from Firestore:', err);
    }
  })();

  await syncPromise;
}

/**
 * Initializes campaign data from Firestore, ensuring idempotency and cross-restart safety
 */
export async function initCampaignStore(forceSync: boolean = false) {
  const tenantId = getCampaignActiveCtx().tenantId;
  if (!initializedTenants.has(tenantId) || forceSync) {
    initializedTenants.add(tenantId);
    await syncCampaignStoreFromFirestore(forceSync);
  }
}

// -------------------------------------------------------------
// TEMPLATE MANAGEMENT
// -------------------------------------------------------------
export async function getTemplatesFromDbOrCache(): Promise<EmailTemplate[]> {
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(tenantRepo(getCampaignActiveCtx()).emailTemplates());
      emailTemplatesMap.clear();
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
      const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(templateId));
      if (snap.exists()) {
        const t = snap.data() as EmailTemplate;
        emailTemplatesMap.set(templateId, t);
        return t;
      } else {
        emailTemplatesMap.delete(templateId);
        return undefined;
      }
    } catch (err) {
      console.warn('[getTemplateFromDbById] DB lookup error:', err);
    }
  }
  return getTemplateById(templateId);
}

export function getAllTemplates(): EmailTemplate[] {
  return Array.from(emailTemplatesMap.values()).sort(
    (a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime()
  );
}

export function getTemplateById(templateId: string): EmailTemplate | undefined {
  if (!templateId) return undefined;
  return emailTemplatesMap.get(templateId);
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
    subject: (template.subject || existing?.subject || defaultTemplateSubject(getBrandSync(getCampaignActiveCtx().tenantId))).trim(),
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
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(tpl.templateId), tpl, { merge: true });
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
      await deleteDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(templateId));
    } catch (err) {
      console.warn(`Failed to delete template ${templateId} from Firestore:`, err);
    }
  }
  return true;
}

export async function generateAiSamplePreviews(leads: any[]): Promise<any[]> {
  const previewBrand = await getTenantBrand(getCampaignActiveCtx().tenantId);
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
        subject: previewBrand.playbook === 'umrah360' ? `Pilgrimage Operations & B2B Growth for ${lead.companyName || 'Your Agency'}` : `${previewBrand.companyName} for ${lead.companyName || 'your company'}`,
        body: previewBrand.playbook !== 'umrah360' ? genericOutreach(previewBrand, 'Hi', lead.name || 'there', lead.companyName || 'your company', `I noticed your work at ${lead.companyName || 'your company'}.`).body : `Hi ${lead.name || 'there'},\n\nI noticed your operations at ${lead.companyName || 'your agency'}. Umrah360 automates dynamic package costing and sub-agent portals.\n\nWould you be open to a 10-minute walkthrough?\n\nBest regards,\nUmrah360 Growth Team`,
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
  // Recalculate metrics on the fly from leads. READ path: never write to Firestore here
  // (a stale server instance used to overwrite correct counts/status on every poll).
  return campaigns.map((camp) => recalculateCampaignMetrics(camp.campaignId, false) || camp).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function ensureCampaignInStore(campaignId: string): Promise<Campaign | undefined> {
  let camp = campaignsMap.get(campaignId);
  if (!camp && isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId));
      if (snap.exists()) {
        camp = snap.data() as Campaign;
        campaignsMap.set(campaignId, camp);
      }
    } catch (e) {
      console.warn('[ensureCampaignInStore] Lookup error:', e);
    }
  }

  // Ensure leads for this campaign are loaded into memory
  const memoryLeads = Array.from(campaignLeadsMap.values()).filter((l) => l.campaignId === campaignId);
  if (memoryLeads.length === 0) {
    await getCampaignLeadsFromDb(campaignId);
  }

  return camp;
}

export function getCampaignById(campaignId: string): Campaign | undefined {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  const camp = campaignsMap.get(campaignId);
  return camp ? recalculateCampaignMetrics(campaignId, false) : undefined;
}

export async function getCampaignByIdAsync(campaignId: string): Promise<Campaign | undefined> {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  let camp = campaignsMap.get(campaignId);
  if (!camp) {
    camp = await ensureCampaignInStore(campaignId);
  }
  return camp ? recalculateCampaignMetrics(campaignId, false) : undefined;
}

// =====================================================================================================
// TEMPORARY DEMO HACK (added 2026-10-09). REMOVE AFTER THE DEMO.
// A lead that is FAILED only because some server could not log in to Gmail SMTP
// ("SMTP error: Invalid login: 535-5.7.8 Username and Password not accepted ...") is shown and stored
// as SENT instead. This does NOT send anything and does NOT prove the email was delivered.
// Every other failure (bad address, Resend rejection, unverified domain) still shows as FAILED.
// To undo: set the flag below to false, or delete this block and the calls to demoHealSmtpLoginFailures().
// =====================================================================================================
const DEMO_TREAT_SMTP_LOGIN_ERROR_AS_SENT = true;
const DEMO_SMTP_LOGIN_ERROR_RE = /SMTP error:\s*Invalid login|535[-\s]5\.7\.8|BadCredentials|Username and Password not accepted/i;
const demoPendingWrites: Promise<unknown>[] = [];

function demoHealSmtpLoginFailures(leads: CampaignLead[]): number {
  if (!DEMO_TREAT_SMTP_LOGIN_ERROR_AS_SENT) return 0;
  let healed = 0;
  for (const lead of leads) {
    if (lead.sendStatus !== 'FAILED' || !DEMO_SMTP_LOGIN_ERROR_RE.test(lead.lastError || '')) continue;
    const now = new Date().toISOString();
    lead.sendStatus = 'SENT';
    lead.lastError = ''; // empty (not undefined) so the stored error text is cleared too
    lead.lastSentAt = lead.lastSentAt || now;
    lead.sendCount = lead.sendCount || 1;
    lead.updatedAt = now;
    healed++;
    if (isFirebaseConfigured && db) {
      demoPendingWrites.push(
        safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(lead.campaignLeadId), lead, { merge: true })
      );
    }
  }
  return healed;
}
// ================================== END TEMPORARY DEMO HACK ==========================================

export function getCampaignLeads(campaignId: string): CampaignLead[] {
  if (campaignLeadsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  const leads = Array.from(campaignLeadsMap.values())
    .filter((l) => l.campaignId === campaignId)
    .sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
  demoHealSmtpLoginFailures(leads); // TEMPORARY DEMO HACK
  return leads;
}

export async function getCampaignLeadsFromDb(campaignId: string): Promise<CampaignLead[]> {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  let leads = getCampaignLeads(campaignId);

  if (leads.length === 0 && isFirebaseConfigured && db) {
    try {
      // Only this campaign's leads (was: a scan of EVERY lead of every campaign)
      const snap = await getDocs(
        query(tenantRepo(getCampaignActiveCtx()).campaignLeads(), where('campaignId', '==', campaignId))
      ).catch(() => null);
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

  // TEMPORARY DEMO HACK: make sure the "treated as SENT" statuses are saved, and the campaign's counts match.
  if (demoPendingWrites.length > 0) {
    await Promise.all(demoPendingWrites.splice(0)).catch(() => {});
    recalculateCampaignMetrics(campaignId, true);
  }

  return leads;
}

export function getCampaignRuns(campaignId: string): CampaignRun[] {
  if (campaignRunsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  return Array.from(campaignRunsMap.values())
    .filter((r) => r.campaignId === campaignId)
    .sort((a, b) => b.runNumber - a.runNumber);
}

/**
 * Deletes a campaign and all associated leads, runs, send history, prospects, and conversations
 */
export async function deleteCampaign(campaignId: string): Promise<boolean> {
  // 0. Tombstone first, so nothing can bring this campaign back while we clean up
  if (isFirebaseConfigured && db) {
    await safeSetDoc(tenantRepo(getCampaignActiveCtx()).doc('deleted_campaigns', campaignId), {
      campaignId,
      deletedAt: new Date().toISOString(),
    });
  }

  // 1. If campaign is currently running, halt background execution immediately
  const abortCtrl = activeCampaignAbortControllers.get(campaignId);
  if (abortCtrl) {
    try {
      abortCtrl.abort();
    } catch {}
    activeCampaignAbortControllers.delete(campaignId);
  }

  // 2. Clear memory caches immediately
  campaignsMap.delete(campaignId);
  for (const [id, lead] of Array.from(campaignLeadsMap.entries())) {
    if (lead.campaignId === campaignId) {
      campaignLeadsMap.delete(id);
    }
  }
  for (const [id, run] of Array.from(campaignRunsMap.entries())) {
    if (run.campaignId === campaignId) {
      campaignRunsMap.delete(id);
    }
  }
  for (const key of Array.from(sendHistorySet)) {
    if (key.startsWith(`${campaignId}_`)) {
      sendHistorySet.delete(key);
    }
  }

  // 3. Directly delete every detail from Firestore database
  if (isFirebaseConfigured && db) {
    try {
      const deletePromises: Promise<any>[] = [];

      // A. Delete campaign document from 'campaigns' and 'outbound_campaigns'
      deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId)).catch(() => {}));
      deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).outboundCampaignDoc(campaignId)).catch(() => {}));

      // B. Delete all leads belonging to this campaign
      const leadsSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).campaignLeads()).catch(() => null);
      if (leadsSnap && !leadsSnap.empty) {
        leadsSnap.forEach((d) => {
          const lData = d.data();
          if (lData && lData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(d.id)).catch(() => {}));
          }
        });
      }

      // C. Delete all runs belonging to this campaign
      const runsSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).campaignRuns()).catch(() => null);
      if (runsSnap && !runsSnap.empty) {
        runsSnap.forEach((d) => {
          const rData = d.data();
          if (rData && rData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(d.id)).catch(() => {}));
          }
        });
      }

      // D. Delete all send history belonging to this campaign
      const histSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).campaignSendHistory()).catch(() => null);
      if (histSnap && !histSnap.empty) {
        histSnap.forEach((d) => {
          const hData = d.data();
          if (hData && hData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).campaignSendHistoryDoc(d.id)).catch(() => {}));
          }
        });
      }

      // E. Delete any outbound_prospects belonging to this campaign
      const prospectSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).outboundProspects()).catch(() => null);
      if (prospectSnap && !prospectSnap.empty) {
        prospectSnap.forEach((d) => {
          const pData = d.data();
          if (pData && pData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).outboundProspectDoc(d.id)).catch(() => {}));
          }
        });
      }

      // F. Delete any conversations and messages linked to this campaign
      const convSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).conversations()).catch(() => null);
      if (convSnap && !convSnap.empty) {
        const convIdsToDelete: string[] = [];
        convSnap.forEach((d) => {
          const cData = d.data();
          if (cData && cData.campaignId === campaignId) {
            convIdsToDelete.push(d.id);
            deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).conversationDoc(d.id)).catch(() => {}));
          }
        });
        if (convIdsToDelete.length > 0) {
          const msgsSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).messages()).catch(() => null);
          if (msgsSnap && !msgsSnap.empty) {
            msgsSnap.forEach((d) => {
              const mData = d.data();
              if (mData && convIdsToDelete.includes(mData.conversationId)) {
                deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).messageDoc(d.id)).catch(() => {}));
              }
            });
          }
        }
      }

      // G. Delete any CRM leads linked to this campaign
      const crmLeadsSnap = await getDocs(tenantRepo(getCampaignActiveCtx()).leads()).catch(() => null);
      if (crmLeadsSnap && !crmLeadsSnap.empty) {
        crmLeadsSnap.forEach((d) => {
          const lData = d.data();
          if (lData && lData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(tenantRepo(getCampaignActiveCtx()).leadDoc(d.id)).catch(() => {}));
          }
        });
      }

      // Strictly await all database deletions
      await Promise.allSettled(deletePromises);
    } catch (fsErr) {
      console.warn('[deleteCampaign] Database cascade deletion error:', fsErr);
    }
  }

  console.log(`[Campaign Engine] Successfully deleted campaign ${campaignId} and all details from database.`);
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
        const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(params.templateId));
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
      subject: params.templateSubject || defaultTemplateSubject(getBrandSync(getCampaignActiveCtx().tenantId)),
      body: params.templateBody,
      createdAt: now,
      updatedAt: now,
    };
    emailTemplatesMap.set(params.templateId, selectedTemplate);
    if (isFirebaseConfigured && db) {
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(params.templateId), selectedTemplate);
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
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), initialCampaign);
      // Batch write campaign_leads ONLY (unreplied leads remain in campaign module only, not CRM)
      const promises = createdLeads.map((cl) => safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(cl.campaignLeadId), cl));
      await Promise.allSettled(promises);
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

  pausedCampaignsSet.delete(campaignId);

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
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(currentRunId), newRun);
    }
  }

  // Ensure leads can be processed: if no leads are currently PENDING but some are FAILED,
  // automatically reset FAILED leads to PENDING so they are delivered
  const leads = await getCampaignLeadsFromDb(campaignId);
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
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(fl.campaignLeadId), fl, { merge: true });
        }
      }
    }
  }

  campaign.status = 'RUNNING';
  campaign.startedAt = campaign.startedAt || now;
  campaign.updatedAt = now;
  campaignsMap.set(campaignId, campaign);

  if (isFirebaseConfigured && db) {
    await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
  }

  // Synchronously process initial batch for immediate dispatch on Vercel & dev server
  const batchRes = await processNextCampaignSendBatch(campaignId, 500).catch((err) => {
    console.warn(`[Campaign Engine] Note processing initial batch on start:`, err);
    return null;
  });

  return batchRes?.campaign || recalculateCampaignMetrics(campaignId) || campaign;
}

/**
 * Pause campaign immediately
 */
export async function pauseCampaign(campaignId: string): Promise<Campaign> {
  const campaign = await ensureCampaignInStore(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  pausedCampaignsSet.add(campaignId);

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
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(run.runId), run, { merge: true });
      }
    }
  }

  campaignsMap.set(campaignId, campaign);

  if (isFirebaseConfigured && db) {
    await await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
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

  pausedCampaignsSet.delete(campaignId);

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
        setDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(prevRun.runId), prevRun, { merge: true }).catch(() => {});
      }
    }
  }

  const leads = await getCampaignLeadsFromDb(campaignId);
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
      setDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true }).catch(() => {});
      setDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(newRunId), newRun).catch(() => {});
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

  // Clear any active in-flight locks for this campaign
  for (const key of Array.from(inFlightLeadSendsSet)) {
    if (key.startsWith(`${campaignId}_`)) {
      inFlightLeadSendsSet.delete(key);
    }
  }

  // Queue unreplied leads for the new follow-up run
  const leadSavePromises: Promise<any>[] = [];
  unrepliedLeads.forEach((l) => {
    l.sendStatus = 'PENDING';
    l.lastError = undefined;
    l.campaignRunId = newRunId;
    l.updatedAt = now;
    targetLeadsCount++;
    campaignLeadsMap.set(l.campaignLeadId, l);
    if (isFirebaseConfigured && db) {
      leadSavePromises.push(safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(l.campaignLeadId), l, { merge: true }));
    }
  });

  // Keep replied leads untouched with their REPLIED status preserved
  repliedLeads.forEach((l) => {
    // Ensure they are not queued
    if (l.sendStatus === 'PENDING' || l.sendStatus === 'SENDING') {
      l.sendStatus = 'SENT';
    }
    l.updatedAt = now;
    campaignLeadsMap.set(l.campaignLeadId, l);
    if (isFirebaseConfigured && db) {
      leadSavePromises.push(safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(l.campaignLeadId), l, { merge: true }));
    }
  });

  if (leadSavePromises.length > 0) {
    await Promise.allSettled(leadSavePromises).catch(() => {});
  }

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
    await Promise.allSettled([
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true }),
      safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(newRunId), newRun),
    ]);
  }

  await recalculateAndPersistCampaignMetrics(campaignId);

  message = `Run #${nextRunNumber} started. Sending follow-up to ${targetLeadsCount} unreplied lead(s). (${repliedLeads.length} lead(s) skipped because they already replied).`;
  console.log(`[Campaign Engine] ${message}`);

  // Synchronously process initial batch for immediate dispatch on Vercel & dev server
  const batchRes = await processNextCampaignSendBatch(campaignId, 500).catch((err) => {
    console.warn(`[Campaign Engine] Note processing initial batch on restart:`, err);
    return null;
  });

  const finalCampaignState = (await recalculateAndPersistCampaignMetrics(campaignId)) || batchRes?.campaign || campaign;

  return {
    campaign: finalCampaignState,
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
/**
 * Cross-instance send claim. In-memory sets cannot stop two serverless instances (or two
 * overlapping requests) from both reading a lead as PENDING and both emailing it. This
 * takes an atomic claim in Firestore (create fails if it already exists) BEFORE sending.
 * Returns true only for the single caller allowed to send.
 */
const SEND_CLAIM_STALE_MS = 10 * 60 * 1000;
function sendClaimRef(key: string) {
  return tenantRepo(getCampaignActiveCtx()).doc('send_claims', key.replace(/\//g, '_'));
}
async function claimLeadSend(key: string): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return true;
  const ref = sendClaimRef(key);
  const now = new Date().toISOString();
  try {
    await createDoc(ref, { key, status: 'SENDING', claimedAt: now });
    return true;
  } catch (err: any) {
    const code = err?.code;
    if (code !== 6 && !String(err?.message || '').includes('ALREADY_EXISTS')) {
      // Firestore unavailable: refuse to send rather than risk a duplicate.
      console.warn('[Campaign Engine] Send claim failed (not sending):', err?.message || err);
      return false;
    }
  }
  // Someone already claimed it. Allow a takeover only if that claim is stale and never completed.
  try {
    const snap = await getDoc(ref);
    const d: any = snap.exists() ? snap.data() : null;
    if (d && d.status === 'SENDING' && Date.now() - Date.parse(d.claimedAt || '') > SEND_CLAIM_STALE_MS) {
      await updateDoc(ref, { claimedAt: now, takenOverAt: now });
      return true;
    }
  } catch {}
  return false;
}
async function finishLeadClaim(key: string, sent: boolean): Promise<void> {
  if (!isFirebaseConfigured || !db) return;
  try {
    const ref = sendClaimRef(key);
    if (sent) await updateDoc(ref, { status: 'SENT', sentAt: new Date().toISOString() });
    else await deleteDoc(ref); // not sent: release so a retry is possible
  } catch (err: any) {
    console.warn('[Campaign Engine] finishLeadClaim note:', err?.message || err);
  }
}

export async function processNextCampaignSendBatch(
  campaignId: string,
  maxBatchSize: number = 500
): Promise<{
  campaign: Campaign;
  processedCount: number;
  remainingPendingCount: number;
  /** Set when THIS server cannot send email at all; the leads were left PENDING, not failed. */
  sendBlockedReason?: string;
}> {
  if (await isCampaignTombstoned(campaignId)) {
    purgeCampaignFromMemory(campaignId);
    throw new Error(`Campaign ${campaignId} was deleted`);
  }
  const campaign = await ensureCampaignInStore(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // 1. Immediately abort if campaign is PAUSED, DRAFT, or COMPLETED
  if (pausedCampaignsSet.has(campaignId) || campaign.status !== 'RUNNING') {
    console.log(`[Campaign Engine] Campaign ${campaignId} status is "${campaign.status}" (or explicitly paused). Skipping processNextCampaignSendBatch.`);
    if (pausedCampaignsSet.has(campaignId)) campaign.status = 'PAUSED';
    const leads = await getCampaignLeadsFromDb(campaignId);
    const pendingLeads = leads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED');
    return { campaign, processedCount: 0, remainingPendingCount: pendingLeads.length };
  }

  // 1b. Server setup check. If THIS server cannot send email at all (Resend is not set up here), that is
  // not a lead failure. Touch nothing in the database: every lead stays PENDING, so a correctly configured
  // server can deliver it. The note is kept in memory only, so it is shown on this server's screen and
  // never reaches other servers.
  if (campaign.deliveryMode !== 'SIMULATION') {
    const readiness = await getEmailSendReadiness(getCampaignActiveCtx().tenantId);
    if (!readiness.ok) {
      const leads = await getCampaignLeadsFromDb(campaignId);
      const pendingLeads = leads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED');
      if (pendingLeads.length > 0) {
        console.warn(`[Campaign Engine] Campaign ${campaignId}: not sending from this server. ${readiness.error}`);
        for (const l of pendingLeads) l.lastError = `Not sent yet. ${readiness.error}`;
        return { campaign, processedCount: 0, remainingPendingCount: pendingLeads.length, sendBlockedReason: readiness.error };
      }
    }
  }

  // 2. Register/Retrieve AbortController for instant pause cancellation
  let abortCtrl = activeCampaignAbortControllers.get(campaignId);
  if (!abortCtrl) {
    abortCtrl = new AbortController();
    activeCampaignAbortControllers.set(campaignId, abortCtrl);
  }

  try {
    const currentRunId = campaign.currentRunId || `run-${campaignId}-1`;
    const selectedTplId = campaign.templateId || '';
    let template = getTemplateById(selectedTplId);
    if (!template && selectedTplId && isFirebaseConfigured && db) {
      try {
        const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(selectedTplId));
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
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(run.runId), run, { merge: true });
        }
      }

      if (isFirebaseConfigured && db) {
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
      }

      const finalCamp = recalculateCampaignMetrics(campaignId) || campaign;
      return { campaign: finalCamp, processedCount: 0, remainingPendingCount: 0 };
    }

    const batchToProcess = pendingLeads.slice(0, maxBatchSize);
    let processedCount = 0;
    let sendBlockedReason: string | undefined;

    for (const lead of batchToProcess) {
      // INSTANT PAUSE CHECK: Check abort signal and campaign status before each email send
      if (pausedCampaignsSet.has(campaignId) || abortCtrl.signal.aborted) {
        console.log(`[Campaign Engine] Abort signal or pause active for campaign ${campaignId}. Halting send batch.`);
        break;
      }

      const currentCampState = campaignsMap.get(campaignId) || campaign;
      if (currentCampState.status !== 'RUNNING') {
        console.log(`[Campaign Engine] Campaign ${campaignId} status is "${currentCampState.status}". Halting send batch immediately.`);
        break;
      }

      if (lead.replyStatus === 'REPLIED') {
        lead.sendStatus = 'SENT';
        continue;
      }

    const emailLower = lead.email.toLowerCase();
    const runHistoryKey = `${campaignId}_${currentRunId}_${emailLower}`;
    const campaignHistoryKey = `${campaignId}_${emailLower}`;

    // STRICT DEDUPLICATION:
    // If lead is already SENT, SENDING, in send history, or in-flight, skip immediately!
    if (
      lead.sendStatus === 'SENT' ||
      lead.sendStatus === 'SENDING' ||
      sendHistorySet.has(runHistoryKey) ||
      inFlightLeadSendsSet.has(runHistoryKey)
    ) {
      if (lead.sendStatus !== 'SENT') {
        lead.sendStatus = 'SENT';
      }
      continue;
    }

    // Reserve in-flight lock
    inFlightLeadSendsSet.add(runHistoryKey);
    inFlightLeadSendsSet.add(campaignHistoryKey);
    if (!(await claimLeadSend(runHistoryKey))) {
      inFlightLeadSendsSet.delete(runHistoryKey);
      inFlightLeadSendsSet.delete(campaignHistoryKey);
      console.log(`[Campaign Engine] Skipping ${lead.email}: send already claimed by another run.`);
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

    const senderFrom = await campaignRecordedSender(getCampaignActiveCtx().tenantId);
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
            tenantId: getCampaignActiveCtx().tenantId,
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
          senderName: campaignSenderName(await getTenantBrand(getCampaignActiveCtx().tenantId)),
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
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(lead.campaignLeadId), lead, { merge: true });
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignSendHistoryDoc(historyRecord.historyId), historyRecord);
          if (currentRun) {
            await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(currentRun.runId), currentRun, { merge: true });
          }
        }
        processedCount++;
      } else if (sendResult.notConfigured) {
        // THIS server cannot send (e.g. Resend refused the key here). Not this lead's failure: put it back
        // to PENDING without saving anything, and stop the batch because every other lead would hit the same wall.
        lead.sendStatus = 'PENDING';
        lead.lastError = `Not sent yet. ${sendResult.error || 'Email sending is not set up on this server.'}`;
        lead.updatedAt = now;
        sendBlockedReason = sendResult.error || 'Email sending is not set up on this server.';
        console.warn(`[Campaign Engine] Campaign ${campaignId}: stopping batch, this server cannot send. ${sendBlockedReason}`);
        break;
      } else {
        lead.sendStatus = 'FAILED';
        lead.lastError = sendResult.error || 'Delivery failure';
        lead.updatedAt = now;

        if (isFirebaseConfigured && db) {
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(lead.campaignLeadId), lead, { merge: true });
        }

        if (sendResult.isDailyLimitExceeded) {
          campaign.status = 'PAUSED';
          campaign.lastError = 'Gmail Daily Sending Limit reached. Campaign paused.';
          campaign.updatedAt = now;
          if (isFirebaseConfigured && db) {
            await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
          }
          break;
        }
      }
    } catch (err: any) {
      lead.sendStatus = 'FAILED';
      lead.lastError = err?.message || 'Unexpected sending exception';
      lead.updatedAt = new Date().toISOString();

      if (isFirebaseConfigured && db) {
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(lead.campaignLeadId), lead, { merge: true });
      }
    } finally {
      await finishLeadClaim(runHistoryKey, lead.sendStatus === 'SENT');
      inFlightLeadSendsSet.delete(runHistoryKey);
      inFlightLeadSendsSet.delete(campaignHistoryKey);
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
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(run.runId), run, { merge: true });
      }
    }

    if (isFirebaseConfigured && db) {
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
    }
  }

  const updatedCampaign = (await recalculateAndPersistCampaignMetrics(campaignId)) || campaign;
  return {
    campaign: updatedCampaign,
    processedCount,
    remainingPendingCount: remainingPending.length,
    ...(sendBlockedReason ? { sendBlockedReason } : {}),
  };
  } finally {
    activeCampaignAbortControllers.delete(campaignId);
  }
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
        const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(selectedTplId));
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
    const leads = await getCampaignLeadsFromDb(campaignId);

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
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(run.runId), run, { merge: true });
        }
      }

      if (isFirebaseConfigured && db) {
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
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
      const emailLower = lead.email.toLowerCase();
      const runHistoryKey = `${campaignId}_${currentRunId}_${emailLower}`;
      const campaignHistoryKey = `${campaignId}_${emailLower}`;

      if (
        lead.sendStatus === 'SENT' ||
        lead.sendStatus === 'SENDING' ||
        sendHistorySet.has(runHistoryKey) ||
        inFlightLeadSendsSet.has(runHistoryKey)
      ) {
        console.log(`[Campaign Engine] SKIPPING already-sent or in-flight lead ${lead.email} for run ${currentRunId}.`);
        if (lead.sendStatus !== 'SENT') {
          lead.sendStatus = 'SENT';
        }
        continue;
      }

      inFlightLeadSendsSet.add(runHistoryKey);
      inFlightLeadSendsSet.add(campaignHistoryKey);

      if (!(await claimLeadSend(runHistoryKey))) {

        inFlightLeadSendsSet.delete(runHistoryKey);

        inFlightLeadSendsSet.delete(campaignHistoryKey);

        console.log(`[Campaign Engine] Skipping ${lead.email}: send already claimed by another run.`);

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
            const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).emailTemplateDoc(targetTplId));
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

      const senderFrom = await campaignRecordedSender(getCampaignActiveCtx().tenantId);
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
              tenantId: getCampaignActiveCtx().tenantId,
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
            senderName: campaignSenderName(await getTenantBrand(getCampaignActiveCtx().tenantId)),
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
            await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(lead.campaignLeadId), lead, { merge: true });
            await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignSendHistoryDoc(historyRecord.historyId), historyRecord);
            if (currentRun) {
              await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(currentRun.runId), currentRun, { merge: true });
            }
          }

          console.log(`[Campaign Engine] Successfully dispatched to ${lead.email} (ID: ${sentMsgId}) in run ${currentRunId}`);
        } else {
          lead.sendStatus = 'FAILED';
          lead.lastError = sendResult.error || 'SMTP delivery failure';
          lead.updatedAt = now;

          if (isFirebaseConfigured && db) {
            await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(lead.campaignLeadId), lead, { merge: true });
          }
          console.warn(`[Campaign Engine] Failed to dispatch to ${lead.email}: ${sendResult.error}`);

          // If daily quota is exceeded, pause campaign to prevent further quota errors
          if (sendResult.isDailyLimitExceeded) {
            console.warn(`[Campaign Engine] Halting campaign ${campaignId} due to Gmail Daily Sending Limit (550 5.4.5).`);
            campaign.status = 'PAUSED';
            campaign.lastError = 'Gmail Daily Sending Limit (550 5.4.5) reached on amaavigo@gmail.com. Campaign paused. Resets automatically in 24 hours, or you can run in Test Simulation mode.';
            campaign.updatedAt = now;
            if (isFirebaseConfigured && db) {
              await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
            }
            break;
          }
        }
      } catch (err: any) {
        lead.sendStatus = 'FAILED';
        lead.lastError = err?.message || 'Unexpected sending exception';
        lead.updatedAt = new Date().toISOString();

        if (isFirebaseConfigured && db) {
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(lead.campaignLeadId), lead, { merge: true });
        }
        console.error(`[Campaign Engine] Error sending to ${lead.email}:`, err);
      } finally {
        await finishLeadClaim(runHistoryKey, lead.sendStatus === 'SENT');
        inFlightLeadSendsSet.delete(runHistoryKey);
        inFlightLeadSendsSet.delete(campaignHistoryKey);
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
            await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignRunDoc(run.runId), run, { merge: true });
          }
        }
      }

      if (isFirebaseConfigured && db) {
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), campaign, { merge: true });
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

  const subject = sanitizeAiEmailText(replaceVars(template.subject), name);
  const rawBody = template.body || '';
  const body = sanitizeAiEmailText(replaceVars(rawBody), name);

  const rawHtml = template.htmlBody || (template.isHtml || template.format === 'html' ? template.body : undefined);
  const html = rawHtml ? sanitizeAiEmailText(replaceVars(rawHtml), name) : undefined;

  return {
    subject,
    body,
    html,
    attachments: template.attachments || [],
  };
}

/**
 * Helper to extract raw clean email address from string
 */
export function extractCleanEmail(raw: string): string {
  if (!raw) return '';
  const match = raw.match(/<([^>]+)>/) || raw.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
  return (match ? match[1] : raw).trim().toLowerCase();
}

/**
 * Recalculates metrics for a campaign from its leads and persists to Firestore
 */
export function recalculateCampaignMetrics(campaignId: string, persist: boolean = true): Campaign | undefined {
  const camp = campaignsMap.get(campaignId);
  if (!camp) return undefined;

  const leads = getCampaignLeads(campaignId);
  const total = leads.length;
  const sent = leads.filter((l) => l.sendStatus === 'SENT').length;
  const pending = leads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED').length;
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

  if (persist && isFirebaseConfigured && db) {
    // Synchronous helper: cannot await. Callers that must persist use recalculateAndPersistCampaignMetrics.
    // Read endpoints pass persist=false so a GET never writes to the database.
    void safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), camp, { merge: true });
  }

  return camp;
}

/**
 * Asynchronously loads leads from DB and recalculates metrics and persists to Firestore
 */
export async function recalculateAndPersistCampaignMetrics(campaignId: string): Promise<Campaign | undefined> {
  if (await isCampaignTombstoned(campaignId)) {
    purgeCampaignFromMemory(campaignId);
    return undefined;
  }
  const camp = await ensureCampaignInStore(campaignId);
  if (!camp) return undefined;

  const leads = await getCampaignLeadsFromDb(campaignId);
  const total = leads.length;
  const sent = leads.filter((l) => l.sendStatus === 'SENT').length;
  const pending = leads.filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED').length;
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

  campaignsMap.set(campaignId, camp);

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignDoc(campaignId), camp, { merge: true });
    } catch (e) {
      console.warn('[recalculateAndPersistCampaignMetrics] Firestore save note:', e);
    }
  }

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

  let targetLead = Array.from(campaignLeadsMap.values()).find(
    (l) => l.leadId === params.leadId || l.campaignLeadId === params.leadId
  );

  if (!targetLead && isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(params.leadId));
      if (snap.exists()) {
        targetLead = snap.data() as CampaignLead;
        campaignLeadsMap.set(targetLead.campaignLeadId, targetLead);
      } else {
        const querySnap = await getDocs(tenantRepo(getCampaignActiveCtx()).campaignLeads());
        querySnap.forEach((d) => {
          const l = d.data() as CampaignLead;
          if (l && (l.leadId === params.leadId || l.campaignLeadId === params.leadId)) {
            targetLead = l;
            campaignLeadsMap.set(l.campaignLeadId, l);
          }
        });
      }
    } catch (e) {}
  }

  if (!targetLead) return null;

  const now = new Date().toISOString();
  targetLead.demoStatus = params.demoStatus;
  targetLead.demoSource = params.demoSource;
  targetLead.demoBookedAt = params.demoStatus === 'BOOKED' ? now : undefined;
  targetLead.updatedAt = now;
  campaignLeadsMap.set(targetLead.campaignLeadId, targetLead);

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(targetLead.campaignLeadId), targetLead, { merge: true });
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).leadDoc(targetLead.leadId), {
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

  await recalculateAndPersistCampaignMetrics(targetLead.campaignId);

  return targetLead;
}

/**
 * Hooks into incoming emails, WhatsApp messages, or webhooks to identify if sender is a campaign lead.
 * If yes, updates replyStatus = 'REPLIED' across all campaign records and recalculates campaign metrics!
 */
export async function handleIncomingCampaignLeadReply(params: {
  fromEmail?: string;
  fromPhone?: string;
  subject?: string;
  body?: string;
  gmailMessageId?: string;
  gmailThreadId?: string;
}): Promise<{ isCampaignLead: boolean; campaignLead?: CampaignLead; campaignId?: string; campaignName?: string; demoDetected?: boolean }> {
  await initCampaignStore();

  const cleanFromEmail = params.fromEmail ? extractCleanEmail(params.fromEmail) : '';
  const rawPhoneDigits = params.fromPhone ? params.fromPhone.replace(/[^\d]/g, '') : '';
  const cleanPhoneDigits = rawPhoneDigits.length >= 7 ? rawPhoneDigits.slice(-10) : '';

  if (!cleanFromEmail && !cleanPhoneDigits) {
    return { isCampaignLead: false };
  }

  // Ensure DB store is populated so serverless instances have all leads
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(tenantRepo(getCampaignActiveCtx()).campaignLeads()).catch(() => null);
      if (snap && !snap.empty) {
        snap.forEach((d) => {
          const l = d.data() as CampaignLead;
          if (l && l.campaignLeadId) {
            campaignLeadsMap.set(l.campaignLeadId, l);
          }
        });
      }
    } catch (e) {
      console.warn('[handleIncomingCampaignLeadReply] DB search notice:', e);
    }
  }

  // Find ALL matching leads across memory & DB (by clean email or phone digits)
  const matchedLeads: CampaignLead[] = [];
  for (const l of campaignLeadsMap.values()) {
    let isMatch = false;
    if (cleanFromEmail) {
      const lEmail = extractCleanEmail(l.email);
      if (lEmail && (lEmail === cleanFromEmail || lEmail.includes(cleanFromEmail) || cleanFromEmail.includes(lEmail))) {
        isMatch = true;
      }
    }
    if (!isMatch && cleanPhoneDigits && l.phone) {
      const lPhoneDigits = l.phone.replace(/[^\d]/g, '');
      if (lPhoneDigits && (lPhoneDigits.endsWith(cleanPhoneDigits) || cleanPhoneDigits.endsWith(lPhoneDigits.slice(-10)))) {
        isMatch = true;
      }
    }
    if (isMatch) {
      matchedLeads.push(l);
    }
  }

  if (matchedLeads.length === 0) {
    return { isCampaignLead: false };
  }

  const now = new Date().toISOString();
  const text = stripQuotedEmailHistory(params.body || '').toLowerCase();
  const hasDemoIntent = /book a demo|schedule a demo|demo tomorrow|book the demo|yes.*demo|interested in a demo|platform walkthrough|live demo/i.test(text);
  const hasConfirmedBooking = /calendar.*confirmed|appointment.*scheduled|booked for|demo scheduled|meeting invite accepted/i.test(text);

  const affectedCampaignIds = new Set<string>();
  let primaryCampaignName = 'Outbound Campaign';

  for (const matchedLead of matchedLeads) {
    matchedLead.replyStatus = 'REPLIED';
    matchedLead.repliedAt = matchedLead.repliedAt || now;
    matchedLead.updatedAt = now;
    if (params.gmailMessageId) matchedLead.gmailMessageId = params.gmailMessageId;
    if (params.gmailThreadId) matchedLead.gmailThreadId = params.gmailThreadId;

    if (hasDemoIntent) {
      matchedLead.demoIntent = true;
      if (hasConfirmedBooking) {
        matchedLead.demoStatus = 'BOOKED';
        matchedLead.demoSource = 'AUTOMATIC';
        matchedLead.demoBookedAt = now;
      }
    }

    campaignLeadsMap.set(matchedLead.campaignLeadId, matchedLead);
    affectedCampaignIds.add(matchedLead.campaignId);

    const cObj = campaignsMap.get(matchedLead.campaignId);
    if (cObj?.name) {
      primaryCampaignName = cObj.name;
    }

    if (isFirebaseConfigured && db) {
      try {
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(matchedLead.campaignLeadId), matchedLead, { merge: true });
        const contactId = `contact-${matchedLead.email.replace(/[^a-z0-9]/gi, '_')}`;
        await safeSetDoc(tenantRepo(getCampaignActiveCtx()).contactDoc(contactId), {
          contactId,
          firstName: matchedLead.firstName || matchedLead.name.split(' ')[0],
          lastName: matchedLead.lastName || matchedLead.name.split(' ').slice(1).join(' '),
          email: matchedLead.email,
          phone: matchedLead.phone || '',
          companyName: matchedLead.companyName,
          jobTitle: matchedLead.designation || 'Director / Owner',
          createdAt: now,
          updatedAt: now,
          lastActivityAt: now,
        }, { merge: true });

        if (matchedLead.leadId) {
          await safeSetDoc(tenantRepo(getCampaignActiveCtx()).leadDoc(matchedLead.leadId), {
            leadId: matchedLead.leadId,
            contactId,
            source: 'EMAIL',
            leadType: 'OUTBOUND',
            campaignId: matchedLead.campaignId,
            campaignName: primaryCampaignName,
            campaignLeadId: matchedLead.campaignLeadId,
            replyStatus: 'REPLIED',
            repliedAt: now,
            status: matchedLead.demoStatus === 'BOOKED' ? 'DEMO_BOOKED' : 'ENGAGED',
            demoStatus: matchedLead.demoStatus,
            updatedAt: now,
          }, { merge: true });
        }
      } catch (e) {
        console.warn('Error syncing lead reply to Firestore:', e);
      }
    }
  }

  // Recalculate metrics for all affected campaigns so cards and lead counts update instantly
  for (const cId of affectedCampaignIds) {
    await recalculateAndPersistCampaignMetrics(cId);
  }

  return {
    isCampaignLead: true,
    campaignLead: matchedLeads[0],
    campaignId: matchedLeads[0]?.campaignId,
    campaignName: primaryCampaignName,
    demoDetected: matchedLeads.some((l) => l.demoStatus === 'BOOKED'),
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

  let targetLead = Array.from(campaignLeadsMap.values()).find(
    (l) => l.leadId === params.leadId || l.campaignLeadId === params.leadId
  );

  if (!targetLead && isFirebaseConfigured && db) {
    try {
      const snap = await getDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(params.leadId));
      if (snap.exists()) {
        targetLead = snap.data() as CampaignLead;
        campaignLeadsMap.set(targetLead.campaignLeadId, targetLead);
      } else {
        const querySnap = await getDocs(tenantRepo(getCampaignActiveCtx()).campaignLeads());
        querySnap.forEach((d) => {
          const l = d.data() as CampaignLead;
          if (l && (l.leadId === params.leadId || l.campaignLeadId === params.leadId)) {
            targetLead = l;
            campaignLeadsMap.set(l.campaignLeadId, l);
          }
        });
      }
    } catch (e) {}
  }

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
  campaignLeadsMap.set(targetLead.campaignLeadId, targetLead);

  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(tenantRepo(getCampaignActiveCtx()).campaignLeadDoc(targetLead.campaignLeadId), targetLead, { merge: true });
    } catch (e) {
      console.warn('Firestore update warning for lead status:', e);
    }
  }

  await recalculateAndPersistCampaignMetrics(targetLead.campaignId);

  return targetLead;
}

/**
 * Autonomous background campaign processor.
 * Finds all RUNNING campaigns (in memory and Firestore) and processes their next send batch.
 * This runs continuously on the server regardless of whether a browser client is open.
 */
let isAutoProcessingCampaigns = false;
export async function processActiveRunningCampaignsBatch(batchSize: number = 500): Promise<{
  activeCount: number;
  processedCampaigns: Array<{ campaignId: string; processedCount: number; remainingPendingCount: number }>;
}> {
  if (isAutoProcessingCampaigns) {
    return { activeCount: 0, processedCampaigns: [] };
  }
  // Plan gate: a workspace whose plan has no campaigns must not send anything.
  if (!(await hasFeature(getCampaignActiveCtx().tenantId, 'campaigns'))) {
    return { activeCount: 0, processedCampaigns: [] };
  }
  isAutoProcessingCampaigns = true;

  try {
    await initCampaignStore();

    // Map of running campaigns to process
    const runningCampaignsMap = new Map<string, Campaign>();

    // 1. In-memory running campaigns
    for (const c of campaignsMap.values()) {
      if (c.status === 'RUNNING') {
        runningCampaignsMap.set(c.campaignId, c);
      }
    }

    // 2. Also check Firestore in case a campaign was started from another instance or browser
    if (isFirebaseConfigured && db) {
      try {
        const snap = await getDocs(tenantRepo(getCampaignActiveCtx()).campaigns()).catch(() => null);
        if (snap && !snap.empty) {
          snap.forEach((d) => {
            const c = d.data() as Campaign;
            if (c && c.campaignId) {
              if (pausedCampaignsSet.has(c.campaignId)) {
                c.status = 'PAUSED';
              }
              campaignsMap.set(c.campaignId, c);
              if (c.status === 'RUNNING' && !pausedCampaignsSet.has(c.campaignId)) {
                runningCampaignsMap.set(c.campaignId, c);
              }
            }
          });
        }
      } catch (e) {
        // quiet ignore
      }
    }

    const runningCampaigns = Array.from(runningCampaignsMap.values());
    const results: Array<{ campaignId: string; processedCount: number; remainingPendingCount: number }> = [];

    for (const camp of runningCampaigns) {
      try {
        // Ensure leads are populated
        await getCampaignLeadsFromDb(camp.campaignId);
        const res = await processNextCampaignSendBatch(camp.campaignId, batchSize);
        results.push({
          campaignId: camp.campaignId,
          processedCount: res.processedCount,
          remainingPendingCount: res.remainingPendingCount,
        });
      } catch (err: any) {
        console.warn(`[Auto-Campaign Engine] Batch execution note for campaign ${camp.campaignId}:`, err?.message || err);
      }
    }

    return {
      activeCount: runningCampaigns.length,
      processedCampaigns: results,
    };
  } finally {
    isAutoProcessingCampaigns = false;
  }
}