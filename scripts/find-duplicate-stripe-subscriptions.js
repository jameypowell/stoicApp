#!/usr/bin/env node
/**
 * Find Stripe customers with more than one "billable" subscription (duplicate risk).
 * Legit: one app + one gym Stripe sub on same customer. Flag: two+ in same category (app vs gym).
 *
 * Requires: STRIPE_SECRET_KEY (e.g. from .env.production)
 *
 *   node scripts/find-duplicate-stripe-subscriptions.js
 *   node -r dotenv/config scripts/find-duplicate-stripe-subscriptions.js
 *   DOTENV_CONFIG_PATH=.env.production node scripts/find-duplicate-stripe-subscriptions.js
 *
 * Optional DB cross-check (duplicate subscription rows per user):
 *   USE_POSTGRES=1 DB_HOST=... node scripts/find-duplicate-stripe-subscriptions.js --db
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.STRIPE_SECRET_KEY && require('fs').existsSync(path.join(__dirname, '..', '.env.production'))) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.production') });
}

const Stripe = require('stripe');
const key = process.env.STRIPE_SECRET_KEY;
if (!key || key.includes('YOUR_')) {
  console.error('Set STRIPE_SECRET_KEY (e.g. load .env.production).');
  process.exit(1);
}

const stripe = new Stripe(key);
const withDb = process.argv.includes('--db');

const BILLABLE = new Set(['active', 'trialing', 'past_due', 'unpaid', 'incomplete']);

function subCategory(sub) {
  const t = (sub.metadata && sub.metadata.type) || '';
  if (String(t).toLowerCase() === 'gym_membership') return 'gym';
  return 'app';
}

async function loadAllBillableSubscriptions() {
  const out = [];
  let startingAfter = undefined;
  for (;;) {
    const page = await stripe.subscriptions.list({
      status: 'all',
      limit: 100,
      ...(startingAfter ? { starting_after: startingAfter } : {})
    });
    for (const sub of page.data) {
      if (BILLABLE.has(sub.status)) out.push(sub);
    }
    if (!page.has_more || page.data.length === 0) break;
    startingAfter = page.data[page.data.length - 1].id;
  }
  return out;
}

async function customerEmail(customerId) {
  try {
    const c = await stripe.customers.retrieve(customerId);
    if (c.deleted) return '(deleted customer)';
    return c.email || c.description || customerId;
  } catch (e) {
    return customerId + ' (retrieve failed: ' + e.message + ')';
  }
}

async function main() {
  console.log('Loading billable Stripe subscriptions (paginated)...\n');
  const subs = await loadAllBillableSubscriptions();
  console.log(`Billable subscription rows: ${subs.length}\n`);

  const byCustomer = new Map();
  for (const sub of subs) {
    const cid = typeof sub.customer === 'string' ? sub.customer : sub.customer && sub.customer.id;
    if (!cid) continue;
    if (!byCustomer.has(cid)) byCustomer.set(cid, []);
    byCustomer.get(cid).push(sub);
  }

  const duplicates = [];
  for (const [customerId, list] of byCustomer) {
    if (list.length < 2) continue;
    const byCat = { app: [], gym: [] };
    for (const s of list) {
      byCat[subCategory(s)].push(s);
    }
    const email = await customerEmail(customerId);
    duplicates.push({ customerId, email, list, byCat });
  }

  duplicates.sort((a, b) => a.email.localeCompare(b.email));

  if (duplicates.length === 0) {
    console.log('No Stripe customer has 2+ billable subscriptions at once.');
    process.exit(0);
  }

  console.log('=== Customers with 2+ billable Stripe subscriptions ===\n');
  for (const { customerId, email, list, byCat } of duplicates) {
    const appDup = byCat.app.length > 1;
    const gymDup = byCat.gym.length > 1;
    const flag =
      appDup || gymDup
        ? 'LIKELY DUPLICATE (same type)'
        : 'review (often 1 app + 1 gym is OK)';
    console.log(`${email}`);
    console.log(`  customer: ${customerId}`);
    console.log(`  flag: ${flag}`);
    if (byCat.app.length) console.log(`  app subs (${byCat.app.length}):`);
    for (const s of byCat.app) {
      console.log(
        `    ${s.id}  status=${s.status}  created=${new Date(s.created * 1000).toISOString().slice(0, 10)}  tier=${s.metadata?.tier || '-'}`
      );
    }
    if (byCat.gym.length) console.log(`  gym subs (${byCat.gym.length}):`);
    for (const s of byCat.gym) {
      console.log(
        `    ${s.id}  status=${s.status}  created=${new Date(s.created * 1000).toISOString().slice(0, 10)}  membershipId=${s.metadata?.membershipId || '-'}`
      );
    }
    console.log('');
  }

  if (withDb && process.env.DB_HOST) {
    const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));
    const conn = await initDatabase();
    const db = new Database(conn);
    try {
      console.log('=== DB: users with 2+ subscription rows having stripe_subscription_id ===\n');
      const q = db.isPostgres
        ? `SELECT user_id, COUNT(*)::int AS n, array_agg(stripe_subscription_id ORDER BY id) AS sub_ids
            FROM subscriptions
            WHERE stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id) <> ''
              AND status IN ('active','trialing','grace_period','past_due','unpaid','incomplete')
            GROUP BY user_id HAVING COUNT(*) > 1`
        : `SELECT user_id, COUNT(*) AS n, GROUP_CONCAT(stripe_subscription_id) AS sub_ids
            FROM subscriptions
            WHERE stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id) != ''
              AND status IN ('active','trialing','grace_period','past_due','unpaid','incomplete')
            GROUP BY user_id HAVING COUNT(*) > 1`;
      const r = await db.query(q, []);
      const rows = r.rows || [];
      if (!rows.length) console.log('None.\n');
      else console.log(JSON.stringify(rows, null, 2) + '\n');

      console.log('=== DB: users with 2+ gym_memberships rows having stripe_subscription_id ===\n');
      const q2 = db.isPostgres
        ? `SELECT user_id, COUNT(*)::int AS n, array_agg(stripe_subscription_id ORDER BY id) AS sub_ids
            FROM gym_memberships
            WHERE stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id) <> ''
              AND status IN ('active','grace_period','past_due','paused')
            GROUP BY user_id HAVING COUNT(*) > 1`
        : `SELECT user_id, COUNT(*) AS n, GROUP_CONCAT(stripe_subscription_id) AS sub_ids
            FROM gym_memberships
            WHERE stripe_subscription_id IS NOT NULL AND TRIM(stripe_subscription_id) != ''
              AND status IN ('active','grace_period','past_due','paused')
            GROUP BY user_id HAVING COUNT(*) > 1`;
      const r2 = await db.query(q2, []);
      const rows2 = r2.rows || [];
      if (!rows2.length) console.log('None.\n');
      else console.log(JSON.stringify(rows2, null, 2) + '\n');
    } finally {
      if (conn && conn.end) await conn.end();
      else if (conn && conn.close) conn.close();
    }
  } else if (withDb) {
    console.log('Skip DB (--db set but DB_HOST missing).\n');
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
