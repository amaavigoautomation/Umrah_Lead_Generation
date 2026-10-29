import crypto from 'crypto';
import OpenAI from 'openai';
import { doc, getDoc, setDoc, deleteDoc, createDoc, updateDoc, getDocs, query, where, db } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { encryptSecret, decryptSecret } from './cryptoUtils.js';
import type { TenantContext } from '../types/tenant.js';
import { evaluateHumanHandoff, persistHumanHandoff, describeHandoff } from './humanHandoffService.js';

/**
 * Per-workspace WhatsApp (Cloud API via Embedded Signup) and Facebook Messenger (Page login),
 * both run by ONE Meta app owned by the platform. Each client connects its own number / Page.
 *
 *   Credentials : tenants/{id}/secrets/whatsapp_access_token | messenger_page_token  (encrypted)
 *   Metadata    : tenants/{id}/integrations/whatsapp | messenger
 *   Routing     : channel_routes/{phoneNumberId}  (WhatsApp)  and  meta_page_routes/{pageId} (Messenger)
 *   Webhook     : /api/webhooks/meta  (signature checked with META_APP_SECRET)
 */

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`;

export type MetaChannel = 'whatsapp' | 'messenger';

type WhatsAppConnection = {
  phoneNumberId: string;
  wabaId: string;
  displayPhoneNumber: string;
  verifiedName: string;
  qualityRating?: string;
  isOnBusinessApp?: true;
  platformType?: 'CLOUD_API';
  coexistenceSync?: {
    contacts: { status: 'requested' | 'failed'; requestId?: string };
    history: { status: 'requested' | 'failed'; requestId?: string };
  };
  status: 'connected' | 'disconnected';
  connectedAt: string;
  updatedAt: string;
};

type MessengerConnection = {
  pageId: string;
  pageName: string;
  status: 'connected' | 'disconnected';
  connectedAt: string;
  updatedAt: string;
  webhookSubscriptionStatus?: 'subscribed' | 'needs_setup';
};

class MetaChannelError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

function env(name: string): string {
  return (process.env[name] || '').trim();
}

/** Which server settings are still missing for a channel. Used by the UI to explain "Setup pending". */
export function missingMetaSettings(channel: MetaChannel): string[] {
  const missing: string[] = [];
  if (!env('META_APP_ID')) missing.push('META_APP_ID');
  if (!env('META_APP_SECRET')) missing.push('META_APP_SECRET');
  if (!env('META_WEBHOOK_VERIFY_TOKEN')) missing.push('META_WEBHOOK_VERIFY_TOKEN');
  if (!env('SECRETS_MASTER_KEY') && !env('TENANT_MASTER_KEY')) missing.push('SECRETS_MASTER_KEY');
  if (channel === 'whatsapp' && !env('META_WA_EMBEDDED_SIGNUP_CONFIG_ID')) missing.push('META_WA_EMBEDDED_SIGNUP_CONFIG_ID');
  return missing;
}

/** Public (non-secret) values the browser needs to open Meta's pop-ups. */
export function getMetaClientConfig() {
  return {
    appId: env('META_APP_ID'),
    whatsappConfigId: env('META_WA_EMBEDDED_SIGNUP_CONFIG_ID'),
    graphVersion: GRAPH_VERSION,
  };
}

function requireConfigured(channel: MetaChannel) {
  const missing = missingMetaSettings(channel);
  if (missing.length) {
    throw new MetaChannelError(503, `This server is not set up for ${channel === 'whatsapp' ? 'WhatsApp' : 'Messenger'} yet. Missing: ${missing.join(', ')}.`);
  }
}

async function graphJson(url: string, init?: RequestInit): Promise<any> {
  const response = await fetch(url, init);
  const body: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    const code = body?.error?.code;
    const err = new MetaChannelError(response.status >= 500 ? 502 : 400, body?.error?.message || `Meta request failed (HTTP ${response.status}).`);
    (err as any).metaCode = code;
    (err as any).metaSubcode = body?.error?.error_subcode;
    throw err;
  }
  return body;
}

// ---------------------------------------------------------------------------
// WhatsApp
// ---------------------------------------------------------------------------

async function getWhatsAppConnection(ctx: TenantContext): Promise<WhatsAppConnection | null> {
  const snap = await getDoc(tenantRepo(ctx).integrationDoc('whatsapp'));
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return data?.channel === 'whatsapp' ? (data.connection as WhatsAppConnection) || null : null;
}

async function getSecret(ctx: TenantContext, name: string): Promise<string> {
  const snap = await getDoc(tenantRepo(ctx).secretDoc(name));
  if (!snap.exists()) throw new MetaChannelError(409, 'This channel is not connected. Reconnect the account.');
  return decryptSecret(snap.data() as any);
}

async function putSecret(ctx: TenantContext, name: string, value: string) {
  const now = new Date().toISOString();
  await setDoc(tenantRepo(ctx).secretDoc(name), { ...encryptSecret(value), name, createdAt: now, updatedAt: now });
}

export async function getWhatsAppStatus(ctx: TenantContext) {
  const connection = await getWhatsAppConnection(ctx);
  return { connected: connection?.status === 'connected', connection };
}

export async function connectWhatsApp(
  ctx: TenantContext,
  input: { code?: string; wabaId?: string; phoneNumberId?: string; event?: string }
): Promise<WhatsAppConnection> {
  requireConfigured('whatsapp');
  const code = String(input.code || '').trim();
  const wabaId = String(input.wabaId || '').trim();
  const requestedPhoneNumberId = String(input.phoneNumberId || '').trim();
  const completionEvent = String(input.event || '').trim();

  // Fail closed: only the specific WhatsApp Business App onboarding event may connect a number.
  if (!code || !wabaId || completionEvent !== 'FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING') {
    throw new MetaChannelError(
      400,
      'WhatsApp Coexistence was not completed. Amaavigo only connects existing WhatsApp Business App numbers; API-only onboarding is disabled.'
    );
  }

  // Exchange the Embedded Signup code server-side. Never expose the Meta token to the browser.
  const tokenUrl = new URL(`${GRAPH}/oauth/access_token`);
  tokenUrl.searchParams.set('client_id', env('META_APP_ID'));
  tokenUrl.searchParams.set('client_secret', env('META_APP_SECRET'));
  tokenUrl.searchParams.set('code', code);
  const tokenBody = await graphJson(tokenUrl.toString());
  const accessToken = String(tokenBody.access_token || '');
  if (!accessToken) throw new MetaChannelError(400, 'Meta did not return an access token for this WhatsApp account.');

  // Coexistence session info can contain only the WABA ID. Discover number IDs from that WABA.
  let phoneNumbers: any[] = [];
  try {
    const phoneNumbersUrl = new URL(`${GRAPH}/${encodeURIComponent(wabaId)}/phone_numbers`);
    phoneNumbersUrl.searchParams.set('fields', 'id,display_phone_number,verified_name,quality_rating');
    phoneNumbersUrl.searchParams.set('access_token', accessToken);
    const list = await graphJson(phoneNumbersUrl.toString());
    phoneNumbers = Array.isArray(list?.data) ? list.data : [];
  } catch {
    throw new MetaChannelError(
      422,
      'Meta could not confirm this number for WhatsApp Coexistence. Check that the current Embedded Signup v4 configuration has the required WhatsApp permissions, then retry. API-only setup is disabled.'
    );
  }

  if (requestedPhoneNumberId) {
    phoneNumbers = phoneNumbers.filter((item) => String(item?.id || '') === requestedPhoneNumberId);
  }
  if (!phoneNumbers.length) {
    throw new MetaChannelError(422, 'Meta did not return a phone number for this Coexistence session. No connection was saved; please try again.');
  }

  // Do not call /register. A true Coexistence number must be active on both the Business App and Cloud API.
  const checkedNumbers = await Promise.all(phoneNumbers.slice(0, 50).map(async (item) => {
    const id = String(item?.id || '').trim();
    if (!id) return null;
    try {
      const infoUrl = new URL(`${GRAPH}/${encodeURIComponent(id)}`);
      infoUrl.searchParams.set('fields', 'display_phone_number,verified_name,quality_rating,is_on_biz_app,platform_type');
      infoUrl.searchParams.set('access_token', accessToken);
      const info = await graphJson(infoUrl.toString());
      if (info?.is_on_biz_app !== true || String(info?.platform_type || '').toUpperCase() !== 'CLOUD_API') return null;
      return { ...item, ...info, id };
    } catch {
      return null;
    }
  }));
  const eligibleNumbers = checkedNumbers.filter((item): item is NonNullable<typeof item> => Boolean(item));
  if (eligibleNumbers.length === 0) {
    throw new MetaChannelError(
      422,
      'This number is not confirmed as eligible for WhatsApp Business App Coexistence. Amaavigo has not connected it or registered it for API-only use. Make sure the client enters the existing WhatsApp Business App number and cancels if Meta requests migration or marks it ineligible.'
    );
  }
  if (!requestedPhoneNumberId && eligibleNumbers.length > 1) {
    throw new MetaChannelError(
      422,
      'Meta returned multiple eligible WhatsApp Business App numbers for this business account, so Amaavigo stopped to avoid connecting the wrong number. Ask the platform administrator to resolve the account setup before retrying.'
    );
  }

  const selected = eligibleNumbers[0];
  const phoneNumberId = String(selected.id);
  const routeRef = doc(db, 'channel_routes', phoneNumberId);
  const routeSnap = await getDoc(routeRef);
  if (routeSnap.exists() && (routeSnap.data() as any).tenantId !== ctx.tenantId) {
    throw new MetaChannelError(409, 'This WhatsApp number is already connected to another workspace.');
  }

  // Subscribe the Meta app to the client's WABA events. Meta dashboard webhook fields must also be enabled.
  await graphJson(`${GRAPH}/${encodeURIComponent(wabaId)}/subscribed_apps`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  const existing = await getWhatsAppConnection(ctx);
  if (existing?.phoneNumberId && existing.phoneNumberId !== phoneNumberId) {
    await deleteDoc(doc(db, 'channel_routes', existing.phoneNumberId)).catch(() => {});
  }

  const now = new Date().toISOString();
  const connection: WhatsAppConnection = {
    phoneNumberId,
    wabaId,
    displayPhoneNumber: String(selected.display_phone_number || ''),
    verifiedName: String(selected.verified_name || ''),
    qualityRating: selected.quality_rating ? String(selected.quality_rating) : undefined,
    isOnBusinessApp: true,
    platformType: 'CLOUD_API',
    status: 'connected',
    connectedAt: existing?.connectedAt || now,
    updatedAt: now,
  };

  await putSecret(ctx, 'whatsapp_access_token', accessToken);
  await setDoc(tenantRepo(ctx).integrationDoc('whatsapp'), { channel: 'whatsapp', connection }, { merge: true });
  await setDoc(routeRef, { phoneNumberId, tenantId: ctx.tenantId, businessAccountId: wabaId, channel: 'whatsapp', coexistence: true, createdAt: now });

  // Request the two one-time Coexistence syncs shortly after connecting, inside Meta's onboarding window.
  // Sync failures do not roll back the connection (for example, the customer may decline history sharing).
  const requestSync = async (syncType: 'smb_app_state_sync' | 'history') => {
    try {
      const result = await graphJson(`${GRAPH}/${encodeURIComponent(phoneNumberId)}/smb_app_data`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', sync_type: syncType }),
      });
      return { status: 'requested' as const, requestId: String(result?.request_id || result?.data?.request_id || '') || undefined };
    } catch (error: any) {
      console.warn(`[WhatsApp Coexistence] ${syncType} sync could not be requested:`, error?.message || 'Meta request failed');
      return { status: 'failed' as const };
    }
  };
  const [contacts, history] = await Promise.all([
    requestSync('smb_app_state_sync'),
    requestSync('history'),
  ]);
  const coexistenceSync = { contacts, history };
  const connected: WhatsAppConnection = { ...connection, coexistenceSync };
  await setDoc(tenantRepo(ctx).integrationDoc('whatsapp'), {
    channel: 'whatsapp',
    connection: JSON.parse(JSON.stringify(connected)),
  }, { merge: true });
  return connected;
}

export async function disconnectWhatsApp(ctx: TenantContext): Promise<void> {
  const existing = await getWhatsAppConnection(ctx);
  if (!existing) return;
  try {
    const token = await getSecret(ctx, 'whatsapp_access_token');
    await fetch(`${GRAPH}/${encodeURIComponent(existing.wabaId)}/subscribed_apps`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${token}` },
    });
  } catch {
    // Token may already be revoked.
  }
  await setDoc(tenantRepo(ctx).integrationDoc('whatsapp'), {
    channel: 'whatsapp',
    connection: { ...existing, status: 'disconnected', updatedAt: new Date().toISOString() },
  }, { merge: true });
  await deleteDoc(tenantRepo(ctx).secretDoc('whatsapp_access_token')).catch(() => {});
  await deleteDoc(tenantRepo(ctx).secretDoc('whatsapp_pin')).catch(() => {});
  await deleteDoc(doc(db, 'channel_routes', existing.phoneNumberId)).catch(() => {});
}

