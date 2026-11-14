/**
 * Browser data layer.
 *
 * The app now stores its data in MongoDB, which a browser cannot reach. This module exposes the same
 * function names the UI used from 'firebase/firestore' (collection, doc, getDoc, getDocs, setDoc, updateDoc,
 * deleteDoc, query, where, orderBy, limit, documentId, onSnapshot), implemented on top of the authenticated
 * `POST /api/db` endpoint. Components only had to change their import path.
 *
 * Live updates (`onSnapshot`) are done by polling:
 *  - a listener fetches immediately, then re-checks every few seconds while the tab is visible;
 *  - the server answers "not modified" when nothing changed (an ETag over the result), so idle polling is
 *    cheap;
 *  - any write made from this browser refreshes the affected listeners right away, so the UI still feels live.
 *
 * Authorization is enforced by the server from the signed-in user's token (see src/server/clientDataApi.ts).
 * The global fetch is patched at startup (installAuthFetch) to add the Authorization header to /api calls.
 */

export type DocumentData = { [field: string]: any };
export interface SetOptions {
  merge?: boolean;
}
export type Unsubscribe = () => void;

/** Sentinel passed as the first argument of collection()/doc(), like the old Firestore instance. */
export const db: any = { __clientDb: true };
const isRoot = (v: any) => Boolean(v && v.__clientDb);

const POLL_MS = Number((import.meta as any).env?.VITE_DB_POLL_MS) || 5000;
const MAX_BACKOFF_MS = 60_000;

// ---------------------------------------------------------------------------
// References
// ---------------------------------------------------------------------------
const seg = (path: string) => String(path || '').split('/').filter(Boolean);

export class DocumentReference<T = DocumentData> {
  readonly type = 'document' as const;
  readonly path: string;
  readonly id: string;
  constructor(path: string) {
    const parts = seg(path);
    this.path = parts.join('/');
    this.id = parts[parts.length - 1];
  }
  get parent(): CollectionReference<T> {
    return new CollectionReference<T>(seg(this.path).slice(0, -1).join('/'));
  }
}

interface WhereClause { field: string; op: string; value: any }
interface OrderClause { field: string; dir: 'asc' | 'desc' }

export class Query<T = DocumentData> {
  readonly type: 'query' | 'collection' = 'query';
  constructor(
    readonly path: string,
    readonly wheres: WhereClause[] = [],
    readonly orders: OrderClause[] = [],
    readonly limitN: number | null = null,
  ) {}
}

export class CollectionReference<T = DocumentData> extends Query<T> {
  readonly type = 'collection' as const;
  readonly id: string;
  constructor(path: string) {
    const parts = seg(path);
    super(parts.join('/'));
    this.id = parts[parts.length - 1];
  }
}

let autoCounter = 0;
function autoId(): string {
  const bytes = new Uint8Array(15);
  (globalThis.crypto || ({} as Crypto)).getRandomValues?.(bytes);
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  for (let i = 0; i < 20; i++) out += chars[((bytes[i % 15] || Math.random() * 256) + i + autoCounter++) % chars.length];
  return out;
}

export function collection(parent: any, path: string, ...rest: string[]): CollectionReference {
  const full = [path, ...rest].join('/');
  if (isRoot(parent)) return new CollectionReference(full);
  return new CollectionReference(`${(parent as DocumentReference).path}/${full}`);
}

export function doc(parent: any, path?: string, ...rest: string[]): DocumentReference {
  if (isRoot(parent)) return new DocumentReference([path, ...rest].join('/'));
  const col = parent as CollectionReference;
  return new DocumentReference(`${col.path}/${path ? [path, ...rest].join('/') : autoId()}`);
}

/** Marker used as a field name to refer to the document ID: where(documentId(), 'in', [...]). */
export const documentId = () => '__name__';

type Constraint =
  | { kind: 'where'; field: string; op: string; value: any }
  | { kind: 'orderBy'; field: string; dir: 'asc' | 'desc' }
  | { kind: 'limit'; n: number };

export const where = (field: string, op: string, value: any): Constraint => ({ kind: 'where', field, op, value });
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => ({ kind: 'orderBy', field, dir });
export const limit = (n: number): Constraint => ({ kind: 'limit', n });

