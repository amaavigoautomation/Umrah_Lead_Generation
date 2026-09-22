import type { IncomingMessage, ServerResponse } from 'http';
import { handleCoreApi } from '../src/server/coreApiHandler.js';

/**
 * Vercel Serverless Catch-All Function for /api/*
 */
export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  const handled = await handleCoreApi(req, res);
  if (!handled && !res.writableEnded) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Endpoint not found', url: req.url }));
  }
}
