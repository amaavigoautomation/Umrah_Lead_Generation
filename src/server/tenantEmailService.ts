import { Resend } from 'resend';
import { db, doc, getDoc, setDoc, deleteDoc } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { getConnectedMailboxAddress } from './tenantInboundService.js';
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
  /** Open/click tracking for campaign emails. Missing = ON (the default for every workspace). */
  trackingEnabled?: boolean;
  /** Optional DNS records Resend gives for its tracking subdomain (not needed for sending). */
  trackingRecords?: TenantDnsRecord[];
  trackingStatus?: string;
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

function mapTrackingRecords(records: any[] | undefined): TenantDnsRecord[] {
  return (records || [])
    .filter((r) => r.record === 'Tracking' || r.record === 'TrackingCAA')
    .map((r) => ({ record: r.record, type: r.type, name: r.name, value: r.value, ttl: r.ttl, status: r.status }));
}

/**
 * Sending only needs SPF + DKIM. Once tracking is on, Resend also lists tracking records, and while those are
 * pending it may report the whole domain as "partially_verified". That must never block sending, so the
 * status we store is "verified" whenever every SPF/DKIM record is verified.
 */
function sendingStatus(rawStatus: TenantDomainStatus, records: any[] | undefined): TenantDomainStatus {
  if (rawStatus === 'verified') return rawStatus;
  const sending = (records || []).filter((r) => r.record === 'SPF' || r.record === 'DKIM');
  const hasDkim = sending.some((r) => r.record === 'DKIM');
  if (hasDkim && sending.every((r) => r.status === 'verified')) return 'verified';
  return rawStatus;
}

function trackingStatusOf(records: any[] | undefined): string | undefined {
  const t = (records || []).find((r) => r.record === 'Tracking');
  return t ? String(t.status || 'pending') : undefined;
}

export const isTrackingEnabled = (s: TenantEmailSettings) => s.trackingEnabled !== false;

/**
 * Turns Resend's open + click tracking on/off for the domain, so workspaces never have to open Resend.
 * Best effort: a failure here is logged and never blocks adding/verifying the domain.
 */
async function applyResendTracking(domainId: string, on: boolean, current?: { open_tracking?: boolean; click_tracking?: boolean }): Promise<boolean> {
  if (current && current.open_tracking === on && current.click_tracking === on) return false;
  try {
    const res = await resendClient().domains.update({ id: domainId, openTracking: on, clickTracking: on });
    if (res.error) {
      console.warn(`[Tenant Email] could not ${on ? 'enable' : 'disable'} tracking for ${domainId}: ${res.error.message}`);
      return false;
    }
    return true;
  } catch (err: any) {
    console.warn(`[Tenant Email] tracking update failed for ${domainId}:`, err?.message || err);
    return false;
  }
}

/** Reads the domain from Resend, switching tracking to the workspace's setting first if it differs. */
async function loadDomainSyncingTracking(s: TenantEmailSettings, domainId: string) {
  const resend = resendClient();
  let got = await resend.domains.get(domainId);
  if (!got.error && got.data) {
    const changed = await applyResendTracking(domainId, isTrackingEnabled(s), got.data as any);
    if (changed) {
      const again = await resend.domains.get(domainId);
      if (!again.error && again.data) got = again;
    }
  }
  return got;
}

/** Workspace switch: "Track opens and clicks". Saved here and applied to the domain in Resend. */
export async function setTenantTracking(tenantId: string, enabled: boolean) {
  const s = await getTenantEmailSettings(tenantId, { fresh: true });
  const on = enabled !== false;
  let patch: Partial<TenantEmailSettings> = { trackingEnabled: on };
  if (s.resendDomainId) {
    await applyResendTracking(s.resendDomainId, on);
    const got = await resendClient().domains.get(s.resendDomainId).catch(() => null);
    if (got && !got.error && got.data) {
      patch = { ...patch, trackingRecords: mapTrackingRecords(got.data.records as any[]), trackingStatus: trackingStatusOf(got.data.records as any[]) };
    }
  }
  await saveSettings(tenantId, patch);
  return getEmailSettingsView(tenantId);
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
    trackingEnabled: isTrackingEnabled(s),
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

  const trackingOn = isTrackingEnabled(existing);
  if (id) {
    const got = await loadDomainSyncingTracking(existing, id);
    if (got.error || !got.data) throw new HttpError(502, `Resend: ${got.error?.message || 'could not load domain'}`);
    status = got.data.status as TenantDomainStatus;
    records = got.data.records as any[];
  } else {
    // Open + click tracking are switched on right here, so a new workspace never has to visit Resend.
    const created = await resend.domains.create({
      name: domain,
      capabilities: { sending: 'enabled' },
      openTracking: trackingOn,
      clickTracking: trackingOn,
    } as any);
    if (created.error || !created.data) {
      const code = Number((created.error as any)?.statusCode);
      throw new HttpError(code >= 400 && code < 500 ? 400 : 502, `Resend: ${created.error?.message || 'could not create domain'}`);
    }
    id = created.data.id;
    status = created.data.status as TenantDomainStatus;
    records = created.data.records as any[];
  }

  await setDoc(claimRef, { domain, tenantId, resendDomainId: id, createdAt: new Date().toISOString() }, { merge: true });
  status = sendingStatus(status, records);
  return saveSettings(tenantId, {
    domain,
    resendDomainId: id,
    status,
    records: mapRecords(records),
    trackingRecords: mapTrackingRecords(records),
    trackingStatus: trackingStatusOf(records),
    ...(status === 'verified' ? { verifiedAt: new Date().toISOString() } : {}),
  });
}

