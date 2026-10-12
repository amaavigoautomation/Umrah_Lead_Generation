/**
 * One-time cleanup: leads whose Auto Follow-Up sequence already finished BEFORE the fix still show "ON".
 * This finds them (ON, nothing scheduled, all attempts used) and switches them OFF as "Completed".
 *
 *   npx tsx scripts/fix-finished-followups.ts                  # preview, all workspaces
 *   npx tsx scripts/fix-finished-followups.ts --tenant acme    # preview, one workspace
 *   npx tsx scripts/fix-finished-followups.ts --apply          # make the changes
 *
 * Reads only leads with Auto Follow-Up ON. Needs FIREBASE_SERVICE_ACCOUNT_JSON.
 */
import 'dotenv/config';
import { getAdminFirestore } from '../src/server/firebaseAdmin.js';

const DEFAULT_MAX = 3;

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
  for (const tenantId of tenants) {
    const tRef = fs.collection('tenants').doc(tenantId);
    const cfgSnap = await tRef.collection('settings').doc('auto_followup_config').get();
    const channels: Record<string, any> = cfgSnap.data()?.channels || {};
    const maxFor = (source?: string) =>
      Number(channels[String(source || 'EMAIL').toUpperCase()]?.maxFollowUps || channels.EMAIL?.maxFollowUps || DEFAULT_MAX);

    const snap = await tRef.collection('leads').where('autoFollowUp.enabled', '==', true).get();
    for (const d of snap.docs) {
      const lead = d.data();
      const af = lead.autoFollowUp || {};
      const max = maxFor(lead.source);
      const attempts = Number(af.attemptCount || 0);
      const nothingScheduled = !af.nextScheduledAt && !af.activeFollowUpId;
      if (!nothingScheduled || attempts < max) continue;

      total++;
      console.log(`${tenantId} / ${d.id}: ${attempts}/${max} sent, ${apply ? 'switching OFF' : 'would switch OFF'}`);
      if (!apply) continue;
      const now = new Date().toISOString();
      await d.ref.set(
        {
          autoFollowUp: {
            enabled: false,
            disabledBy: 'AI Follow-Up Agent',
            disabledAt: now,
            disabledReason: 'completed',
            activeFollowUpId: null,
            nextScheduledAt: null,
            maxAttempts: max,
            completedAt: now,
          },
          updatedAt: now,
        },
        { merge: true }
      );
    }
  }
  console.log(apply ? `Done. ${total} lead(s) switched OFF.` : `Preview only. ${total} lead(s). Re-run with --apply.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
