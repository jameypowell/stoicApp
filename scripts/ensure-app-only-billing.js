#!/usr/bin/env node
/**
 * Move billing to app-controlled flows only (nightly PaymentIntents / webhooks),
 * not Stripe Subscription invoices.
 *
 * 1) For every non-empty subscriptions.stripe_subscription_id and gym_memberships.stripe_subscription_id:
 *    - Retrieve Stripe subscription.
 *    - If still billable (active, trialing, past_due): optionally copy default PM to DB row, then cancel in Stripe.
 *    - Always clear stripe_subscription_id (and gym item id) in DB for that id once Stripe is canceled or already dead.
 *
 * Default: dry-run (prints JSON plan, no Stripe cancel, no DB writes).
 *   node scripts/ensure-app-only-billing.js
 * Apply:
 *   node scripts/ensure-app-only-billing.js --execute
 *
 * Safety:
 *   --skip-pm-check   Proceed with cancel even if app subscription row has no payment_method_id after Stripe copy attempt
 *
 * Env: DB_* (Postgres), STRIPE_SECRET_KEY (must match DB environment, e.g. live for prod).
 */

require('dotenv').config();
const { Client } = require('pg');
const Stripe = require('stripe');

const BILLABLE = new Set(['active', 'trialing', 'past_due']);

function parseFlags() {
  const execute = process.argv.includes('--execute');
  const skipPmCheck = process.argv.includes('--skip-pm-check');
  return { execute, skipPmCheck };
}

async function resolveDefaultPmId(stripe, stripeSub) {
  let pm =
    stripeSub.default_payment_method &&
    (typeof stripeSub.default_payment_method === 'string'
      ? stripeSub.default_payment_method
      : stripeSub.default_payment_method.id);
  if (pm) return pm;
  const cid = typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer && stripeSub.customer.id;
  if (!cid) return null;
  const cust = await stripe.customers.retrieve(cid, {
    expand: ['invoice_settings.default_payment_method']
  });
  if (cust.invoice_settings && cust.invoice_settings.default_payment_method) {
    const d = cust.invoice_settings.default_payment_method;
    return typeof d === 'string' ? d : d.id;
  }
  const pms = await stripe.paymentMethods.list({ customer: cid, type: 'card', limit: 1 });
  if (pms.data && pms.data[0]) return pms.data[0].id;
  return null;
}

async function ensurePmOnAppRow(client, stripe, row, stripeSub) {
  if (row.payment_method_id && String(row.payment_method_id).trim()) return true;
  const pm = await resolveDefaultPmId(stripe, stripeSub);
  if (!pm) return false;
  await client.query(`UPDATE subscriptions SET payment_method_id = $1 WHERE id = $2`, [pm, row.subscription_row_id]);
  row.payment_method_id = pm;
  return true;
}

async function ensurePmOnGymRow(client, stripe, row, stripeSub) {
  if (row.payment_method_id && String(row.payment_method_id).trim()) return true;
  const pm = await resolveDefaultPmId(stripe, stripeSub);
  if (!pm) return false;
  await client.query(
    `UPDATE gym_memberships SET payment_method_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`,
    [pm, row.gym_row_id]
  );
  row.payment_method_id = pm;
  return true;
}

function customerMatches(stripeCustomerId, expected) {
  const a = stripeCustomerId && String(stripeCustomerId).trim();
  const b = expected && String(expected).trim();
  if (!a || !b) return false;
  return a === b;
}

