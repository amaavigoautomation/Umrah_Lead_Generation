/**
 * One-time: switch on Resend open + click tracking for domains that already exist in your Resend account.
 * New domains get it automatically when a workspace adds them (Settings -> Email); this script covers the
 * ones added before that, plus the platform's own sending domain (RESEND_FROM).
 *
 * A workspace that turned tracking OFF (Settings -> Email -> "Track opens and clicks") is skipped.
 *
 *   npx tsx scripts/enable-resend-tracking.ts            # preview: lists what would change
 *   npx tsx scripts/enable-resend-tracking.ts --apply    # make the changes
 *
 * Needs RESEND_API_KEY and FIREBASE_SERVICE_ACCOUNT_JSON (same .env as the server).
 */
import 'dotenv/config';
import { Resend } from 'resend';
import { getAdminFirestore } from '../src/server/firebaseAdmin.js';

async function main() {
  const apply = process.argv.includes('--apply');
  const key = (process.env.RESEND_API_KEY || '').trim();
  if (!key) throw new Error('RESEND_API_KEY is not set');
  const resend = new Resend(key);
  const fs = getAdminFirestore();

  const list = await resend.domains.list();
  if (list.error || !list.data) throw new Error(`Resend: ${list.error?.message || 'could not list domains'}`);
  const domains: any[] = (list.data as any).data || [];

  let changed = 0;
  for (const d of domains) {
    const name = String(d.name || '').toLowerCase();
    // Which workspace owns it (claims written by the app). No claim = the platform's own domain.
    const claim = await fs.collection('email_domains').doc(name).get();
    const tenantId: string | undefined = claim.exists ? claim.data()?.tenantId : undefined;
    let wanted = true;
    if (tenantId) {
      const settings = await fs.collection('tenants').doc(tenantId).collection('settings').doc('email').get();
      wanted = settings.data()?.trackingEnabled !== false;
    }

    const full = await resend.domains.get(d.id);
    const cur = (full.data || {}) as any;
    const isOn = cur.open_tracking === true && cur.click_tracking === true;
    const owner = tenantId ? `workspace ${tenantId}` : 'platform';
    if (isOn === wanted) {
      console.log(`  ok        ${name} (${owner}) tracking ${wanted ? 'on' : 'off'}`);
      continue;
    }
    changed++;
    console.log(`  ${apply ? 'updating' : 'would set'} ${name} (${owner}) tracking -> ${wanted ? 'on' : 'off'}`);
    if (!apply) continue;
    const res = await resend.domains.update({ id: d.id, openTracking: wanted, clickTracking: wanted });
    if (res.error) console.error(`    failed: ${res.error.message}`);
  }
  console.log(apply ? `Done. ${changed} domain(s) updated.` : `Preview only. ${changed} domain(s) would change. Re-run with --apply.`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
