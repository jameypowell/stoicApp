# Stripe Subscription Database Sync Script

## Overview

The `scripts/sync-stripe-subscriptions.js` script automatically syncs the 4 active Stripe subscriptions with the database to ensure:
- User records have correct `stripe_customer_id`
- Subscription/gym membership records match Stripe
- Tiers, statuses, and end dates are correct
- Feature access is properly configured

## Usage

### Dry Run (Preview Changes)
```bash
node scripts/sync-stripe-subscriptions.js --dry-run
```

This shows what would be synced without making any changes.

### Actual Sync
```bash
DB_PASSWORD=your_password node scripts/sync-stripe-subscriptions.js
```

This will:
1. Connect to the production database
2. Check each of the 4 active subscriptions
3. Automatically fix any mismatches
4. Report what was fixed

## What Gets Synced

### For Each Active Subscription:

1. **User Record:**
   - `stripe_customer_id` - Ensures it matches Stripe customer ID

2. **App Subscriptions:**
   - `stripe_subscription_id` - Matches Stripe subscription ID
   - `stripe_customer_id` - Matches Stripe customer ID
   - `tier` - Matches Stripe metadata tier
   - `status` - Set to 'active' if Stripe status is active
   - `end_date` - Set to Stripe's `current_period_end` (allows 2-day variance)

3. **Gym Memberships:**
   - `stripe_subscription_id` - Matches Stripe subscription ID
   - `stripe_customer_id` - Matches Stripe customer ID
   - `status` - Set to 'active' if Stripe status is active

## Active Subscriptions Being Synced

1. **jtoddwhitephd@gmail.com** - Tier Four App Subscription
2. **jbnielson16@gmail.com** - Tier Four App Subscription
3. **fotujacob@gmail.com** - Standard Gym Membership
4. **sharla.barber@nebo.edu** - Tier Two App Subscription

## Safety Features

- Only syncs the 4 known active subscriptions
- Dry-run mode available to preview changes
- Detailed logging of all changes
- Error handling for missing records
- Won't create new user records (requires manual creation)

## Output

The script provides:
- ✅ Verification status for each subscription
- 🔧 List of fixes applied
- ❌ Any errors encountered
- 📊 Summary of sync results

## Feature Access

After syncing, users will have correct feature access based on their tier:

- **Tier Two**: Limited access (5 core finishers, 2 meal plans, etc.)
- **Tier Four**: Full access (unlimited core finishers, meal plans, all strength phases)

Feature access is controlled by `tier-access-config.json` and verified during sync.
