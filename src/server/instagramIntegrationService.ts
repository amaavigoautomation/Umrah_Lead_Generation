import crypto from 'crypto';
import { doc, getDoc, setDoc, deleteDoc } from './adminFirestore.js';
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
  const snap = await getDoc(tenantRepo(ctx).secretDoc('instagram_access_token'));
  if (!snap.exists()) throw new Error('Instagram is not connected. Reconnect the account.');
  return decryptSecret(snap.data() as any);
}

export async function startInstagramOAuth(ctx: TenantContext): Promise<{ authorizationUrl: string }> {
  const clientId = requiredEnv('META_INSTAGRAM_APP_ID');
  const redirectUri = requiredEnv('META_INSTAGRAM_REDIRECT_URI');
  requiredEnv('META_INSTAGRAM_APP_SECRET');
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

async function exchangeCode(code: string): Promise<{ accessToken: string; accountId: string; username: string; expiresIn?: number }> {
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

  return {
    accessToken,
    accountId: String(profile.user_id || profile.id || tokenBody.user_id),
    username: String(profile.username),
    expiresIn,
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
    const appUrl = process.env.APP_BASE_URL || '/';
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

    const now = new Date().toISOString();
    const connection: InstagramConnection = {
      accountId: account.accountId,
      username: account.username,
      status: 'connected',
      connectedAt: existing?.connectedAt || now,
      updatedAt: now,
      scopes: ['instagram_business_basic', 'instagram_business_manage_messages'],
      tokenExpiresAt: account.expiresIn ? new Date(Date.now() + account.expiresIn * 1000).toISOString() : null,
    };
    await setDoc(tenantRepo(ctx).secretDoc('instagram_access_token'), {
      ...encryptSecret(account.accessToken),
      name: 'instagram_access_token',
      updatedAt: now,
      createdAt: now,
    });
    await setDoc(tenantRepo(ctx).integrationDoc('instagram'), { channel: 'instagram', connection }, { merge: true });
    await setDoc(routeRef, { tenantId: ctx.tenantId, accountId: account.accountId, updatedAt: now });
    const appUrl = process.env.APP_BASE_URL || '/';
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

export async function handleInstagramWebhook(req: any, res: any): Promise<boolean> {
  if (req.method === 'GET') {
    const params = queryParams(req);
    const mode = params.get('hub.mode') || params.get('hub_mode');
    const token = params.get('hub.verify_token') || params.get('hub_verify_token');
    const challenge = params.get('hub.challenge') || params.get('hub_challenge');
    const expected = process.env.META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN;
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
  if (!isValidMetaSignature(req)) {
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
    if (!routeSnap.exists()) continue;
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
      const existing = await getDoc(eventRef);
      if (existing.exists()) continue;
      await setDoc(eventRef, {
        accountId,
        tenantId,
        externalId,
        event,
        status: 'queued',
        receivedAt: new Date().toISOString(),
      });
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
