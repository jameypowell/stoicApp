# Production Setup Checklist: Google OAuth + Stripe

## Overview
This checklist covers what's needed to:
1. Add Google OAuth authentication for users (in addition to email/password)
2. Switch from Stripe test mode to production mode

---

## Part 1: Google OAuth for User Authentication

### What You Need to Provide:

#### 1. Google Cloud Console Setup

**A. Create/Update OAuth 2.0 Client ID for User Authentication**

1. Go to: https://console.cloud.google.com/apis/credentials
2. Select your project (or create a new one)
3. Click **"+ CREATE CREDENTIALS"** → **"OAuth client ID"**
4. If prompted, configure the OAuth consent screen first (see below)
5. Application type: **"Web application"**
6. Name: `Stoic Fit User Authentication` (or similar)
7. **Authorized redirect URIs** - Add:
   ```
   https://app.stoic-fit.com/auth/google/callback
   http://localhost:3000/auth/google/callback
   ```
8. **Authorized JavaScript origins** - Add:
   ```
   https://app.stoic-fit.com
   http://localhost:3000
   ```
9. Click **"CREATE"**
10. **Copy these values:**
    - Client ID (ends with `.apps.googleusercontent.com`)
    - Client Secret

**B. Configure OAuth Consent Screen (if not already done)**

1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. User Type: **"External"** (unless you have a Google Workspace)
3. Click **"CREATE"**
4. Fill in:
   - **App name**: `Stoic Fit Shop`
   - **User support email**: Your email
   - **Developer contact information**: Your email
   - **App logo**: (optional) Upload your logo
   - **Application home page**: `https://app.stoic-fit.com`
   - **Privacy policy link**: `https://app.stoic-fit.com/privacy` (or create one)
   - **Terms of service link**: `https://app.stoic-fit.com/terms` (or create one)
5. **Scopes** - Add:
   - `openid`
   - `profile`
   - `email`
6. **Test users** (if in Testing mode):
   - Add email addresses that can test the app
7. **Publishing status**:
   - For production, you need to **"PUBLISH APP"**
   - This requires verification if you're requesting sensitive scopes
   - For now, you can keep it in "Testing" mode and add test users

**C. What to Send Me:**

```
GOOGLE_OAUTH_CLIENT_ID=your-client-id.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=your-client-secret-here
```

**Note:** This is separate from the Google Drive API credentials you already have. You can use the same project or a different one.

---

## Part 2: Stripe Production Setup

### What You Need to Provide:

#### 1. Stripe Production Keys

1. Go to: https://dashboard.stripe.com/
2. Make sure you're in **"Live mode"** (toggle in top right)
3. Go to: **Developers** → **API keys**
4. Copy:
   - **Publishable key** (starts with `pk_live_...`)
   - **Secret key** (starts with `sk_live_...`) - Click "Reveal test key" if needed

#### 2. Stripe Webhook Secret (for production)

**Since you want Stripe to handle recurring subscriptions**, you need these events:

1. Go to: **Developers** → **Webhooks**
2. Click **"+ Add endpoint"**
3. Endpoint URL: `https://app.stoic-fit.com/api/webhooks/stripe`
4. **Select these events** (for recurring subscriptions):
   
   **Subscription Events (REQUIRED for renewals):**
   - ✅ `customer.subscription.created` - When subscription starts
   - ✅ `customer.subscription.updated` - When subscription renews, upgrades, or changes
   - ✅ `customer.subscription.deleted` - When subscription is canceled
   
   **Invoice Events (REQUIRED for payment processing):**
   - ✅ `invoice.payment_succeeded` - When recurring payment succeeds (auto-renewal)
   - ✅ `invoice.payment_failed` - When recurring payment fails
   
   **Payment Intent Events (Optional, for one-time payments during upgrades):**
   - ✅ `payment_intent.succeeded` - For one-time upgrade payments
   - ✅ `payment_intent.payment_failed` - For failed upgrade payments
   
5. Click **"Add endpoint"**
6. Click on the endpoint to view details
7. Copy the **"Signing secret"** (starts with `whsec_...`)

