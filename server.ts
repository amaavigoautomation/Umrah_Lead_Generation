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

// Background poller for inbound email, website leads, and outbound campaigns
let isBackgroundPolling = false;
const safeBackgroundPoll = async () => {
  if (isBackgroundPolling) return;
  isBackgroundPolling = true;
  try {
    // 1. Inbound website demo lead responder
    await checkAndDispatchPendingWebsiteLeadEmails().catch(() => {});

    // 2. Poll IMAP if configured
    const cfg = getImapConfig();
    if (cfg && cfg.configured) {
      await pollAndProcessImapMailbox().catch(() => {});
    }

    // 3. Process active campaign batches
    await processActiveRunningCampaignsBatch(3).catch(() => {});
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
