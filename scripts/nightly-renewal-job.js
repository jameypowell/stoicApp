#!/usr/bin/env node

/**
 * Nightly Renewal Job for Hybrid Subscription System
 *
 * Safeguards (duplicate-charge prevention):
 * - Skips app and gym rows with stripe_subscription_id set (Stripe invoices renew those).
 * - PostgreSQL advisory lock so only one ECS task runs renewals at a time.
 * - Stripe idempotency keys on off-session PaymentIntents (safe retries / overlapping triggers).
 * - App renewals include past-due end_date rows so the legacy invoice job is not required.
 *
 * This script runs daily to:
 * 1. Find app subscriptions due soon OR already past end_date (manual billing only)
 * 2. Charge saved payment methods automatically
 * 3. Extend subscription end dates on successful payment
 * 4. Handle payment failures with grace periods
 * 5. Suspend subscriptions after grace period expires
 * 6. Apply requested pauses (pause_resume_scheduled) - skip charge, set paused
 * 7. Resume paused gym memberships when paused_until has passed - charge and set active
 *
 * Run via cron: 0 2 * * * /path/to/node /path/to/scripts/nightly-renewal-job.js
 * Or via AWS EventBridge / Lambda scheduled task
 */

require('dotenv').config();
const Stripe = require('stripe');
const { initDatabase, Database } = require('../database');
const {
  nextGymContractEndYmdDenver,
  gymBillingAnchorYmdFromMembershipRow,
  extractYmdFromDbValue,
  getContractStartEndYmdFromSucceededPaymentIntent,
  gymContractStartYmdToPersistOnPayment,
  nextAppSubscriptionEndIsoFromRow
} = require('../lib/gym-contract-dates');
const { DateTime } = require('luxon');
const { AMERICA_DENVER } = require('../lib/mountain-time');

const GRACE_PERIOD_DAYS = 7; // Grace period after payment failure
const MAX_FAILURE_COUNT = 3; // Maximum failures before requiring manual intervention
const DRY_RUN = process.env.RENEWAL_DRY_RUN === 'true';

// Initialize Stripe
const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is not set!');
  process.exit(1);
}
const stripe = new Stripe(stripeSecretKey);

function ymdForIdempotency(value) {
  const y = extractYmdFromDbValue(value);
  return y || 'unknown';
}

/** Next period end after a successful renewal (calendar month in America/Denver). */
function nextGymContractEndYmdAfterRenewalForMembership(membership) {
  const endYmd = ymdForIdempotency(membership.contract_end_date);
  if (endYmd === 'unknown') return null;
  const anchor = gymBillingAnchorYmdFromMembershipRow(membership);
  if (!anchor) return null;
  return nextGymContractEndYmdDenver(endYmd, anchor);
}

// Subscription tier pricing (in cents)
const TIER_PRICING = {
  tier_one: 0,
  tier_two: 700,   // $7.00/month
  tier_three: 1200, // $12.00/month
  tier_four: 1800   // $18.00/month
};

// Gym membership pricing (in cents)
const GYM_MEMBERSHIP_PRICING = {
  'standard': 6500,              // $65.00/month
  'immediate_family_member': 5000,      // $50.00/month
  'expecting_or_recovering_mother': 3000,  // $30.00/month
  'entire_family': 18500           // $185.00/month
};

/**
 * Guardrail: block duplicate renewals for the same billing month.
 * We allow at most one app renewal and one gym renewal per user per Denver month.
 */
