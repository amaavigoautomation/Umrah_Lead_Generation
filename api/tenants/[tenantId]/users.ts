import type { IncomingMessage, ServerResponse } from 'http';
import { handleCoreApi } from '../../../src/server/coreApiHandler';

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Google-Access-Token');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const handled = await handleCoreApi(req, res);
    if (handled) return;
  } catch (err: any) {
    console.error('[Tenant Users API Error]:', err);
  }

  if (!res.writableEnded) {
    res.statusCode = 404;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ error: 'Endpoint not handled' }));
  }
}
