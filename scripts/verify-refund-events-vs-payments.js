#!/usr/bin/env node
/**
 * Read-only: recent Stripe charge.refunded events vs payments.stripe_payment_intent_id.
 *
 * Requires: STRIPE_SECRET_KEY, and either DATABASE_URL or DB_HOST + DB_USER + DB_PASSWORD.
 *
 *   node scripts/verify-refund-events-vs-payments.js
 *   node scripts/verify-refund-events-vs-payments.js --limit 30
 */

'use strict';

require('dotenv').config();
const { Client } = require('pg');
const Stripe = require('stripe');

function parseLimit(argv) {
  const i = argv.indexOf('--limit');
  if (i >= 0 && argv[i + 1]) {
    const n = parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) return Math.min(100, n);
  }
  return 25;
}

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

async function main() {
  const sk = process.env.STRIPE_SECRET_KEY;
  if (!sk || !String(sk).trim()) {
    console.error('Missing STRIPE_SECRET_KEY.');
    process.exit(1);
  }

  const limit = parseLimit(process.argv.slice(2));
  const stripe = new Stripe(sk);
  const events = await stripe.events.list({ type: 'charge.refunded', limit });
  if (!events.data.length) {
    console.log('No charge.refunded events returned (try a higher --limit).');
    process.exit(0);
  }

  const rows = [];
  const seenPi = new Set();
  for (const e of events.data) {
    const ch = e.data && e.data.object;
    const pi = ch && ch.payment_intent;
    const piId = typeof pi === 'string' ? pi : pi && pi.id;
    if (!piId || seenPi.has(piId)) continue;
    seenPi.add(piId);
    rows.push({
      eventId: e.id,
      eventAt: new Date(e.created * 1000).toISOString(),
      chargeId: ch && ch.id,
      piId,
      amountRefunded: ch && ch.amount_refunded,
      chargeAmount: ch && ch.amount
    });
  }

  const piIds = rows.map((r) => r.piId);
  const client = createPgClient();
  await client.connect();

  const q = await client.query(
    `SELECT id, user_id, stripe_payment_intent_id, status, tier, amount, currency, created_at
     FROM payments
     WHERE stripe_payment_intent_id = ANY($1::text[])`,
    [piIds]
  );
  await client.end();

  const byPi = new Map();
  for (const p of q.rows) {
    byPi.set(p.stripe_payment_intent_id, p);
  }

  let ok = 0;
  let missing = 0;
  let wrongStatus = 0;

  console.log(`Stripe charge.refunded sample: ${events.data.length} events, ${rows.length} unique payment_intents (limit ${limit}).\n`);

  for (const r of rows) {
    const p = byPi.get(r.piId);
    if (!p) {
      console.log(`❌ NO ROW  ${r.eventAt}  pi=${r.piId}  charge=${r.chargeId}`);
      missing++;
      continue;
    }
    const good = p.status === 'refunded' || p.status === 'partially_refunded';
    if (good) {
      console.log(`✅ ${p.status.padEnd(20)} ${r.eventAt}  pi=${r.piId}  payments.id=${p.id} tier=${p.tier}`);
      ok++;
    } else {
      console.log(`⚠️  status=${p.status} (expected refunded/partially_refunded)  ${r.eventAt}  pi=${r.piId}  payments.id=${p.id}`);
      wrongStatus++;
    }
  }

  console.log(`\nSummary: ${ok} matched with refund status, ${wrongStatus} row but wrong status, ${missing} no payments row.`);
  process.exit(missing + wrongStatus > 0 ? 4 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
