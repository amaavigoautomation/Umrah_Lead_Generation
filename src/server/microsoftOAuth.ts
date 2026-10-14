import crypto from 'node:crypto';
import { db, doc, getDoc, setDoc, deleteDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { tenantRepo } from './tenantRepo.js';
import { encryptSecret, decryptSecret } from './cryptoUtils.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * "Sign in with Microsoft" for the inbound mailbox (Outlook.com and Microsoft 365).
 *
 * Microsoft no longer accepts passwords (or app passwords) for IMAP, so the mailbox is read with an OAuth2
 * access token (IMAP XOAUTH2). We keep only the refresh token, encrypted, and mint short-lived access tokens
 * from it before each check.
 *
 *   OAuth state (single use):  oauth_states/{sha256(state)}            server only, expires after 10 minutes
 *   Refresh token (encrypted): tenants/{id}/secrets/imap_oauth_microsoft
 *
 * Env:
 *   MICROSOFT_CLIENT_ID, MICROSOFT_CLIENT_SECRET   (Entra app registration, "Accounts in any organizational
 *                                                   directory and personal Microsoft accounts")
 *   MICROSOFT_REDIRECT_URI   default: ${APP_URL}/api/oauth/microsoft/callback
 *   MICROSOFT_AUTH_TENANT    default: common
 */

export const MICROSOFT_IMAP_HOST = 'outlook.office365.com';
export const MICROSOFT_SECRET_NAME = 'imap_oauth_microsoft';
const STATE_COLLECTION = 'oauth_states';
const STATE_TTL_MS = 10 * 60_000;
const SCOPES = ['https://outlook.office.com/IMAP.AccessAsUser.All', 'offline_access', 'openid', 'email', 'profile'];

/** The stored sign-in no longer works (password changed, access revoked, consent removed, token expired). */
export class MicrosoftReauthRequired extends Error {
  constructor(message = 'Microsoft sign-in has expired or was revoked. Click "Reconnect with Microsoft".') {
    super(message);
  }
}

export class MicrosoftOAuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

const sysCtx = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: '', role: 'admin' });

function config() {
  const clientId = (process.env.MICROSOFT_CLIENT_ID || '').trim();
  const clientSecret = (process.env.MICROSOFT_CLIENT_SECRET || '').trim();
  const appUrl = (process.env.APP_URL || '').trim().replace(/\/+$/, '');
  const redirectUri = (process.env.MICROSOFT_REDIRECT_URI || (appUrl ? `${appUrl}/api/oauth/microsoft/callback` : '')).trim();
  const authTenant = (process.env.MICROSOFT_AUTH_TENANT || 'common').trim();
  return { clientId, clientSecret, redirectUri, authTenant, appUrl };
}

export function isMicrosoftOAuthConfigured(): boolean {
  const c = config();
  return Boolean(c.clientId && c.clientSecret && c.redirectUri);
}

function requireConfig() {
  const c = config();
  if (!c.clientId || !c.clientSecret || !c.redirectUri) {
    throw new MicrosoftOAuthError(503, 'Sign in with Microsoft is not set up on this server yet (MICROSOFT_CLIENT_ID / MICROSOFT_CLIENT_SECRET / APP_URL).');
  }
  return c;
}

const b64url = (buf: Buffer) => buf.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
const stateKey = (state: string) => crypto.createHash('sha256').update(state).digest('hex');

// ---------------------------------------------------------------------------
// Start: returns the Microsoft sign-in URL
// ---------------------------------------------------------------------------

