# Hybrid Subscription System Implementation

## Overview

The hybrid subscription system has been successfully implemented. This system uses the database as the source of truth for subscription status while leveraging Stripe for payment processing. This provides better reliability, control, and user experience.

## What Has Been Implemented

### 1. Database Schema Changes ✅

**New Columns Added:**
- `subscriptions` table:
  - `payment_method_id` (TEXT) - Stripe payment method ID
  - `payment_method_expires_at` (TIMESTAMP) - Card expiry date
  - `payment_failure_count` (INTEGER) - Track payment failures
  - `last_payment_failure_at` (TIMESTAMP) - Last failure timestamp
  - `grace_period_ends_at` (TIMESTAMP) - Grace period end date
  - `stripe_status` (TEXT) - Stripe subscription status (for sync)
  - `last_synced_at` (TIMESTAMP) - Last Stripe sync time
  - `sync_error` (TEXT) - Sync error messages
  - Status constraint updated to include `grace_period` and `paused`

- `gym_memberships` table:
  - Same payment tracking columns as subscriptions
  - Status constraint updated to include `grace_period`

**New Tables:**
- `webhook_events` - Tracks processed webhooks for idempotency
- `subscription_status_history` - Audit trail of status changes

**Migration:**
- All new columns are nullable for backward compatibility
- Automatic migration on database initialization
- Works for both PostgreSQL (production) and SQLite (development)

### 2. Payment Flows Updated ✅

**Payment Intent Creation:**
- `createPaymentIntent` now includes `setup_future_usage: 'off_session'`
- Automatically saves payment methods for future use

**Payment Confirmation:**
- App subscriptions: Extracts and saves payment method to database
- Gym memberships: Extracts and saves payment method to database
- Stores payment method expiry dates when available

**Payment Method Management:**
- `GET /api/subscriptions/payment-method` - Get current payment method
- `POST /api/subscriptions/update-payment-method` - Create setup intent for updating
- `POST /api/subscriptions/confirm-payment-method` - Confirm and save new payment method

### 3. Nightly Renewal Job ✅

**Location:** `scripts/nightly-renewal-job.js`

**Features:**
- Finds subscriptions expiring in next 1-2 days
- Charges saved payment methods automatically (off-session)
- Extends subscription end dates on successful payment
- Handles payment failures with grace periods
- Suspends subscriptions after grace period expires
- Supports dry-run mode for testing

**Configuration:**
- `GRACE_PERIOD_DAYS = 7` - Grace period after payment failure
- `MAX_FAILURE_COUNT = 3` - Maximum failures before suspension
- Set `RENEWAL_DRY_RUN=true` in environment for dry-run mode

**Deployment:**
- Can be run via cron: `0 2 * * * /path/to/node /path/to/scripts/nightly-renewal-job.js`
- Or via AWS EventBridge / Lambda scheduled task
- Or via ECS scheduled task

### 4. Webhook Handlers Updated ✅

**Idempotency:**
- All webhooks check `webhook_events` table before processing
- Prevents duplicate processing of events

**Invoice Payment Succeeded:**
- Saves payment method to database
- Resets payment failure tracking
- Extends subscription end dates
- Records status changes in history

**Invoice Payment Failed:**
- Records payment failure count
- Sets grace period (7 days)
- Updates subscription status to `grace_period`
- Suspends subscription after max failures (3)
- Records status changes in history

**Gym Membership Handlers:**
- Same functionality as app subscription handlers
- Handles gym membership-specific logic

### 5. Access Control Updated ✅

**Database as Source of Truth:**
- `getUserActiveSubscription` now includes subscriptions in `grace_period` status
- Grace period subscriptions are treated as active (users retain access)
- Only checks database, not Stripe API (faster, more reliable)

**Grace Period Logic:**
- Subscriptions in grace period are considered active
- Grace period expires when `grace_period_ends_at` passes
- Nightly job automatically suspends expired grace periods

### 6. Database Helper Methods ✅

