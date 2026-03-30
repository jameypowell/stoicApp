/**
 * One place: DB subscription row + Stripe → exact JSON for app (My Account + auth/me).
 * Prevents auth/me and subscriptions/me from disagreeing; drives app_payment_banner server-side.
 */

'use strict';

const {
  tierFromStripeSubscription,
  resolveStripeStatusForMemberUi
} = require('./stripe-subscription-resolve');
const { normalizeTier } = require('./payments');
const { stripeSubscriptionAccessEndIso } = require('./subscription-sync');

/** Tier One created in DB only (gym free app window) — no Stripe subscription id. */
function isDbTierOneFreeTier(subscription) {
  const sid = subscription.stripe_subscription_id;
  if (sid != null && String(sid).trim() !== '') return false;
  return normalizeTier(subscription.tier) === 'tier_one';
}

/**
 * Gym can save a card on a different Stripe customer than the app subscription (or DB has pm id only on gym row).
 * Matches the spirit of GET /gym-memberships/me so we do not show "Payment method required" for app when gym already shows a card.
 */
async function hasPaymentMethodFromGymMembershipContext(stripe, db, userId) {
  if (!stripe || !db || !userId) return false;
  try {
    const gm = db.isPostgres
      ? await db.queryOne(
          `SELECT payment_method_id, stripe_customer_id FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`,
          [userId]
        )
      : await db.queryOne(
          `SELECT payment_method_id, stripe_customer_id FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
          [userId]
        );
    if (gm && gm.payment_method_id && String(gm.payment_method_id).trim()) {
      return true;
    }
    const customerIds = [];
    if (gm && gm.stripe_customer_id && String(gm.stripe_customer_id).trim()) {
      customerIds.push(String(gm.stripe_customer_id).trim());
    }
    const urow = db.isPostgres
      ? await db.queryOne('SELECT stripe_customer_id FROM users WHERE id = $1', [userId])
      : await db.queryOne('SELECT stripe_customer_id FROM users WHERE id = ?', [userId]);
    if (urow && urow.stripe_customer_id && String(urow.stripe_customer_id).trim()) {
      customerIds.push(String(urow.stripe_customer_id).trim());
    }
    const seen = new Set();
    for (const cid of customerIds) {
      if (!cid || seen.has(cid)) continue;
      seen.add(cid);
      try {
        const cards = await stripe.paymentMethods.list({ customer: cid, type: 'card', limit: 10 });
        if (cards.data && cards.data.length > 0) return true;
        const ach = await stripe.paymentMethods.list({ customer: cid, type: 'us_bank_account', limit: 5 });
        if (ach.data && ach.data.length > 0) return true;
      } catch (pmErr) {
        console.warn('[subscription-client-payload] paymentMethods.list (gym/user customer) failed:', pmErr.message);
      }
    }
  } catch (e) {
    console.warn('[subscription-client-payload] gym membership PM context failed:', e.message);
  }
  return false;
}

/**
 * @param {import('stripe').Stripe} stripe
 * @param {object} db
 * @param {object} subscription - subscriptions table row
 * @param {object} user - users row (need role)
 * @returns {Promise<object|null>}
 */
async function buildSubscriptionClientPayload(stripe, db, subscription, user) {
  if (!subscription) return null;

  const role = (user && user.role) || 'user';

  let hasPaymentMethod = !!(subscription.payment_method_id && String(subscription.payment_method_id).trim() !== '');
  let effectiveTier = subscription.tier;
  let stripeStatusForUi = null;
  let stripeStatusRaw = null;
  let stripeCurrentTier = null;
  let stripeTierFromPrice = null;
  let trialEndsAtIso = null;
  let trialActive = false;
  let stripeEnrichmentOk = false;
  /** When set, overrides stale DB end_date (must match Stripe current_period_end) */
  let stripeCurrentPeriodEndIso = null;

  if (subscription.stripe_subscription_id) {
    try {
      const stripeSub = await stripe.subscriptions.retrieve(subscription.stripe_subscription_id, {
        expand: ['default_payment_method', 'latest_invoice', 'items.data.price']
      });
      stripeEnrichmentOk = true;
      stripeCurrentPeriodEndIso = stripeSubscriptionAccessEndIso(stripeSub);
      stripeStatusRaw = stripeSub.status || null;
      stripeTierFromPrice = tierFromStripeSubscription(stripeSub);
      stripeCurrentTier = normalizeTier(stripeSub.metadata?.currentTier) || null;

      // Only move displayed tier to Stripe price when subscription state is activating/current.
      // For incomplete attempts, keep current tier (or metadata.currentTier fallback) until success.
      const stripeActivating = ['active', 'trialing', 'past_due', 'unpaid'].includes(stripeStatusRaw);
      if (stripeActivating && stripeTierFromPrice) {
        effectiveTier = stripeTierFromPrice;
      } else if ((stripeStatusRaw === 'incomplete' || stripeStatusRaw === 'incomplete_expired') && stripeCurrentTier) {
        effectiveTier = stripeCurrentTier;
      }

      const custId =
        typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id;

      if (!hasPaymentMethod && stripeSub.default_payment_method) {
        hasPaymentMethod = true;
      }
      if (!hasPaymentMethod && custId) {
        const customer = await stripe.customers.retrieve(custId);
        if (customer.invoice_settings?.default_payment_method) {
          hasPaymentMethod = true;
        }
      }
      if (!hasPaymentMethod && custId) {
        try {
          const cards = await stripe.paymentMethods.list({ customer: custId, type: 'card', limit: 10 });
          if (cards.data && cards.data.length > 0) {
            hasPaymentMethod = true;
          } else {
            const ach = await stripe.paymentMethods.list({
              customer: custId,
              type: 'us_bank_account',
              limit: 5
            });
            if (ach.data && ach.data.length > 0) {
              hasPaymentMethod = true;
            }
          }
        } catch (pmErr) {
          console.warn('[subscription-client-payload] paymentMethods.list failed:', pmErr.message);
        }
      }

      if (!hasPaymentMethod && user && user.id) {
        hasPaymentMethod = await hasPaymentMethodFromGymMembershipContext(stripe, db, user.id);
      }

      const nowSec = Math.floor(Date.now() / 1000);
      if (stripeSub.trial_end) {
        trialEndsAtIso = new Date(stripeSub.trial_end * 1000).toISOString();
        trialActive = stripeSub.status === 'trialing' || stripeSub.trial_end > nowSec;
      } else if (stripeSub.status === 'trialing') {
        trialActive = true;
      }

      const resolved = resolveStripeStatusForMemberUi(stripeSub, {
        customerHasPaymentMethod: hasPaymentMethod
      });
      stripeStatusForUi = resolved.ui;

      if (stripeTierFromPrice && ['active', 'trialing', 'past_due', 'unpaid'].includes(stripeStatusRaw) && stripeTierFromPrice !== subscription.tier) {
        db.updateSubscription(subscription.id, { tier: stripeTierFromPrice }).catch((err) =>
          console.warn('[subscription-client-payload] persist tier from Stripe failed:', err.message)
        );
      }
    } catch (e) {
      console.warn('[subscription-client-payload] Stripe retrieve failed:', e.message);
      stripeEnrichmentOk = false;
    }
  }

  const dbActive =
    subscription.status === 'active' ||
    subscription.status === 'grace_period' ||
    subscription.status === 'free_trial';
  let endDateOk = true;
  let neverExpires = false;
  if (subscription.end_date) {
    const ed = new Date(subscription.end_date);
    if (!Number.isNaN(ed.getTime())) {
      neverExpires = ed.getFullYear() >= 2099;
      // Compare expiration instant to now (matches DB getUserActiveSubscription), not server-local calendar
      // midnight — avoids wrong active/expired on UTC hosts vs Mountain display.
      endDateOk = ed.getTime() > Date.now();
    }
  }

  const dbTierOneFree = isDbTierOneFreeTier(subscription);

  // Canonical app trial flag used by all app UI sections.
  // Includes Stripe trialing, incomplete checkout, AND database-only Tier One (gym / first-load free window).
  const appTrialActive =
    trialActive === true ||
    (dbActive &&
      endDateOk &&
      !neverExpires &&
      (stripeStatusForUi === 'trialing' ||
        stripeStatusRaw === 'trialing' ||
        stripeStatusRaw === 'incomplete')) ||
    (dbActive && endDateOk && !neverExpires && dbTierOneFree);

  // Final safety: incomplete attempt during trial should never surface attempted paid tier.
  if ((stripeStatusRaw === 'incomplete' || stripeStatusRaw === 'incomplete_expired') && appTrialActive) {
    effectiveTier = stripeCurrentTier || 'tier_one';
  }

  const isTrialingStripe =
    stripeStatusRaw === 'trialing' ||
    stripeStatusForUi === 'trialing' ||
    appTrialActive === true;

  // Server-owned: only show yellow banner when we are sure they need a card (not trial, no PM anywhere we trust, paid Stripe sub)
  const appPaymentBanner =
    role === 'user' &&
    dbActive &&
    endDateOk &&
    !!subscription.stripe_subscription_id &&
    !hasPaymentMethod &&
    !isTrialingStripe &&
    stripeEnrichmentOk;

  let appStatusDisplay = 'Inactive';
  let appStatusClass = 'status-inactive';
  if (appTrialActive) {
    appStatusDisplay = 'Free Trial';
    appStatusClass = 'status-active';
  } else if (stripeStatusForUi === 'active' || subscription.status === 'active') {
    appStatusDisplay = 'Active';
    appStatusClass = 'status-active';
  } else if (stripeStatusForUi === 'past_due' || stripeStatusForUi === 'unpaid') {
    appStatusDisplay = 'Overdue';
    appStatusClass = 'status-overdue';
  } else if (stripeStatusForUi === 'canceled' || subscription.status === 'canceled') {
    appStatusDisplay = subscription.canceled_by_user_at ? 'Canceled' : 'Expired';
    appStatusClass = subscription.canceled_by_user_at ? 'status-canceled' : 'status-inactive';
  } else if (stripeStatusForUi) {
    appStatusDisplay =
      stripeStatusForUi.charAt(0).toUpperCase() + stripeStatusForUi.slice(1).toLowerCase().replace(/_/g, ' ');
    appStatusClass = appStatusDisplay === 'Incomplete' ? 'status-inactive' : 'status-active';
  }

  let displayEndDate = subscription.end_date;
  if (appTrialActive && trialEndsAtIso) {
    // Always use Stripe trial_end for display when in trial UX (DB can be early, late, or missing).
    displayEndDate = trialEndsAtIso;
    const dbEndMs = subscription.end_date ? new Date(subscription.end_date).getTime() : NaN;
    const trialMs = new Date(trialEndsAtIso).getTime();
    if (
      subscription.id &&
      !Number.isNaN(trialMs) &&
      (Number.isNaN(dbEndMs) || Math.abs(dbEndMs - trialMs) > 60 * 60 * 1000)
    ) {
      db.updateSubscription(subscription.id, { end_date: trialEndsAtIso }).catch((err) =>
        console.warn('[subscription-client-payload] heal end_date from trial_end failed:', err.message)
      );
    }
  } else if (stripeCurrentPeriodEndIso) {
    // Stripe is source of truth for billing-period end (fixes legacy DB rows from sync that added +30 days).
    displayEndDate = stripeCurrentPeriodEndIso;
    const dbEndMs = subscription.end_date ? new Date(subscription.end_date).getTime() : NaN;
    const stripeEndMs = new Date(stripeCurrentPeriodEndIso).getTime();
    if (
      subscription.id &&
      !Number.isNaN(dbEndMs) &&
      !Number.isNaN(stripeEndMs) &&
      Math.abs(dbEndMs - stripeEndMs) > 60 * 60 * 1000
    ) {
      db.updateSubscription(subscription.id, { end_date: stripeCurrentPeriodEndIso }).catch((err) =>
        console.warn('[subscription-client-payload] heal end_date from Stripe failed:', err.message)
      );
    }
  }

  // Admins and testers get full app access (Tier Four) regardless of legacy/test subscription rows.
  if (role === 'admin' || role === 'tester') {
    effectiveTier = 'tier_four';
  }

  return {
    id: subscription.id,
    tier: effectiveTier,
    status: subscription.status,
    start_date: subscription.start_date,
    end_date: displayEndDate,
    stripe_subscription_id: subscription.stripe_subscription_id || null,
    trial_ends_at: trialEndsAtIso,
    trial_active: appTrialActive,
    stripe_status: stripeStatusForUi,
    stripe_status_raw: stripeStatusRaw,
    app_status_display: appStatusDisplay,
    app_status_class: appStatusClass,
    canceled_by_user_at: subscription.canceled_by_user_at || null,
    has_payment_method: hasPaymentMethod,
    payment_method_id: subscription.payment_method_id || null,
    payment_method_expires_at: subscription.payment_method_expires_at || null,
    payment_failure_count: subscription.payment_failure_count || 0,
    last_payment_failure_at: subscription.last_payment_failure_at || null,
    grace_period_ends_at: subscription.grace_period_ends_at || null,
    app_payment_banner: appPaymentBanner,
    app_show_trial_message: appTrialActive
  };
}

module.exports = { buildSubscriptionClientPayload };
