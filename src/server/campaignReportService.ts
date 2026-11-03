import crypto from 'node:crypto';
import OpenAI from 'openai';
import { getCampaignByIdAsync, getCampaignEngagementStats } from './campaignService.js';
import { getTenantBrand } from './brandService.js';
import { tenantRepo } from './tenantRepo.js';
import { getDoc, getDocs, setDoc, deleteDoc, query, orderBy, limit } from './adminFirestore.js';
import { recordAiCompletionUsage } from './usageService.js';
import type { TenantContext } from '../types/tenant.js';

type CampaignSnapshot = {
  campaignId: string; name: string; status: string; type: string;
  createdAt?: string; startedAt?: string; completedAt?: string;
  metrics: {
    totalLeads: number; sent: number; delivered: number; pending: number; failed: number;
    uniqueOpened: number; totalOpens: number; scannerOpens: number;
    uniqueClicked: number; totalClicks: number; replied: number; ignored: number; waiting: number;
    bounced: number; complaints: number; delayed: number; deliveryUnknown: number;
  };
  rates: { deliveryRate: number; uniqueOpenRate: number; uniqueClickRate: number; replyRate: number };
  activity: { repeatOpens: number; repeatClicks: number; averageOpensPerUniqueLead: number; averageClicksPerUniqueLead: number };
  tracking: { trackedLeads: number; ignoredAfterDays: number; hasTrackingData: boolean };
};

function n(value: unknown): number {
  const num = Number(value);
  return Number.isFinite(num) && num > 0 ? num : 0;
}
function rate(value: number, total: number): number {
  return total > 0 ? Math.round((value / total) * 1000) / 10 : 0;
}

async function buildCampaignSnapshot(campaignId: string): Promise<CampaignSnapshot> {
  const campaign = await getCampaignByIdAsync(campaignId);
  if (!campaign) throw new Error('A selected campaign could not be found in this workspace.');
  const stats: any = await getCampaignEngagementStats(campaignId);
  const sent = n(stats.sent || campaign.sentCount);
  const delivered = n(stats.delivered);
  const uniqueOpened = n(stats.uniqueOpened);
  const totalOpens = Math.max(n(stats.totalOpens), uniqueOpened);
  const uniqueClicked = n(stats.clicked);
  const totalClicks = Math.max(n(stats.totalClicks), uniqueClicked);
  const replied = n(stats.replied || campaign.repliedCount);
  const denominator = delivered || sent;
  return {
    campaignId: campaign.campaignId,
    name: campaign.name || 'Untitled campaign',
    status: campaign.status || 'UNKNOWN',
    type: campaign.type || 'EMAIL',
    createdAt: campaign.createdAt,
    startedAt: campaign.startedAt,
    completedAt: campaign.completedAt,
    metrics: {
      totalLeads: n(campaign.totalLeads), sent, delivered,
      pending: n(campaign.pendingCount), failed: n(campaign.failedCount),
      uniqueOpened, totalOpens, scannerOpens: n(stats.botOpens),
      uniqueClicked, totalClicks, replied, ignored: n(stats.ignored),
      waiting: n(stats.waiting), bounced: n(stats.bounced),
      complaints: n(stats.complained), delayed: n(stats.delayed),
      deliveryUnknown: n(stats.deliveryUnknown),
    },
    rates: {
      deliveryRate: rate(delivered, sent),
      uniqueOpenRate: rate(uniqueOpened, denominator),
      uniqueClickRate: rate(uniqueClicked, denominator),
      replyRate: rate(replied, sent),
    },
    activity: {
      repeatOpens: Math.max(0, totalOpens - uniqueOpened),
      repeatClicks: Math.max(0, totalClicks - uniqueClicked),
      averageOpensPerUniqueLead: uniqueOpened > 0 ? Math.round((totalOpens / uniqueOpened) * 10) / 10 : 0,
      averageClicksPerUniqueLead: uniqueClicked > 0 ? Math.round((totalClicks / uniqueClicked) * 10) / 10 : 0,
    },
    tracking: {
      trackedLeads: n(stats.tracked),
      ignoredAfterDays: n(stats.ignoredAfterDays) || 5,
      hasTrackingData: n(stats.tracked) > 0 || uniqueOpened > 0 || uniqueClicked > 0,
    },
  };
}