**Subscription Methods:**
- `updateSubscriptionPaymentMethod(subscriptionId, paymentMethodId, expiresAt)`
- `recordPaymentFailure(subscriptionId, failureCount, lastFailureAt, gracePeriodEndsAt)`
- `resetPaymentFailures(subscriptionId)`
- `getSubscriptionsExpiringSoon(daysAhead)`
- `recordSubscriptionStatusChange(...)` - Audit trail
- `isWebhookProcessed(stripeEventId)` - Idempotency
- `markWebhookProcessed(...)` - Idempotency

**Gym Membership Methods:**
- `updateGymMembershipPaymentMethod(membershipId, paymentMethodId, expiresAt)`
- `recordGymMembershipPaymentFailure(...)`
- `resetGymMembershipPaymentFailures(membershipId)`
- `getGymMembershipsExpiringSoon(daysAhead)`
- `updateGymMembershipStatus(...)` - With history tracking

### 7. Migration Script ✅

**Location:** `scripts/backfill-payment-methods.js`

**Purpose:**
- Backfills payment methods from Stripe for existing subscriptions
- Retrieves payment methods from:
  1. Subscription's `default_payment_method`
  2. Customer's `invoice_settings.default_payment_method`
  3. Latest invoice's payment intent

**Usage:**
```bash
# Dry run (see what would be updated)
node scripts/backfill-payment-methods.js --dry-run

# Live run (make actual updates)
node scripts/backfill-payment-methods.js
```

## What Still Needs to Be Done

### 1. Frontend Updates (Pending)

**Grace Period Alerts:**
- Show warning when subscription is in grace period
- Display grace period countdown
- Prompt to update payment method

**Payment Method Management UI:**
- Display current payment method (card brand, last 4 digits, expiry)
- Allow users to update payment method
- Show payment failure alerts

**Subscription Status Display:**
- Show grace period status
- Display payment failure count
- Show when payment method needs updating

### 2. Testing

**Recommended Tests:**
- Test payment method saving on new subscriptions
- Test payment method saving on upgrades
- Test nightly renewal job (dry-run first)
- Test grace period logic
- Test payment failure handling
- Test webhook idempotency
- Test access control with grace periods

### 3. Deployment

**Steps:**
1. Deploy database schema changes (automatic on next deployment)
2. Run backfill script to populate existing payment methods
3. Deploy application code
4. Set up nightly renewal job (cron or scheduled task)
5. Monitor first few renewal cycles closely

## Configuration

### Environment Variables

**Required:**
- `STRIPE_SECRET_KEY` - Stripe secret key (already configured)

**Optional:**
- `RENEWAL_DRY_RUN=true` - Enable dry-run mode for renewal job

### Grace Period Settings

**Current Values:**
- Grace Period Duration: 7 days
- Max Failure Count: 3 failures
- Renewal Lookahead: 2 days

**To Change:**
- Edit `scripts/nightly-renewal-job.js`
- Update `GRACE_PERIOD_DAYS` and `MAX_FAILURE_COUNT` constants

## Backward Compatibility

✅ **All changes are backward compatible:**
- New columns are nullable
- Existing subscriptions continue to work
- Stripe subscriptions still function normally
- Webhooks continue to work as before
- Access control falls back gracefully

## Monitoring

**Key Metrics to Monitor:**
- Renewal success rate
- Payment failure rate
- Grace period usage
- Subscription suspensions
- Webhook processing errors

**Logs to Watch:**
- Nightly renewal job logs
- Webhook processing logs
- Payment method save operations
- Status change history

## Rollback Plan

If issues occur:
1. Disable nightly renewal job immediately
2. Revert to Stripe-only subscription management (database already supports this)
3. Keep database changes (non-breaking)
4. Stripe subscriptions continue working independently

## Next Steps

1. **Test in Development:**
   - Run backfill script (dry-run first)
   - Test payment flows
   - Test renewal job (dry-run)

2. **Deploy to Production:**
   - Deploy code changes
   - Run backfill script
   - Set up nightly renewal job
   - Monitor closely for first week

3. **Frontend Updates:**
   - Add grace period alerts
   - Add payment method management UI
   - Update subscription status display

4. **Documentation:**
   - Update user-facing documentation
   - Document grace period policy
   - Document payment method requirements

## Support

For issues or questions:
- Check logs in `scripts/nightly-renewal-job.js` output
- Check webhook processing logs
- Review `subscription_status_history` table for audit trail
- Check `webhook_events` table for duplicate processing issues
