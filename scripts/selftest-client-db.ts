/**
 * Smoke test for the browser data path: authorization rules (ported from firestore.rules) in
 * src/server/clientDataApi.ts, plus the browser shim src/services/clientDb.ts talking to it.
 *
 *   MONGODB_URI=mongodb://127.0.0.1:27017 MONGODB_DB_NAME=umrah_selftest npm run test:client-db
 */
import 'dotenv/config';
import assert from 'node:assert/strict';
import { handleClientDataRequest } from '../src/server/clientDataApi.js';
import { getMongoDb, closeMongo } from '../src/server/mongo/mongoClient.js';
import { db as serverDb, doc as sDoc, setDoc as sSetDoc } from '../src/server/adminFirestore.js';
import type { TenantContext } from '../src/types/tenant.js';

if (!/test/i.test(process.env.MONGODB_DB_NAME || '')) {
  console.error('Refusing to run: MONGODB_DB_NAME must contain "test".');
  process.exit(2);
}
await (await getMongoDb()).dropDatabase();

let passed = 0;
async function t(name: string, fn: () => Promise<void>) {
  try { await fn(); passed++; console.log('  ok  ', name); }
  catch (e: any) { console.error('  FAIL', name, '\n      ', e?.message || e); process.exitCode = 1; }
}

const member: TenantContext = { tenantId: 'tA', uid: 'uMember', email: 'm@a.com', role: 'member' };
const admin: TenantContext = { tenantId: 'tA', uid: 'uAdmin', email: 'a@a.com', role: 'admin' };
const otherAdmin: TenantContext = { tenantId: 'tB', uid: 'uB', email: 'b@b.com', role: 'admin' };
const platform: TenantContext = { tenantId: 'platform', uid: 'uP', email: 'p@x.com', role: 'platformAdmin', isPlatformAdmin: true };

const call = (ctx: TenantContext, body: any) => handleClientDataRequest(ctx, body);

await t('member can write/read a tenant lead; other tenant cannot', async () => {
  assert.equal((await call(member, { op: 'set', path: 'tenants/tA/leads/L1', data: { name: 'Ann', score: 3 } })).status, 200);
  const got = await call(member, { op: 'get', path: 'tenants/tA/leads/L1' });
  assert.deepEqual([got.status, got.payload.exists, got.payload.data], [200, true, { name: 'Ann', score: 3 }]);
  assert.equal((await call(otherAdmin, { op: 'get', path: 'tenants/tA/leads/L1' })).status, 403);
  assert.equal((await call(otherAdmin, { op: 'set', path: 'tenants/tA/leads/L2', data: { x: 1 } })).status, 403);
  assert.equal((await call(platform, { op: 'get', path: 'tenants/tA/leads/L1' })).status, 200);
});

await t('server-only collections are denied to everyone but never leak', async () => {
  for (const sub of ['secrets', 'usage_daily', 'jobs', 'ai_test_feedback', 'campaign_reports', 'made_up']) {
    assert.equal((await call(admin, { op: 'get', path: `tenants/tA/${sub}/x` })).status, 403, sub);
    assert.equal((await call(admin, { op: 'list', path: `tenants/tA/${sub}` })).status, 403, sub);
  }
});

await t('settings: member reads, only admin writes', async () => {
  assert.equal((await call(admin, { op: 'set', path: 'tenants/tA/settings/default', data: { a: 1 }, merge: true })).status, 200);
  assert.equal((await call(member, { op: 'get', path: 'tenants/tA/settings/default' })).status, 200);
  assert.equal((await call(member, { op: 'set', path: 'tenants/tA/settings/default', data: { a: 2 } })).status, 403);
});

await t('usage is admin-read only; lead databases are read-only for clients', async () => {
  await sSetDoc(sDoc(serverDb, 'tenants', 'tA', 'usage', '2026-11'), { n: 1 });
  assert.equal((await call(member, { op: 'get', path: 'tenants/tA/usage/2026-11' })).status, 403);
  assert.equal((await call(admin, { op: 'get', path: 'tenants/tA/usage/2026-11' })).status, 200);
  assert.equal((await call(admin, { op: 'set', path: 'tenants/tA/usage/2026-11', data: { n: 9 } })).status, 403);
  assert.equal((await call(member, { op: 'list', path: 'tenants/tA/lead_databases' })).status, 200);
  assert.equal((await call(admin, { op: 'set', path: 'tenants/tA/lead_databases/d1', data: {} })).status, 403);
});

await t('users/{uid}: own read; admins write only their own workspace profiles; no privilege escalation', async () => {
  await sSetDoc(sDoc(serverDb, 'users', 'uMember'), { tenantId: 'tA', name: 'M' });
  assert.equal((await call(member, { op: 'get', path: 'users/uMember' })).status, 200);
  assert.equal((await call(member, { op: 'get', path: 'users/uAdmin' })).status, 403);
  assert.equal((await call(member, { op: 'set', path: 'users/uMember', data: { tenantId: 'tA', allowedModules: ['x'] } })).status, 403);
  assert.equal((await call(admin, { op: 'set', path: 'users/new1', data: { tenantId: 'tA', name: 'N' }, merge: true })).status, 200);
  assert.equal((await call(admin, { op: 'set', path: 'users/new2', data: { tenantId: 'tB', name: 'N' } })).status, 403);
  assert.equal((await call(admin, { op: 'set', path: 'users/new3', data: { tenantId: 'tA', role: 'platformAdmin' } })).status, 403);
  await sSetDoc(sDoc(serverDb, 'users', 'foreign'), { tenantId: 'tB' });
  assert.equal((await call(admin, { op: 'set', path: 'users/foreign', data: { tenantId: 'tA' } })).status, 403);
  assert.equal((await call(admin, { op: 'delete', path: 'users/foreign' })).status, 403);
  assert.equal((await call(admin, { op: 'delete', path: 'users/new1' })).status, 200);
  assert.equal((await call(admin, { op: 'get', path: 'app_users/x' })).status, 403);
  assert.equal((await call(admin, { op: 'get', path: 'leads/anything' })).status, 403);
});

