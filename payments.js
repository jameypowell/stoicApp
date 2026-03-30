// Stripe payment integration
const Stripe = require('stripe');

// Initialize Stripe with secret key - log if missing for debugging
const stripeSecretKey = process.env.STRIPE_SECRET_KEY || '';
if (!stripeSecretKey) {
  console.error('⚠️ WARNING: STRIPE_SECRET_KEY environment variable is not set!');
}
const stripe = new Stripe(stripeSecretKey);

// Subscription tier pricing (in cents)
const TIER_PRICING = {
  tier_one: 0,      // FREE
  tier_two: 700,   // $7.00/month
  tier_three: 1200, // $12.00/month
  tier_four: 1800   // $18.00/month
};

// Import tier access configuration
const { normalizeTier: normalizeTierFromConfig, hasAccessToDate: hasAccessToDateFromConfig } = require('./tier-access-config');

// Normalize tier names: map legacy names (daily/weekly/monthly) to new names (tier_two/tier_three/tier_four)
// This ensures backward compatibility with existing subscriptions
// Now uses centralized config
function normalizeTier(tier) {
  return normalizeTierFromConfig(tier);
}

// Denormalize tier names: convert new names (tier_one/tier_two/tier_three/tier_four) back to legacy names (daily/weekly/monthly)
// This is optional now since the database schema supports both, but kept for consistency
// Note: tier_one has no legacy equivalent, so it's stored as-is
function denormalizeTier(tier) {
  if (!tier) return tier;
  const reverseMap = {
    'tier_two': 'daily',
    'tier_three': 'weekly',
    'tier_four': 'monthly'
    // tier_one has no legacy equivalent - stored as 'tier_one' in database
  };
  return reverseMap[tier] || tier;
}

// Calculate pro-rated price for a tier based on remaining days
function calculateProratedPrice(tier, remainingDays) {
  const normalizedTier = normalizeTier(tier);
  const fullPrice = TIER_PRICING[normalizedTier] || 0;
  const dailyPrice = fullPrice / 30; // Price per day
  return Math.round(dailyPrice * remainingDays); // Round to nearest cent
}

// Calculate upgrade price using pro-rated pricing (industry standard)
// subscription: current subscription object with start_date, end_date, tier
// targetTier: tier to upgrade to
function calculateUpgradePrice(subscription, targetTier) {
  if (!subscription || !subscription.end_date || !subscription.tier) {
    // If no subscription info, fall back to simple difference
    const currentPrice = TIER_PRICING[subscription?.tier || ''] || 0;
    const targetPrice = TIER_PRICING[targetTier] || 0;
    return Math.max(0, targetPrice - currentPrice);
  }

  // Calculate remaining days on current subscription
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  
  // Handle both Date objects and strings for end_date
  let expirationDate;
  if (subscription.end_date instanceof Date) {
    expirationDate = new Date(subscription.end_date);
  } else if (typeof subscription.end_date === 'string') {
    const dateStr = subscription.end_date.split('T')[0].split(' ')[0];
    expirationDate = new Date(dateStr + 'T00:00:00');
  } else {
    expirationDate = new Date(subscription.end_date);
  }
  expirationDate.setHours(0, 0, 0, 0);
  
  // Calculate remaining days
  const timeDiff = expirationDate - today;
  const remainingDays = Math.ceil(timeDiff / (1000 * 60 * 60 * 24));
  
  // If subscription has already expired or has no remaining days, charge full price
  if (remainingDays <= 0) {
    return TIER_PRICING[targetTier] || 0;
  }
  
  // Pro-rate both tiers for remaining days
  const normalizedCurrentTier = normalizeTier(subscription.tier);
  const normalizedTargetTier = normalizeTier(targetTier);
  const currentProratedPrice = calculateProratedPrice(normalizedCurrentTier, remainingDays);
  const targetProratedPrice = calculateProratedPrice(normalizedTargetTier, remainingDays);
  
  // Upgrade price is the difference between pro-rated prices
  const upgradePrice = targetProratedPrice - currentProratedPrice;
  
  // Return 0 if upgrade price would be negative (shouldn't happen, but safety check)
  return Math.max(0, upgradePrice);
}

