# Umrah360 AI Lead & Engagement Platform

Multi-tenant AI lead generation and omnichannel engagement for Umrah360 (and white-labeled workspaces).

## Run locally

```bash
cp .env.example .env
# Fill Firebase, OPENAI_API_KEY / GEMINI_API_KEY, RESEND_*, SECRETS_MASTER_KEY, etc.
npm install
npm run dev          # Vite frontend (default :3000)
# or, after build:
npm run build && npm start   # Express API + static UI + background IMAP poller
```

Node **22.x** required.

## Inbound email (Gmail, Microsoft, IMAP)

Connect a mailbox under **Settings → Inbound mailbox**:

| Provider | How |
|----------|-----|
| Gmail / Google Workspace | App password → Test & connect |
| Outlook / Microsoft 365 | **Sign in with Microsoft** (OAuth IMAP) — see [MICROSOFT_IMAP.md](./MICROSOFT_IMAP.md) |
| Other IMAP | Host + port + password (custom domains, Zoho, etc.) |

All three use the **same** background poller and `processLiveInboundEmail` path: AI replies, CRM, Unified Inbox, demo scheduling, and auto follow-up behave the same.

- Long-running server: `npm start` polls every ~30s.
- Vercel / serverless: cron hits `/api/inbound-mail/cron` every 5 minutes (set `CRON_SECRET`).

## Stack

React 19 + Vite + Tailwind · Express API · Firebase Auth / Firestore · OpenAI / Gemini · Resend · Stripe · Meta WhatsApp / Instagram
