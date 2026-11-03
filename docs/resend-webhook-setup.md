# Resend campaign event tracking setup

The application verifies Resend webhook requests using the endpoint signing secret and the original raw request body. Configure the same signing secret in each environment that receives Resend events:

- Vercel: add `RESEND_WEBHOOK_SECRET` to the Production environment (and Preview only if testing there).
- Long-running VPS: add `RESEND_WEBHOOK_SECRET` to the server environment used by the Node process.

In Resend, open **Webhooks**, edit the endpoint at `https://YOUR_DOMAIN/api/webhooks/resend`, and subscribe to:

- `email.delivered`
- `email.delivery_delayed`
- `email.opened`
- `email.clicked`
- `email.bounced`
- `email.complained`

Copy the endpoint's **Signing Secret** (starts with `whsec_`) into the server environment. Do not put it in a browser/Vite environment variable. Restart the long-running service after changing its environment. Resend's dashboard should show successful deliveries after the endpoint is configured.

The webhook stores a tenant-scoped event ledger using Resend's `svix-id` header, so retries do not increment counters twice. The event-ledger status and campaign-lead update are committed together in one Firestore transaction.

Metric definitions:

- Opened: a non-scanner Resend open event; still an estimate because some mail clients suppress tracking pixels.
- Clicked: a non-scanner Resend click event.
- Replied: an inbound reply matched by Amaavigo.
- Replied without tracked open: a matched reply for which no Resend open event has been recorded; it does not imply the recipient did not read the email.
- Delivered: a Resend `email.delivered` event, or a complaint event which itself establishes delivery.
- Bounced and spam complaints are separate outcomes.
- Ignored: a delivered prospect with no tracked open, click or reply after the existing five-day window.
