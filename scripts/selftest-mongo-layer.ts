/**
 * Smoke test for the MongoDB data layer (src/server/mongo + src/server/adminFirestore).
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB_NAME=umrah_selftest npm run test:mongo
 *
 * Uses a throw-away database and drops it at the end. Safe to run against a local mongod; do NOT point it
 * at production.
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import {
  db, doc, collection, getDoc, getDocs, setDoc, createDoc, updateDoc, deleteDoc, query, where, orderBy, limit,
  orderByDocumentId, startAfterId, startAfterValues, countDocs, sumDocs, increment, runTransaction,
} from '../src/server/adminFirestore.js';
import { getMongoDb, closeMongo } from '../src/server/mongo/mongoClient.js';
import { getMongoFirestore, bulkReplaceDocuments, countCollectionDocuments } from '../src/server/mongo/firestoreCompat.js';
import { tenantRepo } from '../src/server/tenantRepo.js';

let passed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e: any) { console.error('  FAIL', name, '\n      ', e?.message || e); process.exitCode = 1; }
}

const dbName = process.env.MONGODB_DB_NAME || '';
if (!/test/i.test(dbName)) {
  console.error('Refusing to run: MONGODB_DB_NAME must contain "test" (it gets dropped at the end).');
  process.exit(2);
}

await (await getMongoDb()).dropDatabase();

const ctx = { tenantId: 'tA', uid: 'u', email: 'u@x.com', role: 'admin' as const };
const ctxB = { tenantId: 'tB', uid: 'u', email: 'u@x.com', role: 'admin' as const };

await t('set/get round trip and missing doc', async () => {
  const ref = doc(db, 'tenants', 'tA', 'leads', 'L1');
  await setDoc(ref, { name: 'Ann', score: 5, nested: { a: 1, b: { c: 2 } }, tags: ['x', 'y'] });
  const s = await getDoc(ref);
  assert.equal(s.exists(), true);
  assert.equal(s.id, 'L1');
  assert.deepEqual(s.data(), { name: 'Ann', score: 5, nested: { a: 1, b: { c: 2 } }, tags: ['x', 'y'] });
  assert.equal((await getDoc(doc(db, 'tenants', 'tA', 'leads', 'nope'))).exists(), false);
});

await t('set without merge replaces; merge deep-merges', async () => {
  const ref = doc(db, 'tenants', 'tA', 'leads', 'L2');
  await setDoc(ref, { a: 1, nested: { x: 1, y: 2 } });
  await setDoc(ref, { nested: { y: 9, z: 3 }, b: 2 }, { merge: true });
  assert.deepEqual((await getDoc(ref)).data(), { a: 1, nested: { x: 1, y: 9, z: 3 }, b: 2 });
  await setDoc(ref, { only: true });
  assert.deepEqual((await getDoc(ref)).data(), { only: true });
});

await t('update: dotted path, increment, NOT_FOUND code 5', async () => {
  const ref = doc(db, 'tenants', 'tA', 'leads', 'L3');
  await setDoc(ref, { n: 1, nested: { a: 1, b: 2 } });
  await updateDoc(ref, { 'nested.a': 10, n: increment(4), extra: 'e' });
  assert.deepEqual((await getDoc(ref)).data(), { n: 5, nested: { a: 10, b: 2 }, extra: 'e' });
  await assert.rejects(() => updateDoc(doc(db, 'tenants', 'tA', 'leads', 'ghost'), { a: 1 }), (e: any) => e.code === 5);
});

await t('increment via set-merge creates and accumulates', async () => {
  const ref = doc(db, 'tenants', 'tA', 'usage', '2026-11');
  await setDoc(ref, { aiTotalTokens: increment(10), aiFeatureUsage: { chat: { n: increment(1) } } }, { merge: true });
  await setDoc(ref, { aiTotalTokens: increment(5), aiFeatureUsage: { chat: { n: increment(1) } } }, { merge: true });
  assert.deepEqual((await getDoc(ref)).data(), { aiTotalTokens: 15, aiFeatureUsage: { chat: { n: 2 } } });
});

await t('create: ALREADY_EXISTS code 6', async () => {
  const ref = doc(db, 'tenants', 'tA', 'processed_inbound_emails', 'm1');
  await createDoc(ref, { ok: 1 });
  await assert.rejects(() => createDoc(ref, { ok: 2 }), (e: any) => e.code === 6 && /ALREADY_EXISTS/.test(e.message));
  assert.deepEqual((await getDoc(ref)).data(), { ok: 1 });
});

await t('keys with dots and $ survive a round trip', async () => {
  const ref = doc(db, 'tenants', 'tA', 'settings', 'weird');
  await setDoc(ref, { byEmail: { 'a.b@x.com': 1, '$odd': 2 } });
  assert.deepEqual((await getDoc(ref)).data(), { byEmail: { 'a.b@x.com': 1, '$odd': 2 } });
  await setDoc(ref, { byEmail: { 'c.d@x.com': 3 } }, { merge: true });
  assert.deepEqual((await getDoc(ref)).data(), { byEmail: { 'a.b@x.com': 1, '$odd': 2, 'c.d@x.com': 3 } });
});

// Dataset for queries
const rows = [
  { id: 'q1', status: 'NEW', score: 10, at: '2026-01-01', channel: 'EMAIL', flag: null },
  { id: 'q2', status: 'NEW', score: 30, at: '2026-01-03', channel: 'WHATSAPP' },
  { id: 'q3', status: 'WON', score: 20, at: '2026-01-02', channel: 'EMAIL', flag: true },
  { id: 'q4', status: 'LOST', score: 20, at: '2026-01-04', channel: 'EMAIL' },
  { id: 'q5', status: 'NEW', score: 5, channel: 'EMAIL' }, // no "at"
];
const r = tenantRepo(ctx);
const col = () => r.contacts();
for (const row of rows) { const { id, ...d } = row; await setDoc(doc(col(), id), d); }
// same leaf collection name, different tenant: must be isolated
await setDoc(doc(tenantRepo(ctxB).contacts(), 'q1'), { status: 'NEW', score: 999 });

const ids = (s: any) => s.docs.map((d: any) => d.id);

await t('where ==, in, <, >=, and tenant isolation', async () => {
  assert.deepEqual(ids(await getDocs(query(col(), where('status', '==', 'NEW'), orderByDocumentId()))), ['q1', 'q2', 'q5']);
  assert.deepEqual(ids(await getDocs(query(col(), where('status', 'in', ['WON', 'LOST']), orderByDocumentId()))), ['q3', 'q4']);
  assert.deepEqual(ids(await getDocs(query(col(), where('score', '<', 20), orderByDocumentId()))), ['q1', 'q5']);
  assert.deepEqual(ids(await getDocs(query(col(), where('score', '>=', 30)))), ['q2']);
  assert.equal((await getDocs(query(tenantRepo(ctxB).contacts(), where('score', '>', 0)))).size, 1);
});

await t('== null matches explicit null only; array-contains', async () => {
  assert.deepEqual(ids(await getDocs(query(col(), where('flag', '==', null)))), ['q1']);
  await setDoc(doc(col(), 'tagdoc'), { tags: ['a', 'b'] });
  assert.deepEqual(ids(await getDocs(query(col(), where('tags', 'array-contains', 'b')))), ['tagdoc']);
});

await t('orderBy excludes docs missing the field; desc + limit', async () => {
  assert.deepEqual(ids(await getDocs(query(col(), where('status', '!=', 'ZZ'), orderBy('at', 'desc'), limit(3)))), ['q4', 'q2', 'q3']);
  assert.equal((await getDocs(query(col(), where('channel', '==', 'EMAIL'), orderBy('at', 'asc')))).size, 3);
});

await t('paging with orderByDocumentId + startAfterId', async () => {
  const base = query(col(), where('channel', '==', 'EMAIL'));
  const page1 = await getDocs(query(base, orderByDocumentId(), limit(2)));
  assert.deepEqual(ids(page1), ['q1', 'q3']);
  const page2 = await getDocs(query(base, orderByDocumentId(), startAfterId('q3'), limit(2)));
  assert.deepEqual(ids(page2), ['q4', 'q5']);
  const page3 = await getDocs(query(base, orderByDocumentId(), startAfterId('q5'), limit(2)));
  assert.equal(page3.empty, true);
});

await t('paging with startAfterValues on two orderBy fields (desc, then tie-break)', async () => {
  const base = query(col(), where('status', 'in', ['NEW', 'WON', 'LOST']), orderBy('score', 'desc'), orderByDocumentId());
  const all = ids(await getDocs(base));
  assert.deepEqual(all, ['q2', 'q3', 'q4', 'q1', 'q5']);
  const after = await getDocs(query(base, startAfterValues(20, 'q3')));
  assert.deepEqual(ids(after), ['q4', 'q1', 'q5']);
});

await t('countDocs and sumDocs', async () => {
  assert.equal(await countDocs(query(col(), where('status', '==', 'NEW'))), 3);
  const s = await sumDocs(query(col(), where('status', '==', 'NEW')), ['score']);
  assert.equal(s.score, 45);
  assert.equal(await countDocs(query(col(), where('status', '==', 'NOPE'))), 0);
});

await t('subcollections with the same leaf name stay separate', async () => {
  await setDoc(doc(r.messages('c1'), 'm1'), { text: 'in conv' });
  await setDoc(doc(r.messages(), 'm1'), { text: 'flat' });
  assert.equal((await getDoc(doc(r.messages('c1'), 'm1'))).data().text, 'in conv');
  assert.equal((await getDocs(r.messages('c1'))).size, 1);
  assert.equal((await getDocs(r.messages())).size, 1);
});

await t('delete, auto-id doc(), snapshot.ref.delete()', async () => {
  const ref = doc(col());
  assert.match(ref.id, /^[A-Za-z0-9]{20}$/);
  await setDoc(ref, { tmp: 1 });
  await deleteDoc(ref);
  assert.equal((await getDoc(ref)).exists(), false);
  await setDoc(doc(col(), 'del2'), { tmp: 1 });
  const snap = await getDocs(query(col(), where('tmp', '==', 1)));
  await Promise.all(snap.docs.map((d) => d.ref.delete()));
  assert.equal((await getDocs(query(col(), where('tmp', '==', 1)))).size, 0);
});

await t('transaction: read-then-write and claim-once pattern', async () => {
  const eventRef = doc(db, 'tenants', 'tA', 'campaign_engagement_events', 'ev1');
  const claim = () => runTransaction(async (tx: any) => {
    const snap = await tx.get(eventRef);
    if (snap.exists) return false;
    tx.create(eventRef, { claimed: true });
    return true;
  });
  assert.equal(await claim(), true);
  assert.equal(await claim(), false);
});

await t('transaction: counters via get + set', async () => {
  const month = doc(db, 'tenants', 'tA', 'usage', 'txn-month');
  for (let i = 0; i < 3; i++) {
    await runTransaction(async (tx: any) => {
      const cur = await tx.get(month);
      tx.set(month, { n: (cur.exists ? cur.data().n : 0) + 1 }, { merge: true });
    });
  }
  assert.equal((await getDoc(month)).data().n, 3);
});

await t('batch (scripts) and raw facade', async () => {
  const fs = getMongoFirestore();
  const batch = fs.batch();
  batch.set(fs.doc('tenants/tA/leads/b1'), { v: 1 });
  batch.set(fs.doc('tenants/tA/leads/b2'), { v: 2 });
  await batch.commit();
  const snap = await fs.collection('tenants').doc('tA').collection('leads').where('v', 'in', [1, 2]).get();
  assert.equal(snap.size, 2);
  const tenant = await fs.collection('tenants').doc('tNone').get();
  assert.equal(tenant.exists, false);
});

await t('bulk import (migration) is idempotent and counted per collection', async () => {
  const rowsIn = [
    { path: 'tenants/tM', data: { name: 'M', limits: { seats: 3 } } },
    { path: 'tenants/tM/leads/a', data: { n: 1, 'x.y': 2 } },
    { path: 'tenants/tM/leads/b', data: { n: 2 } },
    { path: 'tenants/tM/conversations/c1/messages/m1', data: { text: 'hi' } },
  ];
  await bulkReplaceDocuments(rowsIn);
  await bulkReplaceDocuments(rowsIn); // second run must not duplicate
  assert.equal(await countCollectionDocuments('tenants/tM/leads'), 2);
  assert.equal(await countCollectionDocuments('tenants/tM/conversations/c1/messages'), 1);
  assert.equal((await getDoc(doc(db, 'tenants', 'tM'))).data().limits.seats, 3);
  assert.deepEqual((await getDoc(doc(db, 'tenants', 'tM', 'leads', 'a'))).data(), { n: 1, 'x.y': 2 });
});

await (await getMongoDb()).dropDatabase();
await closeMongo();
console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`);
