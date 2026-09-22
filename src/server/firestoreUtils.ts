import { setDoc, DocumentReference, SetOptions } from 'firebase/firestore';

/**
 * Sanitizes objects recursively for Firestore by stripping undefined values.
 * Firestore strictly disallows `undefined` fields and throws synchronous exceptions otherwise.
 */
export function sanitizeForFirestore<T>(obj: T): T {
  if (obj === undefined) return null as any;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) {
    return obj.map((item) => (item === undefined ? null : sanitizeForFirestore(item))) as any;
  }
  const clean: Record<string, any> = {};
  for (const [key, value] of Object.entries(obj as Record<string, any>)) {
    if (value !== undefined) {
      clean[key] = sanitizeForFirestore(value);
    }
  }
  return clean as T;
}

/**
 * Safely writes a document to Firestore, removing undefined fields and catching errors
 * to prevent breaking the calling background thread or campaign loop.
 */
export async function safeSetDoc<T>(
  reference: DocumentReference<T>,
  data: Partial<T>,
  options?: SetOptions
): Promise<void> {
  try {
    const cleanData = sanitizeForFirestore(data);
    if (options) {
      await setDoc(reference, cleanData as any, options);
    } else {
      await setDoc(reference, cleanData as any);
    }
  } catch (err: any) {
    console.warn(`[Firestore safeSetDoc] Notice writing to ${reference?.path || 'unknown path'}:`, err?.message || err);
  }
}
