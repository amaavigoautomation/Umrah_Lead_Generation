import crypto from 'node:crypto';
import { getDoc, getDocs, query, where, limit } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';
import { tenantRepo } from './tenantRepo.js';
import { sendLiveEmail, fetchFirestoreSmtpConfig } from './smtpService.js';
import { getTenantBrand } from './brandService.js';
import { listWhatsAppTemplates, sendWhatsAppTemplate } from './metaChannelsService.js';
import type { TenantContext } from '../types/tenant.js';
import type { Conversation, EmailTemplate, Message } from '../types/index.js';

export type WebsiteConfirmationChannel = 'EMAIL' | 'WHATSAPP' | 'BOTH';
export type WebsiteConfirmationMode = 'AUTO' | 'REVIEW' | 'OFF';

export interface WebsiteFormConfirmationSettings {
  channel: WebsiteConfirmationChannel;
  emailTemplateId: string;
  whatsappTemplateName: string;
  whatsappLanguage: string;
  /** Ordered mapping for Meta body variables, one source field per {{n}} placeholder. */
  whatsappParameterMapping: string[];
  requireWhatsAppOptIn: true;
  updatedAt?: string;
}

export interface WebsiteFormLeadValues {
  firstName: string;
  fullName: string;
  company: string;
  email: string;
  phone: string;
  product: string;
  teamSize: string;
  city: string;
  country: string;
  message: string;
}

const SETTINGS_DOC = 'website_form_confirmation';
const DEFAULT_EMAIL_TEMPLATE_ID = 'website-form-thankyou-default';
const DEFAULT_CHANNEL_SETTINGS: WebsiteFormConfirmationSettings = {
  channel: 'EMAIL',
  emailTemplateId: DEFAULT_EMAIL_TEMPLATE_ID,
  whatsappTemplateName: '',
  whatsappLanguage: '',
  whatsappParameterMapping: [],
  requireWhatsAppOptIn: true,
};
const FIELD_KEYS = [
  'firstName', 'fullName', 'company', 'email', 'phone',
  'product', 'teamSize', 'city', 'country', 'message',
] as const;
const inFlight = new Set<string>();

function safeSubmissionId(raw: unknown): string {
  const value = String(raw || '').trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 80);
  return value || crypto.randomUUID();
}

