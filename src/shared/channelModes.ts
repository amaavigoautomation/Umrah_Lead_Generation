import type { Channel, ChannelMode } from '../types';

export const CHANNELS: readonly Channel[] = [
  'WHATSAPP',
  'EMAIL',
  'INSTAGRAM',
  'FACEBOOK',
  'LINKEDIN',
  'WEBSITE',
];

/** Accept legacy SIMULATION settings as OFF so existing workspaces migrate safely. */
export function normalizeChannelMode(value: unknown, fallback: ChannelMode = 'AUTO'): ChannelMode {
  const mode = String(value ?? '').trim().toUpperCase();
  if (mode === 'AUTO' || mode === 'REVIEW' || mode === 'OFF') return mode;
  if (mode === 'SIMULATION') return 'OFF';
  return fallback;
}

export function isSupportedChannelMode(value: unknown): boolean {
  const mode = String(value ?? '').trim().toUpperCase();
  return mode === 'AUTO' || mode === 'REVIEW' || mode === 'OFF' || mode === 'SIMULATION';
}

/** Build a complete channel map while preserving defaults for older settings documents. */
export function normalizeChannelModes(
  value: unknown,
  fallback: Partial<Record<Channel, unknown>> = {},
): Record<Channel, ChannelMode> {
  const source = value && typeof value === 'object' ? value as Record<string, unknown> : {};
  const modes = {} as Record<Channel, ChannelMode>;
  for (const channel of CHANNELS) {
    modes[channel] = normalizeChannelMode(source[channel] ?? fallback[channel], 'AUTO');
  }
  return modes;
}
