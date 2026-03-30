/**
 * Find a user by name (signed up today) and list all payments/charges for them.
 * Usage: node scripts/check_charges_for_user.js "Haze Hadley"
 * Requires: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional)
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { Client } = require('pg');

const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_PORT = process.env.DB_PORT || 5432;

const nameArg = process.argv[2];
if (!nameArg) {
  console.error('Usage: node scripts/check_charges_for_user.js "First Last"');
  process.exit(1);
}

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('Missing DB credentials. Set DB_HOST, DB_USER, DB_PASSWORD (and optionally DB_NAME, DB_PORT).');
  process.exit(1);
}

async function run() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();

    // Find users with this name who were created today (server date), or last 2 days if none (timezone fallback)
    const searchPattern = '%' + nameArg.trim().toLowerCase().replace(/\s+/, '%') + '%';
    let userResult = await client.query(
      `SELECT id, email, name, created_at
       FROM users
       WHERE created_at::date = CURRENT_DATE
         AND (LOWER(name) LIKE $1 OR LOWER(name) LIKE '%haze%hadley%')
       ORDER BY created_at DESC`,
      [searchPattern]
    );

    if (userResult.rows.length === 0) {
      const fallback = await client.query(
        `SELECT id, email, name, created_at
         FROM users
         WHERE created_at >= CURRENT_DATE - INTERVAL '2 days'
           AND (LOWER(name) LIKE $1 OR LOWER(name) LIKE '%haze%' AND LOWER(name) LIKE '%hadley%')
         ORDER BY created_at DESC`,
        [searchPattern]
      );
      if (fallback.rows.length > 0) {
        console.log('(No signup strictly today; showing matches from last 2 days.)');
        userResult.rows = fallback.rows;
      }
    }

    if (userResult.rows.length === 0) {
      const fallback2 = await client.query(
        `SELECT id, email, name, created_at
         FROM users
         WHERE created_at::date = CURRENT_DATE
           AND (LOWER(name) LIKE '%haze%' OR LOWER(name) LIKE '%hadley%')
         ORDER BY created_at DESC`,
        []
      );
      if (fallback2.rows.length === 0) {
        console.log('No user found with name like "Haze Hadley" who signed up today (or last 2 days).');
        await client.end();
        process.exit(0);
      }
      userResult.rows = fallback2.rows;
    }

    for (const user of userResult.rows) {
      console.log('\n--- User ---');
      console.log('ID:', user.id);
      console.log('Email:', user.email);
      console.log('Name:', user.name);
      console.log('Created:', user.created_at);

      const payments = await client.query(
        `SELECT id, stripe_payment_intent_id, amount, currency, tier, status, created_at, email as payment_email
         FROM payments
         WHERE user_id = $1
         ORDER BY created_at ASC`,
        [user.id]
      );

      console.log('\nPayments (all time for this user):', payments.rows.length);
      if (payments.rows.length === 0) {
        console.log('  (none)');
      } else {
        payments.rows.forEach((p, i) => {
          console.log(`  ${i + 1}. $${(p.amount / 100).toFixed(2)} ${p.currency} | ${p.tier} | ${p.status} | ${p.created_at} | intent: ${p.stripe_payment_intent_id || 'N/A'}`);
        });
      }

      const todayPayments = payments.rows.filter(
        p => p.created_at && new Date(p.created_at).toDateString() === new Date().toDateString()
      );
      console.log('\nCharges today:', todayPayments.length);
      if (todayPayments.length > 1) {
        console.log('*** Multiple charges today — possible duplicate. ***');
      }
    }

    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    await client.end();
    process.exit(1);
  }
}

run();
