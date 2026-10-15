import crypto from 'crypto';
import { doc, collection, getDoc, setDoc, deleteDoc, createDoc, updateDoc, getDocs, query, where } from './adminFirestore.js';
import OpenAI from 'openai';
import { db } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { encryptSecret, decryptSecret } from './cryptoUtils.js';
import type { TenantContext } from '../types/tenant.js';

const GRAPH_VERSION = process.env.META_GRAPH_API_VERSION || 'v23.0';
const OAUTH_STATE_TTL_MS = 10 * 60 * 1000;

type InstagramConnection = {
  accountId: string;
  username: string;
  status: 'connected' | 'reauthorization_required' | 'disconnected';
  connectedAt: string;
  updatedAt: string;
  scopes?: string[];
  tokenExpiresAt?: string | null;
  webhookSubscriptionStatus?: 'subscribed' | 'needs_setup';
};

function requiredEnv(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing required server environment variable: ${name}`);
  return value;
}

function json(res: any, status: number, payload: Record<string, unknown>) {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

function queryParams(req: any): URLSearchParams {
  return new URL(req.url || '/', 'http://localhost').searchParams;
}

function stateDocId(state: string): string {
  return crypto.createHash('sha256').update(state).digest('hex');
}

function contextFromState(state: any): TenantContext {
  if (!state?.tenantId || !state?.uid || !state?.role) {
    throw new Error('Invalid Instagram OAuth state context');
  }
  return {
    tenantId: String(state.tenantId),
    uid: String(state.uid),
    email: String(state.email || ''),
    role: state.role,
    isPlatformAdmin: false,
  };
}

async function getConnection(ctx: TenantContext): Promise<InstagramConnection | null> {
  const snap = await getDoc(tenantRepo(ctx).integrationDoc('instagram'));
  if (!snap.exists()) return null;
  const data = snap.data() as any;
  return data?.channel === 'instagram' ? (data.connection as InstagramConnection) || null : null;
}

async function getAccessToken(ctx: TenantContext): Promise<string> {
  const repo = tenantRepo(ctx);
  const snap = await getDoc(repo.secretDoc('instagram_access_token'));
  if (!snap.exists()) throw new Error('Instagram is not connected. Reconnect the account.');
  let accessToken = decryptSecret(snap.data() as any);
  const connection = await getConnection(ctx);
  if (!connection) throw new Error('Instagram connection metadata is missing. Reconnect the account.');
  if (connection.tokenExpiresAt) {
    const expiresAt = Date.parse(connection.tokenExpiresAt);
    if (Number.isFinite(expiresAt) && expiresAt <= Date.now()) {
      throw new Error('Instagram access token has expired. Reconnect the account.');
    }
    // Refresh long-lived Instagram Login tokens shortly before expiry when Meta permits it.
    if (Number.isFinite(expiresAt) && expiresAt - Date.now() < 7 * 24 * 60 * 60 * 1000) {
      try {
        const refreshUrl = new URL('https://graph.instagram.com/refresh_access_token');
        refreshUrl.searchParams.set('grant_type', 'ig_refresh_token');
        refreshUrl.searchParams.set('access_token', accessToken);
        const refreshResponse = await fetch(refreshUrl);
        const refreshBody: any = await refreshResponse.json().catch(() => ({}));
        if (refreshResponse.ok && refreshBody.access_token) {
          accessToken = String(refreshBody.access_token);
          const now = new Date().toISOString();
          const expiresIn = Number(refreshBody.expires_in);
          await setDoc(repo.secretDoc('instagram_access_token'), {
            ...encryptSecret(accessToken),
            name: 'instagram_access_token',
            createdAt: snap.data().createdAt || now,
            updatedAt: now,
          });
          await setDoc(repo.integrationDoc('instagram'), {
            channel: 'instagram',
            connection: {
              ...connection,
              tokenExpiresAt: expiresIn ? new Date(Date.now() + expiresIn * 1000).toISOString() : connection.tokenExpiresAt,
              updatedAt: now,
            },
          }, { merge: true });
        }
      } catch {
        // Keep using the still-valid token; the next request can retry refresh.
      }
    }
  }
  return accessToken;
}

export async function startInstagramOAuth(ctx: TenantContext): Promise<{ authorizationUrl: string }> {
  const clientId = requiredEnv('META_INSTAGRAM_APP_ID');
  const redirectUri = requiredEnv('META_INSTAGRAM_REDIRECT_URI');
  requiredEnv('META_INSTAGRAM_APP_SECRET');
  if (!process.env.SECRETS_MASTER_KEY && !process.env.TENANT_MASTER_KEY) {
    throw new Error('SECRETS_MASTER_KEY or TENANT_MASTER_KEY must be configured before connecting Instagram.');
  }
  const state = crypto.randomBytes(32).toString('base64url');
  const now = Date.now();
  await setDoc(doc(db, 'instagram_oauth_states', stateDocId(state)), {
    tenantId: ctx.tenantId,
    uid: ctx.uid,
    email: ctx.email || '',
    role: ctx.role,
    createdAt: now,
    expiresAt: now + OAUTH_STATE_TTL_MS,
  });
  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: 'code',
    scope: 'instagram_business_basic,instagram_business_manage_messages',
    state,
  });
  return { authorizationUrl: `https://www.instagram.com/oauth/authorize?${params.toString()}` };
}