async function main() {
  const { execute, skipPmCheck } = parseFlags();

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('STRIPE_SECRET_KEY is required.');
    process.exit(1);
  }
  if (!process.env.DB_HOST) {
    console.error('DB_HOST is required (Postgres).');
    process.exit(1);
  }

  const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });
  await client.connect();

  const { rows: appRows } = await client.query(
    `SELECT s.id AS subscription_row_id,
            s.user_id,
            s.tier,
            s.status AS sub_status,
            TRIM(s.stripe_subscription_id) AS stripe_subscription_id,
            s.payment_method_id,
            COALESCE(NULLIF(TRIM(s.stripe_customer_id), ''), NULLIF(TRIM(u.stripe_customer_id), '')) AS effective_customer_id,
            u.email AS user_email
     FROM subscriptions s
     JOIN users u ON u.id = s.user_id
     WHERE s.stripe_subscription_id IS NOT NULL AND TRIM(s.stripe_subscription_id) <> ''`
  );

  const { rows: gymRows } = await client.query(
    `SELECT gm.id AS gym_row_id,
            gm.user_id,
            gm.status AS gym_status,
            TRIM(gm.stripe_subscription_id) AS stripe_subscription_id,
            gm.payment_method_id,
            NULLIF(TRIM(gm.stripe_customer_id), '') AS effective_customer_id,
            u.email AS user_email
     FROM gym_memberships gm
     JOIN users u ON u.id = gm.user_id
     WHERE gm.stripe_subscription_id IS NOT NULL AND TRIM(gm.stripe_subscription_id) <> ''`
  );

  /** @type {Map<string, {source:'app'|'gym', rows: object[]}>} */
  const bySubId = new Map();
  function add(source, row) {
    const sid = row.stripe_subscription_id;
    if (!sid) return;
    if (!bySubId.has(sid)) bySubId.set(sid, { source, rows: [row] });
    else {
      const e = bySubId.get(sid);
      e.rows.push(row);
      if (e.source !== source) e.source = 'both';
    }
  }
  for (const r of appRows) add('app', r);
  for (const r of gymRows) add('gym', r);

  const plan = [];
  const errors = [];

  for (const [subId, entry] of [...bySubId.entries()].sort()) {
    const step = {
      stripe_subscription_id: subId,
      db_sources: entry.rows.map((r) =>
        r.subscription_row_id != null
          ? { type: 'subscriptions', id: r.subscription_row_id, user_id: r.user_id, email: r.user_email }
          : { type: 'gym_memberships', id: r.gym_row_id, user_id: r.user_id, email: r.user_email }
      ),
      stripe_status: null,
      stripe_customer_id: null,
      action: null,
      detail: null,
      pm_ok_after_copy: null
    };

    let stripeSub;
    try {
      stripeSub = await stripe.subscriptions.retrieve(subId, {
        expand: ['default_payment_method', 'customer']
      });
    } catch (e) {
      step.action = 'clear_db_only';
      step.detail = `stripe_retrieve_failed: ${e.message || e}`;
      plan.push(step);
      continue;
    }

    step.stripe_status = stripeSub.status;
    const custId =
      typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer && stripeSub.customer.id;
    step.stripe_customer_id = custId;

    const customerOk = entry.rows.every((r) => customerMatches(custId, r.effective_customer_id));
    if (!customerOk) {
      step.action = 'skip';
      step.detail = 'stripe_customer_mismatch_vs_db_row_refuse_cancel';
      plan.push(step);
      errors.push({ subId, reason: step.detail });
      continue;
    }

    if (!BILLABLE.has(stripeSub.status)) {
      step.action = 'clear_db_only';
      step.detail = `stripe_already_inactive_${stripeSub.status}`;
      plan.push(step);
      continue;
    }

    // Billable: need cancel + clear; ensure PM on app/gym rows for renewals
    const anyNeedsPm = entry.rows.some((r) => !(r.payment_method_id && String(r.payment_method_id).trim()));
    const dryPm = !execute && anyNeedsPm ? await resolveDefaultPmId(stripe, stripeSub) : null;

    let pmOk = true;
    for (const r of entry.rows) {
      const needsPm = !(r.payment_method_id && String(r.payment_method_id).trim());
      if (!needsPm) continue;
      if (execute) {
        const ok =
          r.subscription_row_id != null
            ? await ensurePmOnAppRow(client, stripe, r, stripeSub)
            : await ensurePmOnGymRow(client, stripe, r, stripeSub);
        if (!ok) pmOk = false;
      } else {
        pmOk = pmOk && !!dryPm;
      }
    }
    step.pm_ok_after_copy = pmOk;

    if (!pmOk && !skipPmCheck) {
      step.action = 'skip';
      step.detail = 'missing_payment_method_on_db_row_and_stripe_copy_failed_use_skip_pm_check_to_override';
      plan.push(step);
      errors.push({ subId, reason: step.detail });
      continue;
    }

    step.action = execute ? 'cancel_stripe_then_clear_db' : 'would_cancel_stripe_then_clear_db';
    plan.push(step);
  }

  if (!execute) {
    console.log(
      JSON.stringify(
        {
          mode: 'dry_run',
          summary: {
            distinct_stripe_subscription_ids: bySubId.size,
            would_clear_db_only: plan.filter((p) => p.action === 'clear_db_only').length,
            would_cancel: plan.filter((p) => p.action === 'would_cancel_stripe_then_clear_db').length,
            skipped: plan.filter((p) => p.action === 'skip').length
          },
          plan,
          errors
        },
        null,
        2
      )
    );
    await client.end();
    process.exit(errors.length ? 2 : 0);
  }

  // --execute
  const results = [];
  for (const step of plan) {
    const subId = step.stripe_subscription_id;
    if (step.action === 'skip') {
      results.push({ subId, result: 'skipped', detail: step.detail });
      continue;
    }
    if (step.action === 'clear_db_only') {
      await client.query(
        `UPDATE subscriptions SET stripe_subscription_id = NULL WHERE TRIM(stripe_subscription_id) = $1`,
        [subId]
      );
      await client.query(
        `UPDATE gym_memberships SET stripe_subscription_id = NULL, stripe_subscription_item_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE TRIM(stripe_subscription_id) = $1`,
        [subId]
      );
      results.push({ subId, result: 'cleared_db_stale_sub', detail: step.detail });
      continue;
    }
    if (step.action === 'cancel_stripe_then_clear_db') {
      try {
        await stripe.subscriptions.cancel(subId);
      } catch (e) {
        results.push({ subId, result: 'stripe_cancel_failed', error: e.message || String(e) });
        errors.push({ subId, error: e.message });
        continue;
      }
      await client.query(
        `UPDATE subscriptions SET stripe_subscription_id = NULL WHERE TRIM(stripe_subscription_id) = $1`,
        [subId]
      );
      await client.query(
        `UPDATE gym_memberships SET stripe_subscription_id = NULL, stripe_subscription_item_id = NULL, updated_at = CURRENT_TIMESTAMP WHERE TRIM(stripe_subscription_id) = $1`,
        [subId]
      );
      results.push({ subId, result: 'canceled_and_cleared_db' });
    }
  }

  console.log(JSON.stringify({ mode: 'execute', results, errors }, null, 2));
  await client.end();
  process.exit(errors.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
