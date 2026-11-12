import type { TenantBrand } from './brand';

/**
 * Display labels that plain (non-React) modules export as constants.
 * They are live bindings: BrandProvider updates them whenever the workspace brand changes.
 * Calendar identity is intentionally not derived from a brand default; consumers read verified OAuth status.
 */
export let INBOUND_MAILBOX = 'your connected mailbox';
export let CALENDAR_TARGET_ACCOUNT = '';

export function applyBrandLabels(b: TenantBrand) {
  INBOUND_MAILBOX = b.salesEmail || 'your connected mailbox';
  CALENDAR_TARGET_ACCOUNT = '';
}
