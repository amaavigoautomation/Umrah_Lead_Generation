import { getDocs, deleteDoc } from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from '../services/knowledgeData.js';
import { KnowledgeDocument } from '../types/index.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

// In-memory knowledge cache keyed strictly by tenantId (prevents cross-tenant RAG leaks)
const tenantKnowledgeCaches = new Map<string, Map<string, KnowledgeDocument>>();
const tenantInitialized = new Set<string>();

function getTenantCache(tenantId: string): Map<string, KnowledgeDocument> {
  let cache = tenantKnowledgeCaches.get(tenantId);
  if (!cache) {
    cache = new Map<string, KnowledgeDocument>();
    tenantKnowledgeCaches.set(tenantId, cache);
  }
  return cache;
}

/**
 * Initializes the in-memory knowledge store from Firestore for the specific tenant
 */
export async function initKnowledgeStore(ctx: TenantContext = DEFAULT_UMRAH_CTX): Promise<number> {
  const cache = getTenantCache(ctx.tenantId);

  // The built-in articles are Umrah360 product content: only that workspace gets them.
  const seedsDefaults = ctx.tenantId === DEFAULT_UMRAH_CTX.tenantId;

  // Pre-populate with standard template knowledge base if empty
  if (seedsDefaults && cache.size === 0) {
    for (const docItem of INITIAL_KNOWLEDGE_DOCUMENTS) {
      cache.set(docItem.id, { ...docItem });
    }
  }

  if (!isFirebaseConfigured || !db) {
    tenantInitialized.add(ctx.tenantId);
    return cache.size;
  }

  try {
    const repo = tenantRepo(ctx);
    const colRef = repo.knowledgeDocuments();
    const snap = await getDocs(colRef);

    if (!snap.empty) {
      cache.clear();
      snap.forEach((d) => {
        const item = d.data() as KnowledgeDocument;
        if (item && item.id) {
          cache.set(item.id, item);
        }
      });
      console.log(`[Knowledge Store] Successfully loaded ${cache.size} articles for tenant ${ctx.tenantId}.`);
    } else {
      if (seedsDefaults) {
        for (const docItem of INITIAL_KNOWLEDGE_DOCUMENTS) {
          await safeSetDoc(repo.knowledgeDocumentDoc(docItem.id), docItem, { merge: true });
        }
        console.log(`[Knowledge Store] Seeded ${INITIAL_KNOWLEDGE_DOCUMENTS.length} initial articles for tenant ${ctx.tenantId}.`);
      } else {
        cache.clear();
      }
    }

    tenantInitialized.add(ctx.tenantId);
    return cache.size;
  } catch (err) {
    console.warn(`[Knowledge Store] Warning during Firestore KB sync for ${ctx.tenantId}:`, err);
    tenantInitialized.add(ctx.tenantId);
    return cache.size;
  }
}

/**
 * Returns all knowledge documents for a tenant
 */
export function getAllKnowledgeDocs(ctx: TenantContext = DEFAULT_UMRAH_CTX): KnowledgeDocument[] {
  const cache = getTenantCache(ctx.tenantId);
  if (ctx.tenantId === DEFAULT_UMRAH_CTX.tenantId && !tenantInitialized.has(ctx.tenantId) && cache.size === 0) {
    for (const docItem of INITIAL_KNOWLEDGE_DOCUMENTS) {
      cache.set(docItem.id, { ...docItem });
    }
  }
  return Array.from(cache.values()).sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
}

/**
 * Returns only PUBLISHED knowledge documents active in RAG for the tenant
 */
export function getPublishedKnowledgeDocs(ctx: TenantContext = DEFAULT_UMRAH_CTX): KnowledgeDocument[] {
  return getAllKnowledgeDocs(ctx).filter((d) => d.status === 'PUBLISHED');
}

/**
 * Returns a single knowledge document by ID for a tenant
 */
export function getKnowledgeDocById(id: string, ctx: TenantContext = DEFAULT_UMRAH_CTX): KnowledgeDocument | undefined {
  const cache = getTenantCache(ctx.tenantId);
  return cache.get(id);
}

/**
 * Saves or updates a knowledge document in memory and persists to tenant's Firestore
 */
