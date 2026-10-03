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
  query,
  where,
  writeBatch,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc, sanitizeForFirestore } from './firestoreUtils.js';
import {
  sendViaResend,
  sendBatchViaResend,
  sleep,
  formatFromAddress,
  textToHtml,
  sanitizeTagValue,
  RESEND_BATCH_LIMIT,
  RESEND_CALL_SPACING_MS,
  type ResendEmailPayload,
} from './resendService.js';
import { planIdentityAssignments, bumpIdentityUsage } from './sendingIdentities.js';
import { isSuppressed, buildComplianceExtras } from './emailSuppression.js';
import { appendOutboundMessageToThread } from './inboundPipeline.js';
import {
  Campaign,
  CampaignLead,
  CampaignRun,
  EmailTemplate,
  CampaignSendHistory,
  DemoStatus,
  DemoSource,
  SendingIdentity,
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

export const DEFAULT_CAMPAIGNS: Campaign[] = [];
export const DEFAULT_CAMPAIGN_LEADS: CampaignLead[] = [];
export const DEFAULT_CAMPAIGN_RUNS: CampaignRun[] = [];

// In-Memory state caches
const campaignsMap = new Map<string, Campaign>();
const campaignLeadsMap = new Map<string, CampaignLead>(); // key: campaignLeadId
const campaignRunsMap = new Map<string, CampaignRun>(); // key: runId
const emailTemplatesMap = new Map<string, EmailTemplate>(); // key: templateId
const sendHistorySet = new Set<string>(); // key: `${campaignId}_${email.toLowerCase()}`

// Active sending abort flags per campaign
const activeCampaignAbortControllers = new Map<string, AbortController>();

let isCampaignStoreInitialized = false;

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
let hasLoadedLeadsAndHistory = false;

export async function syncCampaignStoreFromFirestore(forceFull: boolean = false): Promise<void> {
  ensureDefaultsInMemory();

  if (!isFirebaseConfigured || !db) return;

  // Add 2.5s timeout wrapper to prevent hanging serverless responses on Vercel
  const timeoutPromise = new Promise<void>((resolve) => setTimeout(resolve, 2500));

  const syncPromise = (async () => {
    try {
      // Execute all 5 Firestore queries concurrently in parallel
      // Leads and send history can be huge (50k+ docs), so they are loaded only once per process;
      // after that this process is the writer and its memory is authoritative for them.
      const loadHeavy = forceFull || !hasLoadedLeadsAndHistory;
      const [tplSnap, campSnap, leadsSnap, runsSnap, historySnap] = await Promise.all([
        getDocs(collection(db, 'email_templates')).catch(() => null),
        getDocs(collection(db, 'campaigns')).catch(() => null),
        loadHeavy ? getDocs(collection(db, 'campaign_leads')).catch(() => null) : Promise.resolve(null),
        getDocs(collection(db, 'campaign_runs')).catch(() => null),
        loadHeavy ? getDocs(collection(db, 'campaign_send_history')).catch(() => null) : Promise.resolve(null),
      ]);
      if (loadHeavy && leadsSnap && historySnap) hasLoadedLeadsAndHistory = true;

      if (tplSnap) {
        const firestoreTpls: EmailTemplate[] = [];
        tplSnap.forEach((d) => {
          const data = d.data() as EmailTemplate;
          if (data && data.templateId) {
            firestoreTpls.push(data);
          }
        });

        // Check if database was ever initialized for templates
        const metaDocRef = doc(db, 'system_metadata', 'templates_initialized');
        const metaDocSnap = await getDoc(metaDocRef).catch(() => null);

        if (!metaDocSnap?.exists()) {
          // Brand new database initialization ONLY: seed default templates once
          if (firestoreTpls.length === 0) {
            for (const tpl of DEFAULT_EMAIL_TEMPLATES) {
              await safeSetDoc(doc(db, 'email_templates', tpl.templateId), tpl, { merge: true }).catch(() => {});
              firestoreTpls.push(tpl);
            }
          }
          await safeSetDoc(metaDocRef, { initialized: true, initializedAt: new Date().toISOString() }).catch(() => {});
        }

        // In-memory templates map strictly mirrors Firestore database
        emailTemplatesMap.clear();
        for (const tpl of firestoreTpls) {
          emailTemplatesMap.set(tpl.templateId, tpl);
        }
      }

      if (campSnap) {
        const previous = new Map(campaignsMap);
        campaignsMap.clear();
        campSnap.forEach((d) => {
          const data = d.data() as Campaign;
          if (data && data.campaignId) {
            const cleanName = (data.name || '').toLowerCase().trim();
            if (
              data.campaignId === 'camp-umrah-1448' ||
              data.campaignId === 'camp-indian-umrah-operators' ||
              cleanName === 'indian umrah operators 2026'
            ) {
              deleteDoc(doc(db, 'campaigns', d.id)).catch(() => {});
              deleteDoc(doc(db, 'outbound_campaigns', d.id)).catch(() => {});
            } else {
              // keep our in-memory copy if it is newer than what Firestore returned (writes are async)
              const mem = previous.get(data.campaignId);
              campaignsMap.set(
                data.campaignId,
                mem && mem.updatedAt && data.updatedAt && mem.updatedAt > data.updatedAt ? mem : data
              );
            }
          }
        });
      }

      if (leadsSnap) {
        campaignLeadsMap.clear();
        leadsSnap.forEach((d) => {
          const data = d.data() as CampaignLead;
          if (data && data.campaignLeadId) {
            campaignLeadsMap.set(data.campaignLeadId, data);
          }
        });
      }

      if (runsSnap) {
        const previousRuns = new Map(campaignRunsMap);
        campaignRunsMap.clear();
        runsSnap.forEach((d) => {
          const data = d.data() as CampaignRun;
          if (data && data.runId) {
            const mem = previousRuns.get(data.runId);
            campaignRunsMap.set(data.runId, mem && (mem.sentCount || 0) > (data.sentCount || 0) ? mem : data);
          }
        });
      }

      if (historySnap) {
        historySnap.forEach((d) => {
          const data = d.data() as CampaignSendHistory;
          if (data && data.campaignId && data.email && data.status === 'SENT') {
            sendHistorySet.add(`${data.campaignId}_${data.email.toLowerCase()}`);
            if (data.campaignRunId) {
              sendHistorySet.add(`${data.campaignId}_${data.campaignRunId}_${data.email.toLowerCase()}`);
            }
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
      const snap = await getDoc(doc(db, 'email_templates', templateId));
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
    subject: (template.subject || existing?.subject || 'Umrah360 Solutions for {{company}}').trim(),
    body: (template.body || existing?.body || '').trim(),
    htmlBody: template.htmlBody !== undefined ? template.htmlBody : existing?.htmlBody,
    format: template.format || (isHtml ? 'html' : 'text') || existing?.format || 'text',
    isHtml,
    attachments: template.attachments || existing?.attachments || [],
    clientId: template.clientId !== undefined ? template.clientId : existing?.clientId,
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
  return Array.from(campaignLeadsMap.values())
    .filter((l) => l.campaignId === campaignId)
    .sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
}

export async function getCampaignLeadsFromDb(campaignId: string): Promise<CampaignLead[]> {
  if (campaignsMap.size === 0) {
    ensureDefaultsInMemory();
  }
  let leads = getCampaignLeads(campaignId);

  if (leads.length === 0 && isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(query(collection(db, 'campaign_leads'), where('campaignId', '==', campaignId))).catch(() => null);
      if (snap && !snap.empty) {
        snap.forEach((d) => {
          const l = d.data() as CampaignLead;
          if (l && l.campaignLeadId && !campaignLeadsMap.has(l.campaignLeadId)) {
            campaignLeadsMap.set(l.campaignLeadId, l);
          }
        });
        leads = getCampaignLeads(campaignId);
      }
    } catch (e) {
      console.warn('Error fetching campaign_leads from Firestore:', e);
    }
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
      deletePromises.push(deleteDoc(doc(db, 'campaigns', campaignId)).catch(() => {}));
      deletePromises.push(deleteDoc(doc(db, 'outbound_campaigns', campaignId)).catch(() => {}));

      // B. Delete all leads belonging to this campaign
      const leadsSnap = await getDocs(collection(db, 'campaign_leads')).catch(() => null);
      if (leadsSnap && !leadsSnap.empty) {
        leadsSnap.forEach((d) => {
          const lData = d.data();
          if (lData && lData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(doc(db, 'campaign_leads', d.id)).catch(() => {}));
          }
        });
      }

      // C. Delete all runs belonging to this campaign
      const runsSnap = await getDocs(collection(db, 'campaign_runs')).catch(() => null);
      if (runsSnap && !runsSnap.empty) {
        runsSnap.forEach((d) => {
          const rData = d.data();
          if (rData && rData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(doc(db, 'campaign_runs', d.id)).catch(() => {}));
          }
        });
      }

      // D. Delete all send history belonging to this campaign
      const histSnap = await getDocs(collection(db, 'campaign_send_history')).catch(() => null);
      if (histSnap && !histSnap.empty) {
        histSnap.forEach((d) => {
          const hData = d.data();
          if (hData && hData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(doc(db, 'campaign_send_history', d.id)).catch(() => {}));
          }
        });
      }

      // E. Delete any outbound_prospects belonging to this campaign
      const prospectSnap = await getDocs(collection(db, 'outbound_prospects')).catch(() => null);
      if (prospectSnap && !prospectSnap.empty) {
        prospectSnap.forEach((d) => {
          const pData = d.data();
          if (pData && pData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(doc(db, 'outbound_prospects', d.id)).catch(() => {}));
          }
        });
      }

      // F. Delete any conversations and messages linked to this campaign
      const convSnap = await getDocs(collection(db, 'conversations')).catch(() => null);
      if (convSnap && !convSnap.empty) {
        const convIdsToDelete: string[] = [];
        convSnap.forEach((d) => {
          const cData = d.data();
          if (cData && cData.campaignId === campaignId) {
            convIdsToDelete.push(d.id);
            deletePromises.push(deleteDoc(doc(db, 'conversations', d.id)).catch(() => {}));
          }
        });
        if (convIdsToDelete.length > 0) {
          const msgsSnap = await getDocs(collection(db, 'messages')).catch(() => null);
          if (msgsSnap && !msgsSnap.empty) {
            msgsSnap.forEach((d) => {
              const mData = d.data();
              if (mData && convIdsToDelete.includes(mData.conversationId)) {
                deletePromises.push(deleteDoc(doc(db, 'messages', d.id)).catch(() => {}));
              }
            });
          }
        }
      }

      // G. Delete any CRM leads linked to this campaign
      const crmLeadsSnap = await getDocs(collection(db, 'leads')).catch(() => null);
      if (crmLeadsSnap && !crmLeadsSnap.empty) {
        crmLeadsSnap.forEach((d) => {
          const lData = d.data();
          if (lData && lData.campaignId === campaignId) {
            deletePromises.push(deleteDoc(doc(db, 'leads', d.id)).catch(() => {}));
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
  /** Tenant that owns the campaign (undefined = platform). */
  clientId?: string;
  /** Restrict sending to these identities; empty/undefined = all of the client's active identities. */
  identityIds?: string[];
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
    clientId: params.clientId || undefined,
    identityIds: params.identityIds && params.identityIds.length > 0 ? params.identityIds : undefined,
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
      clientId: params.clientId || undefined,
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
      // Batched writes (400 per commit) — a 50k-lead upload is ~125 commits instead of 50k requests
      await commitWrites(createdLeads.map((cl) => ({ col: 'campaign_leads', id: cl.campaignLeadId, data: cl })));
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

  campaign.lastError = '';
  campaignNextAttemptAt.delete(campaignId);

  // Send a small first batch right away so the user sees movement; the server poller continues from there.
  const batchRes = await processNextCampaignSendBatch(campaignId, INITIAL_SEND_BATCH_SIZE).catch((err) => {
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
  const leadWrites: FirestoreWrite[] = [];
  unrepliedLeads.forEach((l) => {
    l.sendStatus = 'PENDING';
    l.lastError = undefined;
    l.campaignRunId = newRunId;
    l.updatedAt = now;
    targetLeadsCount++;
    campaignLeadsMap.set(l.campaignLeadId, l);
    leadWrites.push({ col: 'campaign_leads', id: l.campaignLeadId, data: l, merge: true });
  });

  // Keep replied leads untouched with their REPLIED status preserved
  repliedLeads.forEach((l) => {
    // Ensure they are not queued
    if (l.sendStatus === 'PENDING' || l.sendStatus === 'SENDING') {
      l.sendStatus = 'SENT';
    }
    l.updatedAt = now;
    campaignLeadsMap.set(l.campaignLeadId, l);
    leadWrites.push({ col: 'campaign_leads', id: l.campaignLeadId, data: l, merge: true });
  });

  await commitWrites(leadWrites);

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
      safeSetDoc(doc(db, 'campaigns', campaignId), campaign, { merge: true }),
      safeSetDoc(doc(db, 'campaign_runs', newRunId), newRun),
    ]).catch(() => {});
  }

  await recalculateAndPersistCampaignMetrics(campaignId);

  message = `Run #${nextRunNumber} started. Sending follow-up to ${targetLeadsCount} unreplied lead(s). (${repliedLeads.length} lead(s) skipped because they already replied).`;
  console.log(`[Campaign Engine] ${message}`);

  campaign.lastError = '';
  campaignNextAttemptAt.delete(campaignId);

  const batchRes = await processNextCampaignSendBatch(campaignId, INITIAL_SEND_BATCH_SIZE).catch((err) => {
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

// -------------------------------------------------------------
// SEND ENGINE (Resend)
//
// One code path for every trigger (manual start/restart, the 4-second server poller, the browser
// poll, a Vercel cron): processNextCampaignSendBatch().
//
//  1. pick up to N pending leads (skipping replied / already-sent / suppressed addresses)
//  2. assign each lead a sending identity (rotation + per-domain daily caps + sticky per lead)
//  3. build the email (template or AI), add unsubscribe link/headers
//  4. send via Resend: up to 100 per request through the batch endpoint, attachments one by one
//  5. persist results with Firestore write batches (not one write per document)
//
// Run ONE worker instance: the lead store and daily usage counters live in this process' memory.
// -------------------------------------------------------------

/** Emails per processing pass for template campaigns / AI-personalised campaigns. */
const DEFAULT_SEND_BATCH_SIZE = 100;
const INITIAL_SEND_BATCH_SIZE = 5;
const AI_SEND_BATCH_SIZE = 10;
const MAX_SEND_BATCH_SIZE = 500;
const AI_GENERATION_CONCURRENCY = 5;
const CONTENT_PREP_CONCURRENCY = 20;
const STALE_CLAIM_MS = 10 * 60 * 1000;
const CAPACITY_RETRY_DELAY_MS = 60 * 1000;
const RATE_LIMIT_RETRY_DELAY_MS = 10 * 1000;
const FIRESTORE_BATCH_LIMIT = 400;
const CAPACITY_ERROR_PREFIX = 'All sending domains have reached today';

const campaignBatchLocks = new Set<string>();
const campaignNextAttemptAt = new Map<string, number>();

interface PreparedSend {
  lead: CampaignLead;
  subject: string;
  text: string;
  html?: string;
  attachments: any[];
  identity: SendingIdentity | null; // null when the campaign runs in simulation mode
}

interface SendOutcome {
  prepared: PreparedSend;
  ok: boolean;
  messageId?: string;
  error?: string;
}

type StopReason = 'quota' | 'rate' | 'paused' | null;

interface FirestoreWrite {
  col: string;
  id: string;
  data: any;
  merge?: boolean;
}

function resolveBatchSize(campaign: Campaign, requested?: number): number {
  if (requested && requested > 0) return Math.min(Math.floor(requested), MAX_SEND_BATCH_SIZE);
  return campaign.campaignMode === 'AI_GENERATED' && !campaign.templateId ? AI_SEND_BATCH_SIZE : DEFAULT_SEND_BATCH_SIZE;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(Math.max(1, limit), items.length) }, async () => {
    while (true) {
      const i = next++;
      if (i >= items.length) return;
      results[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return results;
}

/** Writes documents in Firestore batches (max 400 operations each) instead of one request per document. */
async function commitWrites(writes: FirestoreWrite[]): Promise<void> {
  if (!isFirebaseConfigured || !db || writes.length === 0) return;
  for (let i = 0; i < writes.length; i += FIRESTORE_BATCH_LIMIT) {
    const slice = writes.slice(i, i + FIRESTORE_BATCH_LIMIT);
    try {
      const batch = writeBatch(db);
      for (const w of slice) {
        const ref = doc(db, w.col, w.id);
        const data = sanitizeForFirestore(w.data);
        if (w.merge) batch.set(ref, data, { merge: true });
        else batch.set(ref, data);
      }
      await batch.commit();
    } catch (err) {
      console.warn(`[Campaign Engine] Firestore batch write failed (${slice.length} docs):`, err);
    }
  }
}

async function resolveCampaignTemplate(campaign: Campaign): Promise<EmailTemplate> {
  const selectedTplId = campaign.templateId || '';
  let template: EmailTemplate | undefined = getTemplateById(selectedTplId);
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
  return template;
}

function markCampaignCompleted(campaign: Campaign, runId: string) {
  const now = new Date().toISOString();
  campaign.status = 'COMPLETED';
  campaign.completedAt = now;
  campaign.updatedAt = now;

  const run = campaignRunsMap.get(runId);
  if (run) {
    run.status = 'COMPLETED';
    run.completedAt = now;
    if (isFirebaseConfigured && db) {
      safeSetDoc(doc(db, 'campaign_runs', run.runId), run, { merge: true }).catch(() => {});
    }
  }
  if (isFirebaseConfigured && db) {
    safeSetDoc(doc(db, 'campaigns', campaign.campaignId), campaign, { merge: true }).catch(() => {});
  }
  console.log(`[Campaign Engine] Campaign ${campaign.name} [Run: ${runId}] marked COMPLETED.`);
}

function persistCampaign(campaign: Campaign) {
  if (isFirebaseConfigured && db) {
    safeSetDoc(doc(db, 'campaigns', campaign.campaignId), campaign, { merge: true }).catch(() => {});
  }
}

/** Builds the subject/body (+ attachments) for one lead — AI-generated or from the campaign template. */
async function prepareLeadContent(
  campaign: Campaign,
  template: EmailTemplate,
  lead: CampaignLead
): Promise<{ subject: string; text: string; html?: string; attachments: any[] }> {
  let subject = '';
  let text = '';
  let html: string | undefined = undefined;
  let attachments: any[] = [];

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
    text = lead.generatedBody || `Hi ${lead.name},\n\nI noticed your operations at ${lead.companyName}.`;
  } else {
    let activeTpl = getTemplateById(template.templateId);
    if (!activeTpl) activeTpl = template;
    const personalized = personalizeTemplate(activeTpl, lead);
    subject = personalized.subject;
    text = personalized.body;
    html = personalized.html;

    if (activeTpl.attachments && activeTpl.attachments.length > 0) {
      attachments = activeTpl.attachments.map((att: any) => ({
        filename: att.name || att.filename || 'attachment',
        contentType: att.type || att.contentType,
        dataUrl: att.dataUrl,
        content: att.base64 || att.content,
        encoding: att.base64 ? 'base64' : undefined,
      }));
    }
    lead.generatedSubject = subject;
    lead.generatedBody = text;
  }

  return { subject, text, html, attachments };
}

function buildResendPayload(p: PreparedSend, campaign: Campaign, runId: string, withIdempotencyKey: boolean): ResendEmailPayload {
  const identity = p.identity as SendingIdentity;
  const replyTo = identity.replyTo || identity.fromEmail;
  const extras = buildComplianceExtras({
    clientId: campaign.clientId,
    email: p.lead.email,
    campaignId: campaign.campaignId,
    replyTo,
  });

  const htmlBase = p.html !== undefined ? p.html : textToHtml(p.text);

  return {
    from: formatFromAddress(identity.fromName, identity.fromEmail),
    to: p.lead.email,
    subject: p.subject,
    text: p.text + extras.textFooter,
    html: htmlBase + extras.htmlFooter,
    replyTo,
    headers: { 'X-Mailer': 'Umrah360-AI-Automated-Platform', ...extras.headers },
    attachments: p.attachments.length > 0 ? p.attachments : undefined,
    tags: [
      { name: 'campaign_id', value: sanitizeTagValue(campaign.campaignId) },
      { name: 'client_id', value: sanitizeTagValue(campaign.clientId || 'platform') },
    ],
    idempotencyKey: withIdempotencyKey ? `${campaign.campaignId}:${runId}:${p.lead.campaignLeadId}` : undefined,
  };
}

/** Applies send results to leads/history/inbox, refunds capacity for failures and persists everything in write batches. */
async function applyOutcomes(outcomes: SendOutcome[], campaign: Campaign, runId: string, template: EmailTemplate): Promise<number> {
  if (outcomes.length === 0) return 0;

  const now = new Date().toISOString();
  const writes: FirestoreWrite[] = [];
  const currentRun = campaignRunsMap.get(runId);
  let successCount = 0;
  const refunds = new Map<string, number>();

  for (const o of outcomes) {
    const lead = o.prepared.lead;
    const identity = o.prepared.identity;
    lead.claimedAt = '';
    lead.updatedAt = now;

    if (o.ok) {
      successCount++;
      const sentMsgId = o.messageId || `<camp-${Date.now()}@umrah360.in>`;
      const conversationId = lead.conversationId || `conv-${lead.leadId}`;
      const gmailThreadId = lead.gmailThreadId || `thread-${lead.leadId}`;
      const senderFrom = identity ? formatFromAddress(identity.fromName, identity.fromEmail) : 'simulation@umrah360.in';

      lead.sendStatus = 'SENT';
      lead.sendCount = (lead.sendCount || 0) + 1;
      lead.lastSentAt = now;
      lead.gmailMessageId = sentMsgId;
      lead.gmailThreadId = gmailThreadId;
      lead.conversationId = conversationId;
      lead.campaignRunId = runId;
      lead.lastError = '';

      sendHistorySet.add(`${campaign.campaignId}_${runId}_${lead.email.toLowerCase()}`);
      sendHistorySet.add(`${campaign.campaignId}_${lead.email.toLowerCase()}`);

      const historyRecord: CampaignSendHistory = {
        historyId: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        campaignId: campaign.campaignId,
        campaignRunId: runId,
        campaignLeadId: lead.campaignLeadId,
        email: lead.email,
        templateId: template.templateId,
        subject: o.prepared.subject,
        gmailMessageId: sentMsgId,
        sentAt: now,
        status: 'SENT',
      };
      writes.push({ col: 'campaign_send_history', id: historyRecord.historyId, data: historyRecord });

      if (currentRun) currentRun.sentCount = (currentRun.sentCount || 0) + 1;

      appendOutboundMessageToThread(conversationId, {
        messageId: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        gmailMessageId: sentMsgId,
        gmailThreadId,
        conversationId,
        channel: 'EMAIL',
        direction: 'OUTBOUND',
        senderType: 'AGENT',
        senderName: identity?.fromName || 'Umrah360 Growth Team',
        senderEmail: senderFrom,
        text: o.prepared.text,
        sentAt: now,
        receivedAt: now,
        createdAt: now,
        timestamp: now,
        emailMeta: {
          subject: o.prepared.subject,
          from: senderFrom,
          to: lead.email,
          messageId: sentMsgId,
        },
      });
    } else {
      lead.sendStatus = 'FAILED';
      lead.lastError = o.error || 'Email delivery failure';
      if (identity) refunds.set(identity.identityId, (refunds.get(identity.identityId) || 0) + 1);
    }

    writes.push({ col: 'campaign_leads', id: lead.campaignLeadId, data: lead, merge: true });
  }

  if (currentRun) writes.push({ col: 'campaign_runs', id: currentRun.runId, data: currentRun, merge: true });

  for (const [identityId, count] of refunds) {
    await bumpIdentityUsage(identityId, -count).catch(() => {});
  }
  await commitWrites(writes);
  return successCount;
}

/**
 * Processes the next batch of pending leads for a campaign. Safe to call from several triggers at once:
 * a per-campaign lock makes overlapping calls return immediately.
 */
export async function processNextCampaignSendBatch(
  campaignId: string,
  maxBatchSize?: number
): Promise<{
  campaign: Campaign;
  processedCount: number;
  remainingPendingCount: number;
}> {
  if (campaignBatchLocks.has(campaignId)) {
    const camp = await ensureCampaignInStore(campaignId);
    if (!camp) throw new Error(`Campaign ${campaignId} not found`);
    const pending = getCampaignLeads(campaignId).filter((l) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED').length;
    return { campaign: camp, processedCount: 0, remainingPendingCount: pending };
  }

  campaignBatchLocks.add(campaignId);
  try {
    return await runCampaignSendBatch(campaignId, maxBatchSize);
  } finally {
    campaignBatchLocks.delete(campaignId);
  }
}

async function runCampaignSendBatch(
  campaignId: string,
  requestedSize?: number
): Promise<{ campaign: Campaign; processedCount: number; remainingPendingCount: number }> {
  const campaign = await ensureCampaignInStore(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  const currentRunId = campaign.currentRunId || `run-${campaignId}-1`;
  const template = await resolveCampaignTemplate(campaign);
  const leads = await getCampaignLeadsFromDb(campaignId); // same object references as the in-memory store
  const isPending = (l: CampaignLead) => l.sendStatus === 'PENDING' && l.replyStatus !== 'REPLIED';
  const idle = (): { campaign: Campaign; processedCount: number; remainingPendingCount: number } => ({
    campaign: recalculateCampaignMetrics(campaignId) || campaign,
    processedCount: 0,
    remainingPendingCount: leads.filter(isPending).length,
  });

  // Release claims left behind by a crashed/restarted worker
  const nowMs = Date.now();
  for (const l of leads) {
    if (l.sendStatus === 'SENDING' && (!l.claimedAt || nowMs - new Date(l.claimedAt).getTime() > STALE_CLAIM_MS)) {
      l.sendStatus = 'PENDING';
      l.claimedAt = '';
    }
  }

  if (campaign.status !== 'RUNNING') return idle();

  const retryAt = campaignNextAttemptAt.get(campaignId);
  if (retryAt && nowMs < retryAt) return idle();

  const pendingLeads = leads.filter(isPending);
  if (pendingLeads.length === 0) {
    if (!leads.some((l) => l.sendStatus === 'SENDING')) markCampaignCompleted(campaign, currentRunId);
    return {
      campaign: recalculateCampaignMetrics(campaignId) || campaign,
      processedCount: 0,
      remainingPendingCount: 0,
    };
  }

  // ---- 1. choose the leads for this pass ---------------------------------
  const size = resolveBatchSize(campaign, requestedSize);
  const sendable: CampaignLead[] = [];
  const touched: CampaignLead[] = []; // leads whose status changed without a send (already sent / suppressed)
  const nowIso = new Date().toISOString();

  for (const lead of pendingLeads) {
    if (sendable.length >= size) break;

    if (sendHistorySet.has(`${campaignId}_${currentRunId}_${lead.email.toLowerCase()}`)) {
      lead.sendStatus = 'SENT';
      touched.push(lead);
      continue;
    }
    if (await isSuppressed(campaign.clientId, lead.email)) {
      lead.sendStatus = 'FAILED';
      lead.lastError = 'Suppressed (unsubscribed, bounced or marked as spam)';
      lead.updatedAt = nowIso;
      touched.push(lead);
      continue;
    }
    sendable.push(lead);
  }

  const flushTouched = async () => {
    await commitWrites(touched.map((l) => ({ col: 'campaign_leads', id: l.campaignLeadId, data: l, merge: true })));
  };

  // ---- 2. assign sending identities (rotation + daily caps) --------------
  const isSimulation = campaign.deliveryMode === 'SIMULATION';
  let assignments = new Map<string, SendingIdentity>();
  let toSend: CampaignLead[] = sendable;

  if (!isSimulation && sendable.length > 0) {
    const plan = await planIdentityAssignments({
      clientId: campaign.clientId,
      allowedIdentityIds: campaign.identityIds,
      leads: sendable.map((l) => ({ key: l.campaignLeadId, stickyIdentityId: l.identityId })),
    });

    if (plan.noIdentities) {
      campaign.status = 'PAUSED';
      campaign.lastError =
        'No active sending domain is configured. Add a verified domain under Settings → Sending Domains, then start the campaign again.';
      campaign.updatedAt = new Date().toISOString();
      persistCampaign(campaign);
      await flushTouched();
      return idle();
    }

    assignments = plan.assignments;
    toSend = sendable.filter((l) => assignments.has(l.campaignLeadId));

    if (toSend.length === 0) {
      campaign.lastError = `${CAPACITY_ERROR_PREFIX}'s limit. Sending resumes automatically after 00:00 UTC, or raise a daily cap in Settings → Sending Domains.`;
      campaign.updatedAt = new Date().toISOString();
      persistCampaign(campaign);
      campaignNextAttemptAt.set(campaignId, Date.now() + CAPACITY_RETRY_DELAY_MS);
      await flushTouched();
      return idle();
    }
  }

  if (campaign.lastError && campaign.lastError.startsWith(CAPACITY_ERROR_PREFIX)) {
    campaign.lastError = '';
    campaign.updatedAt = new Date().toISOString();
    persistCampaign(campaign);
  }
  campaignNextAttemptAt.delete(campaignId);

  const claimIso = new Date().toISOString();
  for (const lead of toSend) {
    lead.sendStatus = 'SENDING';
    lead.claimedAt = claimIso;
    const idn = assignments.get(lead.campaignLeadId);
    if (idn) lead.identityId = idn.identityId;
  }

  // ---- 3. build the emails ------------------------------------------------
  const prepared: PreparedSend[] = [];
  const prepFailures: SendOutcome[] = [];
  const isAi = campaign.campaignMode === 'AI_GENERATED' && !campaign.templateId;

  await mapWithConcurrency(toSend, isAi ? AI_GENERATION_CONCURRENCY : CONTENT_PREP_CONCURRENCY, async (lead) => {
    const identity = assignments.get(lead.campaignLeadId) || null;
    try {
      const content = await prepareLeadContent(campaign, template, lead);
      prepared.push({ lead, ...content, identity });
    } catch (err: any) {
      prepFailures.push({
        prepared: { lead, subject: '', text: '', attachments: [], identity },
        ok: false,
        error: `Could not build the email: ${err?.message || 'unknown error'}`,
      });
    }
  });

  let successCount = 0;
  const outcomes: SendOutcome[] = [...prepFailures];
  let stop: StopReason = null;
  let stopMessage = '';

  // ---- 4. send ------------------------------------------------------------
  if (isSimulation) {
    for (const p of prepared) {
      outcomes.push({
        prepared: p,
        ok: true,
        messageId: `<sim-camp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@umrah360.in>`,
      });
    }
  } else {
    const groups = new Map<string, PreparedSend[]>();
    for (const p of prepared) {
      const key = (p.identity as SendingIdentity).identityId;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key)!.push(p);
    }

    const stillRunning = () => campaignsMap.get(campaignId)?.status === 'RUNNING';

    // Sends one email on its own; returns true if the loop may continue.
    const sendSingle = async (p: PreparedSend): Promise<boolean> => {
      const res = await sendViaResend(buildResendPayload(p, campaign, currentRunId, true));
      await sleep(RESEND_CALL_SPACING_MS);
      if (res.success) {
        outcomes.push({ prepared: p, ok: true, messageId: res.id });
        return true;
      }
      if (res.isDailyLimitExceeded) {
        stop = 'quota';
        stopMessage = res.error || '';
        return false;
      }
      if (res.isRateLimited) {
        stop = 'rate';
        return false;
      }
      outcomes.push({ prepared: p, ok: false, error: res.error || 'Resend rejected the email' });
      return true;
    };

    outer: for (const [, items] of groups) {
      const plain = items.filter((p) => p.attachments.length === 0);
      const withAttachments = items.filter((p) => p.attachments.length > 0);

      // Plain emails: up to 100 per request
      for (let i = 0; i < plain.length; i += RESEND_BATCH_LIMIT) {
        if (!stillRunning()) {
          stop = 'paused';
          break outer;
        }
        const chunk = plain.slice(i, i + RESEND_BATCH_LIMIT);
        const payloads = chunk.map((p) => buildResendPayload(p, campaign, currentRunId, false));
        const idemKey = `batch:${campaignId}:${currentRunId}:${crypto
          .createHash('sha1')
          .update(chunk.map((p) => p.lead.campaignLeadId).join(','))
          .digest('hex')}`;

        const res = await sendBatchViaResend(payloads, idemKey);
        await sleep(RESEND_CALL_SPACING_MS);

        if (res.success) {
          chunk.forEach((p, idx) => outcomes.push({ prepared: p, ok: true, messageId: res.ids[idx] }));
        } else if (res.isDailyLimitExceeded) {
          stop = 'quota';
          stopMessage = res.error || '';
          break outer;
        } else if (res.isRateLimited) {
          stop = 'rate';
          break outer;
        } else {
          // The whole batch was rejected (usually one malformed address). Send individually so only the bad ones fail.
          for (const p of chunk) {
            if (!(await sendSingle(p))) break outer;
          }
        }

        successCount += await applyOutcomes(outcomes.splice(0, outcomes.length), campaign, currentRunId, template);
      }

      // Emails with attachments: Resend's batch endpoint does not support them
      for (let i = 0; i < withAttachments.length; i++) {
        if (!stillRunning()) {
          stop = 'paused';
          break outer;
        }
        if (!(await sendSingle(withAttachments[i]))) break outer;
        if (outcomes.length >= 25) {
          successCount += await applyOutcomes(outcomes.splice(0, outcomes.length), campaign, currentRunId, template);
        }
      }
    }
  }

  // ---- 5. persist results --------------------------------------------------
  successCount += await applyOutcomes(outcomes.splice(0, outcomes.length), campaign, currentRunId, template);

  // Anything still claimed was never sent (quota / rate limit / pause): put it back and return its capacity.
  const unsent = prepared.filter((p) => p.lead.sendStatus === 'SENDING');
  const unsentRefunds = new Map<string, number>();
  for (const p of unsent) {
    p.lead.sendStatus = 'PENDING';
    p.lead.claimedAt = '';
    if (p.identity) unsentRefunds.set(p.identity.identityId, (unsentRefunds.get(p.identity.identityId) || 0) + 1);
  }
  for (const [identityId, count] of unsentRefunds) {
    await bumpIdentityUsage(identityId, -count).catch(() => {});
  }
  await flushTouched();

  if (stop === 'quota') {
    campaign.status = 'PAUSED';
    campaign.lastError = `Resend sending quota reached${stopMessage ? ` (${stopMessage})` : ''}. Campaign paused — upgrade the Resend plan or start it again after the quota resets.`;
    campaign.updatedAt = new Date().toISOString();
    persistCampaign(campaign);
    console.warn(`[Campaign Engine] Pausing campaign ${campaignId}: Resend quota reached.`);
  } else if (stop === 'rate') {
    campaignNextAttemptAt.set(campaignId, Date.now() + RATE_LIMIT_RETRY_DELAY_MS);
  }

  const remaining = leads.filter(isPending).length;
  if (remaining === 0 && stop !== 'quota' && !leads.some((l) => l.sendStatus === 'SENDING')) {
    markCampaignCompleted(campaign, currentRunId);
  }

  const updatedCampaign = (await recalculateAndPersistCampaignMetrics(campaignId)) || campaign;
  return {
    campaign: updatedCampaign,
    processedCount: successCount,
    remainingPendingCount: remaining,
  };
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
export function recalculateCampaignMetrics(campaignId: string): Campaign | undefined {
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

  if (isFirebaseConfigured && db) {
    safeSetDoc(doc(db, 'campaigns', campaignId), camp, { merge: true }).catch(() => {});
  }

  return camp;
}

/**
 * Asynchronously loads leads from DB and recalculates metrics and persists to Firestore
 */
export async function recalculateAndPersistCampaignMetrics(campaignId: string): Promise<Campaign | undefined> {
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
      await safeSetDoc(doc(db, 'campaigns', campaignId), camp, { merge: true });
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
      const snap = await getDoc(doc(db, 'campaign_leads', params.leadId));
      if (snap.exists()) {
        targetLead = snap.data() as CampaignLead;
        campaignLeadsMap.set(targetLead.campaignLeadId, targetLead);
      } else {
        const querySnap = await getDocs(collection(db, 'campaign_leads'));
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
  // Targeted lookup by sender address (never read the whole collection — it can hold 50k+ leads).
  // Only leads missing from memory are inserted so in-memory send state is never overwritten.
  if (isFirebaseConfigured && db && cleanFromEmail) {
    try {
      const snap = await getDocs(query(collection(db, 'campaign_leads'), where('email', '==', cleanFromEmail))).catch(() => null);
      if (snap && !snap.empty) {
        snap.forEach((d) => {
          const l = d.data() as CampaignLead;
          if (l && l.campaignLeadId && !campaignLeadsMap.has(l.campaignLeadId)) {
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
  const text = `${params.subject || ''} ${params.body || ''}`.toLowerCase();
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
        safeSetDoc(doc(db, 'campaign_leads', matchedLead.campaignLeadId), matchedLead, { merge: true }).catch(() => {});
        const contactId = `contact-${matchedLead.email.replace(/[^a-z0-9]/gi, '_')}`;
        safeSetDoc(doc(db, 'contacts', contactId), {
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
        }, { merge: true }).catch(() => {});

        if (matchedLead.leadId) {
          safeSetDoc(doc(db, 'leads', matchedLead.leadId), {
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
          }, { merge: true }).catch(() => {});
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
      const snap = await getDoc(doc(db, 'campaign_leads', params.leadId));
      if (snap.exists()) {
        targetLead = snap.data() as CampaignLead;
        campaignLeadsMap.set(targetLead.campaignLeadId, targetLead);
      } else {
        const querySnap = await getDocs(collection(db, 'campaign_leads'));
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
      await safeSetDoc(doc(db, 'campaign_leads', targetLead.campaignLeadId), targetLead, { merge: true });
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
export async function processActiveRunningCampaignsBatch(batchSize?: number): Promise<{
  activeCount: number;
  processedCampaigns: Array<{ campaignId: string; processedCount: number; remainingPendingCount: number }>;
}> {
  if (isAutoProcessingCampaigns) {
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
        const snap = await getDocs(query(collection(db, 'campaigns'), where('status', '==', 'RUNNING'))).catch(() => null);
        if (snap && !snap.empty) {
          snap.forEach((d) => {
            const c = d.data() as Campaign;
            if (c && c.campaignId && !campaignsMap.has(c.campaignId)) {
              campaignsMap.set(c.campaignId, c);
              runningCampaignsMap.set(c.campaignId, c);
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


/**
 * Called by the Resend webhook when an email bounced / was reported as spam.
 * Updates the lead in this process' memory (Firestore is updated by the webhook handler itself).
 */
export function applyDeliveryFailureToMemory(resendEmailId: string, reason: string): void {
  if (!resendEmailId) return;
  for (const lead of campaignLeadsMap.values()) {
    if (lead.gmailMessageId === resendEmailId) {
      lead.sendStatus = 'FAILED';
      lead.lastError = reason;
      lead.updatedAt = new Date().toISOString();
    }
  }
}
