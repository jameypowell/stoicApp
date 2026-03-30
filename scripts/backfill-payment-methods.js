#!/usr/bin/env node

/**
 * Backfill payment_method_id (and expiry) from Stripe into:
 *   - subscriptions (app)
 *   - gym_memberships (gym — with or without stripe_subscription_id)
 *
 * Usage:
 *   node scripts/backfill-payment-methods.js [--dry-run] [--reset-inactive] [--emails=a@x.com,b@y.com]
 *
 *   --dry-run          Log actions only
 *   --reset-inactive   Clear PM fields on inactive app subs / gym rows (use with care)
 *   --emails=          Comma-separated filter (default: all eligible rows)
 *
 * Requires: STRIPE_SECRET_KEY, database env (DB_HOST + credentials or local sqlite via DATABASE_URL)
 */

require('dotenv').config();

const Stripe = require('stripe');
const path = require('path');
const { Database, initDatabase } = require(path.join(__dirname, '..', 'database'));

const DRY_RUN = process.argv.includes('--dry-run');
const RESET_INACTIVE = process.argv.includes('--reset-inactive');
const emailsArg = process.argv.find((a) => a.startsWith('--emails='));
const EMAIL_FILTER = emailsArg
  ? emailsArg.split('=')[1].split(',').map((e) => e.trim().toLowerCase()).filter(Boolean)
  : null;

// Optional: default production RDS only if explicitly allowed (avoid accidental prod hits)
if (process.env.BACKFILL_USE_DEFAULT_RDS === '1' && !process.env.DB_HOST) {
  process.env.DB_HOST = 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
  process.env.DB_USER = process.env.DB_USER || 'stoicapp';
  process.env.DB_NAME = process.env.DB_NAME || 'postgres';
  process.env.DB_PORT = process.env.DB_PORT || '5432';
}

let stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey || stripeSecretKey.startsWith('sk_test_')) {
  try {
    const { execSync } = require('child_process');
    stripeSecretKey = execSync('node scripts/get-production-stripe-key.js --key-only 2>/dev/null', {
      encoding: 'utf-8',
      cwd: path.join(__dirname, '..')
    }).trim();
    if (stripeSecretKey) {
      console.log('✅ Using production Stripe key from get-production-stripe-key.js');
    }
  } catch (e) {
    /* ignore */
  }
}

if (!stripeSecretKey) {
  console.error('ERROR: STRIPE_SECRET_KEY is not set');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, { timeout: 20000, maxNetworkRetries: 2 });

function withTimeout(promise, timeoutMs = 20000) {
  return Promise.race([
    promise,
    new Promise((_, reject) =>
      setTimeout(() => reject(new Error(`Operation timed out after ${timeoutMs}ms`)), timeoutMs)
    )
  ]);
}

function delay(ms) {
  return Promise.resolve(new Promise((r) => setTimeout(r, ms)));
}

function pmIdFromStripeValue(v) {
  if (!v) return null;
  if (typeof v === 'string') return v;
  return v.id || null;
}

async function resolvePmFromSubscription(stripeSubscriptionId) {
  let stripeSub;
  try {
    stripeSub = await withTimeout(
      stripe.subscriptions.retrieve(stripeSubscriptionId, {
        expand: ['default_payment_method', 'latest_invoice.payment_intent']
      })
    );
  } catch (e) {
    if (e.code === 'resource_missing') return { error: 'missing_sub', customerId: null, pmId: null };
    throw e;
  }

  let paymentMethodId = pmIdFromStripeValue(stripeSub.default_payment_method);
  const customerId =
    typeof stripeSub.customer === 'string' ? stripeSub.customer : stripeSub.customer?.id || null;

  if (!paymentMethodId && customerId) {
    try {
      const customer = await withTimeout(stripe.customers.retrieve(customerId));
      paymentMethodId = pmIdFromStripeValue(customer.invoice_settings?.default_payment_method);
      await delay(150);
    } catch (e) {
      console.warn(`    ⚠️  customer retrieve: ${e.message}`);
    }
  }

  if (!paymentMethodId && stripeSub.latest_invoice) {
    try {
      const inv =
        typeof stripeSub.latest_invoice === 'string'
          ? await withTimeout(stripe.invoices.retrieve(stripeSub.latest_invoice, { expand: ['payment_intent'] }))
          : stripeSub.latest_invoice;
      const piRef = inv.payment_intent;
      if (piRef) {
        const pi =
          typeof piRef === 'string'
            ? await withTimeout(stripe.paymentIntents.retrieve(piRef))
            : piRef;
        paymentMethodId = pmIdFromStripeValue(pi.payment_method);
      }
      await delay(150);
    } catch (e) {
      console.warn(`    ⚠️  invoice/pi lookup: ${e.message}`);
    }
  }

  return { error: null, customerId, pmId: paymentMethodId };
}

