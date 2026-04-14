#!/usr/bin/env node
/**
 * One-off: load user + gym_memberships + recent gym payments + Stripe subs.
 * Usage: node scripts/audit-gym-member-billing.js <search substring>
 */
require('dotenv').config();
const { Client } = require('pg');
const Stripe = require('stripe');

const search = (process.argv[2] || '').trim();
if (!search) {
  console.error('Usage: node scripts/audit-gym-member-billing.js <name-or-email-substring>');
  process.exit(1);
}

async function main() {
  if (!process.env.DB_HOST) {
    console.error('DB_HOST not set (need Postgres production env).');
    process.exit(1);
  }
  const c = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });
  await c.connect();
  const like = `%${search}%`;
  const { rows: members } = await c.query(
    `SELECT u.id AS user_id, u.email, u.name, u.stripe_customer_id AS user_stripe_customer,
            gm.id AS gym_membership_id, gm.membership_type, gm.status AS gym_status,
            gm.contract_start_date, gm.contract_end_date, gm.stripe_customer_id AS gym_stripe_customer,
            gm.stripe_subscription_id, gm.is_primary_member, gm.family_group_id,
            gm.monthly_amount_cents, (gm.payment_method_id IS NOT NULL) AS has_payment_method
     FROM users u
     JOIN gym_memberships gm ON gm.user_id = u.id
     WHERE u.name ILIKE $1 OR u.email ILIKE $1
     ORDER BY gm.id`,
    [like]
  );
  if (!members.length) {
    console.log('No gym_memberships rows matched:', search);
    await c.end();
    return;
  }
  const userId = members[0].user_id;
  const { rows: payments } = await c.query(
    `SELECT id, stripe_payment_intent_id, amount, currency, tier, status, created_at
     FROM payments
     WHERE user_id = $1 AND tier IN ('gym_membership', 'gym_membership_late_fee')
     ORDER BY created_at DESC
     LIMIT 25`,
    [userId]
  );
  await c.end();

  console.log(JSON.stringify({ memberships: members, recentGymPayments: payments }, null, 2));

  const stripeKey = process.env.STRIPE_SECRET_KEY;
  if (!stripeKey) {
    console.log('(No STRIPE_SECRET_KEY — skipping Stripe API.)');
    return;
  }
  const stripe = new Stripe(stripeKey);
  const custIds = new Set();
  for (const m of members) {
    if (m.gym_stripe_customer) custIds.add(m.gym_stripe_customer);
    if (m.user_stripe_customer) custIds.add(m.user_stripe_customer);
  }
  for (const cid of custIds) {
    const subs = await stripe.subscriptions.list({ customer: cid, status: 'all', limit: 20 });
    const gymSubs = subs.data.filter((s) => s.metadata && s.metadata.type === 'gym_membership');
    console.log(
      JSON.stringify(
        {
          stripeCustomer: cid,
          gymSubscriptions: gymSubs.map((s) => ({
            id: s.id,
            status: s.status,
            current_period_start: s.current_period_start,
            current_period_end: s.current_period_end,
            interval: s.items?.data?.[0]?.price?.recurring?.interval,
            interval_count: s.items?.data?.[0]?.price?.recurring?.interval_count,
            price_id: s.items?.data?.[0]?.price?.id,
            unit_amount: s.items?.data?.[0]?.price?.unit_amount,
            metadata: s.metadata
          }))
        },
        null,
        2
      )
    );
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
