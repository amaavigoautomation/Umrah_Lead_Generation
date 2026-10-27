import crypto from 'node:crypto';
import { db, doc, getDoc, setDoc, deleteDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { tenantRepo } from './tenantRepo.js';
import { encryptSecret, decryptSecret } from './cryptoUtils.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Server-side "Connect Google Calendar" (OAuth authorization-code flow with offline access).
 *
 * Why this exists: the old Firebase popup only ever returned a ~60 minute access token, so the calendar
 * disconnected every hour. This flow asks Google for a REFRESH token, stores it encrypted per workspace,
 * and renews access tokens on the server whenever they are needed. Nobody has to reconnect.
 *
 *   OAuth state:   oauth_states/{sha256(state)}  provider = google_calendar
 *   Refresh token: tenants/{id}/secrets/calendar_oauth_google
 *
 * Env: GOOGLE_CALENDAR_CLIENT_ID, GOOGLE_CALENDAR_CLIENT_SECRET, APP_URL
 * Redirect URI to register in Google Cloud: ${APP_URL}/api/oauth/google-calendar/callback
 * (override with GOOGLE_CALENDAR_REDIRECT_URI).
 */

export const GOOGLE_CALENDAR_SECRET_NAME = 'calendar_oauth_google';
const STATE_COLLECTION = 'oauth_states';
const STATE_TTL_MS = 10 * 60_000;
const SCOPES = [
  'https://www.googleapis.com/auth/calendar',
  'https://www.googleapis.com/auth/calendar.events',
  'openid',
  'email',
];

export class GoogleCalendarOAuthError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

/** Google revoked or expired the saved sign-in: the user has to connect again. */
export class GoogleCalendarReauthRequired extends GoogleCalendarOAuthError {
  constructor(message = 'Google Calendar access was revoked or expired. Connect Google Calendar again.') {
    super(401, message);
  }
}

const sysCtx = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: '', role: 'admin' });

function config() {
  const clientId = (process.env.GOOGLE_CALENDAR_CLIENT_ID || '').trim();
  const clientSecret = (process.env.GOOGLE_CALENDAR_CLIENT_SECRET || '').trim();
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const redirectUri = (
    process.env.GOOGLE_CALENDAR_REDIRECT_URI || (appUrl ? `${appUrl}/api/oauth/google-calendar/callback` : '')
  ).trim();
  return { clientId, clientSecret, redirectUri, appUrl };
}

export function isGoogleCalendarOAuthConfigured(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

function requireConfig() {
  const c = config();
  if (!c.clientId || !c.clientSecret || !c.redirectUri) {
    throw new GoogleCalendarOAuthError(
      503,
      'Google Calendar sign-in is not set up on this server yet (GOOGLE_CALENDAR_CLIENT_ID / GOOGLE_CALENDAR_CLIENT_SECRET / APP_URL).'
    );
  }
  return c;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const stateKey = (state: string) => crypto.createHash('sha256').update(state).digest('hex');

interface GoogleTokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
}

async function tokenRequest(body: Record<string, string>): Promise<GoogleTokenResponse> {
  const c = requireConfig();
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: c.clientId, client_secret: c.clientSecret, ...body }).toString(),
  });
  const data = (await res.json().catch(() => ({}))) as GoogleTokenResponse;
  if (!res.ok && !data.error) data.error = `http_${res.status}`;
  return data;
}

function describeGoogleError(d: GoogleTokenResponse): string {
  if (d.error === 'invalid_grant') return 'Google Calendar access was revoked or expired. Connect Google Calendar again.';
  if (d.error === 'redirect_uri_mismatch') {
    return 'Google rejected the redirect address. Add the callback URL to the OAuth client in Google Cloud.';
  }
  if (d.error === 'invalid_client') return 'Google rejected the OAuth client ID/secret configured on the server.';
  return d.error_description || d.error || 'Google sign-in failed.';
}

