#!/usr/bin/env node
/**
 * Show all data we have for Haze Hadley (users, gym_memberships, customer_profiles, payments, Stripe).
 * Run with production env: USE_POSTGRES=1 DB_HOST=... DB_PASSWORD=... STRIPE_SECRET_KEY=... node scripts/show-haze-hadley-data.js
 */

require('dotenv').config();
const path = require('path');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));

async function main() {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log('\n=== Looking up Haze Hadley ===\n');

  // Find user by name or email containing Haze or Hadley
  let user = await db.queryOne(
    db.isPostgres
      ? "SELECT * FROM users WHERE name ILIKE '%Haze%' OR name ILIKE '%Hadley%' OR email ILIKE '%haze%' OR email ILIKE '%hadley%' ORDER BY created_at DESC LIMIT 1"
      : "SELECT * FROM users WHERE name LIKE '%Haze%' OR name LIKE '%Hadley%' OR email LIKE '%haze%' OR email LIKE '%hadley%' ORDER BY created_at DESC LIMIT 1"
  );
  if (!user) {
    console.log('No user found matching "Haze" or "Hadley".');
    process.exit(1);
  }

  console.log('--- USERS ---');
  console.log(JSON.stringify({
    id: user.id,
    email: user.email,
    name: user.name,
    role: user.role,
    stripe_customer_id: user.stripe_customer_id,
    created_at: user.created_at
  }, null, 2));
  console.log('');

  const userId = user.id;

  const profile = await db.queryOne(
    db.isPostgres ? 'SELECT * FROM customer_profiles WHERE user_id = $1' : 'SELECT * FROM customer_profiles WHERE user_id = ?',
    [userId]
  );
  console.log('--- CUSTOMER_PROFILES (signup details) ---');
  if (!profile) {
    console.log('(no row – phone, address, DOB, emergency contact not stored for this user)');
  } else {
    console.log(JSON.stringify({
      user_id: profile.user_id,
      first_name: profile.first_name,
      last_name: profile.last_name,
      date_of_birth: profile.date_of_birth,
      gender: profile.gender,
      phone: profile.phone,
      street: profile.street,
      city: profile.city,
      state: profile.state,
      zip: profile.zip,
      emergency_contact_name: profile.emergency_contact_name,
      emergency_contact_phone: profile.emergency_contact_phone,
      created_at: profile.created_at,
      updated_at: profile.updated_at
    }, null, 2));
  }
  console.log('');

  const membership = await db.queryOne(
    db.isPostgres ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1' : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [userId]
  );
  console.log('--- GYM_MEMBERSHIPS ---');
  if (!membership) {
    console.log('(no row)');
  } else {
    console.log(JSON.stringify({
      id: membership.id,
      user_id: membership.user_id,
      membership_type: membership.membership_type,
      household_id: membership.household_id,
      status: membership.status,
      contract_start_date: membership.contract_start_date,
      contract_end_date: membership.contract_end_date,
      stripe_customer_id: membership.stripe_customer_id,
      stripe_subscription_id: membership.stripe_subscription_id,
      created_at: membership.created_at
    }, null, 2));
  }
  console.log('');

  const payments = await db.query(
    db.isPostgres
      ? "SELECT id, amount, currency, tier, status, stripe_payment_intent_id, created_at FROM payments WHERE user_id = $1 AND tier IN ('gym_membership', 'gym_membership_late_fee') ORDER BY created_at DESC LIMIT 10"
      : "SELECT id, amount, currency, tier, status, stripe_payment_intent_id, created_at FROM payments WHERE user_id = ? AND tier IN ('gym_membership', 'gym_membership_late_fee') ORDER BY created_at DESC LIMIT 10",
    [userId]
  );
  const payRows = db.isPostgres ? (payments.rows || []) : (payments.rows || []);
  console.log('--- PAYMENTS (gym_membership) ---');
  if (payRows.length === 0) {
    console.log('(no rows)');
  } else {
    payRows.forEach((p, i) => console.log(JSON.stringify({ ...p, amount_cents: p.amount }, null, 2)));
  }
  console.log('');

  if (user.stripe_customer_id && process.env.STRIPE_SECRET_KEY) {
    try {
      const Stripe = require('stripe');
      const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
      const customer = await stripe.customers.retrieve(user.stripe_customer_id);
      console.log('--- STRIPE CUSTOMER ---');
      console.log(JSON.stringify({
        id: customer.id,
        email: customer.email,
        name: customer.name,
        address: customer.address,
        metadata: customer.metadata
      }, null, 2));
    } catch (e) {
      console.log('--- STRIPE CUSTOMER ---');
      console.log('(error:', e.message + ')');
    }
  } else {
    console.log('--- STRIPE CUSTOMER ---');
    console.log('(no stripe_customer_id or STRIPE_SECRET_KEY – skip)');
  }

  console.log('\n=== End ===\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
