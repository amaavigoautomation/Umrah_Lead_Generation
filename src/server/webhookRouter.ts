import { getDoc, updateDoc, increment } from './adminFirestore.js';
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
import { runInTenantScope } from './tenantScope.js';
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
    const result = await runInTenantScope(tenantCtx, () => processWebsiteLeadSubmission(body, tenantCtx));

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
    const result = await runInTenantScope(tenantCtx, () => processLiveInboundWhatsApp(body, tenantCtx));
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

// Security scanners that fetch the tracking pixel / links before a human does.
// NOTE: do not add generic words like "proxy" or "prefetch" here. Real inboxes load images through proxies
// (Gmail's "GoogleImageProxy"), so those words would count every Gmail open as a bot.
const SCANNER_AGENT = /(bot\b|scanner|barracuda|proofpoint|mimecast|safelinks|defender|symantec|trendmicro|ironport)/i;
// A real mail client proxy: always a human open, even if the agent string also contains a scanner-ish word.
const REAL_CLIENT_PROXY_AGENT = /(googleimageproxy|ggpht\.com)/i;
const OPEN_BOT_WINDOW_MS = 5_000;
const CLICK_BOT_WINDOW_MS = 5_000;

function isScannerAgent(agent: string): boolean {
  if (REAL_CLIENT_PROXY_AGENT.test(agent)) return false;
  return SCANNER_AGENT.test(agent);
}

async function resolveEngagementTarget(event: any): Promise<{ tenantId: string; leadId: string } | null> {
  const tags = readTags(event?.data?.tags);
  if (tags.tenant && tags.lead) return { tenantId: tags.tenant, leadId: tags.lead };

  const emailId = String(event?.data?.email_id || event?.data?.emailId || '').trim();
  if (!emailId || !isFirebaseConfigured || !db) return null;
  try {
    const snap = await getDoc(globalEmailRouteDoc(emailId));
    if (!snap.exists()) return null;
    const row = snap.data() as { tenantId?: string; campaignLeadId?: string; leadId?: string };
    const tenantId = String(row.tenantId || '').trim();
    const leadId = String(row.campaignLeadId || row.leadId || '').trim();
    if (!tenantId || !leadId) return null;
    return { tenantId, leadId };
  } catch {
    return null;
  }
}

async function trackEmailEngagement(event: any): Promise<boolean> {
  const type = String(event?.type || '');
  if (!['email.opened', 'email.clicked', 'email.bounced', 'email.complained'].includes(type)) return false;
  const target = await resolveEngagementTarget(event);
  if (!target) {
    console.warn(`[Resend Webhook] ${type} ignored: no tenant/lead tags and no email_routes match for ${event?.data?.email_id || 'unknown'}`);
    return false;
  }
  const { tenantId, leadId } = target;

  const nowIso = new Date().toISOString();
  const eventMs = Date.parse(event?.created_at || '') || Date.now();
  const sentMs = Date.parse(event?.data?.created_at || '');
  const sinceSentMs = Number.isFinite(sentMs) ? eventMs - sentMs : Number.POSITIVE_INFINITY;
  const agent = String(event?.data?.click?.userAgent || event?.data?.open?.userAgent || event?.data?.user_agent || '');

  let patch: Record<string, any>;
  if (type === 'email.opened') {
    const bot = sinceSentMs < OPEN_BOT_WINDOW_MS || isScannerAgent(agent);
    console.log(`[Resend Webhook] ${type} lead=${leadId} sinceSentMs=${Number.isFinite(sinceSentMs) ? sinceSentMs : 'unknown'} agent="${agent.slice(0, 80)}" -> ${bot ? 'bot' : 'real'}`);
    patch = bot
      ? { botOpenCount: increment(1), updatedAt: nowIso }
      : { realOpenCount: increment(1), opened: true, engaged: true, lastOpenedAt: nowIso, updatedAt: nowIso };
  } else if (type === 'email.clicked') {
    const bot = sinceSentMs < CLICK_BOT_WINDOW_MS || isScannerAgent(agent);
    console.log(`[Resend Webhook] ${type} lead=${leadId} sinceSentMs=${Number.isFinite(sinceSentMs) ? sinceSentMs : 'unknown'} agent="${agent.slice(0, 80)}" -> ${bot ? 'bot' : 'real'}`);
    patch = bot
      ? { botClickCount: increment(1), updatedAt: nowIso }
      : { clickCount: increment(1), clicked: true, engaged: true, lastClickedAt: nowIso, updatedAt: nowIso };
  } else {
    patch = { bounced: true, updatedAt: nowIso };
  }

  const ctx: TenantContext = { tenantId, uid: 'resend-webhook', email: 'webhook@system', role: 'admin' };
  try {
    await updateDoc(tenantRepo(ctx).campaignLeadDoc(leadId), patch);
    return true;
  } catch (err: any) {
    if (err?.code !== 5 && !/NOT_FOUND/i.test(String(err?.message || ''))) {
      console.warn('[Resend Webhook] engagement update failed:', err?.message || err);
    }
    return false;
  }
}

export async function routeResendWebhook(req: any, res: any): Promise<boolean> {
  const event = req.body || {};
  if (!event.type && event.data?.type) event.type = event.data.type;
  const type = event.type;

  if (type === 'email.opened' || type === 'email.clicked') {
    const tracked = await trackEmailEngagement(event);
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ received: true, event: type, tracked }));
    return true;
  }
  if (type === 'email.bounced' || type === 'email.complained') {
    await trackEmailEngagement(event).catch(() => false);
  }
  const recipient = event.data?.to?.[0] || event.data?.email;
  const resendEmailId = event.data?.email_id;

  let resolvedTenantId = DEFAULT_TENANT_ID;

  if (recipient && recipient.includes('@') && isFirebaseConfigured && db) {
    try {
      const domain = recipient.split('@')[1]?.toLowerCase().trim();
      if (domain) {
        const domainSnap = await getDoc(globalDomainRouteDoc(domain));
        if (domainSnap.exists()) {
          const dRoute = domainSnap.data() as DomainRoute;
          if (dRoute.tenantId) resolvedTenantId = dRoute.tenantId;
        }
      }

      if (resendEmailId && resolvedTenantId === DEFAULT_TENANT_ID) {
        const emailRouteSnap = await getDoc(globalEmailRouteDoc(resendEmailId));
        if (emailRouteSnap.exists()) {
          resolvedTenantId = emailRouteSnap.data()?.tenantId || DEFAULT_TENANT_ID;
        }
      }
    } catch {}
  }

  if (type === 'email.bounced' && recipient) {
    await addEmailSuppression(resolvedTenantId, recipient, 'bounce');
  } else if (type === 'email.complained' && recipient) {
    await addEmailSuppression(resolvedTenantId, recipient, 'complaint');
  }

  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ received: true, tenantId: resolvedTenantId, event: type }));
  return true;
}
