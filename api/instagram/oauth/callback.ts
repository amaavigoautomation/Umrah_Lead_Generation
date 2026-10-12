import type { IncomingMessage, ServerResponse } from 'http';
import { handleInstagramOAuthCallback } from '../../../src/server/instagramIntegrationService.js';

export default async function handler(req: IncomingMessage & { body?: any }, res: ServerResponse) {
  try {
    await handleInstagramOAuthCallback(req, res);
  } catch (error: any) {
    console.error('[Instagram OAuth callback] Failed:', error?.message || 'unknown error');
    if (!res.writableEnded) {
      res.statusCode = 500;
      res.setHeader('Content-Type', 'application/json');
      res.end(JSON.stringify({ error: 'Instagram authorization could not be completed.' }));
    }
  }
}
