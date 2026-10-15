# WhatsApp, Instagram and Messenger (per-workspace)

One Meta app is owned by the platform. Each client workspace connects its **own** WhatsApp number,
Instagram account and Facebook Page from **Settings > Connected Channels**. Tokens are stored
encrypted per workspace (`tenants/{id}/secrets/*`), and incoming webhooks are routed to the right
workspace by phone number id / Page id / Instagram account id.

## Server settings

| Variable | Used for |
|---|---|
| `META_APP_ID`, `META_APP_SECRET` | WhatsApp + Messenger (the Meta app's id and secret) |
| `META_WA_EMBEDDED_SIGNUP_CONFIG_ID` | WhatsApp sign-up pop-up configuration |
| `META_WEBHOOK_VERIFY_TOKEN` | Verifying the `/api/webhooks/meta` subscription (any random string) |
| `SECRETS_MASTER_KEY` (or `TENANT_MASTER_KEY`) | Encrypting stored tokens |
| `META_INSTAGRAM_APP_ID`, `META_INSTAGRAM_APP_SECRET`, `META_INSTAGRAM_REDIRECT_URI`, `META_INSTAGRAM_WEBHOOK_VERIFY_TOKEN` | Instagram Login (the Instagram product's own app id/secret) |
| `OPENAI_API_KEY` | AI replies |

If anything is missing, the matching card in Settings says **Setup pending** and lists what is missing.

## Meta app setup

1. developers.facebook.com > Create app > type **Business**. Add products **WhatsApp**, **Messenger**, **Instagram**, and **Facebook Login for Business**.
2. **WhatsApp:** create an Embedded Signup configuration; copy its id into `META_WA_EMBEDDED_SIGNUP_CONFIG_ID`.
3. **Webhooks** (WhatsApp Business Account and Page objects), callback URL `https://<your-domain>/api/webhooks/meta`,
   verify token = `META_WEBHOOK_VERIFY_TOKEN`. Subscribe to `messages` (WhatsApp) and `messages`, `messaging_postbacks` (Page).
4. **Instagram:** webhook `https://<your-domain>/api/webhooks/instagram`, redirect URI `https://<your-domain>/api/instagram/oauth/callback`.
5. **Facebook Login:** add `https://<your-domain>` to the allowed domains / JavaScript SDK domains.
6. **Go live:** complete business verification and App Review. Until then only people with a role on the app (and test numbers) can connect.
   Permissions to request: `whatsapp_business_management`, `whatsapp_business_messaging`, `pages_show_list`, `pages_messaging`,
   `pages_manage_metadata`, `instagram_business_basic`, `instagram_business_manage_messages`.

## Behaviour to know

- **24-hour window:** free-form replies are allowed for 24 hours after the customer's last message. After that WhatsApp requires an approved
  **template** (Inbox > Template). The inbox shows a countdown chip and disables free text on WhatsApp once closed.
- **Channel modes** (AUTO / REVIEW / SIMULATION) from Settings apply to all three channels.
- One number / Page / Instagram account can belong to only one workspace.
