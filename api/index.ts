import express from 'express';
import { handleUmrah360ApiRequest } from '../src/vite-plugin-api.js';
import { verifyMetaWebhookChallenge } from '../src/server/whatsappService.js';
import { handleMetaWhatsAppWebhook } from '../src/server/whatsappPipeline.js';

const app = express();

app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

// Dedicated Meta Webhook Verification GET Handler
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

  const verification = verifyMetaWebhookChallenge(mode, token, challenge);

  if (verification.verified && verification.challenge) {
    res.setHeader('Content-Type', 'text/plain; charset=utf-8');
    return res.status(200).send(verification.challenge);
  }

  return res.status(403).json({
    error: 'Webhook verification failed: token mismatch or missing parameters',
    receivedMode: mode,
    receivedToken: token
  });
});

app.post(webhookPaths, async (req, res) => {
  try {
    const results = await handleMetaWhatsAppWebhook(req.body);
    return res.status(200).json({ status: 'EVENT_RECEIVED', results });
  } catch (err: any) {
    return res.status(200).json({ status: 'ERROR_RECORDED', error: err?.message });
  }
});

app.use(async (req, res, next) => {
  try {
    const handled = await handleUmrah360ApiRequest(req, res);
    if (!handled && !res.writableEnded) {
      next();
    }
  } catch (err) {
    if (!res.writableEnded) {
      res.status(500).json({ error: 'Internal Server Error', details: String(err) });
    }
  }
});

export default app;