export type WhatsAppTemplate = {
  name: string;
  language: string;
  category?: string;
  body: string;
  paramCount: number;
};

export async function listWhatsAppTemplates(ctx: TenantContext): Promise<WhatsAppTemplate[]> {
  const connection = await getWhatsAppConnection(ctx);
  if (!connection || connection.status !== 'connected') throw new MetaChannelError(409, 'WhatsApp is not connected.');
  const token = await getSecret(ctx, 'whatsapp_access_token');
  const url = new URL(`${GRAPH}/${encodeURIComponent(connection.wabaId)}/message_templates`);
  url.searchParams.set('fields', 'name,language,status,category,components');
  url.searchParams.set('limit', '100');
  const body = await graphJson(url.toString(), { headers: { Authorization: `Bearer ${token}` } });
  return (Array.isArray(body.data) ? body.data : [])
    .filter((t: any) => t.status === 'APPROVED')
    .map((t: any) => {
      const bodyComp = (t.components || []).find((c: any) => c.type === 'BODY');
      const text = String(bodyComp?.text || '');
      const params = text.match(/\{\{\d+\}\}/g) || [];
      return {
        name: String(t.name),
        language: String(t.language),
        category: t.category ? String(t.category) : undefined,
        body: text,
        paramCount: new Set(params).size,
      };
    });
}

