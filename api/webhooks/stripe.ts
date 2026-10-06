import type { IncomingMessage, ServerResponse } from 'http';
import { handleStripeWebhook } from '../../src/server/billingService.js';

// Stripe signs the exact raw bytes, so Vercel must not parse the body.
export const config = { api: { bodyParser: false } };

async function readRaw(req: IncomingMessage): Promise<Buffer> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return Buffer.concat(chunks);
}

export default async function handler(req: IncomingMessage, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    return res.end(JSON.stringify({ error: 'POST only' }));
  }
  try {
    const raw = await readRaw(req);
    const result = await handleStripeWebhook(raw, req.headers['stripe-signature'] as string | undefined);
    res.statusCode = result.status;
    res.end(JSON.stringify({ message: result.message }));
  } catch (err: any) {
    console.error('[Stripe webhook error]:', err);
    // 500 makes Stripe retry later.
    res.statusCode = 500;
    res.end(JSON.stringify({ error: 'webhook handler failed' }));
  }
}