function decodeIdToken(idToken?: string): Record<string, any> {
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1] || '', 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

export async function startGoogleCalendarOAuth(ctx: TenantContext): Promise<{ authorizationUrl: string }> {
  if (!isFirebaseConfigured || !db) throw new GoogleCalendarOAuthError(503, 'Database is not configured');
  const c = requireConfig();

  const state = b64url(crypto.randomBytes(32));
  const codeVerifier = b64url(crypto.randomBytes(48));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());

  await setDoc(doc(db, STATE_COLLECTION, stateKey(state)), {
    provider: 'google_calendar',
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
    scope: SCOPES.join(' '),
    state,
    code_challenge: codeChallenge,
    code_challenge_method: 'S256',
    // offline + consent is what makes Google return a refresh token every time.
    access_type: 'offline',
    prompt: 'consent select_account',
    include_granted_scopes: 'false',
  });
  return { authorizationUrl: `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}` };
}

export interface GoogleCalendarCallbackResult {
  tenantId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
}

export async function exchangeGoogleCalendarCallback(query: URLSearchParams): Promise<GoogleCalendarCallbackResult> {
  if (!isFirebaseConfigured || !db) throw new GoogleCalendarOAuthError(503, 'Database is not configured');
  const c = requireConfig();
  const state = query.get('state') || '';
  if (!state) throw new GoogleCalendarOAuthError(400, 'Missing sign-in state. Please try again.');

  // One-time state: read and delete first so a link can never be replayed.
  const ref = doc(db, STATE_COLLECTION, stateKey(state));
  const snap = await getDoc(ref);
  await deleteDoc(ref).catch(() => {});
  const st: any = snap.exists() ? snap.data() : null;
  if (!st || st.provider !== 'google_calendar' || !st.tenantId || new Date(st.expiresAt).getTime() < Date.now()) {
    throw new GoogleCalendarOAuthError(400, 'This sign-in link has expired. Please start again from Demo Scheduling.');
  }

  if (query.get('error')) {
    const err = query.get('error') || '';
    throw new GoogleCalendarOAuthError(
      400,
      err === 'access_denied'
        ? 'Google Calendar access was not granted. Accept the calendar permissions to connect.'
        : `Google sign-in failed (${err}).`
    );
  }
  const code = query.get('code') || '';
  if (!code) throw new GoogleCalendarOAuthError(400, 'Google did not return a sign-in code. Please try again.');

  const data = await tokenRequest({
    grant_type: 'authorization_code',
    code,
    redirect_uri: c.redirectUri,
    code_verifier: st.codeVerifier,
  });
  if (data.error || !data.access_token) throw new GoogleCalendarOAuthError(400, describeGoogleError(data));
  if (!data.refresh_token) {
    throw new GoogleCalendarOAuthError(
      400,
      'Google did not grant offline access. Remove this app at myaccount.google.com/permissions, then connect again and accept all permissions.'
    );
  }

  const claims = decodeIdToken(data.id_token);
  const email = String(claims.email || '').trim().toLowerCase();

  return {
    tenantId: String(st.tenantId),
    email,
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
  };
}

// Access tokens are short lived; keep them per workspace in memory and renew with the refresh token.
const accessCache = new Map<string, { token: string; expiresAt: number }>();

export async function saveGoogleCalendarConnection(
  tenantId: string,
  refreshToken: string,
  email: string,
  accessToken?: string,
  expiresIn?: number
) {
  const now = new Date().toISOString();
  await setDoc(
    tenantRepo(sysCtx(tenantId)).secretDoc(GOOGLE_CALENDAR_SECRET_NAME),
    {
      name: GOOGLE_CALENDAR_SECRET_NAME,
      ...encryptSecret(JSON.stringify({ refreshToken, email })),
      createdAt: now,
      updatedAt: now,
    },
    { merge: false }
  );
  // Replace any old popup token / expired flag so the status screen starts clean.
  await setDoc(
    tenantRepo(sysCtx(tenantId)).settingsDoc('calendar_auth'),
    {
      accessToken: null,
      email: email || null,
      provider: 'google',
      active: true,
      expired: false,
      expiredAt: null,
      refreshTokenStored: true,
      updatedAt: now,
    },
    { merge: true }
  ).catch(() => {});
  if (accessToken) accessCache.set(tenantId, { token: accessToken, expiresAt: Date.now() + (expiresIn || 3600) * 1000 });
  else accessCache.delete(tenantId);
}

