
/**
 * Server-side data access, backed by MongoDB.
 *
 * This module keeps the function names the whole server was written against (doc, collection, getDoc,
 * getDocs, setDoc, updateDoc, deleteDoc, query, where, orderBy, limit, increment, runTransaction ...)
 * so the services did not have to change when the database moved from Firestore to MongoDB. The
 * document-model emulation itself lives in ./mongo/firestoreCompat.ts.
 *
 * Because the server talks to MongoDB with its own credentials (no per-user rules), ALL tenant scoping
 * must go through tenantRepo(ctx).
 */
import {
  CollectionReference as MongoCollectionReference,
  DocumentReference as MongoDocumentReference,
  Query as MongoQuery,
  DOCUMENT_ID_FIELD,
  incrementValue,
  runTransaction as mongoRunTransaction,
  getMongoFirestore,
} from './mongo/firestoreCompat.js';
import type { DocumentData, SetOptions } from './mongo/firestoreCompat.js';

export type { DocumentData, SetOptions };
export type DocumentReference<T = DocumentData> = MongoDocumentReference<T>;
export type CollectionReference<T = DocumentData> = MongoCollectionReference<T>;
export type Query<T = DocumentData> = MongoQuery<T>;

/** Sentinel passed as the first argument of doc()/collection(), like the old client `db`. */
export const db: any = { __adminFirestore: true };

const isRoot = (p: any) => Boolean(p && p.__adminFirestore);

export function collection(parent: any, path: string, ...rest: string[]): CollectionReference {
  const full = [path, ...rest].join('/');
  if (isRoot(parent)) return getMongoFirestore().collection(full);
  return (parent as MongoDocumentReference).collection(full);
}

export function doc(parent: any, path?: string, ...rest: string[]): DocumentReference {
  if (isRoot(parent)) {
    return getMongoFirestore().doc([path, ...rest].join('/'));
  }
  // parent is a CollectionReference: doc(col, id) or doc(col) for an auto id
  const col = parent as MongoCollectionReference;
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

/** Runs an atomic multi-document transaction (used for webhook idempotency claims and usage counters). */
export async function runTransaction<T>(fn: (transaction: any) => Promise<T>): Promise<T> {
  return mongoRunTransaction(fn);
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
/** Order by document ID. */
export const orderByDocumentId = (): Constraint => (q) => q.orderBy(DOCUMENT_ID_FIELD);
/** Cursor for paging: continue after this document ID (pair with orderByDocumentId). */
export const startAfterId = (id: string): Constraint => (q) => q.startAfter(id);
/** Cursor for paging on one or more orderBy fields (values in the same order as the orderBy calls). */
export const startAfterValues = (...values: any[]): Constraint => (q) => q.startAfter(...values);
export function query(base: Query | CollectionReference, ...constraints: Constraint[]): Query {
  return constraints.reduce((q: any, c) => c(q), base as any);
}

/** Server-side count: one aggregation, no documents are transferred. */
export async function countDocs(q: Query | CollectionReference): Promise<number> {
  return (q as MongoQuery)._count();
}

/** Sum of several numeric fields in one aggregation. */
export async function sumDocs(q: Query | CollectionReference, fields: string[]): Promise<Record<string, number>> {
  return (q as MongoQuery)._sum(fields);
}

/** Atomic numeric increment, usable as a field value in setDoc (merge) / updateDoc / transactions. */
export const increment = (n: number) => incrementValue(n);
