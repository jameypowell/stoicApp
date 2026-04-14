#!/usr/bin/env node
/**
 * Sync payments.status from Stripe for PaymentIntents that are refunded in Stripe
 * but still marked succeeded (or other) in the DB.
 *
 * Default scope: recent Stripe charge.refunded events (unique payment_intent ids).
 *
 * Requires: STRIPE_SECRET_KEY, DATABASE_URL or DB_HOST + DB_USER + DB_PASSWORD.
 *
 *   node scripts/backfill-payment-refund-status-from-stripe.js           # dry-run
 *   node scripts/backfill-payment-refund-status-from-stripe.js --execute
 *   node scripts/backfill-payment-refund-status-from-stripe.js --execute --event-limit 50
 */

'use strict';

require('dotenv').config();
const { Client } = require('pg');
const Stripe = require('stripe');

function createPgClient() {
  const url = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim();
  if (url) {
    return new Client({
      connectionString: url,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD) {
    return new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
    });
  }
  throw new Error('Set DATABASE_URL or DB_HOST + DB_USER + DB_PASSWORD for Postgres.');
}

function parseIntArg(name, def) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf(name);
  if (i >= 0 && argv[i + 1]) {
    const n = parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return Math.min(200, n);
  }
  return def;
}

async function stripeRefundStatus(stripe, piId) {
  const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
  let ch = pi.latest_charge;
  if (!ch) return { stripeStatus: null, desired: null };
  if (typeof ch === 'string') {
    ch = await stripe.charges.retrieve(ch);
  }
  const amount = Number(ch.amount) || 0;
  const ar = Number(ch.amount_refunded) || 0;
  if (ar <= 0) return { stripeStatus: ch.status, desired: null };
  const desired = amount > 0 && ar >= amount ? 'refunded' : 'partially_refunded';
  return { stripeStatus: ch.status, desired, amount, amountRefunded: ar };
}

async function main() {
  const execute = process.argv.includes('--execute');
  const eventLimit = parseIntArg('--event-limit', 50);
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk || !String(sk).trim()) {
    console.error('Missing STRIPE_SECRET_KEY.');
    process.exit(1);
  }

  const stripe = new Stripe(sk);
  const events = await stripe.events.list({ type: 'charge.refunded', limit: eventLimit });
  const seenPi = new Set();
  const piIds = [];
  for (const e of events.data) {
    const ch = e.data && e.data.object;
    const pi = ch && ch.payment_intent;
    const piId = typeof pi === 'string' ? pi : pi && pi.id;
    if (!piId || seenPi.has(piId)) continue;
    seenPi.add(piId);
    piIds.push(piId);
  }

  if (!piIds.length) {
    console.log('No charge.refunded events in window.');
    process.exit(0);
  }

  const client = createPgClient();
  await client.connect();

  let updated = 0;
  let skipped = 0;
  let missing = 0;
  let already = 0;

  for (const piId of piIds) {
    const { rows } = await client.query(
      `SELECT id, status, tier, user_id FROM payments WHERE stripe_payment_intent_id = $1`,
      [piId]
    );
    if (!rows.length) {
      let hint = '';
      try {
        const meta = await stripeRefundStatus(stripe, piId);
        if (meta.desired) {
          const pi = await stripe.paymentIntents.retrieve(piId, { expand: ['latest_charge'] });
          const ch = pi.latest_charge;
          const c = typeof ch === 'object' && ch ? ch : null;
          if (c && c.metadata) {
            hint = ` metadata.userId=${c.metadata.userId || ''} metadata.user_id=${c.metadata.user_id || ''}`;
          }
        }
      } catch (_) {
        /* ignore */
      }
      console.log(`[no row] pi=${piId}${hint}`);
      missing++;
      continue;
    }

    const row = rows[0];
    if (row.status === 'refunded' || row.status === 'partially_refunded') {
      already++;
      continue;
    }

    let desired;
    try {
      const r = await stripeRefundStatus(stripe, piId);
      desired = r.desired;
      if (!desired) {
        console.log(`[skip] pi=${piId} payments.id=${row.id} db=${row.status} stripe has no amount_refunded`);
        skipped++;
        continue;
      }
    } catch (e) {
      console.warn(`[skip] pi=${piId} Stripe error: ${e.message}`);
      skipped++;
      continue;
    }

    if (row.status === desired) {
      already++;
      continue;
    }

    if (!execute) {
      console.log(`[dry-run] UPDATE payments SET status='${desired}' WHERE id=${row.id} (pi=${piId}, was '${row.status}')`);
      updated++;
      continue;
    }

    await client.query(`UPDATE payments SET status = $1 WHERE id = $2`, [desired, row.id]);
    console.log(`[applied] payments.id=${row.id} pi=${piId} '${row.status}' -> '${desired}' tier=${row.tier}`);
    updated++;
  }

  await client.end();

  const mode = execute ? 'execute' : 'dry-run';
  console.log(`\nDone (${mode}). updated=${updated} already_ok=${already} missing_row=${missing} skipped=${skipped}`);
  if (!execute && updated > 0) {
    console.log('Re-run with --execute to apply updates.');
  }
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
