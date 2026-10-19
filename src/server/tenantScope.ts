import type { TenantContext } from '../types/tenant.js';
import { runWithCampaignCtx, enterCampaignCtx } from './campaignService.js';
import { runWithInboundCtx, enterInboundCtx } from './inboundPipeline.js';
import { runWithSchedulingCtx, enterSchedulingCtx } from './demoSchedulingService.js';
import { runWithWhatsAppCtx, enterWhatsAppCtx } from './whatsappInboundPipeline.js';

/**
 * One place that scopes every tenant-aware service to a single tenant.
 *
 * Why: these services used to read a process-wide "active tenant" variable that each API request
 * overwrote. Two requests in flight at once (or a background worker and a request) could see each
 * other's tenant. AsyncLocalStorage keeps the tenant attached to the async call chain instead.
 *
 * - enterTenantScope(ctx): scopes the REST of the current async chain (use at the top of a request handler).
 * - runInTenantScope(ctx, fn): scopes just `fn` (use for workers, webhooks and loops over tenants).
 */
export function enterTenantScope(ctx: TenantContext): void {
  enterCampaignCtx(ctx);
  enterInboundCtx(ctx);
  enterSchedulingCtx(ctx);
  enterWhatsAppCtx(ctx);
}

export function runInTenantScope<T>(ctx: TenantContext, fn: () => Promise<T>): Promise<T> {
  return runWithCampaignCtx(ctx, () =>
    runWithInboundCtx(ctx, () => runWithSchedulingCtx(ctx, () => runWithWhatsAppCtx(ctx, fn)))
  );
}
