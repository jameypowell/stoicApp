# Active Subscriptions Verification Report
Generated: $(date)

## Stripe Subscription Details

### 1. jtoddwhitephd@gmail.com
- **Subscription ID**: `sub_1SXU4dF0CLysN1jA8OIrz947`
- **Customer ID**: `cus_TUT0aQPmkZaUlU`
- **Tier**: `tier_four`
- **Type**: App Subscription
- **Status**: active
- **Next Billing**: January 25, 2026
- **Amount**: $18.00/month

### 2. jbnielson16@gmail.com
- **Subscription ID**: `sub_1SpNC7F0CLysN1jAxvi3arES`
- **Customer ID**: `cus_TTQrfuTZCoc0Yy`
- **Tier**: `tier_four`
- **Type**: App Subscription
- **Status**: active
- **Next Billing**: February 13, 2026
- **Amount**: $18.00/month

### 3. fotujacob@gmail.com (Jake Fotu)
- **Subscription ID**: `sub_1StAIqF0CLysN1jANYCAoNcU`
- **Customer ID**: `cus_Tn4vCyVuETJUTe`
- **Tier**: `standard`
- **Type**: Gym Membership
- **Status**: active
- **Next Billing**: February 14, 2026
- **Amount**: $65.00/month
- **Note**: Payment method needs to be added before Feb 14

### 4. sharla.barber@nebo.edu
- **Subscription ID**: `sub_1SgR8UF0CLysN1jAY6hgsu5M`
- **Customer ID**: `cus_TdiZ2uUEfx7dBL`
- **Tier**: `tier_two`
- **Type**: App Subscription
- **Status**: active
- **Next Billing**: February 20, 2026
- **Amount**: $7.00/month

## Database Verification Queries

Run these queries to verify database records match Stripe:

### For jtoddwhitephd@gmail.com:
```sql
-- Check user
SELECT id, email, stripe_customer_id FROM users WHERE email = 'jtoddwhitephd@gmail.com';
-- Expected: stripe_customer_id = 'cus_TUT0aQPmkZaUlU'

-- Check subscription
SELECT id, user_id, tier, status, stripe_subscription_id, stripe_customer_id, end_date
FROM subscriptions
WHERE user_id = (SELECT id FROM users WHERE email = 'jtoddwhitephd@gmail.com')
AND stripe_subscription_id = 'sub_1SXU4dF0CLysN1jA8OIrz947';
-- Expected: tier = 'tier_four', status = 'active', stripe_subscription_id = 'sub_1SXU4dF0CLysN1jA8OIrz947'
```

### For jbnielson16@gmail.com:
```sql
-- Check user
SELECT id, email, stripe_customer_id FROM users WHERE email = 'jbnielson16@gmail.com';
-- Expected: stripe_customer_id = 'cus_TTQrfuTZCoc0Yy'

-- Check subscription
SELECT id, user_id, tier, status, stripe_subscription_id, stripe_customer_id, end_date
FROM subscriptions
WHERE user_id = (SELECT id FROM users WHERE email = 'jbnielson16@gmail.com')
AND stripe_subscription_id = 'sub_1SpNC7F0CLysN1jAxvi3arES';
-- Expected: tier = 'tier_four', status = 'active', stripe_subscription_id = 'sub_1SpNC7F0CLysN1jAxvi3arES'
```

### For fotujacob@gmail.com (Gym Membership):
```sql
-- Check user
SELECT id, email, stripe_customer_id FROM users WHERE email = 'fotujacob@gmail.com';
-- Expected: stripe_customer_id = 'cus_Tn4vCyVuETJUTe'

-- Check gym membership
SELECT id, user_id, membership_type, status, stripe_subscription_id, stripe_customer_id
FROM gym_memberships
WHERE user_id = (SELECT id FROM users WHERE email = 'fotujacob@gmail.com');
-- Expected: stripe_subscription_id = 'sub_1StAIqF0CLysN1jANYCAoNcU', status = 'active'
```

### For sharla.barber@nebo.edu:
```sql
-- Check user
SELECT id, email, stripe_customer_id FROM users WHERE email = 'sharla.barber@nebo.edu';
-- Expected: stripe_customer_id = 'cus_TdiZ2uUEfx7dBL'

-- Check subscription
SELECT id, user_id, tier, status, stripe_subscription_id, stripe_customer_id, end_date
FROM subscriptions
WHERE user_id = (SELECT id FROM users WHERE email = 'sharla.barber@nebo.edu')
AND stripe_subscription_id = 'sub_1SgR8UF0CLysN1jAY6hgsu5M';
-- Expected: tier = 'tier_two', status = 'active', stripe_subscription_id = 'sub_1SgR8UF0CLysN1jAY6hgsu5M'
```

## Feature Access Summary

### Tier Four Users (jtoddwhitephd@gmail.com, jbnielson16@gmail.com):
- ✅ Functional Fitness Workouts: Unlimited (within subscription period)
- ✅ Core Finishers: Unlimited
- ✅ Strength Phase One: Full access
- ✅ Strength Phase Two: Full access
- ✅ Strength Phase Three: Full access
- ✅ Meal Plan Calculator: Unlimited
- ✅ Body Composition Measurements: Unlimited
- ✅ 1RM Lifts: Limit of 15

### Tier Two User (sharla.barber@nebo.edu):
- ✅ Functional Fitness Workouts: Today only (8 consecutive days)
- ✅ Core Finishers: Limit of 5
- ✅ Strength Phase One: Full access
- ❌ Strength Phase Two: No access
- ❌ Strength Phase Three: No access
- ✅ Meal Plan Calculator: Limit of 2
- ✅ Body Composition Measurements: Limit of 5
- ✅ 1RM Lifts: Limit of 5

## Common Fixes

If database records don't match Stripe, use these UPDATE statements:

### Fix User stripe_customer_id:
```sql
UPDATE users SET stripe_customer_id = 'cus_XXX' WHERE email = 'user@example.com';
```

### Fix App Subscription:
```sql
UPDATE subscriptions 
SET stripe_subscription_id = 'sub_XXX',
    stripe_customer_id = 'cus_XXX',
    tier = 'tier_four',
    status = 'active',
    end_date = '2026-01-25T21:46:59.000Z',
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE email = 'user@example.com');
```

### Fix Gym Membership:
```sql
UPDATE gym_memberships
SET stripe_subscription_id = 'sub_XXX',
    stripe_customer_id = 'cus_XXX',
    status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE email = 'user@example.com');
```
