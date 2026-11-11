import { doc, getDoc, setDoc } from './adminFirestore.js';
import { db } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';

const PRICING_FEED_URL = 'https://models.dev/api.json?type=all';
const PRICING_CACHE_PATH = ['system_settings', 'ai_model_pricing_catalog'] as const;
const REFRESH_INTERVAL_MS = 12 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 6_000;
const FAILED_REFRESH_RETRY_MS = 5 * 60 * 1000;

export interface ModelTokenPricing {
  providerId: string;
  modelId: string;
  modelName: string;
  input?: number;
  output?: number;
  reasoning?: number;
  cacheRead?: number;
  cacheWrite?: number;
  inputImage?: number;
  outputImage?: number;
  inputAudio?: number;
  outputAudio?: number;
  pricingVersion: string;
  fetchedAt: string;
  source: string;
  sourceUrl: string;
}

interface PricingSnapshot {
  fetchedAt: string;
  source: string;
  providers: Record<string, Record<string, ModelTokenPricing>>;
}

let memorySnapshot: PricingSnapshot | null = null;
let refreshInFlight: Promise<PricingSnapshot | null> | null = null;
let lastRefreshAttemptAt = 0;

function asObject(value: unknown): Record<string, any> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
}

function positiveRate(value: unknown): number | undefined {
  if (value === null || value === undefined || value === '') return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

function normalizeProviderId(value: string): string {
  const id = value.trim().toLowerCase();
  if (id === 'gemini' || id === 'google-generative-ai' || id === 'google-ai') return 'google';
  return id;
}

function normalizeModelId(value: string): string {
  return value.trim().toLowerCase().replace(/^models\//, '');
}

function buildSnapshot(payload: unknown, fetchedAt: string): PricingSnapshot {
  const root = asObject(payload);
  const rawProviders = asObject(root.providers);
  const providers = Object.keys(rawProviders).length ? rawProviders : root;
  const normalized: PricingSnapshot['providers'] = {};

  for (const [rawProviderId, rawProvider] of Object.entries(providers)) {
    const provider = asObject(rawProvider);
    const rawModels = asObject(provider.models);
    if (!Object.keys(rawModels).length) continue;

    const providerId = normalizeProviderId(String(provider.id || rawProviderId));
    // Only persist provider catalogues currently used by this application; this keeps the cache document bounded.
    if (providerId !== 'openai' && providerId !== 'google') continue;
    const providerModels: Record<string, ModelTokenPricing> = {};
    for (const [rawModelId, rawModel] of Object.entries(rawModels)) {
      const model = asObject(rawModel);
      const cost = asObject(model.cost || model.pricing);
      const modelId = normalizeModelId(String(model.id || rawModelId));
      const input = positiveRate(cost.input);
      const output = positiveRate(cost.output);
      if (!modelId || (input === undefined && output === undefined)) continue;
      const sourceUrl = String(provider.doc || provider.documentation || `https://models.dev/providers/${providerId}/`);
      providerModels[modelId] = {
        providerId,
        modelId,
        modelName: String(model.name || modelId),
        input,
        output,
        reasoning: positiveRate(cost.reasoning),
        cacheRead: positiveRate(cost.cache_read ?? cost.cacheRead),
        cacheWrite: positiveRate(cost.cache_write ?? cost.cacheWrite),
        inputImage: positiveRate(cost.input_image ?? cost.image_input),
        outputImage: positiveRate(cost.output_image ?? cost.image_output),
        inputAudio: positiveRate(cost.input_audio),
        outputAudio: positiveRate(cost.output_audio),
        pricingVersion: String(model.last_updated || model.updated_at || provider.last_updated || fetchedAt),
        fetchedAt,
        source: PRICING_FEED_URL,
        sourceUrl,
      };
    }
    if (Object.keys(providerModels).length) normalized[providerId] = providerModels;
  }

  return { fetchedAt, source: PRICING_FEED_URL, providers: normalized };
}

function isFresh(snapshot: PricingSnapshot | null): boolean {
  if (!snapshot?.fetchedAt) return false;
  const age = Date.now() - Date.parse(snapshot.fetchedAt);
  return Number.isFinite(age) && age >= 0 && age < REFRESH_INTERVAL_MS;
}

async function readPersistedSnapshot(): Promise<PricingSnapshot | null> {
  if (!isFirebaseConfigured || !db) return null;
  try {
    const snap = await getDoc(doc(db, ...PRICING_CACHE_PATH));
    if (!snap.exists()) return null;
    const data = asObject(snap.data());
    const providers = asObject(data.providers);
    if (!data.fetchedAt || !Object.keys(providers).length) return null;
    return {
      fetchedAt: String(data.fetchedAt),
      source: String(data.source || PRICING_FEED_URL),
      providers: providers as PricingSnapshot['providers'],
    };
  } catch (error) {
    console.warn('[AI Pricing] Could not read cached model pricing:', error);
    return null;
  }
}

async function fetchLatestSnapshot(): Promise<PricingSnapshot | null> {
  try {
    const response = await fetch(PRICING_FEED_URL, {
      headers: { Accept: 'application/json' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    });
    if (!response.ok) throw new Error(`Pricing feed returned HTTP ${response.status}`);
    const snapshot = buildSnapshot(await response.json(), new Date().toISOString());
    if (!Object.keys(snapshot.providers).length) throw new Error('Pricing feed did not contain usable model pricing.');
    if (isFirebaseConfigured && db) {
      await setDoc(doc(db, ...PRICING_CACHE_PATH), snapshot, { merge: false }).catch((error) => {
        console.warn('[AI Pricing] Could not persist refreshed model pricing:', error);
      });
    }
    return snapshot;
  } catch (error) {
    console.warn('[AI Pricing] Pricing feed refresh failed; using the last valid snapshot when available:', error);
    return null;
  }
}

async function getPricingSnapshot(): Promise<PricingSnapshot | null> {
  if (isFresh(memorySnapshot)) return memorySnapshot;
  if (refreshInFlight) return refreshInFlight;
  // A failed refresh uses the last snapshot and avoids retrying the external catalogue for every AI request.
  if (Date.now() - lastRefreshAttemptAt < FAILED_REFRESH_RETRY_MS) return memorySnapshot;
  if (!refreshInFlight) {
    refreshInFlight = (async () => {
      lastRefreshAttemptAt = Date.now();
      const persisted = await readPersistedSnapshot();
      if (isFresh(persisted)) {
        memorySnapshot = persisted;
        return persisted;
      }
      const latest = await fetchLatestSnapshot();
      memorySnapshot = latest || persisted || memorySnapshot;
      return memorySnapshot;
    })().finally(() => {
      refreshInFlight = null;
    });
  }
  return refreshInFlight;
}

/** Resolves current per-million-token rates from the external model catalogue. No rate values are embedded in application code. */
export async function getModelTokenPricing(provider: string, model: string): Promise<ModelTokenPricing | null> {
  const snapshot = await getPricingSnapshot();
  if (!snapshot) return null;
  const providerId = normalizeProviderId(provider);
  const modelId = normalizeModelId(model);
  if (!providerId || !modelId) return null;
  return snapshot.providers[providerId]?.[modelId] || null;
}

/** Exposed for diagnostics/tests; refresh is still performed lazily by the first usage event. */
export async function getModelPricingCatalogStatus(): Promise<{ fetchedAt: string | null; source: string }> {
  const snapshot = await getPricingSnapshot();
  return { fetchedAt: snapshot?.fetchedAt || null, source: snapshot?.source || PRICING_FEED_URL };
}