function fallbackAnalysis(campaigns: CampaignSnapshot[]) {
  const recommendations: string[] = [];
  if (campaigns.some((c) => !c.tracking.hasTrackingData)) {
    recommendations.push('Enable Resend open and click tracking for future sends so engagement trends can be measured consistently.');
  }
  if (campaigns.some((c) => c.metrics.uniqueOpened > 0 && c.metrics.uniqueClicked === 0)) {
    recommendations.push('Review the email call-to-action and landing-page destination; opens are recorded but no tracked clicks are present.');
  }
  if (campaigns.some((c) => c.metrics.waiting > 0)) {
    recommendations.push('Allow the existing five-day waiting window to complete before classifying these delivered leads as ignored.');
  }
  if (campaigns.some((c) => c.metrics.bounced > 0)) {
    recommendations.push('Review bounced addresses and suppress invalid recipients before the next send.');
  }
  if (recommendations.length === 0) {
    recommendations.push('Continue monitoring unique leads and total activity separately; repeated opens and clicks are useful context but do not represent additional leads.');
  }
  return {
    executiveSummary: campaigns.length === 1
      ? 'This report summarises the selected campaign using its saved delivery and engagement events.'
      : 'This report compares the selected campaigns using their saved delivery and engagement events.',
    highlights: [
      'Unique lead counts and total open/click events are reported separately.',
      'Open activity is an estimate and can be affected by mail-client privacy features.',
    ],
    risks: campaigns.filter((c) => !c.tracking.hasTrackingData).map((c) => c.name + ': tracking data is limited or unavailable.'),
    recommendations,
  };
}

async function generateAnalysis(campaigns: CampaignSnapshot[], tenantId: string) {
  const apiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
  if (!apiKey) return { ...fallbackAnalysis(campaigns), aiGenerated: false, model: 'rules-based-fallback' };
  const isGemini = !process.env.OPENAI_API_KEY && Boolean(process.env.GEMINI_API_KEY);
  const client = new OpenAI({
    apiKey,
    ...(isGemini ? { baseURL: 'https://generativelanguage.googleapis.com/v1beta/openai/' } : {}),
  });
  const model = isGemini
    ? (process.env.CAMPAIGN_REPORT_GEMINI_MODEL || process.env.AI_TEST_GEMINI_MODEL || 'gemini-2.0-flash')
    : (process.env.CAMPAIGN_REPORT_OPENAI_MODEL || 'gpt-4o-mini');
  const system = [
    'You are an analytical campaign reporting assistant.',
    'Use only the supplied aggregate campaign metrics. Do not invent causes, audience characteristics, or industry benchmarks.',
    'Distinguish unique leads from total events. Repeated opens/clicks are activity events, not additional leads.',
    'Treat open rates as estimates because privacy proxies and image preloading affect open tracking.',
    'Do not infer that an email was read merely because it was delivered.',
    'Do not recommend marking leads ignored until the supplied five-day waiting rule has elapsed.',
    'Return valid JSON only with keys: executiveSummary (string), highlights (string array), risks (string array), recommendations (string array).',
  ].join(' ');
  let completion: any;
  try {
    completion = await client.chat.completions.create({
      model,
      temperature: 0.2,
      messages: [
        { role: 'system', content: system },
        { role: 'user', content: JSON.stringify({ campaigns }) },
      ],
    });
    await recordAiCompletionUsage(tenantId, completion, model, isGemini ? 'gemini' : 'openai').catch(() => {});
  } catch (error: any) {
    console.warn('[Campaign Reports] AI provider unavailable; using aggregate-rule fallback:', error?.message || error);
    return { ...fallbackAnalysis(campaigns), aiGenerated: false, model: model + ' (AI unavailable)' };
  }
  const fence = String.fromCharCode(96).repeat(3);
  const raw = completion.choices[0]?.message?.content?.trim() || '';
  const cleaned = raw.split(fence).join('').replace(/^\s*json\s*/i, '').trim();
  let parsed: any;
  try { parsed = JSON.parse(cleaned); } catch { parsed = null; }
  if (!parsed || typeof parsed !== 'object') {
    return { ...fallbackAnalysis(campaigns), aiGenerated: false, model: model + ' (invalid response fallback)' };
  }
  const arr = (v: any) => Array.isArray(v) ? v.map((x) => String(x)).filter(Boolean).slice(0, 8) : [];
  return {
    executiveSummary: String(parsed.executiveSummary || fallbackAnalysis(campaigns).executiveSummary).slice(0, 2500),
    highlights: arr(parsed.highlights),
    risks: arr(parsed.risks),
    recommendations: arr(parsed.recommendations),
    aiGenerated: true,
    model,
  };
}

