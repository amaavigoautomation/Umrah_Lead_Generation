/**
 * Server-side Firestore access through the Firebase ADMIN SDK, exposing the
 * same function names the server code already used from the client SDK
 * (doc, collection, getDoc, getDocs, setDoc, updateDoc, deleteDoc, query,
 * where, orderBy, limit, increment).
 *
 * Why: the client SDK on the server is an anonymous browser, subject to
 * Firestore security rules. The Admin SDK is the server's own identity and
 * bypasses rules, which is what lets the rules be locked down for browsers.
 *
 * Because it bypasses rules, ALL tenant scoping must go through tenantRepo(ctx).
 */
import { FieldValue, FieldPath, AggregateField } from 'firebase-admin/firestore';
import type {
  DocumentData,
  DocumentReference as AdminDocumentReference,
  CollectionReference as AdminCollectionReference,
  Query as AdminQuery,
  SetOptions,
} from 'firebase-admin/firestore';
import { getAdminFirestore } from './firebaseAdmin.js';

export type { DocumentData, SetOptions };
export type DocumentReference<T = DocumentData> = AdminDocumentReference<T>;
export type CollectionReference<T = DocumentData> = AdminCollectionReference<T>;
export type Query<T = DocumentData> = AdminQuery<T>;

/** Sentinel passed as the first argument of doc()/collection(), like the client `db`. */
export const db: any = { __adminFirestore: true };

const fs = () => getAdminFirestore();
const isRoot = (p: any) => Boolean(p && p.__adminFirestore);

export function collection(parent: any, path: string, ...rest: string[]): CollectionReference {
  const full = [path, ...rest].join('/');
  if (isRoot(parent)) return fs().collection(full);
  return (parent as AdminDocumentReference).collection(full);
}

export function doc(parent: any, path?: string, ...rest: string[]): DocumentReference {
  if (isRoot(parent)) {
    return fs().doc([path, ...rest].join('/'));
  }
  // parent is a CollectionReference: doc(col, id) or doc(col) for an auto id
  const col = parent as AdminCollectionReference;
  return path ? col.doc([path, ...rest].join('/')) : col.doc();
}

export interface DocSnap<T = DocumentData> {
  id: string;
  ref: DocumentReference<T>;
  exists(): boolean;
  data(): T;
  get(field: string): any;
}

export interface QuerySnap<T = DocumentData> {
  docs: DocSnap<T>[];
  empty: boolean;
  size: number;
  forEach(cb: (d: DocSnap<T>) => void): void;
}

function wrapDoc(s: any): DocSnap {
  return { id: s.id, ref: s.ref, exists: () => s.exists, data: () => s.data(), get: (f: string) => s.get(f) };
}

export async function getDoc(ref: DocumentReference): Promise<DocSnap> {
  return wrapDoc(await ref.get());
}

export async function getDocs(q: Query | CollectionReference): Promise<QuerySnap> {
  const s = await q.get();
  const docs = s.docs.map(wrapDoc);
  return { docs, empty: s.empty, size: s.size, forEach: (cb) => docs.forEach(cb) };
}

export async function setDoc(ref: DocumentReference, data: any, options?: SetOptions): Promise<void> {
  if (options) await ref.set(data, options);
  else await ref.set(data);
}

/** Atomic create: throws (code 6 / ALREADY_EXISTS) if the document already exists. */
export async function createDoc(ref: DocumentReference, data: any): Promise<void> {
  await ref.create(data);
}

export async function updateDoc(ref: DocumentReference, data: any): Promise<void> {
  await ref.update(data);
}

export async function deleteDoc(ref: DocumentReference): Promise<void> {
  await ref.delete();
}

// ---- Query constraints (composed by query()) ----
type Constraint = (q: any) => any;
export const where = (field: string, op: any, value: any): Constraint => (q) => q.where(field, op, value);
export const orderBy = (field: string, dir: 'asc' | 'desc' = 'asc'): Constraint => (q) => q.orderBy(field, dir);
export const limit = (n: number): Constraint => (q) => q.limit(n);
/** Order by document ID. Works with equality filters without any composite index. */
export const orderByDocumentId = (): Constraint => (q) => q.orderBy(FieldPath.documentId());
/** Cursor for paging: continue after this document ID (pair with orderByDocumentId). */
export const startAfterId = (id: string): Constraint => (q) => q.startAfter(id);
/** Cursor for paging on one or more orderBy fields (values in the same order as the orderBy calls). */
export const startAfterValues = (...values: any[]): Constraint => (q) => q.startAfter(...values);
export function query(base: Query | CollectionReference, ...constraints: Constraint[]): Query {
  return constraints.reduce((q: any, c) => c(q), base as any);
}

/**
 * Server-side COUNT aggregation. Billed as 1 read per up to 1,000 matching index entries,
 * instead of 1 read per matching document like getDocs().
 */
export async function countDocs(q: Query | CollectionReference): Promise<number> {
  const s = await (q as any).count().get();
  return Number(s.data().count || 0);
}

/** SUM aggregation over several numeric fields in one query (about 1 read per 1000 matching documents). */
export async function sumDocs(q: Query | CollectionReference, fields: string[]): Promise<Record<string, number>> {
  const spec: Record<string, any> = {};
  for (const f of fields) spec[f] = AggregateField.sum(f);
  const s = await (q as any).aggregate(spec).get();
  const data = s.data();
  const out: Record<string, number> = {};
  for (const f of fields) out[f] = Number(data[f] || 0);
  return out;
}

export const increment = (n: number) => FieldValue.increment(n);
