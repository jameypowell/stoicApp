# Production Deployment Guide

## Implementation overview

Relevant production behavior today:

1. **Google OAuth** — Routes and frontend for sign-in / sign-up.
2. **App paid tiers** — Checkout uses **Stripe PaymentIntents** plus **`subscriptions` rows in your database** (`stripe_subscription_id` is null for normal PI-based app billing). Renewals use saved payment methods and your **nightly renewal job** (or explicit app logic), not Stripe Subscription invoices for new signups.
3. **Webhooks** — Handle `payment_intent.succeeded` for app tiers, plus `customer.subscription.*` and `invoice.*` for **legacy** app rows that still have a Stripe subscription ID, and for **gym** flows that use Stripe subscriptions where applicable.

## Environment variables to set

### Google OAuth

```
GOOGLE_OAUTH_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_REDIRECT_URI_PROD=https://app.stoic-fit.com/auth/google/callback
```

### Stripe production

```
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
```

### Stripe Price IDs (optional / legacy)

These map to tier-two / tier-three / tier-four in older naming (`STRIPE_PRICE_DAILY`, etc.). Some scripts or Stripe-linked tooling may still reference them. **App tier checkout amounts** are defined in code (`TIER_PRICING` in `payments.js`), not by loading these prices for `POST /payments/create-intent`.

```
STRIPE_PRICE_DAILY=price_1SUwEpF0CLysN1jANPvhIp7s
STRIPE_PRICE_WEEKLY=price_1SUwG8F0CLysN1jA367NrtiT
STRIPE_PRICE_MONTHLY=price_1SUwH8F0CLysN1jAvy1aMz3E
```

You may also set `STRIPE_PRICE_TIER_TWO`, `STRIPE_PRICE_TIER_THREE`, `STRIPE_PRICE_TIER_FOUR` if you prefer explicit names; legacy vars are still supported as fallbacks elsewhere.

### Billing mode

```
BILLING_MODE=one_time
```

`POST /payments/create-intent` always uses **PaymentIntents** for app tiers (no Stripe Subscription checkout branch). Keeping `BILLING_MODE=one_time` matches the automated env script and documents intent for anyone reading the task definition.

## Deployment steps

### Option 1: Automated script (recommended)

```bash
./scripts/update_production_env.sh
```

This script updates Google OAuth, Stripe keys, optional price IDs, sets **`BILLING_MODE=one_time`**, and triggers an ECS service update (per script contents).

### Option 2: Manual update

Use the Python helper to set variables individually. Example for billing mode:

```bash
python3 scripts/update_ecs_env_vars.py \
  --region us-east-1 \
  --cluster stoic-fitness-app \
  --service stoic-fitness-service \
  --container stoic-fitness-app \
  --set BILLING_MODE=one_time
```

Repeat the same pattern for Google OAuth, Stripe keys, and price IDs as needed (see script source for the full `--set` list).

## Verification checklist

After deployment:

- [ ] Google OAuth login works
- [ ] Google OAuth signup works
- [ ] Email/password login still works
- [ ] Choosing a **paid app tier** creates a **PaymentIntent** (Stripe Dashboard → Payments), not a new **Subscription** for that checkout
- [ ] After pay + confirm, user has an active row in **`subscriptions`** with correct **`tier`** and **`end_date`** (and typically **`stripe_subscription_id`** empty for PI-only signups)
- [ ] Webhook **`payment_intent.succeeded`** appears in logs for successful app checkouts
- [ ] **Renewal**: paid tiers with a saved **`payment_method_id`** renew via your **nightly job** (off-session PI), not via a new Stripe Subscription invoice—unless that user is a **legacy** row still tied to a Stripe subscription
- [ ] **Cancel**: user cancel updates the DB; if a legacy **`stripe_subscription_id`** exists, Stripe is canceled too

## Testing

### Google OAuth

1. Open the production app URL.
2. Use **Sign in with Google** and complete the flow.
3. Confirm you are logged in.

### App tier checkout (PaymentIntent)

1. Log in (Google or email/password).
2. Open the subscription / plan UI and choose a **paid** tier.
3. Complete payment with the Payment Element.
4. In Stripe Dashboard, confirm a **PaymentIntent** succeeded for the customer.
5. Confirm **`subscriptions`** in the database reflects the new tier and period (and `/subscriptions/me` in the app).

### Webhooks

1. Check CloudWatch (or your log sink) for webhook delivery.
2. For PI-based app payments, confirm **`payment_intent.succeeded`** is processed.
3. For legacy app rows or gym subscription flows, **`customer.subscription.*`** / **`invoice.*`** may still appear; that is expected where Stripe subscriptions remain in use.

## Notes

- **Local development**: Use test keys in `.env` (never commit real secrets).
- **Production**: Secrets live on the ECS task definition (prefer AWS Secrets Manager for rotation).
- **Stripe webhooks**: Endpoint must match your deployed URL and use the correct **webhook signing secret**.
- **OAuth consent screen**: Must be published or test users must be added for production Google sign-in.

