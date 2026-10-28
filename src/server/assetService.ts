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

/**
 * Creates seed assets for the tenant if none exist yet.
 */
export async function seedTenantAssetsIfEmpty(ctx: TenantContext): Promise<CompanyAsset[]> {
  const existing = await listTenantAssets(ctx);
  if (existing.length > 0) return existing;

  const isUmrah = ctx.tenantId === 'umrah360';
  const nowIso = new Date().toISOString();

  // SVG high-res badges/placeholders that render instantly and beautifully
  const logoSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 400 100" width="400" height="100">
    <rect width="400" height="100" rx="12" fill="#0f172a"/>
    <circle cx="50" cy="50" r="28" fill="#f59e0b" opacity="0.2"/>
    <circle cx="50" cy="50" r="18" fill="#f59e0b"/>
    <path d="M42 50 L48 56 L58 44" stroke="#ffffff" stroke-width="4" stroke-linecap="round" stroke-linejoin="round" fill="none"/>
    <text x="90" y="58" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="28" fill="#ffffff">${isUmrah ? 'Umrah360' : 'Enterprise CRM'}</text>
    <text x="90" y="76" font-family="system-ui, -apple-system, sans-serif" font-weight="500" font-size="12" fill="#94a3b8">OFFICIAL VERIFIED BADGE</text>
  </svg>`;

  const bannerSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 320" width="800" height="320">
    <defs>
      <linearGradient id="skyGrad" x1="0" y1="0" x2="1" y2="1">
        <stop offset="0%" stop-color="#0f172a"/>
        <stop offset="50%" stop-color="#1e293b"/>
        <stop offset="100%" stop-color="#312e81"/>
      </linearGradient>
    </defs>
    <rect width="800" height="320" rx="16" fill="url(#skyGrad)"/>
    <circle cx="700" cy="80" r="120" fill="#f59e0b" opacity="0.1"/>
    <circle cx="100" cy="240" r="80" fill="#38bdf8" opacity="0.1"/>
    <text x="60" y="120" font-family="system-ui, -apple-system, sans-serif" font-weight="800" font-size="36" fill="#ffffff">Premium VIP Allotments & Packages</text>
    <text x="60" y="165" font-family="system-ui, -apple-system, sans-serif" font-weight="500" font-size="18" fill="#cbd5e1">Exclusive 5-Star Clock Tower & Haram View Suites</text>
    <rect x="60" y="210" width="220" height="46" rx="8" fill="#f59e0b"/>
    <text x="170" y="239" font-family="system-ui, -apple-system, sans-serif" font-weight="700" font-size="15" fill="#0f172a" text-anchor="middle">View Group Rates</text>
  </svg>`;

  const videoThumbSvg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 800 450" width="800" height="450">
    <rect width="800" height="450" rx="14" fill="#090d16"/>
    <circle cx="400" cy="225" r="54" fill="#f59e0b"/>
    <polygon points="390,205 425,225 390,245" fill="#0f172a"/>
    <rect x="40" y="370" width="720" height="44" rx="8" fill="rgba(15,23,42,0.85)"/>
    <text x="60" y="398" font-family="system-ui, -apple-system, sans-serif" font-weight="600" font-size="16" fill="#ffffff">▶ Virtual Walkthrough & Ground Operations Tour</text>
    <text x="730" y="398" font-family="system-ui, -apple-system, sans-serif" font-weight="500" font-size="14" fill="#94a3b8" text-anchor="end">02:45</text>
  </svg>`;

  const seedItems = [
    {
      name: isUmrah ? 'Umrah360 Official Brand Logo' : 'Company Official Brand Logo',
      category: 'LOGO' as AssetCategory,
      mimeType: 'image/svg+xml',
      svg: logoSvg,
      altText: isUmrah ? 'Umrah360 Official Logo' : 'Company Logo',
      dimensions: { width: 400, height: 100 },
    },
    {
      name: isUmrah ? 'Makkah Clock Tower VIP Promo Banner' : 'Exclusive VIP Offering Banner',
      category: 'BANNER' as AssetCategory,
      mimeType: 'image/svg+xml',
      svg: bannerSvg,
      altText: 'VIP Packages & Suites Promo Banner',
      dimensions: { width: 800, height: 320 },
    },
    {
      name: 'Interactive Ground Tour Video Card',
      category: 'VIDEO' as AssetCategory,
      mimeType: 'image/svg+xml',
      svg: videoThumbSvg,
      videoUrl: 'https://www.youtube.com/watch?v=dQw4w9WgXcQ',
      videoDuration: '02:45',
      altText: 'Click to watch ground walkthrough video',
      dimensions: { width: 800, height: 450 },
    },
  ];

  const results: CompanyAsset[] = [];
  for (const item of seedItems) {
    const base64 = Buffer.from(item.svg).toString('base64');
    const dataUrl = `data:${item.mimeType};base64,${base64}`;
    const asset = await saveTenantAsset(ctx, {
      name: item.name,
      category: item.category,
      mimeType: item.mimeType,
      dataUrl,
      videoUrl: item.videoUrl,
      videoDuration: item.videoDuration,
      altText: item.altText,
      dimensions: item.dimensions,
    });
    results.push(asset);
  }

  return results;
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
