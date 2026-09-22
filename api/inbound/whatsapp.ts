import type { IncomingMessage, ServerResponse } from 'http';
import { processLiveInboundWhatsApp, getWhatsAppGatewayStatus } from '../../src/server/whatsappInboundPipeline.js';

/**
 * Dedicated Vercel Serverless Function for Meta WhatsApp Webhook
 * Route: /api/inbound/whatsapp
 */
export default async function handler(req: IncomingMessage & { body?: any; query?: any }, res: ServerResponse) {
  // CORS & Security Headers
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // 1. Meta Webhook Verification Handshake (GET)
  if (req.method === 'GET') {
    try {
      const parsedUrl = new URL(req.url || '', 'https://leadgeneration-sable.vercel.app');
      const mode = parsedUrl.searchParams.get('hub.mode') || parsedUrl.searchParams.get('hub_mode');
      const verifyToken =
        parsedUrl.searchParams.get('hub.verify_token') || parsedUrl.searchParams.get('hub_verify_token');
      const challenge =
        parsedUrl.searchParams.get('hub.challenge') || parsedUrl.searchParams.get('hub_challenge');

      const expectedToken =
        process.env.META_WEBHOOK_VERIFY_TOKEN ||
        process.env.WHATSAPP_VERIFY_TOKEN ||
        'umrah360_webhook_token';

      if (verifyToken && verifyToken !== expectedToken) {
        console.warn('[WhatsApp Webhook] Invalid verify token:', verifyToken);
        res.statusCode = 403;
        res.setHeader('Content-Type', 'text/plain');
        return res.end('Forbidden: Invalid verification token');
      }

      // If challenge provided, return it directly in text/plain (required by Meta)
      if (challenge) {
        console.log('[WhatsApp Webhook] Meta challenge verified successfully:', challenge);
        res.statusCode = 200;
        res.setHeader('Content-Type', 'text/plain');
        return res.end(challenge);
      }

      // Health status ping
      const gateway = getWhatsAppGatewayStatus();
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          status: 'online',
          service: 'Umrah360 WhatsApp Webhook',
          gateway,
        })
      );
    } catch (err: any) {
      console.error('[WhatsApp Webhook GET] Error:', err);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'text/plain');
      return res.end('OK');
    }
  }

  // 2. Incoming WhatsApp Message Ingestion (POST)
  if (req.method === 'POST') {
    try {
      let body = req.body;
      if (!body) {
        const chunks: Buffer[] = [];
        for await (const chunk of req) {
          chunks.push(typeof chunk === 'string' ? Buffer.from(chunk) : chunk);
        }
        const raw = Buffer.concat(chunks).toString('utf-8');
        if (raw) {
          body = JSON.parse(raw);
        }
      }
      if (!body) body = {};

      const result = await processLiveInboundWhatsApp(body);
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(result));
    } catch (err: any) {
      console.error('[WhatsApp Webhook POST] Error processing message:', err);
      // Return 200 OK so Meta doesn't redundantly retry broken payloads
      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify({ success: false, error: err?.message || 'Processing error' }));
    }
  }

  res.statusCode = 405;
  res.end('Method Not Allowed');
}
