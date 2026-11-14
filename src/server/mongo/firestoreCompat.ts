/**
 * Firestore-shaped API on top of MongoDB.
 *
 * The whole server was written against Firestore's document model (paths such as
 * `tenants/{tenantId}/leads/{leadId}`, `where/orderBy/limit` queries, transactions and atomic
 * increments). This module keeps that model so no service code has to change, while the data lives
 * in MongoDB.
 *
 * Storage layout
 * --------------
 * Every Firestore collection is stored in a Mongo collection named after its LAST path segment
 * (`tenants/t1/leads` -> Mongo collection `leads`). A document is stored as:
 *
 *     { _id: "tenants/t1/leads/L1",  __p: "tenants/t1/leads",  ...fields }
 *
 *  - `_id` is the full Firestore path, so it is globally unique and a point lookup is an _id lookup.
 *  - `__p` is the parent collection path; every collection query filters on it (indexed).
 *
 * Differences from Firestore that the code relies on and that are reproduced here:
 *  - `orderBy(field)` excludes documents that do not have the field.
 *  - `== null` only matches an explicit null (not a missing field).
 *  - `update()` fails with NOT_FOUND (code 5) when the document does not exist.
 *  - `create()` fails with ALREADY_EXISTS (code 6) when the document exists.
 *  - `set(..., { merge: true })` deep-merges nested maps.
 *  - `increment(n)` is atomic.
 *
 * Field names that contain "." or start with "$" are escaped on write and restored on read, because
 * MongoDB treats those characters specially.
 */
import { randomBytes } from 'node:crypto';
import type { ClientSession, Collection, Document, Filter } from 'mongodb';
import { getMongoClient, getMongoDb } from './mongoClient.js';

export type DocumentData = { [field: string]: any };
export interface SetOptions {
  merge?: boolean;
  mergeFields?: string[];
}

const PARENT_FIELD = '__p';
/** Pseudo field used by orderByDocumentId(). */
export const DOCUMENT_ID_FIELD = '__name__';

// ---------------------------------------------------------------------------
// Field-value sentinels
// ---------------------------------------------------------------------------
class IncrementSentinel {
  constructor(public readonly amount: number) {}
}
export const incrementValue = (n: number) => new IncrementSentinel(n);

// ---------------------------------------------------------------------------
// Key escaping + value encoding
// ---------------------------------------------------------------------------
const DOT = '．';
const DOLLAR = '＄';

const encodeKey = (key: string) => key.replace(/\./g, DOT).replace(/^\$/, DOLLAR);
const decodeKey = (key: string) => key.replace(new RegExp(DOT, 'g'), '.').replace(new RegExp('^' + DOLLAR), '$');
/** "a.b.c" -> escaped path segments joined by "." (used for dotted field paths in where/update). */
const encodePath = (path: string) => path.split('.').map(encodeKey).join('.');

function isPlainObject(value: any): value is Record<string, any> {
  if (value === null || typeof value !== 'object') return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function encodeValue(value: any): any {
  if (value === undefined) return null;
  if (value instanceof IncrementSentinel) return value.amount;
  if (Array.isArray(value)) return value.map((item) => encodeValue(item));
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) {
      if (v === undefined) continue;
      out[encodeKey(k)] = encodeValue(v);
    }
    return out;
  }
  return value;
}

function decodeValue(value: any): any {
  if (Array.isArray(value)) return value.map((item) => decodeValue(item));
  if (isPlainObject(value)) {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[decodeKey(k)] = decodeValue(v);
    return out;
  }
  return value;
}

/** Flattens nested maps into dotted $set paths (Firestore merge semantics) and collects increments. */
function flattenForMerge(
  prefix: string,
  obj: Record<string, any>,
  set: Record<string, any>,
  inc: Record<string, number>,
) {
  for (const [key, value] of Object.entries(obj)) {
    if (value === undefined) continue;
    const path = prefix ? `${prefix}.${encodeKey(key)}` : encodeKey(key);
    if (value instanceof IncrementSentinel) {
      inc[path] = value.amount;
    } else if (isPlainObject(value) && Object.keys(value).length > 0) {
      flattenForMerge(path, value, set, inc);
    } else {
      set[path] = encodeValue(value);
    }
  }
}

