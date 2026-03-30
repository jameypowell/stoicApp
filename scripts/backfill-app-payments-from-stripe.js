#!/usr/bin/env node
/**
 * Backfill missing app subscription payment rows from Stripe paid invoices.
 * Sets created_at to invoice paid time so admin "Last app charge" ordering is correct.
 *
 * Usage:
 *   node scripts/backfill-app-payments-from-stripe.js
 *   node scripts/backfill-app-payments-from-stripe.js --dry-run
 *   node scripts/backfill-app-payments-from-stripe.js --limit 3
 *   node scripts/backfill-app-payments-from-stripe.js user@email.com other@email.com
 *
 * Requires: DB env (see database.js) and STRIPE_SECRET_KEY in .env
 */

require('dotenv').config();
const path = require('path');
const Stripe = require('stripe');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));

const APP_TIERS_SQL = "('tier_one', 'tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')";

function parseArgs(argv) {
  const dryRun = argv.includes('--dry-run');
  let limit = null;
  const targets = [];
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--limit' && argv[i + 1]) {
      limit = parseInt(argv[i + 1], 10);
      i++;
      continue;
    }
    if (a === '--dry-run') continue;
    if (a.startsWith('--')) continue;
    targets.push(a);
  }
  return { dryRun, limit: Number.isFinite(limit) ? limit : null, targets };
}

function paidAtIso(invoice) {
  const ts = invoice.status_transitions?.paid_at;
  if (ts) return new Date(ts * 1000).toISOString();
  if (invoice.created) return new Date(invoice.created * 1000).toISOString();
  return new Date().toISOString();
}

async function listAllPaidInvoices(stripe, subscriptionId) {
  const out = [];
  let startingAfter;
  for (;;) {
    const page = await stripe.invoices.list({
      subscription: subscriptionId,
      status: 'paid',
      limit: 100,
      starting_after: startingAfter
    });
    const data = page.data || [];
    out.push(...data);
    if (!page.has_more || data.length === 0) break;
    startingAfter = data[data.length - 1].id;
  }
  return out;
}

