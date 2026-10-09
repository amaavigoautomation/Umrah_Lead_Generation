import OpenAI from 'openai';
import { sanitizeAiEmailText } from './emailSanitizer.js';
import { verifySmtpConnection, sendLiveEmail, getSmtpConfig, updateSmtpConfig, getResendConfig } from './smtpService.js';
import { checkImapStatus, getImapConfig, updateImapConfig } from './imapService.js';
import {
  processLiveInboundEmail,
  pollAndProcessImapMailbox,
  getImapOwnerTenantId,
  getRecentProcessedEmails,
  getConversationTurnStates,
  getAllThreadMessages,
  getPipelineConfig,
  updatePipelineConfig,
  appendOutboundMessageToThread,
  setConversationAiState,
} from './inboundPipeline.js';
import {
  processLiveInboundWhatsApp,
  getRecentProcessedWhatsAppMessages,
  getWhatsAppTurnStates,
  getWhatsAppPipelineConfig,
  updateWhatsAppPipelineConfig,
  getWhatsAppGatewayStatus,
  TARGET_WHATSAPP_NUMBER,
  TARGET_WHATSAPP_NUMBER_DISPLAY,
} from './whatsappInboundPipeline.js';
import {
  initCampaignStore,
  getAllCampaigns,
  getCampaignById,
  getCampaignByIdAsync,
  getCampaignLeads,
  getCampaignLeadsFromDb,
  getCampaignRuns,
  createCampaign,
  startCampaign,
  pauseCampaign,
  restartCampaign,
  getAllTemplates,
  getTemplatesFromDbOrCache,
  getTemplateById,
  getTemplateFromDbById,
  saveTemplate,
  deleteTemplate,
  deleteCampaign,
  updateLeadDemoStatus,
  updateCampaignLeadStatus,
  generateAiEmailForLead,
  generateAiSamplePreviews,
  processNextCampaignSendBatch,
  processActiveRunningCampaignsBatch,
} from './campaignService.js';
import { processWebsiteLeadSubmission } from './websiteLeadService.js';
import {
  getLiveCalendarToken,
  setServerCalendarAccessToken,
  findNextAvailableSlots,
  createGoogleCalendarDemoBooking,
  rescheduleDemoBooking,
  cancelDemoBooking,
  getAllBookings,
  processSchedulingConversationTurn,
  verifyGoogleCalendarConnection,
} from './demoSchedulingService.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { getDoc, getDocs, setDoc, updateDoc, deleteDoc, collection, doc, query as fsQuery, where as fsWhere } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import {
  setCampaignActiveContext,
  getCampaignActiveCtx,
} from './campaignService.js';
import { getTenantBrand } from './brandService.js';
import { brandSignature, brandIntro, brandTzLabel, brandWorkingDaysLabel, fmtHour } from '../shared/brand.js';
import { setSchedulingActiveContext } from './demoSchedulingService.js';
import { setInboundActiveContext } from './inboundPipeline.js';
import { getEntitlements, hasFeature, featureForUrl, listPlans, savePlan, getEffectiveLimits, invalidateEntitlements } from './entitlements.js';
import { FEATURES, LIMITS } from '../shared/features.js';
import { createCheckout, createPortal, syncCheckoutSession, billingConfig, BillingError } from './billingService.js';
import { setWhatsAppActiveContext } from './whatsappInboundPipeline.js';
import {
  tenantRepo,
  globalTenantDoc,
  globalTenantsCol,
  globalUserDoc,
  globalUsersCol,
  globalWebhookRouteDoc,
  globalWebhookRoutesCol,
  globalChannelRouteDoc,
  globalDomainRouteDoc,
} from './tenantRepo.js';
import { getAdminAuth, createTenantUser, createPasswordSetupLink } from './firebaseAdmin.js';
import { authenticateRequest } from './authMiddleware.js';
import {
  handleEnableAutoFollowUp,
  handleDisableAutoFollowUp,
  getAutoFollowUpDashboardData,
  getAutoFollowUpConfig,
  updateAutoFollowUpConfig,
  runAutoFollowUpWorkerCycle,
} from './autoFollowUpService.js';
import { encryptSecret, decryptSecret } from './cryptoUtils.js';
import { getTenantCurrentUsage, recordTenantUsage, checkTenantQuota } from './usageService.js';
import {
  routeWebsiteLeadWebhook,
  routeWhatsAppWebhook,
  routeResendWebhook,
} from './webhookRouter.js';
import type { TenantContext, Tenant, GlobalUser, UserRole, WebhookRoute, ChannelRoute, DomainRoute } from '../types/tenant.js';
import {
  initKnowledgeStore,
  getAllKnowledgeDocs,
  getPublishedKnowledgeDocs,
  saveKnowledgeDoc,
  deleteKnowledgeDoc,
  retrieveRelevantKnowledge as serverRetrieveKnowledge,
} from './knowledgeService.js';

/**
 * Universal API request handler that works in both:
 * 1. Vite Development Server (via connect middleware in vite-plugin-api.ts)
 * 2. Vercel Production Serverless Functions (via api/index.ts or api/inbound/whatsapp.ts)
 */
const PLAN_LIMITS: Record<string, { monthlyAiTokens: number; dailyOutboundSends: number; hourlyOutboundSends: number; seats: number }> = {
  starter: { monthlyAiTokens: 500_000, dailyOutboundSends: 500, hourlyOutboundSends: 100, seats: 3 },
  growth: { monthlyAiTokens: 2_000_000, dailyOutboundSends: 3_000, hourlyOutboundSends: 500, seats: 10 },
  enterprise: { monthlyAiTokens: 5_000_000, dailyOutboundSends: 10_000, hourlyOutboundSends: 1_000, seats: 25 },
};

