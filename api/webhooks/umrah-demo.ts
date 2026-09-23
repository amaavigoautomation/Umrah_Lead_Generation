import type { IncomingMessage, ServerResponse } from 'http';
import { processWebsiteLeadSubmission } from '../../src/server/websiteLeadService';

/**
 * Dedicated Vercel Serverless Function for Website Demo Inbound Webhook
 * Route: /api/webhooks/umrah-demo
 *
 * Accepts demo inquiries from https://umrah360.in/request-demo, Elementor Pro forms,
 * Contact Form 7, Webflow, or custom web forms. Automatically normalizes fields,
 * calculates lead scores, and pushes directly into Firestore DB (contacts, leads, conversations).
 */
export default async function handler(
  req: IncomingMessage & { body?: any; query?: any },
  res: ServerResponse
) {
  // CORS Headers for cross-origin browser form submissions
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Requested-With');

  if (req.method === 'OPTIONS') {
    res.statusCode = 204;
    return res.end();
  }

  // 1. GET: Documentation & Live Health Status for integration checks
  if (req.method === 'GET') {
    res.statusCode = 200;
    res.setHeader('Content-Type', 'application/json');
    return res.end(
      JSON.stringify({
        service: 'Umrah360 Website Demo Lead Ingestion Webhook (Vercel Serverless)',
        status: 'active',
        acceptedMethods: ['POST'],
        targetWebsite: 'https://umrah360.in/request-demo',
        databaseTarget: 'Firestore: contacts, leads, conversations, messages',
        supportedFields: {
          personal: ['fullName (or name, your_full_name, your-name, firstName, lastName)', 'email (or your_email)', 'phone (or phoneNumber, phone_number, mobile)', 'countryCode', 'designation (or jobTitle, role)'],
          location: ['country (or select_country)', 'city (or your_city)'],
          company: ['companyName (or company, agency)', 'companyWebsite (or website)', 'branches (or has_branches, Yes/No)'],
          product: ['product (or select_products, productInterest)', 'teamSize (e.g. 5-10 Users, 10-20 Users)'],
          query: ['message (or query, notes, comments)'],
        },
        samplePayload: {
          fullName: 'Mohammad Al-Bakhla',
          email: 'demo@bakhlatours.com',
          designation: 'Managing Director',
          country: 'India',
          countryCode: '+91',
          phone: '9820252434',
          city: 'Mumbai',
          companyName: 'Bakhla Tours & Travels Pvt. Ltd.',
          website: 'https://bakhlatours.com',
          branches: 'Yes',
          product: 'Umrah ERP & B2B Sub-Agent Portal',
          teamSize: '10-20',
          message: 'We manage 3,500 pilgrims annually. Need dynamic Saudi hotel costing and sub-agent booking portal.',
        },
        timestamp: new Date().toISOString(),
      })
    );
  }

  // 2. POST: Lead Processing
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
          try {
            body = JSON.parse(raw);
          } catch {
            // Parse as urlencoded form data (e.g. Elementor / standard HTML form POST)
            try {
              const params = new URLSearchParams(raw);
              const formObj: Record<string, any> = {};
              params.forEach((val, key) => {
                formObj[key] = val;
              });
              if (Object.keys(formObj).length > 0) {
                body = formObj;
              }
            } catch {
              body = {};
            }
          }
        }
      }

      if (!body || typeof body !== 'object') {
        body = {};
      }

      console.log('[Vercel Webhook] Inbound lead submission received:', {
        name: body.fullName || body.name || body.your_full_name,
        email: body.email || body.your_email,
        company: body.companyName || body.company,
      });

      const result = await processWebsiteLeadSubmission(body);

      res.statusCode = 200;
      res.setHeader('Content-Type', 'application/json');
      return res.end(JSON.stringify(result));
    } catch (err: any) {
      console.error('[Vercel Webhook Error]:', err);
      res.statusCode = 400;
      res.setHeader('Content-Type', 'application/json');
      return res.end(
        JSON.stringify({
          success: false,
          error: err?.message || 'Failed to process website lead submission',
        })
      );
    }
  }

  res.statusCode = 405;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify({ error: 'Method Not Allowed' }));
}