async function main() {
  const { dryRun, limit, targets } = parseArgs(process.argv.slice(2));
  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is required');
    process.exit(1);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  const excludeTestPg =
    "AND u.role <> 'tester' AND u.email NOT ILIKE 'prod-test%@example.com' AND u.email NOT ILIKE 'qa.%@example.com'";
  const excludeTestSql =
    "AND u.role <> 'tester' AND u.email NOT LIKE 'prod-test%@example.com' AND LOWER(u.email) NOT LIKE 'qa.%@example.com'";

  let list;
  if (targets.length) {
    const userIds = new Set();
    for (const t of targets) {
      const isEmail = t.includes('@');
      const u = await db.queryOne(
        db.isPostgres
          ? isEmail
            ? 'SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM($1))'
            : 'SELECT * FROM users WHERE name ILIKE $1'
          : isEmail
            ? 'SELECT * FROM users WHERE LOWER(TRIM(email)) = LOWER(TRIM(?))'
            : 'SELECT * FROM users WHERE name LIKE ?',
        db.isPostgres ? (isEmail ? [t.trim()] : [`%${t.trim()}%`]) : isEmail ? [t.trim()] : [`%${t.trim()}%`]
      );
      if (!u) console.warn(`User not found: "${t}"`);
      else userIds.add(u.id);
    }
    if (userIds.size === 0) {
      console.log('No matching users.');
      process.exit(0);
    }
    const ids = Array.from(userIds);
    const ph = ids.map((_, i) => (db.isPostgres ? `$${i + 1}` : '?')).join(',');
    const ex = db.isPostgres ? excludeTestPg : excludeTestSql;
    const res = await db.query(
      `SELECT s.id, s.user_id, s.tier, s.stripe_subscription_id, u.email, u.name
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.stripe_subscription_id IS NOT NULL
         AND s.tier IN ${APP_TIERS_SQL}
         AND s.user_id IN (${ph})
         ${ex}`,
      ids
    );
    list = res.rows || [];
  } else {
    const ex = db.isPostgres ? excludeTestPg : excludeTestSql;
    const res = await db.query(
      `SELECT s.id, s.user_id, s.tier, s.stripe_subscription_id, u.email, u.name
       FROM subscriptions s
       JOIN users u ON u.id = s.user_id
       WHERE s.stripe_subscription_id IS NOT NULL
         AND s.tier IN ${APP_TIERS_SQL}
         ${ex}`,
      []
    );
    list = res.rows || [];
  }

  const byStripe = new Map();
  for (const r of list) {
    if (!r.stripe_subscription_id) continue;
    const prev = byStripe.get(r.stripe_subscription_id);
    if (!prev || r.id > prev.id) byStripe.set(r.stripe_subscription_id, r);
  }
  let work = Array.from(byStripe.values());
  if (limit != null) work = work.slice(0, limit);

  console.log(
    `\nBackfill app subscription payments (${work.length} Stripe subscription(s))${dryRun ? ' [DRY RUN]' : ''}\n`
  );

  let totalInserted = 0;
  let totalSkippedExisting = 0;

  const tierPlaceholdersPg = "('tier_one', 'tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')";
  const tierPlaceholdersSql = "('tier_one', 'tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')";

  for (const sub of work) {
    let stripeSub;
    try {
      stripeSub = await stripe.subscriptions.retrieve(sub.stripe_subscription_id);
    } catch (e) {
      console.log(`Skip ${sub.email}: Stripe retrieve failed (${e.message})`);
      continue;
    }
    if (stripeSub.metadata?.type === 'gym_membership') {
      console.log(`Skip ${sub.email}: subscription is gym_membership in Stripe metadata`);
      continue;
    }

    const existingPayments = await db.query(
      db.isPostgres
        ? `SELECT stripe_payment_intent_id FROM payments
           WHERE user_id = $1 AND tier IN ${tierPlaceholdersPg} AND status = 'succeeded'`
        : `SELECT stripe_payment_intent_id FROM payments
           WHERE user_id = ? AND tier IN ${tierPlaceholdersSql} AND status = 'succeeded'`,
      [sub.user_id]
    );
    const existingIds = new Set(
      (existingPayments.rows || []).map((p) => p.stripe_payment_intent_id).filter(Boolean)
    );

    let invoices;
    try {
      invoices = await listAllPaidInvoices(stripe, sub.stripe_subscription_id);
    } catch (e) {
      console.log(`Skip ${sub.email}: invoice list failed (${e.message})`);
      continue;
    }

    let rowInserts = 0;
    for (const inv of invoices) {
      const paymentId = inv.payment_intent || `inv_${inv.id}`;
      if (existingIds.has(paymentId)) {
        totalSkippedExisting++;
        continue;
      }
      const amountCents = inv.amount_paid ?? 0;
      const currency = inv.currency || 'usd';
      const createdAt = paidAtIso(inv);
      const label = sub.name || sub.email;
      if (dryRun) {
        console.log(
          `  [dry-run] ${label}: ${paymentId} ${amountCents / 100} ${currency} created_at=${createdAt}`
        );
        rowInserts++;
        continue;
      }
      try {
        await db.createPayment(
          sub.user_id,
          paymentId,
          amountCents,
          currency,
          sub.tier,
          'succeeded',
          sub.email,
          createdAt
        );
        existingIds.add(paymentId);
        rowInserts++;
        totalInserted++;
        console.log(
          `  ${label}: ${paymentId} ${amountCents / 100} ${currency} (${createdAt.split('T')[0]})`
        );
      } catch (err) {
        if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT' || /unique|duplicate/i.test(err.message || '')) {
          existingIds.add(paymentId);
          totalSkippedExisting++;
        } else {
          console.error(`  Error ${paymentId}:`, err.message);
        }
      }
    }
    if (rowInserts > 0 && !dryRun) {
      console.log(`  → ${rowInserts} new row(s) for ${sub.name || sub.email}`);
    }
  }

  console.log(`\nDone.${dryRun ? ' (no DB writes)' : ` Inserted ${totalInserted} payment row(s).`}`);
  console.log(`Skipped (already in DB): ${totalSkippedExisting}\n`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
