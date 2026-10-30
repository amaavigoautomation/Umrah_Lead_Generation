import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';
import type { CompanyAsset, AssetCategory } from '../types/index.js';
import { isFirebaseConfigured, db } from '../firebase/config.js';
import { getDoc, getDocs, setDoc, deleteDoc, query, orderBy } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';

// In-memory cache for ultra-fast raw asset serving to email clients
interface CachedAsset {
  asset: CompanyAsset;
  buffer: Buffer;
  mimeType: string;
}

const assetMemoryCache = new Map<string, CachedAsset>();

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const sizes = ['B', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return parseFloat((bytes / Math.pow(k, i)).toFixed(1)) + ' ' + sizes[i];
}

const SEED_ASSET_NAMES = new Set([
  'Interactive Ground Tour Video Card',
  'Makkah Clock Tower VIP Promo Banner',
  'Umrah360 Official Brand Logo',
  'Company Official Brand Logo',
  'Exclusive VIP Offering Banner',
]);

/**
 * Creates seed assets for the tenant if none exist yet.
 * (Disabled: returning empty array so no hardcoded seed data is created)
 */
export async function seedTenantAssetsIfEmpty(ctx: TenantContext): Promise<CompanyAsset[]> {
  return listTenantAssets(ctx);
}

/**
 * List all company assets belonging to this tenant.
 */
export async function listTenantAssets(ctx: TenantContext): Promise<CompanyAsset[]> {
  const assets: CompanyAsset[] = [];

  if (isFirebaseConfigured && db) {
    try {
      const snap = await getDocs(tenantRepo(ctx).assets()).catch(() => null);
      if (snap) {
        snap.forEach((d) => {
          const data = d.data() as CompanyAsset;
          if (data && data.id) {
            // Filter out pre-existing seed assets
            if (SEED_ASSET_NAMES.has(data.name?.trim())) {
              // Delete legacy seed asset from Firestore asynchronously
              deleteDoc(tenantRepo(ctx).assetDoc(data.id)).catch(() => {});
              assetMemoryCache.delete(data.id);
              return;
            }
            assets.push(data);
            // Populate memory cache if dataUrl exists
            if (data.dataUrl && !assetMemoryCache.has(data.id)) {
              const base64Part = data.dataUrl.split(',')[1] || '';
              const buf = Buffer.from(base64Part, 'base64');
              assetMemoryCache.set(data.id, {
                asset: data,
                buffer: buf,
                mimeType: data.mimeType || 'image/jpeg',
              });
            }
          }
        });
      }
    } catch (err) {
      console.warn('[AssetService] Firestore list warning:', err);
    }
  }

  // Also check memory cache for any local items
  for (const [id, cached] of assetMemoryCache.entries()) {
    if (SEED_ASSET_NAMES.has(cached.asset.name?.trim())) {
      assetMemoryCache.delete(id);
      continue;
    }
    if (cached.asset.tenantId === ctx.tenantId && !assets.some((a) => a.id === id)) {
      assets.push(cached.asset);
    }
  }

  // Sort newest first
  return assets.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
}

/**
 * Save or upload an asset for a tenant.
 */
export async function saveTenantAsset(
  ctx: TenantContext,
  input: Partial<CompanyAsset> & { dataUrl?: string }
): Promise<CompanyAsset> {
  const tenantId = ctx.tenantId;
  const nowIso = new Date().toISOString();

  const id = input.id || `ast_${tenantId}__${Date.now()}_${Math.random().toString(36).substring(2, 8)}`;
  const mimeType = input.mimeType || (input.dataUrl ? input.dataUrl.split(';')[0].replace('data:', '') : 'image/jpeg');

  // Compute size
  let size = input.size || 0;
  if (!size && input.dataUrl) {
    const base64Part = input.dataUrl.split(',')[1] || '';
    size = Math.round((base64Part.length * 3) / 4);
  }

  const asset: CompanyAsset = {
    id,
    tenantId,
    name: input.name?.trim() || `Asset_${Date.now()}`,
    category: input.category || 'OTHER',
    mimeType,
    size,
    sizeFormatted: formatBytes(size),
    dimensions: input.dimensions || { width: 600, height: 400 },
    url: `/api/assets/${id}/view`,
    dataUrl: input.dataUrl,
    videoUrl: input.videoUrl,
    videoDuration: input.videoDuration,
    altText: input.altText || input.name || 'Company Asset',
    createdAt: input.createdAt || nowIso,
    updatedAt: nowIso,
  };

  // Cache buffer for raw streaming
  if (input.dataUrl) {
    const base64Part = input.dataUrl.split(',')[1] || '';
    const buf = Buffer.from(base64Part, 'base64');
    assetMemoryCache.set(id, {
      asset,
      buffer: buf,
      mimeType,
    });
  }

  // Persist to Firestore
  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(tenantRepo(ctx).assetDoc(id), asset, { merge: true });
    } catch (err) {
      console.error('[AssetService] Firestore write failed:', err);
    }
  }

  return asset;
}

/**
 * Delete a company asset.
 */
export async function deleteTenantAsset(ctx: TenantContext, assetId: string): Promise<boolean> {
  assetMemoryCache.delete(assetId);

  if (isFirebaseConfigured && db) {
    try {
      await deleteDoc(tenantRepo(ctx).assetDoc(assetId));
      return true;
    } catch (err) {
      console.error('[AssetService] Firestore delete failed:', err);
      return false;
    }
  }
  return true;
}

/**
 * Resolves a raw asset buffer by assetId.
 * Asset ID format: `ast_${tenantId}__${uniqueId}`
 */
export async function resolveAssetRaw(
  assetId: string
): Promise<{ buffer: Buffer; mimeType: string; filename: string } | null> {
  const cached = assetMemoryCache.get(assetId);
  if (cached) {
    return {
      buffer: cached.buffer,
      mimeType: cached.mimeType,
      filename: cached.asset.name,
    };
  }

  // If not in cache, resolve tenantId from assetId
  const match = assetId.match(/^ast_([^_]+)__/);
  const tenantId = match ? match[1] : null;

  if (tenantId && isFirebaseConfigured && db) {
    try {
      const mockCtx: TenantContext = {
        tenantId,
        uid: 'asset-resolver',
        email: 'assets@umrah360.in',
        role: 'member',
      };
      const snap = await getDoc(tenantRepo(mockCtx).assetDoc(assetId));
      if (snap.exists()) {
        const data = snap.data() as CompanyAsset;
        if (data.dataUrl) {
          const base64Part = data.dataUrl.split(',')[1] || '';
          const buf = Buffer.from(base64Part, 'base64');
          assetMemoryCache.set(assetId, {
            asset: data,
            buffer: buf,
            mimeType: data.mimeType || 'image/jpeg',
          });
          return {
            buffer: buf,
            mimeType: data.mimeType || 'image/jpeg',
            filename: data.name,
          };
        }
      }
    } catch (err) {
      console.error('[AssetService] Raw asset lookup failed:', err);
    }
  }

  return null;
}
