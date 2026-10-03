import { collection, doc, getDoc, getDocs, setDoc, deleteDoc, increment } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { sanitizeForFirestore } from './firestoreUtils.js';
import { listResendDomains } from './resendService.js';
import type { SendingIdentity, SendingIdentityWithUsage } from '../types/index.js';

/**
 * Sending identities = from-addresses on domains verified in the (single) Resend account.
 *
 * - Each identity belongs to a client (tenant). Staff-owned identities use PLATFORM_CLIENT_ID.
 * - Campaigns rotate across the client's active identities, always picking the one with the most
 *   remaining daily capacity (so larger caps get proportionally more volume).
 * - A lead that already received mail from an identity stays on it (sticky) while it has capacity.
 * - Daily usage (UTC day) is kept in memory and mirrored to Firestore `sending_usage` with atomic increments.
 *   The in-memory counter is authoritative for the single worker process — run ONE worker instance.
 *
 * Env (optional fallback for platform mail when no identity is configured yet):
 *   RESEND_FROM_EMAIL, RESEND_FROM_NAME, RESEND_REPLY_TO
 */

export const PLATFORM_CLIENT_ID = 'platform';
export const ENV_DEFAULT_IDENTITY_ID = 'env-default';
const CACHE_TTL_MS = 15_000;
const DEFAULT_DAILY_CAP = 50; // conservative warm-up default

const identities = new Map<string, SendingIdentity>();
let loadedAt = 0;

const memoryUsage = new Map<string, number>(); // key: `${identityId}_${YYYY-MM-DD}`

export function normalizeClientId(clientId?: string | null): string {
  return clientId && clientId.trim() ? clientId.trim() : PLATFORM_CLIENT_ID;
}

function utcDay(): string {
  return new Date().toISOString().slice(0, 10);
}

function usageKey(identityId: string): string {
  return `${identityId}_${utcDay()}`;
}

function pruneOldUsage() {
  const today = utcDay();
  for (const k of Array.from(memoryUsage.keys())) {
    if (!k.endsWith(`_${today}`)) memoryUsage.delete(k);
  }
}

function envDefaultIdentity(): SendingIdentity | null {
  const email = (process.env.RESEND_FROM_EMAIL || '').trim().toLowerCase();
  if (!email || !email.includes('@')) return null;
  const now = new Date(0).toISOString();
  return {
    identityId: ENV_DEFAULT_IDENTITY_ID,
    clientId: PLATFORM_CLIENT_ID,
    label: 'Environment default',
    domain: email.split('@')[1],
    fromEmail: email,
    fromName: (process.env.RESEND_FROM_NAME || 'Umrah360').trim(),
    replyTo: (process.env.RESEND_REPLY_TO || '').trim() || undefined,
    dailyCap: Number.MAX_SAFE_INTEGER,
    isActive: true,
    createdAt: now,
    updatedAt: now,
  };
}

async function loadIdentities(force = false): Promise<void> {
  if (!force && Date.now() - loadedAt < CACHE_TTL_MS) return;
  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(collection(db, 'sending_identities'));
      identities.clear();
      snap.forEach((d) => {
        const data = d.data() as SendingIdentity;
        if (data && data.identityId) identities.set(data.identityId, data);
      });
    } catch (e) {
      console.warn('[Sending Identities] Could not load from Firestore, using cache:', e);
    }
  }
  loadedAt = Date.now();
}

// ---------------------------------------------------------------------------
// Daily usage
// ---------------------------------------------------------------------------

async function getUsageToday(identityId: string): Promise<number> {
  const key = usageKey(identityId);
  if (!memoryUsage.has(key)) {
    pruneOldUsage();
    let n = 0;
    if (isFirebaseConfigured && db) {
      try {
        const snap = await getDoc(doc(db, 'sending_usage', key));
        if (snap.exists()) n = Number((snap.data() as any).count || 0);
      } catch {
        // fall back to 0
      }
    }
    memoryUsage.set(key, n);
  }
  return memoryUsage.get(key) || 0;
}