// Legacy function for backward compatibility (simple difference)
function calculateUpgradePriceSimple(currentTier, targetTier) {
  const currentPrice = TIER_PRICING[currentTier] || 0;
  const targetPrice = TIER_PRICING[targetTier] || 0;
  const upgradePrice = targetPrice - currentPrice;
  return Math.max(0, upgradePrice);
}

// Get available upgrade tiers for a current tier
// Only returns the next tier up (not all possible upgrades)
function getAvailableUpgrades(currentTier) {
  const upgrades = [];
  const normalizedTier = normalizeTier(currentTier);
  
  switch (normalizedTier) {
    case 'tier_one':
      // Tier One can upgrade to Tier Two
      upgrades.push('tier_two');
      break;
    case 'tier_two':
      // Tier Two can upgrade to Tier Three
      upgrades.push('tier_three');
      break;
    case 'tier_three':
      // Tier Three can upgrade to Tier Four
      upgrades.push('tier_four');
      break;
    case 'tier_four':
      // No upgrades available
      break;
  }
  
  return upgrades;
}

// Create Stripe customer
async function createCustomer(email) {
  return await stripe.customers.create({
    email: email
  });
}

// Create payment intent for one-time purchase
// For hybrid system: includes setup_future_usage to save payment method for automatic renewals
async function createPaymentIntent(amount, currency, customerId, metadata = {}) {
  return await stripe.paymentIntents.create({
    amount: amount,
    currency: currency || 'usd',
    customer: customerId,
    metadata: metadata,
    automatic_payment_methods: {
      enabled: true,
    },
    setup_future_usage: 'off_session', // Save payment method for future automatic charges (hybrid system)
  });
}

// Retrieve payment intent from Stripe
async function getPaymentIntent(paymentIntentId) {
  return await stripe.paymentIntents.retrieve(paymentIntentId);
}

// Create subscription
// For subscriptions without a payment method, use payment_behavior: 'default_incomplete'
// This creates an incomplete subscription with a payment intent that can be completed via Payment Element
async function createSubscription(customerId, priceId, metadata = {}, paymentBehavior = 'default_incomplete') {
  const subscriptionData = {
    customer: customerId,
    items: [{ price: priceId }],
    metadata: metadata,
    payment_behavior: paymentBehavior,
    expand: ['latest_invoice.payment_intent'], // Expand to get payment intent client secret
  };
  
  return await stripe.subscriptions.create(subscriptionData);
}

// Get subscription
async function getSubscription(subscriptionId) {
  return await stripe.subscriptions.retrieve(subscriptionId);
}

// Update subscription item (for downgrades scheduled for next billing cycle)
// Uses Stripe Subscription Schedules to schedule the change for the next billing cycle
async function updateSubscriptionItem(subscriptionId, newPriceId) {
  // Retrieve the subscription to get the current subscription item
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  
  if (!subscription.items.data || subscription.items.data.length === 0) {
    throw new Error('No subscription items found');
  }
  
  const subscriptionItemId = subscription.items.data[0].id;
  
  // Check if subscription already has a schedule
  const schedules = await stripe.subscriptionSchedules.list({
    subscription: subscriptionId,
    limit: 1
  });
  
  if (schedules.data.length > 0) {
    // Update existing schedule
    const schedule = schedules.data[0];
    const currentPhase = schedule.phases[schedule.phases.length - 1];
    
    // Add a new phase starting at the current period end with the new price
    return await stripe.subscriptionSchedules.update(schedule.id, {
      phases: [
        {
          items: currentPhase.items,
          start_date: currentPhase.start_date,
          end_date: subscription.current_period_end
        },
        {
          items: [{
            price: newPriceId,
            quantity: 1
          }],
          start_date: subscription.current_period_end
        }
      ]
    });
  } else {
    // Create new schedule to change price at period end
    return await stripe.subscriptionSchedules.create({
      customer: subscription.customer,
      start_date: subscription.current_period_end, // Start schedule at end of current period
      end_behavior: 'release', // Release schedule after it completes
      phases: [
        {
          items: [{
            price: newPriceId,
            quantity: 1
          }]
        }
      ]
    });
  }
}

