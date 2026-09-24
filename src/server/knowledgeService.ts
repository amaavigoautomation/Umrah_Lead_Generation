import { collection, doc, getDocs, deleteDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from '../services/knowledgeData.js';
import { KnowledgeDocument } from '../types/index.js';

// In-memory knowledge cache for ultra-fast (0ms) RAG retrieval and zero impact on reply latency
const knowledgeDocsCache = new Map<string, KnowledgeDocument>();
let isInitialized = false;

/**
 * Initializes the in-memory knowledge store from Firestore on startup,
 * seeding default documentation if Firestore is newly initialized.
 */
export async function initKnowledgeStore(): Promise<number> {
  // Always pre-populate in-memory cache with standard knowledge base first
  for (const docItem of INITIAL_KNOWLEDGE_DOCUMENTS) {
    knowledgeDocsCache.set(docItem.id, { ...docItem });
  }

  if (!isFirebaseConfigured || !db) {
    console.log(`[Knowledge Store] In-memory KB initialized with ${knowledgeDocsCache.size} documents.`);
    isInitialized = true;
    return knowledgeDocsCache.size;
  }

  try {
    const colRef = collection(db, 'knowledge_documents');
    const snap = await getDocs(colRef);

    if (!snap.empty) {
      // Load user customized / published docs from Firestore
      knowledgeDocsCache.clear();
      snap.forEach((d) => {
        const item = d.data() as KnowledgeDocument;
        if (item && item.id) {
          knowledgeDocsCache.set(item.id, item);
        }
      });
      console.log(`[Knowledge Store] Successfully loaded ${knowledgeDocsCache.size} knowledge articles from Firestore.`);
    } else {
      // Seed Firestore with initial knowledge documents
      for (const docItem of INITIAL_KNOWLEDGE_DOCUMENTS) {
        await safeSetDoc(doc(db, 'knowledge_documents', docItem.id), docItem, { merge: true });
      }
      console.log(`[Knowledge Store] Seeded ${INITIAL_KNOWLEDGE_DOCUMENTS.length} initial articles into Firestore.`);
    }

    isInitialized = true;
    return knowledgeDocsCache.size;
  } catch (err) {
    console.warn('[Knowledge Store] Warning during Firestore KB sync, using in-memory baseline:', err);
    isInitialized = true;
    return knowledgeDocsCache.size;
  }
}

/**
 * Returns all knowledge documents from in-memory cache (0ms latency)
 */
export function getAllKnowledgeDocs(): KnowledgeDocument[] {
  if (!isInitialized && knowledgeDocsCache.size === 0) {
    for (const docItem of INITIAL_KNOWLEDGE_DOCUMENTS) {
      knowledgeDocsCache.set(docItem.id, { ...docItem });
    }
  }
  return Array.from(knowledgeDocsCache.values()).sort(
    (a, b) => new Date(b.updatedAt || 0).getTime() - new Date(a.updatedAt || 0).getTime()
  );
}

/**
 * Returns only PUBLISHED knowledge documents active in RAG
 */
export function getPublishedKnowledgeDocs(): KnowledgeDocument[] {
  return getAllKnowledgeDocs().filter((d) => d.status === 'PUBLISHED');
}

/**
 * Returns a single knowledge document by ID
 */
export function getKnowledgeDocById(id: string): KnowledgeDocument | undefined {
  return knowledgeDocsCache.get(id);
}

/**
 * Saves or updates a knowledge document in memory and persists to Firestore.
 * Memory is updated instantly, ensuring 0ms latency for subsequent auto-replies.
 */
export async function saveKnowledgeDoc(docData: KnowledgeDocument): Promise<KnowledgeDocument> {
  const sanitizedDoc: KnowledgeDocument = {
    ...docData,
    id: docData.id || `kb-${Date.now()}`,
    title: (docData.title || 'Untitled Knowledge Article').trim(),
    category: docData.category || 'PRODUCT',
    content: (docData.content || '').trim(),
    tags: Array.isArray(docData.tags) ? docData.tags : ['umrah360'],
    status: docData.status || 'PUBLISHED',
    version: Number(docData.version) || 1,
    author: docData.author || 'Admin',
    createdAt: docData.createdAt || new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  };

  // 1. Update in-memory cache immediately (0ms)
  knowledgeDocsCache.set(sanitizedDoc.id, sanitizedDoc);
  console.log(`[Knowledge Store] Saved doc "${sanitizedDoc.title}" (status: ${sanitizedDoc.status}, version: ${sanitizedDoc.version}) to memory cache.`);

  // 2. Persist to Firestore asynchronously
  if (isFirebaseConfigured && db) {
    try {
      await safeSetDoc(doc(db, 'knowledge_documents', sanitizedDoc.id), sanitizedDoc, { merge: true });
      console.log(`[Knowledge Store] Persisted doc "${sanitizedDoc.id}" to Firestore collection knowledge_documents.`);
    } catch (err) {
      console.error(`[Knowledge Store] Error saving doc ${sanitizedDoc.id} to Firestore:`, err);
    }
  }

  return sanitizedDoc;
}

/**
 * Deletes a knowledge document from memory and Firestore
 */
export async function deleteKnowledgeDoc(id: string): Promise<boolean> {
  if (!id) return false;

  // 1. Remove from memory
  knowledgeDocsCache.delete(id);
  console.log(`[Knowledge Store] Deleted doc "${id}" from memory cache.`);

  // 2. Remove from Firestore
  if (isFirebaseConfigured && db) {
    try {
      await deleteDoc(doc(db, 'knowledge_documents', id));
      console.log(`[Knowledge Store] Deleted doc "${id}" from Firestore.`);
    } catch (err) {
      console.warn(`[Knowledge Store] Error deleting doc ${id} from Firestore:`, err);
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
 * Fast in-memory RAG retrieval using published knowledge documents.
 * Scored using keyword frequency, n-gram matching, domain intent weightings, and title matches.
 */
export function retrieveRelevantKnowledge(
  query: string,
  maxResults: number = 3
): RetrievedChunk[] {
  const publishedDocs = getPublishedKnowledgeDocs();

  if (!query || query.trim() === '') {
    return [];
  }

  const normalizedQuery = query.toLowerCase();
  const queryTokens = normalizedQuery
    .replace(/[^\w\s]/g, '')
    .split(/\s+/)
    .filter((token) => token.length > 2);

  const intentBoosts: Record<string, string[]> = {
    pricing: ['price', 'pricing', 'cost', 'plan', 'plans', 'starter', 'growth', 'enterprise', 'users', 'subscription', 'quote', 'discount'],
    b2b: ['b2b', 'agent', 'agents', 'sub-agent', 'subagent', 'wholesaler', 'reseller', 'markup', 'credit', 'voucher'],
    packages: ['package', 'itinerary', 'fit', 'groups', 'hotel', 'hotels', 'makkah', 'madinah', 'ziyarat', 'transport', 'train', 'bus'],
    visa: ['visa', 'nusuk', 'evisa', 'passport', 'mofa', 'document', 'stamped'],
    invoicing: ['invoice', 'costing', 'vat', 'gst', 'tax', 'forex', 'currency', 'sar', 'ledger'],
    faq: ['setup', 'onboarding', 'security', 'time', 'mobile', 'support', 'contract'],
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
