import type { TenantBrand } from './brand';

/**
 * Display labels that plain (non-React) modules export as constants.
 * They are live bindings: BrandProvider updates them whenever the workspace brand changes.
 * Defaults are the Umrah360 values so that workspace is unchanged.
 */
export let INBOUND_MAILBOX = 'amaavigo@gmail.com';
export let CALENDAR_TARGET_ACCOUNT = 'amaavigo@gmail.com';

export function applyBrandLabels(b: TenantBrand) {
  INBOUND_MAILBOX = b.salesEmail || (b.playbook === 'umrah360' ? 'amaavigo@gmail.com' : 'your connected mailbox');
  CALENDAR_TARGET_ACCOUNT = b.calendarEmail || 'your Google account';
}
