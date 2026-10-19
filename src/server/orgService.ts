import { getDoc, getDocs, setDoc, query as fsQuery, where as fsWhere } from './adminFirestore.js';
import { globalOrgDoc, globalOrgsCol, globalTenantDoc, globalTenantsCol, globalUserDoc, globalUsersCol } from './tenantRepo.js';
import { createTenantUser, createPasswordSetupLink, setTenantUserClaims, revokeUserSessions } from './firebaseAdmin.js';
import { getOrgEntitlements, invalidateEntitlements, listPlans } from './entitlements.js';
import { invalidateOrgStatusCache, invalidateTenantStatusCache } from './authMiddleware.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import type { Org, Tenant } from '../types/tenant.js';

export class OrgError extends Error {
  status: number;
  code?: string;
  extra?: Record<string, any>;
  constructor(message: string, status = 400, code?: string, extra?: Record<string, any>) {
    super(message);
    this.status = status;
    this.code = code;
    this.extra = extra;
  }
}

const RESERVED_IDS = new Set(['platform', 'admin', 'api', 'new', 'null', 'undefined']);

const slugify = (v: string) =>
  String(v || '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40);

function requireDb() {
  if (!isFirebaseConfigured) throw new OrgError('Database not configured', 503);
}

/** Serialise cap-checked creates per organization, so two simultaneous requests cannot both take the last slot. */
const orgLocks = new Map<string, Promise<unknown>>();
function withOrgLock<T>(orgId: string, fn: () => Promise<T>): Promise<T> {
  const prev = orgLocks.get(orgId) || Promise.resolve();
  const run = prev.catch(() => {}).then(fn);
  orgLocks.set(orgId, run);
  run.finally(() => {
    if (orgLocks.get(orgId) === run) orgLocks.delete(orgId);
  }).catch(() => {});
  return run;
}

export async function getOrg(orgId: string): Promise<Org | null> {
  requireDb();
  const snap = await getDoc(globalOrgDoc(orgId));
  return snap.exists() ? ({ ...(snap.data() as Org), id: orgId }) : null;
}

export async function listOrgs(): Promise<Array<Org & { clientCount: number }>> {
  requireDb();
  const snap = await getDocs(globalOrgsCol());
  const orgs = snap.docs.map((d) => ({ ...(d.data() as Org), id: d.id }));
  const tenants = await getDocs(globalTenantsCol());
  const counts = new Map<string, number>();
  tenants.docs.forEach((d) => {
    const oid = (d.data() as any)?.orgId;
    if (oid) counts.set(oid, (counts.get(oid) || 0) + 1);
  });
  return orgs
    .map((o) => ({ ...o, clientCount: counts.get(o.id) || 0 }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export interface ClientSummary {
  id: string;
  name: string;
  status: string;
  timezone?: string;
  contactEmail?: string;
  createdAt?: string;
}

export async function listClients(orgId: string): Promise<ClientSummary[]> {
  requireDb();
  const snap = await getDocs(fsQuery(globalTenantsCol(), fsWhere('orgId', '==', orgId)));
  return snap.docs
    .map((d) => d.data() as Tenant)
    .map((t) => ({
      id: t.id,
      name: t.name || t.id,
      status: t.status || 'active',
      timezone: t.timezone,
      contactEmail: t.contactEmail,
      createdAt: t.createdAt,
    }))
    .sort((a, b) => String(a.name).localeCompare(String(b.name)));
}

export async function createOrg(input: { name: string; planId: string; contactEmail?: string }): Promise<Org> {
  requireDb();
  const name = String(input.name || '').trim().slice(0, 80);
  if (!name) throw new OrgError('Organization name is required');
  const plans = await listPlans();
  if (!plans.some((p) => p.id === input.planId)) throw new OrgError('Choose a plan for the organization');

  const base = slugify(name) || 'org';
  let id = base;
  for (let i = 0; i < 20; i++) {
    const clash = (await getDoc(globalOrgDoc(id))).exists() || (await getDoc(globalTenantDoc(id))).exists() || RESERVED_IDS.has(id);
    if (!clash) break;
    id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
  }
  const now = new Date().toISOString();
  const org: Org = {
    id,
    name,
    status: 'active',
    planId: input.planId,
    billingStatus: 'manual',
    planSource: 'manual',
    ...(input.contactEmail ? { contactEmail: String(input.contactEmail).trim().toLowerCase() } : {}),
    createdAt: now,
    updatedAt: now,
  };
  await setDoc(globalOrgDoc(id), org);
  invalidateEntitlements();
  return org;
}

export async function updateOrg(orgId: string, patch: { name?: string; planId?: string; status?: 'active' | 'suspended' }): Promise<Org> {
  requireDb();
  const org = await getOrg(orgId);
  if (!org) throw new OrgError('Organization not found', 404);
  const next: Org = { ...org, updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) {
    const n = String(patch.name).trim().slice(0, 80);
    if (!n) throw new OrgError('Organization name cannot be empty');
    next.name = n;
  }
  if (patch.planId !== undefined) {
    if (!(await listPlans()).some((p) => p.id === patch.planId)) throw new OrgError('Unknown plan');
    // Never silently strand clients: a plan with a smaller allowance than the current client count is refused.
    const plan = (await listPlans()).find((p) => p.id === patch.planId)!;
    const max = plan.limits?.maxClients ?? 0;
    const count = (await listClients(orgId)).length;
    if (count > max) {
      throw new OrgError(`This plan allows ${max} client brand${max === 1 ? '' : 's'} but the organization already has ${count}.`, 409, 'too_many_clients');
    }
    next.planId = patch.planId;
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'active' && patch.status !== 'suspended') throw new OrgError('Invalid status');
    next.status = patch.status;
  }
  await setDoc(globalOrgDoc(orgId), JSON.parse(JSON.stringify(next)));
  invalidateOrgStatusCache(orgId);
  invalidateEntitlements();
  return next;
}

/** First admin of a new organization (platform admin invites them) or an extra admin added later by an org admin. */
export async function inviteOrgAdmin(orgId: string, input: { email: string; name?: string; password?: string }) {
  requireDb();
  const org = await getOrg(orgId);
  if (!org) throw new OrgError('Organization not found', 404);
  const email = String(input.email || '').trim().toLowerCase();
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw new OrgError('A valid email is required');
  const password = input.password ? String(input.password) : undefined;
  if (password && password.length < 8) throw new OrgError('Password must be at least 8 characters');

  // Seat limit (organization plan). Re-adding an existing admin never counts as a new seat.
  const seatLimit = (await getOrgEntitlements(orgId)).limits.seats;
  const admins = await listOrgAdmins(orgId);
  const already = admins.some((a) => a.email.toLowerCase() === email);
  if (!already && Number.isFinite(seatLimit) && admins.filter((a) => a.active !== false).length >= seatLimit) {
    throw new OrgError(`Your plan allows ${seatLimit} admin seat${seatLimit === 1 ? '' : 's'}. Upgrade to add more.`, 402, 'upgrade_required', { limit: 'seats' });
  }

  let rec;
  try {
    rec = await createTenantUser({ email, password, displayName: input.name || undefined, orgId, role: 'admin' });
  } catch (e: any) {
    throw new OrgError(e?.message || 'Could not add the admin', /another (workspace|organization)|platform administrator/i.test(e?.message || '') ? 409 : 500);
  }
  const nowIso = new Date().toISOString();
  await setDoc(
    globalUserDoc(rec.uid),
    {
      uid: rec.uid,
      email,
      name: input.name || rec.displayName || email.split('@')[0],
      orgId,
      role: 'admin',
      active: true,
      createdAt: nowIso,
      updatedAt: nowIso,
    },
    { merge: true }
  );
  const setupLink = password ? undefined : await createPasswordSetupLink(email).catch(() => undefined);
  return { uid: rec.uid, email, existed: Boolean(rec.existed), passwordSet: Boolean(rec.passwordSet), setupLink };
}

export async function listOrgAdmins(orgId: string): Promise<Array<{ uid: string; email: string; name?: string; active?: boolean }>> {
  requireDb();
  const snap = await getDocs(fsQuery(globalUsersCol(), fsWhere('orgId', '==', orgId)));
  return snap.docs.map((d) => {
    const u: any = d.data();
    return { uid: d.id, email: String(u.email || ''), name: u.name, active: u.active };
  });
}

export async function getOrgOverview(orgId: string) {
  const org = await getOrg(orgId);
  if (!org) throw new OrgError('Organization not found', 404);
  const [ent, clients, admins] = await Promise.all([getOrgEntitlements(orgId, { fresh: true }), listClients(orgId), listOrgAdmins(orgId)]);
  return {
    org: { id: org.id, name: org.name, status: org.status },
    plan: { id: ent.planId, name: ent.planName },
    billing: ent.billing,
    limits: { maxClients: ent.limits.maxClients ?? 0, seats: ent.limits.seats },
    usedClients: clients.length,
    clients,
    admins,
  };
}

/** Creates a client brand under the organization, enforcing the plan's client cap. */
export async function createClient(orgId: string, input: { name: string; timezone?: string; contactEmail?: string }): Promise<ClientSummary> {
  requireDb();
  return withOrgLock(orgId, async () => {
    const org = await getOrg(orgId);
    if (!org) throw new OrgError('Organization not found', 404);
    if (org.status === 'suspended') throw new OrgError('This organization is suspended', 403, 'ORG_SUSPENDED');
    const name = String(input.name || '').trim().slice(0, 80);
    if (!name) throw new OrgError('Client name is required');

    const ent = await getOrgEntitlements(orgId, { fresh: true });
    if (ent.billing.locked) throw new OrgError('Your organization plan is not active. Contact the platform administrator.', 402, 'billing_required');
    const max = ent.limits.maxClients ?? 0;
    const existing = await listClients(orgId);
    if (existing.length >= max) {
      throw new OrgError(
        max === 0
          ? 'Your plan does not include client brands. Upgrade to onboard clients.'
          : `Your plan allows ${max} client brand${max === 1 ? '' : 's'}. Upgrade to add more.`,
        402,
        'upgrade_required',
        { limit: 'maxClients', max, used: existing.length }
      );
    }

    // Tenant ids are global (tenants/{id}), so make the slug unique across ALL workspaces and organizations.
    const base = slugify(name) || 'client';
    let id = base;
    for (let i = 0; i < 25; i++) {
      const clash = RESERVED_IDS.has(id) || (await getDoc(globalTenantDoc(id))).exists() || (await getDoc(globalOrgDoc(id))).exists();
      if (!clash) break;
      id = `${base}-${Math.random().toString(36).slice(2, 6)}`;
    }
    const now = new Date().toISOString();
    const tenant: Tenant & Record<string, any> = {
      id,
      name,
      slug: id,
      status: 'active',
      plan: 'growth',
      // Plan/limits really come from the organization (see computeEntitlements); these are only legacy display fields.
      limits: { monthlyAiTokens: 0, dailyOutboundSends: 0, hourlyOutboundSends: 0, seats: 0 },
      orgId,
      billingStatus: 'inherited',
      planSource: 'org',
      contactEmail: input.contactEmail ? String(input.contactEmail).trim().toLowerCase() : '',
      timezone: input.timezone || 'Asia/Kolkata',
      defaultCurrency: 'USD',
      createdAt: now,
      updatedAt: now,
    };
    await setDoc(globalTenantDoc(id), JSON.parse(JSON.stringify(tenant)));
    invalidateEntitlements(id);
    return { id, name, status: 'active', timezone: tenant.timezone, contactEmail: tenant.contactEmail, createdAt: now };
  });
}

export async function updateClient(orgId: string, clientId: string, patch: { name?: string; status?: 'active' | 'suspended' }): Promise<ClientSummary> {
  requireDb();
  const snap = await getDoc(globalTenantDoc(clientId));
  const t: any = snap.exists() ? snap.data() : null;
  // Same answer for "not found" and "belongs to someone else".
  if (!t || t.orgId !== orgId) throw new OrgError('Client not found', 404);
  const next: any = { ...t, updatedAt: new Date().toISOString() };
  if (patch.name !== undefined) {
    const n = String(patch.name).trim().slice(0, 80);
    if (!n) throw new OrgError('Client name cannot be empty');
    next.name = n;
  }
  if (patch.status !== undefined) {
    if (patch.status !== 'active' && patch.status !== 'suspended') throw new OrgError('Invalid status');
    next.status = patch.status;
  }
  await setDoc(globalTenantDoc(clientId), JSON.parse(JSON.stringify(next)));
  invalidateTenantStatusCache(clientId);
  invalidateEntitlements(clientId);
  return { id: clientId, name: next.name, status: next.status, timezone: next.timezone, contactEmail: next.contactEmail, createdAt: next.createdAt };
}

/** Platform admin: move an existing standalone workspace under an organization. */
export async function adoptTenant(orgId: string, tenantId: string): Promise<ClientSummary> {
  requireDb();
  return withOrgLock(orgId, async () => {
    const org = await getOrg(orgId);
    if (!org) throw new OrgError('Organization not found', 404);
    const snap = await getDoc(globalTenantDoc(tenantId));
    const t: any = snap.exists() ? snap.data() : null;
    if (!t) throw new OrgError('Workspace not found', 404);
    if (t.orgId === orgId) throw new OrgError('That workspace is already part of this organization', 409);
    if (t.orgId) throw new OrgError('That workspace already belongs to another organization', 409);
    if (t.stripeSubscriptionId) {
      throw new OrgError('That workspace has its own paid subscription. Cancel it first, then move the workspace.', 409, 'has_subscription');
    }
    const ent = await getOrgEntitlements(orgId, { fresh: true });
    const max = ent.limits.maxClients ?? 0;
    const used = (await listClients(orgId)).length;
    if (used >= max) throw new OrgError(`The organization's plan allows ${max} client brand${max === 1 ? '' : 's'}.`, 402, 'upgrade_required', { limit: 'maxClients', max, used });

    const next = {
      ...t,
      orgId,
      // Keep what it had, so the move can be undone by hand if needed.
      adoptedFrom: { billingStatus: t.billingStatus ?? null, planSource: t.planSource ?? null, planId: t.planId ?? null, at: new Date().toISOString() },
      billingStatus: 'inherited',
      planSource: 'org',
      updatedAt: new Date().toISOString(),
    };
    delete next.planId;
    await setDoc(globalTenantDoc(tenantId), JSON.parse(JSON.stringify(next)));
    invalidateTenantStatusCache(tenantId);
    invalidateEntitlements(tenantId);
    return { id: tenantId, name: next.name || tenantId, status: next.status || 'active', timezone: next.timezone, contactEmail: next.contactEmail, createdAt: next.createdAt };
  });
}

/**
 * Agency plans make a workspace an agency automatically.
 *
 * Called when a platform admin gives a workspace a plan that allows client brands (limit maxClients > 0).
 * The workspace becomes the customer's first client brand under a new organization, and the workspace's
 * admins become organization admins (same logins). Their sessions are revoked once so the new permissions
 * apply on the next sign-in. Idempotent: a workspace that is already part of an organization is left alone.
 */
export async function convertTenantToAgency(tenantId: string): Promise<{ converted: boolean; orgId?: string; admins?: number; reason?: string }> {
  requireDb();
  const snap = await getDoc(globalTenantDoc(tenantId));
  const t: any = snap.exists() ? snap.data() : null;
  if (!t) throw new OrgError('Workspace not found', 404);
  if (t.orgId) return { converted: false, orgId: t.orgId, reason: 'already_in_org' };
  const plan = (await listPlans()).find((p) => p.id === t.planId);
  if (!plan || (plan.limits?.maxClients ?? 0) <= 0) return { converted: false, reason: 'plan_has_no_clients' };
  if (t.stripeSubscriptionId) return { converted: false, reason: 'has_subscription' };

  const org = await createOrg({ name: t.name || tenantId, planId: plan.id, contactEmail: t.contactEmail });
  try {
    await adoptTenant(org.id, tenantId);
    // Remember the customer's own workspace: admins invited to it later become organization admins too.
    await setDoc(globalOrgDoc(org.id), { homeTenantId: tenantId }, { merge: true });
  } catch (e) {
    // Do not leave an empty organization behind.
    await setDoc(globalOrgDoc(org.id), { ...org, status: 'suspended', updatedAt: new Date().toISOString(), note: 'conversion failed' }).catch(() => {});
    throw e;
  }

  const users = await getDocs(fsQuery(globalUsersCol(), fsWhere('tenantId', '==', tenantId)));
  let admins = 0;
  for (const d of users.docs) {
    const u: any = d.data();
    if (u.role !== 'admin' || u.active === false) continue;
    await setTenantUserClaims(d.id, { tenantId: undefined, orgId: org.id, role: 'admin' } as any);
    await setDoc(globalUserDoc(d.id), { orgId: org.id, tenantId: null, updatedAt: new Date().toISOString() }, { merge: true });
    await revokeUserSessions(d.id).catch(() => {});
    admins++;
  }
  invalidateOrgStatusCache(org.id);
  invalidateEntitlements();
  return { converted: true, orgId: org.id, admins };
}
