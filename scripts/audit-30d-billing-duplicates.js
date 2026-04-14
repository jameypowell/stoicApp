#!/usr/bin/env node
/**
 * Read-only production audit: detect patterns that indicate more than one
 * successful charge within a ~30-day window for gym membership or app paid tiers,
 * plus structural risks (duplicate PI rows, Stripe sub + manual path).
 *
 *   node scripts/audit-30d-billing-duplicates.js
 *
 * Env: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME, DB_PORT, DB_SSL (Postgres).
 * Optional: STRIPE_SECRET_KEY — if set, samples recent succeeded PIs for gym/app metadata (read-only).
 */

require('dotenv').config();
const { Client } = require('pg');
const Stripe = require('stripe');

const GYM_TIER_MEMBERSHIP = 'gym_membership';
const APP_PAID_TIERS = `('tier_two','tier_three','tier_four','daily','weekly','monthly')`;

async function main() {
  if (!process.env.DB_HOST) {
    console.error('DB_HOST is required (Postgres).');
    process.exit(1);
  }
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });
  await client.connect();

  const dupPi = await client.query(`
    SELECT stripe_payment_intent_id, COUNT(*)::int AS n, MIN(user_id) AS sample_user
    FROM payments
    WHERE stripe_payment_intent_id IS NOT NULL AND TRIM(stripe_payment_intent_id) <> ''
    GROUP BY stripe_payment_intent_id
    HAVING COUNT(*) > 1
    ORDER BY n DESC
    LIMIT 50
  `);

  const gymTooSoon = await client.query(`
    WITH gym_pay AS (
      SELECT p.user_id, p.id AS payment_id, p.stripe_payment_intent_id, p.amount, p.created_at,
             LAG(p.created_at) OVER (PARTITION BY p.user_id ORDER BY p.created_at) AS prev_at,
             LAG(p.id) OVER (PARTITION BY p.user_id ORDER BY p.created_at) AS prev_payment_id
      FROM payments p
      JOIN users u ON u.id = p.user_id
      WHERE p.status = 'succeeded'
        AND p.tier = $1
        AND u.role <> 'tester'
        AND u.email NOT ILIKE 'prod-test%@example.com'
        AND u.email NOT ILIKE 'qa.%@example.com'
    )
    SELECT g.user_id, u.email, u.name, g.prev_at, g.created_at,
           ROUND(EXTRACT(EPOCH FROM (g.created_at - g.prev_at)) / 86400.0, 2) AS days_since_prev_charge,
           g.prev_payment_id, g.payment_id, g.amount, g.stripe_payment_intent_id
    FROM gym_pay g
    JOIN users u ON u.id = g.user_id
    WHERE g.prev_at IS NOT NULL
      AND (g.created_at - g.prev_at) < INTERVAL '29 days'
    ORDER BY g.created_at DESC
    LIMIT 200
  `, [GYM_TIER_MEMBERSHIP]);

  const appTooSoon = await client.query(`
    WITH app_pay AS (
      SELECT p.user_id, p.id AS payment_id, p.stripe_payment_intent_id, p.amount, p.tier, p.created_at,
             LAG(p.created_at) OVER (PARTITION BY p.user_id ORDER BY p.created_at) AS prev_at,
             LAG(p.id) OVER (PARTITION BY p.user_id ORDER BY p.created_at) AS prev_payment_id
      FROM payments p
      JOIN users u ON u.id = p.user_id
      WHERE p.status = 'succeeded'
        AND p.tier IN ${APP_PAID_TIERS}
        AND u.role <> 'tester'
        AND u.email NOT ILIKE 'prod-test%@example.com'
        AND u.email NOT ILIKE 'qa.%@example.com'
    )
    SELECT a.user_id, u.email, u.name, a.prev_at, a.created_at,
           ROUND(EXTRACT(EPOCH FROM (a.created_at - a.prev_at)) / 86400.0, 2) AS days_since_prev_charge,
           a.prev_payment_id, a.payment_id, a.amount, a.tier, a.stripe_payment_intent_id
    FROM app_pay a
    JOIN users u ON u.id = a.user_id
    WHERE a.prev_at IS NOT NULL
      AND (a.created_at - a.prev_at) < INTERVAL '29 days'
    ORDER BY a.created_at DESC
    LIMIT 200
  `);

  /** Gym primary rows: Stripe sub id set but still got off-session style gym PI recently (dual-path risk). */
  const gymStripeSubWithRecentPi = await client.query(`
    SELECT gm.id AS gym_id, gm.user_id, u.email, u.name, gm.stripe_subscription_id,
           MAX(p.created_at) AS last_gym_membership_payment_at
    FROM gym_memberships gm
    JOIN users u ON u.id = gm.user_id
    JOIN payments p ON p.user_id = gm.user_id AND p.tier = $1 AND p.status = 'succeeded'
    WHERE gm.stripe_subscription_id IS NOT NULL AND TRIM(gm.stripe_subscription_id::text) <> ''
      AND (gm.family_group_id IS NULL OR gm.is_primary_member IS TRUE)
      AND u.role <> 'tester'
    GROUP BY gm.id, gm.user_id, u.email, u.name, gm.stripe_subscription_id
    HAVING MAX(p.created_at) > NOW() - INTERVAL '120 days'
    ORDER BY last_gym_membership_payment_at DESC
    LIMIT 100
  `, [GYM_TIER_MEMBERSHIP]);

  /** App row: Stripe sub + succeeded app-tier payment within 29 days (invoice + PI overlap risk). */
  const appStripeSubWithRecentPi = await client.query(`
    SELECT s.id AS subscription_id, s.user_id, u.email, u.name, s.tier, s.stripe_subscription_id,
           p.created_at AS payment_at, p.id AS payment_id, p.stripe_payment_intent_id
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    JOIN payments p ON p.user_id = s.user_id AND p.status = 'succeeded' AND p.tier IN ${APP_PAID_TIERS}
    WHERE s.stripe_subscription_id IS NOT NULL AND TRIM(s.stripe_subscription_id::text) <> ''
      AND p.created_at > NOW() - INTERVAL '120 days'
      AND u.role <> 'tester'
    ORDER BY p.created_at DESC
    LIMIT 100
  `);

  const gymPaidAfterDueStillDue = await client.query(`
    SELECT gm.id, gm.user_id, u.email, u.name, gm.contract_end_date::date AS contract_end,
           (SELECT MAX(p.created_at) FROM payments p
            WHERE p.user_id = gm.user_id AND p.tier = $1 AND p.status = 'succeeded') AS last_gym_pay_at
    FROM gym_memberships gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.status IN ('active', 'grace_period')
      AND (gm.stripe_subscription_id IS NULL OR TRIM(gm.stripe_subscription_id::text) = '')
      AND (gm.family_group_id IS NULL OR gm.is_primary_member IS TRUE)
      AND gm.contract_end_date IS NOT NULL
      AND gm.contract_end_date::date <= (CURRENT_DATE + INTERVAL '2 days')
      AND u.role <> 'tester'
      AND EXISTS (
        SELECT 1 FROM payments p2
        WHERE p2.user_id = gm.user_id AND p2.tier = $1 AND p2.status = 'succeeded'
          AND p2.created_at::date >= gm.contract_end_date::date
      )
    ORDER BY gm.contract_end_date ASC
    LIMIT 80
  `, [GYM_TIER_MEMBERSHIP]);

  await client.end();

  const out = {
    ran_at: new Date().toISOString(),
    threshold: 'Consecutive succeeded charges < 29 days apart (same user) flagged for gym_membership and app paid tiers.',
    duplicate_payment_intent_ids: dupPi.rows,
    gym_membership_charges_too_close: gymTooSoon.rows,
    app_paid_tier_charges_too_close: appTooSoon.rows,
    gym_has_stripe_sub_and_recent_gym_pi: gymStripeSubWithRecentPi.rows,
    app_has_stripe_sub_and_recent_app_tier_pi: appStripeSubWithRecentPi.rows,
    gym_contract_due_but_paid_on_or_after_due: gymPaidAfterDueStillDue.rows,
    summary: {
      duplicate_pi_groups: dupPi.rows.length,
      gym_too_close_pairs: gymTooSoon.rows.length,
      app_too_close_pairs: appTooSoon.rows.length,
      gym_dual_path_rows: gymStripeSubWithRecentPi.rows.length,
      app_dual_path_rows: appStripeSubWithRecentPi.rows.length,
      gym_paid_still_in_due_window: gymPaidAfterDueStillDue.rows.length
    },
    pass:
      dupPi.rows.length === 0 &&
      gymTooSoon.rows.length === 0 &&
      appTooSoon.rows.length === 0 &&
      gymPaidAfterDueStillDue.rows.length === 0
  };

  console.log(JSON.stringify(out, null, 2));

  if (process.env.STRIPE_SECRET_KEY && gymTooSoon.rows.length + appTooSoon.rows.length > 0) {
    const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
    const sample = [...gymTooSoon.rows, ...appTooSoon.rows].slice(0, 5);
    console.log('\n--- Stripe sample (first 5 flagged rows, read-only retrieve) ---\n');
    for (const r of sample) {
      const piId = r.stripe_payment_intent_id;
      if (!piId) continue;
      try {
        const pi = await stripe.paymentIntents.retrieve(piId);
        console.log(
          JSON.stringify(
            {
              payment_intent: piId,
              status: pi.status,
              amount: pi.amount,
              metadata: pi.metadata || {},
              created: pi.created
            },
            null,
            2
          )
        );
      } catch (e) {
        console.log(piId, 'retrieve failed:', e.message);
      }
    }
  }

  process.exit(out.pass ? 0 : 2);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