function getByPath(obj: any, path: string): any {
  let cur = obj;
  for (const part of path.split('.')) {
    if (cur === null || cur === undefined || typeof cur !== 'object') return undefined;
    cur = cur[part];
  }
  return cur;
}

// ---------------------------------------------------------------------------
// Errors that mimic the Firestore codes the services check
// ---------------------------------------------------------------------------
function firestoreError(code: number, name: string, message: string) {
  const err: any = new Error(`${code} ${name}: ${message}`);
  err.code = code;
  err.name = name;
  return err;
}

// ---------------------------------------------------------------------------
// Path helpers
// ---------------------------------------------------------------------------
function segments(path: string): string[] {
  return String(path || '').split('/').filter(Boolean);
}

function autoId(): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';
  const bytes = randomBytes(20);
  let id = '';
  for (let i = 0; i < 20; i++) id += chars[bytes[i] % chars.length];
  return id;
}

const idFilter = (path: string): Filter<Document> => ({ _id: path }) as unknown as Filter<Document>;

const indexedCollections = new Set<string>();
async function mongoCollection(name: string): Promise<Collection<Document>> {
  const db = await getMongoDb();
  const col = db.collection(name);
  if (!indexedCollections.has(name) && process.env.MONGODB_AUTO_INDEX !== 'false') {
    indexedCollections.add(name);
    // Every collection query filters on the parent path, so it is always indexed.
    await col.createIndex({ [PARENT_FIELD]: 1 }).catch((err) => {
      indexedCollections.delete(name);
      console.warn(`[Mongo] Could not create parent index on "${name}":`, err?.message || err);
    });
  }
  return col;
}

// ---------------------------------------------------------------------------
// Snapshots
// ---------------------------------------------------------------------------
export class DocumentSnapshot<T = DocumentData> {
  constructor(
    public readonly ref: DocumentReference<T>,
    private readonly raw: DocumentData | null,
  ) {}
  get id(): string {
    return this.ref.id;
  }
  get exists(): boolean {
    return this.raw !== null;
  }
  data(): T {
    return (this.raw === null ? undefined : this.raw) as T;
  }
  get(field: string): any {
    return this.raw === null ? undefined : getByPath(this.raw, field);
  }
}

export class QuerySnapshot<T = DocumentData> {
  constructor(public readonly docs: DocumentSnapshot<T>[]) {}
  get empty(): boolean {
    return this.docs.length === 0;
  }
  get size(): number {
    return this.docs.length;
  }
  forEach(cb: (doc: DocumentSnapshot<T>) => void) {
    this.docs.forEach(cb);
  }
}

function toSnapshot<T>(ref: DocumentReference<T>, row: Document | null): DocumentSnapshot<T> {
  if (!row) return new DocumentSnapshot<T>(ref, null);
  const { _id, [PARENT_FIELD]: _p, ...rest } = row;
  return new DocumentSnapshot<T>(ref, decodeValue(rest) as DocumentData);
}

// ---------------------------------------------------------------------------
// DocumentReference
// ---------------------------------------------------------------------------
export class DocumentReference<T = DocumentData> {
  readonly path: string;
  readonly id: string;
  private readonly parts: string[];

  constructor(path: string) {
    this.parts = segments(path);
    if (this.parts.length === 0 || this.parts.length % 2 !== 0) {
      throw new Error(`Invalid document path "${path}": a document path must have an even number of segments.`);
    }
    this.path = this.parts.join('/');
    this.id = this.parts[this.parts.length - 1];
  }

  get parent(): CollectionReference<T> {
    return new CollectionReference<T>(this.parts.slice(0, -1).join('/'));
  }

  collection(subPath: string): CollectionReference {
    return new CollectionReference(`${this.path}/${subPath}`);
  }

  private get leaf(): string {
    return this.parts[this.parts.length - 2];
  }
  private get parentPath(): string {
    return this.parts.slice(0, -1).join('/');
  }

  /** @internal */
  async _col(): Promise<Collection<Document>> {
    return mongoCollection(this.leaf);
  }

  async get(): Promise<DocumentSnapshot<T>> {
    return this._get();
  }

  /** @internal */
  async _get(session?: ClientSession | null): Promise<DocumentSnapshot<T>> {
    const col = await this._col();
    const row = await col.findOne(idFilter(this.path), session ? { session } : undefined);
    return toSnapshot<T>(this, row);
  }

