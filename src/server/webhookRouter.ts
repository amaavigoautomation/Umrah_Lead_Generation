import { createHash, createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { getDoc, updateDoc, increment, runTransaction } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import {
  globalWebhookRouteDoc,
  globalChannelRouteDoc,
  globalDomainRouteDoc,
  globalEmailRouteDoc,
} from './tenantRepo.js';
import { processWebsiteLeadSubmission } from './websiteLeadService.js';
import { originAllowed, normalizeOrigin } from './websiteWebhookService.js';
import { processLiveInboundWhatsApp, getWhatsAppGatewayStatus } from './whatsappInboundPipeline.js';
import { addEmailSuppression, recordTenantUsage } from './usageService.js';
import type { TenantContext, WebhookRoute, ChannelRoute, DomainRoute } from '../types/tenant.js';

const DEFAULT_TENANT_ID = 'umrah360';

export async function routeWebsiteLeadWebhook(
  req: any,
  res: any,
  webhookId?: string
): Promise<boolean> {
  const body = req.body || {};
  let resolvedTenantId = DEFAULT_TENANT_ID;

  if (webhookId && webhookId !== 'umrah-demo') {
    if (isFirebaseConfigured && db) {
      try {
        const routeSnap = await getDoc(globalWebhookRouteDoc(webhookId));
        if (routeSnap.exists()) {
          const route = routeSnap.data() as WebhookRoute;
          resolvedTenantId = route.tenantId || DEFAULT_TENANT_ID;

          const reqOrigin = (req.headers.origin || req.headers.referer || '').toString();
          if ((route as any).requireOrigin) {
            const list = route.allowedOrigins || [];
            let denyMsg = '';
            if (list.length === 0) denyMsg = 'No website is allowed for this webhook yet. Add your website in Settings \u2192 Website leads.';
            else if (reqOrigin && !originAllowed(reqOrigin, list)) denyMsg = 'This website is not allowed for this webhook';
            if (denyMsg) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: denyMsg }));
              return true;
            }
          } else if (route.allowedOrigins && route.allowedOrigins.length > 0) {
            const isAllowed = route.allowedOrigins.some((allowed) => reqOrigin.toLowerCase().includes(allowed.toLowerCase()));
            if (!isAllowed && reqOrigin) {
              res.statusCode = 403;
              res.setHeader('Content-Type', 'application/json');
              res.end(JSON.stringify({ error: 'Origin not allowed for this webhook route' }));
              return true;
            }
          }
        } else {
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Webhook endpoint '${webhookId}' not registered` }));
          return true;
        }
      } catch (err) {
        console.error(`[WebhookRouter] Error looking up route for ${webhookId}:`, err);
        res.statusCode = 503;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'Temporarily unable to route this request. Please try again.' }));
        return true;
      }
    }
  }

  const tenantCtx: TenantContext = {
    tenantId: resolvedTenantId,
    uid: 'webhook-agent',
    email: 'webhook@umrah360.in',
    role: 'admin',
  };

  try {
    const result = await processWebsiteLeadSubmission(body, tenantCtx);

    const redirectTo = typeof body?._redirect === 'string' ? body._redirect : '';
    if (redirectTo && webhookId && webhookId !== 'umrah-demo' && isFirebaseConfigured && db) {
      try {
        const rSnap = await getDoc(globalWebhookRouteDoc(webhookId));
        const list: string[] = (rSnap.data() as any)?.allowedOrigins || [];
        const target = new URL(redirectTo);
        if (/^https?:$/.test(target.protocol) && list.includes(normalizeOrigin(target.hostname) || '')) {
          res.statusCode = 303;
          res.setHeader('Location', target.toString());
          res.end();
          return true;
        }
      } catch {}
    }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        tenantId: resolvedTenantId,
        message: 'Lead processed and synced into CRM',
        leadId: result.lead?.leadId,
        contactId: result.contact?.contactId,
        thankYouEmailSent: Boolean(result.autoConfirmationSent),
        ...(result.conversation?.thankYouError ? { thankYouError: result.conversation.thankYouError } : {}),
      })
    );
    return true;
  } catch (error: any) {
    console.error(`[WebhookRouter] Error processing lead for tenant ${resolvedTenantId}:`, error);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: error?.message || 'Error processing inbound lead' }));
    return true;
  }
}

export async function routeWhatsAppWebhook(req: any, res: any): Promise<boolean> {
  if (req.method === 'GET') {
    const parsedUrl = new URL(req.url || '', 'http://localhost');
    const mode = parsedUrl.searchParams.get('hub.mode') || parsedUrl.searchParams.get('hub_mode');
    const verifyToken =
      parsedUrl.searchParams.get('hub.verify_token') ||
      parsedUrl.searchParams.get('hub_verify_token') ||
      parsedUrl.searchParams.get('verify_token');
    const challenge =
      parsedUrl.searchParams.get('hub.challenge') ||
      parsedUrl.searchParams.get('hub_challenge') ||
      parsedUrl.searchParams.get('challenge');

    const expectedToken = process.env.META_WEBHOOK_VERIFY_TOKEN || 'umrah360_webhook_token';

    if (mode === 'subscribe' && verifyToken === expectedToken && challenge) {
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end(challenge);
      return true;
    }

    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Verification token mismatch' }));
    return true;
  }

  const body = req.body || {};
  let resolvedTenantId = DEFAULT_TENANT_ID;

  const phoneNumberId =
    body?.entry?.[0]?.changes?.[0]?.value?.metadata?.phone_number_id ||
    body?.entry?.[0]?.changes?.[0]?.value?.metadata?.display_phone_number;

  if (phoneNumberId && isFirebaseConfigured && db) {
    try {
      const channelSnap = await getDoc(globalChannelRouteDoc(phoneNumberId));
      if (channelSnap.exists()) {
        const channelRoute = channelSnap.data() as ChannelRoute;
        if (channelRoute.tenantId) {
          resolvedTenantId = channelRoute.tenantId;
        }
      }
    } catch (err) {
      console.warn(`[WebhookRouter] Error resolving WhatsApp channel for ${phoneNumberId}:`, err);
    }
  }

  const tenantCtx: TenantContext = {
    tenantId: resolvedTenantId,
    uid: 'whatsapp-agent',
    email: 'whatsapp@umrah360.in',
    role: 'admin',
  };

  try {
    const result = await processLiveInboundWhatsApp(body, tenantCtx);
    if (result.processed) {
      await recordTenantUsage(resolvedTenantId, { whatsappMessageCount: 1 }).catch(() => {});
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'EVENT_RECEIVED', tenantId: resolvedTenantId, ...result }));
    return true;
  } catch (err: any) {
    console.error(`[WebhookRouter] WhatsApp handler error for tenant ${resolvedTenantId}:`, err);
    res.statusCode = 500;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: err?.message || 'Error processing WhatsApp event' }));
    return true;
  }
}

function readTags(raw: any): Record<string, string> {
  const out: Record<string, string> = {};
  if (Array.isArray(raw)) {
    for (const t of raw) if (t?.name) out[String(t.name)] = String(t.value ?? '');
  } else if (raw && typeof raw === 'object') {
    for (const [k, v] of Object.entries(raw)) out[k] = String(v ?? '');
  }
  return out;
}

const SCANNER_AGENT = /(bot\b|scanner|barracuda|proofpoint|mimecast|safelinks|defender|symantec|trendmicro|ironport)/i;
const REAL_CLIENT_PROXY_AGENT = /(googleimageproxy|ggpht\.com)/i;
function isScannerAgent(agent: string): boolean {
  if (REAL_CLIENT_PROXY_AGENT.test(agent)) return false;
  return SCANNER_AGENT.test(agent);
}
function requestHeader(req: any, name: string): string {
  const value = req?.headers?.[name.toLowerCase()];
  return Array.isArray(value) ? String(value[0] || '') : String(value || '');
}

/** Verify Resend's Svix HMAC signature against the exact raw body and reject stale signed requests. */
export function verifyResendWebhookRequest(
  req: any,
  secret = process.env.RESEND_WEBHOOK_SECRET || ''
): { ok: true; eventId: string } | { ok: false; error: string; status: number } {
  if (!secret.trim()) return { ok: false, error: 'RESEND_WEBHOOK_SECRET is not configured on this server.', status: 503 };
  const eventId = requestHeader(req, 'svix-id');
  const timestamp = requestHeader(req, 'svix-timestamp');
  const signatureHeader = requestHeader(req, 'svix-signature');
  const rawBody = req?.rawBody;
  if (!eventId || !timestamp || !signatureHeader || !(Buffer.isBuffer(rawBody) || typeof rawBody === 'string')) {
    return { ok: false, error: 'Missing Resend signature headers or raw request body.', status: 400 };
  }
  const timestampSeconds = Number(timestamp);
  if (!Number.isFinite(timestampSeconds) || Math.abs(Date.now() - timestampSeconds * 1000) > 5 * 60 * 1000) {
    return { ok: false, error: 'Resend webhook timestamp is outside the allowed five-minute window.', status: 400 };
  }
  const encodedSecret = secret.trim().replace(/^whsec_/, '');
  let signingKey: Buffer;
  try { signingKey = Buffer.from(encodedSecret, 'base64'); }
  catch { return { ok: false, error: 'RESEND_WEBHOOK_SECRET is not a valid Resend signing secret.', status: 503 }; }
  if (!signingKey.length) return { ok: false, error: 'RESEND_WEBHOOK_SECRET is not a valid Resend signing secret.', status: 503 };
  const bodyText = Buffer.isBuffer(rawBody) ? rawBody.toString('utf8') : rawBody;
  const signedContent = eventId + '.' + timestamp + '.' + bodyText;
  const expected = createHmac('sha256', signingKey).update(signedContent).digest();
  const valid = signatureHeader.split(/\s+/).some((candidate) => {
    const [version, encodedSignature] = candidate.split(',');
    if (version !== 'v1' || !encodedSignature) return false;
    try {
      const provided = Buffer.from(encodedSignature, 'base64');
      return provided.length === expected.length && timingSafeEqual(provided, expected);
    } catch { return false; }
  });
  return valid ? { ok: true, eventId } : { ok: false, error: 'Invalid Resend webhook signature.', status: 400 };
}

async function resolveEngagementTarget(event: any): Promise<{ tenantId: string; leadId: string; campaignId?: string } | null> {
  const tags = readTags(event?.data?.tags);
  if (tags.tenant && tags.lead) return { tenantId: tags.tenant, leadId: tags.lead, campaignId: tags.campaign || undefined };
  const emailId = String(event?.data?.email_id || event?.data?.emailId || '').trim();
  if (!emailId || !isFirebaseConfigured || !db) return null;
  try {
    const snap = await getDoc(globalEmailRouteDoc(emailId));
    if (!snap.exists()) return null;
    const row = snap.data() as { tenantId?: string; campaignLeadId?: string; leadId?: string; campaignId?: string };
    const tenantId = String(row.tenantId || '').trim();
    const leadId = String(row.campaignLeadId || row.leadId || '').trim();
    if (!tenantId || !leadId) return null;
    return { tenantId, leadId, campaignId: row.campaignId || undefined };
  } catch { return null; }
}

const resendEventDocumentId = (eventId: string) => createHash('sha256').update(eventId).digest('hex');
const WEBHOOK_PROCESSING_LEASE_MS = 2 * 60 * 1000;
type ResendEventClaim = { state: 'CLAIMED'; token: string } | { state: 'PROCESSED' | 'IN_PROGRESS' };

async function claimResendEvent(tenantId: string, eventId: string, event: any, target: { leadId: string; campaignId?: string }): Promise<ResendEventClaim> {
  const ctx: TenantContext = { tenantId, uid: 'resend-webhook', email: 'webhook@system', role: 'admin' };
  const eventRef = tenantRepo(ctx).campaignEngagementEventDoc(resendEventDocumentId(eventId));
  const now = new Date().toISOString();
  const nowMs = Date.now();
  const token = randomUUID();
  return runTransaction(async (tx: any) => {
    const snap = await tx.get(eventRef);
    if (snap.exists) {
      const existing = snap.data() || {};
      if (existing.status === 'PROCESSED') return { state: 'PROCESSED' as const };
      const lockedAt = Date.parse(String(existing.lockedAt || ''));
      if (existing.status === 'PROCESSING' && Number.isFinite(lockedAt) && nowMs - lockedAt < WEBHOOK_PROCESSING_LEASE_MS) {
        return { state: 'IN_PROGRESS' as const };
      }
      tx.set(eventRef, {
        status: 'PROCESSING', lockedAt: now, lockToken: token,
        attempts: Number(existing.attempts || 0) + 1, updatedAt: now, lastError: null,
      }, { merge: true });
      return { state: 'CLAIMED' as const, token };
    }
    tx.create(eventRef, {
      eventId, eventType: String(event?.type || ''), emailId: String(event?.data?.email_id || ''),
      tenantId, campaignId: target.campaignId || '', campaignLeadId: target.leadId,
      eventAt: String(event?.created_at || now), status: 'PROCESSING',
      attempts: 1, lockedAt: now, lockToken: token, createdAt: now, updatedAt: now,
    });
    return { state: 'CLAIMED' as const, token };
  });
}

async function trackEmailEngagement(
  event: any,
  eventId: string,
  target: { tenantId: string; leadId: string; campaignId?: string }
): Promise<{ tracked: boolean; duplicate?: boolean; bot?: boolean }> {
  const type = String(event?.type || '');
  const ctx: TenantContext = { tenantId: target.tenantId, uid: 'resend-webhook', email: 'webhook@system', role: 'admin' };
  const repo = tenantRepo(ctx);
  const leadRef = repo.campaignLeadDoc(target.leadId);
  const eventRef = repo.campaignEngagementEventDoc(resendEventDocumentId(eventId));
  const claim = await claimResendEvent(target.tenantId, eventId, event, target);
  if (claim.state === 'PROCESSED') return { tracked: true, duplicate: true };
  if (claim.state === 'IN_PROGRESS') throw new Error('This Resend event is already being processed; retry shortly.');

  const nowIso = new Date().toISOString();
  const eventAt = typeof event?.created_at === 'string' && Number.isFinite(Date.parse(event.created_at))
    ? new Date(event.created_at).toISOString() : nowIso;
  const agent = String(event?.data?.click?.userAgent || event?.data?.open?.userAgent || event?.data?.user_agent || '');
  const bot = (type === 'email.opened' || type === 'email.clicked') && isScannerAgent(agent);

  try {
    const processed = await runTransaction(async (tx: any) => {
      const [leadSnap, eventSnap] = await Promise.all([tx.get(leadRef), tx.get(eventRef)]);
      if (!eventSnap.exists) throw new Error('Resend event ledger entry is missing.');
      const eventRow = eventSnap.data() || {};
      if (eventRow.status === 'PROCESSED') return 'DUPLICATE';
      if (eventRow.lockToken !== claim.token) return 'LEASE_LOST';
      if (!leadSnap.exists) throw new Error('Campaign lead not found for the verified Resend event.');
      const lead = leadSnap.data() as any;
      if (target.campaignId && lead.campaignId && target.campaignId !== lead.campaignId) {
        throw new Error('Resend campaign tag does not match the tenant campaign lead record.');
      }

      let patch: Record<string, any>;
      if (type === 'email.delivered') {
        const terminal = ['BOUNCED', 'COMPLAINED'].includes(String(lead.deliveryStatus || ''));
        patch = {
          delivered: lead.deliveryStatus === 'BOUNCED' ? false : true,
          deliveryStatus: terminal ? lead.deliveryStatus : 'DELIVERED',
          deliveredAt: lead.deliveredAt || eventAt,
          deliveryDelayed: false, updatedAt: nowIso,
        };
      } else if (type === 'email.delivery_delayed') {
        const terminal = ['DELIVERED', 'BOUNCED', 'COMPLAINED'].includes(String(lead.deliveryStatus || ''));
        patch = terminal ? { deliveryDelayed: false, updatedAt: nowIso } : { deliveryStatus: 'DELAYED', deliveryDelayed: true, updatedAt: nowIso };
      } else if (type === 'email.opened') {
        patch = bot
          ? { botOpenCount: increment(1), updatedAt: nowIso }
          : {
              realOpenCount: increment(1), opened: true, engaged: true, lastOpenedAt: eventAt,
              ...(lead.replyStatus === 'REPLIED' ? { repliedWithoutTrackedOpen: false } : {}),
              updatedAt: nowIso,
            };
      } else if (type === 'email.clicked') {
        const clickedUrl = String(event?.data?.click?.link || event?.data?.click?.url || '');
        patch = bot
          ? { botClickCount: increment(1), updatedAt: nowIso }
          : {
              clickCount: increment(1), clicked: true, engaged: true,
              ...(clickedUrl ? { lastClickedUrl: clickedUrl.slice(0, 1500) } : {}),
              lastClickedAt: eventAt, updatedAt: nowIso,
            };
      } else if (type === 'email.bounced') {
        patch = { bounced: true, delivered: false, deliveryStatus: 'BOUNCED', bouncedAt: eventAt, deliveryDelayed: false, updatedAt: nowIso };
      } else if (type === 'email.complained') {
        patch = {
          delivered: true, complained: true, deliveryStatus: 'COMPLAINED',
          deliveredAt: lead.deliveredAt || eventAt, complainedAt: eventAt,
          deliveryDelayed: false, updatedAt: nowIso,
        };
      } else {
        throw new Error('Unsupported Resend event type: ' + type);
      }

      tx.update(leadRef, patch);
      tx.update(eventRef, {
        status: 'PROCESSED', isBot: bot, processedAt: nowIso, lockedAt: null, lockToken: null, updatedAt: nowIso,
        ...(type === 'email.clicked' && event?.data?.click?.link ? { clickedUrl: String(event.data.click.link).slice(0, 1500) } : {}),
      });
      return 'PROCESSED';
    });

    if (processed === 'DUPLICATE') return { tracked: true, duplicate: true };
    if (processed === 'LEASE_LOST') throw new Error('Resend event processing lease changed; retry the event.');
    return { tracked: true, bot };
  } catch (error: any) {
    await runTransaction(async (tx: any) => {
      const snap = await tx.get(eventRef);
      if (snap.exists && snap.data()?.lockToken === claim.token && snap.data()?.status === 'PROCESSING') {
        tx.update(eventRef, {
          status: 'FAILED', lastError: String(error?.message || error).slice(0, 1000),
          lockedAt: null, lockToken: null, updatedAt: new Date().toISOString(),
        });
      }
    }).catch(() => {});
    throw error;
  }
}

async function resolveResendTenant(event: any): Promise<string> {
  const recipient = event?.data?.to?.[0] || event?.data?.email;
  const resendEmailId = event?.data?.email_id;
  let tenantId = DEFAULT_TENANT_ID;
  if (recipient && String(recipient).includes('@') && isFirebaseConfigured && db) {
    try {
      const domain = String(recipient).split('@')[1]?.toLowerCase().trim();
      if (domain) {
        const domainSnap = await getDoc(globalDomainRouteDoc(domain));
        if (domainSnap.exists() && domainSnap.data()?.tenantId) tenantId = domainSnap.data().tenantId;
      }
      if (resendEmailId && tenantId === DEFAULT_TENANT_ID) {
        const emailRouteSnap = await getDoc(globalEmailRouteDoc(resendEmailId));
        if (emailRouteSnap.exists()) tenantId = emailRouteSnap.data()?.tenantId || DEFAULT_TENANT_ID;
      }
    } catch {}
  }
  return tenantId;
}

export async function routeResendWebhook(req: any, res: any): Promise<boolean> {
  if (req.method === 'GET' || req.method === 'HEAD') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ ok: true, webhook: 'resend', hint: 'POST events must include a valid Svix signature.' }));
    return true;
  }
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'POST only' }));
    return true;
  }
  const verified = verifyResendWebhookRequest(req);
  if (!verified.ok) {
    console.warn('[Resend Webhook] rejected request: ' + verified.error);
    res.statusCode = verified.status;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: verified.error }));
    return true;
  }

  const event = req.body || {};
  if (!event.type && event.data?.type) event.type = event.data.type;
  const type = String(event.type || '');
  const relevant = new Set(['email.delivered', 'email.delivery_delayed', 'email.opened', 'email.clicked', 'email.bounced', 'email.complained']);
  if (!relevant.has(type)) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received: true, ignored: true, event: type || 'unknown' }));
    return true;
  }

  let result: { tracked: boolean; duplicate?: boolean; bot?: boolean } = { tracked: false };
  const target = await resolveEngagementTarget(event);
  if (target) {
    try { result = await trackEmailEngagement(event, verified.eventId, target); }
    catch (err: any) {
      console.error('[Resend Webhook] ' + type + ' processing failed:', err?.message || err);
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ received: false, error: 'Campaign engagement event could not be persisted. Resend should retry.' }));
      return true;
    }
  } else {
    console.warn('[Resend Webhook] ' + type + ' has no campaign lead route for ' + (event?.data?.email_id || 'unknown') + '.');
  }

  if (type === 'email.bounced' || type === 'email.complained') {
    const recipient = event.data?.to?.[0] || event.data?.email;
    if (recipient) {
      const tenantId = target?.tenantId || await resolveResendTenant(event);
      await addEmailSuppression(tenantId, recipient, type === 'email.bounced' ? 'bounce' : 'complaint');
    }
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({
    received: true, event: type, tracked: result.tracked,
    ...(result.duplicate ? { duplicate: true } : {}),
    ...(result.bot ? { classifiedAsScanner: true } : {}),
  }));
  return true;
}
