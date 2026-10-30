import {
  signInWithEmailAndPassword,
  signOut,
  onAuthStateChanged,
  sendPasswordResetEmail,
  type User as FirebaseUser,
} from 'firebase/auth';
import { doc, getDoc, terminate, clearIndexedDbPersistence } from 'firebase/firestore';
import { auth, db, isFirebaseConfigured } from '../firebase/config';
import type { AppUser, AuditModule } from '../types';
import { logAuditEvent } from './auditService';

export interface SessionInfo {
  appUser: AppUser;
  tenantId: string | null; // null for platform admins (they have no workspace)
  isPlatformAdmin: boolean;
  isTenantAdmin: boolean;
}

const DEFAULT_MODULES = ['inbox', 'campaigns', 'crm', 'scheduling', 'knowledge', 'settings'];

export async function signIn(email: string, password: string): Promise<void> {
  await signInWithEmailAndPassword(auth, email.trim(), password);
}

export async function signOutUser(): Promise<void> {
  await signOut(auth);
  // Wipe this browser's local Firestore copy, so the next person on this computer never sees the
  // previous user's data. Firestore must be stopped before its cache can be cleared, so the page reloads
  // afterwards (back to the sign-in screen with a fresh Firestore).
  if (typeof window !== 'undefined' && isFirebaseConfigured && db) {
    try {
      await terminate(db);
      await clearIndexedDbPersistence(db);
    } catch (err) {
      console.warn('[Auth] Could not clear the local Firestore cache:', err);
    }
    window.location.reload();
  }
}

export async function requestPasswordReset(email: string): Promise<void> {
  await sendPasswordResetEmail(auth, email.trim());
}

/** Fresh ID token (auto-refreshed by the SDK when near expiry). */
export async function getIdToken(forceRefresh = false): Promise<string | null> {
  const u = auth.currentUser;
  return u ? u.getIdToken(forceRefresh) : null;
}

/** Turn a Firebase user + its server-set claims into the app's session model. */
export async function buildSession(fbUser: FirebaseUser): Promise<SessionInfo> {
  // forceRefresh so freshly-set claims (e.g. right after an invite) are seen
  const tokenResult = await fbUser.getIdTokenResult(true);
  const claims = tokenResult.claims as { tenantId?: string; role?: string; platformAdmin?: boolean };
  const isPlatformAdmin = claims.platformAdmin === true;
  const tenantId = isPlatformAdmin ? null : claims.tenantId || null;
  const isTenantAdmin = isPlatformAdmin || claims.role === 'admin';

  let allowedModules = DEFAULT_MODULES;
  let name = fbUser.displayName || (fbUser.email || '').split('@')[0] || 'User';
  if (isFirebaseConfigured && db && !isPlatformAdmin) {
    try {
      const snap = await getDoc(doc(db, 'users', fbUser.uid));
      if (snap.exists()) {
        const d = snap.data() as any;
        if (Array.isArray(d.allowedModules) && d.allowedModules.length) allowedModules = d.allowedModules;
        if (d.name) name = d.name;
        if (d.active === false) throw new Error('This account has been deactivated.');
      }
    } catch (e: any) {
      if (e?.message?.includes('deactivated')) throw e;
      // rules may not allow the read yet; fall back to defaults
    }
  }

  const now = new Date().toISOString();
  return {
    tenantId,
    isPlatformAdmin,
    isTenantAdmin,
    appUser: {
      userId: fbUser.uid,
      email: fbUser.email || '',
      username: (fbUser.email || '').split('@')[0],
      password: '', // passwords are never held client-side
      name,
      role: isTenantAdmin ? 'ADMIN' : 'SPECIALIST',
      accessLevel: isTenantAdmin ? 'ALL' : 'CUSTOM',
      allowedModules,
      isActive: true,
      createdAt: fbUser.metadata.creationTime || now,
      updatedAt: now,
    },
  };
}

