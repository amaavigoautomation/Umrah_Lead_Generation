import type { IncomingMessage, ServerResponse } from 'http';

/**
 * Vercel Serverless Catch-All Function for /api/*
 * Bundles all server routes: SMTP/IMAP inbound sync, auto-replies, campaign dispatch, and lead webhooks
 */
export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PATCH, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Google-Access-Token');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // Normalize URL in case Vercel rewrote to catch-all query parameter
  if (req.url) {
    try {
      const parsedUrl = new URL(req.url, 'http://localhost');
      if (parsedUrl.pathname.includes('[...path]')) {
        const pathParam = (req as any).query?.path || parsedUrl.searchParams.get('path');
        if (pathParam) {
          const pathStr = Array.isArray(pathParam) ? pathParam.join('/') : pathParam;
          req.url = `/api/${pathStr.replace(/^\/+/, '')}`;
        }
      }
    } catch {}
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

  let handleCoreApi: any;
  const loadErrors: string[] = [];
  try {
    // 1. Try bundled server module in /api
    try {
      // @ts-ignore
      const serverMod = await import('./core-server.bundle.js');
      handleCoreApi = serverMod?.handleCoreApi;
    } catch (e: any) {
      loadErrors.push(`bundle: ${e?.message || e}`);
    }

    // 2. Direct fallback to TypeScript source if bundle not present in serverless runtime
    if (!handleCoreApi) {
      try {
        const directMod = await import('../src/server/coreApiHandler.js');
        handleCoreApi = directMod?.handleCoreApi;
      } catch (e: any) {
        loadErrors.push(`source: ${e?.message || e}`);
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
    res.setHeader('Content-Type', 'application/json');
    if (!handleCoreApi) {
      // Never pretend success when the API code failed to load.
      console.error('[API Catch-all] Core API handler failed to load:', loadErrors);
      res.statusCode = 500;
      return res.end(JSON.stringify({ error: 'API failed to start', details: loadErrors }));
    }
    res.statusCode = 404;
    res.end(JSON.stringify({ error: 'Not found', url: req.url }));
  }
}