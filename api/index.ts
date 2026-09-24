import type { IncomingMessage, ServerResponse } from 'http';
import { handleCoreApi } from '../src/server/coreApiHandler';

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  try {
    const handled = await handleCoreApi(req, res);
    if (handled) return;
  } catch (err: any) {
    console.error('[API Index] Core API execution error:', err);
  }

  if (!res.writableEnded) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'Umrah360 Serverless API Gateway',
        timestamp: new Date().toISOString(),
      })
    );
  }
}

