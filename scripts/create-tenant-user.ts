/**
 * Creates a user inside ONE workspace (tenant). Use for the first admin of a
 * workspace, or any teammate, until the admin console exists.
 *
 *   npx tsx scripts/create-tenant-user.ts --tenant umrah360 --email a@b.com --role admin          # preview
 *   USER_PASSWORD='long-password-12+' npx tsx scripts/create-tenant-user.ts --tenant umrah360 --email a@b.com --role admin --apply
 *
 * --role admin | member   (default member)
 * Without USER_PASSWORD it prints a one-time password-setup link instead.
 * An email can belong to only one workspace (and cannot be the platform admin's email).
 * Requires FIREBASE_SERVICE_ACCOUNT_JSON.
 */
import 'dotenv/config';
import { getAdminAuth, getAdminFirestore, createTenantUser, createPasswordSetupLink } from '../src/server/firebaseAdmin.js';

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const tenantId = arg('tenant');
  const email = arg('email')?.trim().toLowerCase();
  const role = arg('role') === 'admin' ? 'admin' : 'member';
  const apply = process.argv.includes('--apply');
  const password = process.env.USER_PASSWORD;

  if (!tenantId || !email || !email.includes('@')) {
    console.error('Usage: create-tenant-user --tenant <id> --email <email> [--role admin|member] [--apply]');
    process.exit(1);
  }
  if (password && password.length < 12) {
    console.error('USER_PASSWORD must be at least 12 characters.');
    process.exit(1);
  }

  const fs = getAdminFirestore();
  const tenant = await fs.collection('tenants').doc(tenantId).get();
  if (!tenant.exists) {
    console.error(`Tenant "${tenantId}" does not exist.`);
    process.exit(1);
  }

  const auth = getAdminAuth();
  let existing = null as Awaited<ReturnType<typeof auth.getUserByEmail>> | null;
  try {
    existing = await auth.getUserByEmail(email);
  } catch (e: any) {
    if (e?.code !== 'auth/user-not-found') throw e;
  }
  const c = (existing?.customClaims || {}) as any;
  if (c.platformAdmin) {
    console.error('That email is a platform admin. Use a different email for a workspace user.');
    process.exit(1);
  }

  console.log(`Workspace: ${tenantId}\nEmail:     ${email}\nRole:      ${role}\nAccount:   ${existing ? 'exists' : 'will be created'}`);
  if (!apply) {
    console.log('\nDRY RUN: nothing changed. Re-run with --apply.');
    return;
  }

  const user = await createTenantUser({ email, tenantId, role, password });
  if (password) {
    // createTenantUser only uses `password` for NEW accounts; apply it explicitly
    // so existing accounts get it too (and the message below is true).
    await auth.updateUser(user.uid, { password, emailVerified: true });
  }
  const now = new Date().toISOString();
  await fs.collection('users').doc(user.uid).set(
    {
      uid: user.uid, email, name: user.displayName || email.split('@')[0], tenantId, role, active: true,
      allowedModules: ['inbox', 'campaigns', 'crm', 'scheduling', 'knowledge', 'settings'],
      createdAt: now, updatedAt: now,
    },
    { merge: true }
  );
  console.log('\nDone.');
  if (!password) {
    console.log('One-time password-setup link (treat like a password):\n');
    console.log(await createPasswordSetupLink(email));
  } else {
    console.log('Password set. The user can sign in now.');
  }
}

main().catch((e) => { console.error('Failed:', e?.message || e); process.exit(1); });