async function resolvePmFromCustomerOnly(customerId) {
  if (!customerId) return { pmId: null };
  try {
    const customer = await withTimeout(stripe.customers.retrieve(customerId));
    let pmId = pmIdFromStripeValue(customer.invoice_settings?.default_payment_method);
    await delay(150);
    if (!pmId) {
      const list = await withTimeout(
        stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 5 })
      );
      if (list.data && list.data.length > 0) {
        pmId = list.data[0].id;
      }
      await delay(150);
    }
    return { pmId };
  } catch (e) {
    console.warn(`    ⚠️  customer-only resolve: ${e.message}`);
    return { pmId: null };
  }
}

async function fetchPmExpiry(pmId) {
  if (!pmId) return null;
  try {
    const pm = await withTimeout(stripe.paymentMethods.retrieve(pmId));
    if (pm.card && pm.card.exp_year && pm.card.exp_month) {
      return new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59, 59).toISOString();
    }
  } catch (e) {
    console.warn(`    ⚠️  PM retrieve: ${e.message}`);
  }
  return null;
}

function emailFilterSql(db, paramIndexStart = 1) {
  if (!EMAIL_FILTER || EMAIL_FILTER.length === 0) return { clause: '', params: [] };
  if (db.isPostgres) {
    return { clause: ` AND LOWER(u.email) = ANY($${paramIndexStart}::text[])`, params: [EMAIL_FILTER] };
  }
  const ph = EMAIL_FILTER.map(() => '?').join(',');
  return { clause: ` AND LOWER(u.email) IN (${ph})`, params: EMAIL_FILTER };
}