/** Subscribe to sign-in / sign-out. Callback gets null when signed out. */
export function onSession(cb: (s: SessionInfo | null, err?: Error) => void): () => void {
  return onAuthStateChanged(auth, async (fbUser) => {
    if (!fbUser) return cb(null);
    try {
      cb(await buildSession(fbUser));
    } catch (e: any) {
      await signOut(auth).catch(() => {});
      cb(null, e);
    }
  });
}

/** Human-friendly message for Firebase auth errors (no account enumeration). */
export function friendlyAuthError(e: any): string {
  const code = e?.code || '';
  if (code === 'auth/too-many-requests') return 'Too many attempts. Try again later or reset your password.';
  if (code === 'auth/user-disabled') return 'This account has been disabled.';
  if (code === 'auth/network-request-failed') return 'Network error. Check your connection.';
  if (e?.message?.includes('deactivated')) return e.message;
  return 'Invalid email or password.';
}

let fetchPatched = false;
let originalFetch: typeof window.fetch = typeof window !== 'undefined' && window.fetch ? window.fetch.bind(window) : (input, init) => fetch(input, init);

type ApiAuditDescriptor = { action: string; module: AuditModule; description: string; target?: { type: string; id: string; name?: string }; metadata?: Record<string, unknown> };

function describeApiMutation(path: string, method: string, body: any): ApiAuditDescriptor | null {
  const verb = method.toUpperCase();
  if (!['POST', 'PUT', 'PATCH', 'DELETE'].includes(verb)) return null;
  if (path === '/api/audit-logs' || path === '/api/health' || path === '/api/auth/me') return null;
  const conversationId = typeof body?.conversationId === 'string' ? body.conversationId : '';
  const leadId = typeof body?.leadId === 'string' ? body.leadId : '';
  const campaignId = typeof body?.campaignId === 'string' ? body.campaignId : '';
  const templateId = typeof body?.templateId === 'string' ? body.templateId : '';
  const target = conversationId ? { type: 'Conversation', id: conversationId } : leadId ? { type: 'Lead', id: leadId } : campaignId ? { type: 'Campaign', id: campaignId } : templateId ? { type: 'Email Template', id: templateId } : undefined;
  if (path === '/api/email/send') return { action: 'EMAIL_SENT', module: 'INBOX', description: 'An outbound email was dispatched.', target, metadata: { channel: 'EMAIL' } };
  if (path === '/api/channels/send') return { action: 'CHANNEL_MESSAGE_SENT', module: 'INBOX', description: 'An outbound channel message was dispatched.', target, metadata: { channel: body?.channel || 'UNKNOWN' } };
  if (path === '/api/whatsapp/send-template') return { action: 'WHATSAPP_TEMPLATE_SENT', module: 'INBOX', description: 'A WhatsApp template message was dispatched.', target, metadata: { templateName: body?.templateName || undefined, channel: 'WHATSAPP' } };
  if (path === '/api/conversation/ai-state') {
    const takeover = body?.humanHandoff === true || body?.aiEnabled === false;
    return { action: takeover ? 'HUMAN_HANDOFF_MANUAL' : 'AI_RESUMED_MANUAL', module: 'INBOX', description: takeover ? 'A user transferred this conversation to human handling.' : 'A user resumed AI handling for this conversation.', target, metadata: { detectionSource: body?.detectionSource || 'MANUAL' } };
  }
  if (path === '/api/human-handoff/config') return { action: 'HUMAN_HANDOFF_SETTINGS_UPDATED', module: 'SETTINGS', description: 'Human Handoff rules or phrases were updated.' };
  if (path.startsWith('/api/auto-followup') || path.startsWith('/api/auto-follow-up')) {
    const tail = path.split('/').filter(Boolean).slice(-1)[0] || 'updated';
    return { action: 'AUTO_FOLLOWUP_' + verb + '_' + tail.replace(/[^a-z0-9]+/gi, '_').toUpperCase(), module: 'AI_ENGINE', description: 'Auto Follow-Up configuration or job action completed.', target, metadata: { endpoint: path } };
  }
  if (path === '/api/campaigns' && verb === 'POST') return { action: 'CAMPAIGN_CREATED', module: 'CAMPAIGNS', description: 'A campaign was created.', target };
  const campaignAction = path.match(/^\/api\/campaigns\/([^/]+)\/(start|pause|restart|schedule|unschedule)$/);
  if (campaignAction) {
    const label = campaignAction[2].toUpperCase();
    const stateText = label === 'START' ? 'started' : label === 'PAUSE' ? 'paused' : label === 'RESTART' ? 'restarted' : label === 'SCHEDULE' ? 'scheduled' : 'unscheduled';
    return { action: 'CAMPAIGN_' + label, module: 'CAMPAIGNS', description: 'Campaign ' + campaignAction[1] + ' was ' + stateText + '.', target: { type: 'Campaign', id: campaignAction[1] } };
  }
  const campaignDelete = path.match(/^\/api\/campaigns\/([^/]+)$/);
  if (campaignDelete && verb === 'DELETE') return { action: 'CAMPAIGN_DELETED', module: 'CAMPAIGNS', description: 'A campaign was deleted.', target: { type: 'Campaign', id: campaignDelete[1] } };
  if (path.startsWith('/api/campaigns/lead/')) return { action: 'CAMPAIGN_LEAD_UPDATED', module: 'CAMPAIGNS', description: 'A campaign lead status or scheduling detail was updated.', target, metadata: { endpoint: path } };
  if (path === '/api/templates' && verb !== 'DELETE') return { action: 'EMAIL_TEMPLATE_SAVED', module: 'CAMPAIGNS', description: 'An email template was saved.', target };
  if (path.startsWith('/api/templates/') && verb === 'DELETE') return { action: 'EMAIL_TEMPLATE_DELETED', module: 'CAMPAIGNS', description: 'An email template was deleted.', target: { type: 'Email Template', id: path.split('/').pop() || 'unknown' } };
  if (path === '/api/knowledge' && verb === 'POST') return { action: 'KNOWLEDGE_DOCUMENT_SAVED', module: 'KNOWLEDGE', description: 'A knowledge base document was saved.' };
  if (path.startsWith('/api/knowledge') && verb === 'DELETE') return { action: 'KNOWLEDGE_DOCUMENT_DELETED', module: 'KNOWLEDGE', description: 'A knowledge base document was deleted.' };
  if (path === '/api/settings') return { action: 'SETTINGS_UPDATED', module: 'SETTINGS', description: 'Workspace settings were updated.' };
  if (/^\/api\/tenants\/[^/]+\/users/.test(path)) return { action: verb === 'DELETE' ? 'WORKSPACE_USER_DELETED' : verb === 'POST' ? 'WORKSPACE_USER_INVITED' : 'WORKSPACE_USER_UPDATED', module: 'SETTINGS', description: 'Workspace user access was changed.' };
  if (path.startsWith('/api/ai/')) return { action: 'AI_ENGINE_ACTION_' + verb, module: 'AI_ENGINE', description: 'An AI engine action completed.', target, metadata: { endpoint: path } };
  const segments = path.split('/').filter(Boolean).slice(1);
  let module: AuditModule = 'SYSTEM';
  if (path.includes('/crm') || path.includes('/leads') || path.includes('/contacts')) module = 'CRM';
  else if (path.includes('campaign') || path.includes('template')) module = 'CAMPAIGNS';
  else if (path.includes('knowledge')) module = 'KNOWLEDGE';
  else if (path.includes('followup') || path.includes('/ai')) module = 'AI_ENGINE';
  else if (path.includes('settings') || path.includes('oauth') || path.includes('users') || path.includes('billing')) module = 'SETTINGS';
  else if (path.includes('conversation') || path.includes('message') || path.includes('channel') || path.includes('whatsapp') || path.includes('email')) module = 'INBOX';
  const tail = segments[segments.length - 1] || 'action';
  return { action: 'API_' + verb + '_' + tail.replace(/[^a-z0-9]+/gi, '_').toUpperCase(), module, description: 'A successful ' + verb + ' action was completed through ' + path + '.', target, metadata: { endpoint: path } };
}

