/**
 * Moves existing app users (Firestore `app_users`, plaintext passwords) into
 * Firebase Auth for one tenant. Passwords are NOT carried over: each user gets
 * a password-setup link.
 *
 *   npx tsx scripts/migrate-users-to-auth.ts --tenant umrah360            # preview
 *   npx tsx scripts/migrate-users-to-auth.ts --tenant umrah360 --apply
 *
 * Skips the seeded demo accounts (@umrah360.com with known passwords) unless
 * --include-demo is passed. Safe to re-run. `app_users` is NOT modified or
 * deleted; delete it yourself once everyone has signed in.
 */
import 'dotenv/config';
import { getAdminAuth, getAdminFirestore, setTenantUserClaims, createPasswordSetupLink } from '../src/server/firebaseAdmin.js';
import { randomBytes } from 'node:crypto';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const DEMO_EMAILS = new Set(['admin@umrah360.com', 'tester@umrah360.com']);

async function main() {
  const tenantId = arg('tenant');
  const apply = process.argv.includes('--apply');
  const includeDemo = process.argv.includes('--include-demo');
  if (!tenantId) {
    console.error('Usage: migrate-users-to-auth --tenant <tenantId> [--apply] [--include-demo]');
    process.exit(1);
  }

  const fs = getAdminFirestore();
  const auth = getAdminAuth();

  const tenantSnap = await fs.collection('tenants').doc(tenantId).get();
  if (!tenantSnap.exists) {
    console.error(`Tenant "${tenantId}" does not exist in Firestore. Create/migrate it first.`);
    process.exit(1);
  }

  const snap = await fs.collection('app_users').get();
  console.log(`Found ${snap.size} app_users. Mode: ${apply ? 'APPLY' : 'DRY RUN'}\n`);

  for (const d of snap.docs) {
    const u = d.data() as any;
    const email = String(u.email || '').trim().toLowerCase();
    if (!email.includes('@')) { console.log(`- skip (no email): ${d.id}`); continue; }
    if (!includeDemo && DEMO_EMAILS.has(email)) { console.log(`- skip (demo account): ${email}`); continue; }

    const role = u.role === 'ADMIN' || u.role === 'admin' ? 'admin' : 'member';
    console.log(`- ${email}  ->  tenant=${tenantId} role=${role}`);
    if (!apply) continue;

    let rec;
    try {
      rec = await auth.getUserByEmail(email);
      const c = (rec.customClaims || {}) as any;
      if (c.tenantId && c.tenantId !== tenantId) {
        console.log(`  ! already in tenant ${c.tenantId}, skipped`);
        continue;
      }
    } catch (e: any) {
      if (e?.code !== 'auth/user-not-found') throw e;
      rec = await auth.createUser({
        email,
        password: randomBytes(24).toString('base64url') + 'aA1!',
        displayName: u.name || email.split('@')[0],
        emailVerified: false,
      });
    }

    await setTenantUserClaims(rec.uid, { tenantId, role });
    const now = new Date().toISOString();
    await fs.collection('users').doc(rec.uid).set(
      {
        uid: rec.uid, email, name: u.name || email.split('@')[0], tenantId, role, active: u.isActive !== false,
        allowedModules: u.allowedModules || ['inbox', 'campaigns', 'crm', 'scheduling', 'knowledge', 'settings'],
        createdAt: u.createdAt || now, updatedAt: now,
      },
      { merge: true }
    );
    console.log(`  setup link: ${await createPasswordSetupLink(email)}`);
  }
  if (!apply) console.log('\nDRY RUN: nothing changed. Re-run with --apply.');
}

main().catch((e) => { console.error('Failed:', e?.message || e); process.exit(1); });