/** Adds (or, with a negative delta, refunds) usage for today. */
export async function bumpIdentityUsage(identityId: string, delta: number): Promise<void> {
  if (!delta || identityId === ENV_DEFAULT_IDENTITY_ID) return;
  const key = usageKey(identityId);
  const current = await getUsageToday(identityId);
  memoryUsage.set(key, Math.max(0, current + delta));

  if (isFirebaseConfigured && db) {
    setDoc(
      doc(db, 'sending_usage', key),
      { identityId, date: utcDay(), count: increment(delta), updatedAt: new Date().toISOString() },
      { merge: true }
    ).catch(() => {});
  }
}

// ---------------------------------------------------------------------------
// Lookup
// ---------------------------------------------------------------------------

export async function findIdentity(identityId: string): Promise<SendingIdentity | null> {
  if (identityId === ENV_DEFAULT_IDENTITY_ID) return envDefaultIdentity();
  await loadIdentities();
  return identities.get(identityId) || null;
}

async function getEligibleIdentities(clientId: string, allowedIds?: string[]): Promise<SendingIdentity[]> {
  await loadIdentities();
  const cid = normalizeClientId(clientId);
  const active = Array.from(identities.values()).filter((i) => i.clientId === cid && i.isActive);

  let eligible = active;
  if (allowedIds && allowedIds.length > 0) {
    const restricted = active.filter((i) => allowedIds.includes(i.identityId));
    // If every selected identity was deleted/deactivated, fall back to all active ones instead of stalling.
    if (restricted.length > 0) eligible = restricted;
  }

  if (eligible.length === 0 && cid === PLATFORM_CLIENT_ID) {
    const env = envDefaultIdentity();
    if (env) return [env];
  }
  return eligible.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
}

/** Identity used for one-off / transactional mail (auto-replies, thank-you emails). Not cap-limited. */
export async function getDefaultIdentity(clientId?: string | null): Promise<SendingIdentity | null> {
  const eligible = await getEligibleIdentities(normalizeClientId(clientId));
  return eligible[0] || null;
}

// ---------------------------------------------------------------------------
// Rotation / planning
// ---------------------------------------------------------------------------

export interface IdentityPlan {
  assignments: Map<string, SendingIdentity>; // key = lead key
  unassigned: string[]; // lead keys with no capacity left today
  noIdentities: boolean; // the client has no usable identity at all
}

/**
 * Assigns each lead to an identity and reserves today's capacity for the assigned sends.
 * Callers must refund (bumpIdentityUsage with a negative delta) for any send that does not go out.
 */
export async function planIdentityAssignments(opts: {
  clientId?: string | null;
  allowedIdentityIds?: string[];
  leads: Array<{ key: string; stickyIdentityId?: string }>;
}): Promise<IdentityPlan> {
  const eligible = await getEligibleIdentities(normalizeClientId(opts.clientId), opts.allowedIdentityIds);
  const assignments = new Map<string, SendingIdentity>();
  const unassigned: string[] = [];

  if (eligible.length === 0) {
    return { assignments, unassigned: opts.leads.map((l) => l.key), noIdentities: true };
  }

  const remaining = new Map<string, number>();
  for (const idn of eligible) {
    const used = await getUsageToday(idn.identityId);
    remaining.set(idn.identityId, Math.max(0, idn.dailyCap - used));
  }
  const byId = new Map(eligible.map((i) => [i.identityId, i]));
  const reserved = new Map<string, number>();

  for (const lead of opts.leads) {
    let chosen: SendingIdentity | undefined;

    if (lead.stickyIdentityId && byId.has(lead.stickyIdentityId) && (remaining.get(lead.stickyIdentityId) || 0) > 0) {
      chosen = byId.get(lead.stickyIdentityId);
    } else {
      let bestRatio = 0;
      for (const idn of eligible) {
        const rem = remaining.get(idn.identityId) || 0;
        if (rem <= 0) continue;
        const ratio = rem / Math.max(1, idn.dailyCap);
        if (ratio > bestRatio) {
          bestRatio = ratio;
          chosen = idn;
        }
      }
    }

    if (!chosen) {
      unassigned.push(lead.key);
      continue;
    }

    assignments.set(lead.key, chosen);
    remaining.set(chosen.identityId, (remaining.get(chosen.identityId) || 0) - 1);
    reserved.set(chosen.identityId, (reserved.get(chosen.identityId) || 0) + 1);
  }

  for (const [identityId, count] of reserved) {
    await bumpIdentityUsage(identityId, count);
  }

  return { assignments, unassigned, noIdentities: false };
}

