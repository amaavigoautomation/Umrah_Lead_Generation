/**
 * Creates the MongoDB indexes the app relies on.
 *
 *   npm run mongo:indexes
 *
 * Every query filters on the parent collection path (`__p`), so each index starts with it. The compound
 * indexes are generated from firestore.indexes.json (so the old composite indexes carry over), plus a few
 * for the hottest browser/inbox queries. Safe to run any number of times.
 */
import 'dotenv/config';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { getMongoDb, closeMongo, mongoDbName } from '../src/server/mongo/mongoClient.js';

type IndexSpec = { collection: string; keys: Record<string, 1 | -1>; name: string };

const here = path.dirname(fileURLToPath(import.meta.url));

export function indexSpecs(): IndexSpec[] {
  const specs: IndexSpec[] = [];
  const file = JSON.parse(fs.readFileSync(path.join(here, '..', 'firestore.indexes.json'), 'utf8'));
  for (const idx of file.indexes || []) {
    const keys: Record<string, 1 | -1> = { __p: 1 };
    for (const f of idx.fields || []) {
      if (f.fieldPath === '__name__') continue;
      keys[f.fieldPath.split('.').map((s: string) => s.replace(/\./g, '．')).join('.')] = f.order === 'DESCENDING' ? -1 : 1;
    }
    specs.push({ collection: idx.collectionGroup, keys, name: 'fs_' + Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_') });
  }
  // Hot paths used by the inbox, audit log and routing lookups.
  const extra: Array<[string, Record<string, 1 | -1>]> = [
    ['conversations', { __p: 1, lastMessageAt: -1 }],
    ['messages', { __p: 1, conversationId: 1 }],
    ['audit_logs', { __p: 1, timestamp: -1 }],
    ['leads', { __p: 1, email: 1 }],
    ['contacts', { __p: 1, email: 1 }],
    ['users', { tenantId: 1 }],
  ];
  for (const [collection, keys] of extra) {
    specs.push({ collection, keys, name: 'app_' + Object.entries(keys).map(([k, v]) => `${k}_${v}`).join('_') });
  }
  return specs;
}

export async function ensureIndexes(log: (m: string) => void = console.log): Promise<void> {
  const db = await getMongoDb();
  for (const spec of indexSpecs()) {
    try {
      await db.collection(spec.collection).createIndex(spec.keys, { name: spec.name, background: true });
      log(`  index ${spec.collection}.${spec.name}`);
    } catch (err: any) {
      log(`  WARN ${spec.collection}.${spec.name}: ${err?.message || err}`);
    }
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  console.log(`[Mongo] Ensuring indexes in database "${mongoDbName()}"`);
  await ensureIndexes();
  await closeMongo();
  console.log('[Mongo] Done.');
}
