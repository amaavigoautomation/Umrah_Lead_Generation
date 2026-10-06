import Stripe from 'stripe';
import { db, doc, getDoc, getDocs, setDoc, updateDoc, query as fsQuery, where as fsWhere } from './adminFirestore.js';
import { globalTenantDoc, globalTenantsCol } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { listPlans, invalidateEntitlements, type PlanDoc, type BillingStatus } from './entitlements.js';

/**
 * Stripe billing. Stripe only tells us WHICH plan a workspace is on and whether it is paid up;
 * what each plan includes lives in Firestore `plans/{id}` (see entitlements.ts).
 *
 * Env: STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET, APP_URL (optional, otherwise the request origin).
 */

export class BillingError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export function billingConfig() {
  return {
    secretKey: (process.env.STRIPE_SECRET_KEY || '').trim(),
    webhookSecret: (process.env.STRIPE_WEBHOOK_SECRET || '').trim(),
  };
}

let stripeClient: Stripe | null = null;
let stripeKey = '';
export function getStripe(): Stripe {
  const { secretKey } = billingConfig();
  if (!secretKey) throw new BillingError(503, 'Payments are not configured yet (STRIPE_SECRET_KEY missing)');
  if (!stripeClient || stripeKey !== secretKey) {
    stripeClient = new Stripe(secretKey);
    stripeKey = secretKey;
  }
  return stripeClient;
}

type TenantUpdate = Record<string, any>;

// ---------------------------------------------------------------------------
// Pure builders (unit-tested): turn a Stripe object into a workspace update.
// ---------------------------------------------------------------------------

export function planIdForPrice(plans: Pick<PlanDoc, 'id' | 'stripePriceId'>[], priceId?: string | null): string | undefined {
  if (!priceId) return undefined;
  return plans.find((p) => p.stripePriceId && p.stripePriceId === priceId)?.id;
}

export function buildCheckoutUpdate(session: any, plans: Pick<PlanDoc, 'id' | 'stripePriceId'>[]): TenantUpdate | null {
  const planId = session?.metadata?.planId;
  if (!planId || !plans.some((p) => p.id === planId)) return null;
  return {
    planId,
    planSource: 'stripe',
    billingStatus: 'active' as BillingStatus,
    stripeCustomerId: typeof session.customer === 'string' ? session.customer : session.customer?.id,
    stripeSubscriptionId: typeof session.subscription === 'string' ? session.subscription : session.subscription?.id,
    pastDueSince: null,
  };
}

export function mapSubscriptionStatus(status: string): BillingStatus | null {
  switch (status) {
    case 'active':
      return 'active';
    case 'trialing':
      return 'trialing';
    case 'past_due':
    case 'unpaid':
      return 'past_due';
    case 'canceled':
    case 'incomplete_expired':
      return 'canceled';
    default:
      return null; // incomplete / paused: change nothing
  }
}

export function buildSubscriptionUpdate(sub: any, tenant: any, plans: Pick<PlanDoc, 'id' | 'stripePriceId'>[], nowIso = new Date().toISOString()): TenantUpdate | null {
  // A plan set by hand by the super admin is never overwritten by Stripe events.
  if (tenant?.planSource === 'manual') return null;
  const status = mapSubscriptionStatus(sub?.status);
  if (!status) return null;
  const item = sub?.items?.data?.[0];
  const planId = planIdForPrice(plans, item?.price?.id);
  const periodEnd = item?.current_period_end ?? sub?.current_period_end;
  const update: TenantUpdate = {
    billingStatus: status,
    planSource: 'stripe',
    stripeSubscriptionId: sub.id,
    ...(planId ? { planId } : {}),
    ...(periodEnd ? { currentPeriodEnd: new Date(periodEnd * 1000).toISOString() } : {}),
  };
  if (status === 'past_due') update.pastDueSince = tenant?.pastDueSince || nowIso;
  else update.pastDueSince = null;
  return update;
}

// ---------------------------------------------------------------------------
// Persistence helpers
// ---------------------------------------------------------------------------

async function applyTenantUpdate(tenantId: string, update: TenantUpdate) {
  if (!isFirebaseConfigured || !db) return;
  await updateDoc(globalTenantDoc(tenantId), { ...update, updatedAt: new Date().toISOString() });
  invalidateEntitlements(tenantId);
}

async function findTenantByCustomer(customerId: string): Promise<{ id: string; data: any } | null> {
  if (!customerId || !isFirebaseConfigured || !db) return null;
  const snap = await getDocs(fsQuery(globalTenantsCol(), fsWhere('stripeCustomerId', '==', customerId)));
  const d = snap.docs[0];
  return d ? { id: d.id, data: d.data() } : null;
}

async function loadTenant(tenantId: string): Promise<any> {
  const snap = await getDoc(globalTenantDoc(tenantId));
  if (!snap.exists()) throw new BillingError(404, 'Workspace not found');
  return snap.data();
}

// ---------------------------------------------------------------------------
// Customer-facing actions
// ---------------------------------------------------------------------------