export async function getInstagramStatus(ctx: TenantContext) {
  const connection = await getConnection(ctx);
  return { connected: connection?.status === 'connected', connection };
}

export async function disconnectInstagram(ctx: TenantContext): Promise<void> {
  const repo = tenantRepo(ctx);
  const existing = await getConnection(ctx);
  // Best-effort token revocation; disconnect still completes if Meta is unavailable.
  try {
    const token = await getAccessToken(ctx);
    const revokeUrl = new URL('https://graph.instagram.com/' + GRAPH_VERSION + '/me/permissions');
    revokeUrl.searchParams.set('access_token', token);
    await fetch(revokeUrl, { method: 'DELETE' });
  } catch {
    // Token may already be expired or revoked.
  }
  if (existing) {
    await setDoc(repo.integrationDoc('instagram'), {
      channel: 'instagram',
      connection: { ...existing, status: 'disconnected', updatedAt: new Date().toISOString() },
    }, { merge: true });
  }
  await deleteDoc(repo.secretDoc('instagram_access_token'));
  if (existing?.accountId) {
    await deleteDoc(doc(db, 'instagram_account_routes', existing.accountId));
  }
}

async function exchangeCode(code: string): Promise<{ accessToken: string; accountId: string; aliasIds: string[]; username: string; expiresIn?: number; webhookSubscribed: boolean }> {
  const clientId = requiredEnv('META_INSTAGRAM_APP_ID');
  const clientSecret = requiredEnv('META_INSTAGRAM_APP_SECRET');
  const redirectUri = requiredEnv('META_INSTAGRAM_REDIRECT_URI');

  const form = new URLSearchParams({
    client_id: clientId,
    client_secret: clientSecret,
    grant_type: 'authorization_code',
    redirect_uri: redirectUri,
    code,
  });
  const tokenResponse = await fetch('https://api.instagram.com/oauth/access_token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: form.toString(),
  });
  const tokenBody: any = await tokenResponse.json().catch(() => ({}));
  if (!tokenResponse.ok || !tokenBody.access_token || !tokenBody.user_id) {
    throw new Error('Meta could not exchange the Instagram authorization code. Check app configuration and permissions.');
  }

  let accessToken = String(tokenBody.access_token);
  let expiresIn = Number(tokenBody.expires_in) || undefined;

  // Exchange for a long-lived token where supported by the selected Instagram Login flow.
  const longLivedUrl = new URL('https://graph.instagram.com/access_token');
  longLivedUrl.searchParams.set('grant_type', 'ig_exchange_token');
  longLivedUrl.searchParams.set('client_secret', clientSecret);
  longLivedUrl.searchParams.set('access_token', accessToken);
  const longLivedResponse = await fetch(longLivedUrl);
  const longLivedBody: any = await longLivedResponse.json().catch(() => ({}));
  if (longLivedResponse.ok && longLivedBody.access_token) {
    accessToken = String(longLivedBody.access_token);
    expiresIn = Number(longLivedBody.expires_in) || expiresIn;
  }

  const profileUrl = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/me`);
  profileUrl.searchParams.set('fields', 'user_id,username');
  profileUrl.searchParams.set('access_token', accessToken);
  const profileResponse = await fetch(profileUrl);
  const profile: any = await profileResponse.json().catch(() => ({}));
  if (!profileResponse.ok || !(profile.user_id || profile.id) || !profile.username) {
    throw new Error('Instagram authorization succeeded, but the account profile could not be verified.');
  }

  const accountId = String(profile.user_id || profile.id || tokenBody.user_id);
  let webhookSubscribed = false;
  try {
    const subscribeUrl = new URL('https://graph.instagram.com/' + GRAPH_VERSION + '/' + encodeURIComponent(accountId) + '/subscribed_apps');
    subscribeUrl.searchParams.set('subscribed_fields', 'messages');
    subscribeUrl.searchParams.set('access_token', accessToken);
    const subscribeResponse = await fetch(subscribeUrl, { method: 'POST' });
    webhookSubscribed = subscribeResponse.ok;
  } catch {
    webhookSubscribed = false;
  }

  const aliasIds = Array.from(new Set([profile.user_id, profile.id, tokenBody.user_id].filter(Boolean).map(String)));
  return {
    accessToken,
    accountId,
    aliasIds,
    username: String(profile.username),
    expiresIn,
    webhookSubscribed,
  };
}

export async function handleInstagramOAuthCallback(req: any, res: any): Promise<boolean> {
  const params = queryParams(req);
  const state = params.get('state') || '';
  const code = params.get('code') || '';
  const error = params.get('error_description') || params.get('error');

  if (!state) {
    json(res, 400, { error: 'Missing OAuth state.' });
    return true;
  }

  const stateRef = doc(db, 'instagram_oauth_states', stateDocId(state));
  const stateSnap = await getDoc(stateRef);
  if (!stateSnap.exists()) {
    json(res, 400, { error: 'Instagram authorization state is invalid or has already been used.' });
    return true;
  }
  const stateData = stateSnap.data() as any;
  await deleteDoc(stateRef); // Single-use even if Meta denied authorization.
  if (Date.now() > Number(stateData.expiresAt || 0)) {
    json(res, 400, { error: 'Instagram authorization expired. Please try again.' });
    return true;
  }
  if (error || !code) {
    const appUrl = process.env.APP_BASE_URL || process.env.APP_URL || '/';
    res.statusCode = 302;
    res.setHeader('Location', `${appUrl}${appUrl.includes('?') ? '&' : '?'}instagram=error`);
    res.end();
    return true;
  }

  try {
    const ctx = contextFromState(stateData);
    const account = await exchangeCode(code);
    const existing = await getConnection(ctx);
    const routeRef = doc(db, 'instagram_account_routes', account.accountId);
    const routeSnap = await getDoc(routeRef);
    if (routeSnap.exists() && routeSnap.data().tenantId !== ctx.tenantId) {
      json(res, 409, { error: 'This Instagram account is already connected to another workspace.' });
      return true;
    }

    if (existing?.accountId && existing.accountId !== account.accountId) {
      await deleteDoc(doc(db, 'instagram_account_routes', existing.accountId));
    }
    const now = new Date().toISOString();
    const connection: InstagramConnection = {
      accountId: account.accountId,
      username: account.username,
      status: 'connected',
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
      scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
      tokenExpiresAt: account.expiresIn ? new Date(Date.now() + account.expiresIn * 1000).toISOString() : null,
      webhookSubscriptionStatus: account.webhookSubscribed ? 'subscribed' : 'needs_setup',
    };
    await setDoc(tenantRepo(ctx).secretDoc('instagram_access_token'), {
      ...encryptSecret(account.accessToken),
      name: 'instagram_access_token',
      updatedAt: now,
      createdAt: now,
    });
    await setDoc(tenantRepo(ctx).integrationDoc('instagram'), { channel: 'instagram', connection }, { merge: true });
    await setDoc(routeRef, { tenantId: ctx.tenantId, accountId: account.accountId, updatedAt: now });
    // Meta may send webhooks under a different id form than /me returns; route every known form here.
    for (const alias of account.aliasIds) {
      if (alias === account.accountId) continue;
      await setDoc(doc(db, 'instagram_account_routes', alias), { tenantId: ctx.tenantId, accountId: account.accountId, alias: true, updatedAt: now });
    }
    const appUrl = process.env.APP_BASE_URL || process.env.APP_URL || '/';
    res.statusCode = 302;
    res.setHeader('Location', `${appUrl}${appUrl.includes('?') ? '&' : '?'}instagram=connected`);
    res.end();
  } catch (err: any) {
    console.error('[Instagram OAuth] Connection failed:', err?.message || 'unknown error');
    json(res, 500, { error: 'Could not connect Instagram. Check server configuration and Meta app permissions.' });
  }
  return true;
}

function isValidMetaSignature(req: any): boolean {
  const secret = process.env.META_INSTAGRAM_APP_SECRET;
  const signature = req.headers?.['x-hub-signature-256'];
  const rawBody = req.rawBody;
  if (!secret || !signature || !rawBody) return false;
  const raw = Buffer.isBuffer(rawBody) ? rawBody : Buffer.from(String(rawBody));
  const expected = `sha256=${crypto.createHmac('sha256', secret).update(raw).digest('hex')}`;
  const a = Buffer.from(String(signature));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function processInstagramMessageEvent(tenantId: string, accountId: string, event: any, eventId: string): Promise<void> {
  const senderId = String(event?.sender?.id || '');
  const externalMessageId = String(event?.message?.mid || event?.id || eventId);
  const eventRef = doc(db, 'instagram_inbound_events', eventId);
  if (!senderId || senderId === accountId || event?.message?.is_echo) {
    await updateDoc(eventRef, { status: 'ignored', processedAt: new Date().toISOString() });
    return;
  }
  const messageText = String(event?.message?.text || '').trim();
  const incomingText = messageText || (Array.isArray(event?.message?.attachments) && event.message.attachments.length ? '[Instagram attachment received]' : '');
  if (!incomingText) {
    await updateDoc(eventRef, { status: 'ignored', processedAt: new Date().toISOString() });
    return;
  }
  const ctx: TenantContext = { tenantId, uid: 'instagram-webhook', email: '', role: 'admin' };
  const repo = tenantRepo(ctx);
  const stableHash = (value: string) => crypto.createHash('sha256').update(value).digest('hex').slice(0, 24);
  const contactId = 'igc_' + stableHash(accountId + ':' + senderId);
  const conversationId = 'igconv_' + stableHash(accountId + ':' + senderId);
  const messageId = 'igmsg_' + stableHash(accountId + ':' + externalMessageId);
  const now = new Date().toISOString();
  const eventTime = Number(event?.timestamp);
  const timestamp = Number.isFinite(eventTime) && eventTime > 0 ? new Date(eventTime).toISOString() : now;
  const existingMessage = await getDoc(repo.messageDoc(messageId));
  if (existingMessage.exists()) {
    await updateDoc(eventRef, { status: 'duplicate', processedAt: now });
    return;
  }
  const contactSnap = await getDoc(repo.contactDoc(contactId));
  const contact = contactSnap.exists() ? contactSnap.data() : {
    contactId, firstName: 'Instagram', lastName: 'User', email: '', phone: '',
    companyName: 'Instagram contact', instagramUserId: senderId, tags: ['INSTAGRAM_DM'],
    notes: '', createdAt: now, updatedAt: now,
  };
  await setDoc(repo.contactDoc(contactId), { ...contact, instagramUserId: senderId, updatedAt: now, lastActivityAt: timestamp }, { merge: true });
  const conversationSnap = await getDoc(repo.conversationDoc(conversationId));
  const previous = conversationSnap.exists() ? conversationSnap.data() as any : null;
  const conversation = {
    conversationId, contactId, channel: 'INSTAGRAM', direction: 'INBOUND', externalConversationId: senderId,
    status: previous?.status || 'ACTIVE', aiEnabled: previous?.aiEnabled !== false,
    humanHandoff: previous?.humanHandoff === true, managementMode: previous?.managementMode || 'AI',
    conversationSummary: previous?.conversationSummary || 'Instagram direct-message conversation',
    startedAt: previous?.startedAt || timestamp, lastMessageAt: timestamp, lastMessageText: incomingText,
    unreadCount: Number(previous?.unreadCount || 0) + 1, isRead: false, unread: true,
    createdAt: previous?.createdAt || now, updatedAt: now,
  };
  await setDoc(repo.conversationDoc(conversationId), conversation, { merge: true });
  await setDoc(repo.messageDoc(messageId), {
    messageId, externalMessageId, conversationId, channel: 'INSTAGRAM', senderType: 'CUSTOMER',
    senderName: 'Instagram user', instagramUserId: senderId, text: incomingText, direction: 'INBOUND',
    timestamp, receivedAt: now, createdAt: now, aiReplied: false, aiProcessed: false,
  });
  // Synthetic test message from Settings: stop after saving it (no AI call, nothing sent to Instagram).
  if (event?.__test === true) {
    await updateDoc(eventRef, { status: 'test_processed', processedAt: now, conversationId });
    return;
  }
  const settingsSnap = await getDoc(repo.settingsDoc('default'));
  const settings = settingsSnap.exists() ? settingsSnap.data() as any : {};
  const mode = settings?.channelModes?.INSTAGRAM || 'AUTO';
  if (!conversation.aiEnabled || conversation.humanHandoff || conversation.managementMode === 'HUMAN' || mode === 'SIMULATION') {
    await updateDoc(eventRef, { status: 'processed', processedAt: now, conversationId });
    return;
  }
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey || !messageText) {
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
  const historySnap = await getDocs(query(repo.messages(), where('conversationId', '==', conversationId)));
  const history = historySnap.docs
    .map((d) => d.data() as any)
    .filter((m) => m.messageId !== messageId)
    .sort((a, b) => new Date(a.timestamp || 0).getTime() - new Date(b.timestamp || 0).getTime())
    .slice(-8)
    .map((m) => ({ role: m.direction === 'OUTBOUND' ? 'assistant' as const : 'user' as const, content: String(m.text || '').slice(0, 1500) }));
  const openai = new OpenAI({ apiKey });
  const completion = await openai.chat.completions.create({
    model: process.env.INSTAGRAM_AI_MODEL || 'gpt-4o-mini',
    temperature: 0.3,
    messages: [
      { role: 'system', content: 'You are this workspace customer-support and lead-qualification assistant. Reply naturally and briefly to the Instagram DM. Use only the workspace knowledge below for factual claims. If knowledge does not answer the question, ask a concise clarifying question instead of inventing facts. Do not claim a booking or action has completed unless confirmed.\n\nWorkspace knowledge:\n' + (knowledge || 'No published workspace knowledge is available. Ask a clarifying question and do not invent product details.') },
      ...history,
      { role: 'user', content: messageText.slice(0, 3000) },
    ],
  });
  const replyText = completion.choices[0]?.message?.content?.trim();
  if (!replyText) {
    await updateDoc(eventRef, { status: 'processed_no_reply', reason: 'AI returned an empty response', processedAt: now, conversationId });
    return;
  }
  if (mode === 'REVIEW') {
    await updateDoc(repo.conversationDoc(conversationId), {
      draftReply: { draftId: 'igdraft_' + stableHash(externalMessageId), text: replyText, generatedAt: now, status: 'PENDING' },
      updatedAt: now,
    });
    await updateDoc(repo.messageDoc(messageId), { aiProcessed: true });
    await updateDoc(eventRef, { status: 'draft_created', processedAt: now, conversationId });
    return;
  }
  const latestSnap = await getDoc(repo.conversationDoc(conversationId));
  const latest = latestSnap.exists() ? latestSnap.data() as any : {};
  if (latest.aiEnabled === false || latest.humanHandoff === true || latest.managementMode === 'HUMAN') {
    await updateDoc(eventRef, { status: 'suppressed_human_takeover', processedAt: new Date().toISOString(), conversationId });
    return;
  }
  const sendResult = await sendInstagramMessage(ctx, senderId, replyText);
  const outboundId = 'igout_' + stableHash(externalMessageId);
  const sentAt = new Date().toISOString();
  await setDoc(repo.messageDoc(outboundId), {
    messageId: outboundId, externalMessageId: String(sendResult?.message_id || sendResult?.messageId || ''),
    conversationId, channel: 'INSTAGRAM', senderType: 'AI', senderName: 'AI Assistant',
    instagramUserId: senderId, text: replyText, direction: 'OUTBOUND', timestamp: sentAt,
    sentAt, createdAt: sentAt, aiProcessed: true, aiGenerated: true, deliveryStatus: 'DELIVERED',
  });
  await updateDoc(repo.messageDoc(messageId), { aiReplied: true, repliedAt: sentAt, repliedByMessageId: outboundId, aiProcessed: true });
  await updateDoc(repo.conversationDoc(conversationId), { lastMessageAt: sentAt, lastMessageText: replyText, updatedAt: sentAt });
  await updateDoc(eventRef, { status: 'replied', processedAt: sentAt, conversationId, outboundMessageId: outboundId });
}

export async function handleInstagramWebhook(req: any, res: any): Promise<boolean> {
  if (req.method === 'GET') {
    const params = queryParams(req);
    const mode = params.get('hub.mode') || params.get('hub_mode');
    const token = params.get('hub.verify_token') || params.get('hub_verify_token');
    const challenge = params.get('hub.challenge') || params.get('hub_challenge');
    // Accept the Instagram-specific token, or the shared Meta webhook token.
    const accepted = [process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN, process.env.META_WEBHOOK_VERIFY_TOKEN]
      .map((t) => (t || '').trim())
      .filter(Boolean);
    if (mode === 'subscribe' && token && accepted.includes(token) && challenge) {
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
  console.log('[Instagram webhook] POST received', JSON.stringify({
    signatureOk,
    object: req.body?.object,
    entries: Array.isArray(req.body?.entry) ? req.body.entry.map((e: any) => ({ id: e?.id, messaging: Array.isArray(e?.messaging) ? e.messaging.length : 0, changes: Array.isArray(e?.changes) ? e.changes.length : 0 })) : [],
  }));
  if (!signatureOk) {
    json(res, 401, { error: 'Invalid webhook signature or raw request body unavailable.' });
    return true;
  }

  const body = req.body || {};
  if (body.object !== 'instagram') {
    json(res, 400, { error: 'Unsupported webhook object.' });
    return true;
  }

  let accepted = 0;
  for (const entry of Array.isArray(body.entry) ? body.entry : []) {
    const accountId = String(entry.id || '');
    if (!accountId) continue;
    const routeSnap = await getDoc(doc(db, 'instagram_account_routes', accountId));
    if (!routeSnap.exists()) {
      console.warn('[Instagram webhook] No workspace is connected for account id', accountId, '- the DM was sent to an Instagram account that is not connected.');
      continue;
    }
    const tenantId = String(routeSnap.data().tenantId || '');
    if (!tenantId) continue;

    const events = [
      ...(Array.isArray(entry.messaging) ? entry.messaging : []),
      ...(Array.isArray(entry.changes) ? entry.changes : []),
    ];
    for (const event of events) {
      const externalId = String(event.message?.mid || event.id || event.timestamp || crypto.randomUUID());
      const eventId = crypto.createHash('sha256').update(`${accountId}:${externalId}`).digest('hex');
      const eventRef = doc(db, 'instagram_inbound_events', eventId);
      try {
        await createDoc(eventRef, { accountId, tenantId, externalId, event, status: 'received', receivedAt: new Date().toISOString() });
      } catch {
        continue;
      }
      try {
        await processInstagramMessageEvent(tenantId, accountId, event, eventId);
      } catch (error: any) {
        console.error('[Instagram webhook] Event processing failed:', error?.message || 'unknown error');
        await updateDoc(eventRef, { status: 'failed', lastError: 'Processing failed; inspect server logs.', updatedAt: new Date().toISOString() }).catch(() => {});
      }
      accepted++;
    }
  }

  json(res, 200, { success: true, accepted });
  return true;
}

export async function sendInstagramMessage(ctx: TenantContext, recipientId: string, text: string) {
  if (!recipientId?.trim() || !text?.trim()) throw new Error('Instagram recipient and message text are required.');
  const connection = await getConnection(ctx);
  if (!connection || connection.status !== 'connected') throw new Error('Instagram account is not connected.');
  if (connection.tokenExpiresAt && Date.parse(connection.tokenExpiresAt) <= Date.now()) {
    throw new Error('Instagram access token may have expired. Reconnect the account.');
  }
  const accessToken = await getAccessToken(ctx);
  const url = `https://graph.instagram.com/${GRAPH_VERSION}/${encodeURIComponent(connection.accountId)}/messages`;
  const response = await fetch(url, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ recipient: { id: recipientId }, message: { text: text.trim() } }),
  });
  const result: any = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(`Instagram message send failed (HTTP ${response.status}). Check account permissions and messaging eligibility.`);
  }
  return result;
}

