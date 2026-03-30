# Stripe subscription: tier + status (member UI)

## Single source of truth

All **tier** and **member-facing subscription status** logic for Stripe-backed subscriptions lives in:

- **`stripe-subscription-resolve.js`**

Do **not** duplicate price-ID → tier maps or “incomplete vs trialing” rules in `routes.js`, `public/app.js`, or ad-hoc scripts.

## API contract (`GET /api/subscriptions/me`)

When `stripe_subscription_id` is present:

- **`tier`** — Derived from the **Stripe subscription’s price** (and metadata), not only the DB row. The handler may persist tier to the DB when it was out of sync.
- **`stripe_status`** — **Member UI status** (canonical): e.g. `trialing` when Stripe reports `incomplete` but the trial window is still active, so the app does not show a misleading “Incomplete”.
- **`stripe_status_raw`** — Exact Stripe API `subscription.status` (for support / debugging).
- **`trial_ends_at`** — ISO timestamp when the Stripe trial ends, or null.
- **`trial_active`** — `true` when Stripe says `trialing` or `trial_end` is still in the future (drives hiding the “add payment method” banner).
- **`has_payment_method`** — `true` if DB, subscription default, customer default, **or any attached card/bank** on the customer (`paymentMethods.list`).
- **`app_payment_banner`** — boolean: server decides if the yellow “Add payment method” strip should show. **Do not re-derive this in the client** — `/auth/me` and `/subscriptions/me` return the same object from `subscription-client-payload.js`.

When there is no Stripe subscription, `stripe_status` / `stripe_status_raw` may be null; the client falls back to DB `status`.

## Related code

- **`subscription-sync.js`** — Uses `tierFromStripeSubscription()` from the same module so sync and API never disagree on price → tier.
- **Webhooks** — Should continue to update DB; tier drift is corrected on read via `tierFromStripeResolve` + optional DB update.

## New Stripe prices / env

Add the new price IDs to **environment variables** (`STRIPE_PRICE_DAILY`, `STRIPE_PRICE_WEEKLY`, `STRIPE_PRICE_MONTHLY`, or `STRIPE_PRICE_TIER_*`) and extend **`getPriceIdToTierMap()`** in `stripe-subscription-resolve.js` if needed.

## Deploying frontend changes

After changing **`public/app.js`**, bump the query string in **`public/index.html`** (`app.js?v=...`) so browsers load the new bundle.
