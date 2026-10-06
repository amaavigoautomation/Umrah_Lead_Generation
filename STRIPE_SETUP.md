# Billing setup (Stripe sandbox)

1. Stripe Dashboard (Test mode) -> Products: create 3 products with a **monthly recurring price** each. Copy each `price_...` id.
2. Platform Console -> Plans: open each plan, paste its Stripe price id, set the real name/price/features/limits, Save.
3. Stripe -> Developers -> API keys: copy the **secret key** (`sk_test_...`) into `STRIPE_SECRET_KEY`.
4. Stripe -> Developers -> Webhooks -> Add endpoint: `https://<your-domain>/api/webhooks/stripe`, events:
   `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`,
   `invoice.payment_failed`, `invoice.paid`. Copy the signing secret (`whsec_...`) into `STRIPE_WEBHOOK_SECRET`.
5. Stripe -> Settings -> Billing -> Customer portal: enable it (allow plan switching + cancel + card update).
6. Add the env vars in Vercel (Production AND Preview), run `npm install` (new `stripe` dependency), redeploy.
7. Test: Platform Console -> New workspace -> "Customer pays online" -> invite an admin -> admin signs in, sees the
   Billing screen, picks a plan, pays with card 4242 4242 4242 4242 (any future date / CVC).

Existing workspaces (e.g. Umrah360) have no billing status, are treated as "Legacy (all features)" and are never locked.
