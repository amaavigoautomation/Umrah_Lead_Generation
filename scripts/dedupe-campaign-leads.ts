/**
 * One-time cleanup: removes repeated emails INSIDE each campaign (campaigns created before the
 * duplicate check existed). The same email in different campaigns is left alone.
 *
 * Which copy is kept: the one with the most progress (replied > demo booked > sent > anything else),
 * then the lowest row number. The others are deleted. The campaign's search index is removed too, so it
 * is rebuilt (without the deleted leads) on the next search; the campaign counters are recounted on the
 * next send batch.
 *
 *   npx tsx scripts/dedupe-campaign-leads.ts                     # preview, all workspaces
 *   npx tsx scripts/dedupe-campaign-leads.ts --tenant acme       # preview, one workspace
 *   npx tsx scripts/dedupe-campaign-leads.ts --apply             # delete duplicates
 *
 * Cost: one read per campaign lead, once. Requires FIREBASE_SERVICE_ACCOUNT_JSON.
 */
import 'dotenv/config';
import { getAdminFirestore } from '../src/server/firebaseAdmin.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const normalizeEmail = (e: unknown) => String(e ?? '').trim().toLowerCase();

function progressScore(l: any): number {
  if (l.replyStatus === 'REPLIED') return 4;
  if (l.demoStatus === 'BOOKED') return 3;
  if (l.sendStatus === 'SENT') return 2;
  if (l.sendStatus === 'FAILED') return 1;
  return 0;
}

async function main() {
  const apply = process.argv.includes('--apply');
  const only = arg('tenant');
  const fs = getAdminFirestore();

  const tenants = only ? [only] : (await fs.collection('tenants').get()).docs.map((d) => d.id);
  let total = 0;
  for (const tenantId of tenants) {
    const tenantRef = fs.collection('tenants').doc(tenantId);
    const leadsSnap = await tenantRef.collection('campaign_leads').get();

    // campaignId -> email -> docs
    const groups = new Map<string, Map<string, FirebaseFirestore.QueryDocumentSnapshot[]>>();
    for (const d of leadsSnap.docs) {
      const l = d.data();
      const email = normalizeEmail(l.email);
      if (!l.campaignId || !email) continue;
      if (!groups.has(l.campaignId)) groups.set(l.campaignId, new Map());
      const byEmail = groups.get(l.campaignId)!;
      if (!byEmail.has(email)) byEmail.set(email, []);
      byEmail.get(email)!.push(d);
    }

    for (const [campaignId, byEmail] of groups) {
      const toDelete: FirebaseFirestore.QueryDocumentSnapshot[] = [];
      for (const docs of byEmail.values()) {
        if (docs.length < 2) continue;
        const sorted = [...docs].sort((a, b) => {
          const pa = progressScore(a.data());
          const pb = progressScore(b.data());
          if (pa !== pb) return pb - pa;
          return (a.data().rowNumber || 0) - (b.data().rowNumber || 0);
        });
        toDelete.push(...sorted.slice(1));
      }
      if (toDelete.length === 0) continue;
      total += toDelete.length;
      console.log(`${tenantId} / ${campaignId}: ${toDelete.length} duplicate lead(s) ${apply ? 'deleting' : 'would be deleted'}`);
      for (const d of toDelete.slice(0, 5)) {
        console.log(`    ${normalizeEmail(d.data().email)} (row ${d.data().rowNumber || '?'})`);
      }
      if (!apply) continue;

      for (let i = 0; i < toDelete.length; i += 400) {
        const batch = fs.batch();
        toDelete.slice(i, i + 400).forEach((d) => batch.delete(d.ref));
        await batch.commit();
      }
      // Drop the search index so it is rebuilt without the deleted leads.
      const idx = await tenantRef.collection('campaign_search').where('campaignId', '==', campaignId).get();
      await Promise.all(idx.docs.map((d) => d.ref.delete()));
    }
  }
  console.log(apply ? `Deleted ${total} duplicate lead(s).` : `Preview only. ${total} duplicate lead(s). Re-run with --apply.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