export async function handleCoreApi(req: any, res: any): Promise<boolean> {
  // Normalize URL by parsing pathname and stripping query parameters & trailing slashes
  let rawUrl = req.url || '';
  let url = rawUrl;
  try {
    const parsed = new URL(rawUrl, 'http://localhost');
    url = parsed.pathname;
  } catch {
    url = rawUrl.split('?')[0];
  }
  url = url.replace(/\/+$/, '') || '/';
  if (!url.startsWith('/api/') && url !== '/api') {
    url = '/api' + (url.startsWith('/') ? url : '/' + url);
  }

  // Set standard API headers and CORS
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Google-Access-Token');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    res.end();
    return true;
  }

  // Robust Universal Body Parsing (Vercel Serverless, Express, Connect/Vite)
  let body: any = req.body;

  if (typeof body === 'string') {
    try {
      body = JSON.parse(body);
    } catch {
      try {
        const params = new URLSearchParams(body);
        const formObj: Record<string, any> = {};
        params.forEach((val, key) => {
          formObj[key] = val;
        });
        if (Object.keys(formObj).length > 0) body = formObj;
      } catch {}
    }
  } else if (Buffer.isBuffer(body)) {
    try {
      const rawStr = body.toString('utf-8');
      body = JSON.parse(rawStr);
    } catch {}
  }

  // If body is still not parsed into an object, try reading from request stream
  if (!body || typeof body !== 'object' || Object.keys(body).length === 0) {
    if (req.method === 'POST' || req.method === 'PATCH' || req.method === 'PUT') {
      try {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        if (chunks.length > 0) {
          const rawBody = Buffer.concat(chunks).toString('utf-8');
          if (rawBody) {
            try {
              body = JSON.parse(rawBody);
            } catch {
              try {
                const params = new URLSearchParams(rawBody);
                const formObj: Record<string, any> = {};
                params.forEach((val, key) => {
                  formObj[key] = val;
                });
                if (Object.keys(formObj).length > 0) body = formObj;
              } catch {}
            }
          }
        }
      } catch (e) {
        // Body stream read exception
      }
    }
  }

  if (!body || typeof body !== 'object') body = {};

  // Google Calendar OAuth token travels in its own header. `Authorization`
  // carries ONLY the Firebase ID token.
  const rawCalendarToken = req.headers['x-google-access-token'];
  let requestBearerToken: string | null =
    typeof rawCalendarToken === 'string' &&
    rawCalendarToken.trim() &&
    rawCalendarToken !== 'null' &&
    rawCalendarToken !== 'undefined'
      ? rawCalendarToken.trim()
      : null;
  if (requestBearerToken) setServerCalendarAccessToken(requestBearerToken);

  // =========================================================================
  // AUTHENTICATION GATE: everything under /api requires a verified Firebase
  // session, except the explicit public allowlist below. Tenant identity comes
  // ONLY from the verified token claims. No header/body/query can override it.
  // =========================================================================
  const isPublicPath =
    url === '/api/health' ||
    url.startsWith('/api/webhooks/') ||
    url === '/api/inbound/whatsapp' ||
    url === '/api/leads/inbound' ||
    url === '/api/campaigns/cron' ||
    url === '/api/campaigns/process-active' ||
    url === '/api/auto-followup/trigger' ||
    url === '/api/inbound-mail/cron';

  let resolvedTenantId = '';
  let userUid = 'anonymous';
  let userEmail = '';
  let userRole: UserRole = 'member';
  let isPlatformAdmin = false;

  if (!isPublicPath) {
    const auth = await authenticateRequest(req);
    if (!auth.ok) {
      res.statusCode = auth.status;
      res.end(JSON.stringify({ error: auth.error, code: auth.code }));
      return true;
    }
    const c = auth.ctx!;
    resolvedTenantId = c.tenantId;
    userUid = c.uid;
    userEmail = c.email;
    userRole = c.role;
    isPlatformAdmin = Boolean(c.isPlatformAdmin);
  }

  const activeTenantCtx: TenantContext = {
    tenantId: resolvedTenantId,
    uid: userUid,
    email: userEmail,
    role: userRole,
    isPlatformAdmin,
  };

  // TEMPORARY: global active-context setters (removed in the "explicit ctx"
  // phase). Only set for authenticated requests, never for public paths.
  if (!isPublicPath) {
    setCampaignActiveContext(activeTenantCtx);
    setSchedulingActiveContext(activeTenantCtx);
    setInboundActiveContext(activeTenantCtx);
    setWhatsAppActiveContext(activeTenantCtx);
  }

  // =========================================================================
  // PLAN ENTITLEMENTS: one gate for every plan-restricted API route
  // =========================================================================
  if (!isPublicPath && !isPlatformAdmin) {
    const gatedFeature = featureForUrl(url);
    if (gatedFeature && !(await hasFeature(resolvedTenantId, gatedFeature))) {
      res.statusCode = 402;
      res.setHeader('Content-Type', 'application/json');
      res.end(
        JSON.stringify({
          error: 'Your plan does not include this feature. Upgrade to use it.',
          code: 'upgrade_required',
          feature: gatedFeature,
        })
      );
      return true;
    }
  }

  // Payment lock: a workspace that has not paid (or whose grace period ended) can only reach billing.
  if (!isPublicPath && !isPlatformAdmin) {
    const ent = await getEntitlements(resolvedTenantId).catch(() => null);
    const billingOpen =
      url === '/api/entitlements' ||
      url === '/api/plans' ||
      url === '/api/auth/me' ||
      url === '/api/health' ||
      url.startsWith('/api/billing') ||
      (req.method === 'GET' && url === `/api/tenants/${resolvedTenantId}`);
    if (ent?.billing.locked && !billingOpen) {
      res.statusCode = 402;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Payment required. Choose or fix your plan to continue.', code: 'billing_required', billingStatus: ent.billing.status }));
      return true;
    }
  }

  // Billing (workspace admins): /api/billing, /checkout, /portal, /sync
  if (url === '/api/billing' || url.startsWith('/api/billing/')) {
    res.setHeader('Content-Type', 'application/json');
    if (isPlatformAdmin || userRole !== 'admin') {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Workspace admin only' }));
      return true;
    }
    const origin = String(req.headers?.origin || process.env.APP_URL || `https://${req.headers?.host}`).replace(/\/+$/, '');
    try {
      if (url === '/api/billing' && req.method === 'GET') {
        const ent = await getEntitlements(resolvedTenantId, { fresh: true });
        const tSnap = await getDoc(globalTenantDoc(resolvedTenantId));
        const t: any = tSnap.exists() ? tSnap.data() : {};
        res.statusCode = 200;
        res.end(
          JSON.stringify({
            billing: ent.billing,
            planId: ent.planId,
            planName: ent.planName,
            hasCustomer: Boolean(t.stripeCustomerId),
            stripeConfigured: Boolean(billingConfig().secretKey),
            plans: (await listPlans()).filter((p) => p.active).map((p) => ({ id: p.id, name: p.name, priceMonthly: p.priceMonthly, currency: p.currency, features: p.features, limits: p.limits, purchasable: Boolean(p.stripePriceId) })),
          })
        );
        return true;
      }
      if (url === '/api/billing/checkout' && req.method === 'POST') {
        res.statusCode = 200;
        res.end(JSON.stringify(await createCheckout({ tenantId: resolvedTenantId, planId: String(body?.planId || ''), email: userEmail, origin })));
        return true;
      }
      if (url === '/api/billing/portal' && req.method === 'POST') {
        res.statusCode = 200;
        res.end(JSON.stringify(await createPortal({ tenantId: resolvedTenantId, origin })));
        return true;
      }
      if (url === '/api/billing/sync' && req.method === 'POST') {
        const result = await syncCheckoutSession(resolvedTenantId, String(body?.sessionId || ''));
        res.statusCode = 200;
        res.end(JSON.stringify({ ...result, entitlements: await getEntitlements(resolvedTenantId, { fresh: true }) }));
        return true;
      }
    } catch (err: any) {
      res.statusCode = err instanceof BillingError ? err.status : 500;
      res.end(JSON.stringify({ error: err?.message || 'Billing request failed' }));
      return true;
    }
  }

  if (url === '/api/entitlements' && req.method === 'GET') {
    res.setHeader('Content-Type', 'application/json');
    res.statusCode = 200;
    if (isPlatformAdmin) {
      res.end(JSON.stringify({ planId: 'platform', planName: 'Platform', features: Object.fromEntries(FEATURES.map((f) => [f.key, true])), limits: {}, billing: { status: 'active', locked: false, planSource: 'manual' } }));
    } else {
      res.end(JSON.stringify(await getEntitlements(resolvedTenantId, { fresh: String(rawUrl).includes('fresh=1') })));
    }
    return true;
  }

  if (url === '/api/plans' || /^\/api\/plans\/[^/]+$/.test(url)) {
    res.setHeader('Content-Type', 'application/json');
    if (req.method === 'GET' && url === '/api/plans') {
      if (!isPlatformAdmin && userRole !== 'admin') {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Admin only' }));
        return true;
      }
      const all = await listPlans();
      res.statusCode = 200;
      res.end(JSON.stringify({ plans: isPlatformAdmin ? all : all.filter((p) => p.active), features: FEATURES, limits: LIMITS }));
      return true;
    }
    if ((req.method === 'PUT' || req.method === 'POST') && url !== '/api/plans') {
      if (!isPlatformAdmin) {
        res.statusCode = 403;
        res.end(JSON.stringify({ error: 'Platform admin only' }));
        return true;
      }
      try {
        const plan = await savePlan({ ...(body || {}), id: url.split('/').pop() as string });
        res.statusCode = 200;
        res.end(JSON.stringify({ plan }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err?.message || 'Could not save plan' }));
      }
      return true;
    }
  }

  // =========================================================================
  // MULTI-TENANT INBOUND WEBHOOK ROUTING (Phase P3)
  // =========================================================================
  if (url.startsWith('/api/webhooks/website/')) {
    const webhookId = url.replace('/api/webhooks/website/', '').split(/[/?]/)[0];
    if (!webhookId) {
      res.statusCode = 404;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Webhook key missing' }));
      return true;
    }
    return await routeWebsiteLeadWebhook(req, res, webhookId);
  }
  if (url === '/api/webhooks/umrah-demo' || url === '/api/leads/inbound') {
    return await routeWebsiteLeadWebhook(req, res, 'umrah-demo');
  }
  if (url === '/api/webhooks/whatsapp' || url === '/api/inbound/whatsapp') {
    return await routeWhatsAppWebhook(req, res);
  }
  if (url === '/api/webhooks/email/resend') {
    return await routeResendWebhook(req, res);
  }

  // =========================================================================
  // MULTI-TENANT AUTH & USER ROUTING (Phase P1 / P6)
  // =========================================================================
  if (url === '/api/auth/me' && req.method === 'GET') {
    let globalUser: GlobalUser | null = null;
    let tenantInfo: Tenant | null = null;

    if (isFirebaseConfigured && db && userUid !== 'anonymous') {
      try {
        const uSnap = await getDoc(globalUserDoc(userUid));
        if (uSnap.exists()) globalUser = uSnap.data() as GlobalUser;

        const tSnap = await getDoc(globalTenantDoc(resolvedTenantId));
        if (tSnap.exists()) tenantInfo = tSnap.data() as Tenant;
      } catch (e) {}
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        authenticated: userUid !== 'anonymous',
        user: globalUser || {
          uid: userUid,
          email: userEmail || 'operator@umrah360.in',
          tenantId: resolvedTenantId,
          role: userRole,
          active: true,
          createdAt: new Date().toISOString(),
        },
        tenant: tenantInfo || {
          id: resolvedTenantId,
          name: resolvedTenantId === 'umrah360' ? 'Umrah360 Flagship' : resolvedTenantId,
          slug: resolvedTenantId,
          status: 'active',
          plan: 'enterprise',
          limits: {
            monthlyAiTokens: 5_000_000,
            dailyOutboundSends: 10_000,
            hourlyOutboundSends: 1_000,
            seats: 25,
          },
          createdAt: new Date().toISOString(),
        },
        claims: {
          tenantId: resolvedTenantId,
          role: userRole,
          platformAdmin: isPlatformAdmin,
        },
      })
    );
    return true;
  }

  // =========================================================================
  // MULTI-TENANT PLATFORM & TENANT MANAGEMENT (Phase P1 / P4 / P6)
  // =========================================================================
  if (url === '/api/tenants' || url.startsWith('/api/tenants/')) {
    const tm = url.match(/^\/api\/tenants\/([^/?]+)/);
    const targetId = tm ? tm[1] : null;
    let denied: string | null = null;
    if (!isPlatformAdmin) {
      if (!targetId) denied = 'Platform admin only';
      else if (targetId !== resolvedTenantId) denied = 'Forbidden';
      else if (req.method !== 'GET' && userRole !== 'admin') denied = 'Workspace admin only';
      else if (/\/(secrets|routes|inbound(\/.*)?|email(\/.*)?|webhook(\/.*)?)$/.test(url.split('?')[0]) && userRole !== 'admin') denied = 'Workspace admin only';
    }
    if (denied) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: denied }));
      return true;
    }
  }

  if (url === '/api/tenants' && req.method === 'GET') {
    if (isFirebaseConfigured && db) {
      try {
        const snap = await getDocs(globalTenantsCol());
        const tenants = snap.docs.map((d) => d.data() as Tenant);
        res.statusCode = 200;
        res.end(JSON.stringify({ tenants }));
        return true;
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message }));
        return true;
      }
    }
    res.statusCode = 200;
    res.end(JSON.stringify({ tenants: [] }));
    return true;
  }

  if (url === '/api/tenants' && req.method === 'POST') {
    const { id, name, plan, contactEmail, timezone, defaultCurrency, billing, planId: newPlanId } = body;
    const tenantId = (id || name || '').toLowerCase().replace(/[^a-z0-9_-]/g, '-').trim();

    if (!tenantId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: 'Valid tenant id or name required' }));
      return true;
    }

    const limitsMap: Record<string, any> = {
      starter: { monthlyAiTokens: 500_000, dailyOutboundSends: 500, hourlyOutboundSends: 100, seats: 3 },
      growth: { monthlyAiTokens: 2_000_000, dailyOutboundSends: 3_000, hourlyOutboundSends: 500, seats: 10 },
      enterprise: { monthlyAiTokens: 5_000_000, dailyOutboundSends: 10_000, hourlyOutboundSends: 1_000, seats: 25 },
    };

    // Billing: by default the customer must pick and pay for a plan (locked until then).
    // 'manual' = super admin grants a plan directly (demo, free, invoiced outside Stripe).
    let billingFields: Record<string, any> = { billingStatus: 'awaiting_plan', planSource: 'stripe' };
    if (billing === 'manual') {
      const known = (await listPlans()).some((p) => p.id === newPlanId);
      if (!known) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Choose a plan for a manually granted workspace' }));
        return true;
      }
      billingFields = { billingStatus: 'manual', planSource: 'manual', planId: newPlanId };
    }

    const newTenant: Tenant & Record<string, any> = {
      ...billingFields,
      id: tenantId,
      name: name || tenantId,
      slug: tenantId,
      status: 'active',
      plan: plan || 'growth',
      limits: limitsMap[plan || 'growth'] || limitsMap.growth,
      contactEmail: contactEmail || '',
      timezone: timezone || 'Asia/Kolkata',
      defaultCurrency: defaultCurrency || 'USD',
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    if (isFirebaseConfigured && db) {
      const existing = await getDoc(globalTenantDoc(tenantId));
      if (existing.exists()) {
        res.statusCode = 409;
        res.end(JSON.stringify({ error: `A workspace with id "${tenantId}" already exists` }));
        return true;
      }
      await safeSetDoc(globalTenantDoc(tenantId), newTenant, { merge: true });
    }

    res.statusCode = 201;
    res.end(JSON.stringify({ success: true, tenant: newTenant }));
    return true;
  }

  const tenantMatch = url.match(/^\/api\/tenants\/([^/?]+)$/);
  if (tenantMatch) {
    const tId = tenantMatch[1];
    if (req.method === 'GET') {
      if (isFirebaseConfigured && db) {
        const snap = await getDoc(globalTenantDoc(tId));
        if (snap.exists()) {
          res.statusCode = 200;
          res.end(JSON.stringify(snap.data()));
          return true;
        }
      }
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Tenant not found' }));
      return true;
    }

    if (req.method === 'PATCH') {
      if (isFirebaseConfigured && db) {
        // Whitelist: workspace admins may edit profile fields only. Plan, status and
        // limits are platform-admin only (a workspace admin must not raise their own limits).
        const b = body || {};
        const updates: Record<string, any> = {};
        for (const k of ['name', 'contactEmail', 'contactPhone', 'timezone', 'defaultCurrency']) {
          if (typeof b[k] === 'string') updates[k] = b[k].trim();
        }
        if (isPlatformAdmin) {
          if (b.status === 'active' || b.status === 'suspended') updates.status = b.status;
          if (typeof b.planId === 'string' && b.planId) {
            const known = (await listPlans()).some((p) => p.id === b.planId);
            if (!known) {
              res.statusCode = 400;
              res.end(JSON.stringify({ error: `Unknown plan "${b.planId}"` }));
              return true;
            }
            updates.planId = b.planId;
          }
          const BILLING_STATUSES = ['awaiting_plan', 'trialing', 'active', 'past_due', 'canceled', 'manual'];
          if (typeof b.billingStatus === 'string' && BILLING_STATUSES.includes(b.billingStatus)) {
            updates.billingStatus = b.billingStatus;
            if (b.billingStatus !== 'past_due') updates.pastDueSince = null;
          }
          if (updates.planId && updates.billingStatus === undefined) {
            // Setting a plan by hand is a manual grant that Stripe events will not overwrite.
            updates.billingStatus = 'manual';
            updates.planSource = 'manual';
          }
          if (b.planSource === 'manual' || b.planSource === 'stripe') updates.planSource = b.planSource;
          if (b.billingStatus === 'manual') updates.planSource = 'manual';
          if (b.overrides && typeof b.overrides === 'object') {
            const ov: { features: Record<string, boolean>; limits: Record<string, number> } = { features: {}, limits: {} };
            for (const f of FEATURES) if (typeof b.overrides.features?.[f.key] === 'boolean') ov.features[f.key] = b.overrides.features[f.key];
            for (const l of LIMITS) {
              const n = Number(b.overrides.limits?.[l.key]);
              if (b.overrides.limits?.[l.key] !== undefined && b.overrides.limits?.[l.key] !== null && Number.isFinite(n) && n >= 0) ov.limits[l.key] = Math.floor(n);
            }
            updates.overrides = ov;
          }
          if (typeof b.plan === 'string' && PLAN_LIMITS[b.plan]) {
            updates.plan = b.plan;
            updates.limits = PLAN_LIMITS[b.plan];
          }
          if (b.limits && typeof b.limits === 'object') {
            const base = updates.limits || (await getDoc(globalTenantDoc(tId))).data()?.limits || PLAN_LIMITS.growth;
            const merged: Record<string, number> = { ...base };
            for (const k of ['monthlyAiTokens', 'dailyOutboundSends', 'hourlyOutboundSends', 'seats']) {
              const n = Number(b.limits[k]);
              if (Number.isFinite(n) && n >= 0) merged[k] = Math.floor(n);
            }
            updates.limits = merged;
          }
        }
        if (Object.keys(updates).length === 0) {
          res.statusCode = 400;
          res.end(JSON.stringify({ error: 'No valid fields to update' }));
          return true;
        }
        updates.updatedAt = new Date().toISOString();
        await updateDoc(globalTenantDoc(tId), updates);
        invalidateEntitlements(tId);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, updated: updates }));
        return true;
      }
    }
  }

  // Workspace users (platform admin, or an admin of that same workspace): /api/tenants/:tenantId/users
  const tenantUsersMatch = url.match(/^\/api\/tenants\/([^/?]+)\/users$/);
  if (tenantUsersMatch) {
    const tId = tenantUsersMatch[1];
    res.setHeader('Content-Type', 'application/json');
    if (!isPlatformAdmin && (tId !== resolvedTenantId || userRole !== 'admin')) {
      res.statusCode = 403;
      res.end(JSON.stringify({ error: 'Workspace admin only' }));
      return true;
    }

    if (req.method === 'GET') {
      try {
        const snap = await getDocs(fsQuery(globalUsersCol(), fsWhere('tenantId', '==', tId)));
        const users = snap.docs.map((d) => {
          const u: any = d.data();
          return {
            uid: d.id,
            email: u.email,
            name: u.name || u.displayName || '',
            role: u.role || 'member',
            active: u.active !== false,
            createdAt: u.createdAt,
          };
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ users }));
      } catch (err: any) {
        res.statusCode = 500;
        res.end(JSON.stringify({ error: err?.message || 'Failed to list users' }));
      }
      return true;
    }

    if (req.method === 'POST') {
      const email = String(body?.email || '').trim().toLowerCase();
      const role = body?.role === 'admin' ? 'admin' : 'member';
      const name = String(body?.name || '').trim();
      const password = typeof body?.password === 'string' && body.password ? body.password : undefined;
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'A valid email is required' }));
        return true;
      }
      if (password && password.length < 8) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Password must be at least 8 characters' }));
        return true;
      }
      try {
        const tSnap = await getDoc(globalTenantDoc(tId));
        if (!tSnap.exists()) {
          res.statusCode = 404;
          res.end(JSON.stringify({ error: 'Workspace not found' }));
          return true;
        }
        // Seat limit (plan + overrides). Re-adding an existing member never counts as a new seat.
        const seatLimit = (await getEffectiveLimits(tId)).seats;
        if (Number.isFinite(seatLimit)) {
          const existingSnap = await getDocs(fsQuery(globalUsersCol(), fsWhere('tenantId', '==', tId)));
          const already = existingSnap.docs.some((d) => String((d.data() as any).email || '').toLowerCase() === email);
          if (!already && existingSnap.docs.filter((d) => (d.data() as any).active !== false).length >= seatLimit) {
            res.statusCode = 402;
            res.end(JSON.stringify({ error: `Your plan allows ${seatLimit} team seat${seatLimit === 1 ? '' : 's'}. Upgrade to add more people.`, code: 'upgrade_required', limit: 'seats' }));
            return true;
          }
        }
        const rec = await createTenantUser({ email, password, displayName: name || undefined, tenantId: tId, role });
        const nowIso = new Date().toISOString();
        await setDoc(
          globalUserDoc(rec.uid),
          {
            uid: rec.uid,
            email,
            name: name || rec.displayName || email.split('@')[0],
            tenantId: tId,
            role,
            active: true,
            ...(Array.isArray(body?.allowedModules) ? { allowedModules: body.allowedModules.filter((m: any) => typeof m === 'string') } : {}),
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          { merge: true }
        );
        // Profile used by the in-app Team list (no password is ever stored here).
        await setDoc(
          doc(db, 'app_users', rec.uid),
          {
            uid: rec.uid,
            userId: rec.uid,
            email,
            name: name || rec.displayName || email.split('@')[0],
            tenantId: tId,
            role,
            ...(Array.isArray(body?.allowedModules) ? { allowedModules: body.allowedModules.filter((m: any) => typeof m === 'string') } : {}),
            isActive: true,
            createdAt: nowIso,
            updatedAt: nowIso,
          },
          { merge: true }
        );
        const setupLink = password ? undefined : await createPasswordSetupLink(email);
        res.statusCode = 201;
        res.end(JSON.stringify({ success: true, user: { uid: rec.uid, email, role }, existed: Boolean(rec.existed), passwordSet: Boolean(rec.passwordSet), setupLink }));
      } catch (err: any) {
        const msg = err?.message || 'Failed to invite user';
        res.statusCode = /another workspace/i.test(msg) ? 409 : 500;
        res.end(JSON.stringify({ error: msg }));
      }
      return true;
    }
  }

  // Company brand profile: /api/tenants/:tenantId/brand (GET: any member, POST: workspace admin)
  const brandMatch = url.split('?')[0].match(/^\/api\/tenants\/([^/]+)\/brand$/);
  if (brandMatch) {
    const tId = brandMatch[1];
    res.setHeader('Content-Type', 'application/json');
    try {
      const bs = await import('./brandService.js');
      if (req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify({ brand: await bs.getTenantBrand(tId) }));
        return true;
      }
      if (req.method === 'POST') {
        res.statusCode = 200;
        res.end(JSON.stringify({ brand: await bs.saveTenantBrand(tId, body?.brand || body || {}) }));
        return true;
      }
    } catch (err: any) {
      res.statusCode = err?.status || 500;
      res.end(JSON.stringify({ error: err?.message || 'Brand request failed' }));
      return true;
    }
  }

  // Tenant Usage Metrics: /api/tenants/:tenantId/usage
  const usageMatch = url.match(/^\/api\/tenants\/([^/?]+)\/usage$/);
  if (usageMatch && req.method === 'GET') {
    const tId = usageMatch[1];
    const usage = await getTenantCurrentUsage(tId);
    let limits = {
      monthlyAiTokens: 5_000_000,
      dailyOutboundSends: 10_000,
      hourlyOutboundSends: 1_000,
      seats: 25,
    };
    if (isFirebaseConfigured && db) {
      const snap = await getDoc(globalTenantDoc(tId));
      if (snap.exists()) {
        const t = snap.data() as Tenant;
        if (t.limits) limits = t.limits;
      }
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        usage,
        limits,
        percentages: {
          aiTokens: Math.min(100, Math.round(((usage.aiTotalTokens || 0) / limits.monthlyAiTokens) * 100)),
          dailySends: Math.min(100, Math.round(((usage.coldEmailCount || 0) / limits.dailyOutboundSends) * 100)),
        },
      })
    );
    return true;
  }

  // Tenant Encrypted Secrets: /api/tenants/:tenantId/secrets
  const secretsMatch = url.match(/^\/api\/tenants\/([^/?]+)\/secrets$/);
  if (secretsMatch) {
    const tId = secretsMatch[1];
    const repo = tenantRepo({ tenantId: tId, uid: userUid, email: userEmail, role: userRole });

    if (req.method === 'GET') {
      if (isFirebaseConfigured && db) {
        const snap = await getDocs(repo.secretsCol());
        const secretSummaries = snap.docs.map((d) => {
          const data = d.data();
          return {
            name: d.id,
            keyVersion: data.keyVersion,
            createdAt: data.createdAt,
            updatedAt: data.updatedAt,
            configured: true,
          };
        });
        res.statusCode = 200;
        res.end(JSON.stringify({ secrets: secretSummaries }));
        return true;
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ secrets: [] }));
      return true;
    }

    if (req.method === 'POST') {
      const { name, secretValue } = body;
      if (!name || !secretValue) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'Secret name and secretValue required' }));
        return true;
      }
      const encrypted = encryptSecret(secretValue);
      const secretPayload = {
        name,
        ...encrypted,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      if (isFirebaseConfigured && db) {
        await safeSetDoc(repo.secretDoc(name), secretPayload, { merge: true });
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, message: `Secret '${name}' encrypted and saved.` }));
      return true;
    }
  }

  // Tenant email identity (Phase 1): /api/tenants/:tenantId/email[/domain|/verify|/sender]
  const emailMatch = url.split('?')[0].match(/^\/api\/tenants\/([^/]+)\/email(?:\/(domain|verify|refresh|sender))?$/);
  if (emailMatch) {
    const tId = emailMatch[1];
    const action = emailMatch[2];
    try {
      const svc = await import('./tenantEmailService.js');
      if (!action && req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify(await svc.getEmailSettingsView(tId)));
        return true;
      }
      if (req.method === 'DELETE' && action === 'domain') {
        res.statusCode = 200;
        res.end(JSON.stringify(await svc.removeTenantDomain(tId)));
        return true;
      }
      if (req.method === 'POST' && action) {
        if (action === 'domain') await svc.addTenantDomain(tId, body?.domain);
        else if (action === 'verify') await svc.verifyTenantDomain(tId);
        else if (action === 'refresh') await svc.refreshTenantDomain(tId);
        else await svc.setTenantSender(tId, { fromName: body?.fromName, fromLocalPart: body?.fromLocalPart, replyTo: body?.replyTo });
        res.statusCode = 200;
        res.end(JSON.stringify(await svc.getEmailSettingsView(tId)));
        return true;
      }
    } catch (err: any) {
      res.statusCode = err?.status || 500;
      res.end(JSON.stringify({ error: err?.message || 'Email settings request failed' }));
      return true;
    }
  }

  // Self-serve website-lead webhook: /api/tenants/:tenantId/webhook[/regenerate|/test]
  const webhookMatch = url.split('?')[0].match(/^\/api\/tenants\/([^/]+)\/webhook(?:\/(regenerate|test|simulate))?$/);
  if (webhookMatch) {
    const tId = webhookMatch[1];
    const action = webhookMatch[2];
    try {
      const svc = await import('./websiteWebhookService.js');
      res.setHeader('Content-Type', 'application/json');
      if (!action && req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify(await svc.getWebhookView(tId)));
        return true;
      }
      if (!action && req.method === 'POST') {
        res.statusCode = 200;
        res.end(JSON.stringify(await svc.setAllowedOrigins(tId, body?.allowedOrigins)));
        return true;
      }
      if (action === 'regenerate' && req.method === 'POST') {
        res.statusCode = 200;
        res.end(JSON.stringify(await svc.regenerateKey(tId)));
        return true;
      }
      if (action === 'simulate' && req.method === 'POST') {
        // Runs a form submission through the real pipeline, scoped to THIS workspace.
        const svcLead = await import('./websiteLeadService.js');
        const result = await svcLead.processWebsiteLeadSubmission(body || {}, { ...activeTenantCtx, tenantId: tId });
        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return true;
      }
      if (action === 'test' && req.method === 'POST') {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, ...(await svc.sendTestLead({ ...activeTenantCtx, tenantId: tId })) }));
        return true;
      }
    } catch (err: any) {
      res.statusCode = err?.status || 500;
      res.end(JSON.stringify({ error: err?.message || 'Webhook settings request failed' }));
      return true;
    }
  }

  // Per-company inbound mailbox (IMAP): /api/tenants/:tenantId/inbound[/test|/options|/disconnect|/poll]
  // Admin-only (enforced by the tenant guard above). The password is accepted here and never returned.
  const inboundMatch = url.split('?')[0].match(/^\/api\/tenants\/([^/]+)\/inbound(?:\/(test|options|disconnect|poll))?$/);
  if (inboundMatch) {
    const tId = inboundMatch[1];
    const action = inboundMatch[2];
    try {
      const svc = await import('./tenantInboundService.js');
      if (!action && req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify(await svc.getInboundView(tId)));
        return true;
      }
      if (req.method === 'POST') {
        let view;
        if (!action) {
          view = await svc.connectInbound(tId, {
            host: body?.host,
            port: body?.port,
            user: body?.user,
            password: body?.password,
            processNewInquiries: typeof body?.processNewInquiries === 'boolean' ? body.processNewInquiries : undefined,
          });
        } else if (action === 'test') {
          view = await svc.testStoredInbound(tId);
        } else if (action === 'options') {
          view = await svc.setInboundOptions(tId, { enabled: body?.enabled, processNewInquiries: body?.processNewInquiries });
        } else if (action === 'poll') {
          const poller = await import('./tenantImapPoller.js');
          await poller.pollTenantMailbox(tId, { force: true });
          view = await svc.getInboundView(tId);
        } else {
          view = await svc.disconnectInbound(tId);
        }
        res.statusCode = 200;
        res.end(JSON.stringify(view));
        return true;
      }
    } catch (err: any) {
      const status = err instanceof Error && typeof (err as any).status === 'number' ? (err as any).status : 500;
      res.statusCode = status;
      // Only our own InboundError messages are customer-readable; anything else stays generic.
      res.end(JSON.stringify({ error: status < 500 ? err.message : 'Inbound mailbox request failed' }));
      return true;
    }
  }

  // Cron / serverless worker for every company's mailbox: CRON_SECRET (all) or platform admin (all) or signed-in user (own)
  if (url === '/api/inbound-mail/cron' && (req.method === 'POST' || req.method === 'GET')) {
    const cronSecret = process.env.CRON_SECRET;
    const presented = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
    const isCron = Boolean(cronSecret) && presented === cronSecret;
    let callerCtx: TenantContext | null = null;
    let runAll = isCron;
    if (!isCron) {
      const a = await authenticateRequest(req);
      if (!a.ok) {
        res.statusCode = a.status || 401;
        res.end(JSON.stringify({ error: a.error || 'Unauthorized', code: a.code }));
        return true;
      }
      callerCtx = a.ctx!;
      runAll = Boolean(callerCtx.isPlatformAdmin);
    }
    try {
      const poller = await import('./tenantImapPoller.js');
      const results = runAll
        ? await poller.pollAllTenantMailboxes()
        : [await poller.pollTenantMailbox(callerCtx!.tenantId)];
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, results }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.message || 'Failed to poll mailboxes' }));
    }
    return true;
  }

  // Tenant Routes Registration: /api/tenants/:tenantId/routes
  const routesMatch = url.match(/^\/api\/tenants\/([^/?]+)\/routes$/);
  if (routesMatch) {
    const tId = routesMatch[1];
    if (req.method === 'POST') {
      const { type, routeKey, allowedOrigins } = body;
      if (!type || !routeKey) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: 'type and routeKey required' }));
        return true;
      }
      if (isFirebaseConfigured && db) {
        if (type === 'website') {
          await safeSetDoc(globalWebhookRouteDoc(routeKey), {
            webhookId: routeKey,
            tenantId: tId,
            type: 'website',
            allowedOrigins: allowedOrigins || [],
            createdAt: new Date().toISOString(),
          }, { merge: true });
        } else if (type === 'whatsapp') {
          await safeSetDoc(globalChannelRouteDoc(routeKey), {
            phoneNumberId: routeKey,
            tenantId: tId,
            createdAt: new Date().toISOString(),
          }, { merge: true });
        } else if (type === 'domain') {
          await safeSetDoc(globalDomainRouteDoc(routeKey), {
            domain: routeKey.toLowerCase().trim(),
            tenantId: tId,
            verified: true,
            createdAt: new Date().toISOString(),
          }, { merge: true });
        }
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, message: `Route registered for tenant ${tId}` }));
      return true;
    }
  }

  // 1. Health check
  if (url === '/api/health' || url.startsWith('/api/health?')) {
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'Umrah360 AI Omnichannel Engine',
        tenantId: resolvedTenantId,
        openaiModel: 'gpt-4o-mini',
        openaiKeyPresent: Boolean(process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY),
        whatsAppGateway: getWhatsAppGatewayStatus(),
        websiteWebhook: {
          endpoint: '/api/webhooks/umrah-demo',
          status: 'ready',
        },
        calendar: await (async () => {
          const b = await getTenantBrand(resolvedTenantId);
          return {
            targetEmail: b.calendarEmail,
            timezone: b.timezone,
            workingDays: brandWorkingDaysLabel(b).replace(' to ', ' - '),
            workingHours: `${fmtHour(b.workingHoursStart)} - ${fmtHour(b.workingHoursEnd)} ${brandTzLabel(b)}`,
          };
        })(),
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  // =========================================================================
  // UNIVERSAL DEMO SCHEDULING AGENT ENDPOINTS
  // =========================================================================
  if (url === '/api/calendar/auth-token' && req.method === 'POST') {
    const { accessToken, email, expiresIn } = body;
    if (accessToken) {
      setServerCalendarAccessToken(accessToken, expiresIn || 3600);
      if (isFirebaseConfigured && db) {
        await safeSetDoc(
          tenantRepo(activeTenantCtx).settingsDoc('calendar_auth'),
          {
            accessToken,
            email: email || (await getTenantBrand(resolvedTenantId)).calendarEmail,
            targetAccount: (await getTenantBrand(resolvedTenantId)).calendarEmail,
            updatedAt: new Date().toISOString(),
            active: true,
          },
          { merge: true }
        ).catch(() => {});
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, message: 'Google Calendar OAuth token registered on server' }));
      return true;
    }
    res.statusCode = 400;
    res.end(JSON.stringify({ error: 'accessToken is required' }));
    return true;
  }

  if (url === '/api/calendar/status' && req.method === 'GET') {
    const liveToken = await getLiveCalendarToken(requestBearerToken || undefined);
    const verification = liveToken ? await verifyGoogleCalendarConnection(liveToken) : { connected: false };
    const cb = await getTenantBrand(resolvedTenantId);
    const slotHrs: number[] = [];
    for (let h = cb.workingHoursStart; h < cb.workingHoursEnd; h++) slotHrs.push(h);
    const closedNames = [6, 0, 1, 2, 3, 4, 5].filter((d) => !cb.workingDays.includes(d)).map((d) => ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d]);
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        configured: Boolean(liveToken),
        connected: verification.connected,
        targetAccount: cb.calendarEmail,
        timezone: cb.timezone,
        workingDays: `${brandWorkingDaysLabel(cb).replace(' to ', ' – ')}${closedNames.length ? ` (${closedNames.join(' & ')} closed)` : ''}`,
        workingHours: `${fmtHour(cb.workingHoursStart)} – ${fmtHour(cb.workingHoursEnd)} ${brandTzLabel(cb)}`,
        durationMinutes: 60,
        fixedSlots: slotHrs.map((h) => `${h}:00 – ${h + 1}:00 ${brandTzLabel(cb)}`),
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  if ((url === '/api/calendar/availability' || url.startsWith('/api/calendar/availability?')) && req.method === 'GET') {
    const parsedUrl = new URL(url, 'http://localhost:3000');
    const preferredDate = parsedUrl.searchParams.get('date') || parsedUrl.searchParams.get('preferredDate') || undefined;
    const preferredPeriod = (parsedUrl.searchParams.get('period') as any) || 'ANY';
    const count = parseInt(parsedUrl.searchParams.get('count') || '8', 10);

    const slots = await findNextAvailableSlots({
      preferredDate,
      preferredPeriod,
      maxSlotsToReturn: count,
      accessToken: requestBearerToken || undefined,
    });

    const ab = await getTenantBrand(resolvedTenantId);
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        targetAccount: ab.calendarEmail,
        timezone: ab.timezone,
        workingHours: `${fmtHour(ab.workingHoursStart)} – ${fmtHour(ab.workingHoursEnd)} ${brandTzLabel(ab)} (${brandWorkingDaysLabel(ab)})`,
        slots,
        totalAvailable: slots.length,
      })
    );
    return true;
  }

  if (url === '/api/calendar/bookings' && req.method === 'GET') {
    const bookings = await getAllBookings();
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, bookings, count: bookings.length }));
    return true;
  }

  if (url === '/api/calendar/book' && req.method === 'POST') {
    try {
      const bookingPayload = {
        ...body,
        accessToken: body.accessToken || requestBearerToken || undefined,
      };
      const result = await createGoogleCalendarDemoBooking(bookingPayload);
      res.statusCode = result.success ? 200 : (result.conflict ? 409 : 400);
      res.end(JSON.stringify(result));
    } catch (err: any) {
      res.statusCode = 500;
      res.end(JSON.stringify({ success: false, error: err?.message || 'Booking failed' }));
    }
    return true;
  }

  if (url === '/api/calendar/cancel' && req.method === 'POST') {
    const { bookingId, reason } = body;
    if (!bookingId) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'bookingId is required' }));
      return true;
    }
    const result = await cancelDemoBooking(bookingId, reason);
    res.statusCode = result.success ? 200 : 400;
    res.end(JSON.stringify(result));
    return true;
  }

  if (url === '/api/calendar/reschedule' && req.method === 'POST') {
    const { bookingId, newStartIso, newEndIso, newDateString, newStartTime, newEndTime } = body;
    if (!bookingId || !newStartIso || !newEndIso) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'bookingId, newStartIso, and newEndIso are required' }));
      return true;
    }
    const result = await rescheduleDemoBooking(
      bookingId,
      newStartIso,
      newEndIso,
      newDateString,
      newStartTime,
      newEndTime,
      body.accessToken || requestBearerToken || undefined
    );
    res.statusCode = result.success ? 200 : 400;
    res.end(JSON.stringify(result));
    return true;
  }

  if (url === '/api/calendar/schedule-turn' && req.method === 'POST') {
    try {
      const turnPayload = {
        ...body,
        accessToken: body.accessToken || requestBearerToken || undefined,
      };
      const result = await processSchedulingConversationTurn(turnPayload);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
    } catch (err: any) {
      console.warn('[Schedule Turn Error]:', err?.message || err);
      res.statusCode = 500;
      res.end(JSON.stringify({ handled: false, error: err?.message || 'Scheduling failed' }));
    }
    return true;
  }

  // 1.5. Website Inbound Demo Lead Webhook (/api/webhooks/umrah-demo, /api/leads/webhook, /api/leads/inbound)
  const isWebsiteWebhook =
    url === '/api/webhooks/umrah-demo' ||
    url.startsWith('/api/webhooks/umrah-demo?') ||
    url === '/api/leads/webhook' ||
    url.startsWith('/api/leads/webhook?') ||
    url === '/api/leads/inbound' ||
    url.startsWith('/api/leads/inbound?');

  if (isWebsiteWebhook) {
    if (req.method === 'POST') {
      try {
        console.log('[Inbound Webhook] Received website demo request from umrah360.in:', {
          name: body.fullName || body.name || body.your_full_name,
          email: body.email || body.your_email,
          company: body.companyName || body.company_name || body.company,
          phone: body.phone || body.phoneNumber,
        });

        const result = await processWebsiteLeadSubmission(body);
        res.statusCode = 200;
        res.end(JSON.stringify(result));
        return true;
      } catch (err: any) {
        console.error('[Inbound Webhook] Error processing lead submission:', err);
        res.statusCode = 400;
        res.end(
          JSON.stringify({
            success: false,
            error: err?.message || 'Failed to process website lead submission',
          })
        );
        return true;
      }
    } else if (req.method === 'GET') {
      // Documentation & schema check for developers or webhook monitors
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          service: 'Umrah360 Website Demo Lead Ingestion Webhook',
          status: 'active',
          acceptedMethods: ['POST'],
          description: 'Directly pushes leads from umrah360.in/request-demo form into Firestore DB and CRM pipeline',
          supportedFields: {
            yourDetails: ['fullName (or name, your_full_name)', 'email', 'designation', 'country', 'phone (or phoneNumber)', 'city'],
            aboutYourCompany: ['companyName (or company)', 'website (or companyWebsite)', 'branches (Yes / No)'],
            product: ['product (or select_products, productInterest)', 'teamSize (e.g. 5-10, 10-20, 20+)'],
            messageQuery: ['message (or query, notes)'],
          },
          samplePayload: {
            fullName: 'Mohammad Al-Bakhla',
            email: 'demo@bakhlatours.com',
            designation: 'Managing Director',
            country: 'India',
            phone: '+91 9820252434',
            city: 'Mumbai',
            companyName: 'Bakhla Tours & Travels Pvt. Ltd.',
            website: 'https://bakhlatours.com',
            branches: 'Yes',
            product: 'Umrah ERP & B2B Sub-Agent Portal',
            teamSize: '10-20',
            message: 'We handle 3,500 pilgrims yearly. Interested in B2B booking engine.',
          },
        })
      );
      return true;
    }
  }

  // 2. AI Respond endpoint (/api/ai/respond)
  if ((url === '/api/ai/respond' || url.startsWith('/api/ai/respond?')) && req.method === 'POST') {
    const { incomingMessage, contact, lead, conversation, recentMessages, knowledgeChunks, handoffCheck, signature } = body;
    const brand = await getTenantBrand(resolvedTenantId);
    const isUmrah = brand.playbook === 'umrah360';
    const defSig = brandSignature(brand);

    // If handoff was already identified as necessary by rule
    if (handoffCheck?.shouldHandoff) {
      const isTwentyUsers = isUmrah && (incomingMessage?.toLowerCase().includes('20') || incomingMessage?.toLowerCase().includes('enterprise'));
      const handoffResponse = isTwentyUsers
        ? `Thank you for your interest, ${contact?.firstName || 'there'}! For teams of 20+ users, our Enterprise tier includes dedicated cloud hosting, unlimited B2B sub-agent capacity, and custom onboarding.\n\nBecause Enterprise accounts are customized to your agency's transaction volume, I have connected our Senior Solutions Specialist to share a tailored proposal and schedule a short walkthrough. Someone will reach out to you shortly.\n\n${signature || defSig}`
        : `I don't have confirmed information on that specific detail in our verified documentation. I'll connect you directly with our ${isUmrah ? 'senior pilgrimage operations' : 'specialist'} team so they can assist you personally.\n\n${signature || defSig}`;

      res.statusCode = 200;
      res.end(
        JSON.stringify({
          responseText: handoffResponse,
          confidence: 0.95,
          knowledgeSources: knowledgeChunks?.map((c: any) => c.title) || (isUmrah ? ['Umrah360 Sales Policy'] : []),
          humanHandoffTriggered: true,
          handoffReason: handoffCheck.reason,
          classification: 'PRICING_REQUEST',
          leadQualification: {
            isLead: true,
            leadScore: Math.min(100, (lead?.leadScore || 65) + 15),
            intent: 'HIGH',
            buyingStage: 'CONSIDERATION',
            requirements: [...(lead?.requirements || []), ...(isUmrah ? ['Enterprise 20+ seats'] : []), 'Custom quote'],
            budget: 'Enterprise Quote Required',
            timeline: 'Immediate',
            nextAction: 'Senior specialist follow-up for 20-seat Enterprise quote',
          },
          memoryUpdate: {
            customerFacts: [`Interested in ${brand.companyName} for ${contact?.companyName || 'agency'}`, ...(isUmrah ? ['Inquired about 20-user Enterprise plan'] : [])],
            requirements: ['20+ user seats', 'Custom quote'],
            buyingStage: 'CONSIDERATION',
            nextAction: 'Human handoff - custom pricing quote',
          },
        })
      );
      return true;
    }

    // If OpenAI API Key (or fallback key) is available, invoke gpt-4o-mini
    const openAiApiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (openAiApiKey) {
      try {
        const openai = new OpenAI({ apiKey: openAiApiKey });
        const umrahSystemInstruction = `You are the AI conversation engine for Umrah360 (www.umrah360.in), the leading all-in-one ERP and CRM platform for Hajj and Umrah tour operators.
CRITICAL RULES:
1. Ground your responses strictly in the provided Approved Knowledge Chunks. NEVER fabricate features, pricing, or guarantees.
2. If the user asks for pricing for 20 users or large enterprise plans, you MUST NOT quote arbitrary numbers. State that Enterprise tiers for 20+ users require a tailored volume quote and will be handled by a specialist.
3. Keep your reply concise, professional, warm, and helpful.
4. Channel: ${conversation?.channel || 'EMAIL'}.
5. Match the customer's language and tone. Do not repeat greeting if already mid-thread.
6. EMAIL FORMATTING & GREETING RULES (MANDATORY): Never use Markdown symbols in email replies. Do NOT use **, ##, ###, *, backticks, or similar formatting symbols. Write emails as natural, professional plain text. ALWAYS use formal professional greetings (e.g., "Dear [Name]," or "Hello [Name],"). NEVER use Muslim/religious greetings such as "Assalamu Alaikum", "Walaikum Assalam", "Salam", etc.
7. Sign off with: ${signature || defSig}`;
        const genericSystemInstruction = `You are the AI conversation engine for ${brandIntro(brand)}${brand.industryDescription ? `, serving ${brand.industryDescription}` : ''}.
CRITICAL RULES:
1. Ground your responses strictly in the provided Approved Knowledge Chunks. NEVER fabricate features, pricing, or guarantees. If the answer is not in the chunks, say a specialist from ${brand.companyName} will follow up.
2. Keep your reply concise, professional, warm, and helpful.
3. Channel: ${conversation?.channel || 'EMAIL'}.
4. Match the customer's language and tone. Do not repeat greeting if already mid-thread.
5. FORMATTING (MANDATORY): Never use Markdown symbols (**, ##, ###, *, backticks). Write natural plain text with a formal greeting (e.g., "Dear [Name],").
6. Sign off with: ${signature || defSig}`;
        const systemInstruction = isUmrah ? umrahSystemInstruction : genericSystemInstruction;

        const contextPrompt = `
CONTACT PROFILE:
Name: ${contact?.firstName} ${contact?.lastName}
Company: ${contact?.companyName}
Title: ${contact?.jobTitle}

CONVERSATION SUMMARY:
${conversation?.conversationSummary || `Ongoing dialogue regarding ${brand.companyName}.`}

APPROVED KNOWLEDGE CHUNKS:
${knowledgeChunks?.map((c: any) => `[${c.title}]: ${c.relevantExcerpt}`).join('\n\n') || (isUmrah ? 'General Umrah360 pilgrimage software information.' : 'No specific knowledge excerpts available.')}

RECENT THREAD MESSAGES:
${recentMessages?.map((m: any) => `${m.senderName}: ${m.text}`).join('\n') || 'None'}

CURRENT INCOMING MESSAGE:
"${incomingMessage}"

Generate a helpful, accurate, grounded response adhering to all rules.`;

        const candidateModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
        let generatedText = '';

        for (const modelName of candidateModels) {
          try {
            const completion = await openai.chat.completions.create({
              model: modelName,
              messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: contextPrompt },
              ],
              temperature: 0.3,
            });

            const content = completion.choices[0]?.message?.content?.trim() || '';
            if (content.length > 20) {
              generatedText = content;
              break;
            }
          } catch (modelErr: any) {
            console.warn(`[OpenAI Respond ${modelName}] Notice:`, modelErr?.message || modelErr);
          }
        }

        if (generatedText) {
          generatedText = sanitizeAiEmailText(generatedText, contact?.firstName);
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              responseText: generatedText,
              confidence: 0.96,
              knowledgeSources: knowledgeChunks?.map((c: any) => c.title) || [],
              humanHandoffTriggered: false,
              classification: 'QUESTION',
              leadQualification: {
                isLead: true,
                leadScore: Math.min(100, (lead?.leadScore || 60) + 10),
                intent: 'HIGH',
                buyingStage: 'CONSIDERATION',
                requirements: lead?.requirements || (isUmrah ? ['Umrah360 Core Suite'] : []),
                budget: lead?.budget || null,
                timeline: lead?.timeline || 'Upcoming season',
                nextAction: 'Offer live platform walkthrough',
              },
              memoryUpdate: {
                customerFacts: [`Inquired about ${brand.companyName} capabilities for ${contact?.companyName}`],
                requirements: lead?.requirements || (isUmrah ? ['B2B / FIT Package Management'] : []),
                buyingStage: 'CONSIDERATION',
                nextAction: 'Offer live platform walkthrough',
              },
            })
          );
          return true;
        }
      } catch (openAiError) {
        console.warn('OpenAI API call failed, using fallback:', openAiError);
      }
    }

    // Fallback response if Gemini API key is missing or errored
    const isPilgrimRetail = /myself|family|retail|booking experience|customized package|customize a package|makkah.*hotel|flight.*hotel|transfer.*meal|online payment|direct booking/i.test(incomingMessage || '');
    const isB2b = incomingMessage?.toLowerCase().includes('b2b') || incomingMessage?.toLowerCase().includes('agent');
    const isPricing = incomingMessage?.toLowerCase().includes('price') || incomingMessage?.toLowerCase().includes('cost');
    let responseText = '';

    if (!isUmrah) {
      const excerpt = knowledgeChunks?.[0]?.relevantExcerpt;
      responseText = `Dear ${contact?.firstName || 'Customer'},\n\nThank you for contacting ${brand.companyName}!\n\n${excerpt ? `${excerpt}\n\nCould you share a few more details so we can help you further?` : 'We have received your message and one of our specialists will get back to you shortly. Please share a few details about what you are looking for.'}\n\n${signature || defSig}`;
    } else if (isPilgrimRetail) {
      responseText = `Dear ${contact?.firstName || 'Customer'},\n\nThank you for reaching out to Umrah360!\n\n1. Platform Role: Umrah360 (www.umrah360.in) is the core travel technology and dynamic booking platform that powers licensed Hajj and Umrah travel agencies and tour operators.\n\n2. Real-Time Booking: Travel agencies running on Umrah360 provide online portals where pilgrims can customize complete packages in real time (flights, 3/4/5-star Makkah and Madinah hotels, Haramain train / private VIP GMC transfers, meals, and Saudi e-visas) with live pricing and secure online payments.\n\n3. Booking Fulfillment: Because Umrah360 provides the software to licensed tour operators rather than selling directly as a retail travel agency, packages are fulfilled through our verified partner agencies. We would be delighted to connect you with one of our top certified partner travel agencies in your city!\n\n${signature || defSig}`;
    } else if (isB2b) {
      responseText = `Yes! Umrah360 provides a complete white-label B2B Sub-Agent Portal. It allows tour operators to distribute packages to external travel agents, manage custom multi-tier markups, establish real-time credit wallets, and enable agents to generate branded PDF vouchers instantly with their own agency logo.\n\nWould you like to see how sub-agent allotments and credit limits are configured?\n\n${signature || defSig}`;
    } else if (isPricing) {
      responseText = `Here is our approved subscription pricing:
• Lite Plan: INR 36,000/year (or INR 4,000/month) | International: USD 825/year (up to 5 users) — includes Umrah group package creation, booking management, departure control, visa tracking, proforma invoices, and payment receipts.
• Business Plan: INR 55,000/year (or INR 5,500/month) | International: USD 1,260/year (up to 10 users) — includes everything in Lite plus Hajj/Umrah/Ziarah packages, tent occupancy, CRM & lead funnel, departure-wise P&L, supplier accounts payable, and priority WhatsApp/email support.
• Professional Plan: INR 1,20,000/year (or INR 12,500/month) | International: USD 2,760/year (unlimited users) — includes multi-company Hajj quota, custom approval workflows, full FIT module, and dedicated account manager.

How many team members would be using the software at ${contact?.companyName || 'your agency'}?

${signature || defSig}`;
    } else {
      responseText = `Umrah360 is the unified cloud operating platform purpose-built for Hajj and Umrah tour operators. It connects package creation, group departures, FIT custom packages, passenger manifests, Saudi visa tracking, rooming lists, B2B agent distribution, and departure-level profitability.

Are you currently handling your operations through spreadsheets or looking to upgrade from another system?

${signature || defSig}`;
    }

    responseText = sanitizeAiEmailText(responseText, contact?.firstName);

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        responseText,
        confidence: 0.94,
        knowledgeSources: knowledgeChunks?.map((c: any) => c.title) || [],
        humanHandoffTriggered: false,
        classification: isPricing ? 'PRICING_REQUEST' : 'QUESTION',
        leadQualification: {
          isLead: true,
          leadScore: 85,
          intent: 'HIGH',
          buyingStage: 'CONSIDERATION',
          requirements: isB2b ? ['B2B Sub-Agent Portal', 'Custom Markups'] : ['Package Management'],
          budget: null,
          timeline: 'Within 1 month',
          nextAction: 'Schedule platform demo',
        },
        memoryUpdate: {
          customerFacts: [`Inquired about ${isB2b ? 'B2B agent network' : 'software capabilities'}`],
          requirements: isB2b ? ['B2B Sub-Agent Portal'] : ['Dynamic Package Builder'],
          buyingStage: 'CONSIDERATION',
          nextAction: 'Schedule platform demo',
        },
      })
    );
    return true;
  }

  // 3. AI Qualify endpoint (/api/ai/qualify)
  if ((url === '/api/ai/qualify' || url.startsWith('/api/ai/qualify?')) && req.method === 'POST') {
    const { jobTitle, companyName, industry, location } = body;
    const qBrand = await getTenantBrand(resolvedTenantId);
    const isDecisionMaker = /founder|owner|director|ceo|managing director|partner|proprietor/i.test(jobTitle || '');
    const isPilgrimage =
      qBrand.playbook === 'umrah360'
        ? /umrah|hajj|pilgrimage|travel|tour/i.test(`${industry} ${companyName}`)
        : (qBrand.industryDescription.toLowerCase().split(/[^a-z0-9]+/).filter((w) => w.length > 3).some((w) => `${industry} ${companyName}`.toLowerCase().includes(w)));

    let score = 55;
    if (isDecisionMaker) score += 25;
    if (isPilgrimage) score += 15;
    if (/india|uae|saudi|uk/i.test(location || '')) score += 5;

    const qualified = score >= 75;

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        qualified,
        score,
        reason: qualified
          ? `Relevant decision maker (${jobTitle}) at an Umrah travel company (${companyName}).`
          : `Job title (${jobTitle}) or company (${companyName}) does not meet primary target ICP.`,
        recommended: qualified,
      })
    );
    return true;
  }

  // 4. Knowledge Base CRUD & Synchronization (/api/knowledge)
  if (url === '/api/knowledge' || url.startsWith('/api/knowledge?') || url.startsWith('/api/knowledge/')) {
    await initKnowledgeStore(activeTenantCtx);

    if (req.method === 'GET') {
      const documents = getAllKnowledgeDocs(activeTenantCtx);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, documents, count: documents.length }));
      return true;
    }

    if (req.method === 'POST' || req.method === 'PUT') {
      try {
        const saved = await saveKnowledgeDoc(body, activeTenantCtx);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, document: saved, message: 'Article successfully saved and active in RAG' }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to save knowledge document' }));
      }
      return true;
    }

    if (req.method === 'DELETE') {
      let docId = '';
      const pathMatch = url.match(/^\/api\/knowledge\/([a-zA-Z0-9_-]+)$/);
      if (pathMatch) {
        docId = pathMatch[1];
      } else if (url.includes('?')) {
        const parsedUrl = new URL(url, 'http://localhost');
        docId = parsedUrl.searchParams.get('id') || '';
      }
      if (!docId && body?.id) {
        docId = body.id;
      }

      if (!docId) {
        res.statusCode = 400;
        res.end(JSON.stringify({ success: false, error: 'Knowledge document ID required' }));
        return true;
      }

      const deleted = await deleteKnowledgeDoc(docId, activeTenantCtx);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: deleted, deletedId: docId }));
      return true;
    }
  }

  // 4.5. AI Test Playground (/api/ai/test)
  if ((url === '/api/ai/test' || url.startsWith('/api/ai/test?')) && req.method === 'POST') {
    const { message, contact, lead, conversation, signature } = body;
    const brand = await getTenantBrand(resolvedTenantId);
    const isUmrah = brand.playbook === 'umrah360';
    const defSig = brandSignature(brand);
    const isTwentyUsers = isUmrah && /20 user|twenty|20 seat|enterprise/i.test(message || '');
    const isB2b = isUmrah && /b2b|agent|reseller|wholesaler/i.test(message || '');

    // Retrieve live grounded chunks from memory cache (0ms)
    const chunks = serverRetrieveKnowledge(message || '', 3);
    const knowledgeSources = chunks.map((c) => c.title);

    if (isTwentyUsers) {
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          responseText: `Thank you for your inquiry! For 20+ users, our Enterprise plan provides dedicated cloud infrastructure, custom B2B sub-agent networks, and personalized onboarding. Because this requires custom volume assessment, I'm transferring you to our Senior Solutions Specialist.\n\n${signature || defSig}`,
          confidence: 0.96,
          humanHandoff: true,
          handoffReason: 'Enterprise 20+ users requires custom volume quote',
          leadScore: 95,
          intent: 'HIGH',
          buyingStage: 'DECISION',
          knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : ['Umrah360 Official Subscription Plans & Approved Pricing'],
        })
      );
      return true;
    }

    const openAiKey = process.env.OPENAI_API_KEY || process.env.GEMINI_API_KEY;
    if (openAiKey) {
      try {
        const openai = new OpenAI({ apiKey: openAiKey });
        const systemInstruction = `You are the AI conversation engine for ${isUmrah ? 'Umrah360 (www.umrah360.in)' : brandIntro(brand)}.
CRITICAL RULES:
1. Ground your response strictly in the provided Approved Knowledge Chunks. NEVER fabricate features, pricing, or guarantees.
2. Keep your reply concise, professional, warm, and helpful.
3. Plain text only. No markdown formatting symbols in emails.
4. Sign off with: ${signature || defSig}`;

        const prompt = `APPROVED KNOWLEDGE CHUNKS:
${chunks.map((c) => `[${c.title}]: ${c.relevantExcerpt}`).join('\n\n')}

CUSTOMER MESSAGE:
"${message}"

Generate a helpful, grounded response.`;

        const candidateModels = ['gpt-4o-mini', 'gpt-4o', 'gpt-3.5-turbo'];
        let testResponseText = '';

        for (const modelName of candidateModels) {
          try {
            const completion = await openai.chat.completions.create({
              model: modelName,
              messages: [
                { role: 'system', content: systemInstruction },
                { role: 'user', content: prompt },
              ],
              temperature: 0.3,
            });

            const content = completion.choices[0]?.message?.content?.trim() || '';
            if (content.length > 10) {
              testResponseText = content;
              break;
            }
          } catch (mErr: any) {
            console.warn(`[Playground OpenAI ${modelName}] Notice:`, mErr?.message || mErr);
          }
        }

        if (testResponseText) {
          res.statusCode = 200;
          res.end(
            JSON.stringify({
              responseText: testResponseText,
              confidence: 0.96,
              humanHandoff: false,
              leadScore: isB2b ? 88 : 80,
              intent: 'HIGH',
              buyingStage: 'CONSIDERATION',
              knowledgeSources: knowledgeSources.length > 0 ? knowledgeSources : [`${brand.companyName} Knowledge Base`],
            })
          );
          return true;
        }
      } catch (e) {
        console.warn('AI Test playground Gemini fallback:', e);
      }
    }

    // Dynamic grounded fallback
    let responseText = '';
    if (chunks.length > 0) {
      responseText = `Based on ${brand.companyName}'s verified documentation:\n\n${chunks[0].relevantExcerpt}\n\nPlease let us know if you would like a guided demo or specific details for your agency.\n\n${signature || defSig}`;
    } else if (!isUmrah) {
      responseText = `Thank you for contacting ${brand.companyName}! We have received your message and a specialist will follow up shortly.\n\n${signature || defSig}`;
    } else if (isB2b) {
      responseText = `Yes! Umrah360 includes a full B2B Sub-Agent Portal allowing your partner agencies to search contracted hotel allotments and issue white-label PDF vouchers directly.\n\n${signature || defSig}`;
    } else {
      responseText = `Umrah360 automates pilgrimage tour operations, dynamic package pricing, and Saudi visa workflows.\n\n${signature || defSig}`;
    }

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        responseText,
        confidence: 0.94,
        humanHandoff: false,
        leadScore: isB2b ? 88 : 75,
        intent: 'HIGH',
        buyingStage: 'CONSIDERATION',
        knowledgeSources,
      })
    );
    return true;
  }

  // The shared SMTP/IMAP mailbox settings belong to one workspace (see getImapOwnerTenantId).
  // Other workspaces must never read or change them.
  if (
    /^\/api\/(smtp\/(config|status|verify)|imap\/(config|status|verify|poll))(\?|$)/.test(url) &&
    !isPlatformAdmin &&
    resolvedTenantId !== getImapOwnerTenantId()
  ) {
    res.statusCode = 403;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Mailbox settings are not available for this workspace' }));
    return true;
  }

  // 5. SMTP & Email Sending Operations
  if (url === '/api/smtp/config') {
    if (req.method === 'GET') {
      const config = getSmtpConfig();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          configured: config.configured,
          host: config.host || '',
          port: config.port,
          secure: config.secure,
          user: config.user,
          from: config.from,
          hasPassword: Boolean(config.pass),
          emailProvider: getResendConfig().configured ? 'resend' : 'smtp',
        })
      );
      return true;
    } else if (req.method === 'POST') {
      const updated = updateSmtpConfig({
        host: body.host,
        port: body.port ? parseInt(body.port, 10) : undefined,
        secure: body.secure,
        user: body.user,
        pass: body.pass,
        from: body.from,
      });
      // Also update IMAP password if same user
      if (body.pass) {
        updateImapConfig({
          user: body.user || updated.user,
          pass: body.pass,
        });
      }
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          configured: updated.configured,
          host: updated.host,
          port: updated.port,
          user: updated.user,
          hasPassword: Boolean(updated.pass),
        })
      );
      return true;
    }
  }

  if (url === '/api/smtp/status' && req.method === 'GET') {
    const config = getSmtpConfig();
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        configured: config.configured,
        host: config.host || '(not set)',
        port: config.port,
        secure: config.secure,
        user: config.user,
        from: config.from,
        passConfigured: Boolean(config.pass),
        hasPassword: Boolean(config.pass),
        emailProvider: getResendConfig().configured ? 'resend' : 'smtp',
      })
    );
    return true;
  }

  if (url === '/api/smtp/verify' && req.method === 'POST') {
    const result = await verifySmtpConnection();
    res.statusCode = result.verified ? 200 : 400;
    res.end(JSON.stringify({ success: result.verified, ...result }));
    return true;
  }

  if ((url === '/api/smtp/send' || url === '/api/email/send') && req.method === 'POST') {
    const { to, subject, html, text, inReplyTo, conversationId, leadId, senderName } = body;
    if (!to || !subject || (!html && !text)) {
      res.statusCode = 400;
      res.end(JSON.stringify({ success: false, error: 'Missing to, subject, or message body' }));
      return true;
    }

    const sendResult = await sendLiveEmail({
      tenantId: activeTenantCtx.tenantId,
      to,
      subject,
      html,
      text,
      inReplyTo,
    });

    if (sendResult.success) {
      if (conversationId) {
        appendOutboundMessageToThread(conversationId, {
          text: text || (html ? html.replace(/<[^>]*>?/gm, '') : ''),
          to,
          subject,
          externalMessageId: sendResult.messageId,
          senderName: senderName || (await getTenantBrand(resolvedTenantId)).aiAgentName,
        });
      }
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, messageId: sendResult.messageId }));
      return true;
    } else {
      res.statusCode = 502;
      res.end(JSON.stringify({ success: false, error: sendResult.error }));
      return true;
    }
  }

  // 6. IMAP Operations
  if (url === '/api/imap/config') {
    if (req.method === 'GET') {
      const config = getImapConfig();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          configured: config.configured,
          host: config.host || '',
          port: config.port,
          secure: config.secure,
          user: config.user,
          hasPassword: Boolean(config.pass),
        })
      );
      return true;
    } else if (req.method === 'POST') {
      const updated = updateImapConfig({
        host: body.host,
        port: body.port ? parseInt(body.port, 10) : undefined,
        secure: body.secure,
        user: body.user,
        pass: body.pass,
      });
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          configured: updated.configured,
          host: updated.host,
          port: updated.port,
          user: updated.user,
          hasPassword: Boolean(updated.pass),
        })
      );
      return true;
    }
  }
  if (url === '/api/imap/status' && req.method === 'GET') {
    const config = getImapConfig();
    res.statusCode = 200;
    res.end(
      JSON.stringify({
        configured: config.configured,
        host: config.host || '(not set)',
        port: config.port,
        secure: config.secure,
        user: config.user,
        passConfigured: Boolean(config.pass),
      })
    );
    return true;
  }

  if (url === '/api/imap/verify' && req.method === 'POST') {
    const result = await checkImapStatus();
    res.statusCode = result.verified ? 200 : 400;
    res.end(JSON.stringify({ success: result.verified, ...result }));
    return true;
  }

  if (url === '/api/imap/poll' && req.method === 'POST') {
    const result = await pollAndProcessImapMailbox(activeTenantCtx);
    res.statusCode = result.success ? 200 : 500;
    res.end(JSON.stringify(result));
    return true;
  }

  // 7. Inbound Email Webhook & Mailbox Sync
  if ((url === '/api/inbound/sync' || url === '/api/inbound/history') && (req.method === 'GET' || req.method === 'POST')) {
    // Poll IMAP mailbox on demand if configured
    const imapCfg = getImapConfig();
    if (imapCfg.configured) {
      await pollAndProcessImapMailbox(activeTenantCtx).catch((err) => {
        console.warn('IMAP on-demand poll notice in /api/inbound/sync:', err);
      });
    }

    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        success: true,
        history: getRecentProcessedEmails(activeTenantCtx.tenantId),
        allThreadMessages: getAllThreadMessages(activeTenantCtx.tenantId),
        turnStates: getConversationTurnStates(activeTenantCtx.tenantId),
        timestamp: new Date().toISOString(),
      })
    );
    return true;
  }

  if (url === '/api/inbound/config') {
    if (req.method === 'GET') {
      res.statusCode = 200;
      res.end(JSON.stringify(getPipelineConfig()));
      return true;
    }
    if (req.method === 'POST' || req.method === 'PATCH') {
      const updated = updatePipelineConfig(body);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, config: updated }));
      return true;
    }
  }

  if (url === '/api/inbound/email' && req.method === 'POST') {
    const { from, fromName, to, subject, body: emailBody, companyName, phone, inReplyTo, references, messageId, isTestSimulation } = body;

    const result = await processLiveInboundEmail({
      from,
      fromName,
      to,
      subject,
      body: emailBody,
      companyName,
      phone,
      inReplyTo,
      references,
      messageId,
      isTestSimulation,
    });

    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, result }));
    return true;
  }

  // 8. Meta WhatsApp Cloud API Webhook Handshake & Message Ingestion
  if (
    url.startsWith('/api/inbound/whatsapp') ||
    url.startsWith('/api/whatsapp/inbound') ||
    url.startsWith('/api/whatsapp/webhook') ||
    url.startsWith('/api/whatsapp/status')
  ) {
    // Meta WhatsApp Cloud API verification handshake (GET with hub.challenge or hub.mode)
    if (
      req.method === 'GET' &&
      (url.includes('hub.challenge') ||
        url.includes('hub_challenge') ||
        url.includes('hub.mode') ||
        url.includes('hub_mode'))
    ) {
      const parsedUrl = new URL(url, 'http://localhost:3000');
      const mode = parsedUrl.searchParams.get('hub.mode') || parsedUrl.searchParams.get('hub_mode');
      const verifyToken =
        parsedUrl.searchParams.get('hub.verify_token') || parsedUrl.searchParams.get('hub_verify_token');
      const challenge =
        parsedUrl.searchParams.get('hub.challenge') || parsedUrl.searchParams.get('hub_challenge');
      const expectedToken =
        process.env.META_WEBHOOK_VERIFY_TOKEN ||
        process.env.WHATSAPP_VERIFY_TOKEN ||
        'umrah360_webhook_token';

      if (verifyToken && verifyToken !== expectedToken) {
        console.warn('[WhatsApp Webhook] Invalid verify_token provided by Meta:', verifyToken);
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        res.end('Forbidden: Invalid verification token');
        return true;
      }

      console.log('[WhatsApp Webhook] Meta challenge verification succeeded. Responding with challenge:', challenge);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      res.end(challenge || 'ok');
      return true;
    }

    if (url === '/api/inbound/whatsapp/status' || url === '/api/whatsapp/status' || url.startsWith('/api/whatsapp/status?')) {
      const gateway = getWhatsAppGatewayStatus();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          targetNumber: TARGET_WHATSAPP_NUMBER,
          formattedNumber: TARGET_WHATSAPP_NUMBER_DISPLAY,
          gateway,
          timestamp: new Date().toISOString(),
        })
      );
      return true;
    }

    if (url === '/api/inbound/whatsapp/history' || url.startsWith('/api/whatsapp/history')) {
      const history = getRecentProcessedWhatsAppMessages();
      const turnStates = getWhatsAppTurnStates();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          targetNumber: TARGET_WHATSAPP_NUMBER,
          formattedNumber: TARGET_WHATSAPP_NUMBER_DISPLAY,
          history,
          turnStates,
          timestamp: new Date().toISOString(),
        })
      );
      return true;
    }

    if (url === '/api/inbound/whatsapp/config') {
      if (req.method === 'GET') {
        res.statusCode = 200;
        res.end(JSON.stringify(getWhatsAppPipelineConfig()));
        return true;
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        const updated = updateWhatsAppPipelineConfig(body);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, config: updated }));
        return true;
      }
    }

    if (req.method === 'GET') {
      const cfg = getWhatsAppPipelineConfig();
      const gateway = getWhatsAppGatewayStatus();
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          service: 'Umrah360 Inbound WhatsApp Webhook',
          status: 'online',
          targetNumber: TARGET_WHATSAPP_NUMBER,
          formattedNumber: TARGET_WHATSAPP_NUMBER_DISPLAY,
          gateway,
          config: cfg,
        })
      );
      return true;
    }

    // Process POST WhatsApp message
    if (req.method === 'POST') {
      const result = await processLiveInboundWhatsApp(body);
      res.statusCode = 200;
      res.end(JSON.stringify(result));
      return true;
    }
  }

  // 9. Campaign Management Endpoints
  // Templates endpoints (supports both /api/templates and /api/campaign-templates)
  if ((url === '/api/templates' || url === '/api/campaign-templates') && req.method === 'GET') {
    await initCampaignStore();
    const tpls = await getTemplatesFromDbOrCache();
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, templates: tpls }));
    return true;
  }

  if ((url === '/api/templates' || url === '/api/campaign-templates') && req.method === 'POST') {
    try {
      await initCampaignStore();
      const saved = await saveTemplate(body);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, template: saved }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to save template' }));
    }
    return true;
  }

  const templateMatch = url.match(/^\/api\/(?:campaign-)?templates\/([a-zA-Z0-9_-]+)$/);
  if (templateMatch) {
    const templateId = templateMatch[1];
    await initCampaignStore();

    if (req.method === 'GET') {
      const tpl = await getTemplateFromDbById(templateId);
      if (!tpl) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Template not found' }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, template: tpl }));
      }
      return true;
    }

    if (req.method === 'DELETE') {
      try {
        await deleteTemplate(templateId);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, deletedTemplateId: templateId }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err?.message || 'Failed to delete template' }));
      }
      return true;
    }
  }

  // Campaigns endpoints
  if (url === '/api/campaigns' && req.method === 'GET') {
    await initCampaignStore(true);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, campaigns: getAllCampaigns() }));
    return true;
  }

  if (url === '/api/campaigns' && req.method === 'POST') {
    try {
      const created = await createCampaign(body);
      res.statusCode = 201;
      res.end(JSON.stringify({ success: true, campaign: created.campaign, leads: created.leads }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to create campaign' }));
    }
    return true;
  }

  if (url === '/api/campaigns/ai-generate-preview' && req.method === 'POST') {
    try {
      const samples = await generateAiSamplePreviews(body.leads || []);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, samples }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to generate AI previews' }));
    }
    return true;
  }

  // =========================================================================
  // AI AUTO FOLLOW-UP (tenant-scoped; every route below requires a signed-in workspace user,
  // except /trigger which also accepts the cron secret)
  // =========================================================================
  if (url === '/api/auto-followup/toggle' && req.method === 'POST') {
    const { lead, conversation, messages, enabled, userName, delayOverride, reason } = body || {};
    if (!lead || !lead.leadId) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: 'lead is required' }));
      return true;
    }
    const badId = (v: any) => typeof v !== 'string' || !v || v.includes('/') || v.length > 200;
    if (badId(lead.leadId) || (conversation?.conversationId !== undefined && badId(conversation.conversationId))) {
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: 'invalid lead or conversation id' }));
      return true;
    }
    try {
      const actor = userEmail || userName || 'Team Member';
      let result: any;
      if (enabled) {
        if (!conversation || !conversation.conversationId) {
          res.statusCode = 400;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'conversation is required to enable follow-up' }));
          return true;
        }
        result = await handleEnableAutoFollowUp(activeTenantCtx, {
          lead,
          conversation,
          messages: Array.isArray(messages) ? messages.slice(-50) : [],
          userName: actor,
          delayOverride: delayOverride || null,
        });
      } else {
        result = await handleDisableAutoFollowUp(activeTenantCtx, {
          lead,
          conversationId: conversation?.conversationId,
          userName: actor,
          reason: reason || 'manual',
        });
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, lead, ...result }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to toggle auto follow-up' }));
    }
    return true;
  }

  if (url === '/api/auto-followup/dashboard' && req.method === 'GET') {
    try {
      const data = await getAutoFollowUpDashboardData(activeTenantCtx);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, ...data }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to load dashboard' }));
    }
    return true;
  }

  if (url === '/api/auto-followup/config') {
    try {
      if (req.method === 'GET') {
        const config = await getAutoFollowUpConfig(activeTenantCtx);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, config }));
        return true;
      }
      if (req.method === 'POST' || req.method === 'PATCH') {
        if (userRole !== 'admin' && !isPlatformAdmin) {
          res.statusCode = 403;
          res.setHeader('Content-Type', 'application/json');
          res.end(JSON.stringify({ success: false, error: 'Only workspace admins can change follow-up settings' }));
          return true;
        }
        const config = await updateAutoFollowUpConfig(activeTenantCtx, body || {});
        res.statusCode = 200;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ success: true, config }));
        return true;
      }
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to handle config' }));
      return true;
    }
  }

  if (url === '/api/auto-followup/trigger-now' && req.method === 'POST') {
    try {
      const result = await runAutoFollowUpWorkerCycle(activeTenantCtx, { force: true });
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, ...result }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to run follow-ups' }));
    }
    return true;
  }

  // Cron / serverless worker: CRON_SECRET (all workspaces) or a signed-in user (own workspace)
  if (url === '/api/auto-followup/trigger' && (req.method === 'POST' || req.method === 'GET')) {
    const cronSecret = process.env.CRON_SECRET;
    const presented = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
    const isCron = Boolean(cronSecret) && presented === cronSecret;
    let callerCtx: TenantContext | null = null;
    let runAll = isCron;
    if (!isCron) {
      const a = await authenticateRequest(req);
      if (!a.ok) {
        res.statusCode = a.status || 401;
        res.end(JSON.stringify({ error: a.error || 'Unauthorized', code: a.code }));
        return true;
      }
      callerCtx = a.ctx!;
      runAll = Boolean(callerCtx.isPlatformAdmin);
    }
    try {
      const results: any[] = [];
      if (runAll) {
        const snap = await getDocs(globalTenantsCol());
        for (const t of snap.docs) {
          const data: any = t.data();
          if (data?.status === 'suspended') continue;
          const ctx: TenantContext = { tenantId: t.id, uid: 'system-cron', email: '', role: 'admin' };
          results.push({ tenantId: t.id, ...(await runAutoFollowUpWorkerCycle(ctx, { force: true })) });
        }
      } else {
        results.push({ tenantId: callerCtx!.tenantId, ...(await runAutoFollowUpWorkerCycle(callerCtx!, { force: true })) });
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, results }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: false, error: err?.message || 'Failed to run follow-ups' }));
    }
    return true;
  }

  if ((url === '/api/campaigns/process-active' || url === '/api/campaigns/cron') && (req.method === 'POST' || req.method === 'GET')) {
    // Who is calling?
    //  - cron (CRON_SECRET) or platform admin -> process EVERY active workspace, one at a time
    //  - a signed-in workspace user           -> process ONLY their own workspace
    const cronSecret = process.env.CRON_SECRET;
    const presented = (req.headers['authorization'] || '').toString().replace(/^Bearer\s+/i, '');
    const isCron = Boolean(cronSecret) && presented === cronSecret;
    let callerCtx: TenantContext | null = null;
    let runAll = isCron;
    if (!isCron) {
      const a = await authenticateRequest(req);
      if (!a.ok) {
        res.statusCode = a.status || 401;
        res.end(JSON.stringify({ error: a.error || 'Unauthorized', code: a.code }));
        return true;
      }
      callerCtx = a.ctx!;
      runAll = Boolean(callerCtx.isPlatformAdmin);
    }

    try {
      const results: any[] = [];
      if (runAll) {
        const snap = await getDocs(globalTenantsCol());
        for (const t of snap.docs) {
          const data: any = t.data();
          if (data?.status === 'suspended') continue;
          setCampaignActiveContext({ tenantId: t.id, uid: 'system-cron', email: '', role: 'admin' });
          results.push({ tenantId: t.id, ...(await processActiveRunningCampaignsBatch(500)) });
        }
      } else {
        setCampaignActiveContext(callerCtx!);
        results.push({ tenantId: callerCtx!.tenantId, ...(await processActiveRunningCampaignsBatch(500)) });
      }
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ success: true, results }));
    } catch (err: any) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: err?.message || 'Failed to process active campaigns' }));
    }
    return true;
  }

  const campaignStartMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/start$/);
  if (campaignStartMatch && req.method === 'POST') {
    const campaignId = campaignStartMatch[1];
    try {
      const started = await startCampaign(campaignId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, campaign: started }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to start campaign' }));
    }
    return true;
  }

  const campaignProcessMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/process$/);
  if (campaignProcessMatch && req.method === 'POST') {
    const campaignId = campaignProcessMatch[1];
    try {
      const batchResult = await processNextCampaignSendBatch(campaignId, 500);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, ...batchResult }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to process campaign batch' }));
    }
    return true;
  }

  const campaignPauseMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/pause$/);
  if (campaignPauseMatch && req.method === 'POST') {
    const campaignId = campaignPauseMatch[1];
    try {
      const paused = await pauseCampaign(campaignId);
      res.statusCode = 200;
      res.end(JSON.stringify({ success: true, campaign: paused }));
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to pause campaign' }));
    }
    return true;
  }

  const campaignRestartPreviewMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/restart-preview$/);
  if (campaignRestartPreviewMatch && req.method === 'GET') {
    const campaignId = campaignRestartPreviewMatch[1];
    await initCampaignStore();
    const camp = getCampaignById(campaignId);
    if (!camp) {
      res.statusCode = 404;
      res.end(JSON.stringify({ error: 'Campaign not found' }));
      return true;
    }
    const leads = getCampaignLeads(campaignId);
    const repliedLeads = leads.filter((l) => l.replyStatus === 'REPLIED');
    const unrepliedLeads = leads.filter((l) => l.replyStatus !== 'REPLIED');
    const allQualified = leads.length > 0 && repliedLeads.length === leads.length;
    const nextRunNumber = (camp.lastRunNumber || 0) + 1;

    res.statusCode = 200;
    res.end(
      JSON.stringify({
        success: true,
        campaignId,
        nextRunNumber,
        totalLeads: leads.length,
        unrepliedCount: unrepliedLeads.length,
        repliedCount: repliedLeads.length,
        allQualified,
        unrepliedLeads,
        repliedLeads,
      })
    );
    return true;
  }

  const campaignRestartMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/restart$/);
  if (campaignRestartMatch && req.method === 'POST') {
    const campaignId = campaignRestartMatch[1];
    try {
      const restarted = await restartCampaign(campaignId, body);
      res.statusCode = 200;
      res.end(
        JSON.stringify({
          success: true,
          campaign: restarted.campaign,
          run: restarted.run,
          targetLeadsCount: restarted.targetLeadsCount,
          alreadyRepliedCount: restarted.alreadyRepliedCount,
          allQualified: restarted.allQualified,
          message: restarted.message,
        })
      );
    } catch (err: any) {
      res.statusCode = 400;
      res.end(JSON.stringify({ error: err?.message || 'Failed to restart campaign' }));
    }
    return true;
  }

  const campaignLeadsMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/leads$/);
  if (campaignLeadsMatch && req.method === 'GET') {
    const campaignId = campaignLeadsMatch[1];
    await initCampaignStore();
    const leads = await getCampaignLeadsFromDb(campaignId);
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, leads }));
    return true;
  }

  const campaignRunsMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)\/runs$/);
  if (campaignRunsMatch && req.method === 'GET') {
    const campaignId = campaignRunsMatch[1];
    await initCampaignStore();
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, runs: getCampaignRuns(campaignId) }));
    return true;
  }

  const campaignSingleMatch = url.match(/^\/api\/campaigns\/([a-zA-Z0-9_-]+)$/);
  if (campaignSingleMatch) {
    const campaignId = campaignSingleMatch[1];
    await initCampaignStore();

    if (req.method === 'GET') {
      const camp = await getCampaignByIdAsync(campaignId);
      if (!camp) {
        res.statusCode = 404;
        res.end(JSON.stringify({ error: 'Campaign not found' }));
      } else {
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, campaign: camp }));
      }
      return true;
    }

    if (req.method === 'DELETE') {
      try {
        await deleteCampaign(campaignId);
        res.statusCode = 200;
        res.end(JSON.stringify({ success: true, deletedCampaignId: campaignId }));
      } catch (err: any) {
        res.statusCode = 400;
        res.end(JSON.stringify({ error: err?.message || 'Failed to delete campaign' }));
      }
      return true;
    }
  }

  const leadStatusMatch = url.match(/^\/api\/campaigns\/lead\/([a-zA-Z0-9_-]+)\/status$/);
  if (leadStatusMatch && (req.method === 'PATCH' || req.method === 'POST')) {
    const leadId = leadStatusMatch[1];
    const { sendStatus, replyStatus, demoStatus, lastError } = body;
    const updated = await updateCampaignLeadStatus({ leadId, sendStatus, replyStatus, demoStatus, lastError });
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, lead: updated }));
    return true;
  }

  const demoStatusMatch = url.match(/^\/api\/campaigns\/lead\/([a-zA-Z0-9_-]+)\/demo-status$/);
  if (demoStatusMatch && req.method === 'PATCH') {
    const leadId = demoStatusMatch[1];
    const { demoStatus, demoSource = 'MANUAL' } = body;
    const updated = await updateLeadDemoStatus({ leadId, demoStatus, demoSource });
    res.statusCode = 200;
    res.end(JSON.stringify({ success: true, lead: updated }));
    return true;
  }

  // Not handled by core API routes
  return false;
}