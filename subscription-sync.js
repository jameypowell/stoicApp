/**
 * Subscription Sync Service
 * Syncs all subscriptions from Stripe to the database
 * Stripe is the source of truth for subscription status
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { normalizeTier } = require('./payments');
const { tierFromStripeSubscription } = require('./stripe-subscription-resolve');

/**
 * Sync a single subscription from Stripe to database
 */
async function syncSubscriptionFromStripe(stripeSub, db) {
  try {
    // Get customer ID - handle both string and expanded customer object
    const customerId = typeof stripeSub.customer === 'string' 
      ? stripeSub.customer 
      : stripeSub.customer?.id || stripeSub.customer;
    const subscriptionId = stripeSub.id;
    const stripeStatus = stripeSub.status;

    // Tier from Stripe price/metadata (same rules as /api/subscriptions/me — single module)
    let tier = tierFromStripeSubscription(stripeSub);
    if (!tier) {
      tier = normalizeTier(stripeSub.metadata?.tier) || 'tier_four';
    }
    tier = normalizeTier(tier) || 'tier_four';

    // End of current paid access window = Stripe current period end (same as webhooks.js — do not add extra days)
    const endDate = stripeSub.current_period_end
      ? new Date(stripeSub.current_period_end * 1000)
      : null;
    if (!stripeSub.current_period_end) {
      console.warn(`[SYNC] Missing current_period_end on ${stripeSub.id}`);
    }

    // Map Stripe status to database status
    let dbStatus = 'active';
    if (stripeStatus === 'canceled' || stripeStatus === 'incomplete_expired') {
      dbStatus = 'canceled';
    } else if (stripeStatus === 'active' || stripeStatus === 'trialing') {
      dbStatus = 'active';
    } else if (stripeStatus === 'past_due' || stripeStatus === 'unpaid') {
      dbStatus = 'grace_period';
    } else if (stripeStatus === 'incomplete') {
      dbStatus = 'paused';
    }

    // Find user by customer ID or email
    let user = null;
    const sqlByCustomer = db.isPostgres
      ? 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = $1 LIMIT 1'
      : 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = ? LIMIT 1';
    user = await db.queryOne(sqlByCustomer, [customerId]);

    if (!user) {
      // Try to find by email - only retrieve customer if customerId is a string
      if (typeof customerId === 'string') {
        try {
          const customer = await stripe.customers.retrieve(customerId);
          if (customer && customer.email) {
            user = await db.getUserByEmail(customer.email);
          }
        } catch (error) {
          // Customer might not exist or be accessible
          console.log(`[SYNC] Could not retrieve customer ${customerId}: ${error.message}`);
        }
      }
    }

    if (!user) {
      console.log(`[SYNC] ⚠️  User not found for customer ${customerId}, skipping subscription ${subscriptionId}`);
      return { skipped: true, reason: 'user_not_found' };
    }

    // Check if subscription exists in database
    const existingSub = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1'
        : 'SELECT * FROM subscriptions WHERE stripe_subscription_id = ?',
      [subscriptionId]
    );

    if (existingSub) {
      // Update existing subscription - ALWAYS update status if Stripe says active/trialing
      const shouldUpdateEndDate = !(stripeStatus === 'incomplete' || stripeStatus === 'incomplete_expired');
      const desiredEndDate = shouldUpdateEndDate && endDate ? endDate.toISOString() : existingSub.end_date;
      const needsUpdate = 
        ((stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due' || stripeStatus === 'unpaid') && existingSub.tier !== tier) ||
        existingSub.status !== dbStatus ||
        existingSub.stripe_customer_id !== customerId ||
        existingSub.end_date !== desiredEndDate ||
        // Force update if Stripe says active but DB says canceled
        ((stripeStatus === 'active' || stripeStatus === 'trialing') && existingSub.status === 'canceled');

      if (needsUpdate) {
        await db.updateSubscription(existingSub.id, {
          tier: (stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due' || stripeStatus === 'unpaid') ? tier : existingSub.tier,
          status: dbStatus,
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          end_date: desiredEndDate
        });
        console.log(`[SYNC] ✅ Updated subscription ${subscriptionId} for user ${user.email} (${user.id}) - Status: ${dbStatus} (Stripe: ${stripeStatus})`);
        return { updated: true, user_id: user.id, subscription_id: existingSub.id };
      } else {
        return { skipped: true, reason: 'no_changes' };
      }
    } else {
      // Never create a new app-subscription DB row for incomplete attempts.
      if (!(stripeStatus === 'active' || stripeStatus === 'trialing' || stripeStatus === 'past_due' || stripeStatus === 'unpaid')) {
        return { skipped: true, reason: `status_${stripeStatus}_not_activating` };
      }

      // Check if there's a canceled subscription with the same customer ID - reactivate it instead of creating new
      const canceledSub = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM subscriptions WHERE user_id = $1 AND stripe_customer_id = $2 AND status = $3 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM subscriptions WHERE user_id = ? AND stripe_customer_id = ? AND status = ? ORDER BY created_at DESC LIMIT 1',
        [user.id, customerId, 'canceled']
      );
      
      if (canceledSub && (stripeStatus === 'active' || stripeStatus === 'trialing')) {
        // Reactivate the canceled subscription with new subscription ID
        await db.updateSubscription(canceledSub.id, {
          tier: tier,
          status: 'active',
          stripe_customer_id: customerId,
          stripe_subscription_id: subscriptionId,
          end_date: endDate ? endDate.toISOString() : canceledSub.end_date
        });
        console.log(`[SYNC] ✅ Reactivated subscription ${subscriptionId} for user ${user.email} (${user.id}) - Status: active (Stripe: ${stripeStatus})`);
        return { updated: true, user_id: user.id, subscription_id: canceledSub.id, reactivated: true };
      }
      
      // Cancel any existing active subscriptions first
      const existingActive = await db.getUserActiveSubscriptions(user.id);
      if (existingActive && existingActive.length > 0) {
        for (const sub of existingActive) {
          await db.updateSubscriptionStatus(sub.id, 'canceled');
        }
      }

      // Create new subscription
      if (!endDate) {
        return { skipped: true, reason: 'no_period_end' };
      }
      const newSub = await db.createSubscription(
        user.id,
        tier,
        customerId,
        subscriptionId,
        endDate.toISOString()
      );
      console.log(`[SYNC] ✅ Created subscription ${subscriptionId} for user ${user.email} (${user.id}) - Status: ${dbStatus} (Stripe: ${stripeStatus})`);
      return { created: true, user_id: user.id, subscription_id: newSub.id };
    }
  } catch (error) {
    console.error(`[SYNC] ❌ Error syncing subscription ${stripeSub.id}:`, error.message);
    return { error: true, message: error.message };
  }
}

/**
 * Sync all subscriptions from Stripe to database
 */
async function syncAllSubscriptions(db) {
  console.log('[SYNC] Starting full subscription sync from Stripe...');
  const startTime = Date.now();
  
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalCreated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    // Get all active subscriptions from Stripe
    let hasMore = true;
    let startingAfter = null;

    while (hasMore) {
      const params = {
        status: 'all', // Get all subscriptions (active, canceled, etc.)
        limit: 100,
        expand: ['data.customer']
      };
      
      if (startingAfter) {
        params.starting_after = startingAfter;
      }

      const subscriptions = await stripe.subscriptions.list(params);
      
      if (subscriptions.data.length === 0) {
        hasMore = false;
        break;
      }

      for (const stripeSub of subscriptions.data) {
        // Only skip canceled subscriptions that are old (more than 30 days old) AND not recently updated
        // This ensures we still process recently canceled subscriptions that might have been reactivated
        if (stripeSub.status === 'canceled') {
          const canceledDate = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null;
          if (canceledDate) {
            const daysSinceCanceled = (Date.now() - canceledDate.getTime()) / (1000 * 60 * 60 * 24);
            // Only skip if canceled more than 30 days ago AND updated more than 7 days ago
            const updatedDate = stripeSub.updated ? new Date(stripeSub.updated * 1000) : null;
            const daysSinceUpdated = updatedDate ? (Date.now() - updatedDate.getTime()) / (1000 * 60 * 60 * 24) : Infinity;
            if (daysSinceCanceled > 30 && daysSinceUpdated > 7) {
              // Skip old canceled subscriptions that haven't been updated recently
              continue;
            }
          }
        }

        totalProcessed++;
        const result = await syncSubscriptionFromStripe(stripeSub, db);
        
        if (result.error) {
          totalErrors++;
        } else if (result.created) {
          totalCreated++;
        } else if (result.updated) {
          totalUpdated++;
        } else if (result.skipped) {
          totalSkipped++;
        }
      }

      // Check if there are more subscriptions
      hasMore = subscriptions.has_more;
      if (hasMore && subscriptions.data.length > 0) {
        startingAfter = subscriptions.data[subscriptions.data.length - 1].id;
      }
    }

    const duration = Date.now() - startTime;
    console.log(`[SYNC] ✅ Sync complete in ${duration}ms`);
    console.log(`[SYNC]   Processed: ${totalProcessed}`);
    console.log(`[SYNC]   Created: ${totalCreated}`);
    console.log(`[SYNC]   Updated: ${totalUpdated}`);
    console.log(`[SYNC]   Skipped: ${totalSkipped}`);
    console.log(`[SYNC]   Errors: ${totalErrors}`);

    return {
      success: true,
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors,
      duration
    };
  } catch (error) {
    console.error('[SYNC] ❌ Fatal error during sync:', error);
    return {
      success: false,
      error: error.message,
      processed: totalProcessed,
      created: totalCreated,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors
    };
  }
}