async function auditSuccessfulApiMutation(url: string, method: string, bodyValue: BodyInit | null | undefined, response: Response): Promise<void> {
  try {
    if (typeof window === 'undefined' || !response.ok) return;
    const path = new URL(url, window.location.origin).pathname;
    let body: any = {};
    if (typeof bodyValue === 'string') { try { body = JSON.parse(bodyValue); } catch { body = {}; } }
    const descriptor = describeApiMutation(path, method, body);
    if (!descriptor) return;
    let resultBody: any = null;
    try { resultBody = await response.clone().json(); } catch { resultBody = null; }
    if (resultBody && resultBody.success === false) return;
    const user = auth.currentUser;
    if (!user) return;
    const tokenResult = await user.getIdTokenResult().catch(() => null);
    const claims = (tokenResult?.claims || {}) as { tenantId?: string; role?: string; platformAdmin?: boolean };
    const tenantId = typeof claims.tenantId === 'string' ? claims.tenantId : '';
    if (!tenantId) return;
    void logAuditEvent(tenantId, {
      ...descriptor,
      actor: { userId: user.uid, name: user.displayName || (user.email || '').split('@')[0] || 'User', email: user.email || '', role: claims.role === 'admin' || claims.platformAdmin ? 'ADMIN' : 'MEMBER' },
      metadata: { ...(descriptor.metadata || {}), httpMethod: method.toUpperCase(), endpoint: path },
    }).catch((error) => console.error('[AuditLogs] Could not record successful API action:', error));
  } catch (error) {
    console.error('[AuditLogs] API mutation audit hook failed:', error);
  }
}

