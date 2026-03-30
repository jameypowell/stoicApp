/**
 * Gym Membership Sync Service
 * Syncs all gym memberships from Stripe to the database
 * Stripe is the source of truth for membership status
 */

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

/**
 * Sync a single gym membership from Stripe to database
 */
async function syncGymMembershipFromStripe(stripeSub, db) {
  try {
    const subscriptionId = stripeSub.id;
    const customerId = typeof stripeSub.customer === 'string' 
      ? stripeSub.customer 
      : stripeSub.customer?.id || stripeSub.customer;
    const stripeStatus = stripeSub.status;

    // Check if this is a gym membership subscription
    if (stripeSub.metadata?.type !== 'gym_membership') {
      return { skipped: true, reason: 'not_gym_membership' };
    }

    const membershipId = parseInt(stripeSub.metadata.membershipId);
    if (!membershipId) {
      console.log(`[SYNC] ⚠️  Missing membershipId in subscription ${subscriptionId} metadata`);
      return { skipped: true, reason: 'missing_membership_id' };
    }

    // Find membership in database
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1'
        : 'SELECT * FROM gym_memberships WHERE id = ?',
      [membershipId]
    );

    if (!membership) {
      console.log(`[SYNC] ⚠️  Membership ${membershipId} not found in database for subscription ${subscriptionId}`);
      return { skipped: true, reason: 'membership_not_found' };
    }

    // Map Stripe subscription status to database status
    // Stripe is source of truth: past_due = payment failed, needs retry (grace_period in DB)
    let dbStatus = membership.status;
    if (stripeStatus === 'active') {
      dbStatus = 'active';
    } else if (stripeStatus === 'canceled' || stripeStatus === 'unpaid' || stripeStatus === 'incomplete_expired') {
      dbStatus = 'inactive';
    } else if (stripeStatus === 'past_due') {
      // Payment failed - Stripe will retry. Map to grace_period so app shows Past Due
      dbStatus = 'grace_period';
    } else if (stripeStatus === 'paused') {
      dbStatus = 'paused';
    }

    // Calculate contract end date from Stripe period (current_period_end = when this period ends / next charge)
    const contractEndDate = new Date(stripeSub.current_period_end * 1000);
    const contractEndDateStr = contractEndDate.toISOString().split('T')[0];

    // Normalize existing contract_end_date for comparison (handle timestamp formats)
    const existingEnd = membership.contract_end_date
      ? String(membership.contract_end_date).split('T')[0].split(' ')[0]
      : null;

    // Check if update is needed
    const needsUpdate =
      membership.stripe_subscription_id !== subscriptionId ||
      membership.stripe_customer_id !== customerId ||
      membership.status !== dbStatus ||
      existingEnd !== contractEndDateStr;

    if (needsUpdate) {
      // Update membership
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET stripe_customer_id = $1, stripe_subscription_id = $2, stripe_subscription_item_id = $3, status = $4, contract_end_date = $5, updated_at = $6 WHERE id = $7'
          : 'UPDATE gym_memberships SET stripe_customer_id = ?, stripe_subscription_id = ?, stripe_subscription_item_id = ?, status = ?, contract_end_date = ?, updated_at = ? WHERE id = ?',
        [
          customerId,
          subscriptionId,
          stripeSub.items.data[0]?.id || membership.stripe_subscription_item_id,
          dbStatus,
          contractEndDateStr,
          new Date().toISOString(),
          membershipId
        ]
      );

      // Get user email for logging
      const user = await db.getUserById(membership.user_id);
      console.log(`[SYNC] ✅ Updated gym membership ${membershipId} for user ${user?.email || membership.user_id} - Status: ${dbStatus} (Stripe: ${stripeStatus})`);
      return { updated: true, membership_id: membershipId, user_id: membership.user_id };
    } else {
      return { skipped: true, reason: 'no_changes' };
    }
  } catch (error) {
    console.error(`[SYNC] ❌ Error syncing gym membership subscription ${stripeSub.id}:`, error.message);
    return { error: true, message: error.message };
  }
}

/**
 * Sync all gym memberships from Stripe to database
 */
async function syncAllGymMemberships(db) {
  console.log('[SYNC] Starting full gym membership sync from Stripe...');
  const startTime = Date.now();
  
  let totalProcessed = 0;
  let totalUpdated = 0;
  let totalSkipped = 0;
  let totalErrors = 0;

  try {
    // Get all subscriptions from Stripe
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
        // Only process gym membership subscriptions
        if (stripeSub.metadata?.type !== 'gym_membership') {
          continue;
        }

        // Skip old canceled subscriptions (more than 30 days old)
        if (stripeSub.status === 'canceled') {
          const canceledDate = stripeSub.canceled_at ? new Date(stripeSub.canceled_at * 1000) : null;
          if (canceledDate) {
            const daysSinceCanceled = (Date.now() - canceledDate.getTime()) / (1000 * 60 * 60 * 24);
            if (daysSinceCanceled > 30) {
              // Skip old canceled subscriptions
              continue;
            }
          }
        }

        totalProcessed++;
        const result = await syncGymMembershipFromStripe(stripeSub, db);
        
        if (result.error) {
          totalErrors++;
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
    console.log(`[SYNC] ✅ Gym membership sync complete in ${duration}ms`);
    console.log(`[SYNC]   Processed: ${totalProcessed}`);
    console.log(`[SYNC]   Updated: ${totalUpdated}`);
    console.log(`[SYNC]   Skipped: ${totalSkipped}`);
    console.log(`[SYNC]   Errors: ${totalErrors}`);

    return {
      success: true,
      processed: totalProcessed,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors,
      duration
    };
  } catch (error) {
    console.error('[SYNC] ❌ Fatal error during gym membership sync:', error);
    return {
      success: false,
      error: error.message,
      processed: totalProcessed,
      updated: totalUpdated,
      skipped: totalSkipped,
      errors: totalErrors
    };
  }
}

module.exports = {
  syncAllGymMemberships,
  syncGymMembershipFromStripe
};