  async set(data: any, options?: SetOptions): Promise<void> {
    return this._set(data, options);
  }

  /** @internal */
  async _set(data: any, options?: SetOptions, session?: ClientSession | null): Promise<void> {
    const col = await this._col();
    const opts = session ? { session } : {};
    if (options?.merge || options?.mergeFields) {
      const set: Record<string, any> = {};
      const inc: Record<string, number> = {};
      let source = data || {};
      if (options.mergeFields) {
        source = {};
        for (const f of options.mergeFields) {
          const v = getByPath(data, f);
          if (v !== undefined) source[f] = v;
        }
      }
      flattenForMerge('', source, set, inc);
      set[PARENT_FIELD] = this.parentPath;
      const update: Document = { $set: set };
      if (Object.keys(inc).length) update.$inc = inc;
      await col.updateOne(idFilter(this.path), update, { upsert: true, ...opts });
      return;
    }
    const doc = encodeValue(data || {});
    doc[PARENT_FIELD] = this.parentPath;
    await col.replaceOne(idFilter(this.path), doc, { upsert: true, ...opts });
  }

  async create(data: any): Promise<void> {
    return this._create(data);
  }

  /** @internal */
  async _create(data: any, session?: ClientSession | null): Promise<void> {
    const col = await this._col();
    const doc = encodeValue(data || {});
    doc._id = this.path;
    doc[PARENT_FIELD] = this.parentPath;
    try {
      await col.insertOne(doc, session ? { session } : undefined);
    } catch (err: any) {
      if (err?.code === 11000) {
        throw firestoreError(6, 'ALREADY_EXISTS', `Document already exists: ${this.path}`);
      }
      throw err;
    }
  }

  async update(data: DocumentData): Promise<void> {
    return this._update(data);
  }

  /** @internal */
  async _update(data: DocumentData, session?: ClientSession | null): Promise<void> {
    const col = await this._col();
    const set: Record<string, any> = {};
    const inc: Record<string, number> = {};
    for (const [key, value] of Object.entries(data || {})) {
      if (value === undefined) continue;
      const path = encodePath(key);
      if (value instanceof IncrementSentinel) inc[path] = value.amount;
      else set[path] = encodeValue(value);
    }
    const update: Document = {};
    if (Object.keys(set).length) update.$set = set;
    if (Object.keys(inc).length) update.$inc = inc;
    if (!Object.keys(update).length) {
      const existing = await this._get(session);
      if (!existing.exists) throw firestoreError(5, 'NOT_FOUND', `No document to update: ${this.path}`);
      return;
    }
    const res = await col.updateOne(idFilter(this.path), update, session ? { session } : undefined);
    if (res.matchedCount === 0) {
      throw firestoreError(5, 'NOT_FOUND', `No document to update: ${this.path}`);
    }
  }

  async delete(): Promise<void> {
    return this._delete();
  }

  /** @internal */
  async _delete(session?: ClientSession | null): Promise<void> {
    const col = await this._col();
    await col.deleteOne(idFilter(this.path), session ? { session } : undefined);
  }
}

// ---------------------------------------------------------------------------
// Query / CollectionReference
// ---------------------------------------------------------------------------
type WhereOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | 'in' | 'not-in' | 'array-contains' | 'array-contains-any';
interface WhereClause {
  field: string;
  op: WhereOp;
  value: any;
}
interface OrderClause {
  field: string;
  dir: 'asc' | 'desc';
}

export class Query<T = DocumentData> {
  readonly collectionPath: string;
  protected readonly wheres: WhereClause[];
  protected readonly orders: OrderClause[];
  protected readonly limitN: number | null;
  protected readonly cursor: any[] | null;

  constructor(
    collectionPath: string,
    wheres: WhereClause[] = [],
    orders: OrderClause[] = [],
    limitN: number | null = null,
    cursor: any[] | null = null,
  ) {
    this.collectionPath = collectionPath;
    this.wheres = wheres;
    this.orders = orders;
    this.limitN = limitN;
    this.cursor = cursor;
  }

