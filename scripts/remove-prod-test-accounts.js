#!/usr/bin/env node
/**
 * Remove all prod-test accounts from the database and Stripe
 *
 * Matches users with email LIKE 'prod-test%@example.com'
 *
 * Requires:
 *   DB_HOST, DB_USER, DB_PASSWORD (production PostgreSQL)
 *   STRIPE_SECRET_KEY (production)
 *
 * Usage:
 *   node scripts/remove-prod-test-accounts.js           # dry run
 *   node scripts/remove-prod-test-accounts.js --execute # actually delete
 */

require('dotenv').config();
const { Client } = require('pg');
const Stripe = require('stripe');

const EXECUTE = process.argv.includes('--execute');
const EMAIL_PATTERN = 'prod-test%@example.com';

if (!EXECUTE) {
  console.log('DRY RUN – no changes will be made. Use --execute to delete.\n');
}

function checkEnv() {
  const missing = [];
  if (!process.env.DB_PASSWORD) missing.push('DB_PASSWORD');
  if (!process.env.STRIPE_SECRET_KEY) missing.push('STRIPE_SECRET_KEY');
  if (missing.length) {
    console.error('Missing env:', missing.join(', '));
    process.exit(1);
  }
  const key = process.env.STRIPE_SECRET_KEY;
  if (key.startsWith('sk_test_')) {
    console.error('STRIPE_SECRET_KEY appears to be test key. Use production key for prod cleanup.');
    process.exit(1);
  }
}

async function main() {
  checkEnv();

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const client = new Client({
    host: process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com',
    port: process.env.DB_PORT || 5432,
    user: process.env.DB_USER || 'stoicapp',
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'postgres',
    ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
  });

  try {
    await client.connect();
    console.log('Connected to database:', process.env.DB_HOST);
    console.log('');

    // Find prod-test users (ILIKE for case-insensitive, % = any chars)
    const usersRes = await client.query(
      `SELECT id, email, stripe_customer_id FROM users WHERE email ILIKE $1`,
      [EMAIL_PATTERN]
    );
    const users = usersRes.rows;

    if (users.length === 0) {
      console.log('No prod-test users found.');
      return;
    }

    console.log(`Found ${users.length} prod-test user(s):`);
    users.forEach((u) => console.log(`  - ${u.email} (id=${u.id}, stripe=${u.stripe_customer_id || 'none'})`));
    console.log('');

    // Collect all Stripe customer IDs
    const stripeCustomerIds = new Set();
    for (const u of users) {
      if (u.stripe_customer_id) stripeCustomerIds.add(u.stripe_customer_id);
    }
    // Also from subscriptions and gym_memberships
    for (const u of users) {
      const subRes = await client.query(
        'SELECT stripe_customer_id FROM subscriptions WHERE user_id = $1 AND stripe_customer_id IS NOT NULL',
        [u.id]
      );
      subRes.rows.forEach((r) => stripeCustomerIds.add(r.stripe_customer_id));
      const gmRes = await client.query(
        'SELECT stripe_customer_id FROM gym_memberships WHERE user_id = $1 AND stripe_customer_id IS NOT NULL',
        [u.id]
      );
      gmRes.rows.forEach((r) => stripeCustomerIds.add(r.stripe_customer_id));
    }

    console.log(`Stripe customers to delete: ${stripeCustomerIds.size}`);
    stripeCustomerIds.forEach((id) => console.log(`  - ${id}`));
    console.log('');

    if (!EXECUTE) {
      console.log('DRY RUN – would delete', users.length, 'user(s) and', stripeCustomerIds.size, 'Stripe customer(s).');
      return;
    }

    // 1. Delete users (CASCADE removes subscriptions, gym_memberships, payments, etc.)
    for (const u of users) {
      await client.query('DELETE FROM users WHERE id = $1', [u.id]);
      console.log('Deleted user:', u.email);
    }

    // 2. Delete Stripe customers
    for (const cusId of stripeCustomerIds) {
      try {
        await stripe.customers.del(cusId);
        console.log('Deleted Stripe customer:', cusId);
      } catch (err) {
        if (err.code === 'resource_missing_no_such_customer') {
          console.log('Stripe customer already gone:', cusId);
        } else {
          console.error('Stripe delete failed:', cusId, err.message);
        }
      }
    }

    console.log('');
    console.log('Done. Removed', users.length, 'user(s) and', stripeCustomerIds.size, 'Stripe customer(s).');
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
