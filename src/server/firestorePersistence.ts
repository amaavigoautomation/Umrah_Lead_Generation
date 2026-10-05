import crypto from 'crypto';
import {
  getDoc,
  getDocs,
  query,
  where,
  limit,
} from './adminFirestore.js';
import { isFirebaseConfigured } from '../firebase/config.js';
import { db } from './adminFirestore.js';
import { safeSetDoc } from './firestoreUtils.js';
import { tenantRepo } from './tenantRepo.js';
import type { TenantContext } from '../types/tenant.js';

export interface PersistentProcessedEmailRecord {
  messageId: string;
  cleanKey: string;
  fromEmail: string;
  subject: string;
  aiReplied: boolean;
  repliedAt?: string;
  replyMessageId?: string;
  status: 'PROCESSED' | 'REPLIED' | 'SKIPPED' | 'BASELINE';
  reason?: string;
  timestamp: string;
}

// In-memory cache keyed strictly by tenantId to prevent any cross-tenant state leakage
interface TenantMemoryIdempotency {
  processed: Set<string>;
  replied: Set<string>;
  loaded: boolean;
}

const tenantMemoryCaches = new Map<string, TenantMemoryIdempotency>();

function getTenantCache(tenantId: string): TenantMemoryIdempotency {
  let cache = tenantMemoryCaches.get(tenantId);
  if (!cache) {
    cache = {
      processed: new Set<string>(),
      replied: new Set<string>(),
      loaded: false,
    };
    tenantMemoryCaches.set(tenantId, cache);
  }
  return cache;
}

const DEFAULT_UMRAH_CTX: TenantContext = {
  tenantId: 'umrah360',
  uid: 'system',
  email: 'system@umrah360.in',
  role: 'admin',
};

/**
 * Creates a deterministic, valid Firestore document ID from any message-ID string.
 */
export function docIdFromMessageId(messageId: string): string {
  const normalized = (messageId || '').trim().toLowerCase();
  const hash = crypto.createHash('sha256').update(normalized).digest('hex').slice(0, 32);
  const cleanPrefix = normalized
    .replace(/[<>]/g, '')
    .replace(/[^a-zA-Z0-9_-]/g, '_')
    .slice(0, 30);
  return `msg_${cleanPrefix}_${hash}`;
}

/**
 * Normalizes email and message identifiers for consistent lookup
 */
export function normalizeIdentifier(id: string): string {
  return (id || '').trim().toLowerCase().replace(/[<>]/g, '');
}

/**
 * Initializes the idempotency store for a specific tenant by reading all historical records from Firestore.
 */
export async function initPersistentIdempotencyStore(ctx: TenantContext = DEFAULT_UMRAH_CTX): Promise<{
  totalLoaded: number;
  repliedCount: number;
}> {
  const cache = getTenantCache(ctx.tenantId);
  if (!isFirebaseConfigured || !db) {
    return { totalLoaded: cache.processed.size, repliedCount: cache.replied.size };
  }

  try {
    const repo = tenantRepo(ctx);
    const colRef = repo.processedInboundEmails();
    const snapshot = await getDocs(colRef);

    let loadedCount = 0;
    let repliedCount = 0;

    snapshot.forEach((d) => {
      const data = d.data() as PersistentProcessedEmailRecord;
      if (data.messageId) {
        const norm = normalizeIdentifier(data.messageId);
        cache.processed.add(norm);
        cache.processed.add(data.messageId);
        if (data.cleanKey) cache.processed.add(data.cleanKey);

        if (data.aiReplied || data.status === 'REPLIED') {
          cache.replied.add(norm);
          cache.replied.add(data.messageId);
          repliedCount++;
        }
        loadedCount++;
      }
    });

    // Also scan tenant's messages collection
    try {
      const msgsCol = repo.messages();
      const msgsSnap = await getDocs(msgsCol);
      msgsSnap.forEach((d) => {
        const m = d.data();
        if (m.gmailMessageId) {
          const norm = normalizeIdentifier(m.gmailMessageId);
          cache.processed.add(norm);
          cache.processed.add(m.gmailMessageId);
          if (m.direction === 'OUTBOUND' || m.aiReplied) {
            cache.replied.add(norm);
            cache.replied.add(m.gmailMessageId);
          }
        }
        if (m.emailMeta?.inReplyTo) {
          const normReplyTo = normalizeIdentifier(m.emailMeta.inReplyTo);
          cache.processed.add(normReplyTo);
          cache.replied.add(normReplyTo);
        }
      });
    } catch (e) {
      console.warn(`[Firestore Idempotency] Notice loading messages for tenant ${ctx.tenantId}:`, e);
    }

    cache.loaded = true;
    return { totalLoaded: loadedCount, repliedCount };
  } catch (err) {
    console.error(`[Firestore Idempotency] Failed to load idempotency ledger for tenant ${ctx.tenantId}:`, err);
    return { totalLoaded: cache.processed.size, repliedCount: cache.replied.size };
  }
}

/**
 * Checks if an incoming message ID has already been processed or replied to for the given tenant.
 */