export async function generateCampaignReport(ctx: TenantContext, campaignIdsInput: unknown, generatedBy: string) {
  const campaignIds = Array.isArray(campaignIdsInput)
    ? Array.from(new Set(campaignIdsInput.map((id) => String(id || '').trim()).filter(Boolean))).slice(0, 10)
    : [];
  if (campaignIds.length < 1) throw new Error('Select at least one campaign to generate a report.');
  const campaigns = await Promise.all(campaignIds.map(buildCampaignSnapshot));
  const [brand, analysis] = await Promise.all([getTenantBrand(ctx.tenantId), generateAnalysis(campaigns, ctx.tenantId)]);
  const now = new Date().toISOString();
  const reportId = 'rpt-' + crypto.randomUUID();
  const report = {
    reportId,
    reportType: campaigns.length > 1 ? 'COMPARISON' : 'INDIVIDUAL',
    title: campaigns.length > 1 ? 'Campaign comparison report' : campaigns[0].name + ' report',
    campaignIds,
    campaignNames: campaigns.map((c) => c.name),
    campaigns,
    analysis,
    brand: {
      companyName: brand.companyName,
      teamName: brand.teamName,
      logoUrl: brand.logoUrl,
      websiteUrl: brand.websiteUrl,
      salesEmail: brand.salesEmail,
    },
    generatedAt: now,
    generatedBy: generatedBy || 'Workspace user',
    schemaVersion: 1,
  };
  await setDoc(tenantRepo(ctx).campaignReportDoc(reportId), report);
  return report;
}

export async function listCampaignReports(ctx: TenantContext) {
  const snap = await getDocs(query(tenantRepo(ctx).campaignReports(), orderBy('generatedAt', 'desc'), limit(50)));
  return snap.docs.map((d: any) => {
    const value = d.data();
    return {
      reportId: value.reportId || d.id,
      reportType: value.reportType || 'INDIVIDUAL',
      title: value.title || 'Campaign report',
      campaignNames: Array.isArray(value.campaignNames) ? value.campaignNames : [],
      generatedAt: value.generatedAt || '',
      generatedBy: value.generatedBy || '',
    };
  });
}

export async function getCampaignReport(ctx: TenantContext, reportId: string) {
  const safeId = String(reportId || '').trim();
  if (!safeId || safeId.includes('/')) return null;
  const snap = await getDoc(tenantRepo(ctx).campaignReportDoc(safeId));
  return snap.exists() ? snap.data() : null;
}

export async function deleteCampaignReport(ctx: TenantContext, reportId: string) {
  const safeId = String(reportId || '').trim();
  if (!safeId || safeId.includes('/')) return false;
  await deleteDoc(tenantRepo(ctx).campaignReportDoc(safeId));
  return true;
}