/**
 * Reads the domain's CURRENT status from Resend and saves it. Unlike verifyTenantDomain this does not ask
 * Resend to re-check DNS, so it never restarts a verification that is already running; it just shows
 * whatever Resend currently says (e.g. it verified on its own a minute ago).
 */
export async function refreshTenantDomain(tenantId: string) {
  const s = await getTenantEmailSettings(tenantId, { fresh: true });
  if (!s.resendDomainId) throw new HttpError(400, 'Add a domain first');
  const got = await loadDomainSyncingTracking(s, s.resendDomainId);
  if (got.error || !got.data) {
    const code = Number((got.error as any)?.statusCode);
    if (code === 404) throw new HttpError(404, 'This domain no longer exists in Resend. Remove it here and add it again.');
    throw new HttpError(502, `Resend: ${got.error?.message || 'could not load domain'}`);
  }
  const status = sendingStatus(got.data.status as TenantDomainStatus, got.data.records as any[]);
  return saveSettings(tenantId, {
    status,
    records: mapRecords(got.data.records as any[]),
    trackingRecords: mapTrackingRecords(got.data.records as any[]),
    trackingStatus: trackingStatusOf(got.data.records as any[]),
    ...(status === 'verified' && s.status !== 'verified' ? { verifiedAt: new Date().toISOString() } : {}),
  });
}

export async function verifyTenantDomain(tenantId: string) {
  const s = await getTenantEmailSettings(tenantId, { fresh: true });
  if (!s.resendDomainId) throw new HttpError(400, 'Add a domain first');
  const resend = resendClient();
  // Ask Resend to re-check DNS, then read back the result.
  const ver = await resend.domains.verify(s.resendDomainId);
  if (ver.error) throw new HttpError(502, `Resend: ${ver.error.message}`);
  const got = await loadDomainSyncingTracking(s, s.resendDomainId);
  if (got.error || !got.data) throw new HttpError(502, `Resend: ${got.error?.message || 'could not load domain'}`);
  const status = sendingStatus(got.data.status as TenantDomainStatus, got.data.records as any[]);
  return saveSettings(tenantId, {
    status,
    records: mapRecords(got.data.records as any[]),
    trackingRecords: mapTrackingRecords(got.data.records as any[]),
    trackingStatus: trackingStatusOf(got.data.records as any[]),
    ...(status === 'verified' && s.status !== 'verified' ? { verifiedAt: new Date().toISOString() } : {}),
  });
}

/** Domain part of the platform-wide RESEND_FROM, e.g. `Name <sales@umrah360.in>` -> `umrah360.in`. */
function platformFromDomain(): string {
  const m = (process.env.RESEND_FROM || '').match(/@([a-z0-9.-]+)/i);
  return m ? m[1].toLowerCase() : '';
}

/**
 * Removes the workspace's sending domain from Resend AND from the app.
 * Order matters: Resend first. If that fails the app keeps the domain, so the two never disagree
 * (a domain left behind in Resend would be unreachable for re-adding).
 * Refused when the domain is the one the platform itself sends from (RESEND_FROM), because deleting it in
 * Resend would stop every grandfathered workspace from sending.
 */
export async function removeTenantDomain(tenantId: string) {
  const s = await getTenantEmailSettings(tenantId, { fresh: true });
  if (!s.domain) throw new HttpError(400, 'There is no domain to remove');
  const domain = s.domain.toLowerCase();

  if (platformFromDomain() === domain) {
    throw new HttpError(409, `${domain} is the platform's own sending domain, so it can't be removed here.`);
  }

  if (s.resendDomainId) {
    const resend = resendClient();
    const res = await resend.domains.remove(s.resendDomainId);
    if (res.error) {
      const code = Number((res.error as any)?.statusCode);
      // 404 = already gone in Resend (deleted from their dashboard): carry on and clean up our side.
      if (code !== 404) throw new HttpError(502, `Resend: ${res.error.message || 'could not remove domain'}`);
    }
  }

  // Release the global claim, only if it is ours.
  try {
    const claimRef = doc(db, 'email_domains', domain);
    const claim = await getDoc(claimRef);
    if (claim.exists() && claim.data()?.tenantId === tenantId) await deleteDoc(claimRef);
  } catch (err: any) {
    console.warn('[Tenant Email] could not release domain claim:', err?.message || err);
  }

  // Keep the display name and reply-to; the sender address belongs to the domain, so it goes with it.
  await saveSettings(tenantId, {
    domain: undefined,
    resendDomainId: undefined,
    status: undefined,
    records: undefined,
    verifiedAt: undefined,
    fromLocalPart: undefined,
    trackingRecords: undefined,
    trackingStatus: undefined,
  });
  return getEmailSettingsView(tenantId);
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
  let s: TenantEmailSettings = {};
  try {
    s = await getTenantEmailSettings(tenantId);
  } catch (err: any) {
    // Cannot read settings: do not guess a sender.
    return { ok: false, error: `Could not load email settings: ${err?.message || 'unknown error'}` };
  }

  if (s.status === 'verified' && s.domain && s.fromLocalPart) {
    return {
      ok: true,
      from: formatFrom(s.fromName, `${s.fromLocalPart}@${s.domain}`),
      // An explicit Reply-To wins; otherwise replies go to the mailbox this workspace connected for inbound,
      // so customer answers land where the poller (and the team) can see them.
      replyTo: s.replyTo || (await getConnectedMailboxAddress(tenantId)) || undefined,
      source: 'tenant',
    };
  }

  if (platformSenderTenants().includes(tenantId)) {
    const platformFrom = (process.env.RESEND_FROM || '').trim();
    if (platformFrom) return { ok: true, from: platformFrom, source: 'platform' };
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