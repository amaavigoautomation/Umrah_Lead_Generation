import express from 'express';
import path from 'path';
import { fileURLToPath } from 'url';
import { createServer as createViteServer } from 'vite';
import { handleUmrah360ApiRequest } from './src/vite-plugin-api.ts';
import { verifyMetaWebhookChallenge } from './src/server/whatsappService.js';
import { handleMetaWhatsAppWebhook } from './src/server/whatsappPipeline.js';
import { checkImapStatus, getImapConfig } from './src/server/imapService.js';
import { pollAndProcessImapMailbox } from './src/server/inboundPipeline.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function startServer() {
  const app = express();
  const PORT = 3000;

  // Middleware for raw/json body parsing
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true }));

  // Request logger for Meta webhooks and API calls
  app.use((req, res, next) => {
    if (req.url.includes('webhook') || req.url.includes('whatsapp') || req.url.startsWith('/api/')) {
      console.log(`[HTTP ${req.method}] ${req.url} - IP: ${req.ip} - Time: ${new Date().toISOString()}`);
    }
    next();
  });

  // Dedicated Meta Webhook Verification GET Handler (handles all path variations)
  const webhookPaths = [
    '/api/webhook/whatsapp',
    '/api/webhook/whatsapp/',
    '/webhook/whatsapp',
    '/webhook/whatsapp/',
    '/api/whatsapp/webhook',
    '/api/whatsapp/webhook/',
    '/whatsapp/webhook',
    '/whatsapp/webhook/'
  ];

  app.get(webhookPaths, (req, res) => {
    const mode =
      (req.query['hub.mode'] as string) ||
      (req.query['hub_mode'] as string) ||
      (req.query['hub[mode]'] as string) ||
      (req.query.mode as string);

    const token =
      (req.query['hub.verify_token'] as string) ||
      (req.query['hub_verify_token'] as string) ||
      (req.query['hub[verify_token]'] as string) ||
      (req.query.verify_token as string) ||
      (req.query.token as string);

    const challenge =
      (req.query['hub.challenge'] as string) ||
      (req.query['hub_challenge'] as string) ||
      (req.query['hub[challenge]'] as string) ||
      (req.query.challenge as string);

    console.log(`[Meta Webhook] GET Verification Request received on ${req.path}`);
    console.log(`[Meta Webhook] Parameters: hub.mode=${mode}, hub.verify_token=${token}, hub.challenge=${challenge}`);

    const verification = verifyMetaWebhookChallenge(mode, token, challenge);

    if (verification.verified && verification.challenge) {
      console.log(`[Meta Webhook] Verification PASSED. Returning HTTP 200 with challenge: ${verification.challenge}`);
      res.setHeader('Content-Type', 'text/plain; charset=utf-8');
      return res.status(200).send(verification.challenge);
    }

    console.warn(`[Meta Webhook] Verification FAILED for token: "${token}" against configured tokens.`);
    return res.status(403).json({
      error: 'Webhook verification failed: token mismatch or missing parameters',
      receivedMode: mode,
      receivedToken: token,
      hint: 'Ensure verify token matches umrah360_meta_webhook_token_2026 or META_WEBHOOK_VERIFY_TOKEN'
    });
  });

  // Dedicated Meta Webhook POST Handler
  app.post(webhookPaths, async (req, res) => {
    console.log(`[Meta Webhook] POST incoming event received on ${req.path}`);
    try {
      const results = await handleMetaWhatsAppWebhook(req.body);
      return res.status(200).json({ status: 'EVENT_RECEIVED', results });
    } catch (err: any) {
      console.error('[Meta Webhook] Error processing event:', err);
      return res.status(200).json({ status: 'ERROR_RECORDED', error: err?.message });
    }
  });

  // Background IMAP polling if IMAP is configured
  let isBackgroundPolling = false;
  const safeBackgroundPoll = async () => {
    if (isBackgroundPolling) return;
    isBackgroundPolling = true;
    try {
      const cfg = getImapConfig();
      if (cfg.configured) {
        await pollAndProcessImapMailbox();
      }
    } catch {
      // ignore
    } finally {
      isBackgroundPolling = false;
    }
  };

  setInterval(safeBackgroundPoll, 8000);
  setTimeout(safeBackgroundPoll, 2000);

  // Mount other API request handlers
  app.use('/api', async (req, res, next) => {
    try {
      const handled = await handleUmrah360ApiRequest(req, res);
      if (!handled && !res.writableEnded) {
        next();
      }
    } catch (err) {
      console.error('[Server] API Error:', err);
      if (!res.writableEnded) {
        res.status(500).json({ error: 'Internal Server Error', details: String(err) });
      }
    }
  });

  // Vite middleware for development vs Static file serving for production
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    const distPath = path.join(process.cwd(), 'dist');
    app.use(express.static(distPath));
    app.get('*', (req, res) => {
      res.sendFile(path.join(distPath, 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`[Server] Umrah360 server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch((err) => {
  console.error('[Server] Fatal error starting server:', err);
  process.exit(1);
});