  private derive(patch: Partial<{ wheres: WhereClause[]; orders: OrderClause[]; limitN: number | null; cursor: any[] | null }>): Query<T> {
    return new Query<T>(
      this.collectionPath,
      patch.wheres ?? this.wheres,
      patch.orders ?? this.orders,
      patch.limitN === undefined ? this.limitN : patch.limitN,
      patch.cursor === undefined ? this.cursor : patch.cursor,
    );
  }

  where(field: string, op: WhereOp, value: any): Query<T> {
    return this.derive({ wheres: [...this.wheres, { field, op, value }] });
  }
  orderBy(field: string, dir: 'asc' | 'desc' = 'asc'): Query<T> {
    return this.derive({ orders: [...this.orders, { field, dir }] });
  }
  limit(n: number): Query<T> {
    return this.derive({ limitN: n });
  }
  startAfter(...values: any[]): Query<T> {
    return this.derive({ cursor: values });
  }

  private get leaf(): string {
    const parts = segments(this.collectionPath);
    return parts[parts.length - 1];
  }

  private fieldRef(field: string): string {
    return field === DOCUMENT_ID_FIELD ? '_id' : encodePath(field);
  }
  private valueRef(field: string, value: any): any {
    return field === DOCUMENT_ID_FIELD ? `${this.collectionPath}/${value}` : encodeValue(value);
  }

  /** @internal Mongo filter equivalent to this query's where/orderBy/startAfter. */
  _filter(): Filter<Document> {
    const and: Document[] = [{ [PARENT_FIELD]: this.collectionPath }];

    for (const w of this.wheres) {
      const field = this.fieldRef(w.field);
      let cond: Document;
      switch (w.op) {
        case '==':
          cond = w.value === null ? { $eq: null, $exists: true } : { $eq: this.valueRef(w.field, w.value) };
          break;
        case '!=':
          cond = { $ne: this.valueRef(w.field, w.value), $exists: true };
          break;
        case '<':
          cond = { $lt: this.valueRef(w.field, w.value) };
          break;
        case '<=':
          cond = { $lte: this.valueRef(w.field, w.value) };
          break;
        case '>':
          cond = { $gt: this.valueRef(w.field, w.value) };
          break;
        case '>=':
          cond = { $gte: this.valueRef(w.field, w.value) };
          break;
        case 'in':
          cond = { $in: (w.value as any[]).map((v) => this.valueRef(w.field, v)) };
          break;
        case 'not-in':
          cond = { $nin: (w.value as any[]).map((v) => this.valueRef(w.field, v)), $exists: true };
          break;
        case 'array-contains':
          cond = { $eq: this.valueRef(w.field, w.value) };
          break;
        case 'array-contains-any':
          cond = { $in: (w.value as any[]).map((v) => this.valueRef(w.field, v)) };
          break;
        default:
          throw new Error(`Unsupported where operator "${w.op}"`);
      }
      and.push({ [field]: cond });
    }

    // Firestore returns only documents that contain every orderBy field.
    for (const o of this.orders) {
      if (o.field !== DOCUMENT_ID_FIELD) and.push({ [this.fieldRef(o.field)]: { $exists: true } });
    }

    if (this.cursor && this.cursor.length) {
      const orders: OrderClause[] = this.orders.length ? this.orders : [{ field: DOCUMENT_ID_FIELD, dir: 'asc' }];
      const ors: Document[] = [];
      for (let i = 0; i < this.cursor.length && i < orders.length; i++) {
        const eq: Document = {};
        for (let j = 0; j < i; j++) eq[this.fieldRef(orders[j].field)] = this.valueRef(orders[j].field, this.cursor[j]);
        const op = orders[i].dir === 'desc' ? '$lt' : '$gt';
        eq[this.fieldRef(orders[i].field)] = { [op]: this.valueRef(orders[i].field, this.cursor[i]) };
        ors.push(eq);
      }
      if (ors.length) and.push({ $or: ors });
    }

    return and.length === 1 ? and[0] : ({ $and: and } as Filter<Document>);
  }

  private sortSpec(): Record<string, 1 | -1> {
    const sort: Record<string, 1 | -1> = {};
    let lastDir: 'asc' | 'desc' = 'asc';
    for (const o of this.orders) {
      sort[this.fieldRef(o.field)] = o.dir === 'desc' ? -1 : 1;
      lastDir = o.dir;
    }
    // Firestore breaks ties by document id, in the direction of the last orderBy.
    if (!('_id' in sort)) sort._id = lastDir === 'desc' ? -1 : 1;
    return sort;
  }

