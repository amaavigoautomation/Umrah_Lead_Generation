import crypto from 'node:crypto';
import { getDoc, getDocs, query, where, limit, setDoc, runTransaction } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { tenantRepo } from './tenantRepo.js';
import { sendLiveEmail, fetchFirestoreSmtpConfig } from './smtpService.js';
import { getTenantBrand } from './brandService.js';
import { listWhatsAppTemplates, sendWhatsAppTemplate } from './metaChannelsService.js';
import { getTenantChannelMode } from './channelModeService.js';
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
    full_name: values.fullName, fullName: values.fullName, fullname: values.fullName, name: values.fullName,
    company: values.company, company_name: values.company, companyName: values.company, companyname: values.company,
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
    'Thank you for contacting {{company}}. We have received your enquiry and our team will review the details shortly.',
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
    'Our Team',
  ].join('\n');
  const htmlBody = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"></head><body style="margin:0;background:#f3f5f9;padding:28px 12px;font-family:Arial,Helvetica,sans-serif;color:#25364a"><table role="presentation" width="100%" cellspacing="0" cellpadding="0" border="0"><tr><td align="center"><table role="presentation" width="600" style="max-width:600px;width:100%;background:#fff;border-radius:14px" cellspacing="0" cellpadding="0" border="0"><tr><td style="padding:32px"><p style="font-size:12px;font-weight:bold;letter-spacing:1px;color:#d97842;text-transform:uppercase">FORM SUBMISSION CONFIRMATION</p><h1 style="font-size:26px;color:#173b63">Thank you, {{firstName}}.</h1><p style="font-size:15px;line-height:1.7">We have received your enquiry with <strong>{{company}}</strong>. Our team will review it and get back to you shortly.</p><h2 style="font-size:17px;color:#173b63">Your submission</h2><p style="font-size:14px;line-height:1.8"><strong>Company:</strong> {{company}}<br><strong>Interest:</strong> {{product}}<br><strong>Team size:</strong> {{teamSize}}<br><strong>Location:</strong> {{city}}, {{country}}<br><strong>Message:</strong> {{message}}</p><p style="font-size:14px;line-height:1.7">We appreciate your interest and will be in touch soon.</p><p style="font-size:14px;line-height:1.7">Warm regards,<br><strong>Our Team</strong></p></td></tr></table></td></tr></table></body></html>`;
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
    await setDoc(templateRef, defaultEmailTemplate(now), { merge: false });
  } else {
    const current = templateSnap.data() as EmailTemplate;
    if (current.purpose !== 'WEBSITE_FORM_THANKYOU') {
      await setDoc(templateRef, { purpose: 'WEBSITE_FORM_THANKYOU', updatedAt: new Date().toISOString() }, { merge: true });
    }
  }
  const settingsRef = repo.settingsDoc(SETTINGS_DOC);
  const settingsSnap = await getDoc(settingsRef);
  if (!settingsSnap.exists()) {
    const migrated = { ...DEFAULT_CHANNEL_SETTINGS, updatedAt: new Date().toISOString() };
    await setDoc(settingsRef, migrated, { merge: false });
    return migrated;
  }
  const raw = settingsSnap.data() as Partial<WebsiteFormConfirmationSettings>;
  const channel = ['EMAIL', 'WHATSAPP', 'BOTH'].includes(String(raw.channel || ''))
    ? raw.channel as WebsiteConfirmationChannel : 'EMAIL';
  const emailTemplateSnap = raw.emailTemplateId
    ? await getDoc(repo.emailTemplateDoc(String(raw.emailTemplateId)))
    : null;
  const emailTemplateId = emailTemplateSnap?.exists()
    && (emailTemplateSnap.data() as EmailTemplate).purpose === 'WEBSITE_FORM_THANKYOU'
    ? String(raw.emailTemplateId)
    : DEFAULT_EMAIL_TEMPLATE_ID;
  const whatsappTemplateName = String(raw.whatsappTemplateName || '');
  const whatsappLanguage = String(raw.whatsappLanguage || '');
  const whatsappParameterMapping = Array.isArray(raw.whatsappParameterMapping)
    ? raw.whatsappParameterMapping.map((value) => String(value)).slice(0, 20) : [];
  if (raw.channel !== channel || raw.emailTemplateId !== emailTemplateId || raw.requireWhatsAppOptIn !== true) {
    await setDoc(settingsRef, { channel, emailTemplateId, whatsappTemplateName, whatsappLanguage, whatsappParameterMapping, requireWhatsAppOptIn: true, updatedAt: new Date().toISOString() }, { merge: true });
  }
  return {
    channel, emailTemplateId, whatsappTemplateName, whatsappLanguage,
    whatsappParameterMapping, requireWhatsAppOptIn: true,
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
    const selected = approved.find((template: any) => template.name === whatsappTemplateName && template.language === whatsappLanguage && String(template.category || '').toUpperCase() === 'UTILITY');
    if (!selected) throw new Error('Choose a currently approved WhatsApp Utility template. Refresh Meta templates and select a Utility template before saving.');
    if (mapping.length !== Number(selected.paramCount || 0)) {
      throw new Error(`Map all ${Number(selected.paramCount || 0)} WhatsApp template parameter(s) before saving.`);
    }
    if (mapping.some((field) => !FIELD_KEYS.includes(field as any))) throw new Error('One or more WhatsApp parameter mappings are invalid.');
  }

  const saved: WebsiteFormConfirmationSettings = {
    channel, emailTemplateId, whatsappTemplateName, whatsappLanguage,
    whatsappParameterMapping: mapping, requireWhatsAppOptIn: true, updatedAt: new Date().toISOString(),
  };
  await setDoc(repo.settingsDoc(SETTINGS_DOC), saved, { merge: true });
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
  await setDoc(tenantRepo(ctx).messageDoc(messageId), message, { merge: true });
  return message;
}

