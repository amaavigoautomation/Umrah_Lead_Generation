import { Resend } from 'resend';
import { db, doc, getDoc, setDoc } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Per-tenant sending identity.
 * Stored at tenants/{id}/settings/email. Domain ownership is claimed globally in email_domains/{domain}
 * so two workspaces can never register the same domain.
 */

export type TenantDomainStatus = 'not_started' | 'pending' | 'verified' | 'failed' | 'partially_verified' | 'partially_failed';

export interface TenantDnsRecord {
  record: string;
  type: string;
  name: string;
  value: string;
  ttl?: string;
  priority?: number;
  status?: string;
}

export interface TenantEmailSettings {
  domain?: string;
  resendDomainId?: string;
  status?: TenantDomainStatus;
  records?: TenantDnsRecord[];
  fromName?: string;
  fromLocalPart?: string; // the part before @, e.g. "sales"
  replyTo?: string;
  verifiedAt?: string;
  updatedAt?: string;
}

export type SenderResolution =
  | { ok: true; from: string; replyTo?: string; source: 'tenant' | 'platform' }
  | { ok: false; error: string };

const DOMAIN_RE = /^(?!-)([a-z0-9-]{1,63}\.)+[a-z]{2,}$/;
const LOCAL_RE = /^[a-z0-9._+-]{1,64}$/;

function getApiKey(): string {
  return (process.env.RESEND_API_KEY || '').trim();
}

let client: Resend | null = null;
let clientKey = '';
function resendClient(): Resend {
  const key = getApiKey();
  if (!key) throw new Error('RESEND_API_KEY is not configured on the platform');
  if (!client || clientKey !== key) {
    client = new Resend(key);
    clientKey = key;
  }
  return client;
}

/** Tenants that may keep using the platform-wide RESEND_FROM while they verify their own domain. */
function platformSenderTenants(): string[] {
  return (process.env.PLATFORM_SENDER_TENANTS || '')
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
}

const settingsCache = new Map<string, { at: number; value: TenantEmailSettings }>();
const CACHE_MS = 30_000;

export async function getTenantEmailSettings(tenantId: string, opts: { fresh?: boolean } = {}): Promise<TenantEmailSettings> {
  const cached = settingsCache.get(tenantId);
  if (!opts.fresh && cached && Date.now() - cached.at < CACHE_MS) return cached.value;
  if (!isFirebaseConfigured || !db) return {};
  const repo = tenantRepo({ tenantId } as TenantContext);
  const snap = await getDoc(repo.settingsDoc('email'));
  const value = (snap.exists() ? (snap.data() as TenantEmailSettings) : {}) || {};
  settingsCache.set(tenantId, { at: Date.now(), value });
  return value;
}

/** Seeds the in-memory cache (used after writes, and by tests). */
export function cacheTenantEmailSettings(tenantId: string, value: TenantEmailSettings) {
  settingsCache.set(tenantId, { at: Date.now(), value });
}

async function saveSettings(tenantId: string, patch: Partial<TenantEmailSettings>): Promise<TenantEmailSettings> {
  const repo = tenantRepo({ tenantId } as TenantContext);
  const current = await getTenantEmailSettings(tenantId, { fresh: true });
  const next: TenantEmailSettings = { ...current, ...patch, updatedAt: new Date().toISOString() };
  // Firestore rejects undefined values.
  const clean = JSON.parse(JSON.stringify(next));
  await setDoc(repo.settingsDoc('email'), clean, { merge: false });
  settingsCache.set(tenantId, { at: Date.now(), value: clean });
  return clean;
}

