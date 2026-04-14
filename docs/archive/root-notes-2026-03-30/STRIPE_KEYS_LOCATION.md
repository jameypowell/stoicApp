# Stripe API Keys Location Guide

## Production Stripe API Key Location

The **production Stripe API key** is stored in the **ECS Task Definition** environment variables, not in the `.env` file.

### Current Locations:

1. **ECS Task Definition** (Production - LIVE mode)
   - Task Definition: `stoic-fitness-app-td`
   - Environment Variable: `STRIPE_SECRET_KEY`
   - Value: `YOUR_STRIPE_SECRET_KEY`
   - Account ID: `acct_1SQK0oF0CLysN1jA`
   - Mode: **LIVE (PRODUCTION)**

2. **Local .env File** (Development - TEST mode)
   - File: `.env`
   - Environment Variable: `STRIPE_SECRET_KEY`
   - Value: `sk_test_51SQK0xFGUOn991Wp...`
   - Account ID: `acct_1SQK0xFGUOn991Wp`
   - Mode: **TEST (Sandbox)**

### How to Access Production Stripe Key:

#### Method 1: Query ECS Task Definition (Recommended)
```bash
aws ecs describe-task-definition \
  --task-definition stoic-fitness-app-td:79 \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`STRIPE_SECRET_KEY`].value' \
  --output text
```

#### Method 2: Use Helper Script
```bash
node scripts/get-production-stripe-key.js
```

#### Method 3: Check Latest Task Definition
```bash
# Get latest task definition revision
LATEST_REV=$(aws ecs describe-services \
  --cluster stoic-fitness-app \
  --services stoic-fitness-service \
  --region us-east-1 \
  --query 'services[0].taskDefinition' \
  --output text | awk -F: '{print $2}')

# Get Stripe key from that revision
aws ecs describe-task-definition \
  --task-definition stoic-fitness-app-td:$LATEST_REV \
  --region us-east-1 \
  --query 'taskDefinition.containerDefinitions[0].environment[?name==`STRIPE_SECRET_KEY`].value' \
  --output text
```

### Important Notes:

1. **Never commit production keys to git** - They are stored in AWS ECS task definitions
2. **Local .env file is for TEST mode only** - Don't use it for production queries
3. **Production key starts with `sk_live_`** - Test keys start with `sk_test_`
4. **Account IDs must match** - Subscription IDs contain account ID, verify they match

### Current Production Subscriptions:

- **Account**: `acct_1SQK0oF0CLysN1jA`
- **Total Active**: 2 subscriptions
- **Both have payment methods saved**

### Troubleshooting:

If you get `resource_missing` errors when querying Stripe:
1. Verify you're using the correct API key (LIVE vs TEST)
2. Check that the account ID in subscription IDs matches the key's account
3. Ensure you're querying the correct Stripe account
