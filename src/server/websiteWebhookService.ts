import crypto from 'crypto';
import { db, getDoc, setDoc, deleteDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { tenantRepo, globalWebhookRouteDoc } from './tenantRepo.js';
import { processWebsiteLeadSubmission } from './websiteLeadService.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Self-serve website-lead webhook. One key per company:
 *  - settings doc  tenants/{id}/settings/website_webhook  { key, allowedOrigins }
 *  - routing doc   webhook_routes/{key}                    { tenantId, allowedOrigins, requireOrigin }
 * The routing doc is what the public webhook handler reads.
 */

export class WebhookSettingsError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

export interface WebhookView {
  key: string;
  path: string;
  allowedOrigins: string[];
  createdAt?: string;
}

const SETTINGS_DOC = 'website_webhook';

function newKey(tenantId: string): string {
  const slug = tenantId.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 12) || 'co';
  return `${slug}-${crypto.randomBytes(12).toString('base64url')}`;
}

/** Reduces user input ("https://Site.com/contact", "site.com") to a bare hostname. */
export function normalizeOrigin(raw: string): string | null {
  let s = String(raw || '').trim().toLowerCase();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//.test(s)) s = `https://${s}`;
  try {
    const host = new URL(s).hostname.replace(/^www\./, '');
    return /^[a-z0-9.-]+\.[a-z]{2,}$/.test(host) || host === 'localhost' ? host : null;
  } catch {
    return null;
  }
}

/** True when the request's Origin/Referer hostname is one of the allowed hostnames (or a subdomain of one). */
export function originAllowed(requestOrigin: string, allowed: string[]): boolean {
  const host = normalizeOrigin(requestOrigin);
  if (!host) return false;
  return allowed.some((a) => host === a || host.endsWith(`.${a}`));
}

function view(key: string, allowedOrigins: string[], createdAt?: string): WebhookView {
  return { key, path: `/api/webhooks/website/${key}`, allowedOrigins, createdAt };
}

async function writeRoute(tenantId: string, key: string, allowedOrigins: string[], createdAt: string) {
  await setDoc(
    globalWebhookRouteDoc(key),
    { webhookId: key, tenantId, type: 'website', allowedOrigins, requireOrigin: true, createdAt, updatedAt: new Date().toISOString() },
    { merge: false }
  );
}

function requireDb() {
  if (!isFirebaseConfigured || !db) throw new WebhookSettingsError('Database not configured', 503);
}

/** Returns the company's webhook, creating the key the first time it is asked for. */
export async function getWebhookView(tenantId: string): Promise<WebhookView> {
  requireDb();
  const ref = tenantRepo({ tenantId } as TenantContext).settingsDoc(SETTINGS_DOC);
  const snap = await getDoc(ref);
  const data = snap.exists() ? (snap.data() as any) : null;
  if (data?.key) {
    // Self-heal if the routing doc is missing (e.g. deleted by hand).
    const route = await getDoc(globalWebhookRouteDoc(data.key));
    if (!route.exists()) await writeRoute(tenantId, data.key, data.allowedOrigins || [], data.createdAt || new Date().toISOString());
    return view(data.key, data.allowedOrigins || [], data.createdAt);
  }
  const key = newKey(tenantId);
  const createdAt = new Date().toISOString();
  await writeRoute(tenantId, key, [], createdAt);
  await setDoc(ref, { key, allowedOrigins: [], createdAt }, { merge: false });
  return view(key, [], createdAt);
}

export async function setAllowedOrigins(tenantId: string, origins: unknown): Promise<WebhookView> {
  requireDb();
  if (!Array.isArray(origins)) throw new WebhookSettingsError('allowedOrigins must be a list of websites');
  const clean: string[] = [];
  for (const o of origins.slice(0, 20)) {
    const host = normalizeOrigin(String(o));
    if (!host) throw new WebhookSettingsError(`"${String(o).slice(0, 80)}" is not a valid website address`);
    if (!clean.includes(host)) clean.push(host);
  }
  const current = await getWebhookView(tenantId);
  await writeRoute(tenantId, current.key, clean, current.createdAt || new Date().toISOString());
  await setDoc(
    tenantRepo({ tenantId } as TenantContext).settingsDoc(SETTINGS_DOC),
    { key: current.key, allowedOrigins: clean, createdAt: current.createdAt, updatedAt: new Date().toISOString() },
    { merge: true }
  );
  return view(current.key, clean, current.createdAt);
}

/** New key, same allowed websites. The old key stops working immediately. */
export async function regenerateKey(tenantId: string): Promise<WebhookView> {
  requireDb();
  const current = await getWebhookView(tenantId);
  const key = newKey(tenantId);
  const createdAt = new Date().toISOString();
  await writeRoute(tenantId, key, current.allowedOrigins, createdAt);
  await setDoc(
    tenantRepo({ tenantId } as TenantContext).settingsDoc(SETTINGS_DOC),
    { key, allowedOrigins: current.allowedOrigins, createdAt, updatedAt: createdAt },
    { merge: false }
  );
  await deleteDoc(globalWebhookRouteDoc(current.key)).catch(() => {});
  return view(key, current.allowedOrigins, createdAt);
}

/** Pushes a sample lead through the same code the real webhook uses. The thank-you email goes to the admin who clicked. */
export async function sendTestLead(ctx: TenantContext) {
  requireDb();
  if (!ctx.email) throw new WebhookSettingsError('Your account has no email address to send the test to');
  const result = await processWebsiteLeadSubmission(
    {
      name: 'Webhook Test',
      email: ctx.email,
      phone: '+91 90000 00000',
      message: 'Test lead sent from Settings → Website leads. If you can see this in your inbox, your webhook works.',
    },
    ctx
  );
  return { leadId: result.lead?.leadId, thankYouEmailSent: (result as any).thankYouEmailSent };
}