#!/usr/bin/env node
/**
 * Read-only: compare Stripe subscriptions on your customers vs DB references.
 *
 * Finds:
 *   (A) Active-like Stripe subs (active / trialing / past_due) whose id does not appear
 *       on any subscriptions.stripe_subscription_id or gym_memberships.stripe_subscription_id
 *       — can still invoice even if the app thinks billing is "manual only".
 *   (B) Optional (--verify-db-refs): DB references a sub id that is missing, canceled, or
 *       not on the expected customer (slower; one Stripe retrieve per distinct DB id).
 *
 * Usage:
 *   node scripts/audit-stripe-subscription-drift.js
 *   node scripts/audit-stripe-subscription-drift.js --verify-db-refs
 *   node scripts/audit-stripe-subscription-drift.js --customer cus_xxxxx
 *
 * Env: DB_* (Postgres), STRIPE_SECRET_KEY (live or test to match your DB environment).
 */

require('dotenv').config();
const { Client } = require('pg');
const Stripe = require('stripe');

const STRIPE_ACTIVEISH = new Set(['active', 'trialing', 'past_due']);

function parseArgs() {
  const out = { verifyDbRefs: false, customer: null };
  for (let i = 2; i < process.argv.length; i++) {
    const a = process.argv[i];
    if (a === '--verify-db-refs') out.verifyDbRefs = true;
    else if (a === '--customer' && process.argv[i + 1]) {
      out.customer = String(process.argv[++i]).trim();
    }
  }
  return out;
}

async function main() {
  const { verifyDbRefs, customer: onlyCustomer } = parseArgs();

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is required.');
    process.exit(1);
  }
  if (!process.env.DB_HOST) {
    console.error('DB_HOST is required (Postgres).');
    process.exit(1);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const c = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });
  await c.connect();

  const { rows: subRows } = await c.query(
    `SELECT DISTINCT TRIM(stripe_subscription_id) AS sid
     FROM subscriptions
     WHERE stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id) <> ''`
  );
  const { rows: gymRows } = await c.query(
    `SELECT DISTINCT TRIM(stripe_subscription_id) AS sid
     FROM gym_memberships
     WHERE stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id) <> ''`
  );
  const dbSubIds = new Set();
  for (const r of subRows) if (r.sid) dbSubIds.add(r.sid);
  for (const r of gymRows) if (r.sid) dbSubIds.add(r.sid);

  let custQuery;
  let custParams = [];
  if (onlyCustomer) {
    custQuery = `SELECT $1::text AS cid`;
    custParams = [onlyCustomer];
  } else {
    custQuery = `
      SELECT DISTINCT TRIM(cid) AS cid
      FROM (
        SELECT stripe_customer_id AS cid FROM users
        WHERE stripe_customer_id IS NOT NULL AND TRIM(stripe_customer_id) <> ''
        UNION
        SELECT stripe_customer_id AS cid FROM gym_memberships
        WHERE stripe_customer_id IS NOT NULL AND TRIM(stripe_customer_id) <> ''
      ) x
      WHERE TRIM(cid) <> ''
    `;
  }

  const { rows: customerRows } = await c.query(custQuery, custParams);
  const customerIds = [...new Set(customerRows.map((r) => r.cid).filter(Boolean))].sort();

  const customerToEmails = new Map();
  function addEmails(cid, emails) {
    if (!cid || !emails || !emails.length) return;
    const cur = customerToEmails.get(cid) || [];
    const merged = [...new Set([...cur, ...emails])].sort();
    customerToEmails.set(cid, merged);
  }
  const { rows: userCustEmails } = await c.query(
    `SELECT TRIM(stripe_customer_id) AS cid, ARRAY_AGG(DISTINCT email ORDER BY email) AS emails
     FROM users
     WHERE stripe_customer_id IS NOT NULL AND TRIM(stripe_customer_id) <> ''
     GROUP BY 1`
  );
  for (const r of userCustEmails) addEmails(r.cid, r.emails);
  const { rows: gymCustEmails } = await c.query(
    `SELECT TRIM(gm.stripe_customer_id) AS cid, ARRAY_AGG(DISTINCT u.email ORDER BY u.email) AS emails
     FROM gym_memberships gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.stripe_customer_id IS NOT NULL AND TRIM(gm.stripe_customer_id) <> ''
     GROUP BY 1`
  );
  for (const r of gymCustEmails) addEmails(r.cid, r.emails);

  const stripeSubsNotInDb = [];
  const stripeListErrors = [];

  for (const customer of customerIds) {
    let startingAfter = undefined;
    try {
      for (;;) {
        const page = await stripe.subscriptions.list({
          customer,
          status: 'all',
          limit: 100,
          ...(startingAfter ? { starting_after: startingAfter } : {})
        });
        for (const sub of page.data) {
          if (!STRIPE_ACTIVEISH.has(sub.status)) continue;
          if (dbSubIds.has(sub.id)) continue;
          const item0 = sub.items && sub.items.data && sub.items.data[0];
          stripeSubsNotInDb.push({
            stripe_subscription_id: sub.id,
            stripe_customer_id: customer,
            users_with_this_stripe_customer_id: customerToEmails.get(customer) || [],
            status: sub.status,
            metadata: sub.metadata || {},
            price_id: item0 && item0.price ? item0.price.id : null,
            recurring: item0 && item0.price && item0.price.recurring ? item0.price.recurring : null,
            current_period_end: sub.current_period_end
              ? new Date(sub.current_period_end * 1000).toISOString()
              : null
          });
        }
        if (!page.has_more || page.data.length === 0) break;
        startingAfter = page.data[page.data.length - 1].id;
      }
    } catch (e) {
      stripeListErrors.push({ customer, error: e.message || String(e) });
    }
  }

  const dbRefsIssues = [];
  if (verifyDbRefs && dbSubIds.size > 0) {
    for (const sid of [...dbSubIds].sort()) {
      try {
        const sub = await stripe.subscriptions.retrieve(sid, { expand: ['customer'] });
        const cust =
          typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
        if (['canceled', 'unpaid', 'incomplete_expired'].includes(sub.status)) {
          dbRefsIssues.push({
            stripe_subscription_id: sid,
            issue: 'db_points_at_inactive_stripe_sub',
            status: sub.status,
            customer: cust
          });
        } else if (sub.status === 'paused') {
          dbRefsIssues.push({ stripe_subscription_id: sid, issue: 'stripe_sub_paused', status: sub.status, customer: cust });
        }
      } catch (e) {
        const code = e.code || e.type;
        dbRefsIssues.push({
          stripe_subscription_id: sid,
          issue: 'stripe_retrieve_failed',
          error: e.message || String(e),
          code
        });
      }
    }
  }

  await c.end();

  const report = {
    summary: {
      distinct_db_subscription_ids: dbSubIds.size,
      stripe_customers_scanned: customerIds.length,
      active_like_stripe_subscriptions_not_referenced_in_db: stripeSubsNotInDb.length,
      stripe_list_errors: stripeListErrors.length,
      db_reference_issues: verifyDbRefs ? dbRefsIssues.length : null
    },
    stripe_subscriptions_not_in_database: stripeSubsNotInDb,
    stripe_list_errors: stripeListErrors,
    ...(verifyDbRefs ? { db_subscription_reference_issues: dbRefsIssues } : {})
  };

  console.log(JSON.stringify(report, null, 2));

  if (stripeSubsNotInDb.length > 0 || stripeListErrors.length > 0 || (verifyDbRefs && dbRefsIssues.length > 0)) {
    process.exitCode = 2;
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