export async function createCheckout(params: { tenantId: string; planId: string; email: string; origin: string }) {
  const stripe = getStripe();
  const tenant = await loadTenant(params.tenantId);
  const plans = await listPlans();
  const plan = plans.find((p) => p.id === params.planId);
  if (!plan || !plan.active) throw new BillingError(400, 'That plan is not available');
  if (!plan.stripePriceId) throw new BillingError(400, `The ${plan.name} plan has no Stripe price yet. Ask your platform administrator.`);
  if (tenant.stripeSubscriptionId && tenant.planSource === 'stripe' && ['active', 'trialing', 'past_due'].includes(tenant.billingStatus)) {
    throw new BillingError(409, 'You already have a subscription. Use "Manage billing" to change plan.');
  }

  let customerId: string | undefined = tenant.stripeCustomerId;
  if (!customerId) {
    const customer = await stripe.customers.create({
      email: params.email || tenant.contactEmail || undefined,
      name: tenant.name,
      metadata: { tenantId: params.tenantId },
    });
    customerId = customer.id;
    await applyTenantUpdate(params.tenantId, { stripeCustomerId: customerId });
  }

  const session = await stripe.checkout.sessions.create({
    mode: 'subscription',
    customer: customerId,
    line_items: [{ price: plan.stripePriceId, quantity: 1 }],
    client_reference_id: params.tenantId,
    metadata: { tenantId: params.tenantId, planId: plan.id },
    subscription_data: { metadata: { tenantId: params.tenantId, planId: plan.id } },
    allow_promotion_codes: true,
    success_url: `${params.origin}/?billing=success&session_id={CHECKOUT_SESSION_ID}`,
    cancel_url: `${params.origin}/?billing=cancelled`,
  });
  return { url: session.url };
}

export async function createPortal(params: { tenantId: string; origin: string }) {
  const stripe = getStripe();
  const tenant = await loadTenant(params.tenantId);
  if (!tenant.stripeCustomerId) throw new BillingError(400, 'No billing account yet. Choose a plan first.');
  const portal = await stripe.billingPortal.sessions.create({ customer: tenant.stripeCustomerId, return_url: `${params.origin}/` });
  return { url: portal.url };
}

/** Called when the customer returns from Checkout, so the app unlocks without waiting for the webhook. */
export async function syncCheckoutSession(tenantId: string, sessionId: string) {
  const stripe = getStripe();
  const session = await stripe.checkout.sessions.retrieve(sessionId);
  if (session.client_reference_id !== tenantId) throw new BillingError(403, 'This checkout belongs to another workspace');
  if (session.status !== 'complete') return { activated: false };
  const update = buildCheckoutUpdate(session, await listPlans());
  if (!update) return { activated: false };
  await applyTenantUpdate(tenantId, update);
  return { activated: true };
}

// ---------------------------------------------------------------------------
// Webhook
// ---------------------------------------------------------------------------

export function verifyStripeEvent(rawBody: Buffer, signature: string | undefined): { event?: Stripe.Event; status?: number; message?: string } {
  const { webhookSecret } = billingConfig();
  if (!webhookSecret) return { status: 503, message: 'Webhook secret not configured' };
  if (!signature) return { status: 400, message: 'Missing Stripe signature' };
  try {
    return { event: Stripe.webhooks.constructEvent(rawBody, signature, webhookSecret) };
  } catch (err: any) {
    return { status: 400, message: `Invalid signature: ${err?.message || 'unknown'}` };
  }
}

export async function handleStripeWebhook(rawBody: Buffer, signature: string | undefined): Promise<{ status: number; message: string }> {
  const verified = verifyStripeEvent(rawBody, signature);
  if (!verified.event) return { status: verified.status || 400, message: verified.message || 'Invalid request' };
  const event = verified.event;

  if (!isFirebaseConfigured || !db) return { status: 200, message: 'ignored (no database)' };

  // Idempotency: Stripe retries events; process each id once.
  const eventRef = doc(db, 'stripe_events', event.id);
  if ((await getDoc(eventRef)).exists()) return { status: 200, message: 'duplicate' };

  const plans = await listPlans();
  const object: any = event.data.object;

  switch (event.type) {
    case 'checkout.session.completed': {
      const tenantId = object.client_reference_id || object.metadata?.tenantId;
      const update = tenantId ? buildCheckoutUpdate(object, plans) : null;
      if (tenantId && update) await applyTenantUpdate(tenantId, update);
      break;
    }
    case 'customer.subscription.updated':
    case 'customer.subscription.deleted': {
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
      const tenantId: string | undefined = object.metadata?.tenantId || (await findTenantByCustomer(customerId))?.id;
      if (tenantId) {
        const tenant = await loadTenant(tenantId).catch(() => null);
        const sub = event.type === 'customer.subscription.deleted' ? { ...object, status: 'canceled' } : object;
        const update = tenant ? buildSubscriptionUpdate(sub, tenant, plans) : null;
        if (update) await applyTenantUpdate(tenantId, update);
      }
      break;
    }
    case 'invoice.payment_failed':
    case 'invoice.paid': {
      const customerId = typeof object.customer === 'string' ? object.customer : object.customer?.id;
      const found = await findTenantByCustomer(customerId);
      if (found && found.data.planSource !== 'manual') {
        if (event.type === 'invoice.payment_failed') {
          await applyTenantUpdate(found.id, { billingStatus: 'past_due', pastDueSince: found.data.pastDueSince || new Date().toISOString() });
        } else if (found.data.billingStatus === 'past_due') {
          await applyTenantUpdate(found.id, { billingStatus: 'active', pastDueSince: null });
        }
      }
      break;
    }
    default:
      break;
  }

  await setDoc(eventRef, { type: event.type, processedAt: new Date().toISOString() }, { merge: false });
  return { status: 200, message: 'ok' };
}