async function backfillAppSubscriptions(db) {
  console.log('\n=== App subscriptions (Stripe subscription → DB payment_method_id) ===');
  const { clause, params } = emailFilterSql(db, 1);
  const pmEmpty = db.isPostgres
    ? `(s.payment_method_id IS NULL OR TRIM(s.payment_method_id) = '')`
    : `(s.payment_method_id IS NULL OR s.payment_method_id = '')`;

  let sql = `
    SELECT s.*, u.email FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.stripe_subscription_id IS NOT NULL
      AND s.status = 'active'
      AND ${pmEmpty}
      ${clause}
    ORDER BY s.id ASC`;
  const result = await db.query(sql, params);
  const rows = result.rows || [];

  console.log(`Found ${rows.length} active app subscription(s) missing payment_method_id`);

  let updated = 0;
  let errors = 0;
  for (const subscription of rows) {
    try {
      console.log(`\n  Subscription id=${subscription.id} user=${subscription.email || subscription.user_id}`);
      const { error, pmId } = await resolvePmFromSubscription(subscription.stripe_subscription_id);
      if (error === 'missing_sub') {
        console.log(`    ⚠️  Stripe subscription missing — skip`);
        continue;
      }
      if (!pmId) {
        console.log(`    ⚠️  No payment method found in Stripe`);
        continue;
      }
      const exp = await fetchPmExpiry(pmId);
      console.log(`    → PM ${pmId}${exp ? ` (exp stored)` : ''}`);
      if (DRY_RUN) {
        updated++;
        continue;
      }
      await db.updateSubscriptionPaymentMethod(subscription.id, pmId, exp);
      updated++;
      await delay(200);
    } catch (e) {
      console.error(`    ❌ ${e.message}`);
      errors++;
    }
  }

  if (RESET_INACTIVE) {
    const inactive = await db.query(
      db.isPostgres
        ? `SELECT s.id FROM subscriptions s
           WHERE s.stripe_subscription_id IS NOT NULL
             AND s.status <> 'active'
             AND s.payment_method_id IS NOT NULL AND TRIM(s.payment_method_id) <> ''`
        : `SELECT s.id FROM subscriptions s
           WHERE s.stripe_subscription_id IS NOT NULL
             AND s.status <> 'active'
             AND s.payment_method_id IS NOT NULL AND s.payment_method_id <> ''`
    );
    const ir = inactive.rows || [];
    console.log(`\n  --reset-inactive: clearing PM on ${ir.length} inactive app subscription(s)`);
    for (const r of ir) {
      if (DRY_RUN) continue;
      await db.query(
        db.isPostgres
          ? `UPDATE subscriptions SET payment_method_id = NULL, payment_method_expires_at = NULL,
             payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL WHERE id = $1`
          : `UPDATE subscriptions SET payment_method_id = NULL, payment_method_expires_at = NULL,
             payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL WHERE id = ?`,
        [r.id]
      );
    }
  }

  console.log(`\nApp subscriptions: ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

async function backfillGymWithStripeSubscription(db) {
  console.log('\n=== Gym memberships (has stripe_subscription_id) ===');
  const { clause, params } = emailFilterSql(db, 1);
  const pmEmpty = db.isPostgres
    ? `(g.payment_method_id IS NULL OR TRIM(g.payment_method_id) = '')`
    : `(g.payment_method_id IS NULL OR g.payment_method_id = '')`;

  const sql = `
    SELECT g.*, u.email FROM gym_memberships g
    JOIN users u ON u.id = g.user_id
    WHERE g.stripe_subscription_id IS NOT NULL
      AND g.status IN ('active', 'paused', 'past_due', 'grace_period')
      AND (g.membership_type IS NULL OR g.membership_type <> 'free_trial')
      AND ${pmEmpty}
      ${clause}
    ORDER BY g.id ASC`;
  const result = await db.query(sql, params);
  const rows = result.rows || [];

  console.log(`Found ${rows.length} gym row(s) with subscription, missing payment_method_id`);

  let updated = 0;
  let errors = 0;
  for (const membership of rows) {
    try {
      console.log(`\n  Gym id=${membership.id} user=${membership.email || membership.user_id}`);
      const { error, pmId, customerId } = await resolvePmFromSubscription(membership.stripe_subscription_id);
      if (error === 'missing_sub') {
        console.log(`    ⚠️  Stripe subscription missing — skip`);
        continue;
      }
      if (!pmId) {
        console.log(`    ⚠️  No PM on subscription/customer/invoice`);
        continue;
      }
      const exp = await fetchPmExpiry(pmId);
      console.log(`    → PM ${pmId}`);
      if (DRY_RUN) {
        updated++;
        continue;
      }
      await db.updateGymMembershipPaymentMethod(membership.id, pmId, exp);
      if (membership.stripe_subscription_id) {
        try {
          await stripe.subscriptions.update(membership.stripe_subscription_id, {
            default_payment_method: pmId
          });
        } catch (e) {
          console.warn(`    ⚠️  Could not set sub default PM: ${e.message}`);
        }
      }
      if (customerId) {
        try {
          await stripe.customers.update(customerId, {
            invoice_settings: { default_payment_method: pmId }
          });
        } catch (e) {
          console.warn(`    ⚠️  Could not set customer default PM: ${e.message}`);
        }
      }
      updated++;
      await delay(200);
    } catch (e) {
      console.error(`    ❌ ${e.message}`);
      errors++;
    }
  }

  console.log(`\nGym (with subscription): ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

async function backfillGymCustomerOnly(db) {
  console.log('\n=== Gym memberships (app-managed billing: Stripe customer only) ===');
  const { clause, params } = emailFilterSql(db, 1);
  const pmEmpty = db.isPostgres
    ? `(g.payment_method_id IS NULL OR TRIM(g.payment_method_id) = '')`
    : `(g.payment_method_id IS NULL OR g.payment_method_id = '')`;

  const customerExpr = db.isPostgres
    ? `COALESCE(NULLIF(TRIM(g.stripe_customer_id), ''), NULLIF(TRIM(u.stripe_customer_id), ''))`
    : `COALESCE(NULLIF(g.stripe_customer_id, ''), NULLIF(u.stripe_customer_id, ''))`;

  const sql = `
    SELECT g.*, u.email, u.stripe_customer_id AS user_stripe_customer_id FROM gym_memberships g
    JOIN users u ON u.id = g.user_id
    WHERE (g.stripe_subscription_id IS NULL OR TRIM(COALESCE(g.stripe_subscription_id, '')) = '')
      AND g.status IN ('active', 'paused', 'past_due', 'grace_period')
      AND (g.membership_type IS NULL OR g.membership_type <> 'free_trial')
      AND ${pmEmpty}
      AND ${customerExpr} IS NOT NULL
      ${clause}
    ORDER BY g.id ASC`;

  // SQLite doesn't have TRIM in same way for empty subscription - simplify for sqlite
  const sqlSqlite = `
    SELECT g.*, u.email, u.stripe_customer_id AS user_stripe_customer_id FROM gym_memberships g
    JOIN users u ON u.id = g.user_id
    WHERE (g.stripe_subscription_id IS NULL OR g.stripe_subscription_id = '')
      AND g.status IN ('active', 'paused', 'past_due', 'grace_period')
      AND (g.membership_type IS NULL OR g.membership_type <> 'free_trial')
      AND ${pmEmpty}
      AND (COALESCE(g.stripe_customer_id, '') <> '' OR COALESCE(u.stripe_customer_id, '') <> '')
      ${clause}
    ORDER BY g.id ASC`;

  const result = await db.query(db.isPostgres ? sql : sqlSqlite, params);
  const rows = result.rows || [];

  console.log(`Found ${rows.length} gym row(s) with customer id, no subscription, missing payment_method_id`);

  let updated = 0;
  let errors = 0;
  for (const membership of rows) {
    try {
      const customerId =
        (membership.stripe_customer_id && String(membership.stripe_customer_id).trim()) ||
        (membership.user_stripe_customer_id && String(membership.user_stripe_customer_id).trim()) ||
        null;
      console.log(`\n  Gym id=${membership.id} user=${membership.email} customer=${customerId}`);
      const { pmId } = await resolvePmFromCustomerOnly(customerId);
      if (!pmId) {
        console.log(`    ⚠️  No saved card on Stripe customer`);
        continue;
      }
      const exp = await fetchPmExpiry(pmId);
      console.log(`    → PM ${pmId}`);
      if (DRY_RUN) {
        updated++;
        continue;
      }
      await db.updateGymMembershipPaymentMethod(membership.id, pmId, exp);
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: pmId }
      });
      if (!membership.stripe_customer_id && customerId) {
        await db.query(
          db.isPostgres
            ? `UPDATE gym_memberships SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
            : `UPDATE gym_memberships SET stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?`,
          [customerId, membership.id]
        );
      }
      updated++;
      await delay(200);
    } catch (e) {
      console.error(`    ❌ ${e.message}`);
      errors++;
    }
  }

  console.log(`\nGym (customer only): ${updated} updated, ${errors} errors`);
  return { updated, errors };
}

async function resetInactiveGym(db) {
  if (!RESET_INACTIVE) return 0;
  const inactive = await db.query(
    db.isPostgres
      ? `SELECT id FROM gym_memberships
         WHERE stripe_subscription_id IS NOT NULL
           AND status NOT IN ('active', 'paused', 'past_due', 'grace_period')
           AND payment_method_id IS NOT NULL AND TRIM(payment_method_id) <> ''`
      : `SELECT id FROM gym_memberships
         WHERE stripe_subscription_id IS NOT NULL
           AND status NOT IN ('active', 'paused', 'past_due', 'grace_period')
           AND payment_method_id IS NOT NULL AND payment_method_id <> ''`
  );
  const rows = inactive.rows || [];
  console.log(`\n  --reset-inactive: clearing PM on ${rows.length} inactive gym row(s) (had subscription id)`);
  if (DRY_RUN) return rows.length;
  for (const r of rows) {
    await db.query(
      db.isPostgres
        ? `UPDATE gym_memberships SET payment_method_id = NULL, payment_method_expires_at = NULL,
           payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL WHERE id = $1`
        : `UPDATE gym_memberships SET payment_method_id = NULL, payment_method_expires_at = NULL,
           payment_failure_count = 0, last_payment_failure_at = NULL, grace_period_ends_at = NULL WHERE id = ?`,
      [r.id]
    );
  }
  return rows.length;
}

async function main() {
  console.log(`\n${'='.repeat(60)}`);
  console.log(
    `${DRY_RUN ? 'DRY RUN — ' : ''}Backfill payment methods from Stripe (all eligible users${
      EMAIL_FILTER ? `, emails=${EMAIL_FILTER.join(',')}` : ''
    })`
  );
  if (RESET_INACTIVE) console.log('⚠️  --reset-inactive enabled (will clear PM on inactive rows)');
  console.log(`Started: ${new Date().toISOString()}`);
  console.log('='.repeat(60));

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  try {
    const a = await backfillAppSubscriptions(db);
    const g1 = await backfillGymWithStripeSubscription(db);
    const g2 = await backfillGymCustomerOnly(db);
    const resetG = await resetInactiveGym(db);

    console.log('\n' + '='.repeat(60));
    console.log('Summary');
    console.log(`  App subscriptions updated: ${a.updated}`);
    console.log(`  Gym (with sub) updated:    ${g1.updated}`);
    console.log(`  Gym (customer only) updated: ${g2.updated}`);
    console.log(`  Inactive gym PM cleared:   ${resetG}`);
    console.log(`  Errors (app/gym1/gym2):    ${a.errors} / ${g1.errors} / ${g2.errors}`);
    console.log(`Ended: ${new Date().toISOString()}`);
    console.log('='.repeat(60) + '\n');
  } catch (error) {
    console.error('\n❌ Fatal:', error);
    process.exit(1);
  } finally {
    if (db.client) await db.client.end();
  }
}

if (require.main === module) {
  main().catch((e) => {
    console.error(e);
    process.exit(1);
  });
}

module.exports = { main };