async function hasMonthlyRenewalCharge(db, { userId, renewalKind, targetYmd }) {
  if (!userId || !renewalKind || !targetYmd || !/^\d{4}-\d{2}-\d{2}$/.test(String(targetYmd))) {
    return false;
  }
  const tierFilter = renewalKind === 'gym' ? ['gym_membership'] : ['tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly'];
  const statuses = ['succeeded', 'refunded', 'partially_refunded'];
  if (db.isPostgres) {
    const hit = await db.queryOne(
      `SELECT id, tier, status, stripe_payment_intent_id, created_at
       FROM payments
       WHERE user_id = $1
         AND tier = ANY($2::text[])
         AND status = ANY($3::text[])
         AND to_char((created_at AT TIME ZONE 'America/Denver')::date, 'YYYY-MM')
             = to_char(($4::date), 'YYYY-MM')
       ORDER BY created_at DESC
       LIMIT 1`,
      [userId, tierFilter, statuses, targetYmd]
    );
    return hit || null;
  }
  const monthKey = String(targetYmd).slice(0, 7);
  const placeholders = tierFilter.map(() => '?').join(',');
  const hit = await db.queryOne(
    `SELECT id, tier, status, stripe_payment_intent_id, created_at
     FROM payments
     WHERE user_id = ?
       AND tier IN (${placeholders})
       AND status IN ('succeeded','refunded','partially_refunded')
       AND strftime('%Y-%m', datetime(created_at, 'localtime')) = ?
     ORDER BY created_at DESC
     LIMIT 1`,
    [userId, ...tierFilter, monthKey]
  );
  return hit || null;
}