/**
 * Canonical instant for subscriptions.end_date / admin "expires" — must match member "free trial" / period UI.
 *
 * Rules (Stripe is source of truth):
 * 1. Free trial: use trial_end when Stripe status is trialing, OR incomplete while trial is still in the future
 *    (checkout in progress — same trial window as resolveStripeStatusForMemberUi "trialing" UX).
 * 2. Otherwise: paid billing period end = current_period_end.
 */
function stripeSubscriptionAccessEndIso(stripeSub) {
  if (!stripeSub) return null;
  const now = Math.floor(Date.now() / 1000);
  const trialEnd = stripeSub.trial_end || 0;

  if (stripeSub.status === 'trialing' && trialEnd) {
    return new Date(trialEnd * 1000).toISOString();
  }
  if (stripeSub.status === 'incomplete' && trialEnd > now) {
    return new Date(trialEnd * 1000).toISOString();
  }
  if (stripeSub.current_period_end) {
    return new Date(stripeSub.current_period_end * 1000).toISOString();
  }
  return null;
}

/**
 * Admin / reconcile: set subscriptions.end_date from Stripe when drift > 1 hour.
 * Fixes legacy bad rows (e.g. sync that added +30 days) and trialing date mismatch.
 *
 * @param {*} db
 * @param {import('stripe').Stripe} stripe
 */
