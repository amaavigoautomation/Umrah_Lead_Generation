import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { handleCoreApi } from './src/server/coreApiHandler.js';
import { pollAndProcessImapMailbox } from './src/server/inboundPipeline.js';
import { getImapConfig } from './src/server/imapService.js';
import { checkAndDispatchPendingWebsiteLeadEmails } from './src/server/websiteLeadAutoResponder.js';
import { processActiveRunningCampaignsBatch } from './src/server/campaignService.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const app = express();
const PORT: number = Number(process.env.PORT) || 3000;

// Body parsers
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

import { runWithJobLease } from './src/server/jobLeaseService.js';
import { globalTenantsCol } from './src/server/tenantRepo.js';
import { getDocs } from 'firebase/firestore';
import { db, isFirebaseConfigured } from './src/firebase/config.js';
import type { TenantContext } from './src/types/tenant.js';

// Background poller for inbound email, website leads, and outbound campaigns with distributed leasing
let isBackgroundPolling = false;
const safeBackgroundPoll = async () => {
  if (isBackgroundPolling) return;
  isBackgroundPolling = true;

  try {
    // 1. Discover all active tenants
    const tenantIds: string[] = ['umrah360'];
    if (isFirebaseConfigured && db) {
      try {
        const snap = await getDocs(globalTenantsCol());
        snap.forEach((d) => {
          const t = d.data();
          if (t.id && t.status !== 'suspended' && !tenantIds.includes(t.id)) {
            tenantIds.push(t.id);
          }
        });
      } catch {}
    }

    // 2. Process background tasks per tenant under distributed lease
    for (const tId of tenantIds) {
      const ctx: TenantContext = {
        tenantId: tId,
        uid: 'system-worker',
        email: `worker@${tId}.in`,
        role: 'admin',
      };

      // A. Inbound website demo lead auto-responder
      await runWithJobLease(tId, 'website_leads_worker', 15_000, async () => {
        await checkAndDispatchPendingWebsiteLeadEmails(ctx).catch(() => {});
      }).catch(() => {});

      // B. Poll IMAP if configured
      const cfg = getImapConfig();
      if (cfg && cfg.configured) {
        await runWithJobLease(tId, 'imap_poller_worker', 30_000, async () => {
          await pollAndProcessImapMailbox(ctx).catch(() => {});
        }).catch(() => {});
      }

      // C. Process active campaign batches
      await runWithJobLease(tId, 'campaign_dispatch_worker', 20_000, async () => {
        await processActiveRunningCampaignsBatch(3, ctx).catch(() => {});
      }).catch(() => {});
    }
  } catch (e) {
    // ignore background errors
  } finally {
    isBackgroundPolling = false;
  }
};

// Start background poller interval (every 4 seconds)
setTimeout(safeBackgroundPoll, 2000);
setInterval(safeBackgroundPoll, 4000);

// API route middleware
app.use('/api', async (req, res, next) => {
  try {
    const handled = await handleCoreApi(req, res);
    if (!handled && !res.writableEnded) {
      res.status(404).json({ error: 'Endpoint not found', url: req.originalUrl || req.url });
    }
  } catch (err: any) {
    console.error('[Server API Error]:', err);
    if (!res.writableEnded) {
      res.status(500).json({ error: err?.message || 'Internal Server Error' });
    }
  }
});

// Serve frontend static assets from dist
const distPath = path.join(__dirname, 'dist');
app.use(express.static(distPath));

// SPA catch-all fallback
app.get('*', (req, res) => {
  if (req.url.startsWith('/api')) {
    return res.status(404).json({ error: 'API route not found' });
  }
  res.sendFile(path.join(distPath, 'index.html'));
});

app.listen(PORT, '0.0.0.0', () => {
  console.log(`[Umrah360 Server] Running on http://0.0.0.0:${PORT} in ${process.env.NODE_ENV || 'production'} mode`);
});
