import type { Channel, ChannelMode } from '../types/index.js';
import { normalizeChannelMode } from '../shared/channelModes.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { getDoc } from './adminFirestore.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

/**
 * Read the selected mode from the current workspace's settings document.
 * The legacy emailMode field remains supported for older workspaces.
 * If Firestore is configured but cannot be read, fail closed rather than
 * accidentally sending an AI response while the workspace is set to OFF.
 */
export async function getTenantChannelMode(
  ctx: TenantContext,
  channel: Channel,
  fallback: ChannelMode = 'AUTO',
): Promise<ChannelMode> {
  const safeFallback = normalizeChannelMode(fallback);
  if (!isFirebaseConfigured) return safeFallback;

  try {
    const snapshot = await getDoc(tenantRepo(ctx).settingsDoc('default'));
    if (!snapshot.exists()) return safeFallback;
    const settings = snapshot.data() as Record<string, any>;
    const configured = settings?.channelModes?.[channel] ?? (channel === 'EMAIL' ? settings?.emailMode : undefined);
    return normalizeChannelMode(configured, safeFallback);
  } catch (error) {
    console.warn(`[Channel Modes] Could not load ${channel} mode for tenant ${ctx.tenantId}; AI is disabled for this message.`, error);
    return 'OFF';
  }
}