async function renewSubscription(subscription, db) {
  const subscriptionId = subscription.id;
  const userId = subscription.user_id;
  const tier = subscription.tier;
  const paymentMethodId = subscription.payment_method_id;

  const stripeSubId = subscription.stripe_subscription_id && String(subscription.stripe_subscription_id).trim();
  if (stripeSubId) {
    console.log(
      `  ⏭️  Skipping subscription ${subscriptionId}: Stripe subscription ${stripeSubId} manages billing (manual renewal would double-charge).`
    );
    return { success: false, reason: 'stripe_subscription_managed' };
  }
  
  console.log(`[${DRY_RUN ? 'DRY RUN' : 'LIVE'}] Processing subscription ${subscriptionId} for user ${userId}, tier: ${tier}`);
  
  if (!paymentMethodId) {
    console.warn(`  ⚠️  No payment method saved for subscription ${subscriptionId}`);
    // Don't fail - subscription will expire naturally
    return { success: false, reason: 'no_payment_method' };
  }
  
  // Get subscription amount
  const normalizedTier = tier.replace(/^(daily|weekly|monthly)$/, (match) => {
    const map = { daily: 'tier_two', weekly: 'tier_three', monthly: 'tier_four' };
    return map[match];
  });
  const amount = TIER_PRICING[normalizedTier] || TIER_PRICING[tier] || 0;
  
  if (amount === 0) {
    console.warn(`  ⚠️  Tier ${tier} has no price, skipping charge`);
    return { success: false, reason: 'no_price' };
  }
  
  // Get customer ID
  const stripeCustomerId = subscription.stripe_customer_id;
  if (!stripeCustomerId) {
    console.warn(`  ⚠️  No Stripe customer ID for subscription ${subscriptionId}`);
    return { success: false, reason: 'no_customer_id' };
  }

  const appTargetYmd = ymdForIdempotency(subscription.end_date);
  if (appTargetYmd !== 'unknown') {
    const existingMonthCharge = await hasMonthlyRenewalCharge(db, {
      userId,
      renewalKind: 'app',
      targetYmd: appTargetYmd
    });
    if (existingMonthCharge) {
      console.warn(
        `  ⏭️  Guardrail skip (app): user ${userId} already has ${existingMonthCharge.tier}/${existingMonthCharge.status} in ${appTargetYmd.slice(0, 7)} (payment ${existingMonthCharge.stripe_payment_intent_id || existingMonthCharge.id}).`
      );
      return { success: false, reason: 'duplicate_monthly_guardrail' };
    }
  }
  
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would charge $${(amount / 100).toFixed(2)} using payment method ${paymentMethodId}`);
    console.log(`  [DRY RUN] Would extend subscription end_date by one calendar month (America/Denver)`);
    return { success: true, dryRun: true };
  }
  
  try {
    const periodKey = ymdForIdempotency(subscription.end_date);
    const idempotencyKey = `app-manual-renew-sub${subscriptionId}-${periodKey}`.slice(0, 255);
    // Create payment intent with saved payment method
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amount,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true, // Important: indicates this is an automatic charge
        confirm: true, // Automatically confirm the payment
        metadata: {
          subscription_id: subscriptionId.toString(),
          user_id: userId.toString(),
          tier: tier,
          type: 'subscription_renewal',
          renewal_date: new Date().toISOString()
        }
      },
      { idempotencyKey }
    );
    
    if (paymentIntent.status === 'succeeded') {
      console.log(`  ✅ Payment succeeded: ${paymentIntent.id}`);
      
      const nextEndIso =
        nextAppSubscriptionEndIsoFromRow(subscription) ||
        (() => {
          const currentEndDate = new Date(subscription.end_date);
          const newEndDate = new Date(currentEndDate);
          newEndDate.setDate(newEndDate.getDate() + 30);
          return newEndDate.toISOString();
        })();
      
      await db.updateSubscription(subscriptionId, {
        end_date: nextEndIso,
        status: 'active'
      });
      
      // Reset failure tracking
      await db.resetPaymentFailures(subscriptionId);
      
      console.log(`  ✅ Subscription extended to ${String(nextEndIso).split('T')[0]}`);
      
      return { success: true, paymentIntentId: paymentIntent.id };
    } else {
      console.error(`  ❌ Payment intent created but status is ${paymentIntent.status}`);
      return { success: false, reason: 'payment_not_succeeded', status: paymentIntent.status };
    }
  } catch (error) {
    console.error(`  ❌ Payment failed: ${error.message}`);
    
    // Handle payment failure
    const currentFailureCount = (subscription.payment_failure_count || 0) + 1;
    const lastFailureAt = new Date().toISOString();
    
    if (currentFailureCount < MAX_FAILURE_COUNT) {
      // Set grace period
      const gracePeriodEndsAt = new Date();
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + GRACE_PERIOD_DAYS);
      
      await db.recordPaymentFailure(
        subscriptionId,
        currentFailureCount,
        lastFailureAt,
        gracePeriodEndsAt.toISOString()
      );
      
      console.log(`  ⚠️  Payment failure ${currentFailureCount}/${MAX_FAILURE_COUNT}. Grace period until ${gracePeriodEndsAt.toISOString().split('T')[0]}`);
      
      return { success: false, reason: 'payment_failed', failureCount: currentFailureCount, gracePeriod: gracePeriodEndsAt.toISOString() };
    } else {
      // Too many failures - suspend subscription
      await db.updateSubscriptionStatus(subscriptionId, 'paused', subscription.status, 'max_failures_reached');
      
      console.log(`  🛑 Maximum failures reached. Subscription suspended.`);
      
      return { success: false, reason: 'max_failures', failureCount: currentFailureCount };
    }
  }
}

async function renewGymMembership(membership, db) {
  const membershipId = membership.id;
  const userId = membership.user_id;
  const membershipType = membership.membership_type;
  const paymentMethodId = membership.payment_method_id;

  // If user requested pause for this billing cycle, apply it: skip charge, set paused, extend contract_end_date
  const pauseRequested = !!(membership.pause_resume_scheduled);
  if (pauseRequested) {
    console.log(`[${DRY_RUN ? 'DRY RUN' : 'LIVE'}] Applying requested pause for gym membership ${membershipId} (user ${userId})`);
    if (DRY_RUN) {
      console.log(`  [DRY RUN] Would set status=paused, skip charge, extend contract_end_date by 1 month`);
      return { success: true, dryRun: true, reason: 'pause_applied' };
    }
    const now = new Date();
    const endYmd = ymdForIdempotency(membership.contract_end_date);
    const anchor = gymBillingAnchorYmdFromMembershipRow(membership);
    const newContractEnd =
      endYmd !== 'unknown' && anchor ? nextGymContractEndYmdDenver(endYmd, anchor) : null;
    if (!newContractEnd) {
      console.error(`  ❌ Could not compute contract_end after pause for membership ${membershipId}`);
      return { success: false, reason: 'invalid_contract_dates' };
    }
    const pausedUntilStr = DateTime.fromISO(newContractEnd, { zone: AMERICA_DENVER }).endOf('day').toUTC().toISO();
    const nowStr = now.toISOString();
    const pausesUsed = (membership.pauses_used_this_contract ?? 0) + 1;

    if (db.isPostgres) {
      await db.query(
        `UPDATE gym_memberships SET
          status = 'paused',
          paused_at = $1,
          paused_until = $2,
          pauses_used_this_contract = $3,
          pause_resume_scheduled = false,
          contract_end_date = $4,
          updated_at = CURRENT_TIMESTAMP
         WHERE id = $5`,
        [nowStr, pausedUntilStr, pausesUsed, newContractEnd, membershipId]
      );
    } else {
      await db.query(
        `UPDATE gym_memberships SET
          status = 'paused',
          paused_at = ?,
          paused_until = ?,
          pauses_used_this_contract = ?,
          pause_resume_scheduled = 0,
          contract_end_date = ?,
          updated_at = datetime('now')
         WHERE id = ?`,
        [nowStr, pausedUntilStr, pausesUsed, newContractEnd, membershipId]
      );
    }
    console.log(`  ✅ Pause applied. Resumes ${newContractEnd}`);
    return { success: true, reason: 'pause_applied' };
  }
  
  console.log(`[${DRY_RUN ? 'DRY RUN' : 'LIVE'}] Processing gym membership ${membershipId} for user ${userId}, type: ${membershipType}`);

  const gymStripeSubId = membership.stripe_subscription_id && String(membership.stripe_subscription_id).trim();
  if (gymStripeSubId) {
    console.log(
      `  ⏭️  Skipping gym membership ${membershipId}: Stripe subscription ${gymStripeSubId} manages billing (manual PI would double-charge).`
    );
    return { success: false, reason: 'stripe_subscription_managed' };
  }
  
  if (!paymentMethodId) {
    console.warn(`  ⚠️  No payment method saved for membership ${membershipId}`);
    return { success: false, reason: 'no_payment_method' };
  }
  
  let amount = (membership.monthly_amount_cents != null && membership.monthly_amount_cents > 0)
    ? membership.monthly_amount_cents
    : (GYM_MEMBERSHIP_PRICING[membershipType] || 6500);
  if (membership.family_group_id != null && String(membership.family_group_id).trim() !== '') {
    const summed = await db.getSumMonthlyAmountCentsForFamilyGroup(membership.family_group_id);
    if (summed > 0) amount = summed;
  }
  const stripeCustomerId = membership.stripe_customer_id;
  
  if (!stripeCustomerId) {
    console.warn(`  ⚠️  No Stripe customer ID for membership ${membershipId}`);
    return { success: false, reason: 'no_customer_id' };
  }

  const gymTargetYmd = ymdForIdempotency(membership.contract_end_date);
  if (gymTargetYmd !== 'unknown') {
    const existingMonthCharge = await hasMonthlyRenewalCharge(db, {
      userId,
      renewalKind: 'gym',
      targetYmd: gymTargetYmd
    });
    if (existingMonthCharge) {
      console.warn(
        `  ⏭️  Guardrail skip (gym): user ${userId} already has gym charge ${existingMonthCharge.status} in ${gymTargetYmd.slice(0, 7)} (payment ${existingMonthCharge.stripe_payment_intent_id || existingMonthCharge.id}).`
      );
      return { success: false, reason: 'duplicate_monthly_guardrail' };
    }
  }

  const nextEndPreview = nextGymContractEndYmdAfterRenewalForMembership(membership);
  if (!nextEndPreview) {
    console.error(
      `  ❌ Skipping renewal charge for membership ${membershipId}: contract_end_date or billing anchor missing/invalid (contract_end_date=${membership.contract_end_date})`
    );
    return { success: false, reason: 'invalid_contract_end_date' };
  }
  
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would charge $${(amount / 100).toFixed(2)} using payment method ${paymentMethodId}`);
    console.log(`  [DRY RUN] Would extend contract_end_date by one calendar month (America/Denver)`);
    return { success: true, dryRun: true };
  }
  
  try {
    const periodKey = ymdForIdempotency(membership.contract_end_date);
    const idempotencyKey = `gym-manual-renew-m${membershipId}-${periodKey}`.slice(0, 255);
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount: amount,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          membership_id: membershipId.toString(),
          userId: userId.toString(),
          user_id: userId.toString(),
          membership_type: membershipType,
          type: 'gym_membership_renewal',
          renewal_date: new Date().toISOString()
        }
      },
      { idempotencyKey }
    );
    
    if (paymentIntent.status === 'succeeded') {
      console.log(`  ✅ Payment succeeded: ${paymentIntent.id}`);
      
      const newContractEndStr = nextEndPreview;
      let startPersist = null;
      try {
        const piFull = await stripe.paymentIntents.retrieve(paymentIntent.id, { expand: ['latest_charge'] });
        const { contractStartYmd } = await getContractStartEndYmdFromSucceededPaymentIntent(stripe, piFull);
        startPersist = gymContractStartYmdToPersistOnPayment(membership, contractStartYmd);
      } catch (_) {
        startPersist = gymContractStartYmdToPersistOnPayment(membership, null);
      }
      const isPrimaryHousehold =
        (membership.is_primary_member === true || membership.is_primary_member === 1) &&
        membership.family_group_id != null &&
        String(membership.family_group_id).trim() !== '';
      if (isPrimaryHousehold) {
        await db.query(
          db.isPostgres
            ? 'UPDATE gym_memberships SET contract_end_date = $1, contract_start_date = COALESCE($2::date, contract_start_date), updated_at = CURRENT_TIMESTAMP WHERE family_group_id = $3'
            : 'UPDATE gym_memberships SET contract_end_date = ?, contract_start_date = COALESCE(?, contract_start_date), updated_at = datetime(\'now\') WHERE family_group_id = ?',
          [newContractEndStr, startPersist, membership.family_group_id]
        );
      } else {
        await db.query(
          db.isPostgres
            ? 'UPDATE gym_memberships SET contract_end_date = $1, contract_start_date = COALESCE($2::date, contract_start_date), updated_at = CURRENT_TIMESTAMP WHERE id = $3'
            : 'UPDATE gym_memberships SET contract_end_date = ?, contract_start_date = COALESCE(?, contract_start_date), updated_at = datetime(\'now\') WHERE id = ?',
          [newContractEndStr, startPersist, membershipId]
        );
      }
      
      // Reset failure tracking
      await db.resetGymMembershipPaymentFailures(membershipId);
      
      // Record payment in payments table (for history and last_charge_at)
      try {
        await db.createPayment(membership.user_id, paymentIntent.id, amount, 'usd', 'gym_membership', 'succeeded', null);
      } catch (e) {
        if (e.code !== '23505' && !/unique|duplicate/i.test(e.message || '')) console.warn('  Could not record gym payment:', e.message);
      }
      
      console.log(`  ✅ Membership extended to ${newContractEndStr}`);
      
      return { success: true, paymentIntentId: paymentIntent.id };
    } else {
      return { success: false, reason: 'payment_not_succeeded', status: paymentIntent.status };
    }
  } catch (error) {
    console.error(`  ❌ Payment failed: ${error.message}`);
    
    const currentFailureCount = (membership.payment_failure_count || 0) + 1;
    const lastFailureAt = new Date().toISOString();
    
    if (currentFailureCount < MAX_FAILURE_COUNT) {
      const gracePeriodEndsAt = new Date();
      gracePeriodEndsAt.setDate(gracePeriodEndsAt.getDate() + GRACE_PERIOD_DAYS);
      
      await db.recordGymMembershipPaymentFailure(
        membershipId,
        currentFailureCount,
        lastFailureAt,
        gracePeriodEndsAt.toISOString()
      );
      
      console.log(`  ⚠️  Payment failure ${currentFailureCount}/${MAX_FAILURE_COUNT}. Grace period until ${gracePeriodEndsAt.toISOString().split('T')[0]}`);
      
      return { success: false, reason: 'payment_failed', failureCount: currentFailureCount, gracePeriod: gracePeriodEndsAt.toISOString() };
    } else {
      await db.updateGymMembershipStatus(membershipId, 'paused', membership.status, 'max_failures_reached');
      
      console.log(`  🛑 Maximum failures reached. Membership suspended.`);
      
      return { success: false, reason: 'max_failures', failureCount: currentFailureCount };
    }
  }
}

