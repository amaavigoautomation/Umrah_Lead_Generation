import type { IncomingMessage, ServerResponse } from 'http';
import { handleCoreApi } from '../../src/server/coreApiHandler.js';

/**
 * Vercel Serverless Function for Meta WhatsApp Webhooks
 * Endpoint: /api/inbound/whatsapp
 * Supports:
 * - GET: Meta verification handshake with hub.challenge and hub.verify_token
 * - POST: Incoming message ingestion, Gemini AI reasoning, and automated WhatsApp replies
 */
export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  // Ensure the request URL includes the endpoint path for route matching
  if (!req.url || req.url === '/' || !req.url.includes('/api/')) {
    const search = req.url && req.url.includes('?') ? req.url.substring(req.url.indexOf('?')) : '';
    req.url = '/api/inbound/whatsapp' + search;
  }

  const handled = await handleCoreApi(req, res);
  if (!handled && !res.writableEnded) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'WhatsApp webhook route not found', url: req.url }));
  }
}