export async function deleteGoogleCalendarConnection(tenantId: string) {
  accessCache.delete(tenantId);
  await deleteDoc(tenantRepo(sysCtx(tenantId)).secretDoc(GOOGLE_CALENDAR_SECRET_NAME)).catch(() => {});
  await setDoc(
    tenantRepo(sysCtx(tenantId)).settingsDoc('calendar_auth'),
    { accessToken: null, active: false, refreshTokenStored: false, updatedAt: new Date().toISOString() },
    { merge: true }
  ).catch(() => {});
}

async function readSecret(tenantId: string): Promise<{ refreshToken: string; email?: string } | null> {
  if (!isFirebaseConfigured || !db) return null;
  const snap = await getDoc(tenantRepo(sysCtx(tenantId)).secretDoc(GOOGLE_CALENDAR_SECRET_NAME));
  if (!snap.exists()) return null;
  try {
    const parsed = JSON.parse(decryptSecret(snap.data() as any));
    return parsed?.refreshToken ? { refreshToken: parsed.refreshToken, email: parsed.email } : null;
  } catch {
    return null;
  }
}

export async function hasGoogleCalendarRefreshToken(tenantId: string): Promise<boolean> {
  return Boolean(await readSecret(tenantId));
}

export async function getGoogleCalendarConnectedEmail(tenantId: string): Promise<string> {
  return (await readSecret(tenantId))?.email || '';
}

/** Drops the cached access token so the next call renews it (used after a 401 from the Calendar API). */
export function invalidateGoogleCalendarAccessToken(tenantId: string) {
  accessCache.delete(tenantId);
}

/**
 * Returns a valid access token for the workspace, renewing it with the saved refresh token when needed.
 * Returns null when this workspace has not connected through the server flow (caller falls back to the old path).
 * Throws GoogleCalendarReauthRequired when Google says the saved sign-in is no longer valid.
 */
export async function getGoogleCalendarAccessToken(tenantId: string): Promise<string | null> {
  const cached = accessCache.get(tenantId);
  if (cached && cached.expiresAt - 2 * 60_000 > Date.now()) return cached.token;

  const secret = await readSecret(tenantId);
  if (!secret) return null;
  if (!isGoogleCalendarOAuthConfigured()) return null;

  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: secret.refreshToken });
  if (data.error || !data.access_token) {
    if (data.error === 'invalid_grant') {
      accessCache.delete(tenantId);
      // Refresh token is dead: remember it so the screen shows "Reconnect" instead of failing silently.
      await setDoc(
        tenantRepo(sysCtx(tenantId)).settingsDoc('calendar_auth'),
        { expired: true, active: false, expiredAt: new Date().toISOString(), updatedAt: new Date().toISOString() },
        { merge: true }
      ).catch(() => {});
      throw new GoogleCalendarReauthRequired(describeGoogleError(data));
    }
    throw new Error(describeGoogleError(data));
  }
  accessCache.set(tenantId, { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  return data.access_token;
}

export function googleCalendarRedirectUrl(result: 'connected' | 'error', message?: string): string {
  const { appUrl } = config();
  const params = new URLSearchParams({ calendar: result === 'connected' ? 'google' : 'error' });
  if (message) params.set('calendar_message', message.slice(0, 300));
  return `${appUrl || ''}/?${params.toString()}`;
}