/**
 * Ask Instagram what it actually has on file for the connected account, and repair what is missing.
 * Helps when DMs never arrive: shows account type, whether the app is subscribed to `messages`,
 * and whether our own routing record points at this workspace.
 */
export async function diagnoseInstagram(ctx: TenantContext): Promise<Record<string, unknown>> {
  const connection = await getConnection(ctx);
  if (!connection || connection.status !== 'connected') {
    return { connected: false, summary: 'Instagram is not connected for this workspace. Click Connect Instagram first.' };
  }
  const result: Record<string, unknown> = { connected: true, accountId: connection.accountId, username: connection.username };
  const notes: string[] = [];
  let token = '';
  try {
    token = await getAccessToken(ctx);
  } catch (err: any) {
    return { ...result, summary: err?.message || 'The stored Instagram token cannot be used. Click Reconnect.' };
  }

  // 1. Account type must be professional.
  try {
    const profileUrl = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/me`);
    profileUrl.searchParams.set('fields', 'user_id,username,account_type');
    profileUrl.searchParams.set('access_token', token);
    const profile: any = await (await fetch(profileUrl)).json().catch(() => ({}));
    result.accountType = profile.account_type || 'unknown';
    result.profileUserId = String(profile.user_id || profile.id || '');
    for (const alias of new Set([profile.user_id, profile.id].filter(Boolean).map(String))) {
      if (alias === connection.accountId) continue;
      await setDoc(doc(db, 'instagram_account_routes', alias), { tenantId: ctx.tenantId, accountId: connection.accountId, alias: true, updatedAt: new Date().toISOString() });
      notes.push(`Registered extra account id ${alias}.`);
    }
    if (profile.error) notes.push(`Instagram rejected the token: ${profile.error.message || 'error'}. Reconnect the account.`);
    else if (profile.account_type && !['BUSINESS', 'MEDIA_CREATOR'].includes(String(profile.account_type))) {
      notes.push(`Account type is ${profile.account_type}. It must be a Business or Creator (Professional) account.`);
    }
  } catch {
    notes.push('Could not read the Instagram profile.');
  }

  // 2. Our routing record (webhook account id -> this workspace).
  try {
    const routeRef = doc(db, 'instagram_account_routes', connection.accountId);
    const routeSnap = await getDoc(routeRef);
    if (!routeSnap.exists()) {
      await setDoc(routeRef, { tenantId: ctx.tenantId, accountId: connection.accountId, updatedAt: new Date().toISOString() });
      result.routeRepaired = true;
      notes.push('The routing record was missing and has been recreated.');
    } else if ((routeSnap.data() as any).tenantId !== ctx.tenantId) {
      notes.push('This Instagram account is routed to a different workspace.');
    }
    result.routeOk = true;
  } catch {
    notes.push('Could not check the routing record.');
  }

  // 3. Is the app subscribed to this account's `messages` events?
  const subsUrl = new URL(`https://graph.instagram.com/${GRAPH_VERSION}/${encodeURIComponent(connection.accountId)}/subscribed_apps`);
  subsUrl.searchParams.set('access_token', token);
  const readFields = async (): Promise<string[]> => {
    const body: any = await (await fetch(subsUrl)).json().catch(() => ({}));
    const rows: any[] = Array.isArray(body?.data) ? body.data : [];
    return rows.flatMap((r) => (Array.isArray(r.subscribed_fields) ? r.subscribed_fields : []));
  };
  try {
    let fields = await readFields();
    result.subscribedFields = fields;
    if (!fields.includes('messages')) {
      const subscribeUrl = new URL(subsUrl);
      subscribeUrl.searchParams.set('subscribed_fields', 'messages');
      const resp = await fetch(subscribeUrl, { method: 'POST' });
      const body: any = await resp.json().catch(() => ({}));
      fields = await readFields();
      result.subscribedFields = fields;
      result.resubscribed = resp.ok && fields.includes('messages');
      notes.push(
        fields.includes('messages')
          ? 'The account was not subscribed to messages; it has now been subscribed.'
          : `Could not subscribe to messages${body?.error?.message ? `: ${body.error.message}` : ''}.`
      );
    }
  } catch {
    notes.push('Could not read the webhook subscription.');
  }

  // 4. Server settings Meta's deliveries depend on.
  result.appSecretSet = Boolean(process.env.META_INSTAGRAM_APP_SECRET);
  result.verifyTokenSet = Boolean(process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN);
  if (!result.appSecretSet) notes.push('META_INSTAGRAM_APP_SECRET is not set, so incoming events would be rejected.');

  const subscribed = Array.isArray(result.subscribedFields) && (result.subscribedFields as string[]).includes('messages');
  result.summary = notes.length
    ? notes.join(' ')
    : subscribed
    ? 'Account is professional, routed to this workspace and subscribed to messages. If DMs still do not arrive, check Instagram app > Settings > Messages and story replies > Connected tools > Allow access to messages, and that the sender has a role on the Meta app.'
    : 'Checks finished.';
  return result;
}

/**
 * Put a synthetic DM through the same processing code as a real webhook event, so the Unified Inbox
 * path can be verified without Meta. Saves the message and conversation only; no AI reply, nothing sent.
 */
export async function injectTestInstagramMessage(ctx: TenantContext): Promise<{ conversationId: string; messageId: string }> {
  const connection = await getConnection(ctx);
  if (!connection || connection.status !== 'connected') throw new Error('Instagram is not connected. Connect an account first.');
  const accountId = connection.accountId;
  const senderId = 'test_sender';
  const uniq = crypto.randomBytes(6).toString('hex');
  const event = {
    __test: true,
    sender: { id: senderId },
    recipient: { id: accountId },
    timestamp: Date.now(),
    message: { mid: `test_mid_${uniq}`, text: `Test message from Settings (${new Date().toLocaleTimeString('en-GB')})` },
  };
  const eventId = crypto.createHash('sha256').update(`${accountId}:${event.message.mid}`).digest('hex');
  await createDoc(doc(db, 'instagram_inbound_events', eventId), {
    accountId, tenantId: ctx.tenantId, externalId: event.message.mid, event, status: 'received', receivedAt: new Date().toISOString(),
  });
  await processInstagramMessageEvent(ctx.tenantId, accountId, event, eventId);
  const hash = (v: string) => crypto.createHash('sha256').update(v).digest('hex').slice(0, 24);
  return { conversationId: 'igconv_' + hash(accountId + ':' + senderId), messageId: 'igmsg_' + hash(accountId + ':' + event.message.mid) };
}
