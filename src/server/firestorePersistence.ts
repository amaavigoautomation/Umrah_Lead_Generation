import crypto from 'crypto';
import {
  collection,
  doc,
  getDoc,
  getDocs,
  setDoc,
  query,
  where,
  limit,
} from 'firebase/firestore';
import { db, isFirebaseConfigured } from '../firebase/config.js';
import { safeSetDoc } from './firestoreUtils.js';

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

// In-memory cache for ultra-fast checks during runtime
const memoryProcessedSet = new Set<string>();
const memoryRepliedSet = new Set<string>();
let isInitializedFromFirestore = false;

/**
 * Creates a deterministic, valid Firestore document ID from any message-ID string.
 * Uses SHA-256 hash to ensure no illegal characters (such as slashes) and fixed safe length.
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
 * Initializes the idempotency store by reading all historical records from Firestore.
 * This guarantees that when AI Studio restores a version or restarts the container,
 * all previously processed and replied emails are immediately known to the server.
 */
export async function initPersistentIdempotencyStore(): Promise<{
  totalLoaded: number;
  repliedCount: number;
}> {
  if (!isFirebaseConfigured || !db) {
    console.warn('[Firestore Idempotency] Firestore is not configured; relying on local memory.');
    return { totalLoaded: memoryProcessedSet.size, repliedCount: memoryRepliedSet.size };
  }

  try {
    console.log('[Firestore Idempotency] Loading persistent idempotency ledger from Firestore...');
    const colRef = collection(db, 'processed_inbound_emails');
    const snapshot = await getDocs(colRef);

    let loadedCount = 0;
    let repliedCount = 0;

    snapshot.forEach((d) => {
      const data = d.data() as PersistentProcessedEmailRecord;
      if (data.messageId) {
        const norm = normalizeIdentifier(data.messageId);
        memoryProcessedSet.add(norm);
        memoryProcessedSet.add(data.messageId);
        if (data.cleanKey) memoryProcessedSet.add(data.cleanKey);

        if (data.aiReplied || data.status === 'REPLIED') {
          memoryRepliedSet.add(norm);
          memoryRepliedSet.add(data.messageId);
          repliedCount++;
        }
        loadedCount++;
      }
    });

    // Also scan messages collection for any outbound replies or replied customer emails
    try {
      const msgsCol = collection(db, 'messages');
      const msgsSnap = await getDocs(msgsCol);
      msgsSnap.forEach((d) => {
        const m = d.data();
        if (m.gmailMessageId) {
          const norm = normalizeIdentifier(m.gmailMessageId);
          memoryProcessedSet.add(norm);
          memoryProcessedSet.add(m.gmailMessageId);
          if (m.direction === 'OUTBOUND' || m.aiReplied) {
            memoryRepliedSet.add(norm);
            memoryRepliedSet.add(m.gmailMessageId);
          }
        }
        // Also if message has inReplyTo in emailMeta
        if (m.emailMeta?.inReplyTo) {
          const normReplyTo = normalizeIdentifier(m.emailMeta.inReplyTo);
          memoryProcessedSet.add(normReplyTo);
          memoryRepliedSet.add(normReplyTo);
        }
      });
    } catch (e) {
      console.warn('[Firestore Idempotency] Notice loading from messages collection:', e);
    }

    isInitializedFromFirestore = true;
    console.log(`[Firestore Idempotency] Successfully synced ${loadedCount} processed records (${repliedCount} replied) from Firestore.`);
    return { totalLoaded: loadedCount, repliedCount };
  } catch (err) {
    console.error('[Firestore Idempotency] Failed to load idempotency ledger from Firestore:', err);
    return { totalLoaded: memoryProcessedSet.size, repliedCount: memoryRepliedSet.size };
  }
}

/**
 * Checks if an incoming message ID has already been processed or replied to.
 * Checks memory first, then queries Firestore.
 */
