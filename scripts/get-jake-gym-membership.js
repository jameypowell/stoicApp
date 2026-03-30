#!/usr/bin/env node
/**
 * Fetch Jake Fotu's gym membership from production (Stripe + DB).
 * Run from production server: node /app/scripts/get-jake-gym-membership.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const Stripe = require('stripe');
const { initDatabase, Database } = require('../database');

const JAKE_EMAIL = 'fotujacob@gmail.com';
const GYM_SUB_ID = 'sub_1StAIqF0CLysN1jANYCAoNcU';

async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log('\nJake Fotu (fotujacob@gmail.com) - Gym Membership');
  console.log('================================================\n');

  // Get user and gym membership from DB
  const user = await db.queryOne(
    db.isPostgres ? 'SELECT * FROM users WHERE email = $1' : 'SELECT * FROM users WHERE email = ?',
    [JAKE_EMAIL]
  );
  if (!user) {
    console.log('User not found in database.');
    process.exit(1);
  }

  const membership = await db.queryOne(
    db.isPostgres ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1' : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [user.id]
  );
  if (!membership) {
    console.log('No gym membership found in database.');
  } else {
    console.log('Database:');
    console.log('  Status:', membership.status);
    console.log('  Type:', membership.membership_type);
    console.log('  Contract start:', membership.contract_start_date || 'N/A');
    console.log('  Contract end:', membership.contract_end_date || 'N/A');
  }

  // Get Stripe subscription
  try {
    const sub = await stripe.subscriptions.retrieve(GYM_SUB_ID, {
      expand: ['default_payment_method', 'customer']
    });
    const periodEnd = new Date(sub.current_period_end * 1000);
    const periodStart = new Date(sub.current_period_start * 1000);
    let pm = sub.default_payment_method;
    if (typeof pm === 'string') pm = await stripe.paymentMethods.retrieve(pm);
    const pmInfo = pm?.card
      ? `${pm.card.brand} ****${pm.card.last4} (exp ${pm.card.exp_month}/${pm.card.exp_year})`
      : 'none';

    console.log('\nStripe:');
    console.log('  Status:', sub.status);
    console.log('  Current period:', periodStart.toLocaleDateString(), '-', periodEnd.toLocaleDateString());
    console.log('  Next charge date:', periodEnd.toLocaleDateString());
    console.log('  Payment method:', pmInfo);
    console.log('  How charged: Stripe will charge the default payment method on the subscription');
  } catch (e) {
    console.log('\nStripe error:', e.message);
  }

  console.log('');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
