/**
 * Single source of truth for Stripe subscription → tier + member-facing status.
 * Used by /api/subscriptions/me, subscription-sync, and webhooks should stay aligned.
 *
 * Prevents: wrong tier (DB drift vs Stripe price), wrong "Incomplete" during trial, etc.
 */

'use strict';

const { normalizeTier } = require('./payments');

/**
 * Price ID → tier (env overrides production defaults).
 * Keep in sync with subscription-sync / create-free-subscription.
 */
function getPriceIdToTierMap() {
  const daily =
    process.env.STRIPE_PRICE_DAILY ||
    process.env.STRIPE_PRICE_TIER_TWO ||
    'price_1SUwEpF0CLysN1jANPvhIp7s';
  const weekly =
    process.env.STRIPE_PRICE_WEEKLY ||
    process.env.STRIPE_PRICE_TIER_THREE ||
    'price_1SUwG8F0CLysN1jA367NrtiT';
  const monthly =
    process.env.STRIPE_PRICE_MONTHLY ||
    process.env.STRIPE_PRICE_TIER_FOUR ||
    'price_1SUwH8F0CLysN1jAvy1aMz3E';
  const m = {};
  m[daily] = 'tier_two';
  m[weekly] = 'tier_three';
  m[monthly] = 'tier_four';
  return m;
}

/**
 * Tier from Stripe subscription.
 * Price ID wins over subscription metadata (metadata is often stale/wrong after plan changes).
 */
function tierFromStripeSubscription(stripeSub) {
  if (!stripeSub) return null;

  const items = stripeSub.items && stripeSub.items.data;
  if (items && items.length) {
    const price = items[0].price;
    if (price && price.id) {
      const map = getPriceIdToTierMap();
      if (map[price.id]) {
        return normalizeTier(map[price.id]);
      }
      if (price.metadata && price.metadata.tier) {
        const t = normalizeTier(price.metadata.tier);
        if (t) return t;
      }
    }
  }

  if (stripeSub.metadata && stripeSub.metadata.tier) {
    const t = normalizeTier(stripeSub.metadata.tier);
    if (t) return t;
  }

  return null;
}

function latestInvoiceIsPaid(stripeSub) {
  const inv = stripeSub.latest_invoice;
  if (!inv || typeof inv !== 'object') return false;
  return inv.status === 'paid';
}

/**
 * Map Stripe API status → status string for member UI (My Account tiles).
 * Stripe's "incomplete" during an active trial window should not show as "Incomplete".
 *
 * @param {object} options.customerHasPaymentMethod - true if customer has any saved card/PM (from list API)
 * @returns {{ raw: string|null, ui: string|null }}
 */
function resolveStripeStatusForMemberUi(stripeSub, options = {}) {
  const customerHasPaymentMethod = !!options.customerHasPaymentMethod;
  if (!stripeSub || !stripeSub.status) {
    return { raw: null, ui: null };
  }
  const raw = stripeSub.status;
  const now = Math.floor(Date.now() / 1000);
  const trialEnd = stripeSub.trial_end || 0;

  if (raw === 'trialing') return { raw, ui: 'trialing' };
  if (raw === 'active') return { raw, ui: 'active' };
  if (raw === 'past_due') return { raw, ui: 'past_due' };
  if (raw === 'canceled') return { raw, ui: 'canceled' };
  if (raw === 'unpaid') return { raw, ui: 'unpaid' };
  if (raw === 'paused') return { raw, ui: 'paused' };

  if (raw === 'incomplete_expired') {
    return { raw, ui: 'incomplete_expired' };
  }

  // incomplete: common during checkout; if trial is still running, member UX = trialing
  if (raw === 'incomplete' && trialEnd > now) {
    return { raw, ui: 'trialing' };
  }
  // incomplete but invoice already paid (transition / webhook lag)
  if (raw === 'incomplete' && latestInvoiceIsPaid(stripeSub)) {
    return { raw, ui: 'active' };
  }
  // incomplete but customer has a saved payment method (card on file, not always default on subscription)
  if (raw === 'incomplete' && customerHasPaymentMethod) {
    if (trialEnd > now) return { raw, ui: 'trialing' };
    return { raw, ui: 'active' };
  }
  // incomplete with PM on file and trial still active (some Stripe flows)
  if (raw === 'incomplete' && stripeSub.default_payment_method && trialEnd > now) {
    return { raw, ui: 'trialing' };
  }
  // incomplete with default_payment_method set: often post-checkout, transitioning to active/trialing
  if (raw === 'incomplete' && stripeSub.default_payment_method) {
    if (trialEnd > now) return { raw, ui: 'trialing' };
    return { raw, ui: 'active' };
  }

  return { raw, ui: raw };
}

module.exports = {
  getPriceIdToTierMap,
  tierFromStripeSubscription,
  resolveStripeStatusForMemberUi
};