  async get(): Promise<QuerySnapshot<T>> {
    return this._get();
  }

  /** @internal */
  async _get(session?: ClientSession | null): Promise<QuerySnapshot<T>> {
    const col = await mongoCollection(this.leaf);
    let cursor = col.find(this._filter(), session ? { session } : undefined).sort(this.sortSpec());
    if (this.limitN !== null && this.limitN !== undefined) cursor = cursor.limit(this.limitN);
    const rows = await cursor.toArray();
    return new QuerySnapshot<T>(
      rows.map((row) => toSnapshot<T>(new DocumentReference<T>(String(row._id)), row)),
    );
  }

  /** @internal */
  async _count(): Promise<number> {
    const col = await mongoCollection(this.leaf);
    return col.countDocuments(this._filter());
  }

  /** @internal */
  async _sum(fields: string[]): Promise<Record<string, number>> {
    const col = await mongoCollection(this.leaf);
    const group: Document = { _id: null };
    fields.forEach((f, i) => {
      group[`s${i}`] = { $sum: `$${this.fieldRef(f)}` };
    });
    const rows = await col.aggregate([{ $match: this._filter() }, { $group: group }]).toArray();
    const out: Record<string, number> = {};
    fields.forEach((f, i) => {
      out[f] = Number(rows[0]?.[`s${i}`] || 0);
    });
    return out;
  }
}

export class CollectionReference<T = DocumentData> extends Query<T> {
  readonly path: string;
  readonly id: string;

  constructor(path: string) {
    const parts = segments(path);
    if (parts.length === 0 || parts.length % 2 !== 1) {
      throw new Error(`Invalid collection path "${path}": a collection path must have an odd number of segments.`);
    }
    super(parts.join('/'));
    this.path = parts.join('/');
    this.id = parts[parts.length - 1];
  }

  get parent(): DocumentReference | null {
    const parts = segments(this.path);
    return parts.length > 1 ? new DocumentReference(parts.slice(0, -1).join('/')) : null;
  }

  doc(id?: string): DocumentReference<T> {
    return new DocumentReference<T>(`${this.path}/${id ? segments(id).join('/') : autoId()}`);
  }

  async add(data: any): Promise<DocumentReference<T>> {
    const ref = this.doc();
    await ref.set(data);
    return ref;
  }
}

// ---------------------------------------------------------------------------
// Transactions and batches
// ---------------------------------------------------------------------------
/**
 * Mirrors the Firestore transaction contract the services rely on:
 *  - reads (`get`) run immediately and are awaited;
 *  - writes (`set/create/update/delete`) are SYNCHRONOUS calls that are only buffered, and are applied
 *    together when the callback returns (inside the MongoDB transaction when the server supports it).
 */
export class Transaction {
  private writes: Array<(session: ClientSession | null) => Promise<void>> = [];

  constructor(private readonly session: ClientSession | null) {}

  get<T>(target: DocumentReference<T>): Promise<DocumentSnapshot<T>>;
  get<T>(target: Query<T>): Promise<QuerySnapshot<T>>;
  get(target: any): Promise<any> {
    return target instanceof DocumentReference ? target._get(this.session) : (target as Query)._get(this.session);
  }
  set(ref: DocumentReference<any>, data: any, options?: SetOptions) {
    this.writes.push((session) => ref._set(data, options, session));
    return this;
  }
  create(ref: DocumentReference<any>, data: any) {
    this.writes.push((session) => ref._create(data, session));
    return this;
  }
  update(ref: DocumentReference<any>, data: DocumentData) {
    this.writes.push((session) => ref._update(data, session));
    return this;
  }
  delete(ref: DocumentReference<any>) {
    this.writes.push((session) => ref._delete(session));
    return this;
  }

  /** @internal Applies the buffered writes, in order. */
  async _flush(session: ClientSession | null) {
    const writes = this.writes;
    this.writes = [];
    for (const write of writes) await write(session);
  }
}

let transactionSupport: Promise<boolean> | null = null;

