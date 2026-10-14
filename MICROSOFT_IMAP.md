# Microsoft / Outlook inbound mailbox

Connect an Outlook.com or Microsoft 365 mailbox in **Settings → Inbound mailbox → Outlook / Microsoft 365**. Mail is read over **IMAP with OAuth (XOAUTH2)** — the same poller and AI / CRM / follow-up pipeline used for Gmail and Other IMAP.

Microsoft does **not** accept passwords or app passwords for IMAP. You must use **Sign in with Microsoft**.

## 1. Entra app registration

1. In [Microsoft Entra admin center](https://entra.microsoft.com/) → **App registrations** → **New registration**.
2. Supported account types: **Accounts in any organizational directory and personal Microsoft accounts**.
3. Redirect URI (Web): `https://YOUR_DOMAIN/api/oauth/microsoft/callback`  
   For local testing you can use your tunnel / `APP_URL` the same way.
4. Under **Certificates & secrets**, create a client secret.
5. Under **API permissions** → **Add a permission** → **APIs my organization uses** → **Office 365 Exchange Online** → **Delegated**:
   - `IMAP.AccessAsUser.All`
   - Also ensure: `offline_access`, `openid`, `email`, `profile` (OpenID)
6. Grant admin consent if your tenant requires it (common for work accounts).

## 2. Environment variables

```bash
APP_URL=https://YOUR_DOMAIN
MICROSOFT_CLIENT_ID=...
MICROSOFT_CLIENT_SECRET=...
# Optional overrides:
# MICROSOFT_REDIRECT_URI=https://YOUR_DOMAIN/api/oauth/microsoft/callback
# MICROSOFT_AUTH_TENANT=common
SECRETS_MASTER_KEY=...   # encrypts the refresh token at rest
```

Until `MICROSOFT_CLIENT_ID`, `MICROSOFT_CLIENT_SECRET`, and `APP_URL` (or `MICROSOFT_REDIRECT_URI`) are set, the UI shows that Sign in with Microsoft is not available.

## 3. Mailbox requirements

- IMAP must be enabled for the user (Microsoft 365 admin center → user → Mail → Email apps → IMAP).
- Personal Outlook.com accounts work when IMAP is allowed on the account.
- Shared mailboxes are not supported by this flow (sign in as the mailbox owner).

## 4. How receiving works (same as Gmail)

1. User clicks **Sign in with Microsoft** → OAuth → callback stores an encrypted refresh token.
2. Background poller (`server.ts` every 30s, or Vercel cron `/api/inbound-mail/cron` every 5 minutes) opens `outlook.office365.com:993` with a fresh access token.
3. New UIDs are parsed and passed to `processLiveInboundEmail` — AI reply, CRM, Unified Inbox, demo scheduling, auto follow-up — identical to Gmail.

## 5. Troubleshooting

| Symptom | Fix |
|--------|-----|
| UI: “not set up on this server” | Set Microsoft env vars and redeploy / restart |
| Admin consent error | IT admin grants consent for the Entra app |
| IMAP authentication failed | Enable IMAP for the mailbox; click Reconnect with Microsoft |
| Connected but no mail processed | Ensure the poller is running (`npm start`) or cron hits `/api/inbound-mail/cron` with `Authorization: Bearer $CRON_SECRET` |
| Only personal mail ignored | By default only replies to known conversations / campaigns are ingested; turn on “Also handle brand-new enquiries” if needed |