// Update subscription item for upgrades with smart proration handling
// If prorated amount is < $2.00, defers charge to next billing cycle
// If prorated amount is >= $2.00, charges immediately
// Returns: { updated: true, deferred: boolean, proratedAmount: number }
async function updateSubscriptionItemForUpgrade(subscriptionId, newPriceId, proratedAmount) {
  const MINIMUM_IMMEDIATE_CHARGE = 200; // $2.00 in cents
  const STRIPE_MINIMUM_CHARGE = 50; // $0.50 in cents (Stripe's minimum)
  
  // Retrieve the subscription
  const subscription = await stripe.subscriptions.retrieve(subscriptionId);
  
  if (!subscription.items.data || subscription.items.data.length === 0) {
    throw new Error('No subscription items found');
  }
  
  const subscriptionItemId = subscription.items.data[0].id;
  
  // If prorated amount is < $2.00, defer to next billing cycle
  if (proratedAmount < MINIMUM_IMMEDIATE_CHARGE) {
    // Update subscription without proration (change takes effect at period end)
    // Then add the prorated amount as an invoice item for the next billing cycle
    await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscriptionItemId,
        price: newPriceId,
      }],
      proration_behavior: 'none', // Don't charge immediately
      billing_cycle_anchor: 'unchanged' // Keep the same billing cycle
    });
    
    // Add invoice item for the deferred prorated amount on the next invoice
    // This will be included in the next billing cycle's invoice
    await stripe.invoiceItems.create({
      customer: subscription.customer,
      amount: proratedAmount,
      currency: 'usd',
      description: `Prorated upgrade charge (deferred from previous billing cycle)`,
      subscription: subscriptionId
    });
    
    return {
      updated: true,
      deferred: true,
      proratedAmount: proratedAmount,
      message: `Upgrade scheduled. The prorated amount of $${(proratedAmount / 100).toFixed(2)} will be included in your next billing cycle.`
    };
  } else {
    // Charge immediately with proration (default behavior)
    await stripe.subscriptions.update(subscriptionId, {
      items: [{
        id: subscriptionItemId,
        price: newPriceId,
      }],
      proration_behavior: 'create_prorations' // Charge prorated amount immediately
    });
    
    return {
      updated: true,
      deferred: false,
      proratedAmount: proratedAmount,
      message: `Upgrade completed. You were charged $${(proratedAmount / 100).toFixed(2)} for the prorated upgrade.`
    };
  }
}

// Cancel subscription
// By default, cancels at the end of the current billing period so user keeps access until then
async function cancelSubscription(subscriptionId, cancelImmediately = false) {
  if (cancelImmediately) {
    // Cancel immediately (user loses access right away)
  return await stripe.subscriptions.cancel(subscriptionId);
  } else {
    // Cancel at period end (user keeps access until end of billing period)
    return await stripe.subscriptions.update(subscriptionId, {
      cancel_at_period_end: true
    });
  }
}

// Calculate subscription end date based on tier
function calculateEndDate(tier) {
  const now = new Date();
  const endDate = new Date(now);
  
  // All subscriptions are valid for 30 days from purchase
  endDate.setDate(now.getDate() + 30);
  
  return endDate.toISOString();
}

// Check if user has access to a specific date
// Now uses centralized tier access configuration
function hasAccessToDate(subscription, workoutDate) {
  return hasAccessToDateFromConfig(subscription, workoutDate);
}

// Keep parseSubscriptionDate for backward compatibility (used elsewhere)
// Note: This is now also available from tier-access-config.js
function parseSubscriptionDate(dateString) {
  const { parseSubscriptionDate: parseDate } = require('./tier-access-config');
  return parseDate(dateString);
}

module.exports = {
  stripe,
  TIER_PRICING,
  createCustomer,
  createPaymentIntent,
  getPaymentIntent,
  createSubscription,
  getSubscription,
  cancelSubscription,
  calculateEndDate,
  hasAccessToDate,
  calculateUpgradePrice,
  calculateUpgradePriceSimple, // Legacy function
  calculateProratedPrice,
  getAvailableUpgrades,
  normalizeTier,
  denormalizeTier,
  updateSubscriptionItem,
  updateSubscriptionItemForUpgrade
};

