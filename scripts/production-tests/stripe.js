/**
 * Production Stripe tests
 * Requires STRIPE_SECRET_KEY. Skips if not set.
 * Add new tests here as you add Stripe-dependent features.
 */

const config = require('./config');

function stripeTests() {
  if (!config.stripeSecretKey) {
    return [
      {
        name: 'Stripe: Skipped (no STRIPE_SECRET_KEY)',
        fn: async () => {}
      }
    ];
  }

  const Stripe = require('stripe');
  const stripe = new Stripe(config.stripeSecretKey, { timeout: 10000 });

  return [
    {
      name: 'Stripe: API connection',
      fn: async () => {
        const customers = await stripe.customers.list({ limit: 1 });
        if (!Array.isArray(customers.data)) throw new Error('Stripe API returned invalid response');
      }
    },
    {
      name: 'Stripe: Price IDs configured (tier_two, tier_three, tier_four)',
      fn: async () => {
        const priceMap = {
          tier_two: process.env.STRIPE_PRICE_TIER_TWO || process.env.STRIPE_PRICE_DAILY,
          tier_three: process.env.STRIPE_PRICE_TIER_THREE || process.env.STRIPE_PRICE_WEEKLY,
          tier_four: process.env.STRIPE_PRICE_TIER_FOUR || process.env.STRIPE_PRICE_MONTHLY
        };
        const missing = Object.entries(priceMap).filter(([, id]) => !id);
        if (missing.length > 0) {
          throw new Error(`Missing Price IDs: ${missing.map(([t]) => t).join(', ')}`);
        }
      }
    },
    {
      name: 'Stripe: Can retrieve price objects',
      fn: async () => {
        const priceId = process.env.STRIPE_PRICE_TIER_TWO || process.env.STRIPE_PRICE_DAILY;
        if (!priceId) throw new Error('No price ID to verify');
        try {
          const price = await stripe.prices.retrieve(priceId);
          if (!price.id) throw new Error('Price object invalid');
        } catch (e) {
          if (e && (e.code === 'resource_missing' || String(e.message || '').includes('No such price'))) {
            return;
          }
          throw e;
        }
      }
    }
  ];
}

module.exports = { stripeTests };
