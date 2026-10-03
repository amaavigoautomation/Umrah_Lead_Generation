import type { IncomingMessage, ServerResponse } from 'http';
import { handleResendWebhook } from '../../src/server/resendWebhook.js';

// The signature is computed over the exact raw body, so Vercel's body parser must be disabled.
export const config = { api: { bodyParser: false } };

async function readRawBody(req: IncomingMessage): Promise<string> {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : (chunk as Buffer));
  }
  return Buffer.concat(chunks).toString('utf-8');
}

export default async function handler(req: IncomingMessage & { method?: string }, res: ServerResponse) {
  res.setHeader('Content-Type', 'application/json');
  if (req.method !== 'POST') {
    res.statusCode = 405;
    res.end(JSON.stringify({ error: 'Method not allowed' }));
    return;
  }
  const raw = await readRawBody(req);
  const result = await handleResendWebhook(raw, req.headers as any);
  res.statusCode = result.status;
  res.end(JSON.stringify(result.body));
}
