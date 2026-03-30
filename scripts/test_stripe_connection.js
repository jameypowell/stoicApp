#!/usr/bin/env node
/**
 * Test Stripe API connection using STRIPE_SECRET_KEY from the environment.
 * Used by run_test_stripe_on_prod.sh to verify Stripe from the production container.
 *
 * Usage: node scripts/test_stripe_connection.js
 */

const stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey || stripeKey.trim() === '') {
  console.error('STRIPE_SECRET_KEY is not set');
  process.exit(1);
}

const stripe = require('stripe')(stripeKey);

async function test() {
  try {
    const balance = await stripe.balance.retrieve();
    console.log('Stripe connection OK');
    console.log('Balance (available):', balance.available?.map(b => `${b.amount / 100} ${b.currency}`).join(', ') || 'N/A');
    console.log('Balance (pending):', balance.pending?.map(b => `${b.amount / 100} ${b.currency}`).join(', ') || 'N/A');
    process.exit(0);
  } catch (err) {
    console.error('Stripe connection failed:', err.message);
    if (err.type) console.error('Type:', err.type);
    process.exit(1);
  }
}

test();