function friendlyWhatsAppError(err: any): MetaChannelError {
  const code = Number(err?.metaCode);
  if (code === 131047 || code === 131026 || /re-engagement|24 hour/i.test(String(err?.message))) {
    return new MetaChannelError(422, 'The 24-hour reply window has closed. Send an approved template instead.');
  }
  return err instanceof MetaChannelError ? err : new MetaChannelError(500, err?.message || 'WhatsApp message could not be sent.');
}

export async function sendWhatsAppTemplate(
  ctx: TenantContext,
  to: string,
  template: { name: string; language: string; params?: string[] }
): Promise<{ messageId: string; renderedText: string }> {
  const connection = await getWhatsAppConnection(ctx);
  if (!connection || connection.status !== 'connected') throw new MetaChannelError(409, 'WhatsApp is not connected.');
  const recipient = String(to || '').replace(/[^\d]/g, '');
  if (!recipient || !template?.name || !template?.language) throw new MetaChannelError(400, 'Recipient and template are required.');
  const token = await getSecret(ctx, 'whatsapp_access_token');
  const params = (template.params || []).map((p) => String(p));
  const components = params.length
    ? [{ type: 'body', parameters: params.map((text) => ({ type: 'text', text })) }]
    : undefined;
  try {
    const result = await graphJson(`${GRAPH}/${encodeURIComponent(connection.phoneNumberId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'template',
        template: { name: template.name, language: { code: template.language }, ...(components ? { components } : {}) },
      }),
    });
    // Rebuild readable text for the inbox from the template body.
    let renderedText = `[Template: ${template.name}]`;
    try {
      const all = await listWhatsAppTemplates(ctx);
      const match = all.find((t) => t.name === template.name && t.language === template.language);
      if (match) renderedText = match.body.replace(/\{\{(\d+)\}\}/g, (_m, n) => params[Number(n) - 1] ?? '');
    } catch {
      // Keep the placeholder text.
    }
    return { messageId: String(result?.messages?.[0]?.id || ''), renderedText };
  } catch (err) {
    throw friendlyWhatsAppError(err);
  }
}

// ---------------------------------------------------------------------------
// Messenger
// ---------------------------------------------------------------------------

async function getMessengerConnection(ctx: TenantContext): Promise<MessengerConnection | null> {
  const snap = await getDoc(tenantRepo(ctx).integrationDoc('messenger'));
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return data?.channel === 'messenger' ? (data.connection as MessengerConnection) || null : null;
}

export async function getMessengerStatus(ctx: TenantContext) {
  const connection = await getMessengerConnection(ctx);
  return { connected: connection?.status === 'connected', connection };
}

async function longLivedUserToken(userToken: string): Promise<string> {
  const url = new URL(`${GRAPH}/oauth/access_token`);
  url.searchParams.set('grant_type', 'fb_exchange_token');
  url.searchParams.set('client_id', env('META_APP_ID'));
  url.searchParams.set('client_secret', env('META_APP_SECRET'));
  url.searchParams.set('fb_exchange_token', userToken);
  const body = await graphJson(url.toString());
  return String(body.access_token || userToken);
}

async function fetchManagedPages(userToken: string): Promise<{ id: string; name: string; access_token: string }[]> {
  const url = new URL(`${GRAPH}/me/accounts`);
  url.searchParams.set('fields', 'id,name,access_token');
  url.searchParams.set('limit', '100');
  url.searchParams.set('access_token', userToken);
  const body = await graphJson(url.toString());
  return Array.isArray(body.data) ? body.data : [];
}

/** After the Facebook login pop-up: list the Pages this person manages so they can pick one. */
export async function listMessengerPages(userToken: string): Promise<{ id: string; name: string }[]> {
  requireConfigured('messenger');
  if (!userToken) throw new MetaChannelError(400, 'Facebook login did not return an access token.');
  const longToken = await longLivedUserToken(userToken);
  return (await fetchManagedPages(longToken)).map((p) => ({ id: String(p.id), name: String(p.name) }));
}

export async function connectMessenger(ctx: TenantContext, input: { userToken?: string; pageId?: string }): Promise<MessengerConnection> {
  requireConfigured('messenger');
  const userToken = String(input.userToken || '').trim();
  const pageId = String(input.pageId || '').trim();
  if (!userToken || !pageId) throw new MetaChannelError(400, 'A Facebook login and a Page are required.');
  const longToken = await longLivedUserToken(userToken);
  const page = (await fetchManagedPages(longToken)).find((p) => String(p.id) === pageId);
  if (!page?.access_token) throw new MetaChannelError(403, 'You do not manage that Facebook Page, or messaging permission was not granted.');

  const routeRef = doc(db, 'meta_page_routes', pageId);
  const routeSnap = await getDoc(routeRef);
  if (routeSnap.exists() && (routeSnap.data() as any).tenantId !== ctx.tenantId) {
    throw new MetaChannelError(409, 'This Facebook Page is already connected to another workspace.');
  }

  let subscribed = false;
  try {
    const subUrl = new URL(`${GRAPH}/${encodeURIComponent(pageId)}/subscribed_apps`);
    subUrl.searchParams.set('subscribed_fields', 'messages,messaging_postbacks');
    subUrl.searchParams.set('access_token', page.access_token);
    await graphJson(subUrl.toString(), { method: 'POST' });
    subscribed = true;
  } catch {
    subscribed = false;
  }

  const existing = await getMessengerConnection(ctx);
  if (existing?.pageId && existing.pageId !== pageId) {
    await deleteDoc(doc(db, 'meta_page_routes', existing.pageId)).catch(() => {});
  }
  const now = new Date().toISOString();
  const connection: MessengerConnection = {
    pageId,
    pageName: String(page.name),
    status: 'connected',
    connectedAt: existing?.connectedAt || now,
    updatedAt: now,
    webhookSubscriptionStatus: subscribed ? 'subscribed' : 'needs_setup',
  };
  await putSecret(ctx, 'messenger_page_token', page.access_token);
  await setDoc(tenantRepo(ctx).integrationDoc('messenger'), { channel: 'messenger', connection }, { merge: true });
  await setDoc(routeRef, { pageId, tenantId: ctx.tenantId, updatedAt: now });
  return connection;
}

export async function disconnectMessenger(ctx: TenantContext): Promise<void> {
  const existing = await getMessengerConnection(ctx);
  if (!existing) return;
  try {
    const token = await getSecret(ctx, 'messenger_page_token');
    const url = new URL(`${GRAPH}/${encodeURIComponent(existing.pageId)}/subscribed_apps`);
    url.searchParams.set('access_token', token);
    await fetch(url, { method: 'DELETE' });
  } catch {
    // Token may already be revoked.
  }
  await setDoc(tenantRepo(ctx).integrationDoc('messenger'), {
    channel: 'messenger',
    connection: { ...existing, status: 'disconnected', updatedAt: new Date().toISOString() },
  }, { merge: true });
  await deleteDoc(tenantRepo(ctx).secretDoc('messenger_page_token')).catch(() => {});
  await deleteDoc(doc(db, 'meta_page_routes', existing.pageId)).catch(() => {});
}

// ---------------------------------------------------------------------------
// Outbound text (WhatsApp + Messenger)
// ---------------------------------------------------------------------------

export async function sendMetaText(
  ctx: TenantContext,
  channel: MetaChannel,
  recipientId: string,
  text: string
): Promise<{ messageId: string }> {
  const body = String(text || '').trim();
  const to = String(recipientId || '').trim();
  if (!to || !body) throw new MetaChannelError(400, 'Recipient and message text are required.');

  if (channel === 'whatsapp') {
    const connection = await getWhatsAppConnection(ctx);
    if (!connection || connection.status !== 'connected') throw new MetaChannelError(409, 'WhatsApp is not connected.');
    const token = await getSecret(ctx, 'whatsapp_access_token');
    try {
      const result = await graphJson(`${GRAPH}/${encodeURIComponent(connection.phoneNumberId)}/messages`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ messaging_product: 'whatsapp', to: to.replace(/[^\d]/g, ''), type: 'text', text: { body, preview_url: false } }),
      });
      return { messageId: String(result?.messages?.[0]?.id || '') };
    } catch (err) {
      throw friendlyWhatsAppError(err);
    }
  }

  const connection = await getMessengerConnection(ctx);
  if (!connection || connection.status !== 'connected') throw new MetaChannelError(409, 'Messenger is not connected.');
  const token = await getSecret(ctx, 'messenger_page_token');
  try {
    const result = await graphJson(`${GRAPH}/${encodeURIComponent(connection.pageId)}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ recipient: { id: to }, messaging_type: 'RESPONSE', message: { text: body } }),
    });
    return { messageId: String(result?.message_id || '') };
  } catch (err: any) {
    if (Number(err?.metaCode) === 10 || /outside of allowed window/i.test(String(err?.message))) {
      throw new MetaChannelError(422, 'The 24-hour reply window has closed for this Messenger conversation.');
    }
    throw err;
  }
}

