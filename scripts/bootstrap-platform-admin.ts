/**
 * Creates (or promotes) the platform admin: the person who creates client
 * workspaces. Run ONCE per platform admin, from your own machine.
 *
 *   npx tsx scripts/bootstrap-platform-admin.ts --email you@example.com          # preview
 *   npx tsx scripts/bootstrap-platform-admin.ts --email you@example.com --apply  # do it
 *
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON (and FIRESTORE_DATABASE_ID if not default).
 *
 * What it writes (nothing else is touched):
 *   1. Firebase Auth: the user account (created if missing) + custom claims
 *      { platformAdmin: true, role: 'platformAdmin' }
 *   2. Firestore: one document users/{uid}
 * It prints a password-setup link. No password is ever typed or stored.
 */
import 'dotenv/config';
import { getAdminAuth, getAdminFirestore, setTenantUserClaims, createPasswordSetupLink } from '../src/server/firebaseAdmin.js';
import { randomBytes } from 'node:crypto';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const email = arg('email')?.trim().toLowerCase();
  const apply = process.argv.includes('--apply');
  if (!email || !email.includes('@')) {
    console.error('Usage: bootstrap-platform-admin --email <email> [--apply]');
    process.exit(1);
  }

  const auth = getAdminAuth();
  let existing = null as Awaited<ReturnType<typeof auth.getUserByEmail>> | null;
  try {
    existing = await auth.getUserByEmail(email);
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') throw e;
  }

  console.log(`Email:            ${email}`);
  console.log(`Auth account:     ${existing ? `exists (uid ${existing.uid})` : 'will be created'}`);
  console.log('Claims:           platformAdmin=true, role=platformAdmin (no tenant)');
  console.log(`Firestore write:  users/${existing?.uid || '<new uid>'}`);

  if (!apply) {
    console.log('\nDRY RUN: nothing was changed. Re-run with --apply to proceed.');
    return;
  }

  const user =
    existing ||
    (await auth.createUser({
      email,
      password: randomBytes(24).toString('base64url') + 'aA1!',
      emailVerified: true,
      displayName: email.split('@')[0],
    }));

  await setTenantUserClaims(user.uid, { platformAdmin: true, role: 'platformAdmin' });

  const now = new Date().toISOString();
  await getAdminFirestore()
    .collection('users')
    .doc(user.uid)
    .set(
      { uid: user.uid, email, name: user.displayName || email.split('@')[0], role: 'platformAdmin', active: true, createdAt: now, updatedAt: now },
      { merge: true }
    );

  const link = await createPasswordSetupLink(email);
  console.log('\nDone. Open this link to set your password (treat it like a password):\n');
  console.log(link);
  console.log('\nThen sign in at the app login page with this email.');
}

main().catch((e) => {
  console.error('Failed:', e?.message || e);
  process.exit(1);
});
