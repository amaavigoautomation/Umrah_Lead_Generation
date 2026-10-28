import { authFetch } from './authService';
import type { CompanyAsset, AssetCategory } from '../types';

export async function fetchCompanyAssets(): Promise<CompanyAsset[]> {
  try {
    const res = await authFetch('/api/assets');
    if (!res.ok) {
      throw new Error(`Failed to load assets (HTTP ${res.status})`);
    }
    const data = await res.json();
    return data.assets || [];
  } catch (err) {
    console.warn('[AssetClient] fetchCompanyAssets error:', err);
    return [];
  }
}

export async function uploadCompanyAsset(payload: {
  name: string;
  category: AssetCategory;
  mimeType: string;
  dataUrl: string;
  size?: number;
  dimensions?: { width: number; height: number };
  videoUrl?: string;
  videoDuration?: string;
  altText?: string;
}): Promise<CompanyAsset> {
  const res = await authFetch('/api/assets', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to save asset (HTTP ${res.status})`);
  }

  const data = await res.json();
  return data.asset;
}

export async function deleteCompanyAsset(assetId: string): Promise<boolean> {
  const res = await authFetch(`/api/assets/${encodeURIComponent(assetId)}`, {
    method: 'DELETE',
  });

  if (!res.ok) {
    const errData = await res.json().catch(() => ({}));
    throw new Error(errData.error || `Failed to delete asset (HTTP ${res.status})`);
  }

  const data = await res.json();
  return Boolean(data.success);
}

/**
 * Reads a File object into a base64 Data URL
 */
export function fileToDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = (err) => reject(err);
    reader.readAsDataURL(file);
  });
}

/**
 * Resolves width and height of an image data URL
 */
export function getImageDimensions(dataUrl: string): Promise<{ width: number; height: number }> {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      resolve({ width: img.naturalWidth || 600, height: img.naturalHeight || 400 });
    };
    img.onerror = () => {
      resolve({ width: 600, height: 400 });
    };
    img.src = dataUrl;
  });
}

/**
 * Generates an email-client safe, responsive <img> HTML snippet for the asset.
 */
export function generateImageHtmlSnippet(
  asset: CompanyAsset,
  options?: {
    maxWidth?: number;
    align?: 'center' | 'left' | 'right';
    borderRadius?: number;
    linkUrl?: string;
  }
): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const fullUrl = asset.url.startsWith('http') ? asset.url : `${origin}${asset.url}`;
  const maxWidth = options?.maxWidth || 600;
  const radius = options?.borderRadius ?? 8;
  const alt = asset.altText || asset.name;

  let alignStyle = 'display: block; margin: 16px auto;';
  if (options?.align === 'left') alignStyle = 'display: inline-block; margin: 16px 16px 16px 0;';
  if (options?.align === 'right') alignStyle = 'display: inline-block; margin: 16px 0 16px 16px;';

  const imgTag = `<img src="${fullUrl}" alt="${alt}" width="${Math.min(maxWidth, asset.dimensions?.width || maxWidth)}" style="max-width: 100%; height: auto; border-radius: ${radius}px; ${alignStyle} border: 0;" />`;

  if (options?.linkUrl) {
    return `<a href="${options.linkUrl}" target="_blank" rel="noopener noreferrer" style="display: block; text-decoration: none;">${imgTag}</a>`;
  }

  return imgTag;
}

/**
 * Generates a Brevo / ActiveCampaign style Video Card with a play overlay button.
 * Since email clients do not support inline <video>, this creates a high-converting
 * clickable thumbnail that links to the video.
 */
export function generateVideoCardHtmlSnippet(
  asset: CompanyAsset,
  targetVideoUrl?: string
): string {
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  const fullUrl = asset.url.startsWith('http') ? asset.url : `${origin}${asset.url}`;
  const videoLink = targetVideoUrl || asset.videoUrl || 'https://www.youtube.com';
  const durationBadge = asset.videoDuration ? `<div style="position: absolute; bottom: 12px; right: 12px; background: rgba(0,0,0,0.75); color: #ffffff; padding: 3px 8px; border-radius: 4px; font-size: 11px; font-weight: 600; font-family: sans-serif;">${asset.videoDuration}</div>` : '';

  return `<!-- Email-Safe Video Card (Compatible with Gmail, Outlook, Apple Mail) -->
<table cellpadding="0" cellspacing="0" border="0" style="width: 100%; max-width: 580px; margin: 20px auto; background-color: #0f172a; border-radius: 12px; overflow: hidden;">
  <tr>
    <td align="center" style="padding: 0; position: relative;">
      <a href="${videoLink}" target="_blank" rel="noopener noreferrer" style="display: block; text-decoration: none; position: relative;">
        <img src="${fullUrl}" alt="Watch Video: ${asset.name}" width="580" style="width: 100%; max-width: 580px; height: auto; display: block; border: 0;" />
      </a>
    </td>
  </tr>
  <tr>
    <td style="padding: 12px 18px; background-color: #1e293b; color: #ffffff; font-family: system-ui, -apple-system, sans-serif;">
      <table width="100%" cellpadding="0" cellspacing="0" border="0">
        <tr>
          <td align="left">
            <span style="font-size: 14px; font-weight: 600; color: #f8fafc;">▶ ${asset.name}</span>
          </td>
          <td align="right">
            <a href="${videoLink}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #f59e0b; color: #0f172a; font-size: 12px; font-weight: 700; text-decoration: none; padding: 6px 14px; border-radius: 6px;">Watch Now</a>
          </td>
        </tr>
      </table>
    </td>
  </tr>
</table>`;
}
