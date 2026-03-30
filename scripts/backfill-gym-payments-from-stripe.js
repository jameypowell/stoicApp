#!/usr/bin/env node
/**
 * Backfill missing gym_membership payment rows from Stripe invoices.
 * Use when "Last Charge" is empty because the initial (or renewal) payment was never recorded in `payments`.
 *
 * Usage: node scripts/backfill-gym-payments-from-stripe.js "Haze Hadley" "fotujacob@gmail.com"
 * Or no args: backfills Haze Hadley and Jake Fotu.
 *
 * Requires: DB_* and STRIPE_SECRET_KEY
 */

require('dotenv').config();
const path = require('path');
const Stripe = require('stripe');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));

const TARGETS = process.argv.slice(2).length
  ? process.argv.slice(2)
  : ['Haze Hadley', 'fotujacob@gmail.com'];

async function main() {
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log('\nBackfill gym_membership payments from Stripe for:', TARGETS.join(', '));
  console.log('');

  for (const target of TARGETS) {
    const isEmail = target.includes('@');
    const user = await db.queryOne(
      db.isPostgres
        ? isEmail
          ? 'SELECT * FROM users WHERE email = $1'
          : 'SELECT * FROM users WHERE name ILIKE $1 OR name = $2'
        : isEmail
          ? 'SELECT * FROM users WHERE email = ?'
          : 'SELECT * FROM users WHERE name LIKE ? OR name = ?',
      isEmail ? [target] : [target.trim(), target.trim()]
    );

    if (!user) {
      console.log(`Skip "${target}": user not found`);
      continue;
    }

    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE user_id = $1 AND stripe_subscription_id IS NOT NULL ORDER BY created_at DESC LIMIT 1'
        : 'SELECT * FROM gym_memberships WHERE user_id = ? AND stripe_subscription_id IS NOT NULL ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );

    if (!membership) {
      console.log(`Skip "${user.name}": no gym membership with Stripe subscription`);
      continue;
    }

    const existingPayments = await db.query(
      db.isPostgres
        ? "SELECT stripe_payment_intent_id FROM payments WHERE user_id = $1 AND tier IN ('gym_membership', 'gym_membership_late_fee')"
        : "SELECT stripe_payment_intent_id FROM payments WHERE user_id = ? AND tier IN ('gym_membership', 'gym_membership_late_fee')",
      [user.id]
    );
    const existingIds = new Set((existingPayments.rows || []).map((p) => p.stripe_payment_intent_id).filter(Boolean));

    let invoices;
    try {
      invoices = await stripe.invoices.list({
        subscription: membership.stripe_subscription_id,
        status: 'paid',
        limit: 24
      });
    } catch (e) {
      console.log(`Skip "${user.name}": Stripe error ${e.message}`);
      continue;
    }

    const paid = invoices.data || [];
    let backfilled = 0;
    for (const inv of paid) {
      const paymentId = inv.payment_intent || `inv_${inv.id}`;
      if (existingIds.has(paymentId)) continue;
      const amountCents = inv.amount_paid || 0;
      const currency = inv.currency || 'usd';
      try {
        await db.createPayment(user.id, paymentId, amountCents, currency, 'gym_membership', 'succeeded', user.email);
        existingIds.add(paymentId);
        backfilled++;
        const date = inv.status_transitions?.paid_at ? new Date(inv.status_transitions.paid_at * 1000).toISOString().split('T')[0] : '?';
        console.log(`  Recorded payment ${paymentId} for ${user.name}: ${amountCents / 100} ${currency} (${date})`);
      } catch (err) {
        if (err.code === '23505' || err.code === 'SQLITE_CONSTRAINT' || /unique|duplicate/i.test(err.message || '')) {
          existingIds.add(paymentId);
        } else {
          console.log(`  Error recording ${paymentId}:`, err.message);
        }
      }
    }

    if (backfilled === 0 && existingIds.size === 0) {
      console.log(`  No paid invoices found for "${user.name}" or all already in DB`);
    } else if (backfilled > 0) {
      console.log(`OK "${user.name}": backfilled ${backfilled} payment(s)`);
    }
  }

  console.log('\nDone.\n');
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
