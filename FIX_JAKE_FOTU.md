# Fix Jake Fotu's Gym Membership

## Issue
- Customer ID: `cus_Tn4vCyVuETJUTe`
- Customer was charged but subscription was not created
- Need to create subscription with next billing date 30 days from today
- **DO NOT charge the customer again**

## Solution

The script `fix-jake-fotu-membership.js` will:
1. Find Jake's customer record in Stripe
2. Find his user and membership records in the database
3. Get his payment method
4. Create a subscription with `billing_cycle_anchor` set to 30 days from today
5. Update the database with the subscription IDs

## Running the Fix

### Option 1: Run Locally (requires production Stripe key)

```bash
# Set production Stripe key
export STRIPE_SECRET_KEY_PROD="sk_live_..."

# Run the fix
node fix-jake-fotu-membership.js
```

### Option 2: Run on Production Server

```bash
# SSH into production server
# Navigate to app directory
cd /path/to/app

# Run the fix (production keys should already be in .env)
node fix-jake-fotu-membership.js
```

### Option 3: Use Admin Endpoint (if available)

If there's an admin endpoint for fixing memberships, you can use that instead.

## What the Script Does

1. **Retrieves customer** from Stripe
2. **Finds user** in database by Stripe customer ID
3. **Finds membership** record
4. **Checks for existing subscription** (won't create if one exists)
5. **Gets payment method** from customer
6. **Determines price** based on membership type
7. **Finds or creates Stripe price**
8. **Calculates billing cycle anchor** (30 days from today)
9. **Creates subscription** with:
   - `billing_cycle_anchor`: 30 days from today
   - `proration_behavior: 'none'` (no immediate charge)
   - `backdate_start_date`: Today (subscription active now)
10. **Updates database** with subscription IDs

## Expected Result

- Subscription created in Stripe
- Subscription ID saved in database
- Next billing date: 30 days from today
- No immediate charge (customer was already charged)
- Subscription status: `active`

## Verification

After running, verify:
1. Check Stripe Dashboard: Customer should have active subscription
2. Check database: `gym_memberships` table should have `stripe_subscription_id`
3. Check billing: Next invoice should be scheduled for 30 days from today

