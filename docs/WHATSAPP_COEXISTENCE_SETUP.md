# WhatsApp Business App Coexistence — Amaavigo setup

Amaavigo connects **existing WhatsApp Business App numbers only**. A successful connection must let the client continue using WhatsApp Business on their phone while Amaavigo uses the Cloud API. The application does not offer a token-based or API-only fallback.

## Meta app configuration

1. Use a current **Facebook Login for Business / WhatsApp Embedded Signup v4** configuration. Embedded Signup v2/v3 are retired for new onboarding as of October 15, 2026.
2. Enable WhatsApp Cloud API for the configuration and the permissions needed to manage the client's WhatsApp assets and send messages.
3. Configure the Coexistence / WhatsApp Business App onboarding path. The browser launches Embedded Signup with **featureType: whatsapp_business_app_onboarding**.
4. Set the allowed JavaScript SDK domain and app domain to the real Amaavigo application host.
5. Set the server environment variables **META_APP_ID**, **META_APP_SECRET**, **META_WA_EMBEDDED_SIGNUP_CONFIG_ID**, **META_WEBHOOK_VERIFY_TOKEN**, and **SECRETS_MASTER_KEY**. The configuration ID must identify the v4 configuration.

## Webhook configuration

Set the callback URL to:

https://<Amaavigo-host>/api/webhooks/meta

Use the value of **META_WEBHOOK_VERIFY_TOKEN** as the verification token. In the Meta App Dashboard, subscribe the WhatsApp Business Account webhook fields:

- **messages** — incoming customer messages and message statuses
- **history** — past conversations when the client agrees to share them
- **smb_app_state_sync** — contacts from the Business App
- **smb_message_echoes** — messages sent by the client from their Business App
- **account_update** — account connection/disconnection changes

The server subscribes the app to each client's WABA during connection. The fields above must also be enabled in the Meta app's webhook configuration; API code cannot enable the dashboard fields on your behalf.

## Client onboarding

1. The client must sign in through their own Meta business account and use the **existing number already active in WhatsApp Business**.
2. Follow Meta's QR/in-app confirmation prompts for the Business App. Do not choose a new number or proceed through a screen that asks to move the number to API-only. Cancel if Coexistence is not offered or Meta says the number is ineligible.
3. Amaavigo checks the connected number's **is_on_biz_app** and **platform_type** fields. It accepts the connection only when Meta confirms **is_on_biz_app = true** and **platform_type = CLOUD_API**.
4. Amaavigo does not call the phone-number **/register** endpoint. If eligibility cannot be verified, no workspace connection is saved.
5. The server requests the one-time contact and history sync tasks immediately after connecting. Declining history sharing or a Meta sync error does not disconnect an otherwise verified Coexistence number. Coexistence webhooks are stored without running AI auto-replies against historical messages.

## Message billing

Use the client's own Meta business assets and client-owned messaging billing account/payment method. Meta's Cloud API messaging charges should be associated with that client's Meta billing setup, not a shared Amaavigo billing account. Amaavigo does not configure or charge the client's Meta payment method. Verify the client's messaging account and payment setup in Meta before enabling paid campaigns; any separate Amaavigo subscription, AI usage, or infrastructure fees are separate.

## Verification checklist

- [ ] **META_WA_EMBEDDED_SIGNUP_CONFIG_ID** points to the active v4 configuration.
- [ ] The connected number still works in the WhatsApp Business App on the phone.
- [ ] The connection shows **is_on_biz_app = true** and **platform_type = CLOUD_API** in Meta Graph API.
- [ ] Meta webhook delivery succeeds for **messages**, **history**, **smb_app_state_sync**, and **smb_message_echoes**.
- [ ] An inbound customer message reaches Amaavigo and gets the configured reply.
- [ ] A message sent manually from the Business App appears in the inbox as an outbound message without triggering another AI reply.
- [ ] Client-owned Meta messaging billing/payment settings are confirmed before running a paid campaign.
