/**
 * One-time backfill: adds `phoneLast10` to existing campaign leads.
 *
 * Inbound WhatsApp replies now find their campaign lead with a single equality query on `phoneLast10`
 * (instead of reading every campaign lead). New leads get the field at creation; leads created before
 * this change need this script once, otherwise their WhatsApp replies are not linked to the campaign.
 * Email replies do not need it (lead emails were already stored trimmed + lowercased).
 *
 *   npx tsx scripts/backfill-campaign-lead-phone.ts                 # preview, all workspaces
 *   npx tsx scripts/backfill-campaign-lead-phone.ts --tenant acme   # preview, one workspace
 *   npx tsx scripts/backfill-campaign-lead-phone.ts --apply         # write
 *
 * Cost: one read per campaign lead, once. Requires FIREBASE_SERVICE_ACCOUNT_JSON.
 */
import 'dotenv/config';
import { getAdminFirestore } from '../src/server/firebaseAdmin.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const only = arg('tenant');
  const fs = getAdminFirestore();

  const tenants = only ? [only] : (await fs.collection('tenants').get()).docs.map((d) => d.id);
  let total = 0;
  for (const id of tenants) {
    const snap = await fs.collection('tenants').doc(id).collection('campaign_leads').get();
    let batch = fs.batch();
    let inBatch = 0;
    let count = 0;
    for (const d of snap.docs) {
      const data = d.data();
      if (data.phoneLast10) continue;
      const digits = String(data.phone || '').replace(/[^\d]/g, '');
      if (digits.length < 7) continue;
      count++;
      if (apply) {
        batch.update(d.ref, { phoneLast10: digits.slice(-10) });
        if (++inBatch === 400) {
          await batch.commit();
          batch = fs.batch();
          inBatch = 0;
        }
      }
    }
    if (apply && inBatch > 0) await batch.commit();
    console.log(`${id}: ${count} lead(s) ${apply ? 'updated' : 'would be updated'} (of ${snap.size})`);
    total += count;
  }
  console.log(apply ? `Updated ${total}.` : `Preview only. ${total} to update. Re-run with --apply.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
