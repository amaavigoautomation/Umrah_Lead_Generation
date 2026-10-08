import { getDoc } from './adminFirestore.js';
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

/**
 * Universal Inbound Website Lead Webhook Router
 * Handles /api/webhooks/website/:webhookId, /api/webhooks/umrah-demo, and /api/leads/inbound
 */
export async function routeWebsiteLeadWebhook(
  req: any,
  res: any,
  webhookId?: string
): Promise<boolean> {
  const body = req.body || {};
  let resolvedTenantId = DEFAULT_TENANT_ID;

  // 1. If explicit webhookId provided, resolve tenant from global routing table
  if (webhookId && webhookId !== 'umrah-demo') {
    if (isFirebaseConfigured && db) {
      try {
        const routeSnap = await getDoc(globalWebhookRouteDoc(webhookId));
        if (routeSnap.exists()) {
          const route = routeSnap.data() as WebhookRoute;
          resolvedTenantId = route.tenantId || DEFAULT_TENANT_ID;

          // Self-serve routes (requireOrigin) only accept the websites the company listed.
          // Older hand-registered routes keep the previous, looser behaviour.
          const reqOrigin = (req.headers.origin || req.headers.referer || '').toString();
          if ((route as any).requireOrigin) {
            const list = route.allowedOrigins || [];
            let denyMsg = '';
            if (list.length === 0) denyMsg = 'No website is allowed for this webhook yet. Add your website in Settings → Website leads.';
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
          // If custom webhook ID not found in route registry, reject to enforce isolation
          res.statusCode = 404;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ error: `Webhook endpoint '${webhookId}' not registered` }));
          return true;
        }
      } catch (err) {
        // Never guess the owner: a failed lookup must not drop a client's lead into the default workspace.
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

    // Plain HTML forms: `_redirect` sends the visitor back to a thank-you page (only on a listed website).
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
        thankYouEmailSent: result.thankYouEmailSent,
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

/**
 * Universal Inbound WhatsApp Webhook Router
 * Handles /api/webhooks/whatsapp and /api/inbound/whatsapp
 */
export async function routeWhatsAppWebhook(req: any, res: any): Promise<boolean> {
  // 1. Verification Handshake (GET)
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

  // 2. Incoming Event Ingestion (POST)
  const body = req.body || {};
  let resolvedTenantId = DEFAULT_TENANT_ID;

  // Extract phone_number_id from Meta webhook payload structure
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
    // Track message count for tenant usage
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

/**
 * Universal Resend / Email Events Webhook Router
 * Handles /api/webhooks/email/resend
 */
export async function routeResendWebhook(req: any, res: any): Promise<boolean> {
  const event = req.body || {};
  const type = event.type; // e.g. "email.bounced", "email.complained", "email.delivered"
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

  // Handle bounce or complaint by suppressing email
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