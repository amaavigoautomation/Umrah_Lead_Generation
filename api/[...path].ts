import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel Serverless Catch-All Function for /api/*
 */
export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  if (req.url === '/api/health' || req.url?.startsWith('/api/health?')) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        status: 'healthy',
        service: 'Umrah360 Vercel Serverless Gateway',
        timestamp: new Date().toISOString(),
      })
    );
  }

  if (
    req.url === '/api/webhooks/umrah-demo' ||
    req.url?.startsWith('/api/webhooks/umrah-demo?') ||
    req.url === '/api/leads/inbound' ||
    req.url?.startsWith('/api/leads/inbound?')
  ) {
    // @ts-ignore
    const { default: demoHandler } = await import('./webhooks/umrah-demo.js').catch(() => import('./webhooks/umrah-demo.ts'));
    if (demoHandler) {
      return demoHandler(req, res);
    }
  }

  try {
    // Dynamic import to support various bundler paths safely
    // @ts-ignore
    const { handleCoreApi } = await import('../src/server/coreApiHandler.js').catch(() => import('../src/server/coreApiHandler.ts'));
    if (handleCoreApi) {
      const handled = await handleCoreApi(req, res);
      if (handled) return;
    }
  } catch (err: any) {
    console.warn('[API Catch-all] Core API execution notice:', err?.message);
  }

  if (!res.writableEnded) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', url: req.url, message: 'Endpoint acknowledged' }));
  }
}
