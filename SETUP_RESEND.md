# Resend multi-tenant setup

## Files
NEW:     src/server/{resendService,emailSuppression,sendingIdentities,clientService,authService,resendWebhook}.ts
         src/services/session.ts, src/components/SendingDomainsPanel.tsx, api/webhooks/resend.ts
REPLACED: src/server/{smtpService,campaignService,coreApiHandler}.ts, src/types/index.ts, server.ts, vercel.json,
         api/webhooks/umrah-demo.ts, src/main.tsx, src/App.tsx, src/components/{LoginView,SettingsView,UserManagementView,CampaignManagement}.tsx
         .env.example (append the new block)

## One-time setup
1. Resend: add your ~5 domains, finish DNS (SPF/DKIM), wait for "verified".
2. Env vars (see .env.example): RESEND_API_KEY, RESEND_WEBHOOK_SECRET, AUTH_SECRET, APP_URL, RESEND_FROM_EMAIL,
   INITIAL_ADMIN_EMAIL + INITIAL_ADMIN_PASSWORD (only if no users exist; existing plaintext passwords are upgraded to hashes on first login).
3. Resend → Webhooks → https://<app>/api/webhooks/resend, events email.bounced + email.complained; copy signing secret.
4. Run ONE worker instance with `npm run build && npm start` (the 4s poller sends the campaigns). Vercel alone cannot send 10k+.
5. Login as admin → Settings → Sending Domains → add a client, add addresses (start cap 50/day per new domain, raise gradually).
   Settings → Users → create client users and pick the client.

## Git (run yourself)
git checkout -b sahil && git add -A && git commit -m "Resend multi-tenant sending" && git push -u origin sahil
Also: `git rm --cached .mail_credentials.json .processed_gmail_messages.json`, and ROTATE the old Gmail app password and
Firebase/OpenAI keys — they were committed to the repo. Remove passwords from INITIAL_USERS in src/services/dataService.ts.

## Limits / honest notes
- Type-checked server+UI files with tsc (only pre-existing errors remain); not run end-to-end — test with a SIMULATION campaign, then 5 real emails.
- Firestore security rules are still open to the browser; real tenant isolation needs rules or moving all reads behind the API.
- Replies still arrive via the platform's single IMAP mailbox (Reply-To = client's address); per-client inbox sync is not built.
- Rate: ~100 emails per Resend call, ~600ms apart => several thousand/min; emails with attachments send one at a time (slow).
- 50k/day needs a Resend plan with that quota; on quota error the campaign pauses itself.
- Cold-email to purchased lists risks Resend suspending the shared account (all clients go down together).
- /api/inbound/email now requires login; if an external system posts there, give it a token or whitelist it.
- Client users cannot use lead-status/demo-status endpoints yet.
- api/core-server.bundle.js in the repo is stale; `npm run build` regenerates it.