/**
 * Fetch wrapper that attaches the Firebase ID token to /api/ requests.
 */
export async function authFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
  const isApi = url.startsWith('/api/') || (typeof window !== 'undefined' && url.startsWith(`${window.location.origin}/api/`));
  if (!isApi) return originalFetch(input, init);

  const token = await getIdToken().catch(() => null);
  if (!token) return originalFetch(input, init);

  const headers = new Headers(init?.headers || (input instanceof Request ? input.headers : undefined));
  if (!headers.has('Authorization')) {
    headers.set('Authorization', `Bearer ${token}`);
  }
  const method = (init?.method || (input instanceof Request ? input.method : 'GET')).toUpperCase();
  const response = await originalFetch(input, { ...init, headers });
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(method)) void auditSuccessfulApiMutation(url, method, init?.body, response.clone());
  return response;
}

/**
 * Attach the Firebase ID token to every same-origin /api/ request.
 * Call once at startup. (Authorization carries ONLY the Firebase token; the
 * Google Calendar token goes in X-Google-Access-Token.)
 */
export function installAuthFetch(): void {
  if (fetchPatched || typeof window === 'undefined') return;
  fetchPatched = true;

  try {
    const original = (window.fetch || globalThis.fetch).bind(window);
    originalFetch = original;

    const wrappedFetch = async (input: RequestInfo | URL, init?: RequestInit) => {
      return authFetch(input, init);
    };

    let installed = false;
    // 1. Try Object.defineProperty on window (safely overrides getter on Window.prototype)
    try {
      Object.defineProperty(window, 'fetch', {
        value: wrappedFetch,
        writable: true,
        configurable: true,
        enumerable: true,
      });
      installed = true;
    } catch {
      // defineProperty failed
    }

    // 2. Direct assignment fallback
    if (!installed) {
      try {
        (window as any).fetch = wrappedFetch;
        installed = true;
      } catch {
        // Direct assignment failed
      }
    }

    // 3. Fallback on globalThis
    if (!installed && typeof globalThis !== 'undefined') {
      try {
        Object.defineProperty(globalThis, 'fetch', {
          value: wrappedFetch,
          writable: true,
          configurable: true,
          enumerable: true,
        });
      } catch {
        try {
          (globalThis as any).fetch = wrappedFetch;
        } catch {
          // ignore
        }
      }
    }
  } catch (err) {
    console.warn('[authService] Could not patch global fetch:', err);
  }
}