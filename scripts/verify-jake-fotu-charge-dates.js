#!/usr/bin/env node
/**
 * Verify Jake Fotu's gym membership: last charge Feb 14, 2026; next charge Mar 16, 2026.
 * Confirms DB and Stripe are consistent and DB can be the source of truth.
 *
 * Usage:
 *   node scripts/verify-jake-fotu-charge-dates.js           # verify only
 *   node scripts/verify-jake-fotu-charge-dates.js --fix     # update DB to match if needed
 *
 * Requires: DB env vars (e.g. DB_PASSWORD), STRIPE_SECRET_KEY
 */

require('dotenv').config();
const path = require('path');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));

const JAKE_EMAIL = 'fotujacob@gmail.com';
const EXPECTED_LAST_CHARGE_DATE = '2026-02-14';   // Feb 14, 2026
const EXPECTED_NEXT_CHARGE_DATE = '2026-03-16';   // Mar 16, 2026

function dateOnly(str) {
  if (!str) return null;
  const s = String(str).trim();
  if (s.includes('T')) return s.split('T')[0];
  if (s.includes(' ')) return s.split(' ')[0];
  return s;
}

function sameDate(a, b) {
  const d1 = dateOnly(a);
  const d2 = dateOnly(b);
  return d1 && d2 && d1 === d2;
}

async function main() {
  const fix = process.argv.includes('--fix');
  const Stripe = require('stripe');
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log('\nJake Fotu – Charge dates verification');
  console.log('Expected: last charge', EXPECTED_LAST_CHARGE_DATE, '| next charge', EXPECTED_NEXT_CHARGE_DATE);
  console.log('');

  const user = await db.queryOne(
    db.isPostgres ? 'SELECT * FROM users WHERE email = $1' : 'SELECT * FROM users WHERE email = ?',
    [JAKE_EMAIL]
  );
  if (!user) {
    console.error('User not found:', JAKE_EMAIL);
    process.exit(1);
  }

  const membership = await db.queryOne(
    db.isPostgres
      ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
      : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [user.id]
  );
  if (!membership) {
    console.error('No gym membership for Jake.');
    process.exit(1);
  }

  // Last charge: from payments table
  const lastPayment = await db.queryOne(
    db.isPostgres
      ? `SELECT id, created_at, amount, tier, status FROM payments
         WHERE user_id = $1 AND tier IN ('gym_membership', 'gym_membership_late_fee') AND status = 'succeeded'
         ORDER BY created_at DESC LIMIT 1`
      : `SELECT id, created_at, amount, tier, status FROM payments
         WHERE user_id = ? AND tier IN ('gym_membership', 'gym_membership_late_fee') AND status = 'succeeded'
         ORDER BY created_at DESC LIMIT 1`,
    [user.id]
  );
  const dbLastChargeDate = lastPayment ? dateOnly(lastPayment.created_at) : null;

  // Next charge: gym_memberships.contract_end_date
  const dbNextChargeDate = dateOnly(membership.contract_end_date);
  const dbContractStartDate = dateOnly(membership.contract_start_date);

  console.log('Database (source of truth):');
  console.log('  gym_memberships.contract_start_date:', membership.contract_start_date || 'NULL');
  console.log('  gym_memberships.contract_end_date  :', membership.contract_end_date || 'NULL', '(next charge)');
  console.log('  payments (last succeeded)          :', lastPayment ? lastPayment.created_at : 'none', '(last charge)');
  console.log('');

  let stripePeriodEnd = null;
  let stripePeriodStart = null;
  if (membership.stripe_subscription_id) {
    try {
      const sub = await stripe.subscriptions.retrieve(membership.stripe_subscription_id);
      stripePeriodStart = sub.current_period_start ? new Date(sub.current_period_start * 1000).toISOString().split('T')[0] : null;
      stripePeriodEnd = sub.current_period_end ? new Date(sub.current_period_end * 1000).toISOString().split('T')[0] : null;
      console.log('Stripe subscription (should match DB for consistency):');
      console.log('  current_period_start:', stripePeriodStart);
      console.log('  current_period_end  :', stripePeriodEnd, '(next charge)');
      console.log('');
    } catch (e) {
      console.log('Stripe:', e.message);
      console.log('');
    }
  } else {
    console.log('Stripe: no subscription ID on membership');
    console.log('');
  }

  // Compare
  const lastOk = sameDate(dbLastChargeDate, EXPECTED_LAST_CHARGE_DATE);
  const nextOk = sameDate(dbNextChargeDate, EXPECTED_NEXT_CHARGE_DATE);
  const stripeNextOk = !stripePeriodEnd || sameDate(stripePeriodEnd, EXPECTED_NEXT_CHARGE_DATE);

  console.log('Verification:');
  console.log('  Last charge Feb 14, 2026:', lastOk ? 'OK' : 'MISMATCH', lastOk ? '' : `(DB: ${dbLastChargeDate || 'none'})`);
  console.log('  Next charge Mar 16, 2026:', nextOk ? 'OK' : 'MISMATCH', nextOk ? '' : `(DB: ${dbNextChargeDate || 'none'})`);
  if (stripePeriodEnd) {
    console.log('  Stripe period end Mar 16, 2026:', stripeNextOk ? 'OK' : 'MISMATCH', stripeNextOk ? '' : `(Stripe: ${stripePeriodEnd})`);
  }

  const conflicts = [];
  if (!lastOk) conflicts.push('Last charge date in DB does not match Feb 14, 2026');
  if (!nextOk) conflicts.push('contract_end_date (next charge) in DB does not match Mar 16, 2026');
  if (stripePeriodEnd && !stripeNextOk) conflicts.push('Stripe current_period_end does not match Mar 16, 2026 (Stripe will charge on its date)');

  if (conflicts.length > 0) {
    console.log('');
    console.log('Conflicts:');
    conflicts.forEach((c) => console.log('  -', c));
  }

  if (fix && (!nextOk || !sameDate(dbContractStartDate, EXPECTED_LAST_CHARGE_DATE))) {
    console.log('');
    console.log('Updating DB to set contract_start_date =', EXPECTED_LAST_CHARGE_DATE, ', contract_end_date =', EXPECTED_NEXT_CHARGE_DATE);
    await db.query(
      db.isPostgres
        ? 'UPDATE gym_memberships SET contract_start_date = $1, contract_end_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3'
        : "UPDATE gym_memberships SET contract_start_date = ?, contract_end_date = ?, updated_at = datetime('now') WHERE id = ?",
      [EXPECTED_LAST_CHARGE_DATE, EXPECTED_NEXT_CHARGE_DATE, membership.id]
    );
    console.log('Done. Re-run without --fix to verify.');
  } else if (fix && lastOk && nextOk) {
    console.log('');
    console.log('DB already matches; no update needed.');
  }

  if (conflicts.length === 0 && !fix) {
    console.log('');
    console.log('All sources agree: last charge Feb 14, 2026; next charge Mar 16, 2026. No conflicts.');
  }

  console.log('');
  process.exit(conflicts.length > 0 && !fix ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