export async function isMessageAlreadyProcessed(
  messageId: string,
  fromEmail?: string,
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<{
  processed: boolean;
  replied: boolean;
  reason?: string;
}> {
  if (!messageId) {
    return { processed: false, replied: false };
  }

  const cache = getTenantCache(ctx.tenantId);
  const normId = normalizeIdentifier(messageId);

  // 1. Check tenant in-memory sets (O(1))
  if (cache.replied.has(normId) || cache.replied.has(messageId)) {
    return {
      processed: true,
      replied: true,
      reason: `Message ${messageId} already replied (found in memory cache for ${ctx.tenantId})`,
    };
  }

  if (cache.processed.has(normId) || cache.processed.has(messageId)) {
    return {
      processed: true,
      replied: false,
      reason: `Message ${messageId} already processed (found in memory cache for ${ctx.tenantId})`,
    };
  }

  // 2. Query Firestore via tenantRepo
  if (isFirebaseConfigured && db) {
    try {
      const repo = tenantRepo(ctx);
      const docId = docIdFromMessageId(messageId);
      const docRef = repo.processedInboundEmailDoc(docId);
      const snap = await getDoc(docRef);

      if (snap.exists()) {
        const data = snap.data() as PersistentProcessedEmailRecord;
        cache.processed.add(normId);
        cache.processed.add(messageId);

        const wasReplied = Boolean(data.aiReplied || data.status === 'REPLIED');
        if (wasReplied) {
          cache.replied.add(normId);
          cache.replied.add(messageId);
        }

        return {
          processed: true,
          replied: wasReplied,
          reason: `Message ${messageId} exists in Firestore (tenant: ${ctx.tenantId}, status: ${data.status})`,
        };
      }

      // 3. Fallback: check tenant's messages collection
      const msgsCol = repo.messages();
      const q = query(msgsCol, where('gmailMessageId', '==', messageId), limit(1));
      const qSnap = await getDocs(q);

      if (!qSnap.empty) {
        const msgData = qSnap.docs[0].data();
        const wasReplied = Boolean(msgData.aiReplied || msgData.direction === 'OUTBOUND');
        cache.processed.add(normId);
        if (wasReplied) cache.replied.add(normId);

        return {
          processed: true,
          replied: wasReplied,
          reason: `Message ${messageId} exists in Firestore messages for ${ctx.tenantId}`,
        };
      }
    } catch (err) {
      console.warn(`[Firestore Idempotency] Error checking Firestore for ${messageId} in ${ctx.tenantId}:`, err);
    }
  }

  return { processed: false, replied: false };
}

/**
 * Records a message in Firestore as processed/replied for the given tenant.
 */
export async function recordProcessedInboundEmail(
  record: {
    messageId: string;
    fromEmail: string;
    subject: string;
    aiReplied: boolean;
    replyMessageId?: string;
    status: 'PROCESSED' | 'REPLIED' | 'SKIPPED' | 'BASELINE';
    reason?: string;
    timestamp?: string;
  },
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<void> {
  const cache = getTenantCache(ctx.tenantId);
  const normId = normalizeIdentifier(record.messageId);
  const nowIso = record.timestamp || new Date().toISOString();
  const cleanKey = normId;

  // 1. Update memory sets immediately
  cache.processed.add(normId);
  cache.processed.add(record.messageId);
  if (record.aiReplied || record.status === 'REPLIED') {
    cache.replied.add(normId);
    cache.replied.add(record.messageId);
  }

  // 2. Persist to Firestore scoped under tenant
  if (isFirebaseConfigured && db) {
    try {
      const repo = tenantRepo(ctx);
      const docId = docIdFromMessageId(record.messageId);
      const docRef = repo.processedInboundEmailDoc(docId);

      const persistentDoc: PersistentProcessedEmailRecord = {
        messageId: record.messageId,
        cleanKey,
        fromEmail: record.fromEmail || 'unknown@domain.com',
        subject: record.subject || '',
        aiReplied: record.aiReplied,
        repliedAt: record.aiReplied ? nowIso : undefined,
        replyMessageId: record.replyMessageId,
        status: record.status,
        reason: record.reason || (record.aiReplied ? 'AI auto-reply dispatched' : 'Processed'),
        timestamp: nowIso,
      };

      await safeSetDoc(docRef, persistentDoc, { merge: true });
    } catch (err) {
      console.error(`[Firestore Idempotency] Failed to write record to Firestore for ${record.messageId} in ${ctx.tenantId}:`, err);
    }
  }
}

/**
 * Seeds existing inbox messages as baseline on initial server boot.
 */
export async function recordBaselineInboxMessages(
  messages: { messageId: string; fromEmail: string; subject: string; date?: string }[],
  ctx: TenantContext = DEFAULT_UMRAH_CTX
): Promise<number> {
  const cache = getTenantCache(ctx.tenantId);
  let count = 0;
  for (const m of messages) {
    if (!m.messageId) continue;
    const norm = normalizeIdentifier(m.messageId);
    if (!cache.processed.has(norm)) {
      await recordProcessedInboundEmail(
        {
          messageId: m.messageId,
          fromEmail: m.fromEmail,
          subject: m.subject,
          aiReplied: false,
          status: 'BASELINE',
          reason: 'Historical email baselined on server boot to prevent duplicate replies',
          timestamp: m.date || new Date().toISOString(),
        },
        ctx
      );
      count++;
    }
  }
  return count;
}
