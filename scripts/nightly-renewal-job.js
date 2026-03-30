#!/usr/bin/env node

/**
 * Nightly Renewal Job for Hybrid Subscription System
 * 
 * This script runs daily to:
 * 1. Find subscriptions expiring in the next 1-2 days
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

async function renewSubscription(subscription, db) {
  const subscriptionId = subscription.id;
  const userId = subscription.user_id;
  const tier = subscription.tier;
  const paymentMethodId = subscription.payment_method_id;
  
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
  
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would charge $${(amount / 100).toFixed(2)} using payment method ${paymentMethodId}`);
    console.log(`  [DRY RUN] Would extend subscription end_date by 30 days`);
    return { success: true, dryRun: true };
  }
  
  try {
    // Create payment intent with saved payment method
    const paymentIntent = await stripe.paymentIntents.create({
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
    });
    
    if (paymentIntent.status === 'succeeded') {
      console.log(`  ✅ Payment succeeded: ${paymentIntent.id}`);
      
      // Extend subscription by 30 days
      const currentEndDate = new Date(subscription.end_date);
      const newEndDate = new Date(currentEndDate);
      newEndDate.setDate(newEndDate.getDate() + 30);
      
      await db.updateSubscription(subscriptionId, {
        end_date: newEndDate.toISOString(),
        status: 'active'
      });
      
      // Reset failure tracking
      await db.resetPaymentFailures(subscriptionId);
      
      console.log(`  ✅ Subscription extended to ${newEndDate.toISOString().split('T')[0]}`);
      
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
    const contractEnd = new Date(membership.contract_end_date);
    const pausedUntil = new Date(contractEnd);
    pausedUntil.setMonth(pausedUntil.getMonth() + 1);
    const newContractEnd = pausedUntil.toISOString().split('T')[0];
    const pausedUntilStr = pausedUntil.toISOString();
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
    console.log(`  ✅ Pause applied. Resumes ${pausedUntil.toISOString().split('T')[0]}`);
    return { success: true, reason: 'pause_applied' };
  }
  
  console.log(`[${DRY_RUN ? 'DRY RUN' : 'LIVE'}] Processing gym membership ${membershipId} for user ${userId}, type: ${membershipType}`);
  
  if (!paymentMethodId) {
    console.warn(`  ⚠️  No payment method saved for membership ${membershipId}`);
    return { success: false, reason: 'no_payment_method' };
  }
  
  const amount = (membership.monthly_amount_cents != null && membership.monthly_amount_cents > 0)
    ? membership.monthly_amount_cents
    : (GYM_MEMBERSHIP_PRICING[membershipType] || 6500);
  const stripeCustomerId = membership.stripe_customer_id;
  
  if (!stripeCustomerId) {
    console.warn(`  ⚠️  No Stripe customer ID for membership ${membershipId}`);
    return { success: false, reason: 'no_customer_id' };
  }
  
  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would charge $${(amount / 100).toFixed(2)} using payment method ${paymentMethodId}`);
    console.log(`  [DRY RUN] Would extend contract_end_date by 1 month`);
    return { success: true, dryRun: true };
  }
  
  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount: amount,
      currency: 'usd',
      customer: stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        membership_id: membershipId.toString(),
        user_id: userId.toString(),
        membership_type: membershipType,
        type: 'gym_membership_renewal',
        renewal_date: new Date().toISOString()
      }
    });
    
    if (paymentIntent.status === 'succeeded') {
      console.log(`  ✅ Payment succeeded: ${paymentIntent.id}`);
      
      // Extend contract by 1 month
      const currentEndDate = new Date(membership.contract_end_date);
      const newEndDate = new Date(currentEndDate);
      newEndDate.setMonth(newEndDate.getMonth() + 1);
      
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET contract_end_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
          : 'UPDATE gym_memberships SET contract_end_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [newEndDate.toISOString().split('T')[0], membershipId]
      );
      
      // Reset failure tracking
      await db.resetGymMembershipPaymentFailures(membershipId);
      
      // Record payment in payments table (for history and last_charge_at)
      try {
        await db.createPayment(membership.user_id, paymentIntent.id, amount, 'usd', 'gym_membership', 'succeeded', null);
      } catch (e) {
        if (e.code !== '23505' && !/unique|duplicate/i.test(e.message || '')) console.warn('  Could not record gym payment:', e.message);
      }
      
      console.log(`  ✅ Membership extended to ${newEndDate.toISOString().split('T')[0]}`);
      
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

  if (!paymentMethodId || !stripeCustomerId) {
    console.warn(`  ⚠️  No payment method or Stripe customer for membership ${membershipId}`);
    return { success: false, reason: 'no_payment_method' };
  }

  const amount = (membership.monthly_amount_cents != null && membership.monthly_amount_cents > 0)
    ? membership.monthly_amount_cents
    : (GYM_MEMBERSHIP_PRICING[membershipType] || 6500);

  if (DRY_RUN) {
    console.log(`  [DRY RUN] Would charge $${(amount / 100).toFixed(2)} and resume membership`);
    return { success: true, dryRun: true };
  }

  try {
    const paymentIntent = await stripe.paymentIntents.create({
      amount,
      currency: 'usd',
      customer: stripeCustomerId,
      payment_method: paymentMethodId,
      off_session: true,
      confirm: true,
      metadata: {
        membership_id: membershipId.toString(),
        user_id: userId.toString(),
        membership_type: membershipType,
        type: 'gym_membership_renewal',
        renewal_date: new Date().toISOString()
      }
    });

    if (paymentIntent.status === 'succeeded') {
      const currentEndDate = new Date(membership.contract_end_date);
      const newEndDate = new Date(currentEndDate);
      newEndDate.setMonth(newEndDate.getMonth() + 1);
      const newContractEnd = newEndDate.toISOString().split('T')[0];

      if (db.isPostgres) {
        await db.query(
          `UPDATE gym_memberships SET
            status = 'active',
            paused_at = NULL,
            paused_until = NULL,
            contract_end_date = $1,
            updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [newContractEnd, membershipId]
        );
      } else {
        await db.query(
          `UPDATE gym_memberships SET
            status = 'active',
            paused_at = NULL,
            paused_until = NULL,
            contract_end_date = ?,
            updated_at = datetime('now')
           WHERE id = ?`,
          [newContractEnd, membershipId]
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
  
  const db = new Database();
  await db.init();
  
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
    process.exit(1);
  } finally {
    if (connection && typeof connection.end === 'function') {
      await connection.end();
    } else if (connection && typeof connection.close === 'function') {
      connection.close();
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
