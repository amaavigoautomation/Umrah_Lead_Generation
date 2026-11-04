import { getTenantBrand, saveTenantBrand } from './brandService.js';
import type { TenantContext } from '../types/tenant.js';

const EDITABLE_BRAND_KEYS = [
  'companyName',
  'tagline',
  'defaultProduct',
  'industryDescription',
  'websiteUrl',
  'salesEmail',
  'supportPhone',
  'teamName',
  'senderName',
  'aiAgentName',
  'logoUrl',
  'companyDescription',
] as const;

/** Company profile is intentionally limited to basic business identity and contact information. */
export async function getCompanyProfile(ctx: TenantContext) {
  return { brand: await getTenantBrand(ctx.tenantId) };
}

/** Save core profile fields only; product/service/policy knowledge remains in the tenant Knowledge Base. */
export async function saveCompanyProfile(ctx: TenantContext, input: any) {
  const source = input && input.brand && typeof input.brand === 'object' ? input.brand : {};
  const patch: Record<string, any> = {};
  for (const key of EDITABLE_BRAND_KEYS) {
    if (source[key] !== undefined) patch[key] = source[key];
  }

  if (patch.websiteUrl) {
    let parsed: URL;
    try { parsed = new URL(String(patch.websiteUrl)); } catch { throw new Error('Enter a valid company website URL.'); }
    if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
      throw new Error('Company website must use a public HTTP or HTTPS URL.');
    }
    patch.websiteUrl = parsed.toString();
  }

  return { brand: await saveTenantBrand(ctx.tenantId, patch as any) };
}