// ---------------------------------------------------------------------------
// Webhook (WhatsApp + Messenger)
// ---------------------------------------------------------------------------

function json(res: any, status: number, payload: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function isValidMetaSignature(req: any): boolean {
  const secret = env('META_APP_SECRET');
  const signature = req.headers?.['x-hub-signature-256'];
  const rawBody = req.rawBody;
  if (!secret || !signature || !rawBody) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

const hash24 = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);

type InboundEvent = {
  channel: 'WHATSAPP' | 'FACEBOOK';
  accountId: string; // phone_number_id or page id
  senderId: string; // customer wa_id or PSID
  senderName?: string;
  externalMessageId: string;
  text: string;
  hasText: boolean;
  timestamp: string;
};

async function processInbound(tenantId: string, event: InboundEvent, eventId: string): Promise<void> {
  const eventRef = doc(db, 'meta_inbound_events', eventId);
  const ctx: TenantContext = { tenantId, uid: 'meta-webhook', email: '', role: 'admin' };
  const repo = tenantRepo(ctx);
  const isWA = event.channel === 'WHATSAPP';
  const prefix = isWA ? 'wa' : 'fb';
  const label = isWA ? 'WhatsApp' : 'Messenger';
  const contactId = `${prefix}c_${hash24(event.accountId + ':' + event.senderId)}`;
  const conversationId = `${prefix}conv_${hash24(event.accountId + ':' + event.senderId)}`;
  const messageId = `${prefix}msg_${hash24(event.accountId + ':' + event.externalMessageId)}`;
  const now = new Date().toISOString();

  if (event.senderId === event.accountId) {
    await updateDoc(eventRef, { status: 'ignored', processedAt: now });
    return;
  }
  if ((await getDoc(repo.messageDoc(messageId))).exists()) {
    await updateDoc(eventRef, { status: 'duplicate', processedAt: now });
    return;
  }

  const displayName = event.senderName?.trim() || `${label} user`;
  const [firstName, ...rest] = displayName.split(' ');
  const contactSnap = await getDoc(repo.contactDoc(contactId));
  const base = contactSnap.exists()
    ? (contactSnap.data() as any)
    : {
        contactId, firstName: firstName || label, lastName: rest.join(' '), email: '',
        phone: isWA ? `+${event.senderId}` : '', companyName: `${label} contact`,
        tags: [isWA ? 'WHATSAPP' : 'MESSENGER'], notes: '', createdAt: now,
      };
  await setDoc(repo.contactDoc(contactId), {
    ...base,
    ...(isWA ? { whatsappId: event.senderId } : { facebookUserId: event.senderId }),
    updatedAt: now,
    lastActivityAt: event.timestamp,
  }, { merge: true });

  const prevSnap = await getDoc(repo.conversationDoc(conversationId));
  const previous = prevSnap.exists() ? (prevSnap.data() as any) : null;
  const conversation = {
    conversationId, contactId, channel: event.channel, direction: 'INBOUND', externalConversationId: event.senderId,
    status: previous?.status || 'ACTIVE', aiEnabled: previous?.aiEnabled !== false,
    humanHandoff: previous?.humanHandoff === true, managementMode: previous?.managementMode || 'AI',
    conversationSummary: previous?.conversationSummary || `${label} conversation`,
    startedAt: previous?.startedAt || event.timestamp, lastMessageAt: event.timestamp, lastMessageText: event.text,
    unreadCount: Number(previous?.unreadCount || 0) + 1, isRead: false, unread: true,
    createdAt: previous?.createdAt || now, updatedAt: now,
  };
  await setDoc(repo.conversationDoc(conversationId), conversation, { merge: true });
  await setDoc(repo.messageDoc(messageId), {
    messageId, externalMessageId: event.externalMessageId, conversationId, channel: event.channel,
    senderType: 'CUSTOMER', senderName: displayName, text: event.text, direction: 'INBOUND',
    timestamp: event.timestamp, receivedAt: now, createdAt: now, aiReplied: false, aiProcessed: false,
  });

  const settingsSnap = await getDoc(repo.settingsDoc('default'));
  const settings = settingsSnap.exists() ? (settingsSnap.data() as any) : {};
  const mode = settings?.channelModes?.[event.channel] || 'AUTO';
  if (!conversation.aiEnabled || conversation.humanHandoff || conversation.managementMode === 'HUMAN' || mode === 'SIMULATION') {
    await updateDoc(eventRef, { status: 'processed', processedAt: now, conversationId });
    return;
  }
  // Load the recent thread once: it feeds the Human Handoff check and the AI prompt below.
  const historySnap = await getDocs(query(repo.messages(), where('conversationId', '==', conversationId)));
  const thread = historySnap.docs
    .map((d) => d.data() as any)
    .filter((m) => m.messageId !== messageId)
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime());

  // Human Handoff: a customer asking for a person (or clearly frustrated) silences the AI for this conversation.
  if (event.hasText && Boolean(event.text)) {
    try {
      const handoff = await evaluateHumanHandoff(ctx, { text: event.text, thread, settings });
      if (handoff.matched) {
        await persistHumanHandoff(ctx, conversationId, handoff);
        await updateDoc(eventRef, { status: 'handoff', reason: describeHandoff(handoff), processedAt: new Date().toISOString(), conversationId });
        return;
      }
    } catch (handoffError) {
      console.warn('[Human Handoff] Evaluation failed; continuing with the AI reply.', handoffError);
    }
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !event.hasText) {
    await updateDoc(eventRef, { status: 'processed_no_reply', reason: !apiKey ? 'OPENAI_API_KEY is not configured' : 'No text available for AI reply', processedAt: now, conversationId });
    return;
  }

  const knowledgeSnap = await getDocs(repo.knowledgeDocuments());
  const knowledge = knowledgeSnap.docs
    .map((d) => d.data() as any)
    .filter((d) => d.status === 'PUBLISHED')
    .slice(0, 8)
    .map((d) => '## ' + String(d.title || 'Knowledge') + '\n' + String(d.content || '').slice(0, 2500))
    .join('\n\n')
    .slice(0, 12000);
  const history = thread
    .slice(-8)
    .map((m) => ({ role: m.direction === 'OUTBOUND' ? ('assistant' as const) : ('user' as const), content: String(m.text || '').slice(0, 1500) }));
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: process.env.META_CHANNELS_AI_MODEL || process.env.INSTAGRAM_AI_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      {
        role: 'system',
        content: `You are this workspace customer-support and lead-qualification assistant. Reply naturally and briefly to the ${label} message. Use only the workspace knowledge below for factual claims. If knowledge does not answer the question, ask a concise clarifying question instead of inventing facts. Do not claim a booking or action has completed unless confirmed.\n\nWorkspace knowledge:\n` + (knowledge || 'No published workspace knowledge is available. Ask a clarifying question and do not invent product details.'),
      },
      ...history,
      { role: 'user', content: event.text.slice(0, 3000) },
    ],
  });
  const replyText = completion.choices[0]?.message?.content?.trim();
  if (!replyText) {
    await updateDoc(eventRef, { status: 'processed_no_reply', reason: 'AI returned an empty response', processedAt: now, conversationId });
    return;
  }

  if (mode === 'REVIEW') {
    await updateDoc(repo.conversationDoc(conversationId), {
      draftReply: { draftId: `${prefix}draft_${hash24(event.externalMessageId)}`, text: replyText, generatedAt: now, status: 'PENDING' },
      updatedAt: now,
    });
    await updateDoc(repo.messageDoc(messageId), { aiProcessed: true });
    await updateDoc(eventRef, { status: 'draft_created', processedAt: now, conversationId });
    return;
  }

  const latestSnap = await getDoc(repo.conversationDoc(conversationId));
  const latest = latestSnap.exists() ? (latestSnap.data() as any) : {};
  if (latest.aiEnabled === false || latest.humanHandoff === true || latest.managementMode === 'HUMAN') {
    await updateDoc(eventRef, { status: 'suppressed_human_takeover', processedAt: new Date().toISOString(), conversationId });
    return;
  }

  const sent = await sendMetaText(ctx, isWA ? 'whatsapp' : 'messenger', event.senderId, replyText);
  const outboundId = `${prefix}out_${hash24(event.externalMessageId)}`;
  const sentAt = new Date().toISOString();
  await setDoc(repo.messageDoc(outboundId), {
    messageId: outboundId, externalMessageId: sent.messageId, conversationId, channel: event.channel,
    senderType: 'AI', senderName: 'AI Assistant', text: replyText, direction: 'OUTBOUND',
    timestamp: sentAt, sentAt, createdAt: sentAt, aiProcessed: true, aiGenerated: true, deliveryStatus: 'DELIVERED',
  });
  await updateDoc(repo.messageDoc(messageId), { aiReplied: true, repliedAt: sentAt, repliedByMessageId: outboundId, aiProcessed: true });
  await updateDoc(repo.conversationDoc(conversationId), { lastMessageAt: sentAt, lastMessageText: replyText, updatedAt: sentAt });
  await updateDoc(eventRef, { status: 'replied', processedAt: sentAt, conversationId, outboundMessageId: outboundId });
}

