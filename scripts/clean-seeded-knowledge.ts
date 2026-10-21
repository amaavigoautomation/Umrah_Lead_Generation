/**
 * Removes the built-in Umrah360 knowledge articles that were copied into other workspaces.
 * Only deletes documents whose id matches a built-in article, so anything a workspace wrote itself is kept.
 * The umrah360 workspace is never touched.
 *
 *   npx tsx scripts/clean-seeded-knowledge.ts                       # preview, all workspaces
 *   npx tsx scripts/clean-seeded-knowledge.ts --tenant acme         # preview, one workspace
 *   npx tsx scripts/clean-seeded-knowledge.ts --apply               # delete
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON.
 */
import 'dotenv/config';
import { getAdminFirestore } from '../src/server/firebaseAdmin.js';
import { INITIAL_KNOWLEDGE_DOCUMENTS } from '../src/services/knowledgeData.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const only = arg('tenant');
  const builtIn = new Set(INITIAL_KNOWLEDGE_DOCUMENTS.map((d) => d.id));
  const fs = getAdminFirestore();

  const tenants = only ? [only] : (await fs.collection('tenants').get()).docs.map((d) => d.id);
  let total = 0;
  for (const id of tenants) {
    if (id === 'umrah360') continue;
    const col = fs.collection('tenants').doc(id).collection('knowledge_documents');
    const snap = await col.get();
    const seeded = snap.docs.filter((d) => builtIn.has(d.id));
    const own = snap.size - seeded.length;
    console.log(`${id}: ${seeded.length} built-in article(s) ${apply ? 'deleting' : 'would be deleted'}, ${own} own article(s) kept`);
    if (apply) for (const d of seeded) await d.ref.delete();
    total += seeded.length;
  }
  console.log(apply ? `Deleted ${total}.` : `Preview only. ${total} to delete. Re-run with --apply.`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
