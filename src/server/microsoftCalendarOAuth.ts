import crypto from 'node:crypto';
import { db, doc, getDoc, setDoc, deleteDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { tenantRepo } from './tenantRepo.js';
import { encryptSecret, decryptSecret } from './cryptoUtils.js';
import type { TenantContext } from '../types/tenant.js';
import {
  MicrosoftOAuthError,
  MicrosoftReauthRequired,
  describeMicrosoftError,
  isMicrosoftOAuthConfigured,
} from './microsoftOAuth.js';

/**
 * "Sign in with Microsoft" for demo scheduling (Outlook / Microsoft 365 calendar + Teams).
 *
 * Separate from inbound IMAP OAuth: different redirect URI, Graph scopes, and stored secret.
 *   OAuth state: oauth_states/{sha256(state)}  provider = microsoft_calendar
 *   Refresh token: tenants/{id}/secrets/calendar_oauth_microsoft
 *
 * Redirect default: ${APP_URL}/api/oauth/microsoft-calendar/callback
 */

export const MICROSOFT_CALENDAR_SECRET_NAME = 'calendar_oauth_microsoft';
const STATE_COLLECTION = 'oauth_states';
const STATE_TTL_MS = 10 * 60_000;
const SCOPES = [
  'https://graph.microsoft.com/Calendars.ReadWrite',
  'https://graph.microsoft.com/OnlineMeetings.ReadWrite',
  'offline_access',
  'openid',
  'email',
  'profile',
];

const sysCtx = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: '', role: 'admin' });

function config() {
  const clientId = (process.env.MICROSOFT_CLIENT_ID || '').trim();
  const clientSecret = (process.env.MICROSOFT_CLIENT_SECRET || '').trim();
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const redirectUri = (
    process.env.MICROSOFT_CALENDAR_REDIRECT_URI ||
    (appUrl ? `${appUrl}/api/oauth/microsoft-calendar/callback` : '')
  ).trim();
  const authTenant = (process.env.MICROSOFT_AUTH_TENANT || 'common').trim();
  return { clientId, clientSecret, redirectUri, authTenant, appUrl };
}

export function isMicrosoftCalendarOAuthConfigured(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

function requireConfig() {
  const c = config();
  if (!c.clientId || !c.clientSecret || !c.redirectUri) {
    throw new MicrosoftOAuthError(
      503,
      'Microsoft Calendar is not set up on this server yet (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / APP_URL).'
    );
  }
  return c;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const stateKey = (state: string) => crypto.createHash('sha256').update(state).digest('hex');

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<TokenResponse> {
  const c = requireConfig();
  const res = await fetch(`https://login.microsoftonline.com/${encodeURIComponent(c.authTenant)}/oauth2/v2.0/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...body }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as TokenResponse;
  if (!res.ok && !data.error) data.error = `http_${res.status}`;
  return data;
}

function decodeIdToken(idToken?: string): Record<string, any> {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1] || '', 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export async function startMicrosoftCalendarOAuth(ctx: TenantContext): Promise<{ authorizationUrl: string }> {
  if (!isFirebaseConfigured || !db) throw new MicrosoftOAuthError(503, 'Database is not configured');
  if (!isMicrosoftOAuthConfigured() && !isMicrosoftCalendarOAuthConfigured()) {
    throw new MicrosoftOAuthError(503, 'Microsoft Calendar is not set up on this server yet.');
  }
  const c = requireConfig();

  const state = b64url(crypto.randomBytes(32));
  const codeVerifier = b64url(crypto.randomBytes(48));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());

  await setDoc(doc(db, STATE_COLLECTION, stateKey(state)), {
    provider: 'microsoft_calendar',
    tenantId: ctx.tenantId,
    uid: ctx.uid,
    codeVerifier,
    createdAt: new Date().toISOString(),
    expiresAt: new Date(Date.now() + STATE_TTL_MS).toISOString(),
  });

  const params = new URLSearchParams({
    client_id: c.clientId,
    response_type: 'code',
    redirect_uri: c.redirectUri,
    response_mode: 'query',
    scope: SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    prompt: 'select_account',
  });
  return {
    authorizationUrl: `https://login.microsoftonline.com/${encodeURIComponent(c.authTenant)}/oauth2/v2.0/authorize?${params.toString()}`,
  };
}

export interface MicrosoftCalendarCallbackResult {
  tenantId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}

export async function exchangeMicrosoftCalendarCallback(query: URLSearchParams): Promise<MicrosoftCalendarCallbackResult> {
  if (!isFirebaseConfigured || !db) throw new MicrosoftOAuthError(503, 'Database is not configured');
  const c = requireConfig();
  const state = query.get('state') || '';
  if (!state) throw new MicrosoftOAuthError(400, 'Missing sign-in state. Please try again.');

  const ref = doc(db, STATE_COLLECTION, stateKey(state));
  const snap = await getDoc(ref);
  await deleteDoc(ref).catch(() => {});
  const st: any = snap.exists() ? snap.data() : null;
  if (!st || st.provider !== 'microsoft_calendar' || !st.tenantId || new Date(st.expiresAt).getTime() < Date.now()) {
    throw new MicrosoftOAuthError(400, 'This sign-in link has expired. Please start again from Demo Scheduling.');
  }

  if (query.get('error')) {
    throw new MicrosoftOAuthError(
      400,
      describeMicrosoftError({ error: query.get('error') || undefined, error_description: query.get('error_description') || undefined })
    );
  }
  const code = query.get('code') || '';
  if (!code) throw new MicrosoftOAuthError(400, 'Microsoft did not return a sign-in code. Please try again.');

  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    code_verifier: st.codeVerifier,
    scope: SCOPES.join(' '),
  });
  if (data.error || !data.access_token) throw new MicrosoftOAuthError(400, describeMicrosoftError(data));
  if (!data.refresh_token) {
    throw new MicrosoftOAuthError(400, 'Microsoft did not grant offline access. Please try again and accept all permissions.');
  }

  const claims = decodeIdToken(data.id_token);
  const emailCandidates = [claims.email, claims.preferred_username, claims.upn, claims.unique_name]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => v.includes('@'));
  const email = emailCandidates[0] || '';
  if (!email) throw new MicrosoftOAuthError(400, 'Could not read the Microsoft account email.');

  return {
    tenantId: String(st.tenantId),
    email,
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
  };
}