function waText(message: any): { text: string; hasText: boolean } {
  const type = String(message?.type || '');
  const text =
    message?.text?.body ||
    message?.button?.text ||
    message?.interactive?.button_reply?.title ||
    message?.interactive?.list_reply?.title ||
    '';
  if (String(text).trim()) return { text: String(text).trim(), hasText: true };
  return { text: `[WhatsApp ${type || 'message'} received]`, hasText: false };
}

function normalizeWhatsAppNumber(value: unknown): string {
  return String(value || '').replace(/\D/g, '');
}

function metaWebhookTimestamp(value: unknown): string {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date().toISOString();
  const numeric = Number(raw);
  if (Number.isFinite(numeric) && numeric > 0) return new Date(numeric < 1e12 ? numeric * 1000 : numeric).toISOString();
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

/** Save Business App contacts without deleting CRM records when a phone contact is removed. */
async function persistCoexistenceContact(tenantId: string, phoneNumberId: string, state: any): Promise<boolean> {
  const contact = state?.contact || {};
  const phone = normalizeWhatsAppNumber(contact.phone_number || contact.wa_id);
  if (!phone) return false;

  const ctx: TenantContext = { tenantId, uid: 'meta-coexistence-webhook', email: '', role: 'admin' };
  const repo = tenantRepo(ctx);
  const contactId = `wac_${hash24(phoneNumberId + ':' + phone)}`;
  const existingSnap = await getDoc(repo.contactDoc(contactId));
  const existing = existingSnap.exists() ? (existingSnap.data() as any) : {};
  const displayName = String(contact.full_name || [contact.first_name, contact.last_name].filter(Boolean).join(' ') || '').trim();
  const [firstName, ...lastParts] = displayName.split(/\s+/);
  const removed = String(state?.action || '').toLowerCase() === 'remove';
  const now = new Date().toISOString();

  await setDoc(repo.contactDoc(contactId), {
    ...existing,
    contactId,
    firstName: firstName || existing.firstName || 'WhatsApp contact',
    lastName: lastParts.join(' ') || existing.lastName || '',
    phone: `+${phone}`,
    whatsappId: phone,
    tags: Array.isArray(existing.tags) ? existing.tags : ['WHATSAPP'],
    whatsappAppContactStatus: removed ? 'removed_from_phone' : 'active',
    updatedAt: now,
    lastActivityAt: now,
    createdAt: existing.createdAt || now,
  }, { merge: true });
  return true;
}

/**
 * Persist WhatsApp Business App echoes and historical messages directly. These must never pass
 * through processInbound because replaying history would send fresh AI replies to old messages.
 */
async function persistCoexistenceMessage(
  tenantId: string,
  phoneNumberId: string,
  rawMessage: any,
  direction: 'INBOUND' | 'OUTBOUND',
  customerPhone?: string,
  historical = false
): Promise<boolean> {
  const message = rawMessage?.message && typeof rawMessage.message === 'object'
    ? { ...rawMessage, ...rawMessage.message }
    : rawMessage;
  const externalMessageId = String(message?.id || message?.message_id || rawMessage?.id || '').trim();
  const customer = normalizeWhatsAppNumber(customerPhone || (direction === 'OUTBOUND'
    ? (message?.to || message?.recipient_id || rawMessage?.to)
    : (message?.from || message?.sender_id || rawMessage?.from)));
  if (!externalMessageId || !customer) return false;

  const ctx: TenantContext = { tenantId, uid: 'meta-coexistence-webhook', email: '', role: 'admin' };
  const repo = tenantRepo(ctx);
  const contactId = `wac_${hash24(phoneNumberId + ':' + customer)}`;
  const conversationId = `waconv_${hash24(phoneNumberId + ':' + customer)}`;
  const messageId = `wamsg_${hash24(phoneNumberId + ':' + externalMessageId)}`;
  if ((await getDoc(repo.messageDoc(messageId))).exists()) return false;

  const now = new Date().toISOString();
  const timestamp = metaWebhookTimestamp(message?.timestamp || rawMessage?.timestamp);
  const contactSnap = await getDoc(repo.contactDoc(contactId));
  const existingContact = contactSnap.exists() ? (contactSnap.data() as any) : {};
  const contactName = String(message?.contacts?.[0]?.profile?.name || existingContact.firstName || 'WhatsApp contact').trim();
  await setDoc(repo.contactDoc(contactId), {
    ...existingContact,
    contactId,
    firstName: existingContact.firstName || contactName,
    lastName: existingContact.lastName || '',
    phone: `+${customer}`,
    whatsappId: customer,
    tags: Array.isArray(existingContact.tags) ? existingContact.tags : ['WHATSAPP'],
    createdAt: existingContact.createdAt || now,
    updatedAt: now,
    lastActivityAt: timestamp,
  }, { merge: true });

  const conversationSnap = await getDoc(repo.conversationDoc(conversationId));
  const previous = conversationSnap.exists() ? (conversationSnap.data() as any) : {};
  const isNewer = !previous.lastMessageAt || new Date(timestamp).getTime() >= new Date(previous.lastMessageAt).getTime();
  const currentUnread = Number(previous.unreadCount || 0);
  const unreadCount = currentUnread + (!historical && direction === 'INBOUND' ? 1 : 0);
  const { text, hasText } = waText(message);
  await setDoc(repo.messageDoc(messageId), {
    messageId,
    externalMessageId,
    conversationId,
    channel: 'WHATSAPP',
    senderType: direction === 'OUTBOUND' ? 'AGENT' : 'CUSTOMER',
    senderName: direction === 'OUTBOUND' ? 'WhatsApp Business App' : contactName,
    text,
    hasText,
    direction,
    timestamp,
    receivedAt: now,
    createdAt: timestamp,
    aiProcessed: true,
    historical,
    source: historical ? 'WHATSAPP_BUSINESS_APP_HISTORY' : 'WHATSAPP_BUSINESS_APP_ECHO',
  });
  await setDoc(repo.conversationDoc(conversationId), {
    ...previous,
    conversationId,
    contactId,
    channel: 'WHATSAPP',
    direction: isNewer ? direction : (previous.direction || direction),
    externalConversationId: customer,
    status: previous.status || 'ACTIVE',
    aiEnabled: previous.aiEnabled !== false,
    humanHandoff: previous.humanHandoff === true,
    managementMode: previous.managementMode || 'AI',
    conversationSummary: previous.conversationSummary || 'WhatsApp conversation',
    startedAt: !previous.startedAt || new Date(timestamp).getTime() < new Date(previous.startedAt).getTime() ? timestamp : previous.startedAt,
    lastMessageAt: isNewer ? timestamp : previous.lastMessageAt,
    lastMessageText: isNewer ? text : previous.lastMessageText,
    unreadCount,
    isRead: unreadCount === 0 ? true : false,
    unread: unreadCount > 0,
    createdAt: previous.createdAt || now,
    updatedAt: now,
  }, { merge: true });
  return true;
}

async function persistCoexistenceHistory(
  tenantId: string,
  phoneNumberId: string,
  history: any[],
  displayPhoneNumber: string
): Promise<number> {
  let accepted = 0;
  const businessDigits = normalizeWhatsAppNumber(displayPhoneNumber);
  for (const chunk of history) {
    if (Array.isArray(chunk?.errors) && chunk.errors.length) {
      console.info('[WhatsApp Coexistence] History sync reported an error/decline from the Business App.');
    }
    for (const thread of Array.isArray(chunk?.threads) ? chunk.threads : []) {
      const customer = normalizeWhatsAppNumber(thread?.id || thread?.wa_id);
      if (!customer) continue;
      const messages = Array.isArray(thread?.messages) ? thread.messages : [];
      for (let i = 0; i < messages.length; i += 20) {
        const batch = messages.slice(i, i + 20);
        const results = await Promise.all(batch.map(async (message: any) => {
          const from = normalizeWhatsAppNumber(message?.from);
          const to = normalizeWhatsAppNumber(message?.to);
          const isBusinessSender = (Boolean(businessDigits) && from === businessDigits) ||
            String(message?.from || '') === phoneNumberId;
          const isCustomerSender = Boolean(businessDigits) && to === businessDigits;
          const direction: 'INBOUND' | 'OUTBOUND' = isBusinessSender ? 'OUTBOUND' : isCustomerSender ? 'INBOUND' : 'INBOUND';
          return persistCoexistenceMessage(tenantId, phoneNumberId, message, direction, customer, true);
        }));
        accepted += results.filter(Boolean).length;
      }
    }
  }
  return accepted;
}

async function dispatch(tenantId: string, event: InboundEvent, externalKey: string, raw: any) {
  const eventId = crypto.createHash('sha256').update(externalKey).digest('hex');
  const eventRef = doc(db, 'meta_inbound_events', eventId);
  try {
    await createDoc(eventRef, { tenantId, channel: event.channel, accountId: event.accountId, externalId: event.externalMessageId, status: 'received', receivedAt: new Date().toISOString() });
  } catch {
    return false; // Meta retried a delivery we already took.
  }
  try {
    await processInbound(tenantId, event, eventId);
  } catch (error: any) {
    console.error('[Meta webhook] Event processing failed:', error?.message || 'unknown error');
    await updateDoc(eventRef, { status: 'failed', lastError: 'Processing failed; inspect server logs.', updatedAt: new Date().toISOString() }).catch(() => {});
  }
  void raw;
  return true;
}

export async function handleMetaWebhook(req: any, res: any): Promise<boolean> {
  if (req.method === 'GET') {
    const params = new URL(req.url || '/', 'http://localhost').searchParams;
    const mode = params.get('hub.mode');
    const token = params.get('hub.verify_token');
    const challenge = params.get('hub.challenge');
    const expected = env('META_WEBHOOK_VERIFY_TOKEN');
    if (mode === 'subscribe' && expected && token === expected && challenge) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end(challenge);
    } else {
      res.statusCode = 403;
      res.end('Forbidden');
    }
    return true;
  }
  if (req.method !== 'POST') {
    json(res, 405, { error: 'Method not allowed' });
    return true;
  }
  const signatureOk = isValidMetaSignature(req);
  console.log('[Meta webhook] POST received', JSON.stringify({
    signatureOk,
    object: req.body?.object,
    entries: Array.isArray(req.body?.entry) ? req.body.entry.map((e: any) => ({ id: e?.id })) : [],
  }));
  if (!signatureOk) {
    json(res, 401, { error: 'Invalid webhook signature or raw request body unavailable.' });
    return true;
  }

  const body = req.body || {};
  let accepted = 0;

  if (body.object === 'whatsapp_business_account') {
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      for (const change of Array.isArray(entry.changes) ? entry.changes : []) {
        const field = String(change?.field || '');
        const value = change?.value || {};
        if (!['messages', 'history', 'smb_app_state_sync', 'smb_message_echoes'].includes(field)) continue;
        const phoneNumberId = String(value?.metadata?.phone_number_id || '');
        if (!phoneNumberId) continue;
        const routeSnap = await getDoc(doc(db, 'channel_routes', phoneNumberId));
        const tenantId = routeSnap.exists() ? String((routeSnap.data() as any).tenantId || '') : '';
        if (!tenantId) continue;

        if (field === 'smb_app_state_sync') {
          for (const state of Array.isArray(value.state_sync) ? value.state_sync : []) {
            if (await persistCoexistenceContact(tenantId, phoneNumberId, state)) accepted++;
          }
          continue;
        }
        if (field === 'smb_message_echoes') {
          const echoes = Array.isArray(value.message_echoes) ? value.message_echoes : Array.isArray(value.messages) ? value.messages : [];
          for (const echo of echoes) {
            if (await persistCoexistenceMessage(tenantId, phoneNumberId, echo, 'OUTBOUND')) accepted++;
          }
          continue;
        }
        if (field === 'history') {
          accepted += await persistCoexistenceHistory(
            tenantId,
            phoneNumberId,
            Array.isArray(value.history) ? value.history : [],
            String(value?.metadata?.display_phone_number || '')
          );
          continue;
        }
        const names: Record<string, string> = {};
        for (const c of Array.isArray(value.contacts) ? value.contacts : []) {
          if (c?.wa_id) names[String(c.wa_id)] = String(c?.profile?.name || '');
        }
        for (const message of Array.isArray(value.messages) ? value.messages : []) {
          const from = String(message?.from || '');
          const id = String(message?.id || '');
          if (!from || !id) continue;
          const { text, hasText } = waText(message);
          const ts = Number(message?.timestamp);
          const ok = await dispatch(
            tenantId,
            {
              channel: 'WHATSAPP', accountId: phoneNumberId, senderId: from, senderName: names[from],
              externalMessageId: id, text, hasText,
              timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts * 1000).toISOString() : new Date().toISOString(),
            },
            `wa:${phoneNumberId}:${id}`,
            message
          );
          if (ok) accepted++;
        }
      }
    }
  } else if (body.object === 'page') {
    for (const entry of Array.isArray(body.entry) ? body.entry : []) {
      const pageId = String(entry?.id || '');
      if (!pageId) continue;
      const routeSnap = await getDoc(doc(db, 'meta_page_routes', pageId));
      const tenantId = routeSnap.exists() ? String((routeSnap.data() as any).tenantId || '') : '';
      if (!tenantId) continue;
      for (const m of Array.isArray(entry.messaging) ? entry.messaging : []) {
        if (!m?.message || m.message.is_echo) continue;
        const senderId = String(m?.sender?.id || '');
        const mid = String(m.message.mid || '');
        if (!senderId || !mid) continue;
        const text = String(m.message.text || '').trim();
        const ts = Number(m?.timestamp);
        const ok = await dispatch(
          tenantId,
          {
            channel: 'FACEBOOK', accountId: pageId, senderId, externalMessageId: mid,
            text: text || '[Messenger attachment received]', hasText: Boolean(text),
            timestamp: Number.isFinite(ts) && ts > 0 ? new Date(ts).toISOString() : new Date().toISOString(),
          },
          `fb:${pageId}:${mid}`,
          m
        );
        if (ok) accepted++;
      }
    }
  } else {
    json(res, 400, { error: 'Unsupported webhook object.' });
    return true;
  }

  json(res, 200, { success: true, accepted });
  return true;
}