function formatFrom(name: string | undefined, address: string): string {
  const n = (name || '').replace(/["<>\r\n]/g, '').trim();
  return n ? `${n} <${address}>` : address;
}

function mapRecords(records: any[] | undefined): TenantDnsRecord[] {
  return (records || [])
    // Sending needs SPF + DKIM. Receiving (MX) / tracking records are not part of Phase 1.
    .filter((r) => r.record === 'SPF' || r.record === 'DKIM')
    .map((r) => ({
      record: r.record,
      type: r.type,
      name: r.name,
      value: r.value,
      ttl: r.ttl,
      priority: r.priority,
      status: r.status,
    }));
}

/** Public view for the UI: never exposes anything secret. */
export async function getEmailSettingsView(tenantId: string) {
  const s = await getTenantEmailSettings(tenantId, { fresh: true });
  const grandfathered = platformSenderTenants().includes(tenantId);
  const canSend = s.status === 'verified' && Boolean(s.domain && s.fromLocalPart);
  return {
    ...s,
    fromAddress: s.domain && s.fromLocalPart ? `${s.fromLocalPart}@${s.domain}` : undefined,
    canSend,
    usingPlatformSender: !canSend && grandfathered,
    resendConfigured: Boolean(getApiKey()),
  };
}

export async function addTenantDomain(tenantId: string, rawDomain: string) {
  const domain = String(rawDomain || '').toLowerCase().trim().replace(/^@/, '');
  if (!DOMAIN_RE.test(domain)) throw new HttpError(400, 'Enter a valid domain such as yourcompany.com');

  const existing = await getTenantEmailSettings(tenantId, { fresh: true });
  if (existing.domain && existing.domain !== domain && existing.status === 'verified') {
    throw new HttpError(409, 'Remove the current verified domain before adding another one');
  }

  // Claim the domain globally.
  const claimRef = doc(db, 'email_domains', domain);
  const claim = await getDoc(claimRef);
  if (claim.exists() && claim.data()?.tenantId && claim.data()?.tenantId !== tenantId) {
    throw new HttpError(409, 'This domain is already registered by another workspace');
  }

  const resend = resendClient();
  let id = existing.domain === domain ? existing.resendDomainId : undefined;
  let status: TenantDomainStatus = 'pending';
  let records: any[] = [];

  if (id) {
    const got = await resend.domains.get(id);
    if (got.error || !got.data) throw new HttpError(502, `Resend: ${got.error?.message || 'could not load domain'}`);
    status = got.data.status as TenantDomainStatus;
    records = got.data.records as any[];
  } else {
    const created = await resend.domains.create({ name: domain, capabilities: { sending: 'enabled' } } as any);
    if (created.error || !created.data) {
      const code = Number((created.error as any)?.statusCode);
      throw new HttpError(code >= 400 && code < 500 ? 400 : 502, `Resend: ${created.error?.message || 'could not create domain'}`);
    }
    id = created.data.id;
    status = created.data.status as TenantDomainStatus;
    records = created.data.records as any[];
  }

  await setDoc(claimRef, { domain, tenantId, resendDomainId: id, createdAt: new Date().toISOString() }, { merge: true });
  return saveSettings(tenantId, {
    domain,
    resendDomainId: id,
    status,
    records: mapRecords(records),
    ...(status === 'verified' ? { verifiedAt: new Date().toISOString() } : {}),
  });
}

export async function verifyTenantDomain(tenantId: string) {
  const s = await getTenantEmailSettings(tenantId, { fresh: true });
  if (!s.resendDomainId) throw new HttpError(400, 'Add a domain first');
  const resend = resendClient();
  // Ask Resend to re-check DNS, then read back the result.
  const ver = await resend.domains.verify(s.resendDomainId);
  if (ver.error) throw new HttpError(502, `Resend: ${ver.error.message}`);
  const got = await resend.domains.get(s.resendDomainId);
  if (got.error || !got.data) throw new HttpError(502, `Resend: ${got.error?.message || 'could not load domain'}`);
  const status = got.data.status as TenantDomainStatus;
  return saveSettings(tenantId, {
    status,
    records: mapRecords(got.data.records as any[]),
    ...(status === 'verified' && s.status !== 'verified' ? { verifiedAt: new Date().toISOString() } : {}),
  });
}

export async function setTenantSender(tenantId: string, input: { fromName?: string; fromLocalPart?: string; replyTo?: string }) {
  const s = await getTenantEmailSettings(tenantId, { fresh: true });
  if (!s.domain) throw new HttpError(400, 'Add a domain first');
  const local = String(input.fromLocalPart || '').toLowerCase().trim().split('@')[0];
  if (!LOCAL_RE.test(local)) throw new HttpError(400, 'Enter the part before the @ (letters, numbers, . _ + -)');
  const replyTo = String(input.replyTo || '').trim();
  if (replyTo && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(replyTo)) throw new HttpError(400, 'Reply-to must be a valid email address');
  return saveSettings(tenantId, {
    fromName: String(input.fromName || '').replace(/["<>\r\n]/g, '').trim().slice(0, 80),
    fromLocalPart: local,
    replyTo,
  });
}

/**
 * Decides who an email from this workspace may be sent as.
 * - verified domain + sender configured -> that sender
 * - tenant listed in PLATFORM_SENDER_TENANTS -> the platform RESEND_FROM (transition period)
 * - anything else -> blocked
 */
export async function resolveTenantSender(tenantId: string): Promise<SenderResolution> {
  const defaultPlatformFrom = (process.env.RESEND_FROM || '').trim() || 'Umrah360 <sales@umrah360.in>';
  let s: TenantEmailSettings = {};
  try {
    s = await getTenantEmailSettings(tenantId);
  } catch (err: any) {
    // If settings can't be read from Firestore but it's the primary platform tenant, use the default platform sender
    if (tenantId === 'umrah360' || tenantId === 'default' || !tenantId) {
      return { ok: true, from: defaultPlatformFrom, source: 'platform' };
    }
    return { ok: false, error: `Could not load email settings: ${err?.message || 'unknown error'}` };
  }

  if (s.status === 'verified' && s.domain && s.fromLocalPart) {
    return {
      ok: true,
      from: formatFrom(s.fromName, `${s.fromLocalPart}@${s.domain}`),
      replyTo: s.replyTo || undefined,
      source: 'tenant',
    };
  }

  if (platformSenderTenants().includes(tenantId) || tenantId === 'umrah360' || tenantId === 'default' || !tenantId) {
    return { ok: true, from: defaultPlatformFrom, source: 'platform' };
  }

  if (s.domain && s.status !== 'verified') {
    return { ok: false, error: `Sending is blocked: your domain ${s.domain} is not verified yet. Open Settings → Email and verify it.` };
  }
  return { ok: false, error: 'Sending is blocked: this workspace has no verified sending domain. Open Settings → Email to add one.' };
}

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}
