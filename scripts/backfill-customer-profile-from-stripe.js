#!/usr/bin/env node
/**
 * Backfill customer_profiles from Stripe customer data (name + address).
 * Use when signup didn't persist to customer_profiles but Stripe has the data.
 *
 * Usage: node scripts/backfill-customer-profile-from-stripe.js
 * Or with list: node scripts/backfill-customer-profile-from-stripe.js "Haze Hadley" "Jake Fotu"
 *
 * Requires: DB_* and STRIPE_SECRET_KEY (e.g. from .env or ECS task env)
 */

require('dotenv').config();
const path = require('path');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['Haze Hadley', 'Jake Fotu'];

async function main() {
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log('\nBackfill customer_profiles from Stripe for:', TARGETS.join(', '));
  console.log('');

  for (const target of TARGETS) {
    const isEmail = target.includes('@');
    const user = await db.queryOne(
      db.isPostgres
        ? isEmail
          ? 'SELECT * FROM users WHERE email = $1'
          : "SELECT * FROM users WHERE name ILIKE $1 OR name = $2"
        : isEmail
          ? 'SELECT * FROM users WHERE email = ?'
          : "SELECT * FROM users WHERE name LIKE ? OR name = ?",
      isEmail ? [target] : [target.trim(), target.trim()]
    );

    if (!user) {
      console.log(`Skip "${target}": user not found`);
      continue;
    }

    if (!user.stripe_customer_id) {
      const gm = await db.queryOne(
        db.isPostgres
          ? 'SELECT stripe_customer_id FROM gym_memberships WHERE user_id = $1 AND stripe_customer_id IS NOT NULL LIMIT 1'
          : 'SELECT stripe_customer_id FROM gym_memberships WHERE user_id = ? AND stripe_customer_id IS NOT NULL LIMIT 1',
        [user.id]
      );
      if (gm && gm.stripe_customer_id) user.stripe_customer_id = gm.stripe_customer_id;
    }

    if (!user.stripe_customer_id) {
      console.log(`Skip "${user.name}" (${user.email}): no stripe_customer_id on user or gym_membership`);
      continue;
    }

    let customer;
    try {
      customer = await stripe.customers.retrieve(user.stripe_customer_id);
    } catch (e) {
      console.log(`Skip "${user.name}": Stripe error ${e.message}`);
      continue;
    }

    const meta = customer.metadata || {};
    const firstName = meta.firstName || (customer.name && customer.name.split(' ')[0]) || null;
    const lastName = meta.lastName || (customer.name && customer.name.split(' ').slice(1).join(' ')) || null;
    const addr = customer.address || {};
    const address = {
      street: addr.line1 || meta.address_street || null,
      city: addr.city || meta.address_city || null,
      state: addr.state || meta.address_state || null,
      zip: addr.postal_code || meta.address_zip || null
    };

    try {
      await db.upsertCustomerProfile(user.id, { firstName, lastName }, address, {});
      console.log(`OK "${user.name}" (${user.email}): backfilled first_name, last_name, address from Stripe`);
    } catch (err) {
      console.log(`Error "${user.name}": ${err.message}`);
    }
  }

  console.log('\nDone.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
