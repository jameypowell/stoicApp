#!/usr/bin/env node
/**
 * Inspect a Stripe PaymentIntent for troubleshooting.
 * Run in production container (or with production .env) to use live key:
 *   node scripts/inspect-payment-intent.js pi_3T6scXF0CLysN1jA0z1eEuEN
 */
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const piId = process.argv[2] || 'pi_3T6scXF0CLysN1jA0z1eEuEN';

async function main() {
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is not set');
    process.exit(1);
  }
  const keyPreview = process.env.STRIPE_SECRET_KEY.slice(0, 12) + '...';
  console.log('Using Stripe key:', keyPreview, process.env.STRIPE_SECRET_KEY.startsWith('sk_live') ? '(LIVE)' : '(TEST)');
  console.log('');

  try {
    const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['payment_method', 'latest_charge'] });
    console.log('PaymentIntent:', pi.id);
    console.log('  status:', pi.status);
    console.log('  amount:', pi.amount, pi.currency?.toUpperCase(), '=', `$${(pi.amount / 100).toFixed(2)}`);
    console.log('  created:', new Date(pi.created * 1000).toISOString());
    console.log('  metadata:', JSON.stringify(pi.metadata || {}, null, 2));
    if (pi.last_payment_error) {
      console.log('  last_payment_error:', pi.last_payment_error.code, pi.last_payment_error.message);
    }
    if (pi.payment_method) {
      const pm = typeof pi.payment_method === 'object' ? pi.payment_method : null;
      if (pm && pm.card) {
        console.log('  card:', pm.card.brand, '****', pm.card.last4, 'exp', pm.card.exp_month + '/' + pm.card.exp_year);
      }
    }
    if (pi.latest_charge) {
      const ch = typeof pi.latest_charge === 'object' ? pi.latest_charge : null;
      if (ch) {
        console.log('  latest_charge:', ch.id, 'status:', ch.status);
        if (ch.failure_message) console.log('  charge failure_message:', ch.failure_message);
      }
    }
  } catch (err) {
    console.error('Error:', err.message);
    if (err.type === 'StripeInvalidRequestError') {
      console.error('  (Wrong key type or PI not found for this account)');
    }
    process.exit(1);
  }
}

main();
