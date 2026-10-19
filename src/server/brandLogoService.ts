import { getDoc, setDoc, deleteDoc } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { saveTenantBrand } from './brandService.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Per-brand logo storage.
 *
 * The (small, validated) image bytes live in Firestore under the tenant (`tenants/{id}/settings/brand_logo`)
 * and are served from a public, cached route (`GET /api/brand-logo/:tenantId`). That needs no bucket or IAM
 * setup, so it behaves the same locally and on Vercel. `brand.logoUrl` just points at that route, so every
 * existing place that renders `brand.logoUrl` (header, navbar, login) picks it up unchanged.
 */

export const MAX_LOGO_BYTES = 512 * 1024; // decoded image bytes
const ALLOWED_TYPES = new Set(['image/png', 'image/jpeg', 'image/webp']);

export class LogoError extends Error {
  status = 400;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

const ctxFor = (tenantId: string): TenantContext => ({ tenantId, uid: 'system', email: 'system@brand-logo', role: 'admin' } as TenantContext);
const logoDoc = (tenantId: string) => tenantRepo(ctxFor(tenantId)).settingsDoc('brand_logo');

/** Detects the real image type from the first bytes, so a renamed file or a script can never pass as an image. */
function sniffImageType(buf: Buffer): string | null {
  if (buf.length >= 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) return 'image/png';
  if (buf.length >= 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  if (buf.length >= 12 && buf.subarray(0, 4).toString('ascii') === 'RIFF' && buf.subarray(8, 12).toString('ascii') === 'WEBP') return 'image/webp';
  return null;
}

export function parseLogoDataUrl(input: unknown): { contentType: string; buffer: Buffer } {
  if (typeof input !== 'string' || !input.startsWith('data:')) throw new LogoError('Send the logo as an image data URL');
  const m = input.match(/^data:([a-zA-Z0-9.+/-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!m) throw new LogoError('Logo must be a base64-encoded image');
  const declared = m[1].toLowerCase();
  if (!ALLOWED_TYPES.has(declared)) throw new LogoError('Logo must be a PNG, JPG or WebP image (SVG is not allowed)');
  // Cheap size check before decoding: base64 is ~4/3 of the raw size.
  if (m[2].length > Math.ceil((MAX_LOGO_BYTES * 4) / 3) + 8) throw new LogoError('Logo is too large (max 512 KB)', 413);
  const buffer = Buffer.from(m[2], 'base64');
  if (buffer.length === 0) throw new LogoError('Logo is empty');
  if (buffer.length > MAX_LOGO_BYTES) throw new LogoError('Logo is too large (max 512 KB)', 413);
  const real = sniffImageType(buffer);
  if (!real) throw new LogoError('That file is not a valid PNG, JPG or WebP image');
  return { contentType: real, buffer };
}

const baseUrl = () => String(process.env.APP_URL || '').trim().replace(/\/+$/, '');

export function logoUrlFor(tenantId: string, version: number): string {
  return `${baseUrl()}/api/brand-logo/${encodeURIComponent(tenantId)}?v=${version}`;
}

export async function saveTenantLogo(tenantId: string, dataUrl: unknown) {
  if (!isFirebaseConfigured) throw new LogoError('Storage is not configured on this server', 503);
  const { contentType, buffer } = parseLogoDataUrl(dataUrl);
  const updatedAt = Date.now();
  await setDoc(logoDoc(tenantId), {
    contentType,
    dataBase64: buffer.toString('base64'),
    size: buffer.length,
    updatedAt,
  });
  logoCache.delete(tenantId);
  const brand = await saveTenantBrand(tenantId, { logoUrl: logoUrlFor(tenantId, updatedAt) });
  return brand;
}

export async function deleteTenantLogo(tenantId: string) {
  if (isFirebaseConfigured) {
    await deleteDoc(logoDoc(tenantId)).catch(() => {});
  }
  logoCache.delete(tenantId);
  return saveTenantBrand(tenantId, { logoUrl: '' });
}

const logoCache = new Map<string, { value: StoredLogo | null; at: number }>();
const LOGO_CACHE_MS = 60_000;

export interface StoredLogo {
  contentType: string;
  buffer: Buffer;
  updatedAt: number;
}

export async function getTenantLogo(tenantId: string): Promise<StoredLogo | null> {
  if (!/^[a-z0-9_-]+$/i.test(tenantId) || !isFirebaseConfigured) return null;
  const hit = logoCache.get(tenantId);
  if (hit && Date.now() - hit.at < LOGO_CACHE_MS) return hit.value;
  let value: StoredLogo | null = null;
  try {
    const snap = await getDoc(logoDoc(tenantId));
    if (snap.exists()) {
      const d: any = snap.data();
      const buffer = Buffer.from(String(d.dataBase64 || ''), 'base64');
      // Re-check on the way out too: only ever serve bytes that are really an allowed image type.
      const real = sniffImageType(buffer);
      if (real && ALLOWED_TYPES.has(real) && buffer.length <= MAX_LOGO_BYTES) {
        value = { contentType: real, buffer, updatedAt: Number(d.updatedAt) || 0 };
      }
    }
  } catch {
    value = null;
  }
  logoCache.set(tenantId, { value, at: Date.now() });
  return value;
}