// ---------------------------------------------------------------------------
// CRUD (used by the Settings → Sending Domains panel)
// ---------------------------------------------------------------------------

export async function listIdentities(clientId?: string | null): Promise<SendingIdentityWithUsage[]> {
  await loadIdentities(true);
  let list = Array.from(identities.values());
  if (clientId !== undefined && clientId !== null) {
    const cid = normalizeClientId(clientId);
    list = list.filter((i) => i.clientId === cid);
  }
  list.sort((a, b) => a.clientId.localeCompare(b.clientId) || a.createdAt.localeCompare(b.createdAt));
  const out: SendingIdentityWithUsage[] = [];
  for (const i of list) {
    out.push({ ...i, sentToday: await getUsageToday(i.identityId) });
  }
  return out;
}

const EMAIL_RE = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;

export async function saveIdentity(
  input: Partial<SendingIdentity>,
  actorClientId: string | null // null = platform staff (may choose any client)
): Promise<SendingIdentity> {
  await loadIdentities(true);

  const fromEmail = (input.fromEmail || '').trim().toLowerCase();
  if (!EMAIL_RE.test(fromEmail)) throw new Error('A valid from email address is required.');
  const domain = fromEmail.split('@')[1];

  const replyTo = (input.replyTo || '').trim().toLowerCase();
  if (replyTo && !EMAIL_RE.test(replyTo)) throw new Error('Reply-To must be a valid email address.');

  let dailyCap = Number(input.dailyCap ?? DEFAULT_DAILY_CAP);
  if (!Number.isFinite(dailyCap) || dailyCap < 1) throw new Error('Daily cap must be at least 1.');
  dailyCap = Math.min(Math.floor(dailyCap), 1_000_000);

  const existing = input.identityId ? identities.get(input.identityId) : undefined;
  const targetClientId = actorClientId ? normalizeClientId(actorClientId) : normalizeClientId(input.clientId ?? existing?.clientId);

  if (existing && existing.clientId !== targetClientId && actorClientId) {
    throw new Error('You cannot modify another client’s sending identity.');
  }

  const clash = Array.from(identities.values()).find(
    (i) => i.fromEmail === fromEmail && i.clientId === targetClientId && i.identityId !== existing?.identityId
  );
  if (clash) throw new Error(`${fromEmail} is already configured for this client.`);

  // Make sure the domain exists and is verified in the Resend account (skipped if Resend cannot be reached).
  const domains = await listResendDomains();
  if (domains) {
    const match = domains.find((d) => d.name === domain);
    if (!match) {
      throw new Error(`The domain "${domain}" is not in the Resend account. Add it at resend.com/domains and verify its DNS records first.`);
    }
    if (match.status !== 'verified') {
      throw new Error(`The domain "${domain}" is not verified in Resend yet (status: ${match.status}). Finish DNS verification first.`);
    }
  }

  const now = new Date().toISOString();
  const identity: SendingIdentity = {
    identityId: existing?.identityId || `sid-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    clientId: targetClientId,
    label: (input.label || '').trim() || domain,
    domain,
    fromEmail,
    fromName: (input.fromName || '').trim() || domain,
    replyTo: replyTo || undefined,
    dailyCap,
    isActive: input.isActive !== false,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };

  identities.set(identity.identityId, identity);
  if (isFirebaseConfigured && db) {
    await setDoc(doc(db, 'sending_identities', identity.identityId), sanitizeForFirestore(identity));
  }
  return identity;
}

export async function deleteIdentity(identityId: string, actorClientId: string | null): Promise<void> {
  await loadIdentities(true);
  const existing = identities.get(identityId);
  if (!existing) return;
  if (actorClientId && existing.clientId !== normalizeClientId(actorClientId)) {
    throw new Error('You cannot delete another client’s sending identity.');
  }
  identities.delete(identityId);
  if (isFirebaseConfigured && db) {
    await deleteDoc(doc(db, 'sending_identities', identityId));
  }
}