const accessCache = new Map<string, { token: string; expiresAt: number }>();

export async function saveMicrosoftCalendarRefreshToken(
  tenantId: string,
  refreshToken: string,
  accessToken?: string,
  expiresIn?: number
) {
  const now = new Date().toISOString();
  await setDoc(
    tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_CALENDAR_SECRET_NAME),
    { name: MICROSOFT_CALENDAR_SECRET_NAME, ...encryptSecret(JSON.stringify({ refreshToken })), createdAt: now, updatedAt: now },
    { merge: false }
  );
  if (accessToken) accessCache.set(tenantId, { token: accessToken, expiresAt: Date.now() + (expiresIn || 3600) * 1000 });
  else accessCache.delete(tenantId);
}

export async function deleteMicrosoftCalendarRefreshToken(tenantId: string) {
  accessCache.delete(tenantId);
  await deleteDoc(tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_CALENDAR_SECRET_NAME)).catch(() => {});
}

export async function hasMicrosoftCalendarRefreshToken(tenantId: string): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false;
  return (await getDoc(tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_CALENDAR_SECRET_NAME))).exists();
}

async function readRefreshToken(tenantId: string): Promise<string | null> {
  const snap = await getDoc(tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_CALENDAR_SECRET_NAME));
  if (!snap.exists()) return null;
  try {
    return JSON.parse(decryptSecret(snap.data() as any)).refreshToken || null;
  } catch {
    return null;
  }
}

export async function getMicrosoftCalendarAccessToken(tenantId: string): Promise<string> {
  const cached = accessCache.get(tenantId);
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;

  const refreshToken = await readRefreshToken(tenantId);
  if (!refreshToken) {
    throw new MicrosoftReauthRequired('The saved Microsoft Calendar sign-in could not be read. Connect Microsoft Calendar again.');
  }

  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES.join(' ') });
  if (data.error || !data.access_token) {
    if (data.error === 'invalid_grant' || data.error === 'interaction_required' || data.error === 'consent_required') {
      accessCache.delete(tenantId);
      throw new MicrosoftReauthRequired(describeMicrosoftError(data));
    }
    throw new Error(describeMicrosoftError(data));
  }
  accessCache.set(tenantId, { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    await saveMicrosoftCalendarRefreshToken(tenantId, data.refresh_token, data.access_token, data.expires_in);
  }
  return data.access_token;
}

export function calendarRedirectUrl(result: 'connected' | 'error', message?: string): string {
  const { appUrl } = config();
  const params = new URLSearchParams({ calendar: result === 'connected' ? 'microsoft' : 'error' });
  if (message) params.set('calendar_message', message.slice(0, 300));
  return `${appUrl || ''}/?${params.toString()}`;
}

export { MicrosoftOAuthError, MicrosoftReauthRequired };