export function query(base: Query | CollectionReference, ...constraints: Constraint[]): Query {
  const wheres = [...base.wheres];
  const orders = [...base.orders];
  let limitN = base.limitN;
  for (const c of constraints) {
    if (c.kind === 'where') wheres.push({ field: c.field, op: c.op, value: c.value });
    else if (c.kind === 'orderBy') orders.push({ field: c.field, dir: c.dir });
    else limitN = c.n;
  }
  return new Query(base.path, wheres, orders, limitN);
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
export class DocumentSnapshot<T = DocumentData> {
  constructor(readonly ref: DocumentReference<T>, private readonly raw: T | null) {}
  get id() { return this.ref.id; }
  exists(): boolean { return this.raw !== null && this.raw !== undefined; }
  data(): T { return (this.raw ?? undefined) as T; }
  get(field: string): any {
    let cur: any = this.raw;
    for (const part of field.split('.')) {
      if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
      cur = cur[part];
    }
    return cur;
  }
}

export class QuerySnapshot<T = DocumentData> {
  constructor(readonly docs: DocumentSnapshot<T>[]) {}
  get size() { return this.docs.length; }
  get empty() { return this.docs.length === 0; }
  forEach(cb: (d: DocumentSnapshot<T>) => void) { this.docs.forEach(cb); }
}

// ---------------------------------------------------------------------------
// Transport
// ---------------------------------------------------------------------------
export class DbError extends Error {
  constructor(message: string, readonly code: string, readonly status: number) {
    super(message);
    this.name = 'DbError';
  }
}

async function call(payload: Record<string, any>): Promise<any> {
  const res = await fetch('/api/db', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
  let json: any = null;
  try { json = await res.json(); } catch { /* non-JSON error page */ }
  if (!res.ok) {
    throw new DbError(json?.error || `Data request failed (HTTP ${res.status}).`, json?.code || 'unavailable', res.status);
  }
  return json;
}

function listPayload(q: Query) {
  return { op: 'list', path: q.path, wheres: q.wheres, orders: q.orders, limit: q.limitN ?? undefined };
}
function buildQuerySnapshot(q: Query, json: any): QuerySnapshot {
  return new QuerySnapshot(
    (json.docs || []).map((d: any) => new DocumentSnapshot(new DocumentReference(`${q.path}/${d.id}`), d.data)),
  );
}

// ---------------------------------------------------------------------------
// Reads and writes
// ---------------------------------------------------------------------------
export async function getDoc<T = DocumentData>(ref: DocumentReference<T>): Promise<DocumentSnapshot<T>> {
  const json = await call({ op: 'get', path: ref.path });
  return new DocumentSnapshot<T>(ref, json.exists ? json.data : null);
}

export async function getDocs<T = DocumentData>(q: Query<T> | CollectionReference<T>): Promise<QuerySnapshot<T>> {
  return buildQuerySnapshot(q, await call(listPayload(q))) as QuerySnapshot<T>;
}

export async function setDoc(ref: DocumentReference<any>, data: any, options?: SetOptions): Promise<void> {
  await call({ op: 'set', path: ref.path, data, merge: Boolean(options?.merge) });
  notifyWrite(ref.parent.path);
}

export async function updateDoc(ref: DocumentReference<any>, data: any): Promise<void> {
  await call({ op: 'update', path: ref.path, data });
  notifyWrite(ref.parent.path);
}

export async function deleteDoc(ref: DocumentReference<any>): Promise<void> {
  await call({ op: 'delete', path: ref.path });
  notifyWrite(ref.parent.path);
}

// ---------------------------------------------------------------------------
// Live updates by polling
// ---------------------------------------------------------------------------
interface Listener {
  collectionPath: string;
  refresh: () => void;
}
const listeners = new Set<Listener>();
let writeTimer: ReturnType<typeof setTimeout> | null = null;
const pendingWrites = new Set<string>();

/** After a local write, re-check the listeners watching that collection (debounced) so the UI updates now. */
function notifyWrite(collectionPath: string) {
  pendingWrites.add(collectionPath);
  if (writeTimer) return;
  writeTimer = setTimeout(() => {
    writeTimer = null;
    const paths = new Set(pendingWrites);
    pendingWrites.clear();
    listeners.forEach((l) => { if (paths.has(l.collectionPath)) l.refresh(); });
  }, 120);
}

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (!document.hidden) listeners.forEach((l) => l.refresh());
  });
}

export function onSnapshot(
  target: DocumentReference<any> | Query<any> | CollectionReference<any>,
  onNext: (snapshot: any) => void,
  onError?: (error: Error) => void,
): Unsubscribe {
  const isDoc = target instanceof DocumentReference;
  let closed = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  let inFlight = false;
  let dirty = false;
  let etag: string | undefined;
  let failures = 0;

  const schedule = (ms: number) => {
    if (closed) return;
    if (timer) clearTimeout(timer);
    timer = setTimeout(tick, ms);
  };

  async function tick() {
    if (closed) return;
    if (typeof document !== 'undefined' && document.hidden) {
      schedule(POLL_MS);
      return;
    }
    if (inFlight) {
      dirty = true;
      return;
    }
    inFlight = true;
    try {
      const payload = isDoc
        ? { op: 'get', path: (target as DocumentReference).path, ifNoneMatch: etag }
        : { ...listPayload(target as Query), ifNoneMatch: etag };
      const json = await call(payload);
      if (closed) return;
      failures = 0;
      if (!json.notModified) {
        etag = json.etag;
        if (isDoc) onNext(new DocumentSnapshot(target as DocumentReference, json.exists ? json.data : null));
        else onNext(buildQuerySnapshot(target as Query, json));
      }
      schedule(POLL_MS);
    } catch (err: any) {
      if (closed) return;
      failures++;
      // A permission error is final (like a Firestore listener); other errors are retried with backoff.
      if (err?.code === 'permission-denied' || err?.status === 401 || err?.status === 403) {
        onError?.(err);
        closed = true;
        listeners.delete(listener);
        return;
      }
      if (failures === 1) onError?.(err);
      schedule(Math.min(POLL_MS * 2 ** Math.min(failures, 5), MAX_BACKOFF_MS));
    } finally {
      inFlight = false;
      if (dirty && !closed) {
        dirty = false;
        schedule(0);
      }
    }
  }

  const collectionPath = isDoc ? (target as DocumentReference).parent.path : (target as Query).path;
  const listener: Listener = { collectionPath, refresh: () => { if (!closed) schedule(0); } };
  listeners.add(listener);
  schedule(0);

  return () => {
    closed = true;
    if (timer) clearTimeout(timer);
    listeners.delete(listener);
  };
}
