# Production Deployment Guide

## ✅ Implementation Complete

All code changes have been implemented:

1. ✅ **Google OAuth Authentication** - Routes and frontend buttons added
2. ✅ **Stripe Subscriptions** - Payment flow converted to use recurring subscriptions
3. ✅ **Webhook Handlers** - All subscription events (created, updated, deleted, renewals) handled

## 📋 Environment Variables to Set

### Google OAuth
```
GOOGLE_OAUTH_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com
GOOGLE_OAUTH_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET
GOOGLE_REDIRECT_URI_PROD=https://app.stoic-fit.com/auth/google/callback
```

### Stripe Production
```
STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
```

### Stripe Price IDs (for recurring subscriptions)
```
STRIPE_PRICE_DAILY=price_1SUwEpF0CLysN1jANPvhIp7s
STRIPE_PRICE_WEEKLY=price_1SUwG8F0CLysN1jA367NrtiT
STRIPE_PRICE_MONTHLY=price_1SUwH8F0CLysN1jAvy1aMz3E
```

### Billing Mode
```
BILLING_MODE=stripe_subscriptions
```

## 🚀 Deployment Steps

### Option 1: Automated Script (Recommended)

Run the automated script to update all environment variables:

```bash
./scripts/update_production_env.sh
```

This will:
1. Update Google OAuth credentials
2. Update Stripe production keys
3. Update Stripe Price IDs
4. Set billing mode to `stripe_subscriptions`
5. Trigger ECS service update

### Option 2: Manual Update

Use the Python script to update variables individually:

```bash
# Google OAuth
python3 scripts/update_ecs_env_vars.py \
  --region us-east-1 \
  --cluster stoic-fitness-app \
  --service stoic-fitness-service \
  --container stoic-fitness-app \
  --set GOOGLE_OAUTH_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com \
  --set GOOGLE_OAUTH_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET \
  --set GOOGLE_REDIRECT_URI_PROD=https://app.stoic-fit.com/auth/google/callback

# Stripe Keys
python3 scripts/update_ecs_env_vars.py \
  --region us-east-1 \
  --cluster stoic-fitness-app \
  --service stoic-fitness-service \
  --container stoic-fitness-app \
  --set STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY \
  --set STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY \
  --set STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET

# Price IDs
python3 scripts/update_ecs_env_vars.py \
  --region us-east-1 \
  --cluster stoic-fitness-app \
  --service stoic-fitness-service \
  --container stoic-fitness-app \
  --set STRIPE_PRICE_DAILY=price_1SUwEpF0CLysN1jANPvhIp7s \
  --set STRIPE_PRICE_WEEKLY=price_1SUwG8F0CLysN1jA367NrtiT \
  --set STRIPE_PRICE_MONTHLY=price_1SUwH8F0CLysN1jAvy1aMz3E

# Billing Mode
python3 scripts/update_ecs_env_vars.py \
  --region us-east-1 \
  --cluster stoic-fitness-app \
  --service stoic-fitness-service \
  --container stoic-fitness-app \
  --set BILLING_MODE=stripe_subscriptions
```

## ✅ Verification Checklist

After deployment, verify:

- [ ] Google OAuth login works
- [ ] Google OAuth signup works
- [ ] Email/password login still works
- [ ] Stripe subscription creation works
- [ ] Subscription appears in Stripe Dashboard
- [ ] Webhook events are received (check CloudWatch logs)
- [ ] Subscription auto-renewal works (test after first billing period)
- [ ] Subscription cancellation works

## 🔍 Testing

### Test Google OAuth
1. Go to production site
2. Click "Sign in with Google"
3. Complete OAuth flow
4. Verify you're logged in

### Test Stripe Subscription
1. Log in (Google or email/password)
2. Select a subscription tier
3. Complete payment
4. Verify subscription is created in Stripe Dashboard
5. Verify subscription appears in your account

### Test Webhooks
1. Check CloudWatch logs for webhook events
2. Verify `customer.subscription.created` event is received
3. Verify subscription is stored in database

## 📝 Notes

- **Local Development**: Keep test keys in `.env` file
- **Production**: All keys are in ECS task definition
- **Webhooks**: Make sure webhook endpoint is configured in Stripe Dashboard
- **OAuth Consent Screen**: Must be published or have test users added






