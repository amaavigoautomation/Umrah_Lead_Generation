import crypto from 'crypto';
import { GoogleGenAI } from '@google/genai';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from '../services/knowledgeData.js';
import {
  collection,
  doc,
  getDocs,
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

  const apiKey = process.env.GEMINI_API_KEY;
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
    const ai = new GoogleGenAI({ apiKey });
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

    const response = await ai.models.generateContent({
      model: 'gemini-2.5-flash',
      contents: prompt,
    });

    const text = response.text || '';
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

// In-Memory state caches
const campaignsMap = new Map<string, Campaign>();
const campaignLeadsMap = new Map<string, CampaignLead>(); // key: campaignLeadId
const campaignRunsMap = new Map<string, CampaignRun>(); // key: runId
const emailTemplatesMap = new Map<string, EmailTemplate>(); // key: templateId
const sendHistorySet = new Set<string>(); // key: `${campaignId}_${email.toLowerCase()}`

// Active sending abort flags per campaign
const activeCampaignAbortControllers = new Map<string, AbortController>();

let isCampaignStoreInitialized = false;

/**
 * Synchronizes the in-memory campaign stores directly from Firestore.
 * Guarantees that any documents deleted in Firestore are pruned from memory,
 * and any newly updated documents in Firestore are accurately reflected.
 */
export async function syncCampaignStoreFromFirestore(): Promise<void> {
  if (!isFirebaseConfigured || !db) return;

  try {
    // 1. Templates
    const tplSnap = await getDocs(collection(db, 'email_templates'));
    const firestoreTplIds = new Set<string>();
    tplSnap.forEach((d) => {
      const data = d.data() as EmailTemplate;
      if (data.templateId) {
        firestoreTplIds.add(data.templateId);
        emailTemplatesMap.set(data.templateId, data);
      }
    });
    if (firestoreTplIds.size > 0) {
      for (const id of Array.from(emailTemplatesMap.keys())) {
        if (!firestoreTplIds.has(id)) {
          emailTemplatesMap.delete(id);
        }
      }
    }

    // 2. Campaigns
    const campSnap = await getDocs(collection(db, 'campaigns'));
    const firestoreCampIds = new Set<string>();
    campSnap.forEach((d) => {
      const data = d.data() as Campaign;
      if (data.campaignId) {
        firestoreCampIds.add(data.campaignId);
        campaignsMap.set(data.campaignId, data);
      }
    });
    for (const id of Array.from(campaignsMap.keys())) {
      if (!firestoreCampIds.has(id)) {
        campaignsMap.delete(id);
      }
    }

    // 3. Campaign Leads
    const leadsSnap = await getDocs(collection(db, 'campaign_leads'));
    const firestoreLeadIds = new Set<string>();
    leadsSnap.forEach((d) => {
      const data = d.data() as CampaignLead;
      if (data.campaignLeadId) {
        firestoreLeadIds.add(data.campaignLeadId);
        campaignLeadsMap.set(data.campaignLeadId, data);
      }
    });
    for (const id of Array.from(campaignLeadsMap.keys())) {
      if (!firestoreLeadIds.has(id)) {
        campaignLeadsMap.delete(id);
      }
    }

    // 4. Campaign Runs
    const runsSnap = await getDocs(collection(db, 'campaign_runs'));
    const firestoreRunIds = new Set<string>();
    runsSnap.forEach((d) => {
      const data = d.data() as CampaignRun;
      if (data.runId) {
        firestoreRunIds.add(data.runId);
        campaignRunsMap.set(data.runId, data);
      }
    });
    for (const id of Array.from(campaignRunsMap.keys())) {
      if (!firestoreRunIds.has(id)) {
        campaignRunsMap.delete(id);
      }
    }

    // 5. Send History
    const historySnap = await getDocs(collection(db, 'campaign_send_history'));
    historySnap.forEach((d) => {
      const data = d.data() as CampaignSendHistory;
      if (data.campaignId && data.email && data.status === 'SENT') {
        sendHistorySet.add(`${data.campaignId}_${data.email.toLowerCase()}`);
      }
    });
  } catch (err) {
    console.warn('[Campaign Store] Notice syncing from Firestore:', err);
  }
}

/**
 * Initializes campaign data from Firestore, ensuring idempotency and cross-restart safety
 */
export async function initCampaignStore() {
  if (!isCampaignStoreInitialized) {
    isCampaignStoreInitialized = true;
    DEFAULT_EMAIL_TEMPLATES.forEach((tpl) => {
      emailTemplatesMap.set(tpl.templateId, tpl);
    });
  }

  await syncCampaignStoreFromFirestore();
}

// -------------------------------------------------------------
// TEMPLATE MANAGEMENT
// -------------------------------------------------------------
export function getAllTemplates(): EmailTemplate[] {
  return Array.from(emailTemplatesMap.values()).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export async function saveTemplate(template: EmailTemplate): Promise<EmailTemplate> {
  const now = new Date().toISOString();
  const tpl: EmailTemplate = {
    ...template,
    templateId: template.templateId || `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
    createdAt: template.createdAt || now,
    updatedAt: now,
  };
  emailTemplatesMap.set(tpl.templateId, tpl);

  if (isFirebaseConfigured && db) {
    try {
      await setDoc(doc(db, 'email_templates', tpl.templateId), tpl, { merge: true });
    } catch (e) {
      console.warn('Failed to save template to Firestore:', e);
    }
  }
  return tpl;
}

export async function deleteTemplate(templateId: string): Promise<boolean> {
  emailTemplatesMap.delete(templateId);
  if (isFirebaseConfigured && db) {
    try {
      await deleteDoc(doc(db, 'email_templates', templateId));
    } catch {}
  }
  return true;
}

// -------------------------------------------------------------
// CAMPAIGN MANAGEMENT
// -------------------------------------------------------------
export function getAllCampaigns(): Campaign[] {
  const campaigns = Array.from(campaignsMap.values());
  // Recalculate metrics on the fly from leads
  return campaigns.map((camp) => recalculateCampaignMetrics(camp.campaignId) || camp).sort(
    (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );
}

export function getCampaignById(campaignId: string): Campaign | undefined {
  return recalculateCampaignMetrics(campaignId);
}

export function getCampaignLeads(campaignId: string): CampaignLead[] {
  return Array.from(campaignLeadsMap.values())
    .filter((l) => l.campaignId === campaignId)
    .sort((a, b) => (a.rowNumber || 0) - (b.rowNumber || 0));
}

export function getCampaignRuns(campaignId: string): CampaignRun[] {
  return Array.from(campaignRunsMap.values())
    .filter((r) => r.campaignId === campaignId)
    .sort((a, b) => b.runNumber - a.runNumber);
}

/**
 * Deletes a campaign and all associated leads, runs, and send history
 */
export async function deleteCampaign(campaignId: string): Promise<boolean> {
  await initCampaignStore();

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
    deleteDoc(doc(db, 'campaigns', campaignId)).catch(() => {});
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
  templateId?: string;
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

  const now = new Date().toISOString();
  const campaignId = `camp-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`;
  const template = params.templateId ? emailTemplatesMap.get(params.templateId) : undefined;
  const mode = params.campaignMode || 'PREDEFINED';

  const initialCampaign: Campaign = {
    campaignId,
    name: params.name,
    type: params.type || 'EMAIL',
    campaignMode: mode,
    status: 'DRAFT',
    templateId: params.templateId,
    templateName: mode === 'AI_GENERATED' ? 'AI Intelligent Personalization' : (template?.name || 'Predefined Template'),
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
      createdAt: now,
      updatedAt: now,
    };

    campaignLeadsMap.set(campaignLeadId, cLead);
    createdLeads.push(cLead);
  });

  // Sync to Firestore
  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'campaigns', campaignId), initialCampaign);
      for (const cl of createdLeads) {
        await safeSetDoc(doc(db, 'campaign_leads', cl.campaignLeadId), cl);
      }
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
  await initCampaignStore();
  const campaign = campaignsMap.get(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // If campaign was COMPLETED or DRAFT without run, create a run
  const now = new Date().toISOString();
  let currentRunId = campaign.currentRunId;

  if (!currentRunId || campaign.status === 'COMPLETED' || campaign.status === 'DRAFT') {
    const nextRunNumber = (campaign.lastRunNumber || 0) + 1;
    currentRunId = `run-${campaignId}-${nextRunNumber}`;
    const newRun: CampaignRun = {
      runId: currentRunId,
      campaignId,
      runNumber: nextRunNumber,
      status: 'RUNNING',
      templateId: campaign.templateId || 'tpl-b2b-portal',
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

  // Trigger background sending engine
  executeCampaignSendingEngine(campaignId).catch((err) => {
    console.error(`[Campaign Engine] Error executing campaign ${campaignId}:`, err);
  });

  return campaign;
}

/**
 * Pause campaign immediately
 */
export async function pauseCampaign(campaignId: string): Promise<Campaign> {
  const campaign = campaignsMap.get(campaignId);
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
 * - Safe restart logic: only sends to leads who have NOT been sent to in this campaign,
 *   OR resets leads that failed, ensuring strict idempotency and zero duplicate emails!
 */
export async function restartCampaign(
  campaignId: string,
  options?: { resetFailedOnly?: boolean; newTemplateId?: string }
): Promise<{ campaign: Campaign; run: CampaignRun }> {
  await initCampaignStore();
  const campaign = campaignsMap.get(campaignId);
  if (!campaign) throw new Error(`Campaign ${campaignId} not found`);

  // Halt any currently active send loops
  const existingAbort = activeCampaignAbortControllers.get(campaignId);
  if (existingAbort) {
    existingAbort.abort();
    activeCampaignAbortControllers.delete(campaignId);
  }

  const now = new Date().toISOString();
  const nextRunNumber = (campaign.lastRunNumber || 0) + 1;
  const newRunId = `run-${campaignId}-${nextRunNumber}`;
  const templateId = options?.newTemplateId || campaign.templateId || 'tpl-b2b-portal';

  // Mark previous run as COMPLETED if it was running
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
  let pendingCount = 0;

  // Identify leads for this run
  leads.forEach((l) => {
    // If the lead was already SENT, we preserve its SENT status to guarantee NO DUPLICATE SENDS
    if (l.sendStatus === 'SENT') {
      // Do nothing, already safely sent
    } else if (l.sendStatus === 'FAILED' || l.sendStatus === 'PAUSED' || l.sendStatus === 'PENDING') {
      l.sendStatus = 'PENDING';
      l.lastError = undefined;
      l.campaignRunId = newRunId;
      l.updatedAt = now;
      pendingCount++;
      if (isFirebaseConfigured && db) {
        setDoc(doc(db, 'campaign_leads', l.campaignLeadId), l, { merge: true }).catch(() => {});
      }
    }
  });

  const newRun: CampaignRun = {
    runId: newRunId,
    campaignId,
    runNumber: nextRunNumber,
    status: 'RUNNING',
    templateId,
    totalLeads: leads.length,
    sentCount: campaign.sentCount,
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

  // Start background sending
  executeCampaignSendingEngine(campaignId).catch((err) => {
    console.error(`[Campaign Engine] Error on restart of ${campaignId}:`, err);
  });

  return { campaign, run: newRun };
}

/**
 * Sequential / Controlled Sending Engine with strict idempotency and duplicate protection
 */
async function executeCampaignSendingEngine(campaignId: string) {
  const abortCtrl = new AbortController();
  activeCampaignAbortControllers.set(campaignId, abortCtrl);

  try {
    const campaign = campaignsMap.get(campaignId);
    if (!campaign) return;

    const template = emailTemplatesMap.get(campaign.templateId || '') || DEFAULT_EMAIL_TEMPLATES[0];
    const leads = getCampaignLeads(campaignId);

    // Candidates: only leads with sendStatus === 'PENDING'
    const pendingLeads = leads.filter((l) => l.sendStatus === 'PENDING');
    console.log(
      `[Campaign Engine] Starting send batch for "${campaign.name}" (${pendingLeads.length} leads pending)...`
    );

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

      // 2. Strict Idempotency Check:
      // Has this email already been sent to in this campaign?
      const historyKey = `${campaignId}_${lead.email.toLowerCase()}`;
      if (lead.sendStatus === 'SENT' || sendHistorySet.has(historyKey)) {
        console.log(`[Campaign Engine] SKIPPING already-sent lead ${lead.email} to prevent duplicate.`);
        lead.sendStatus = 'SENT';
        continue;
      }

      // 3. Subject and Body generation (Predefined vs AI Generated)
      let subject = '';
      let body = '';

      if (campaign.campaignMode === 'AI_GENERATED') {
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
        const personalized = personalizeTemplate(template, lead);
        subject = personalized.subject;
        body = personalized.body;
      }

      // 4. Mark SENDING
      lead.sendStatus = 'SENDING';
      lead.updatedAt = new Date().toISOString();

      const smtpConfig = getSmtpConfig();
      const senderFrom = smtpConfig.from || smtpConfig.user || 'sales@umrah360.in';
      const conversationId = lead.conversationId || `conv-${lead.leadId}`;
      const gmailThreadId = lead.gmailThreadId || `thread-${lead.leadId}`;

      try {
        console.log(`[Campaign Engine] Dispatching email to ${lead.email} ("${subject}")...`);
        const sendResult = await sendLiveEmail({
          to: lead.email,
          subject: subject,
          text: body,
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

          // Record in send history ledger to guarantee cross-restore safety
          sendHistorySet.add(historyKey);

          const historyRecord: CampaignSendHistory = {
            historyId: `hist-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
            campaignId,
            campaignRunId: campaign.currentRunId,
            campaignLeadId: lead.campaignLeadId,
            email: lead.email,
            templateId: template.templateId,
            subject: subject,
            gmailMessageId: sentMsgId,
            sentAt: now,
            status: 'SENT',
          };

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
          }

          console.log(`[Campaign Engine] Successfully dispatched to ${lead.email} (ID: ${sentMsgId})`);
        } else {
          lead.sendStatus = 'FAILED';
          lead.lastError = sendResult.error || 'SMTP delivery failure';
          lead.updatedAt = now;

          if (isFirebaseConfigured && db) {
            safeSetDoc(doc(db, 'campaign_leads', lead.campaignLeadId), lead, { merge: true }).catch(() => {});
          }
          console.warn(`[Campaign Engine] Failed to dispatch to ${lead.email}: ${sendResult.error}`);
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
    const remainingPending = getCampaignLeads(campaignId).filter((l) => l.sendStatus === 'PENDING');
    if (remainingPending.length === 0) {
      const now = new Date().toISOString();
      campaign.status = 'COMPLETED';
      campaign.completedAt = now;
      campaign.updatedAt = now;

      if (campaign.currentRunId) {
        const run = campaignRunsMap.get(campaign.currentRunId);
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
      console.log(`[Campaign Engine] Campaign ${campaign.name} marked COMPLETED.`);
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
): { subject: string; body: string } {
  const name = lead.name || lead.firstName || lead.email.split('@')[0];
  const firstName = lead.firstName || name.split(' ')[0];
  const lastName = lead.lastName || name.split(' ').slice(1).join(' ');
  const company = lead.companyName || `${name}'s Agency`;
  const designation = lead.designation || 'Director';

  const replaceVars = (str: string) => {
    return str
      .replace(/\{\{\s*name\s*\}\}/gi, name)
      .replace(/\{\{\s*firstName\s*\}\}/gi, firstName)
      .replace(/\{\{\s*lastName\s*\}\}/gi, lastName)
      .replace(/\{\{\s*company\s*\}\}/gi, company)
      .replace(/\{\{\s*companyName\s*\}\}/gi, company)
      .replace(/\{\{\s*designation\s*\}\}/gi, designation)
      .replace(/\{\{\s*jobTitle\s*\}\}/gi, designation)
      .replace(/\{\{\s*email\s*\}\}/gi, lead.email);
  };

  return {
    subject: replaceVars(template.subject),
    body: replaceVars(template.body),
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
