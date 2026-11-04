import OpenAI from 'openai';
import { randomUUID } from 'node:crypto';
import { waitUntil } from '@vercel/functions';
import { getDoc, setDoc, createDoc } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { getOpenAIApiKey } from './openaiClient.js';
import { checkTenantQuota, recordTenantUsage } from './usageService.js';
import { writeTenantAuditEvent } from './auditLogger.js';
import { getCompanyProfile } from './companyProfileService.js';
import { listTenantAssets, saveTenantAsset, deleteTenantAsset, resolveAssetRaw } from './assetService.js';
import { analyzeCompanyWebsite, saveEmailDesignTemplate } from './emailDesignService.js';
import { sanitizeCustomEmailHtml, renderEmailDesignHtml } from '../shared/emailDesign.js';
import { requireFeature } from './entitlements.js';
import { getEmailSendReadiness } from './smtpService.js';
import {
  initCampaignStore,
  runWithCampaignCtx,
  getTemplatesFromDbOrCache,
  saveTemplate as saveCampaignTemplate,
  createCampaign,
  startCampaign,
  processNextCampaignSendBatch,
  getCampaignByIdAsync,
} from './campaignService.js';
import { getCampaignDatabaseSnapshot, listLeadDatabases } from './leadDatabaseService.js';
import { createWhatsAppTemplate, createWhatsAppTemplateMediaSession, uploadWhatsAppTemplateMediaChunk } from './metaChannelsService.js';
import type { TenantContext } from '../types/tenant.js';

const IMAGE_MODEL = process.env.AGENT_IMAGE_MODEL_ID || 'gpt-image-2.5-flare';
const MAX_IMAGE_BYTES = 650 * 1024;