async function syncActiveAppSubscriptionEndDatesFromStripe(db, stripe) {
  if (!db || !db.isPostgres || !stripe) {
    return {
      supported: false,
      updated: [],
      errors: [],
      scanned: 0,
      message: 'Requires PostgreSQL and Stripe client'
    };
  }

  const r = await db.query(`
    SELECT s.id, s.user_id, u.email, s.stripe_subscription_id, s.end_date
    FROM subscriptions s
    LEFT JOIN users u ON u.id = s.user_id
    WHERE s.stripe_subscription_id IS NOT NULL
      AND TRIM(s.stripe_subscription_id) <> ''
      AND s.status IN ('active', 'grace_period')
  `);

  const rows = r.rows || [];
  const updated = [];
  const errors = [];

  for (const row of rows) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(row.stripe_subscription_id);
      const iso = stripeSubscriptionAccessEndIso(stripeSub);
      if (!iso) continue;
      const dbMs = row.end_date ? new Date(row.end_date).getTime() : NaN;
      const stMs = new Date(iso).getTime();
      // Align with Stripe whenever meaningfully different (admin "expires" should match trial/period end).
      if (Number.isNaN(dbMs) || Math.abs(dbMs - stMs) > 90 * 1000) {
        await db.updateSubscription(row.id, { end_date: iso });
        updated.push({
          subscription_id: row.id,
          user_id: row.user_id,
          email: row.email || null,
          stripe_subscription_id: row.stripe_subscription_id,
          end_date: iso
        });
      }
    } catch (e) {
      errors.push({
        subscription_id: row.id,
        user_id: row.user_id,
        email: row.email || null,
        stripe_subscription_id: row.stripe_subscription_id,
        error: e.message || String(e)
      });
    }
  }

  return {
    supported: true,
    scanned: rows.length,
    count: updated.length,
    updated,
    errors
  };
}

module.exports = {
  syncAllSubscriptions,
  syncSubscriptionFromStripe,
  stripeSubscriptionAccessEndIso,
  syncActiveAppSubscriptionEndDatesFromStripe
};