export async function startMicrosoftInboundOAuth(
  ctx: TenantContext,
  opts: { processNewInquiries?: boolean } = {}
): Promise<{ authorizationUrl: string }> {
  if (!isFirebaseConfigured || !db) throw new MicrosoftOAuthError(503, 'Database is not configured');
  const c = requireConfig();

  const state = b64url(crypto.randomBytes(32));
  const codeVerifier = b64url(crypto.randomBytes(48));
  const codeChallenge = b64url(crypto.createHash('sha256').update(codeVerifier).digest());

  await setDoc(doc(db, STATE_COLLECTION, stateKey(state)), {
    provider: 'microsoft_inbound',
    tenantId: ctx.tenantId,
    uid: ctx.uid,
    codeVerifier,
    processNewInquiries: typeof opts.processNewInquiries === 'boolean' ? opts.processNewInquiries : null,
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
  return { authorizationUrl: `https://login.microsoftonline.com/${encodeURIComponent(c.authTenant)}/oauth2/v2.0/authorize?${params.toString()}` };
}

// ---------------------------------------------------------------------------
// Token endpoint
// ---------------------------------------------------------------------------

interface TokenResponse {
  access_token?: string;
  refresh_token?: string;
  id_token?: string;
  expires_in?: number;
  error?: string;
  error_description?: string;
  error_codes?: number[];
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

/** Turns Microsoft's error into something a customer can act on. */
export function describeMicrosoftError(data: TokenResponse): string {
  const d = String(data.error_description || '');
  if (/AADSTS65001|AADSTS90094|admin.*(consent|approval)|needs permission/i.test(d)) {
    return 'Your Microsoft 365 administrator needs to approve this app before mailboxes can be connected. Ask your IT admin to grant consent, then try again.';
  }
  if (/AADSTS50020|AADSTS50034|does not exist/i.test(d)) return 'That Microsoft account could not be found. Check you picked the right account.';
  if (/AADSTS70008|AADSTS700082|AADSTS50173|AADSTS50076|AADSTS50079|expired|revoked/i.test(d)) {
    return 'Microsoft sign-in has expired or was revoked. Click "Reconnect with Microsoft".';
  }
  if (data.error === 'access_denied') return 'Microsoft sign-in was cancelled.';
  return `Microsoft sign-in failed${data.error ? ` (${data.error})` : ''}.`;
}

function decodeIdToken(idToken?: string): Record<string, any> {
  // Received directly from Microsoft's token endpoint over TLS, so its claims are trusted without re-verifying.
  if (!idToken) return {};
  try {
    return JSON.parse(Buffer.from(idToken.split('.')[1] || '', 'base64url').toString('utf8'));
  } catch {
    return {};
  }
}

// ---------------------------------------------------------------------------
// Callback: exchanges the code. The caller then tests IMAP and saves the mailbox.
// ---------------------------------------------------------------------------

export interface MicrosoftCallbackResult {
  tenantId: string;
  email: string;
  refreshToken: string;
  accessToken: string;
  expiresIn: number;
  processNewInquiries: boolean | null;
}

export async function exchangeMicrosoftCallback(query: URLSearchParams): Promise<MicrosoftCallbackResult> {
  if (!isFirebaseConfigured || !db) throw new MicrosoftOAuthError(503, 'Database is not configured');
  const c = requireConfig();
  const state = query.get('state') || '';
  if (!state) throw new MicrosoftOAuthError(400, 'Missing sign-in state. Please try again.');

  const ref = doc(db, STATE_COLLECTION, stateKey(state));
  const snap = await getDoc(ref);
  // Single use: delete before doing anything else.
  await deleteDoc(ref).catch(() => {});
  const st: any = snap.exists() ? snap.data() : null;
  if (!st || st.provider !== 'microsoft_inbound' || !st.tenantId || new Date(st.expiresAt).getTime() < Date.now()) {
    throw new MicrosoftOAuthError(400, 'This sign-in link has expired. Please start again from Settings.');
  }

  if (query.get('error')) {
    throw new MicrosoftOAuthError(400, describeMicrosoftError({ error: query.get('error') || undefined, error_description: query.get('error_description') || undefined }));
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
  if (!data.refresh_token) throw new MicrosoftOAuthError(400, 'Microsoft did not grant offline access. Please try again and accept all permissions.');

  const claims = decodeIdToken(data.id_token);
  // Prefer a real mailbox address. preferred_username / unique_name can be a phone or alias without @.
  const emailCandidates = [claims.email, claims.preferred_username, claims.upn, claims.unique_name]
    .map((v) => String(v || '').trim().toLowerCase())
    .filter((v) => v.includes('@'));
  const email = emailCandidates[0] || '';
  if (!email) throw new MicrosoftOAuthError(400, 'Could not read the mailbox address from your Microsoft account.');

  return {
    tenantId: String(st.tenantId),
    email,
    refreshToken: data.refresh_token,
    accessToken: data.access_token,
    expiresIn: Number(data.expires_in) || 3600,
    processNewInquiries: typeof st.processNewInquiries === 'boolean' ? st.processNewInquiries : null,
  };
}

// ---------------------------------------------------------------------------
// Stored refresh token + access-token cache
// ---------------------------------------------------------------------------

const accessCache = new Map<string, { token: string; expiresAt: number }>();

export async function saveMicrosoftRefreshToken(tenantId: string, refreshToken: string, accessToken?: string, expiresIn?: number) {
  const now = new Date().toISOString();
  await setDoc(
    tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_SECRET_NAME),
    { name: MICROSOFT_SECRET_NAME, ...encryptSecret(JSON.stringify({ refreshToken })), createdAt: now, updatedAt: now },
    { merge: false }
  );
  if (accessToken) accessCache.set(tenantId, { token: accessToken, expiresAt: Date.now() + (expiresIn || 3600) * 1000 });
  else accessCache.delete(tenantId);
}

export async function deleteMicrosoftRefreshToken(tenantId: string) {
  accessCache.delete(tenantId);
  await deleteDoc(tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_SECRET_NAME)).catch(() => {});
}

export async function hasMicrosoftRefreshToken(tenantId: string): Promise<boolean> {
  if (!isFirebaseConfigured || !db) return false;
  return (await getDoc(tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_SECRET_NAME))).exists();
}

async function readRefreshToken(tenantId: string): Promise<string | null> {
  const snap = await getDoc(tenantRepo(sysCtx(tenantId)).secretDoc(MICROSOFT_SECRET_NAME));
  if (!snap.exists()) return null;
  try {
    return JSON.parse(decryptSecret(snap.data() as any)).refreshToken || null;
  } catch {
    return null;
  }
}

/**
 * A valid access token for the workspace's Microsoft mailbox.
 * Throws MicrosoftReauthRequired when the user must sign in again; any other throw is temporary.
 */
export async function getMicrosoftAccessToken(tenantId: string): Promise<string> {
  const cached = accessCache.get(tenantId);
  if (cached && cached.expiresAt - 5 * 60_000 > Date.now()) return cached.token;

  const refreshToken = await readRefreshToken(tenantId);
  if (!refreshToken) throw new MicrosoftReauthRequired('The saved Microsoft sign-in could not be read. Click "Reconnect with Microsoft".');

  const data = await tokenRequest({ grant_type: 'refresh_token', refresh_token: refreshToken, scope: SCOPES.join(' ') });
  if (data.error || !data.access_token) {
    if (data.error === 'invalid_grant' || data.error === 'interaction_required' || data.error === 'consent_required') {
      accessCache.delete(tenantId);
      throw new MicrosoftReauthRequired(describeMicrosoftError(data));
    }
    throw new Error(describeMicrosoftError(data)); // network / Microsoft outage: retry later
  }
  accessCache.set(tenantId, { token: data.access_token, expiresAt: Date.now() + (Number(data.expires_in) || 3600) * 1000 });
  // Microsoft may rotate the refresh token: keep the newest one. A failed write would strand the mailbox on the next refresh.
  if (data.refresh_token && data.refresh_token !== refreshToken) {
    try {
      await saveMicrosoftRefreshToken(tenantId, data.refresh_token, data.access_token, data.expires_in);
    } catch (err: any) {
      console.error('[Microsoft OAuth] Failed to persist rotated refresh token:', err?.message || err);
      throw new Error('Could not save the refreshed Microsoft sign-in. Please reconnect the mailbox.');
    }
  }
  return data.access_token;
}

/** Where to send the browser after the callback. */
export function mailboxRedirectUrl(result: 'connected' | 'error', message?: string): string {
  const { appUrl } = config();
  const params = new URLSearchParams({ mailbox: result });
  if (message) params.set('mailbox_message', message.slice(0, 300));
  return `${appUrl || ''}/?${params.toString()}`;
}
