/**
 * Copies the legacy single-client (flat, root-level) collections into
 * tenants/umrah360/<collection>. Uses the Firebase ADMIN SDK, so it is not
 * blocked by Firestore security rules, and it FAILS LOUDLY: every write is
 * verified, and the process exits non-zero if anything did not land.
 *
 *   npm run migrate:dry-run     # reads source, writes nothing
 *   npm run migrate             # copies, then verifies target counts
 *
 * Source collections are never modified or deleted. Safe to re-run (merge).
 * Users are NOT migrated here: use `npm run migrate:users -- --tenant umrah360`.
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON (and FIRESTORE_DATABASE_ID if not default).
 */
import 'dotenv/config';
import { getAdminFirestore } from '../src/server/firebaseAdmin.js';

const TARGET_TENANT_ID = 'umrah360';
const COLLECTIONS_TO_MIGRATE = [
  'contacts',
  'leads',
  'conversations',
  'messages',
  'campaigns',
  'campaign_leads',
  'campaign_runs',
  'campaign_send_history',
  'email_templates',
  'knowledge_documents',
  'bookings',
  'lead_activities',
  'outbound_prospects',
  'outbound_campaigns',
  'processed_inbound_emails',
  'website_lead_thankyou_history',
  'settings',
  'system_settings',
];

export async function runMigration(dryRun: boolean): Promise<void> {
  const fs = getAdminFirestore();
  const now = new Date().toISOString();

  console.log('========================================================================');
  console.log(`[Migration] Target tenant: "${TARGET_TENANT_ID}"`);
  console.log(`[Migration] Mode: ${dryRun ? 'DRY-RUN (no writes)' : 'LIVE (applying writes)'}`);
  console.log('========================================================================\n');

  // 1. Tenant record
  const tenantRef = fs.collection('tenants').doc(TARGET_TENANT_ID);
  const tenantSnap = await tenantRef.get();
  const tenantRecord = {
    id: TARGET_TENANT_ID,
    name: 'Umrah360 Flagship',
    slug: 'umrah360',
    status: 'active',
    plan: 'enterprise',
    limits: { monthlyAiTokens: 5_000_000, dailyOutboundSends: 10_000, hourlyOutboundSends: 1_000, seats: 25 },
    timezone: 'Asia/Kolkata',
    defaultCurrency: 'INR',
    contactEmail: 'amaavigo@gmail.com',
    createdAt: tenantSnap.exists ? tenantSnap.data()?.createdAt : now,
    updatedAt: now,
    migratedAt: now,
  };
  if (dryRun) {
    console.log(`[DRY-RUN] Would create/merge tenants/${TARGET_TENANT_ID} (exists now: ${tenantSnap.exists})\n`);
  } else {
    await tenantRef.set(tenantRecord, { merge: true });
    const check = await tenantRef.get();
    if (!check.exists) throw new Error(`Tenant record tenants/${TARGET_TENANT_ID} was not created`);
    console.log(`✓ Tenant record exists at tenants/${TARGET_TENANT_ID}\n`);
  }

  // 2. Copy each collection
  let problems = 0;
  for (const colName of COLLECTIONS_TO_MIGRATE) {
    const source = await fs.collection(colName).get();
    let written = 0;

    if (!dryRun && !source.empty) {
      const docs = source.docs;
      for (let i = 0; i < docs.length; i += 400) {
        const batch = fs.batch();
        for (const d of docs.slice(i, i + 400)) {
          batch.set(
            tenantRef.collection(colName).doc(d.id),
            { ...d.data(), tenantId: TARGET_TENANT_ID, _migratedFromRoot: colName, _migratedAt: now },
            { merge: true }
          );
        }
        await batch.commit();
        written += Math.min(400, docs.length - i);
      }
    }

    // Verify: every source doc id must exist in the target
    let verified = 0;
    if (!dryRun && !source.empty) {
      const target = await tenantRef.collection(colName).get();
      const targetIds = new Set(target.docs.map((t) => t.id));
      verified = source.docs.filter((d) => targetIds.has(d.id)).length;
      if (verified !== source.size) problems++;
    }

    const status = dryRun
      ? ''
      : source.size === 0
        ? ''
        : verified === source.size
          ? ' ✓'
          : ' ❌ MISMATCH';
    console.log(
      `• ${colName.padEnd(30)} source: ${String(source.size).padStart(4)} | written: ${String(written).padStart(4)} | verified in target: ${String(verified).padStart(4)}${status}`
    );
  }

  console.log('\n========================================================================');
  if (dryRun) {
    console.log('DRY-RUN finished. Nothing was written. Run `npm run migrate` to apply.');
  } else if (problems > 0) {
    console.error(`❌ Migration finished with ${problems} collection(s) not fully copied. Do NOT cut over.`);
    process.exit(1);
  } else {
    console.log('✓ Migration complete and verified. Legacy collections were left untouched.');
    console.log('Next: npm run migrate:users -- --tenant umrah360');
  }
  console.log('========================================================================');
}

runMigration(process.argv.includes('--dry-run'))
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Fatal migration error:', err?.message || err);
    process.exit(1);
  });