export async function saveKnowledgeDoc(
  docData: KnowledgeDocument,
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<KnowledgeDocument> {
  const cache = getTenantCache(ctx.tenantId);
  const sanitizedDoc: KnowledgeDocument = {
    ...docData,
    id: docData.id || `kb-${Date.now()}`,
    title: (docData.title || 'Untitled Knowledge Article').trim(),
    category: docData.category || 'PRODUCT',
    content: (docData.content || '').trim(),
    tags: Array.isArray(docData.tags) ? docData.tags : [ctx.tenantId],
    status: docData.status || 'PUBLISHED',
    version: Number(docData.version) || 1,
    author: docData.author || 'Admin',
    createdAt: docData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. Update tenant cache immediately
  cache.set(sanitizedDoc.id, sanitizedDoc);

  // 2. Persist to Firestore scoped under tenant
  if (isFirebaseConfigured && db) {
    try {
      const repo = tenantRepo(ctx);
      await safeSetDoc(repo.knowledgeDocumentDoc(sanitizedDoc.id), sanitizedDoc, { merge: true });
    } catch (err) {
      console.error(`[Knowledge Store] Error saving doc ${sanitizedDoc.id} in tenant ${ctx.tenantId}:`, err);
    }
  }

  return sanitizedDoc;
}

/**
 * Deletes a knowledge document from tenant memory and Firestore
 */
export async function deleteKnowledgeDoc(id: string, ctx: TenantContext = DEFAULT_UMRAH_CTX): Promise<boolean> {
  if (!id) return false;

  const cache = getTenantCache(ctx.tenantId);
  cache.delete(id);

  if (isFirebaseConfigured && db) {
    try {
      const repo = tenantRepo(ctx);
      await deleteDoc(repo.knowledgeDocumentDoc(id));
    } catch (err) {
      console.warn(`[Knowledge Store] Error deleting doc ${id} for tenant ${ctx.tenantId}:`, err);
    }
  }

  return true;
}

export interface RetrievedChunk {
  documentId: string;
  title: string;
  category: string;
  relevantExcerpt: string;
  score: number;
}

/**
 * Fast in-memory RAG retrieval using published knowledge documents for a tenant
 */
export function retrieveRelevantKnowledge(
  query: string,
  maxResults: number = 3,
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): RetrievedChunk[] {
  const publishedDocs = getPublishedKnowledgeDocs(ctx);

  if (!query || query.trim() === '') {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const queryTokens = normalizedQuery
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 2);

  const intentBoosts: Record<string, string[]> = {
    pricing: ['price', 'pricing', 'cost', 'plan', 'plans', 'lite', 'business', 'professional', 'enterprise', 'users', 'subscription', 'quote', 'discount', 'inr', 'usd'],
    b2b: ['b2b', 'agent', 'agents', 'sub-agent', 'subagent', 'wholesaler', 'reseller', 'markup', 'credit', 'voucher', 'franchise', 'extranet'],
    packages: ['package', 'itinerary', 'fit', 'groups', 'hotel', 'hotels', 'makkah', 'madinah', 'ziyarat', 'transport', 'train', 'bus', 'series', 'departure'],
    visa: ['visa', 'nusuk', 'evisa', 'passport', 'mofa', 'document', 'stamped', 'ocr'],
    invoicing: ['invoice', 'costing', 'vat', 'gst', 'tax', 'tcs', 'forex', 'currency', 'sar', 'ledger', 'receivable', 'payable', 'profitability'],
    faq: ['setup', 'onboarding', 'security', 'time', 'mobile', 'support', 'contract', 'training', 'app', 'marketplace'],
  };

  const scoredDocs = publishedDocs.map((docItem) => {
    let score = 0;
    const docText = `${docItem.title} ${docItem.category} ${docItem.tags.join(' ')} ${docItem.content}`.toLowerCase();

    // 1. Direct term match
    queryTokens.forEach((token) => {
      const occurrences = (docText.match(new RegExp(`\\b${token}\\b`, 'g')) || []).length;
      if (occurrences > 0) {
        score += occurrences * 3;
      } else if (docText.includes(token)) {
        score += 1;
      }
    });

    // 2. Intent matching
    for (const [intent, keywords] of Object.entries(intentBoosts)) {
      const queryMatchesIntent = keywords.some((kw) => normalizedQuery.includes(kw));
      const docMatchesIntent = keywords.some((kw) => docText.includes(kw));
      if (queryMatchesIntent && docMatchesIntent) {
        score += 8;
        if (docItem.category.toLowerCase().includes(intent)) {
          score += 6;
        }
      }
    }

    // 3. Title match boost
    queryTokens.forEach((token) => {
      if (docItem.title.toLowerCase().includes(token)) {
        score += 5;
      }
    });

    // Extract best excerpt
    const paragraphs = docItem.content.split('\n\n');
    let bestParagraph = paragraphs[0] || docItem.content;
    let bestParaScore = 0;

    paragraphs.forEach((p) => {
      let pScore = 0;
      const lowerP = p.toLowerCase();
      queryTokens.forEach((token) => {
        if (lowerP.includes(token)) pScore += 2;
      });
      if (pScore > bestParaScore) {
        bestParaScore = pScore;
        bestParagraph = p;
      }
    });

    return {
      documentId: docItem.id,
      title: docItem.title,
      category: docItem.category,
      relevantExcerpt: bestParagraph.trim(),
      score,
    };
  });

  return scoredDocs
    .filter((d) => d.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, maxResults);
}
