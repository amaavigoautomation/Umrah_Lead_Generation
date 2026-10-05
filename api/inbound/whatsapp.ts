import type { IncomingMessage, ServerResponse } from 'http';
import { handleCoreApi } from '../../src/server/coreApiHandler.js';

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  try {
    const handled = await handleCoreApi(req, res);
    if (handled) return;
  } catch (err: any) {
    console.error('[WhatsApp Inbound Error]:', err);
  }

  if (!res.writableEnded) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'EVENT_RECEIVED' }));
  }
}
