import type { IncomingMessage, ServerResponse } from 'http';
import { routeResendWebhook } from '../../src/server/webhookRouter.js';

export const config = { api: { bodyParser: false } };

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'POST only' }));
  }
  try {
    const raw = await readRaw(req);
    try {
      req.body = JSON.parse(raw.toString('utf8') || '{}');
    } catch {
      req.body = {};
    }
    const handled = await routeResendWebhook(req, res);
    if (!handled && !res.writableEnded) {
      res.statusCode = 200;
      res.end(JSON.stringify({ received: true }));
    }
  } catch (err: any) {
    console.error('[Resend webhook error]:', err);
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'webhook handler failed' }));
  }
}