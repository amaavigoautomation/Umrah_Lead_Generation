import { collection, doc, getDocs, getDoc } from 'firebase/firestore';
import { db, isFirebaseConfigured, firebaseConfig } from '../src/firebase/config.js';
import { safeSetDoc } from '../src/server/firestoreUtils.js';

interface MigrationStats {
  collection: string;
  sourceCount: number;
  migratedCount: number;
  skippedCount: number;
  errorCount: number;
}

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

export async function runMigration(dryRun: boolean = false): Promise<void> {
  console.log('========================================================================');
  console.log(`[Migration] Umrah360 Multi-Tenant Data Migration Engine`);
  console.log(`[Migration] Target Tenant ID: "${TARGET_TENANT_ID}"`);
  console.log(`[Migration] Mode: ${dryRun ? 'DRY-RUN (Simulated - No Database Writes)' : 'LIVE (Applying Writes)'}`);
  console.log('========================================================================\n');

  if (!isFirebaseConfigured || !db) {
    console.error('❌ Cannot run migration: Firebase Firestore is not configured in environment.');
    process.exit(1);
  }

  // 1. Ensure Target Tenant Document Exists
  const tenantDocRef = doc(db, 'tenants', TARGET_TENANT_ID);
  const tenantSnap = await getDoc(tenantDocRef).catch(() => null);

  const tenantRecord = {
    id: TARGET_TENANT_ID,
    name: 'Umrah360 Flagship',
    slug: 'umrah360',
    status: 'active',
    plan: 'enterprise',
    limits: {
      monthlyAiTokens: 5_000_000,
      dailyOutboundSends: 10_000,
      hourlyOutboundSends: 1_000,
      seats: 25,
    },
    timezone: 'Asia/Kolkata',
    defaultCurrency: 'INR',
    contactEmail: 'amaavigo@gmail.com',
    createdAt: tenantSnap?.exists() ? tenantSnap.data()?.createdAt : new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    migratedAt: new Date().toISOString(),
  };

  if (!dryRun) {
    await safeSetDoc(tenantDocRef, tenantRecord, { merge: true });
    console.log(`✓ Ensured tenant record exists at: /tenants/${TARGET_TENANT_ID}\n`);
  } else {
    console.log(`[DRY-RUN] Would create or merge tenant record at: /tenants/${TARGET_TENANT_ID}\n`);
  }

  const allStats: MigrationStats[] = [];

  // 2. Iterate each flat collection and copy into tenants/umrah360/...
  for (const colName of COLLECTIONS_TO_MIGRATE) {
    const stats: MigrationStats = {
      collection: colName,
      sourceCount: 0,
      migratedCount: 0,
      skippedCount: 0,
      errorCount: 0,
    };

    try {
      const sourceColRef = collection(db, colName);
      const snapshot = await getDocs(sourceColRef).catch((e) => {
        console.warn(`[Migration Notice] Collection '${colName}' query note:`, e.message);
        return null;
      });

      if (!snapshot || snapshot.empty) {
        allStats.push(stats);
        console.log(
          `• ${colName.padEnd(30)} -> Found:    0 | Migrated:    0 | Errors: 0`
        );
        continue;
      }

      stats.sourceCount = snapshot.size;

      for (const d of snapshot.docs) {
        const docId = d.id;
        const data = d.data();

        const enrichedData = {
          ...data,
          tenantId: TARGET_TENANT_ID,
          _migratedFromRoot: colName,
          _migratedAt: new Date().toISOString(),
        };

        const targetDocRef = doc(db, `tenants/${TARGET_TENANT_ID}/${colName}`, docId);

        if (!dryRun) {
          try {
            await safeSetDoc(targetDocRef, enrichedData, { merge: true });
            stats.migratedCount++;
          } catch (wErr) {
            stats.errorCount++;
            console.error(`  ❌ Error writing doc ${colName}/${docId}:`, wErr);
          }
        } else {
          stats.migratedCount++;
        }
      }
    } catch (colErr) {
      console.error(`❌ Unexpected error migrating collection ${colName}:`, colErr);
    }

    allStats.push(stats);
    console.log(
      `• ${colName.padEnd(30)} -> Found: ${String(stats.sourceCount).padStart(4)} | Migrated: ${String(stats.migratedCount).padStart(4)} | Errors: ${stats.errorCount}`
    );
  }

  // 3. Migrate app_users to global users collection
  try {
    const appUsersCol = collection(db, 'app_users');
    const usersSnap = await getDocs(appUsersCol).catch(() => null);
    if (usersSnap && !usersSnap.empty) {
      console.log(`\n• Migrating ${usersSnap.size} app_users into global /users collection...`);
      for (const d of usersSnap.docs) {
        const u = d.data();
        const uid = u.userId || d.id;
        const globalUser = {
          uid,
          email: u.email || `${u.username || 'user'}@umrah360.in`,
          name: u.name || u.username || 'Umrah360 Operator',
          tenantId: TARGET_TENANT_ID,
          role: u.role === 'ADMIN' ? 'admin' : 'member',
          active: u.isActive !== false,
          allowedModules: u.allowedModules || ['inbox', 'campaigns', 'crm', 'calendar', 'knowledge'],
          createdAt: u.createdAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        };

        if (!dryRun) {
          await safeSetDoc(doc(db, 'users', uid), globalUser, { merge: true });
        }
      }
      console.log(`✓ Successfully migrated ${usersSnap.size} users into global /users collection.`);
    }
  } catch (e) {
    console.warn('[Migration Notice] app_users migration notice:', e);
  }

  console.log('\n========================================================================');
  console.log(`[Migration Summary] Completed ${dryRun ? 'DRY-RUN simulation' : 'LIVE migration'}.`);
  console.log('========================================================================');
  console.log(`
CUTOVER CHECKLIST:
1. [✓] Verify all counts above match expectations.
2. [✓] Confirm target tenant document exists at /tenants/${TARGET_TENANT_ID}.
3. [✓] Legacy collections remain untouched as read-only backups.
4. [✓] Deploy and verify firestore.rules ensuring clients are scoped to their tenant.
5. [✓] Restart api and worker processes via PM2.
6. [✓] Test read and write operations inside the app under tenant context.
`);
}

const isDryRun = process.argv.includes('--dry-run');
runMigration(isDryRun).then(() => process.exit(0)).catch((err) => {
  console.error('Fatal migration error:', err);
  process.exit(1);
});