/** Multi-document transactions need a replica set or a sharded cluster (MongoDB Atlas is always one). */
function supportsTransactions(): Promise<boolean> {
  if (!transactionSupport) {
    transactionSupport = (async () => {
      try {
        const client = await getMongoClient();
        const hello: any = await client.db('admin').command({ hello: 1 });
        const ok = Boolean(hello?.setName) || hello?.msg === 'isdbgrid';
        if (!ok) {
          console.warn('[Mongo] This MongoDB deployment is standalone, so transactions are unavailable; transaction callbacks run without isolation. Use a replica set (e.g. Atlas) in production.');
        }
        return ok;
      } catch {
        transactionSupport = null; // retry the probe next time
        return false;
      }
    })();
  }
  return transactionSupport;
}

/**
 * Runs `fn` as an atomic unit. With a replica set the reads and the buffered writes happen in a MongoDB
 * multi-document transaction (retried automatically on write conflicts, like Firestore does).
 */
export async function runTransaction<T>(fn: (tx: Transaction) => Promise<T>): Promise<T> {
  if (!(await supportsTransactions())) {
    const tx = new Transaction(null);
    const result = await fn(tx);
    await tx._flush(null);
    return result;
  }
  const client = await getMongoClient();
  const session = client.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        const tx = new Transaction(session);
        result = await fn(tx);
        await tx._flush(session);
      },
      { readConcern: { level: 'snapshot' }, writeConcern: { w: 'majority' } },
    );
    return result;
  } finally {
    await session.endSession().catch(() => undefined);
  }
}

export class WriteBatch {
  private ops: Array<() => Promise<void>> = [];
  set(ref: DocumentReference<any>, data: any, options?: SetOptions) {
    this.ops.push(() => ref._set(data, options));
    return this;
  }
  create(ref: DocumentReference<any>, data: any) {
    this.ops.push(() => ref._create(data));
    return this;
  }
  update(ref: DocumentReference<any>, data: DocumentData) {
    this.ops.push(() => ref._update(data));
    return this;
  }
  delete(ref: DocumentReference<any>) {
    this.ops.push(() => ref._delete());
    return this;
  }
  async commit() {
    for (const op of this.ops) await op();
    this.ops = [];
  }
}

// ---------------------------------------------------------------------------
// Bulk import (used by the Firestore -> MongoDB migration script)
// ---------------------------------------------------------------------------
/** Replaces (or inserts) many documents, grouped per Mongo collection. Idempotent: safe to re-run. */
export async function bulkReplaceDocuments(rows: Array<{ path: string; data: DocumentData }>): Promise<number> {
  const byLeaf = new Map<string, Array<{ path: string; data: DocumentData }>>();
  for (const row of rows) {
    const ref = new DocumentReference(row.path);
    const leaf = segments(ref.path).slice(-2)[0];
    if (!byLeaf.has(leaf)) byLeaf.set(leaf, []);
    byLeaf.get(leaf)!.push(row);
  }
  let written = 0;
  for (const [leaf, items] of byLeaf) {
    const col = await mongoCollection(leaf);
    const ops = items.map(({ path, data }) => {
      const parts = segments(path);
      const doc = encodeValue(data || {});
      doc[PARENT_FIELD] = parts.slice(0, -1).join('/');
      return { replaceOne: { filter: idFilter(parts.join('/')), replacement: doc, upsert: true } };
    });
    const res = await col.bulkWrite(ops, { ordered: false });
    written += res.upsertedCount + res.modifiedCount + (res.matchedCount - res.modifiedCount);
  }
  return written;
}

/** Number of documents stored directly in the collection at `collectionPath`. */
export async function countCollectionDocuments(collectionPath: string): Promise<number> {
  return new CollectionReference(collectionPath)._count();
}

// ---------------------------------------------------------------------------
// Root facade (what getAdminFirestore() returns)
// ---------------------------------------------------------------------------
export class MongoFirestore {
  collection(path: string) {
    return new CollectionReference(path);
  }
  doc(path: string) {
    return new DocumentReference(path);
  }
  batch() {
    return new WriteBatch();
  }
  runTransaction<T>(fn: (tx: Transaction) => Promise<T>) {
    return runTransaction(fn);
  }
}

let rootFacade: MongoFirestore | null = null;
export function getMongoFirestore(): MongoFirestore {
  if (!rootFacade) rootFacade = new MongoFirestore();
  return rootFacade;
}
