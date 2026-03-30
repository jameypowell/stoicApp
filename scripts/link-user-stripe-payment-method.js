#!/usr/bin/env node
require('dotenv').config();

const { Client } = require('pg');
const Stripe = require('stripe');
const { execSync } = require('child_process');

async function main() {
  const email = (process.argv[2] || '').trim().toLowerCase();
  if (!email) {
    console.error('Usage: node scripts/link-user-stripe-payment-method.js <email>');
    process.exit(1);
  }

  let stripeKey = process.env.STRIPE_SECRET_KEY || '';
  if (!stripeKey || stripeKey.startsWith('sk_test_')) {
    stripeKey = execSync('node scripts/get-production-stripe-key.js --key-only', { encoding: 'utf8' }).trim();
  }

  if (!stripeKey) {
    throw new Error('Missing STRIPE_SECRET_KEY');
  }

  const db = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'postgres',
    port: Number(process.env.DB_PORT || 5432),
    ssl: { rejectUnauthorized: false }
  });

  if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
    throw new Error('Missing DB_HOST/DB_USER/DB_PASSWORD env vars');
  }

  const stripe = new Stripe(stripeKey, { timeout: 20000, maxNetworkRetries: 2 });

  await db.connect();
  try {
    const userRes = await db.query(
      'SELECT id, email, stripe_customer_id FROM users WHERE LOWER(email) = $1 LIMIT 1',
      [email]
    );
    if (!userRes.rows.length) {
      throw new Error(`User not found: ${email}`);
    }
    const user = userRes.rows[0];

    const customerList = await stripe.customers.list({ email, limit: 10 });
    const customers = (customerList.data || []).filter((c) => !c.deleted);
    if (!customers.length) {
      throw new Error(`No Stripe customers found for ${email}`);
    }

    // Prefer customer already carrying a default PM.
    let customer =
      customers.find((c) => c.invoice_settings && c.invoice_settings.default_payment_method) ||
      customers[0];
    const customerId = customer.id;

    let paymentMethodId = null;
    const defaultPm = customer.invoice_settings && customer.invoice_settings.default_payment_method;
    if (defaultPm) {
      paymentMethodId = typeof defaultPm === 'string' ? defaultPm : defaultPm.id;
    }
    if (!paymentMethodId) {
      const pms = await stripe.paymentMethods.list({ customer: customerId, type: 'card', limit: 1 });
      if (pms.data && pms.data.length > 0) {
        paymentMethodId = pms.data[0].id;
      }
    }

    if (user.stripe_customer_id !== customerId) {
      await db.query('UPDATE users SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [
        customerId,
        user.id
      ]);
    }

    if (paymentMethodId) {
      await stripe.customers.update(customerId, {
        invoice_settings: { default_payment_method: paymentMethodId }
      });
    }

    const gmRes = await db.query(
      'SELECT id, stripe_customer_id, payment_method_id FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1',
      [user.id]
    );

    let gymMembershipId = null;
    if (gmRes.rows.length) {
      const gm = gmRes.rows[0];
      gymMembershipId = gm.id;
      await db.query(
        `UPDATE gym_memberships
         SET stripe_customer_id = COALESCE(NULLIF(TRIM(stripe_customer_id), ''), $1),
             payment_method_id = COALESCE(NULLIF(TRIM(payment_method_id), ''), $2),
             updated_at = CURRENT_TIMESTAMP
         WHERE id = $3`,
        [customerId, paymentMethodId, gm.id]
      );
    }

    console.log(
      JSON.stringify(
        {
          success: true,
          email,
          userId: user.id,
          stripeCustomerId: customerId,
          paymentMethodId: paymentMethodId || null,
          gymMembershipId
        },
        null,
        2
      )
    );
  } finally {
    await db.end();
  }
}

main().catch((err) => {
  console.error(err.message || err);
  process.exit(1);
});