**Note:** I'll need to update the webhook handler to process subscription events for auto-renewals.

#### 3. Stripe Price IDs (REQUIRED for recurring subscriptions)

**Since you want Stripe to handle recurring subscriptions**, you MUST create Products and Prices:

1. Go to: **Products** → **+ Add product**
2. Create products for each tier:
   - **Daily Subscription** - $7.00/month
   - **Weekly Subscription** - $12.00/month
   - **Monthly Subscription** - $18.00/month
3. For each product, create a **Price**:
   - Billing period: **Monthly** (or your preference)
   - Price: Enter the amount
   - Click **"Save product"**
4. Copy the **Price ID** for each (starts with `price_...`)

**Important:** These Price IDs are REQUIRED for recurring subscriptions. I'll need them to update the code.

#### 4. What to Send Me:

```
STRIPE_PUBLISHABLE_KEY=pk_live_...
STRIPE_SECRET_KEY=sk_live_...
STRIPE_WEBHOOK_SECRET=whsec_...
STRIPE_PRICE_DAILY=price_... (REQUIRED for recurring subscriptions)
STRIPE_PRICE_WEEKLY=price_... (REQUIRED for recurring subscriptions)
STRIPE_PRICE_MONTHLY=price_... (REQUIRED for recurring subscriptions)
```

**All 6 values are required** for recurring subscriptions with auto-renewal.

---

## Part 3: What I'll Do

Once you provide the above information, I will:

1. **Add Google OAuth authentication routes** to `routes.js`:
   - `/auth/google` - Initiate OAuth flow
   - `/auth/google/callback` - Handle OAuth callback
   - Create/update user account from Google profile

2. **Update frontend** (`public/app.js` and `public/index.html`):
   - Add "Sign in with Google" button
   - Handle OAuth login flow

3. **Convert payment flow to recurring subscriptions**:
   - Update `routes.js` to create Stripe Subscriptions instead of Payment Intents
   - Update payment flow to use Price IDs instead of amounts
   - Store `stripe_subscription_id` in database

4. **Update webhook handler** (`webhooks.js`):
   - Add handlers for `customer.subscription.*` events
   - Add handlers for `invoice.payment_succeeded` and `invoice.payment_failed`
   - Handle subscription renewals automatically
   - Handle subscription cancellations
   - Update subscription status and end dates on renewals

5. **Update environment variables** in ECS:
   - Add Google OAuth credentials
   - Update Stripe keys to production
   - Update webhook secret
   - Add Price IDs for all tiers
   - Set `BILLING_MODE=stripe_subscriptions`

6. **Update CORS settings** (if needed):
   - Ensure production domain is allowed

7. **Test the integration**:
   - Verify Google OAuth login works
   - Verify Stripe subscription creation works
   - Verify subscription auto-renewal via webhooks
   - Verify subscription cancellation works

---

## Part 4: Additional Considerations

### Security

- ✅ **HTTPS required** for production OAuth (you already have this)
- ✅ **Secure cookies** (if we add session management)
- ✅ **CSRF protection** (may need to add)

### Database

- ✅ **User accounts** - Will be created automatically from Google OAuth
- ✅ **Existing users** - Can still use email/password login
- ✅ **Email matching** - If a user signs in with Google using an email that already exists, we'll link accounts

### Testing

- ⚠️ **Test in production** - Make sure to test with a test user first
- ⚠️ **Stripe test mode** - Keep test keys in `.env` for local development
- ⚠️ **OAuth consent screen** - If in "Testing" mode, add test users

---

## Quick Start

**Send me these values:**

1. **Google OAuth Client ID**: `________________________`
2. **Google OAuth Client Secret**: `________________________`
3. **Stripe Publishable Key**: `pk_live_...`
4. **Stripe Secret Key**: `sk_live_...`
5. **Stripe Webhook Secret**: `whsec_...`
6. **Stripe Price IDs** (if using subscriptions):
   - Daily: `price_...`
   - Weekly: `price_...`
   - Monthly: `price_...`

Once I have these, I'll implement the changes and update your production environment!

