#!/bin/bash
# Update all production environment variables in ECS

set -e

REGION=us-east-1
CLUSTER=stoic-fitness-app
SERVICE=stoic-fitness-service
CONTAINER=stoic-fitness-app

echo "════════════════════════════════════════════════"
echo "🔄 Updating Production Environment Variables"
echo "════════════════════════════════════════════════"
echo ""

# Google OAuth
echo "📝 Setting Google OAuth credentials..."
python3 scripts/update_ecs_env_vars.py \
  --region $REGION \
  --cluster $CLUSTER \
  --service $SERVICE \
  --container $CONTAINER \
  --set GOOGLE_OAUTH_CLIENT_ID=YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com \
  --set GOOGLE_OAUTH_CLIENT_SECRET=YOUR_GOOGLE_OAUTH_CLIENT_SECRET \
  --set GOOGLE_REDIRECT_URI_PROD=https://app.stoic-fit.com/auth/google/callback

# Stripe Production Keys
echo ""
echo "📝 Setting Stripe production keys..."
python3 scripts/update_ecs_env_vars.py \
  --region $REGION \
  --cluster $CLUSTER \
  --service $SERVICE \
  --container $CONTAINER \
  --set STRIPE_PUBLISHABLE_KEY=YOUR_STRIPE_PUBLISHABLE_KEY \
  --set STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY \
  --set STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET

# Stripe Price IDs
echo ""
echo "📝 Setting Stripe Price IDs..."
python3 scripts/update_ecs_env_vars.py \
  --region $REGION \
  --cluster $CLUSTER \
  --service $SERVICE \
  --container $CONTAINER \
  --set STRIPE_PRICE_DAILY=price_1SUwEpF0CLysN1jANPvhIp7s \
  --set STRIPE_PRICE_WEEKLY=price_1SUwG8F0CLysN1jA367NrtiT \
  --set STRIPE_PRICE_MONTHLY=price_1SUwH8F0CLysN1jAvy1aMz3E

# Billing Mode
echo ""
echo "📝 Setting BILLING_MODE=one_time (app tiers: PaymentIntents + DB; no Stripe Subscriptions checkout)..."
python3 scripts/update_ecs_env_vars.py \
  --region $REGION \
  --cluster $CLUSTER \
  --service $SERVICE \
  --container $CONTAINER \
  --set BILLING_MODE=one_time

echo ""
echo "════════════════════════════════════════════════"
echo "✅ All environment variables updated!"
echo "════════════════════════════════════════════════"
echo ""
echo "⏳ Wait a few minutes for the ECS service to deploy new tasks."
echo ""






