#!/usr/bin/env node
/**
 * Re-anchor gym_memberships.contract_start_date / contract_end_date for one user.
 *
 * - Default: find the *earliest succeeded* Stripe PaymentIntent with metadata.type=gym_membership
 *   for that user (checks gym + app Stripe customer IDs), then set dates from charge time (Denver) + 30 days.
 * - Override: --start-date YYYY-MM-DD (e.g. true membership start when Stripe history is messy).
 *
 * Usage (production DB + Stripe in .env):
 *   node scripts/reanchor-gym-contract-from-stripe.js sharla.barber@nebo.edu --dry-run
 *   node scripts/reanchor-gym-contract-from-stripe.js sharla.barber@nebo.edu --apply
 *   node scripts/reanchor-gym-contract-from-stripe.js sharla.barber@nebo.edu --start-date 2026-03-09 --apply
 *
 * Requires: DB_HOST (Postgres), DB_USER, DB_PASSWORD, STRIPE_SECRET_KEY
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const path = require('path');
const Stripe = require('stripe');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));
const { reanchorGymContractForEmail } = require(path.join(__dirname, '..', 'lib', 'reanchor-gym-contract'));

async function main() {
  const raw = process.argv.slice(2);
  const apply = raw.includes('--apply');
  const dryRun = !apply || raw.includes('--dry-run');
  let manualStartYmd = null;
  let email = '';
  for (let i = 0; i < raw.length; i++) {
    if (raw[i] === '--start-date' && raw[i + 1]) {
      manualStartYmd = /^\d{4}-\d{2}-\d{2}$/.test(raw[i + 1]) ? raw[i + 1] : null;
      i++;
      continue;
    }
    if (raw[i].startsWith('--')) continue;
    if (raw[i].includes('@')) email = raw[i].trim().toLowerCase();
  }
  if (!email) {
    console.error('Usage: node scripts/reanchor-gym-contract-from-stripe.js <email> [--apply] [--dry-run] [--start-date YYYY-MM-DD]');
    process.exit(1);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is required');
    process.exit(1);
  }

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

  const result = await reanchorGymContractForEmail(stripe, db, email, {
    manualStartYmd,
    dryRun
  });

  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
