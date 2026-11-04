import { getDoc, setDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { tenantRepo } from './tenantRepo.js';
import { getTenantBrand, saveTenantBrand } from './brandService.js';
import { analyzeCompanyWebsiteForProfile } from './emailDesignService.js';
import { saveKnowledgeDoc, deleteKnowledgeDoc } from './knowledgeService.js';
import type { TenantContext } from '../types/tenant.js';
import type { KnowledgeDocument } from '../types/index.js';

const COMPANY_KNOWLEDGE_DOC_ID = 'company-website-knowledge';

const EDITABLE_BRAND_KEYS = [
  'companyName', 'tagline', 'defaultProduct', 'industryDescription', 'websiteUrl',
  'salesEmail', 'supportPhone', 'teamName', 'senderName', 'aiAgentName', 'logoUrl',
  'companyDescription', 'brandVoice', 'primaryColor', 'secondaryColor', 'accentColor',
  'headingFontFamily', 'bodyFontFamily', 'socialLinks',
] as const;

export async function getCompanyProfile(ctx: TenantContext) {
  const brand = await getTenantBrand(ctx.tenantId);
  let metadata: any = null;
  let knowledgeContent = '';
  if (isFirebaseConfigured) {
    const repo = tenantRepo(ctx);
    try {
      const profileSnap = await getDoc(repo.settingsDoc('company_profile'));
      if (profileSnap.exists()) metadata = profileSnap.data();
    } catch {}
    try {
      const knowledgeSnap = await getDoc(repo.knowledgeDocumentDoc(COMPANY_KNOWLEDGE_DOC_ID));
      if (knowledgeSnap.exists()) knowledgeContent = String((knowledgeSnap.data() as any).content || '');
    } catch {}
  }
  return { brand, metadata, knowledgeContent };
}

export async function analyzeCompanyProfileWebsite(ctx: TenantContext, websiteUrl: string) {
  if (!websiteUrl || typeof websiteUrl !== 'string') throw new Error('Enter your company website URL.');
  return analyzeCompanyWebsiteForProfile(websiteUrl.trim(), ctx.tenantId);
}

export async function saveCompanyProfile(ctx: TenantContext, input: any) {
  const source = input && input.brand && typeof input.brand === 'object' ? input.brand : {};
  const patch: Record<string, any> = {};
  for (const key of EDITABLE_BRAND_KEYS) {
    if (source[key] !== undefined) patch[key] = source[key];
  }

  if (patch.websiteUrl) {
    let parsed: URL;
    try { parsed = new URL(String(patch.websiteUrl)); } catch { throw new Error('Enter a valid company website URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Company website must use a public HTTP or HTTPS URL.');
    }
  }

  const brand = await saveTenantBrand(ctx.tenantId, patch as any);
  const repo = tenantRepo(ctx);
  const now = new Date().toISOString();
  const knowledgeContent = String(input && input.knowledgeContent || '').trim().slice(0, 60000);
  let previousKnowledge: any = null;
  if (isFirebaseConfigured) {
    try {
      const existing = await getDoc(repo.knowledgeDocumentDoc(COMPANY_KNOWLEDGE_DOC_ID));
      if (existing.exists()) previousKnowledge = existing.data();
    } catch {}
  }

  if (knowledgeContent) {
    const previous = previousKnowledge || {};
    const knowledgeDoc: KnowledgeDocument = {
      id: COMPANY_KNOWLEDGE_DOC_ID,
      title: (brand.companyName || 'Company') + ' website knowledge',
      category: 'PRODUCT',
      content: knowledgeContent,
      tags: ['company-profile', 'company-website', 'brand-knowledge'],
      status: 'PUBLISHED',
      version: Math.max(1, Number(previous.version) || 0) + 1,
      author: ctx.email || 'Company Profile',
      createdAt: previous.createdAt || now,
      updatedAt: now,
    };
    await saveKnowledgeDoc(knowledgeDoc, ctx);
  } else if (previousKnowledge) {
    await deleteKnowledgeDoc(COMPANY_KNOWLEDGE_DOC_ID, ctx);
  }

  let previousMetadata: any = {};
  if (isFirebaseConfigured) {
    try {
      const snap = await getDoc(repo.settingsDoc('company_profile'));
      if (snap.exists()) previousMetadata = snap.data();
    } catch {}
  }
  const analysis = input && input.analysis && typeof input.analysis === 'object' ? input.analysis : null;
  const metadata = {
    websiteUrl: brand.websiteUrl || '',
    analyzedAt: analysis && typeof analysis.extractedAt === 'string' ? analysis.extractedAt : (previousMetadata.analyzedAt || ''),
    pagesScanned: analysis && Array.isArray(analysis.pagesScanned) ? analysis.pagesScanned.slice(0, 8) : (previousMetadata.pagesScanned || []),
    counts: analysis && analysis.counts && typeof analysis.counts === 'object' ? analysis.counts : (previousMetadata.counts || {}),
    extraction: analysis ? {
      industry: String(analysis.industry || '').slice(0, 240),
      targetAudience: String(analysis.targetAudience || '').slice(0, 500),
      brandVoice: String(analysis.brandVoice || '').slice(0, 800),
      structuredData: analysis.structuredData && typeof analysis.structuredData === 'object' ? analysis.structuredData : {},
    } : (previousMetadata.extraction || {}),
    knowledgeDocumentId: knowledgeContent ? COMPANY_KNOWLEDGE_DOC_ID : '',
    updatedAt: now,
  };
  if (isFirebaseConfigured) {
    await setDoc(repo.settingsDoc('company_profile'), metadata, { merge: true });
  }
  return { brand, metadata, knowledgeContent };
}