async function deliverStoredRecord(
  ctx: TenantContext,
  input: any,
  keepAsDraftOnFailure = false,
): Promise<{ record: any; message?: Message }> {
  const repo = tenantRepo(ctx);
  const recordId = String(input.recordId || '');
  if (!recordId) throw new Error('Delivery record id is required.');
  const lockKey = `${ctx.tenantId}:${recordId}`;
  if (inFlight.has(lockKey)) return { record: input };
  inFlight.add(lockKey);
  const ref = repo.websiteFormDeliveryDoc(recordId);
  let record: any = input;
  try {
    const claim = await runTransaction(async (tx: any) => {
      const snap = await tx.get(ref);
      if (!snap.exists) return { state: 'MISSING', record: null };
      const current: any = { ...snap.data(), recordId };
      if (['SENT', 'SKIPPED', 'DRAFT', 'FAILED_FINAL'].includes(String(current.status))) return { state: 'STOP', record: current };
      const leaseUntil = Date.parse(String(current.leaseExpiresAt || ''));
      if (current.status === 'SENDING' && Number.isFinite(leaseUntil) && leaseUntil > Date.now()) return { state: 'BUSY', record: current };
      if (!['PENDING', 'FAILED', 'SENDING'].includes(String(current.status))) return { state: 'STOP', record: current };
      const now = new Date();
      const next = {
        ...current, status: 'SENDING', attemptCount: Number(current.attemptCount || 0) + 1,
        lastAttemptAt: now.toISOString(), leaseExpiresAt: new Date(now.getTime() + 5 * 60 * 1000).toISOString(),
        updatedAt: now.toISOString(),
      };
      tx.set(ref, next, { merge: true });
      return { state: 'CLAIMED', record: next };
    });
    if (claim.state !== 'CLAIMED') {
      if (claim.state === 'MISSING') throw new Error('Website form delivery record was not found.');
      return { record: claim.record || input };
    }
    record = claim.record;

    let providerResult: any;
    if (record.channel === 'EMAIL') {
      await fetchFirestoreSmtpConfig();
      providerResult = await sendLiveEmail({
        tenantId: ctx.tenantId, to: String(record.recipient || ''), subject: String(record.subject || ''),
        text: String(record.text || ''), html: String(record.html || ''),
        headers: {
          'X-Website-Form-Submission': String(record.submissionId),
          'X-Conversation-Id': String(record.conversationId),
          'X-Lead-Id': String(record.leadId),
        },
      });
      if (!providerResult?.success) throw new Error(providerResult?.error || 'Email provider did not accept the confirmation.');
    } else if (record.channel === 'WHATSAPP') {
      providerResult = await sendWhatsAppTemplate(ctx, String(record.recipient || ''), {
        name: String(record.whatsappTemplateName || ''), language: String(record.whatsappLanguage || ''),
        params: Array.isArray(record.whatsappParameters) ? record.whatsappParameters : [],
      });
    } else throw new Error('Unsupported website confirmation channel.');

    const deliveredAt = new Date().toISOString();
    const updated = { ...record, status: 'SENT', sentAt: deliveredAt, updatedAt: deliveredAt,
      providerMessageId: String(providerResult?.messageId || ''), lastError: '', leaseExpiresAt: '' };
    await setDoc(ref, updated, { merge: true });
    const message = await addOutboundMessage(ctx, updated, { status: 'SENT', messageId: providerResult?.messageId, renderedText: providerResult?.renderedText }, record.values || {} as WebsiteFormLeadValues);
    return { record: updated, message };
  } catch (error: any) {
    const now = new Date();
    const attempts = Math.max(1, Number(record.attemptCount || input.attemptCount || 0));
    const final = attempts >= 6;
    const errorText = String(error?.message || error || 'Delivery failed').slice(0, 500);
    const updated = {
      ...record, status: keepAsDraftOnFailure ? 'DRAFT' : final ? 'FAILED_FINAL' : 'FAILED',
      attemptCount: attempts, lastError: errorText,
      nextRetryAt: keepAsDraftOnFailure || final ? '' : new Date(now.getTime() + Math.min(60 * 60 * 1000, 60 * 1000 * Math.pow(2, attempts - 1))).toISOString(),
      leaseExpiresAt: '', updatedAt: now.toISOString(),
    };
    await setDoc(ref, updated, { merge: true }).catch((writeError: any) => console.error('[Website Confirmation] Could not persist delivery failure:', writeError?.message || writeError));
    const message = await addOutboundMessage(ctx, updated, { status: 'FAILED', error: errorText }, record.values || input.values || {} as WebsiteFormLeadValues).catch(() => undefined);
    return { record: updated, message };
  } finally { inFlight.delete(lockKey); }
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
  if (!isFirebaseConfigured) return { submissionId, messages: [], drafts: [], sentChannels: [], statuses: [] };
  const config = await getWebsiteFormConfirmationSettings(ctx);
  const selectedChannels: Array<'EMAIL' | 'WHATSAPP'> = config.channel === 'BOTH' ? ['EMAIL', 'WHATSAPP'] : [config.channel];
  const messages: Message[] = [];
  const drafts: any[] = [];
  const statuses: Array<{ channel: string; status: string; error?: string }> = [];
  const repo = tenantRepo(ctx);
  const brand = await getTenantBrand(ctx.tenantId);

  for (const channel of selectedChannels) {
    const recordId = `wf-${submissionId}-${channel.toLowerCase()}`;
    const existing = await getDoc(repo.websiteFormDeliveryDoc(recordId));
    if (existing.exists()) {
      const current = existing.data() as any;
      if (['SENT', 'SKIPPED', 'DRAFT', 'FAILED_FINAL', 'PENDING', 'FAILED', 'SENDING'].includes(String(current.status))) {
        statuses.push({ channel, status: String(current.status), error: current.lastError || current.skipReason });
        continue;
      }
    }

    if (mode === 'OFF') {
      const skipped = { recordId, submissionId, tenantId: ctx.tenantId, conversationId: conversation.conversationId, leadId: lead.leadId, contactId: contact.contactId, channel, status: 'SKIPPED', skipReason: 'Website channel mode is OFF.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await setDoc(repo.websiteFormDeliveryDoc(recordId), skipped, { merge: true });
      statuses.push({ channel, status: 'SKIPPED', error: skipped.skipReason });
      continue;
    }

    if (channel === 'WHATSAPP' && !whatsappOptIn) {
      const skipped = { recordId, submissionId, tenantId: ctx.tenantId, conversationId: conversation.conversationId, leadId: lead.leadId, contactId: contact.contactId, channel, status: 'SKIPPED', whatsappOptIn: false, skipReason: 'Customer did not opt in to WhatsApp messages.', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
      await setDoc(repo.websiteFormDeliveryDoc(recordId), skipped, { merge: true });
      statuses.push({ channel, status: 'SKIPPED', error: skipped.skipReason });
      continue;
    }

    let record: any = {
      recordId, submissionId, tenantId: ctx.tenantId, conversationId: conversation.conversationId,
      leadId: lead.leadId, contactId: contact.contactId, channel,
      status: mode === 'REVIEW' ? 'DRAFT' : 'PENDING', values,
      recipient: channel === 'EMAIL' ? values.email : values.phone,
      createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), attemptCount: 0,
      ...(channel === 'WHATSAPP' ? { whatsappOptIn: true, whatsappConsentRecordedAt: new Date().toISOString() } : {}),
    };
    try {
      if (channel === 'EMAIL') {
        const templateSnap = await getDoc(repo.emailTemplateDoc(config.emailTemplateId));
        if (!templateSnap.exists()) throw new Error('The selected Website Form Thank-you email template no longer exists.');
        const template = templateSnap.data() as EmailTemplate;
        if (template.purpose !== 'WEBSITE_FORM_THANKYOU') throw new Error('The selected email template is not marked for Website Form Thank-you.');
        record = {
          ...record, templateId: template.templateId,
          subject: replaceLeadTokens(template.subject || 'Thank you for your enquiry, {{firstName}}', values),
          text: replaceLeadTokens(template.body || 'Thank you for your enquiry.', values),
          html: template.isHtml || template.format === 'html' ? replaceLeadTokens(template.htmlBody || '', values, true) : '',
          from: brand.salesEmail || '',
        };
        if (!record.recipient || !String(record.recipient).includes('@')) {
          record.status = 'SKIPPED'; record.skipReason = 'The form did not include a valid email address.';
        }
      } else {
        // The approved-template status is verified again by sendWhatsAppTemplate at dispatch time.
        // Settings saving already verified the chosen template and exact parameter count.
        const params = config.whatsappParameterMapping.map((field) => valuesForField(values, field));
        record = {
          ...record, whatsappTemplateName: config.whatsappTemplateName, whatsappLanguage: config.whatsappLanguage,
          whatsappParameters: params, text: `WhatsApp confirmation template: ${config.whatsappTemplateName}`,
        };
        if (!record.recipient || !String(record.recipient).replace(/\\D/g, '')) {
          record.status = 'SKIPPED'; record.skipReason = 'The form did not include a phone number.';
        }
      }

      await setDoc(repo.websiteFormDeliveryDoc(recordId), record, { merge: true });
      if (record.status === 'SKIPPED') { statuses.push({ channel, status: 'SKIPPED', error: record.skipReason }); continue; }
      if (mode === 'REVIEW') {
        const message: Message = {
          messageId: `msg-wf-${recordId}`, conversationId: conversation.conversationId, channel,
          direction: 'OUTBOUND', senderType: 'AI', senderName: 'Website Confirmation',
          ...(channel === 'EMAIL' ? { recipientEmail: record.recipient, emailMeta: { subject: record.subject, to: record.recipient } } : {}),
          text: String(record.text || ''), timestamp: new Date().toISOString(), createdAt: new Date().toISOString(),
          isDraft: true, draftStatus: 'PENDING', deliveryStatus: 'PENDING',
          websiteFormSubmissionId: submissionId, isWebsiteFormConfirmation: true,
        };
        await setDoc(repo.messageDoc(message.messageId), message, { merge: true });
        messages.push(message);
        drafts.push({ channel, recordId, messageId: message.messageId, subject: record.subject, text: message.text, status: 'DRAFT' });
        statuses.push({ channel, status: 'DRAFT' });
        continue;
      }
      const delivered = await deliverStoredRecord(ctx, record);
      if (delivered.message) messages.push(delivered.message);
      statuses.push({ channel, status: String(delivered.record.status), error: delivered.record.lastError || undefined });
    } catch (error: any) {
      const errorText = String(error?.message || error || 'Confirmation could not be prepared').slice(0, 500);
      const failed = { ...record, status: mode === 'REVIEW' ? 'DRAFT' : 'FAILED', lastError: errorText, attemptCount: Number(record.attemptCount || 0),
        nextRetryAt: mode === 'REVIEW' ? '' : new Date(Date.now() + 60 * 1000).toISOString(), updatedAt: new Date().toISOString() };
      await setDoc(repo.websiteFormDeliveryDoc(recordId), failed, { merge: true });
      statuses.push({ channel, status: String(failed.status), error: errorText });
      if (mode === 'REVIEW') {
        const message: Message = { messageId: `msg-wf-${recordId}`, conversationId: conversation.conversationId, channel,
          direction: 'OUTBOUND', senderType: 'AI', senderName: 'Website Confirmation',
          ...(channel === 'EMAIL' ? { recipientEmail: record.recipient, emailMeta: { subject: record.subject, to: record.recipient } } : {}),
          text: String(record.text || 'Website confirmation is waiting for review.'), timestamp: new Date().toISOString(),
          createdAt: new Date().toISOString(), isDraft: true, draftStatus: 'PENDING', deliveryStatus: 'PENDING',
          websiteFormSubmissionId: submissionId, isWebsiteFormConfirmation: true };
        await setDoc(repo.messageDoc(message.messageId), message, { merge: true });
        messages.push(message);
        drafts.push({ channel, recordId, messageId: message.messageId, subject: record.subject, text: message.text, status: 'DRAFT', error: errorText });
      }
    }
  }

  if (mode === 'REVIEW' && drafts.length) {
    const currentDrafts = Array.isArray(conversation.websiteFormConfirmationDrafts) ? conversation.websiteFormConfirmationDrafts : [];
    conversation.websiteFormConfirmationDrafts = [...currentDrafts.filter((item: any) => item.submissionId !== submissionId), { submissionId, status: 'PENDING', channels: drafts }].slice(-20);
    conversation.status = 'REVIEW';
  }
  const latestMessage = messages[messages.length - 1];
  const now = new Date().toISOString();
  const emailSent = statuses.some((item) => item.channel === 'EMAIL' && item.status === 'SENT');
  const emailMessage = messages.find((item) => item.channel === 'EMAIL' && item.deliveryStatus === 'SENT');
  const patch: Partial<Conversation> = {
    ...(conversation.websiteFormConfirmationDrafts ? { websiteFormConfirmationDrafts: conversation.websiteFormConfirmationDrafts } : {}),
    ...(mode === 'REVIEW' && drafts.length ? { status: 'REVIEW' } : {}),
    ...(emailSent ? { thankYouEmailSent: true, thankYouEmailSuppressed: true, thankYouEmailDeliveredAt: emailMessage?.emailDeliveredAt || now, thankYouSmtpMessageId: emailMessage?.smtpMessageId || '' } : {}),
    ...(latestMessage ? { lastMessageAt: latestMessage.timestamp, lastMessageText: latestMessage.text.slice(0, 300), updatedAt: now } : {}),
  };
  if (Object.keys(patch).length) await setDoc(repo.conversationDoc(conversation.conversationId), patch, { merge: true });
  return { submissionId, messages, drafts, sentChannels: statuses.filter((item) => item.status === 'SENT').map((item) => item.channel), statuses };
}

export async function approveWebsiteFormConfirmation(
  ctx: TenantContext, conversationId: string, submissionId: string
): Promise<{ results: Array<{ channel: string; status: string; error?: string }> }> {
  if (await getTenantChannelMode(ctx, 'WEBSITE', 'AUTO') === 'OFF') throw new Error('The Website channel is OFF. Enable it before approving a saved confirmation.');
  const repo = tenantRepo(ctx);
  const snap = await getDoc(repo.conversationDoc(conversationId));
  if (!snap.exists()) throw new Error('Website conversation was not found.');
  const conversation = snap.data() as Conversation;
  const group = (conversation.websiteFormConfirmationDrafts || []).find((item: any) => item.submissionId === submissionId);
  if (!group || !Array.isArray(group.channels) || !group.channels.length) throw new Error('This website form confirmation is no longer awaiting review.');
  const results: Array<{ channel: string; status: string; error?: string }> = [];
  const nextChannels: any[] = [];
  for (const item of group.channels as any[]) {
    const recordId = String(item.recordId || '');
    if (!recordId) { results.push({ channel: item.channel, status: 'DRAFT', error: 'Delivery record reference is missing.' }); nextChannels.push({ ...item, status: 'DRAFT' }); continue; }
    const recordSnap = await getDoc(repo.websiteFormDeliveryDoc(recordId));
    if (!recordSnap.exists()) { results.push({ channel: item.channel, status: 'DRAFT', error: 'Delivery record was not found.' }); nextChannels.push({ ...item, status: 'DRAFT' }); continue; }
    const current: any = { ...recordSnap.data(), recordId };
    if (current.status === 'SENT' || current.status === 'SKIPPED') { results.push({ channel: current.channel, status: current.status }); nextChannels.push({ ...item, status: current.status }); continue; }
    if (!['DRAFT', 'FAILED', 'PENDING'].includes(String(current.status))) {
      results.push({ channel: current.channel, status: String(current.status), error: current.lastError || 'This delivery is already processing.' });
      nextChannels.push({ ...item, status: String(current.status) }); continue;
    }
    await setDoc(repo.websiteFormDeliveryDoc(recordId), { status: 'PENDING', approvedAt: new Date().toISOString(), updatedAt: new Date().toISOString() }, { merge: true });
    const sent = await deliverStoredRecord(ctx, { ...current, status: 'PENDING' }, true);
    const status = String(sent.record.status);
    results.push({ channel: current.channel, status, error: sent.record.lastError || undefined });
    nextChannels.push({ ...item, status: status === 'FAILED' || status === 'FAILED_FINAL' ? 'DRAFT' : status });
  }
  const completed = results.every((item) => item.status === 'SENT' || item.status === 'SKIPPED');
  const drafts = (conversation.websiteFormConfirmationDrafts || []).map((item: any) => item.submissionId === submissionId
    ? { ...item, status: completed ? 'COMPLETED' : 'APPROVED', channels: nextChannels } : item);
  const emailSent = results.some((item) => item.channel === 'EMAIL' && item.status === 'SENT');
  await setDoc(repo.conversationDoc(conversationId), { websiteFormConfirmationDrafts: drafts, ...(emailSent ? { thankYouEmailSent: true, thankYouEmailSuppressed: true } : {}), updatedAt: new Date().toISOString() }, { merge: true });
  return { results };
}
export async function retryPendingWebsiteFormConfirmations(
  ctx: TenantContext, batchSize = 20
): Promise<{ processedCount: number; sentCount: number; failedCount: number }> {
  if (!isFirebaseConfigured || await getTenantChannelMode(ctx, 'WEBSITE', 'AUTO') !== 'AUTO') return { processedCount: 0, sentCount: 0, failedCount: 0 };
  const repo = tenantRepo(ctx);
  const snap = await getDocs(query(repo.websiteFormDeliveries(), where('status', 'in', ['PENDING', 'FAILED', 'SENDING']), limit(Math.max(1, Math.min(100, batchSize)))));
  let processedCount = 0, sentCount = 0, failedCount = 0;
  const now = Date.now();
  for (const item of snap.docs) {
    const record: any = { ...item.data(), recordId: item.id };
    if (record.status === 'FAILED' && record.nextRetryAt && Date.parse(record.nextRetryAt) > now) continue;
    if (record.status === 'SENDING' && Date.parse(String(record.leaseExpiresAt || '')) > now) continue;
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
