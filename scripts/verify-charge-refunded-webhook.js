#!/usr/bin/env node
/**
 * Read-only: list Stripe webhook endpoints and confirm charge.refunded is enabled.
 * Uses STRIPE_SECRET_KEY from the environment (.env via dotenv).
 *
 *   node scripts/verify-charge-refunded-webhook.js
 */

'use strict';

require('dotenv').config();
const sk = process.env.STRIPE_SECRET_KEY;
if (!sk || !String(sk).trim()) {
  console.error('Missing STRIPE_SECRET_KEY (set in .env or environment).');
  process.exit(1);
}

const stripe = require('stripe')(sk);

function listensToRefunds(events) {
  if (!events || !events.length) return false;
  if (events.includes('*')) return true;
  return events.includes('charge.refunded');
}

async function main() {
  const endpoints = await stripe.webhookEndpoints.list({ limit: 100 });
  if (!endpoints.data.length) {
    console.log('No webhook endpoints found for this Stripe account (check test vs live key).');
    process.exit(2);
  }

  let anyRefund = false;
  for (const ep of endpoints.data) {
    const mode = ep.livemode ? 'live' : 'test';
    const ok = listensToRefunds(ep.enabled_events);
    if (ok) anyRefund = true;
    console.log(`${ok ? '✅' : '❌'} [${mode}] ${ep.url}`);
    console.log(`   id=${ep.id}  charge.refunded: ${ok ? 'enabled' : 'NOT in enabled_events'}`);
    if (!ok && ep.enabled_events && ep.enabled_events.length <= 30) {
      console.log(`   enabled_events (${ep.enabled_events.length}): ${ep.enabled_events.join(', ')}`);
    }
  }

  if (!anyRefund) {
    console.error('\nNone of the listed endpoints include charge.refunded (or *).');
    process.exit(3);
  }
  console.log('\nAt least one endpoint listens for charge.refunded.');
  process.exit(0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