export async function isMessageAlreadyProcessed(
  messageId: string,
  fromEmail?: string
): Promise<{
  processed: boolean;
  replied: boolean;
  reason?: string;
}> {
  if (!messageId) {
    return { processed: false, replied: false };
  }

  const normId = normalizeIdentifier(messageId);

  // 1. Check in-memory sets (O(1))
  if (memoryRepliedSet.has(normId) || memoryRepliedSet.has(messageId)) {
    return {
      processed: true,
      replied: true,
      reason: `Message ${messageId} already replied (found in memory cache)`,
    };
  }

  if (memoryProcessedSet.has(normId) || memoryProcessedSet.has(messageId)) {
    return {
      processed: true,
      replied: false,
      reason: `Message ${messageId} already processed (found in memory cache)`,
    };
  }

  // 2. If not in memory, query Firestore
  if (isFirebaseConfigured && db) {
    try {
      const docId = docIdFromMessageId(messageId);
      const docRef = doc(db, 'processed_inbound_emails', docId);
      const snap = await getDoc(docRef);

      if (snap.exists()) {
        const data = snap.data() as PersistentProcessedEmailRecord;
        memoryProcessedSet.add(normId);
        memoryProcessedSet.add(messageId);

        const wasReplied = Boolean(data.aiReplied || data.status === 'REPLIED');
        if (wasReplied) {
          memoryRepliedSet.add(normId);
          memoryRepliedSet.add(messageId);
        }

        return {
          processed: true,
          replied: wasReplied,
          reason: `Message ${messageId} exists in Firestore (status: ${data.status}, aiReplied: ${data.aiReplied})`,
        };
      }

      // 3. Fallback: check if messages collection has an outbound reply to this messageId
      const msgsCol = collection(db, 'messages');
      const q = query(msgsCol, where('gmailMessageId', '==', messageId), limit(1));
      const qSnap = await getDocs(q);

      if (!qSnap.empty) {
        const msgData = qSnap.docs[0].data();
        const wasReplied = Boolean(msgData.aiReplied || msgData.direction === 'OUTBOUND');
        memoryProcessedSet.add(normId);
        if (wasReplied) memoryRepliedSet.add(normId);

        return {
          processed: true,
          replied: wasReplied,
          reason: `Message ${messageId} exists in Firestore messages collection`,
        };
      }
    } catch (err) {
      console.warn(`[Firestore Idempotency] Error checking Firestore for ${messageId}:`, err);
    }
  }

  return { processed: false, replied: false };
}

/**
 * Records a message in Firestore as processed/replied.
 * This guarantees durable cross-restore persistence.
 */
export async function recordProcessedInboundEmail(record: {
  messageId: string;
  fromEmail: string;
  subject: string;
  aiReplied: boolean;
  replyMessageId?: string;
  status: 'PROCESSED' | 'REPLIED' | 'SKIPPED' | 'BASELINE';
  reason?: string;
  timestamp?: string;
}): Promise<void> {
  const normId = normalizeIdentifier(record.messageId);
  const nowIso = record.timestamp || new Date().toISOString();
  const cleanKey = normId;

  // 1. Update memory sets immediately
  memoryProcessedSet.add(normId);
  memoryProcessedSet.add(record.messageId);
  if (record.aiReplied || record.status === 'REPLIED') {
    memoryRepliedSet.add(normId);
    memoryRepliedSet.add(record.messageId);
  }

  // 2. Persist to Firestore
  if (isFirebaseConfigured && db) {
    try {
      const docId = docIdFromMessageId(record.messageId);
      const docRef = doc(db, 'processed_inbound_emails', docId);

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
      console.log(`[Firestore Idempotency] Saved persistent record for ${record.messageId} (status=${record.status}, replied=${record.aiReplied})`);
    } catch (err) {
      console.error(`[Firestore Idempotency] Failed to write record to Firestore for ${record.messageId}:`, err);
    }
  }
}

/**
 * Seeds existing inbox messages as baseline on initial server boot.
 * This ensures historical messages present during server restore are NEVER re-sent.
 */
export async function recordBaselineInboxMessages(
  messages: { messageId: string; fromEmail: string; subject: string; date?: string }[]
): Promise<number> {
  let count = 0;
  for (const m of messages) {
    if (!m.messageId) continue;
    const norm = normalizeIdentifier(m.messageId);
    if (!memoryProcessedSet.has(norm)) {
      await recordProcessedInboundEmail({
        messageId: m.messageId,
        fromEmail: m.fromEmail,
        subject: m.subject,
        aiReplied: false,
        status: 'BASELINE',
        reason: 'Historical email baselined on server boot to prevent duplicate replies',
        timestamp: m.date || new Date().toISOString(),
      });
      count++;
    }
  }
  if (count > 0) {
    console.log(`[Firestore Idempotency] Baselined ${count} historical inbox messages in Firestore.`);
  }
  return count;
}
