/**
 * One-off copy of ALL data from Firestore into MongoDB.
 *
 *   npm run migrate:mongo -- --dry-run          # counts only, writes nothing
 *   npm run migrate:mongo                       # copy + verify counts + create indexes
 *   npm run migrate:mongo -- --skip messages    # leave collections out (by collection id, any depth)
 *   npm run migrate:mongo -- --only tenants,users,plans
 *
 * Reads Firestore with the Firebase ADMIN SDK (needs FIREBASE_SERVICE_ACCOUNT_JSON and, if you use a named
 * database, FIRESTORE_DATABASE_ID). Writes with MONGODB_URI / MONGODB_DB_NAME.
 *
 * - Walks every root collection and every nested subcollection, including documents that exist only as a
 *   parent of subcollections.
 * - Idempotent: documents are replaced by path, so you can re-run it (e.g. once to rehearse, once at cutover).
 * - Never modifies or deletes anything in Firestore.
 * - Verifies per-collection document counts afterwards and exits non-zero on any mismatch.
 * - Firestore Timestamps become ISO strings (the app stores dates as ISO strings everywhere else).
 */
import 'dotenv/config';
import { getFirestore, Timestamp, GeoPoint, DocumentReference as AdminDocRef } from 'firebase-admin/firestore';
import { getFirebaseAdminApp } from '../src/server/firebaseAdmin.js';
import rawConfig from '../src/firebase/appletConfig.js';
import { bulkReplaceDocuments, countCollectionDocuments } from '../src/server/mongo/firestoreCompat.js';
import { closeMongo, mongoDbName } from '../src/server/mongo/mongoClient.js';
import { ensureIndexes } from './mongo-ensure-indexes.js';

const args = process.argv.slice(2);
const flag = (name: string) => args.includes(`--${name}`);
const opt = (name: string): string[] => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1].split(',').map((s) => s.trim()).filter(Boolean) : [];
};
const dryRun = flag('dry-run');
const skip = new Set(opt('skip'));
const only = new Set(opt('only'));
const BATCH = 400;

function getSourceFirestore() {
  const app = getFirebaseAdminApp();
  const activeProjectId = String((app.options as any)?.projectId || '');
  const configured = (process.env.FIRESTORE_DATABASE_ID || process.env.VITE_FIRESTORE_DATABASE_ID || '').trim();
  const dbId = configured || (activeProjectId && activeProjectId !== rawConfig.projectId ? '(default)' : rawConfig.firestoreDatabaseId);
  const fs = dbId && dbId !== '(default)' ? (getFirestore as any)(app, dbId) : getFirestore(app);
  try { fs.settings({ ignoreUndefinedProperties: true }); } catch { /* already configured */ }
  return { fs, dbId: dbId || '(default)' };
}

function convert(value: any): any {
  if (value === null || value === undefined) return value;
  if (value instanceof Timestamp) return value.toDate().toISOString();
  if (value instanceof GeoPoint) return { latitude: value.latitude, longitude: value.longitude };
  if (value instanceof AdminDocRef) return value.path;
  if (Array.isArray(value)) return value.map(convert);
  if (Buffer.isBuffer(value) || value instanceof Uint8Array) return value;
  if (typeof value === 'object') {
    const out: Record<string, any> = {};
    for (const [k, v] of Object.entries(value)) out[k] = convert(v);
    return out;
  }
  return value;
}

const stats = new Map<string, { source: number; written: number }>(); // collection path -> counts
let pending: Array<{ path: string; data: any }> = [];
let totalDocs = 0;

async function flush() {
  if (!pending.length) return;
  const batch = pending;
  pending = [];
  if (!dryRun) await bulkReplaceDocuments(batch);
}

async function copyCollection(colRef: any): Promise<void> {
  const colPath: string = colRef.path;
  const id: string = colRef.id;
  if (skip.has(id)) { console.log(`  skip   ${colPath}`); return; }
  if (colRef.parent === null && only.size && !only.has(id)) return;

  const entry = stats.get(colPath) || { source: 0, written: 0 };
  stats.set(colPath, entry);

  // listDocuments() also returns "phantom" documents that have no fields but do have subcollections.
  const refs = await colRef.listDocuments();
  for (let i = 0; i < refs.length; i += 100) {
    const slice = refs.slice(i, i + 100);
    const snaps = await Promise.all(slice.map((r: any) => r.get()));
    for (const snap of snaps) {
      if (snap.exists) {
        entry.source++;
        totalDocs++;
        pending.push({ path: snap.ref.path, data: convert(snap.data()) });
        if (pending.length >= BATCH) await flush();
      }
    }
    await Promise.all(slice.map(async (r: any) => {
      const subs = await r.listCollections();
      for (const sub of subs) await copyCollection(sub);
    }));
  }
  await flush();
  console.log(`  ${dryRun ? 'found ' : 'copied'} ${String(entry.source).padStart(7)}  ${colPath}`);
}

async function main() {
  const { fs, dbId } = getSourceFirestore();
  console.log('========================================================================');
  console.log(`[Migrate] Firestore "${dbId}" -> MongoDB "${mongoDbName()}"`);
  console.log(`[Migrate] Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (writing to MongoDB)'}`);
  if (only.size) console.log(`[Migrate] Only root collections: ${[...only].join(', ')}`);
  if (skip.size) console.log(`[Migrate] Skipping collections: ${[...skip].join(', ')}`);
  console.log('========================================================================');

  const roots = await fs.listCollections();
  for (const col of roots) await copyCollection(col);
  await flush();

  console.log(`\n[Migrate] ${totalDocs} documents ${dryRun ? 'found' : 'processed'} across ${stats.size} collections.`);
  if (dryRun) { await closeMongo().catch(() => undefined); return; }

  console.log('[Migrate] Verifying counts ...');
  let mismatches = 0;
  for (const [colPath, c] of stats) {
    const inMongo = await countCollectionDocuments(colPath);
    // Mongo can hold MORE than the source (data written after a previous run); fewer means a failed copy.
    if (inMongo < c.source) {
      mismatches++;
      console.error(`  MISMATCH ${colPath}: Firestore ${c.source}, MongoDB ${inMongo}`);
    }
  }
  if (mismatches) {
    console.error(`[Migrate] FAILED: ${mismatches} collection(s) are incomplete. Re-run to retry.`);
    await closeMongo().catch(() => undefined);
    process.exit(1);
  }
  console.log('[Migrate] All counts verified. Creating indexes ...');
  await ensureIndexes();
  await closeMongo();
  console.log('[Migrate] Done.');
}

main().catch(async (err) => {
  console.error('[Migrate] FAILED:', err?.message || err);
  await closeMongo().catch(() => undefined);
  process.exit(1);
});