function escapeHtml(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function replaceLeadTokens(input: unknown, values: WebsiteFormLeadValues, html = false): string {
  const source = String(input ?? '');
  const tokens: Record<string, string> = {
    first_name: values.firstName, firstName: values.firstName, firstname: values.firstName,
    full_name: values.fullName, fullName: values.fullName, name: values.fullName,
    company: values.company, company_name: values.company, companyName: values.company,
    email: values.email, phone: values.phone, product: values.product,
    productInterest: values.product, product_interest: values.product,
    team_size: values.teamSize, teamSize: values.teamSize,
    city: values.city, country: values.country, message: values.message, query: values.message,
  };
  return source.replace(/\{\{\s*([a-zA-Z_][a-zA-Z0-9_]*)\s*\}\}/g, (match, key: string) => {
    const value = tokens[key] ?? tokens[key.toLowerCase()];
    return value === undefined ? match : (html ? escapeHtml(value) : value);
  });
}

function valuesForField(values: WebsiteFormLeadValues, field: string): string {
  const key = String(field || '').trim() as keyof WebsiteFormLeadValues;
  return FIELD_KEYS.includes(key as any) ? String(values[key] || '') : '';
}

function defaultEmailTemplate(now: string): EmailTemplate {
  const body = [
    'Hello {{firstName}},',
    '',
    'Thank you for contacting {{companyName}}. We have received your enquiry and our team will review the details shortly.',
    '',
    'Your submission:',
    '• Company: {{company}}',
    '• Interest: {{product}}',
    '• Team size: {{teamSize}}',
    '• Location: {{city}}, {{country}}',
    '• Message: {{message}}',
    '',
    'We will be in touch soon.',
    '',
    'Warm regards,',
    '{{companyName}} Team',
  ].join('\n');
  const htmlBody = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#25364a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="600" style="max-width:600px;width:100%;background:#fff;border-radius:14px" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:32px"><p style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#d97842;text-transform:uppercase">FORM SUBMISSION CONFIRMATION</p><h1 style="font-size:26px;color:#173b63">Thank you, {{firstName}}.</h1><p style="font-size:15px;line-height:1.7">We have received your enquiry with <strong>{{companyName}}</strong>. Our team will review it and get back to you shortly.</p><h2 style="font-size:17px;color:#173b63">Your submission</h2><p style="font-size:14px;line-height:1.8"><strong>Company:</strong> {{company}}<br><strong>Interest:</strong> {{product}}<br><strong>Team size:</strong> {{teamSize}}<br><strong>Location:</strong> {{city}}, {{country}}<br><strong>Message:</strong> {{message}}</p><p style="font-size:14px;line-height:1.7">We appreciate your interest and will be in touch soon.</p><p style="font-size:14px;line-height:1.7">Warm regards,<br><strong>{{companyName}} Team</strong></p></td></tr></table></td></tr></table></body></html>`;
  return {
    templateId: DEFAULT_EMAIL_TEMPLATE_ID,
    name: 'Website Form Thank-you',
    purpose: 'WEBSITE_FORM_THANKYOU',
    subject: 'We received your enquiry, {{firstName}}',
    body,
    htmlBody,
    format: 'html',
    isHtml: true,
    preheader: 'Your enquiry has been received.',
    attachments: [],
    createdAt: now,
    updatedAt: now,
  };
}

export async function getWebsiteFormConfirmationSettings(ctx: TenantContext): Promise<WebsiteFormConfirmationSettings> {
  if (!isFirebaseConfigured) return { ...DEFAULT_CHANNEL_SETTINGS };
  const repo = tenantRepo(ctx);
  const templateRef = repo.emailTemplateDoc(DEFAULT_EMAIL_TEMPLATE_ID);
  const templateSnap = await getDoc(templateRef);
  if (!templateSnap.exists()) {
    const now = new Date().toISOString();
    await safeSetDoc(templateRef, defaultEmailTemplate(now), { merge: false });
  } else {
    const current = templateSnap.data() as EmailTemplate;
    if (current.purpose !== 'WEBSITE_FORM_THANKYOU') {
      await safeSetDoc(templateRef, { purpose: 'WEBSITE_FORM_THANKYOU', updatedAt: new Date().toISOString() }, { merge: true });
    }
  }
  const settingsSnap = await getDoc(repo.settingsDoc(SETTINGS_DOC));
  const raw = settingsSnap.exists() ? settingsSnap.data() as Partial<WebsiteFormConfirmationSettings> : {};
  const channel = ['EMAIL', 'WHATSAPP', 'BOTH'].includes(String(raw.channel || ''))
    ? raw.channel as WebsiteConfirmationChannel : 'EMAIL';
  const emailTemplateSnap = raw.emailTemplateId
    ? await getDoc(repo.emailTemplateDoc(String(raw.emailTemplateId)))
    : null;
  const emailTemplateId = emailTemplateSnap?.exists()
    && (emailTemplateSnap.data() as EmailTemplate).purpose === 'WEBSITE_FORM_THANKYOU'
    ? String(raw.emailTemplateId)
    : DEFAULT_EMAIL_TEMPLATE_ID;
  return {
    channel,
    emailTemplateId,
    whatsappTemplateName: String(raw.whatsappTemplateName || ''),
    whatsappLanguage: String(raw.whatsappLanguage || ''),
    whatsappParameterMapping: Array.isArray(raw.whatsappParameterMapping)
      ? raw.whatsappParameterMapping.map((value) => String(value)).slice(0, 20) : [],
    requireWhatsAppOptIn: true,
    updatedAt: String(raw.updatedAt || ''),
  };
}

export async function saveWebsiteFormConfirmationSettings(
  ctx: TenantContext,
  input: Partial<WebsiteFormConfirmationSettings>
): Promise<WebsiteFormConfirmationSettings> {
  const current = await getWebsiteFormConfirmationSettings(ctx);
  const channel = ['EMAIL', 'WHATSAPP', 'BOTH'].includes(String(input.channel || ''))
    ? input.channel as WebsiteConfirmationChannel : current.channel;
  const emailTemplateId = String(input.emailTemplateId || current.emailTemplateId).trim();
  const repo = tenantRepo(ctx);
  if (channel === 'EMAIL' || channel === 'BOTH') {
    const emailTemplate = await getDoc(repo.emailTemplateDoc(emailTemplateId));
    if (!emailTemplate.exists() || (emailTemplate.data() as EmailTemplate).purpose !== 'WEBSITE_FORM_THANKYOU') {
      throw new Error('Choose a saved Website Form Thank-you template from Template Studio.');
    }
  }

  const whatsappTemplateName = String(input.whatsappTemplateName ?? current.whatsappTemplateName).trim();
  const whatsappLanguage = String(input.whatsappLanguage ?? current.whatsappLanguage).trim();
  const mapping = Array.isArray(input.whatsappParameterMapping)
    ? input.whatsappParameterMapping.map((value) => String(value)).slice(0, 20) : current.whatsappParameterMapping;

  if (channel === 'WHATSAPP' || channel === 'BOTH') {
    if (!whatsappTemplateName || !whatsappLanguage) throw new Error('Choose an approved WhatsApp template and language.');
    const approved = await listWhatsAppTemplates(ctx);
    const selected = approved.find((template: any) => template.name === whatsappTemplateName && template.language === whatsappLanguage);
    if (!selected) throw new Error('The selected WhatsApp template is not currently approved. Refresh the template list and choose an approved template.');
    if (mapping.length !== Number(selected.paramCount || 0)) {
      throw new Error(`Map all ${Number(selected.paramCount || 0)} WhatsApp template parameter(s) before saving.`);
    }
    if (mapping.some((field) => !FIELD_KEYS.includes(field as any))) throw new Error('One or more WhatsApp parameter mappings are invalid.');
  }

  const saved: WebsiteFormConfirmationSettings = {
    channel, emailTemplateId, whatsappTemplateName, whatsappLanguage,
    whatsappParameterMapping: mapping, requireWhatsAppOptIn: true, updatedAt: new Date().toISOString(),
  };
  await safeSetDoc(repo.settingsDoc(SETTINGS_DOC), saved, { merge: true });
  return saved;
}

async function addOutboundMessage(
  ctx: TenantContext,
  record: any,
  result: { status: 'SENT' | 'FAILED'; messageId?: string; renderedText?: string; error?: string },
  values: WebsiteFormLeadValues,
): Promise<Message> {
  const now = new Date().toISOString();
  const channel = record.channel as 'EMAIL' | 'WHATSAPP';
  const messageId = `msg-wf-${record.recordId}`;
  const text = result.renderedText || String(record.text || '');
  const message: Message = {
    messageId, conversationId: record.conversationId, channel, direction: 'OUTBOUND',
    senderType: 'AI', senderName: 'Website Confirmation',
    ...(channel === 'EMAIL' ? { senderEmail: String(record.from || ''), recipientEmail: String(record.recipient || ''), emailMeta: { subject: String(record.subject || ''), to: String(record.recipient || '') } } : {}),
    text, timestamp: now, sentAt: now, createdAt: now,
    deliveryStatus: result.status, smtpStatus: channel === 'EMAIL' ? (result.status === 'SENT' ? 'DELIVERED' : 'DELIVERY_FAILED') : undefined,
    ...(channel === 'EMAIL' ? { smtpMessageId: result.messageId || '', emailDeliveredAt: result.status === 'SENT' ? now : undefined, smtpError: result.error } : {}),
    ...(channel === 'WHATSAPP' ? { whatsappMessageId: result.messageId || '' } : {}),
    ...(result.status === 'FAILED' ? { smtpError: result.error } : {}),
    websiteFormSubmissionId: record.submissionId,
    isWebsiteFormConfirmation: true,
    isDraft: false,
  };
  await safeSetDoc(tenantRepo(ctx).messageDoc(messageId), message, { merge: true });
  return message;
}

async function deliverStoredRecord(ctx: TenantContext, input: any): Promise<{ record: any; message?: Message }> {
  const repo = tenantRepo(ctx);
  const recordId = String(input.recordId || '');
  if (!recordId) throw new Error('Delivery record id is required.');
  const lockKey = `${ctx.tenantId}:${recordId}`;
  if (inFlight.has(lockKey)) return { record: input };
  inFlight.add(lockKey);
  try {
    const snap = await getDoc(repo.websiteFormDeliveryDoc(recordId));
    if (!snap.exists()) throw new Error('Website form delivery record was not found.');
    let record: any = { ...snap.data(), recordId };
    if (record.status === 'SENT' || record.status === 'SKIPPED' || record.status === 'DRAFT' || record.status === 'FAILED_FINAL') {
      return { record };
    }
    const now = new Date();
    const attemptCount = Number(record.attemptCount || 0) + 1;
    record = { ...record, status: 'SENDING', attemptCount, lastAttemptAt: now.toISOString(), leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(), updatedAt: now.toISOString() };
    await safeSetDoc(repo.websiteFormDeliveryDoc(recordId), record, { merge: true });

    let providerResult: any;
    if (record.channel === 'EMAIL') {
      await fetchFirestoreSmtpConfig();
      providerResult = await sendLiveEmail({
        tenantId: ctx.tenantId,
        to: String(record.recipient || ''),
        subject: String(record.subject || ''),
        text: String(record.text || ''),
        html: String(record.html || ''),
        headers: {
          'X-Website-Form-Submission': String(record.submissionId),
          'X-Conversation-Id': String(record.conversationId),
          'X-Lead-Id': String(record.leadId),
        },
      });
      if (!providerResult?.success) throw new Error(providerResult?.error || 'Email provider did not accept the confirmation.');
    } else if (record.channel === 'WHATSAPP') {
      providerResult = await sendWhatsAppTemplate(ctx, String(record.recipient || ''), {
        name: String(record.whatsappTemplateName || ''),
        language: String(record.whatsappLanguage || ''),
        params: Array.isArray(record.whatsappParameters) ? record.whatsappParameters : [],
      });
    } else {
      throw new Error('Unsupported website confirmation channel.');
    }

    const deliveredAt = new Date().toISOString();
    const updated = {
      ...record, status: 'SENT', sentAt: deliveredAt, updatedAt: deliveredAt,
      providerMessageId: String(providerResult?.messageId || ''),
      lastError: '',
    };
    await safeSetDoc(repo.websiteFormDeliveryDoc(recordId), updated, { merge: true });
    const message = await addOutboundMessage(ctx, updated, {
      status: 'SENT',
      messageId: providerResult?.messageId,
      renderedText: providerResult?.renderedText,
    }, record.values || {} as WebsiteFormLeadValues);
    return { record: updated, message };
  } catch (error: any) {
    const now = new Date();
    const attempts = Number(input.attemptCount || 0) + 1;
    const final = attempts >= 6;
    const updated = {
      ...input, status: final ? 'FAILED_FINAL' : 'FAILED',
      attemptCount: attempts, lastError: String(error?.message || error || 'Delivery failed').slice(0, 500),
      nextRetryAt: final ? '' : new Date(now.getTime() + Math.min(60 * 60 * 1000, 60 * 1000 * Math.pow(2, attempts - 1))).toISOString(),
      updatedAt: now.toISOString(),
    };
    await safeSetDoc(repo.websiteFormDeliveryDoc(recordId), updated, { merge: true });
    const message = await addOutboundMessage(ctx, updated, {
      status: 'FAILED', error: updated.lastError,
    }, input.values || {} as WebsiteFormLeadValues).catch(() => undefined);
    return { record: updated, message };
  } finally {
    inFlight.delete(lockKey);
  }
}

export async function processWebsiteFormConfirmation(input: {
  ctx: TenantContext;
  submissionId?: string;
  contact: any;
  lead: any;
  conversation: Conversation;
  values: WebsiteFormLeadValues;
  whatsappOptIn: boolean;
  mode: WebsiteConfirmationMode;
}): Promise<{ submissionId: string; messages: Message[]; drafts: any[]; sentChannels: string[]; statuses: Array<{ channel: string; status: string; error?: string }> }> {
  const { ctx, contact, lead, conversation, values, whatsappOptIn, mode } = input;
  const submissionId = safeSubmissionId(input.submissionId);
  const config = await getWebsiteFormConfirmationSettings(ctx);
  const selectedChannels: Array<'EMAIL' | 'WHATSAPP'> = config.channel === 'BOTH'
    ? ['EMAIL', 'WHATSAPP'] : [config.channel];
  const messages: Message[] = [];
  const drafts: any[] = [];
  const statuses: Array<{ channel: string; status: string; error?: string }> = [];
  const repo = tenantRepo(ctx);
  const brand = await getTenantBrand(ctx.tenantId);

  for (const channel of selectedChannels) {
    const recordId = `wf-${submissionId}-${channel.toLowerCase()}`;
    const existing = isFirebaseConfigured ? await getDoc(repo.websiteFormDeliveryDoc(recordId)) : null;
    if (existing?.exists()) {
      const current = existing.data() as any;
      if (['SENT', 'SKIPPED', 'DRAFT', 'FAILED_FINAL'].includes(String(current.status))) {
        statuses.push({ channel, status: String(current.status), error: current.lastError || current.skipReason });
        continue;
      }
    }

    if (mode === 'OFF') {
      const skipped = { recordId, submissionId, tenantId: ctx.tenantId, conversationId: conversation.conversationId, leadId: lead.leadId, contactId: contact.contactId, channel, status: 'SKIPPED', skipReason: 'Website channel mode is OFF.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await safeSetDoc(repo.websiteFormDeliveryDoc(recordId), skipped, { merge: true });
      statuses.push({ channel, status: 'SKIPPED', error: skipped.skipReason });
      continue;
    }

    if (channel === 'WHATSAPP' && !whatsappOptIn) {
      const skipped = { recordId, submissionId, tenantId: ctx.tenantId, conversationId: conversation.conversationId, leadId: lead.leadId, contactId: contact.contactId, channel, status: 'SKIPPED', skipReason: 'Customer did not opt in to WhatsApp messages.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await safeSetDoc(repo.websiteFormDeliveryDoc(recordId), skipped, { merge: true });
      statuses.push({ channel, status: 'SKIPPED', error: skipped.skipReason });
      continue;
    }

    let record: any = {
      recordId, submissionId, tenantId: ctx.tenantId, conversationId: conversation.conversationId,
      leadId: lead.leadId, contactId: contact.contactId, channel,
      status: mode === 'REVIEW' ? 'DRAFT' : 'PENDING',
      values, recipient: channel === 'EMAIL' ? values.email : values.phone,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(),
      attemptCount: 0,
    };

    if (channel === 'EMAIL') {
      const templateSnap = await getDoc(repo.emailTemplateDoc(config.emailTemplateId));
      if (!templateSnap.exists()) throw new Error('The selected Website Form Thank-you email template no longer exists.');
      const template = templateSnap.data() as EmailTemplate;
      if (template.purpose !== 'WEBSITE_FORM_THANKYOU') throw new Error('The selected email template is not marked for Website Form Thank-you.');
      record = {
        ...record,
        templateId: template.templateId,
        subject: replaceLeadTokens(template.subject || 'Thank you for contacting us, {{firstName}}', values),
        text: replaceLeadTokens(template.body || 'Thank you for your enquiry.', values),
        html: template.isHtml || template.format === 'html'
          ? replaceLeadTokens(template.htmlBody || '', values, true) : '',
        from: brand.salesEmail || '',
      };
      if (!record.recipient || !String(record.recipient).includes('@')) {
        record.status = 'SKIPPED';
        record.skipReason = 'The form did not include a valid email address.';
      }
    } else {
      const approved = await listWhatsAppTemplates(ctx);
      const selected = approved.find((template: any) => template.name === config.whatsappTemplateName && template.language === config.whatsappLanguage);
      if (!selected) throw new Error('The configured WhatsApp template is no longer approved.');
      const params = config.whatsappParameterMapping.map((field) => valuesForField(values, field));
      record = {
        ...record, whatsappTemplateName: config.whatsappTemplateName,
        whatsappLanguage: config.whatsappLanguage, whatsappParameters: params,
        text: String(selected.body || '').replace(/\{\{(\d+)\}\}/g, (_m: string, n: string) => params[Number(n) - 1] || ''),
      };
      if (!record.recipient) {
        record.status = 'SKIPPED';
        record.skipReason = 'The form did not include a phone number.';
      }
    }

    await safeSetDoc(repo.websiteFormDeliveryDoc(recordId), record, { merge: true });
    if (record.status === 'SKIPPED') {
      statuses.push({ channel, status: 'SKIPPED', error: record.skipReason });
      continue;
    }
    if (mode === 'REVIEW') {
      const message: Message = {
        messageId: `msg-wf-${recordId}`, conversationId: conversation.conversationId, channel,
        direction: 'OUTBOUND', senderType: 'AI', senderName: 'Website Confirmation',
        ...(channel === 'EMAIL' ? { recipientEmail: record.recipient, emailMeta: { subject: record.subject, to: record.recipient } } : {}),
        text: String(record.text || ''), timestamp: new Date().toISOString(), createdAt: new Date().toISOString(),
        isDraft: true, draftStatus: 'PENDING', deliveryStatus: 'PENDING',
        websiteFormSubmissionId: submissionId, isWebsiteFormConfirmation: true,
      };
      await safeSetDoc(repo.messageDoc(message.messageId), message, { merge: true });
      messages.push(message);
      drafts.push({ channel, messageId: message.messageId, subject: record.subject, text: message.text, status: 'DRAFT' });
      statuses.push({ channel, status: 'DRAFT' });
      continue;
    }
    const delivered = await deliverStoredRecord(ctx, record);
    if (delivered.message) messages.push(delivered.message);
    statuses.push({ channel, status: String(delivered.record.status), error: delivered.record.lastError });
  }

  if (mode === 'REVIEW' && drafts.length) {
    const currentDrafts = Array.isArray(conversation.websiteFormConfirmationDrafts) ? conversation.websiteFormConfirmationDrafts : [];
    conversation.websiteFormConfirmationDrafts = [...currentDrafts, { submissionId, status: 'PENDING', channels: drafts }].slice(-20);
    conversation.status = 'REVIEW';
  }
  const latestMessage = messages[messages.length - 1];
  const now = new Date().toISOString();
  const patch: Partial<Conversation> = {
    ...(conversation.websiteFormConfirmationDrafts ? { websiteFormConfirmationDrafts: conversation.websiteFormConfirmationDrafts } : {}),
    ...(mode === 'REVIEW' && drafts.length ? { status: 'REVIEW' } : {}),
    ...(latestMessage ? { lastMessageAt: latestMessage.timestamp, lastMessageText: latestMessage.text.slice(0, 300), updatedAt: now } : {}),
  };
  if (Object.keys(patch).length && isFirebaseConfigured) await safeSetDoc(repo.conversationDoc(conversation.conversationId), patch, { merge: true });
  return { submissionId, messages, drafts, sentChannels: statuses.filter((item) => item.status === 'SENT').map((item) => item.channel), statuses };
}

export async function approveWebsiteFormConfirmation(
  ctx: TenantContext, conversationId: string, submissionId: string
): Promise<{ results: Array<{ channel: string; status: string; error?: string }> }> {
  const repo = tenantRepo(ctx);
  const snaps = await getDocs(query(
    repo.websiteFormDeliveries(),
    where('conversationId', '==', conversationId),
    where('submissionId', '==', submissionId),
    limit(5),
  ));
  const records = snaps.docs.map((doc: any) => ({ ...doc.data(), recordId: doc.id }));
  const results: Array<{ channel: string; status: string; error?: string }> = [];
  for (const record of records) {
    if (record.status !== 'DRAFT') continue;
    await safeSetDoc(repo.websiteFormDeliveryDoc(record.recordId), { ...record, status: 'PENDING', approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    const sent = await deliverStoredRecord(ctx, { ...record, status: 'PENDING' });
    results.push({ channel: record.channel, status: String(sent.record.status), error: sent.record.lastError });
  }
  const conversationSnap = await getDoc(repo.conversationDoc(conversationId));
  if (conversationSnap.exists()) {
    const conversation = conversationSnap.data() as Conversation;
    const websiteFormConfirmationDrafts = (conversation.websiteFormConfirmationDrafts || []).map((item: any) =>
      item.submissionId === submissionId ? { ...item, status: results.every((result) => result.status === 'SENT' || result.status === 'SKIPPED') ? 'COMPLETED' : 'APPROVED' } : item
    );
    await safeSetDoc(repo.conversationDoc(conversationId), { websiteFormConfirmationDrafts, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return { results };
}

export async function retryPendingWebsiteFormConfirmations(
  ctx: TenantContext, batchSize = 20
): Promise<{ processedCount: number; sentCount: number; failedCount: number }> {
  if (!isFirebaseConfigured) return { processedCount: 0, sentCount: 0, failedCount: 0 };
  const repo = tenantRepo(ctx);
  const snap = await getDocs(query(repo.websiteFormDeliveries(), where('status', 'in', ['PENDING', 'FAILED']), limit(Math.max(1, Math.min(100, batchSize)))));
  let processedCount = 0, sentCount = 0, failedCount = 0;
  const now = Date.now();
  for (const item of snap.docs) {
    const record: any = { ...item.data(), recordId: item.id };
    if (record.status === 'FAILED' && record.nextRetryAt && Date.parse(record.nextRetryAt) > now) continue;
    const sent = await deliverStoredRecord(ctx, record);
    processedCount++;
    if (sent.record.status === 'SENT') sentCount++;
    else failedCount++;
  }
  return { processedCount, sentCount, failedCount };
}

export async function retryPendingWebsiteFormConfirmationsForAllTenants(): Promise<{ tenants: number; processedCount: number; sentCount: number; failedCount: number }> {
  if (!isFirebaseConfigured) return { tenants: 0, processedCount: 0, sentCount: 0, failedCount: 0 };
  const { globalTenantsCol } = await import('./tenantRepo.js');
  const { getDocs } = await import('./adminFirestore.js');
  const tenants = await getDocs(globalTenantsCol());
  let processedCount = 0, sentCount = 0, failedCount = 0, tenantCount = 0;
  for (const tenant of tenants.docs) {
    if (tenant.data()?.status === 'suspended') continue;
    const ctx: TenantContext = { tenantId: tenant.id, uid: 'system-website-confirmation-cron', email: '', role: 'admin' };
    const result = await retryPendingWebsiteFormConfirmations(ctx, 20).catch(() => null);
    if (!result) continue;
    tenantCount++;
    processedCount += result.processedCount;
    sentCount += result.sentCount;
    failedCount += result.failedCount;
  }
  return { tenants: tenantCount, processedCount, sentCount, failedCount };
}