await t('list: filters, ordering, limit, __name__ in, etag/not-modified, bad input', async () => {
  for (const [id, d] of [['a', { s: 'NEW', n: 3 }], ['b', { s: 'NEW', n: 1 }], ['c', { s: 'WON', n: 2 }]] as const) {
    await call(member, { op: 'set', path: `tenants/tA/campaign_leads/${id}`, data: d });
  }
  const r = await call(member, {
    op: 'list', path: 'tenants/tA/campaign_leads',
    wheres: [{ field: 's', op: '==', value: 'NEW' }], orders: [{ field: 'n', dir: 'desc' }], limit: 5,
  });
  assert.deepEqual(r.payload.docs.map((d: any) => d.id), ['a', 'b']);
  const again = await call(member, {
    op: 'list', path: 'tenants/tA/campaign_leads', wheres: [{ field: 's', op: '==', value: 'NEW' }],
    orders: [{ field: 'n', dir: 'desc' }], limit: 5, ifNoneMatch: r.payload.etag,
  });
  assert.equal(again.payload.notModified, true);
  const byId = await call(member, { op: 'list', path: 'tenants/tA/campaign_leads', wheres: [{ field: '__name__', op: 'in', value: ['b', 'c'] }], orders: [{ field: '__name__', dir: 'asc' }] });
  assert.deepEqual(byId.payload.docs.map((d: any) => d.id), ['b', 'c']);
  assert.equal((await call(member, { op: 'list', path: 'tenants/tA/campaign_leads', wheres: [{ field: '$where', op: '==', value: 1 }] })).status, 400);
  assert.equal((await call(member, { op: 'list', path: 'tenants/tA/campaign_leads', wheres: [{ field: 'a', op: 'regex', value: 1 }] })).status, 400);
  assert.equal((await call(member, { op: 'get', path: 'tenants/tA/campaign_leads' })).status, 400);
  assert.equal((await call(member, { op: 'get', path: 'tenants/../tenants/tB/leads/x' })).status, 400);
  assert.equal((await call(member, { op: 'nuke', path: 'tenants/tA/leads/L1' })).status, 400);
});

await t('update on a missing doc is 404', async () => {
  assert.equal((await call(member, { op: 'update', path: 'tenants/tA/leads/ghost', data: { a: 1 } })).status, 404);
});

// ---- Browser shim, with fetch wired straight into the handler as the "member" session ----
(globalThis as any).fetch = async (_url: string, init: any) => {
  const r = await call(member, JSON.parse(init.body));
  return { ok: r.status < 400, status: r.status, json: async () => r.payload } as any;
};
const c = await import('../src/services/clientDb.js');

await t('shim: set/get/update/delete/query round trip', async () => {
  const ref = c.doc(c.db, 'tenants', 'tA', 'contacts', 'c1');
  await c.setDoc(ref, { name: 'Zed', n: 1 });
  await c.setDoc(ref, { extra: true }, { merge: true });
  await c.updateDoc(ref, { n: 2 });
  const snap = await c.getDoc(ref);
  assert.deepEqual([snap.exists(), snap.id, snap.data()], [true, 'c1', { name: 'Zed', n: 2, extra: true }]);
  const q = await c.getDocs(c.query(c.collection(c.db, 'tenants', 'tA', 'contacts'), c.where('n', '==', 2), c.orderBy('name'), c.limit(10)));
  assert.deepEqual([q.size, q.docs[0].id, q.docs[0].ref.path], [1, 'c1', 'tenants/tA/contacts/c1']);
  await c.deleteDoc(ref);
  assert.equal((await c.getDoc(ref)).exists(), false);
  await assert.rejects(() => c.getDocs(c.collection(c.db, 'tenants', 'tA', 'secrets')), (e: any) => e.code === 'permission-denied');
  assert.match(c.doc(c.collection(c.db, 'tenants', 'tA', 'leads')).id, /^[A-Za-z0-9]{20}$/);
});

await t('shim: onSnapshot fires first, then promptly after a local write; unsubscribe stops it', async () => {
  const col = c.collection(c.db, 'tenants', 'tA', 'outbound_campaigns');
  const seen: number[] = [];
  const unsub = c.onSnapshot(col, (s: any) => seen.push(s.size));
  await new Promise((r) => setTimeout(r, 300));
  assert.deepEqual(seen, [0]);
  await c.setDoc(c.doc(col, 'x1'), { a: 1 });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(seen, [0, 1]);
  unsub();
  await c.setDoc(c.doc(col, 'x2'), { a: 1 });
  await new Promise((r) => setTimeout(r, 500));
  assert.deepEqual(seen, [0, 1]);
});

await t('shim: onSnapshot reports permission errors once and stops', async () => {
  const errors: string[] = [];
  const unsub = c.onSnapshot(c.collection(c.db, 'tenants', 'tB', 'leads'), () => {}, (e: any) => errors.push(e.code));
  await new Promise((r) => setTimeout(r, 300));
  unsub();
  assert.deepEqual(errors, ['permission-denied']);
});

await (await getMongoDb()).dropDatabase();
await closeMongo();
console.log(`\n${passed} checks passed${process.exitCode ? ' (with failures)' : ''}`);
process.exit(process.exitCode ?? 0);
