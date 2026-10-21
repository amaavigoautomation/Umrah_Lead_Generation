import { setDoc, type DocumentReference, type SetOptions } from 'firebase/firestore';

/** Browser-side copy of the server's safeSetDoc (client SDK; never import server code in the browser). */
function sanitize<T>(obj: T): T {
  if (obj === undefined) return null as any;
  if (obj === null || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map((i) => (i === undefined ? null : sanitize(i))) as any;
  const clean: Record<string, any> = {};
  for (const [k, v] of Object.entries(obj as Record<string, any>)) {
    if (v !== undefined) clean[k] = sanitize(v);
  }
  return clean as T;
}

export async function safeSetDoc<T>(ref: DocumentReference<T>, data: Partial<T>, options?: SetOptions): Promise<void> {
  try {
    const clean = sanitize(data);
    if (options) await setDoc(ref, clean as any, options);
    else await setDoc(ref, clean as any);
  } catch (err: any) {
    console.warn(`[Firestore safeSetDoc] Notice writing to ${ref?.path || 'unknown path'}:`, err?.message || err);
  }
}
