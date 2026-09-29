import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel Serverless Catch-All Function for /api/*
 * Bundles all server routes: SMTP/IMAP inbound sync, auto-replies, campaign dispatch, and lead webhooks
 */
export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Normalize URL in case Vercel rewrote to catch-all query parameter
  if (req.url?.includes('[...path]') && (req as any).query?.path) {
    const pathParam = (req as any).query.path;
    const pathStr = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
    req.url = `/api/${pathStr}`;
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

  try {
    let handleCoreApi: any;
    // 1. Try bundled server module in /api
    try {
      // @ts-ignore
      const serverMod = await import('./core-server.bundle.js').catch(() => null);
      handleCoreApi = serverMod?.handleCoreApi;
    } catch {}

    // 2. Direct fallback to TypeScript source if bundle not present in serverless runtime
    if (!handleCoreApi) {
      try {
        const directMod =
          (await import('../src/server/coreApiHandler.js').catch(() => null)) ||
          (await import('../src/server/coreApiHandler').catch(() => null));
        handleCoreApi = directMod?.handleCoreApi;
      } catch (directErr) {
        console.warn('[API Catch-all] Direct coreApiHandler import notice:', directErr);
      }
    }

    if (handleCoreApi) {
      const handled = await handleCoreApi(req, res);
      if (handled) return;
    }
  } catch (err: any) {
    console.error('[API Catch-all] Core API execution error:', err);
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ error: err?.message || 'Internal Server Error' }));
    }
  }

  if (!res.writableEnded) {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    res.end(JSON.stringify({ status: 'ok', url: req.url, message: 'Endpoint acknowledged' }));
  }
}


