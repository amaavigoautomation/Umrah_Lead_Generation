import type { IncomingMessage, ServerResponse } from 'http';
import { handleMetaWebhook } from '../../src/server/metaChannelsService.js';

export const config = { api: { bodyParser: false } };

export default async function handler(req: IncomingMessage & { body?: any; rawBody?: Buffer }, res: ServerResponse) {
  try {
    if (req.method === 'POST') {
      const chunks: Buffer[] = [];
      for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
      const rawBody = Buffer.concat(chunks);
      req.rawBody = rawBody;
      try {
        req.body = JSON.parse(rawBody.toString('utf8'));
      } catch {
        res.statusCode = 400;
        res.setHeader('Content-Type', 'application/json');
        return res.end(JSON.stringify({ error: 'Invalid JSON webhook payload.' }));
      }
    }
    await handleMetaWebhook(req, res);
  } catch (error: any) {
    console.error('[Meta webhook] Handler failed:', error?.message || 'unknown error');
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Meta webhook processing failed.' }));
    }
  }
}
