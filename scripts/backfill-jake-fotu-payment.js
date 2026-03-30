#!/usr/bin/env node
/**
 * Backfill Jake Fotu's overdue payment into the payments table.
 * Run: DB_PASSWORD=<pass> node scripts/backfill-jake-fotu-payment.js
 */

require('dotenv').config();
const path = require('path');

process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
process.env.DB_USER = process.env.DB_USER || 'stoicapp';
process.env.DB_NAME = process.env.DB_NAME || 'postgres';

const Stripe = require('stripe');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));

const JAKE_EMAIL = 'fotujacob@gmail.com';

async function main() {
  if (!process.env.DB_PASSWORD || !process.env.STRIPE_SECRET_KEY) {
    console.error('Need DB_PASSWORD and STRIPE_SECRET_KEY');
    process.exit(1);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  const user = await db.queryOne(
    db.isPostgres ? 'SELECT * FROM users WHERE email = $1' : 'SELECT * FROM users WHERE email = ?',
    [JAKE_EMAIL]
  );
  if (!user) {
    console.error('User not found:', JAKE_EMAIL);
    process.exit(1);
  }

  const membership = await db.queryOne(
    db.isPostgres
      ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
      : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [user.id]
  );
  if (!membership?.stripe_subscription_id) {
    console.error('No gym membership or subscription ID');
    process.exit(1);
  }

  const sub = await stripe.subscriptions.retrieve(membership.stripe_subscription_id, {
    expand: ['latest_invoice']
  });
  const inv = sub.latest_invoice;
  if (!inv) {
    console.error('No latest invoice');
    process.exit(1);
  }
  const invoice = typeof inv === 'string' ? await stripe.invoices.retrieve(inv) : inv;
  if (invoice.status !== 'paid' || !invoice.payment_intent) {
    console.error('Latest invoice not paid or has no payment_intent');
    process.exit(1);
  }

  const piId = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent.id;
  const amountCents = invoice.amount_paid || 0;
  const currency = invoice.currency || 'usd';

  const existing = await db.queryOne(
    db.isPostgres
      ? 'SELECT id FROM payments WHERE stripe_payment_intent_id = $1'
      : 'SELECT id FROM payments WHERE stripe_payment_intent_id = ?',
    [piId]
  );
  if (existing) {
    console.log('Payment already recorded:', piId);
    process.exit(0);
  }

  await db.createPayment(user.id, piId, amountCents, currency, 'gym_membership', 'succeeded', user.email);
  console.log('Recorded payment: $' + (amountCents / 100).toFixed(2), currency, '|', piId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