async function resumePausedGymMembership(membership, db) {
  const membershipId = membership.id;
  const userId = membership.user_id;
  const membershipType = membership.membership_type;
  const paymentMethodId = membership.payment_method_id;
  const stripeCustomerId = membership.stripe_customer_id;

  console.log(`[${DRY_RUN ? 'DRY RUN' : 'LIVE'}] Resuming paused gym membership ${membershipId} for user ${userId}`);

  const resumeStripeSubId = membership.stripe_subscription_id && String(membership.stripe_subscription_id).trim();
  if (resumeStripeSubId) {
    console.log(
      `  ⏭️  Skipping resume charge for membership ${membershipId}: Stripe subscription ${resumeStripeSubId} manages billing.`
    );
    return { success: false, reason: 'stripe_subscription_managed' };
  }

  if (!paymentMethodId || !stripeCustomerId) {
    console.warn(`  ⚠️  No payment method or Stripe customer for membership ${membershipId}`);
    return { success: false, reason: 'no_payment_method' };
  }

  let amount = (membership.monthly_amount_cents != null && membership.monthly_amount_cents > 0)
    ? membership.monthly_amount_cents
    : (GYM_MEMBERSHIP_PRICING[membershipType] || 6500);
  if (membership.family_group_id != null && String(membership.family_group_id).trim() !== '') {
    const summed = await db.getSumMonthlyAmountCentsForFamilyGroup(membership.family_group_id);
    if (summed > 0) amount = summed;
  }

  const resumeNextEndPreview = nextGymContractEndYmdAfterRenewalForMembership(membership);
  if (!resumeNextEndPreview) {
    console.error(
      `  ❌ Skipping resume charge for membership ${membershipId}: contract_end_date or billing anchor missing/invalid`
    );
    return { success: false, reason: 'invalid_contract_end_date' };
  }

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would charge $${(amount / 100).toFixed(2)} and resume membership`);
    return { success: true, dryRun: true };
  }

  const resumeTargetYmd = ymdForIdempotency(membership.contract_end_date);
  if (resumeTargetYmd !== 'unknown') {
    const existingMonthCharge = await hasMonthlyRenewalCharge(db, {
      userId,
      renewalKind: 'gym',
      targetYmd: resumeTargetYmd
    });
    if (existingMonthCharge) {
      console.warn(
        `  ⏭️  Guardrail skip (gym resume): user ${userId} already has gym charge ${existingMonthCharge.status} in ${resumeTargetYmd.slice(0, 7)} (payment ${existingMonthCharge.stripe_payment_intent_id || existingMonthCharge.id}).`
      );
      return { success: false, reason: 'duplicate_monthly_guardrail' };
    }
  }

  try {
    const resumePeriodKey = ymdForIdempotency(membership.paused_until || membership.contract_end_date);
    const resumeIdemKey = `gym-manual-resume-m${membershipId}-${resumePeriodKey}`.slice(0, 255);
    const paymentIntent = await stripe.paymentIntents.create(
      {
        amount,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          membership_id: membershipId.toString(),
          userId: userId.toString(),
          user_id: userId.toString(),
          membership_type: membershipType,
          type: 'gym_membership_resume',
          renewal_date: new Date().toISOString()
        }
      },
      { idempotencyKey: resumeIdemKey }
    );

    if (paymentIntent.status === 'succeeded') {
      const newContractEnd = resumeNextEndPreview;

      let resumeStartPersist = null;
      try {
        const piFull = await stripe.paymentIntents.retrieve(paymentIntent.id, { expand: ['latest_charge'] });
        const { contractStartYmd } = await getContractStartEndYmdFromSucceededPaymentIntent(stripe, piFull);
        resumeStartPersist = gymContractStartYmdToPersistOnPayment(membership, contractStartYmd);
      } catch (_) {
        resumeStartPersist = gymContractStartYmdToPersistOnPayment(membership, null);
      }

      if (db.isPostgres) {
        await db.query(
          `UPDATE gym_memberships SET
            status = 'active',
            paused_at = NULL,
            paused_until = NULL,
            contract_end_date = $1,
            contract_start_date = COALESCE($2::date, contract_start_date),
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $3`,
          [newContractEnd, resumeStartPersist, membershipId]
        );
      } else {
        await db.query(
          `UPDATE gym_memberships SET
            status = 'active',
            paused_at = NULL,
            paused_until = NULL,
            contract_end_date = ?,
            contract_start_date = COALESCE(?, contract_start_date),
            updated_at = datetime('now')
           WHERE id = ?`,
          [newContractEnd, resumeStartPersist, membershipId]
        );
      }

      try {
        await db.createPayment(userId, paymentIntent.id, amount, 'usd', 'gym_membership', 'succeeded', null);
      } catch (e) {
        if (e.code !== '23505' && !/unique|duplicate/i.test(e.message || '')) console.warn('  Could not record gym payment:', e.message);
      }

      console.log(`  ✅ Resumed and charged. Next billing: ${newContractEnd}`);
      return { success: true, paymentIntentId: paymentIntent.id };
    }
    return { success: false, reason: 'payment_not_succeeded', status: paymentIntent.status };
  } catch (error) {
    console.error(`  ❌ Resume charge failed: ${error.message}`);
    return { success: false, reason: 'payment_failed', error: error.message };
  }
}

async function checkGracePeriods(db) {
  console.log('\n=== Checking Grace Periods ===');
  
  // Check app subscriptions in grace period
  if (db.isPostgres) {
    const graceSubs = await db.query(
      `SELECT * FROM subscriptions 
       WHERE status = 'grace_period' 
       AND grace_period_ends_at IS NOT NULL 
       AND grace_period_ends_at < CURRENT_TIMESTAMP`
    );
    
    for (const sub of graceSubs.rows || []) {
      console.log(`  ⚠️  Grace period expired for subscription ${sub.id}`);
      await db.updateSubscriptionStatus(sub.id, 'paused', 'grace_period', 'grace_period_expired');
    }
    
    // Check gym memberships in grace period
    const graceMemberships = await db.query(
      `SELECT * FROM gym_memberships 
       WHERE status = 'grace_period' 
       AND grace_period_ends_at IS NOT NULL 
       AND grace_period_ends_at < CURRENT_TIMESTAMP`
    );
    
    for (const mem of graceMemberships.rows || []) {
      console.log(`  ⚠️  Grace period expired for membership ${mem.id}`);
      await db.updateGymMembershipStatus(mem.id, 'paused', 'grace_period', 'grace_period_expired');
    }
  } else {
    // SQLite version
    const graceSubs = await db.query(
      `SELECT * FROM subscriptions 
       WHERE status = 'grace_period' 
       AND grace_period_ends_at IS NOT NULL 
       AND datetime(grace_period_ends_at) < datetime('now')`
    );
    
    for (const sub of graceSubs.rows || []) {
      console.log(`  ⚠️  Grace period expired for subscription ${sub.id}`);
      await db.updateSubscriptionStatus(sub.id, 'paused', 'grace_period', 'grace_period_expired');
    }
    
    const graceMemberships = await db.query(
      `SELECT * FROM gym_memberships 
       WHERE status = 'grace_period' 
       AND grace_period_ends_at IS NOT NULL 
       AND datetime(grace_period_ends_at) < datetime('now')`
    );
    
    for (const mem of graceMemberships.rows || []) {
      console.log(`  ⚠️  Grace period expired for membership ${mem.id}`);
      await db.updateGymMembershipStatus(mem.id, 'paused', 'grace_period', 'grace_period_expired');
    }
  }
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`${DRY_RUN ? 'DRY RUN MODE' : 'LIVE MODE'} - Nightly Renewal Job`);
  console.log(`Started at: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  let dbConnection;
  dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  const lockOk = await db.acquireRenewalJobLock();
  if (!lockOk) {
    console.log('[RENEWAL JOB] Another instance holds the renewal lock (Postgres advisory lock). Exiting to avoid duplicate charges.');
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    } else if (dbConnection && typeof dbConnection.close === 'function') {
      dbConnection.close();
    }
    return;
  }

  try {
    // Get subscriptions expiring soon
    console.log('\n=== Processing App Subscriptions ===');
    const expiringSubscriptions = await db.getSubscriptionsExpiringSoon(2);
    console.log(`Found ${expiringSubscriptions.length} subscriptions expiring soon`);
    
    let successCount = 0;
    let failureCount = 0;
    
    for (const subscription of expiringSubscriptions) {
      const result = await renewSubscription(subscription, db);
      if (result.success) {
        successCount++;
      } else {
        failureCount++;
      }
    }
    
    console.log(`\nApp Subscriptions: ${successCount} succeeded, ${failureCount} failed`);
    
    // Get gym memberships due or already overdue (includes missed charges, e.g. after Stripe API outage)
    console.log('\n=== Processing Gym Memberships ===');
    const expiringMemberships = await db.getGymMembershipsDueOrOverdue(2);
    console.log(`Found ${expiringMemberships.length} gym memberships due or overdue`);
    
    let gymSuccessCount = 0;
    let gymFailureCount = 0;
    
    for (const membership of expiringMemberships) {
      const result = await renewGymMembership(membership, db);
      if (result.success) {
        gymSuccessCount++;
      } else {
        gymFailureCount++;
      }
    }
    
    console.log(`\nGym Memberships: ${gymSuccessCount} succeeded, ${gymFailureCount} failed`);

    // Resume paused gym memberships whose paused_until has passed
    console.log('\n=== Resuming Paused Gym Memberships ===');
    const pausedReadyToResume = await db.getPausedGymMembershipsReadyToResume();
    console.log(`Found ${pausedReadyToResume.length} paused memberships ready to resume`);
    let resumeSuccessCount = 0;
    let resumeFailureCount = 0;
    for (const membership of pausedReadyToResume) {
      const result = await resumePausedGymMembership(membership, db);
      if (result.success) resumeSuccessCount++;
      else resumeFailureCount++;
    }
    console.log(`Resumed: ${resumeSuccessCount} succeeded, ${resumeFailureCount} failed`);
    
    // Check grace periods
    await checkGracePeriods(db);
    
    console.log('\n' + '='.repeat(60));
    console.log('Renewal job completed successfully');
    console.log(`Ended at: ${new Date().toISOString()}`);
    console.log('='.repeat(60) + '\n');
    
  } catch (error) {
    console.error('\n❌ Fatal error in renewal job:', error);
    console.error(error.stack);
    throw error;
  } finally {
    try {
      await db.releaseRenewalJobLock();
    } catch (e) {
      /* ignore */
    }
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    } else if (dbConnection && typeof dbConnection.close === 'function') {
      dbConnection.close();
    }
  }
}

// Run if called directly
if (require.main === module) {
  main().catch(error => {
    console.error('Unhandled error:', error);
    process.exit(1);
  });
}

module.exports = { main, renewSubscription, renewGymMembership, resumePausedGymMembership };
