# 🚨 URGENT: Fix JD Nielson's Account - IMMEDIATE ACTION REQUIRED

## Problem
JD Nielson (jbnielson16@gmail.com, Customer ID: cus_TTQrfuTZCoc0Yy) is locked out. His subscription shows as "canceled" in the database but he has an active subscription in Stripe.

## FASTEST FIX: Use Admin API Endpoint

### Option 1: Via Browser Console (Fastest - 30 seconds)

1. **Log into production as admin**: https://stoic-fit.com (or your production URL)
2. **Open browser console** (F12 or Cmd+Option+I)
3. **Run this code**:

```javascript
// Get your admin token
const token = localStorage.getItem('token');

// Fix JD's subscription
fetch('/api/admin/subscriptions/sync', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${token}`
  },
  body: JSON.stringify({
    customerId: 'cus_TTQrfuTZCoc0Yy'
  })
})
.then(r => r.json())
.then(data => {
  console.log('✅ Result:', data);
  if (data.error) {
    console.error('❌ Error:', data.error);
  } else {
    console.log('✅ JD Nielson\'s account has been fixed!');
  }
})
.catch(err => console.error('❌ Error:', err));
```

### Option 2: Via cURL (If you have admin token)

```bash
curl -X POST https://stoic-fit.com/api/admin/subscriptions/sync \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN_HERE" \
  -d '{"customerId": "cus_TTQrfuTZCoc0Yy"}'
```

### Option 3: Full Sync (If single sync doesn't work)

```bash
curl -X POST https://stoic-fit.com/api/admin/subscriptions/sync-all \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer YOUR_ADMIN_TOKEN_HERE"
```

## Alternative: Direct Database Update

If API doesn't work, connect to production database and run:

```sql
-- Find JD's user ID
SELECT id, email FROM users WHERE email = 'jbnielson16@gmail.com';

-- Update his subscription (replace USER_ID with actual ID from above)
UPDATE subscriptions
SET status = 'active',
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = USER_ID
  AND stripe_customer_id = 'cus_TTQrfuTZCoc0Yy';

-- Verify
SELECT u.email, s.status, s.tier, s.stripe_subscription_id
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE u.email = 'jbnielson16@gmail.com';
```

## What Was Fixed in Code

The code has been updated so that:
1. **On next login**, JD's account will automatically sync from Stripe
2. **Nightly sync** will keep everything in sync
3. **Reactivated subscriptions** are handled correctly

But we need to fix it NOW, so use one of the methods above.

## Verification

After fixing, verify JD can:
1. Log in successfully
2. See "Active" status in his account
3. Access all tier_four features