function clean(value: unknown, max = 500): string {
  return String(value ?? '').replace(/\u0000/g, '').trim().slice(0, max);
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function hex(value: unknown, fallback: string): string {
  const candidate = String(value || '').trim();
  return /^#[0-9a-fA-F]{6}$/.test(candidate) ? candidate.toUpperCase() : fallback;
}

function publicAssetUrl(path: string, appBaseUrl: string): string {
  const base = new URL(appBaseUrl);
  const parsed = new URL(path, base);
  if (parsed.origin !== base.origin || !/^\/api\/assets\/[A-Za-z0-9_.-]+\/view$/.test(parsed.pathname)) {
    throw new Error('The company asset URL is not a valid same-workspace asset route.');
  }
  return parsed.toString();
}

function assetIdFromUrl(value: string): string {
  try {
    const url = new URL(value, 'https://asset.invalid');
    const match = url.pathname.match(/^\/api\/assets\/([A-Za-z0-9_.-]+)\/view$/);
    return match?.[1] || '';
  } catch {
    return '';
  }
}

async function resolveCompanyLogo(ctx: TenantContext, brand: any, websiteProfile: any, assets: any[], appBaseUrl: string): Promise<string> {
  const logoAsset = assets.find((asset) => String(asset.category || '').toUpperCase() === 'LOGO');
  const candidates = [logoAsset?.url, brand?.logoUrl, websiteProfile?.logoUrl].map((value) => clean(value, 2048)).filter(Boolean);
  for (const candidate of candidates) {
    const assetId = assetIdFromUrl(candidate);
    if (assetId) {
      const raw = await resolveAssetRaw(assetId).catch(() => null);
      if (raw?.buffer?.length && /^image\/(?:png|jpeg|webp|gif|svg\+xml)$/i.test(String(raw.mimeType || ''))) {
        return publicAssetUrl('/api/assets/' + assetId + '/view', appBaseUrl);
      }
      continue;
    }
    try {
      const remote = new URL(candidate);
      if (remote.protocol === 'https:' && !remote.username && !remote.password) return remote.toString();
    } catch {}
  }
  return '';
}

async function generateCampaignArtwork(
  ctx: TenantContext,
  appBaseUrl: string,
  prompt: string,
  altText: string,
  companyName: string,
  primaryColor: string,
  accentColor: string,
): Promise<{ id: string; url: string; mimeType: string; size: number }> {
  const quota = await checkTenantQuota(ctx.tenantId, 'ai');
  if (!quota.allowed) throw new Error(quota.reason || 'The workspace AI usage quota has been reached.');
  const key = await getOpenAIApiKey();
  if (!key) throw new Error('OpenAI is not configured for this workspace.');
  const client = new OpenAI({ apiKey: key });
  const generated: any = await client.images.generate({
    model: IMAGE_MODEL,
    prompt: [
      prompt.slice(0, 3500),
      'Company context: ' + companyName,
      'Use brand colors as visual guidance: ' + primaryColor + ' and ' + accentColor + '.',
      'Create a polished, premium campaign artwork suitable for a responsive email. Artwork only: no text, letters, numbers, logos, watermarks, coupon codes, UI, frames or mockups. Leave generous negative space for HTML text. Compose as a wide landscape image.',
    ].join('\n'),
    size: '1024x1024',
    quality: 'low',
    output_format: 'jpeg',
    output_compression: 30,
  } as any);
  const base64 = generated?.data?.[0]?.b64_json;
  if (!base64 || typeof base64 !== 'string') throw new Error('The image model returned no image data.');
  const buffer = Buffer.from(base64, 'base64');
  if (!buffer.length) throw new Error('The generated campaign artwork was empty.');
  if (buffer.length > MAX_IMAGE_BYTES) throw new Error('The generated artwork exceeds the current Company Assets upload limit. Generate a simpler visual or reduce detail.');
  const saved = await saveTenantAsset(ctx, {
    name: clean(companyName, 60) + ' AI Campaign Artwork ' + new Date().toISOString().slice(0, 10),
    category: 'BANNER',
    mimeType: 'image/jpeg',
    size: buffer.length,
    dimensions: { width: 1024, height: 1024 },
    dataUrl: 'data:image/jpeg;base64,' + base64,
    altText: clean(altText || 'AI-generated campaign artwork', 240),
  });
  const persisted = await getDoc(tenantRepo(ctx).assetDoc(saved.id));
  if (!persisted.exists() || !(persisted.data() as any)?.dataUrl) {
    await deleteTenantAsset(ctx, saved.id).catch(() => false);
    throw new Error('The generated image could not be verified in Company Assets.');
  }
  const resolved = await resolveAssetRaw(saved.id);
  if (!resolved?.buffer?.length) {
    await deleteTenantAsset(ctx, saved.id).catch(() => false);
    throw new Error('The generated image was saved but cannot be served by the public asset endpoint.');
  }
  await recordTenantUsage(ctx.tenantId, { aiRequestCount: 1, aiUnpricedRequestCount: 1 });
  return {
    id: saved.id,
    url: publicAssetUrl(saved.url, appBaseUrl),
    mimeType: resolved.mimeType,
    size: resolved.buffer.length,
  };
}

function ensureEmailAssetSlots(input: string): string {
  let html = input;
  const logoCount = (html.match(/\{\{COMPANY_LOGO_URL\}\}/g) || []).length;
  const heroCount = (html.match(/\{\{HERO_IMAGE_URL\}\}/g) || []).length;
  if (logoCount > 1 || heroCount > 1) {
    throw new Error('The email HTML must use one company logo slot and one campaign image slot.');
  }
  const rows = [
    logoCount === 0
      ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:18px 24px"><img src="{{COMPANY_LOGO_URL}}" alt="Company logo" width="160" style="display:block;max-width:160px;width:100%;height:auto;border:0" /></td></tr></table>'
      : '',
    heroCount === 0
      ? '<table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center" style="padding:8px 20px 20px"><img src="{{HERO_IMAGE_URL}}" alt="Relevant campaign artwork" width="560" style="display:block;width:100%;max-width:560px;height:auto;border:0" /></td></tr></table>'
      : '',
  ].join('');
  if (!rows) return html;
  if (/<body\b[^>]*>/i.test(html)) {
    return html.replace(/<body\b[^>]*>/i, (match) => match + rows);
  }
  return '<!doctype html><html lang="en"><head><meta charset="utf-8"/><meta name="viewport" content="width=device-width,initial-scale=1"/></head><body style="margin:0;padding:0;background:#f3f5f8">' + rows + html + '</body></html>';
}

function templateTheme(primary: string, accent: string): Record<string, unknown> {
  return {
    pageBackground: '#F3F5F8',
    cardBackground: '#FFFFFF',
    primaryColor: primary,
    accentColor: accent,
    textColor: '#263445',
    mutedColor: '#718096',
    fontFamily: 'Arial, Helvetica, sans-serif',
    contentWidth: 600,
    cardRadius: 12,
    headingFontSize: 30,
    bodyFontSize: 15,
    bodyLineHeight: 1.72,
  };
}

function hasSaveApproval(message: string, destination: string): boolean {
  const text = message.toLowerCase();
  const affirmative = /\b(save|store|keep|add|put|yes|go ahead|do it)\b/.test(text);
  if (!affirmative) return false;
  if (destination === 'campaign') return /\b(campaign|outbound|my designs|my templates)\b/.test(text);
  if (destination === 'whatsapp_draft') return /\b(whatsapp|wa|draft)\b/.test(text);
  return /\b(conversation|reply|email design|email studio|my designs)\b/.test(text);
}

function hasDispatchConfirmation(message: string): boolean {
  return /^\s*(yes\b|confirm\b|confirmed\b|go ahead\b|send now\b|start (the )?campaign\b|launch (the )?campaign\b)/i.test(message);
}

function makePreviewHtml(kind: string, htmlDraft: string, body: string, brand: any, theme: Record<string, unknown>, name: string): string {
  if (kind === 'conversation_email') {
    return renderEmailDesignHtml({
      id: 'agent-preview',
      name,
      description: 'AI-generated conversation email design',
      category: 'AI Generated',
      source: 'AI',
      version: 1,
      theme,
      blocks: [],
      customHtml: htmlDraft,
    } as any, body, brand || {});
  }
  return htmlDraft;
}

export async function prepareAgentTemplateDraft(
  args: any,
  ctx: TenantContext,
  modules: string[],
  conversationId: string,
  appBaseUrl: string,
): Promise<{ output: Record<string, unknown>; artifact: Record<string, unknown> }> {
  const kind = clean(args?.templateKind, 40);
  if (!['campaign_email', 'conversation_email', 'whatsapp_template'].includes(kind)) {
    return { output: { needsClarification: true, question: 'Which template type would you like: campaign email, conversation email design, or WhatsApp template?' }, artifact: { type: 'template_type_choice' } };
  }
  const can = (module: string) => modules.includes('*') || modules.includes(module);
  if (kind !== 'whatsapp_template') await requireFeature(ctx.tenantId, 'knowledge_base');
  if (kind === 'campaign_email' && !can('campaigns') && !can('email-design-studio') && !can('settings')) throw Object.assign(new Error('Campaign email template permission is required.'), { status: 403 });
  if (kind === 'campaign_email') await requireFeature(ctx.tenantId, 'campaigns');
  if (kind !== 'whatsapp_template' && !can('knowledge')) throw Object.assign(new Error('Knowledge Base permission is required before creating a product or campaign email design.'), { status: 403 });
  if (kind === 'conversation_email' && !can('email-design-studio') && !can('settings')) throw Object.assign(new Error('Email Design Studio permission is required.'), { status: 403 });
  if (kind === 'whatsapp_template' && (!can('settings') && !can('whatsapp'))) throw Object.assign(new Error('WhatsApp template management permission is required.'), { status: 403 });
  const name = clean(args?.name, 100) || (kind === 'whatsapp_template' ? 'WhatsApp Draft' : 'AI Email Design');
  const description = clean(args?.description, 500);
  const body = String(args?.body || '').trim().slice(0, 12000);
  const subject = clean(args?.subject, 240);
  const preheader = clean(args?.preheader, 180);
  let heroPrompt = clean(args?.heroImagePrompt, 3500);
  const imageAltText = clean(args?.imageAltText, 240);
  let htmlDraft = String(args?.htmlBody || '').trim();
  const whatsappCategory = clean(args?.whatsappCategory || 'MARKETING', 20).toUpperCase();
  const whatsappLanguage = clean(args?.whatsappLanguage || 'en_US', 20);
  const whatsappHeader = clean(args?.whatsappHeader || '', 60);
  const whatsappFooter = clean(args?.whatsappFooter || '', 60);
  const whatsappSamples = Array.isArray(args?.whatsappSamples) ? args.whatsappSamples.map((x: unknown) => clean(x, 200)).slice(0, 10) : [];
  const whatsappTemplateType = clean(args?.whatsappTemplateType || 'STANDARD', 30).toUpperCase();

  if (!body) throw new Error('Add the message content before creating a template preview.');
  if (kind !== 'whatsapp_template' && (!subject || !htmlDraft)) throw new Error('Add an email subject and complete HTML email design before creating this preview.');
  if (kind !== 'whatsapp_template') {
    htmlDraft = ensureEmailAssetSlots(htmlDraft);
    if (!heroPrompt) {
      heroPrompt = [
        'Create tasteful, premium email hero artwork that visually matches the occasion and subject.',
        'Design name: ' + name,
        'Design description: ' + description,
        'Campaign/email message context: ' + body.slice(0, 900),
        'Use the company brand colors supplied by the workspace. Keep artwork clean and avoid all text, logos, numbers, coupons or watermarks.',
      ].join('\n');
    }
  }
  if (kind === 'conversation_email' && (htmlDraft.match(/\{\{content\}\}/gi) || []).length !== 1) throw new Error('A conversation email design must include exactly one {{content}} placeholder.');
  if (kind !== 'whatsapp_template' && htmlDraft.length > 52000) throw new Error('The generated email HTML is too large to preview.');

  const brand = (await getCompanyProfile(ctx)).brand as any;
  const website = clean(brand?.websiteUrl, 2048);
  let websiteProfile: any = null;
  if (website) {
    try { websiteProfile = await analyzeCompanyWebsite(website); }
    catch (error: any) { console.warn('[AgentWorkflow] Website brand analysis skipped:', error?.message || error); }
  }
  const assets = await listTenantAssets(ctx);
  const logoUrl = kind === 'whatsapp_template' ? '' : await resolveCompanyLogo(ctx, brand, websiteProfile, assets, appBaseUrl);
  const primaryColor = hex(websiteProfile?.colors?.[0], '#173B63');
  const accentColor = hex(websiteProfile?.colors?.[1], '#EF741A');
  const theme = templateTheme(primaryColor, accentColor);
  let image: { id: string; url: string; mimeType: string; size: number } | null = null;

  if (kind !== 'whatsapp_template' || whatsappCategory === 'MARKETING') {
    image = await generateCampaignArtwork(
      ctx, appBaseUrl, heroPrompt || ('Create a tasteful marketing artwork for a WhatsApp campaign for ' + String(brand?.companyName || 'the company') + ', related to: ' + body.slice(0, 500)), imageAltText,
      String(brand?.companyName || websiteProfile?.companyName || 'Company'),
      primaryColor, accentColor,
    );
  } else if (kind !== 'whatsapp_template') {
    throw new Error('A campaign or conversation design needs a relevant generated hero image. Please provide an image direction.');
  }

  let resolvedHtml = htmlDraft;
  if (kind !== 'whatsapp_template') {
    if (logoUrl) {
      resolvedHtml = resolvedHtml.replace('{{COMPANY_LOGO_URL}}', escapeHtml(logoUrl));
    } else {
      const company = escapeHtml(String(brand?.companyName || websiteProfile?.companyName || 'Our Company'));
      const wordmark = '<span style="display:inline-block;font-family:Arial,Helvetica,sans-serif;font-size:22px;font-weight:700;color:' + primaryColor + ';letter-spacing:-.4px">' + company + '</span>';
      resolvedHtml = resolvedHtml.replace(/<img\b(?=[^>]*\bsrc=["']\{\{COMPANY_LOGO_URL\}\}["'])[^>]*>/i, wordmark);
    }
    if (!image) throw new Error('A required campaign image was not generated.');
    resolvedHtml = resolvedHtml.replace('{{HERO_IMAGE_URL}}', escapeHtml(image.url));
    resolvedHtml = resolvedHtml.replace(/\{\{BRAND_PRIMARY\}\}/g, primaryColor).replace(/\{\{BRAND_ACCENT\}\}/g, accentColor);
    if (/\{\{(?:HERO_IMAGE_URL|COMPANY_LOGO_URL)\}\}/.test(resolvedHtml)) throw new Error('The company logo or hero-image placeholder could not be resolved.');
    const sanitized = sanitizeCustomEmailHtml(resolvedHtml);
    if (!sanitized || !/<table\b/i.test(sanitized) || !/<img\b/i.test(sanitized)) throw new Error('The email HTML did not pass email layout validation.');
    resolvedHtml = sanitized;
  }

  const draftId = randomUUID();
  const companyName = String(brand?.companyName || websiteProfile?.companyName || 'Company');
  const previewHtml = kind === 'whatsapp_template'
    ? ''
    : makePreviewHtml(kind, resolvedHtml, body, { ...brand, logoUrl }, theme, name);
  const draft = {
    id: draftId,
    kind,
    name,
    description,
    subject,
    preheader,
    body,
    htmlBody: resolvedHtml,
    previewHtml,
    theme,
    companyName,
    companyLogoUrl: logoUrl,
    imageAssetId: image?.id || '',
    imageUrl: image?.url || '',
    imageAltText,
    whatsappCategory,
    whatsappLanguage,
    whatsappHeader,
    whatsappFooter,
    whatsappSamples,
    whatsappTemplateType,
    createdBy: ctx.uid,
    conversationId,
    status: 'PREVIEW',
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };
  await setDoc(tenantRepo(ctx).doc('agent_drafts', draftId), draft, { merge: false });
  const artifact = kind === 'whatsapp_template'
    ? {
        type: 'whatsapp_template_preview', draftId, templateKind: kind, name, body,
        header: whatsappHeader, footer: whatsappFooter, imageUrl: image?.url || '',
        category: whatsappCategory, language: whatsappLanguage, status: 'PREVIEW',
      }
    : {
        type: 'agent_email_design_draft', draftId, templateKind: kind, name, subject, preheader,
        html: previewHtml, imageUrl: image?.url || '', imageAssetId: image?.id || '',
        logoUrl, status: 'PREVIEW',
      };
  await writeTenantAuditEvent(ctx, {
    action: 'AGENT_TEMPLATE_PREVIEW_CREATED',
    module: kind === 'whatsapp_template' ? 'WHATSAPP' : 'EMAIL_DESIGN',
    description: 'AI Agent created a preview draft; no template collection was changed.',
    target: { type: 'Agent Template Draft', id: draftId, name },
    metadata: { kind, imageAssetId: image?.id || '', imageModel: image ? IMAGE_MODEL : '' },
  });
  return {
    output: { success: true, prepared: true, draftId, kind, name, imageGenerated: Boolean(image), imageSavedToCompanyAssets: Boolean(image), logoResolved: Boolean(logoUrl), nextStep: 'Ask the user where to save this preview. Do not save it automatically.' },
    artifact,
  };
}

export async function savePreparedAgentTemplate(
  args: any,
  ctx: TenantContext,
  modules: string[],
  conversationId: string,
  userMessage: string,
): Promise<{ output: Record<string, unknown>; artifact: Record<string, unknown> }> {
  const draftId = clean(args?.draftId, 100);
  const destination = clean(args?.destination, 30).toLowerCase();
  if (!draftId || !['campaign', 'conversation', 'whatsapp_draft'].includes(destination)) throw new Error('Choose a valid template destination.');
  if (!hasSaveApproval(userMessage, destination)) throw new Error('I have prepared the preview, but I need your explicit confirmation to save it to that destination. Please say “Save this as a campaign template” or “Save this as a conversation email design”.');
  const ref = tenantRepo(ctx).doc('agent_drafts', draftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('This preview draft has expired or could not be found.');
  const draft = snap.data() as any;
  if (draft.createdBy !== ctx.uid || draft.conversationId !== conversationId) throw Object.assign(new Error('This draft belongs to another user or conversation.'), { status: 404 });
  const can = (module: string) => modules.includes('*') || modules.includes(module);
  if (destination === 'campaign' && !can('campaigns') && !can('email-design-studio') && !can('settings')) throw Object.assign(new Error('Campaign template permission is required.'), { status: 403 });
  if (destination === 'conversation' && !can('email-design-studio') && !can('settings')) throw Object.assign(new Error('Email Design Studio permission is required.'), { status: 403 });
  if (destination === 'whatsapp_draft' && !can('whatsapp') && !can('settings')) throw Object.assign(new Error('WhatsApp template permission is required.'), { status: 403 });
  if (draft.status === 'SAVED') {
    if (draft.destination !== destination) throw new Error('This design has already been saved to ' + String(draft.savedTo || 'another destination') + '. Create a new preview to save a separate copy.');
    const preview = draft.kind === 'whatsapp_template'
      ? { type: 'whatsapp_template_preview', draftId, templateId: draft.savedTemplateId, name: draft.name, body: draft.body, imageUrl: draft.imageUrl, status: 'SAVED_DRAFT', savedTo: draft.savedTo }
      : { type: destination === 'campaign' ? 'campaign_email_template' : 'conversation_email_design', draftId, templateId: draft.savedTemplateId, name: draft.name, subject: draft.subject, preheader: draft.preheader, html: draft.previewHtml, imageUrl: draft.imageUrl, imageAssetId: draft.imageAssetId, savedTo: draft.savedTo, version: 1 };
    return { output: { success: true, saved: true, alreadySaved: true, templateId: draft.savedTemplateId, name: draft.name, savedTo: draft.savedTo }, artifact: preview };
  }
  if (draft.status !== 'PREVIEW') throw new Error('This draft is no longer available for saving.');
  let savedId = String(draft.savedTemplateId || '');
  let savedName = String(draft.name || 'AI Design');
  let savedTo = '';
  if (destination === 'campaign') {
    if (draft.kind !== 'campaign_email') throw new Error('Only a campaign email preview can be saved as a campaign template.');
    await requireFeature(ctx.tenantId, 'campaigns');
    const saved = await runWithCampaignCtx(ctx, async () => {
      await initCampaignStore();
      return saveCampaignTemplate({
        name: draft.name,
        subject: draft.subject,
        preheader: draft.preheader,
        body: draft.body,
        htmlBody: draft.htmlBody,
        format: 'html',
        isHtml: true,
        attachments: [],
        designSnapshot: {
          id: '',
          name: draft.name,
          description: draft.description,
          category: 'AI Campaigns',
          source: 'AI',
          customHtml: draft.htmlBody,
          theme: draft.theme,
          campaignSubject: draft.subject,
          campaignPreheader: draft.preheader,
          campaignBody: draft.body,
          agentManagedDraft: true,
          agentCreatedBy: ctx.uid,
          agentConversationId: conversationId,
          agentDraftId: draftId,
          generatedHeroAssetId: draft.imageAssetId,
          generatedHeroAssetUrl: draft.imageUrl,
          companyLogoUrl: draft.companyLogoUrl,
          brandColors: [draft.theme.primaryColor, draft.theme.accentColor],
        },
      } as any);
    });
    savedId = saved.templateId;
    savedName = saved.name;
    savedTo = 'Template Studio → Campaign Emails → My Designs';
    const verified = await getDoc(tenantRepo(ctx).emailTemplateDoc(savedId));
    if (!verified.exists() || String((verified.data() as any)?.htmlBody || '') !== String(draft.htmlBody || '')) {
      throw new Error('The campaign template save could not be verified. It remains a preview draft.');
    }
  } else if (destination === 'conversation') {
    if (draft.kind !== 'conversation_email') throw new Error('Only a conversation email design can be saved in Email Design Studio.');
    const saved = await saveEmailDesignTemplate(ctx, {
      id: 'agent-' + draftId.replace(/-/g, '').slice(0, 24),
      name: draft.name,
      description: draft.description,
      category: 'AI Generated',
      source: 'AI',
      customHtml: draft.htmlBody,
      theme: draft.theme,
      blocks: [],
    });
    savedId = saved.id;
    savedName = saved.name;
    savedTo = 'Email Design Studio → My Designs';
    const verification = await getDoc(tenantRepo(ctx).doc('email_design_templates', savedId));
    if (!verification.exists()) throw new Error('The conversation email design save could not be verified.');
  } else {
    if (draft.kind !== 'whatsapp_template') throw new Error('Only a WhatsApp preview can be saved as a WhatsApp draft.');
    savedTo = 'AI Agent → Drafted WhatsApp templates';
    savedId = draftId;
  }

  await setDoc(ref, {
    status: 'SAVED',
    savedTemplateId: savedId,
    savedTo,
    destination,
    savedAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  }, { merge: true });
  await writeTenantAuditEvent(ctx, {
    action: 'AGENT_TEMPLATE_DRAFT_SAVED',
    module: destination === 'whatsapp_draft' ? 'WHATSAPP' : destination === 'campaign' ? 'CAMPAIGNS' : 'EMAIL_DESIGN',
    description: 'AI Agent saved a reviewed design draft to the requested destination.',
    target: { type: 'Agent Template', id: savedId, name: savedName },
    metadata: { draftId, destination, savedTo },
  });
  const artifact = draft.kind === 'whatsapp_template'
    ? { type: 'whatsapp_template_preview', draftId, templateId: savedId, templateKind: draft.kind, name: savedName, body: draft.body, imageUrl: draft.imageUrl, status: 'SAVED_DRAFT', savedTo }
    : { type: destination === 'campaign' ? 'campaign_email_template' : 'conversation_email_design', draftId, templateId: savedId, name: savedName, subject: draft.subject, preheader: draft.preheader, html: draft.previewHtml, imageUrl: draft.imageUrl, imageAssetId: draft.imageAssetId, savedTo, version: 1 };
  return {
    output: { success: true, saved: true, templateId: savedId, name: savedName, destination, savedTo },
    artifact,
  };
}

export async function submitPreparedWhatsAppDraft(
  args: any,
  ctx: TenantContext,
  modules: string[],
  conversationId: string,
  userMessage: string,
): Promise<{ output: Record<string, unknown>; artifact: Record<string, unknown> }> {
  const draftId = clean(args?.draftId, 100);
  if (!draftId || !/\b(submit|send)\b/i.test(userMessage) || !/\b(meta|whatsapp|review)\b/i.test(userMessage)) {
    throw new Error('Submitting a WhatsApp template to Meta requires your explicit confirmation. Please say “Submit this WhatsApp template to Meta”.');
  }
  if (ctx.role === 'member' || (!modules.includes('*') && !modules.includes('whatsapp') && !modules.includes('settings'))) throw Object.assign(new Error('Only authorized workspace administrators can submit WhatsApp templates to Meta.'), { status: 403 });
  const ref = tenantRepo(ctx).doc('agent_drafts', draftId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('WhatsApp preview draft not found.');
  const draft = snap.data() as any;
  if (draft.createdBy !== ctx.uid || draft.conversationId !== conversationId || draft.kind !== 'whatsapp_template') throw Object.assign(new Error('This WhatsApp draft is not available to this user.'), { status: 404 });
  if (draft.metaTemplateId) return { output: { success: true, alreadySubmitted: true, templateId: draft.metaTemplateId, status: draft.metaStatus }, artifact: { type: 'whatsapp_template_preview', draftId, templateId: draft.metaTemplateId, name: draft.name, body: draft.body, status: draft.metaStatus } };

  let headerMediaHandle = '';
  if (draft.imageAssetId) {
    const raw = await resolveAssetRaw(String(draft.imageAssetId));
    if (!raw) throw new Error('The generated WhatsApp header image is no longer available in Company Assets.');
    const session = await createWhatsAppTemplateMediaSession(ctx, { fileName: 'agent-template-header.jpg', mimeType: 'image/jpeg', fileLength: raw.buffer.length });
    let offset = 0;
    let fileHandle = '';
    while (offset < raw.buffer.length) {
      const chunk = raw.buffer.subarray(offset, Math.min(offset + 1024 * 1024, raw.buffer.length));
      const result = await uploadWhatsAppTemplateMediaChunk(ctx, { uploadKey: session.uploadKey, offset, base64: chunk.toString('base64') });
      offset = result.uploadedBytes;
      if (result.fileHandle) fileHandle = result.fileHandle;
    }
    headerMediaHandle = fileHandle;
  }

  const slugBase = clean(draft.name, 65).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '').slice(0, 52) || 'agent_marketing_template';
  const slug = slugBase + '_' + draftId.replace(/[^a-z0-9]/gi, '').slice(0, 8).toLowerCase();
  const meta = await createWhatsAppTemplate(ctx, {
    name: slug,
    language: draft.whatsappLanguage || 'en_US',
    category: draft.whatsappCategory || 'MARKETING',
    templateType: draft.whatsappTemplateType || 'STANDARD',
    headerFormat: headerMediaHandle ? 'IMAGE' : 'TEXT',
    headerText: draft.whatsappHeader || '',
    headerMediaHandle,
    body: draft.body,
    footer: draft.whatsappFooter || '',
    samples: Array.isArray(draft.whatsappSamples) ? draft.whatsappSamples : [],
    buttons: Array.isArray(draft.whatsappButtons) ? draft.whatsappButtons : [],
  });
  await setDoc(ref, { status: 'SUBMITTED_TO_META', metaTemplateId: meta.id, metaStatus: meta.status, submittedAt: new Date().toISOString() }, { merge: true });
  await writeTenantAuditEvent(ctx, {
    action: 'AGENT_WHATSAPP_TEMPLATE_SUBMITTED',
    module: 'WHATSAPP',
    description: 'AI Agent submitted a user-approved WhatsApp template to Meta for review.',
    target: { type: 'WhatsApp Template', id: meta.id, name: slug },
    metadata: { status: meta.status, draftId },
  });
  return {
    output: { success: true, submitted: true, templateId: meta.id, status: meta.status, message: 'Submitted to Meta for review. This is not an approval.' },
    artifact: { type: 'whatsapp_template_preview', draftId, templateId: meta.id, name: slug, body: draft.body, imageUrl: draft.imageUrl, status: meta.status, savedTo: 'Meta WhatsApp template manager' },
  };
}

export async function prepareCampaignDispatch(
  args: any,
  ctx: TenantContext,
  modules: string[],
  conversationId: string,
): Promise<{ output: Record<string, unknown>; artifact: Record<string, unknown> }> {
  const canCampaign = modules.includes('*') || modules.includes('campaigns');
  const canDatabase = modules.includes('*') || modules.includes('database');
  if (!canCampaign || !canDatabase) throw Object.assign(new Error('You need Campaigns and Database module permissions to prepare this dispatch.'), { status: 403 });
  await requireFeature(ctx.tenantId, 'campaigns');
  const dbName = clean(args?.databaseNameOrId, 160);
  const templateName = clean(args?.templateNameOrId, 160);
  if (!dbName || !templateName) throw new Error('Select both a saved campaign email template and a lead database.');
  const databases = await listLeadDatabases(ctx);
  const dbMatches = databases.filter((item: any) => item.databaseId.toLowerCase() === dbName.toLowerCase() || item.name.toLowerCase() === dbName.toLowerCase());
  if (dbMatches.length !== 1) {
    return { output: { needsClarification: true, reason: dbMatches.length ? 'More than one database matches.' : 'Database not found.', availableDatabases: databases.map((item: any) => ({ id: item.databaseId, name: item.name })) }, artifact: { type: 'campaign_dispatch_choice' } };
  }
  const templates = await runWithCampaignCtx(ctx, async () => {
    await initCampaignStore();
    return await getTemplatesFromDbOrCache();
  });
  const tplMatches = templates.filter((item: any) => String(item.templateId).toLowerCase() === templateName.toLowerCase() || String(item.name).toLowerCase() === templateName.toLowerCase());
  if (tplMatches.length !== 1) {
    return { output: { needsClarification: true, reason: tplMatches.length ? 'More than one campaign template matches.' : 'Campaign template not found. Save the preview to Campaign Emails first.', availableTemplates: templates.map((item: any) => ({ id: item.templateId, name: item.name, subject: item.subject })) }, artifact: { type: 'campaign_template_choice' } };
  }
  const selectedDatabase = dbMatches[0];
  const selectedTemplate = tplMatches[0];
  if (!selectedTemplate.htmlBody || !selectedTemplate.isHtml) throw new Error('The selected campaign template is not a verified HTML campaign email.');
  const snapshot = await getCampaignDatabaseSnapshot(ctx, selectedDatabase.databaseId);
  if (!snapshot.leads.length) throw new Error('The selected database has no valid email recipients.');
  const sendReadiness = await getEmailSendReadiness(ctx.tenantId);
  const created = await runWithCampaignCtx(ctx, async () => createCampaign({
    name: clean(args?.campaignName, 100) || String(selectedTemplate.name || 'AI Campaign'),
    type: 'EMAIL',
    campaignMode: 'PREDEFINED',
    deliveryMode: 'LIVE_SMTP',
    templateId: selectedTemplate.templateId,
    templateName: selectedTemplate.name,
    sourceDatabaseId: selectedDatabase.databaseId,
    sourceDatabaseName: selectedDatabase.name,
    leads: snapshot.leads as any,
    startImmediately: false,
  }));
  const approvalId = randomUUID();
  const action = {
    id: approvalId,
    type: 'CAMPAIGN_DISPATCH',
    campaignId: created.campaign.campaignId,
    campaignName: created.campaign.name,
    templateId: selectedTemplate.templateId,
    templateName: selectedTemplate.name,
    databaseId: selectedDatabase.databaseId,
    databaseName: selectedDatabase.name,
    eligibleRecipients: snapshot.leads.length,
    excludedWithoutEmail: snapshot.excludedWithoutEmail,
    actorUid: ctx.uid,
    conversationId,
    status: 'PENDING_APPROVAL',
    sendReady: sendReadiness.ok,
    sendReadinessError: sendReadiness.error || '',
    createdAt: new Date().toISOString(),
  };
  await setDoc(tenantRepo(ctx).doc('agent_campaign_approvals', approvalId), action, { merge: false });
  await setDoc(tenantRepo(ctx).campaignDoc(created.campaign.campaignId), {
    agentCreatedBy: ctx.uid, agentConversationId: conversationId, agentApprovalId: approvalId,
  }, { merge: true });
  await writeTenantAuditEvent(ctx, {
    action: 'AGENT_CAMPAIGN_PREPARED',
    module: 'CAMPAIGNS',
    description: 'AI Agent prepared an outbound campaign as a draft; dispatch is awaiting explicit approval.',
    target: { type: 'Campaign', id: created.campaign.campaignId, name: created.campaign.name },
    metadata: { templateId: selectedTemplate.templateId, databaseId: selectedDatabase.databaseId, eligibleRecipients: snapshot.leads.length, sendReady: sendReadiness.ok },
  });
  const artifact = {
    type: 'campaign_dispatch_approval',
    approvalId,
    campaignId: created.campaign.campaignId,
    name: created.campaign.name,
    templateName: selectedTemplate.name,
    templateId: selectedTemplate.templateId,
    databaseName: selectedDatabase.name,
    recipientCount: snapshot.leads.length,
    excludedWithoutEmail: snapshot.excludedWithoutEmail,
    sendReady: sendReadiness.ok,
    sendReadinessError: sendReadiness.error || '',
    status: 'PENDING_APPROVAL',
  };
  return {
    output: { success: true, prepared: true, ...artifact, duplicatesSkipped: created.duplicatesSkipped, nextStep: 'Ask the user for explicit confirmation before dispatching.' },
    artifact,
  };
}

export async function confirmCampaignDispatch(
  args: any,
  ctx: TenantContext,
  modules: string[],
  conversationId: string,
  userMessage: string,
): Promise<{ output: Record<string, unknown>; artifact: Record<string, unknown> }> {
  const approvalId = clean(args?.approvalId, 100);
  if (!approvalId || !hasDispatchConfirmation(userMessage)) throw new Error('Campaign dispatch needs your explicit confirmation. Please reply “Yes, send this campaign now”.');
  if (!modules.includes('*') && !modules.includes('campaigns')) throw Object.assign(new Error('You do not have permission to send campaigns.'), { status: 403 });
  await requireFeature(ctx.tenantId, 'campaigns');
  const ref = tenantRepo(ctx).doc('agent_campaign_approvals', approvalId);
  const snap = await getDoc(ref);
  if (!snap.exists()) throw new Error('Campaign approval request not found.');
  const approval = snap.data() as any;
  if (approval.actorUid !== ctx.uid || approval.conversationId !== conversationId) throw Object.assign(new Error('This campaign approval belongs to another user or conversation.'), { status: 404 });
  if (approval.status === 'DISPATCH_STARTED') {
    return { output: { success: true, alreadyStarted: true, campaignId: approval.campaignId, status: approval.status }, artifact: { ...approval, type: 'campaign_dispatch_approval' } };
  }
  if (approval.status !== 'PENDING_APPROVAL') throw new Error('This campaign approval is no longer pending.');
  const readiness = await getEmailSendReadiness(ctx.tenantId);
  if (!readiness.ok) throw new Error(readiness.error || 'The workspace email sender is not ready.');
  const claimRef = tenantRepo(ctx).doc('agent_campaign_dispatch_claims', approvalId);
  try {
    await createDoc(claimRef, { approvalId, campaignId: approval.campaignId, actorUid: ctx.uid, claimedAt: new Date().toISOString() });
  } catch {
    const refreshed = await getDoc(ref);
    const state = refreshed.exists() ? refreshed.data() as any : {};
    return { output: { success: state.status === 'DISPATCH_STARTED', alreadyClaimed: true, campaignId: approval.campaignId, status: state.status || 'PROCESSING' }, artifact: { ...state, type: 'campaign_dispatch_approval' } };
  }
  try {
    const started = await runWithCampaignCtx(ctx, () => startCampaign(approval.campaignId, { sendInitialBatch: false }));
    const firstBatch = runWithCampaignCtx(ctx, () => processNextCampaignSendBatch(approval.campaignId, 500)).then(async (result) => {
      if (result.sendBlockedReason) {
        await runWithCampaignCtx(ctx, () => import('./campaignService.js').then((service) => service.pauseCampaign(approval.campaignId)));
        await setDoc(ref, { status: 'BLOCKED', blockedReason: result.sendBlockedReason, updatedAt: new Date().toISOString() }, { merge: true });
      }
    }).catch((error: any) => console.warn('[AgentWorkflow] First campaign send batch failed; cron can continue:', error?.message || error));
    waitUntil(firstBatch);
    const now = new Date().toISOString();
    await setDoc(ref, { status: 'DISPATCH_STARTED', startedAt: now, updatedAt: now }, { merge: true });
    await writeTenantAuditEvent(ctx, {
      action: 'AGENT_CAMPAIGN_DISPATCH_APPROVED',
      module: 'CAMPAIGNS',
      description: 'User explicitly approved dispatch; the existing campaign engine was started.',
      target: { type: 'Campaign', id: approval.campaignId, name: approval.campaignName },
      metadata: { approvalId, campaignId: approval.campaignId, databaseId: approval.databaseId, templateId: approval.templateId },
    });
    return {
      output: { success: true, dispatched: true, campaignId: approval.campaignId, status: started.status, recipientCount: approval.eligibleRecipients, message: 'Campaign dispatch has started. Delivery status will update in Campaigns.' },
      artifact: { ...approval, type: 'campaign_dispatch_approval', status: 'DISPATCH_STARTED', startedAt: now },
    };
  } catch (error: any) {
    await setDoc(ref, { status: 'DISPATCH_FAILED', error: clean(error?.message || 'Could not start campaign dispatch.', 500), updatedAt: new Date().toISOString() }, { merge: true });
    throw error;
  }
}

export async function saveAgentWorkflowAudit(ctx: TenantContext, action: string, id: string, description: string, metadata: Record<string, unknown> = {}) {
  await writeTenantAuditEvent(ctx, {
    action,
    module: 'AI_ENGINE',
    description,
    target: { type: 'AI Agent Workflow', id },
    metadata,
  });
}


export async function listAvailableCampaignTemplates(ctx: TenantContext): Promise<Array<Record<string, unknown>>> {
  await requireFeature(ctx.tenantId, 'campaigns');
  const templates = await runWithCampaignCtx(ctx, async () => {
    await initCampaignStore();
    return await getTemplatesFromDbOrCache();
  });
  return templates.map((item: any) => ({
    templateId: item.templateId,
    name: item.name,
    subject: item.subject,
    format: item.format,
    isHtml: Boolean(item.isHtml),
    updatedAt: item.updatedAt,
  }));
}

export async function getAgentCampaignStatus(ctx: TenantContext, campaignId: string): Promise<Record<string, unknown>> {
  const campaign = await runWithCampaignCtx(ctx, () => getCampaignByIdAsync(campaignId));
  if (!campaign) throw new Error('Campaign not found in this workspace.');
  const stored = await getDoc(tenantRepo(ctx).campaignDoc(campaignId));
  if (!stored.exists()) throw new Error('Campaign not found in this workspace.');
  const data = stored.data() as any;
  return {
    campaignId: campaign.campaignId,
    name: campaign.name,
    status: campaign.status,
    totalLeads: campaign.totalLeads,
    sentCount: campaign.sentCount,
    pendingCount: campaign.pendingCount,
    failedCount: campaign.failedCount,
    repliedCount: campaign.repliedCount,
    startedAt: campaign.startedAt,
    completedAt: campaign.completedAt,
    sourceDatabaseName: campaign.sourceDatabaseName,
    templateName: campaign.templateName,
    updatedAt: campaign.updatedAt,
    agentCreatedBy: data.agentCreatedBy || '',
  };
}
