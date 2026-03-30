/**
 * Set custom monthly amount (and optional discount name) for a gym membership by user email.
 * Use when a member has an admin-set rate (e.g. after discounts) but monthly_amount_cents was never set.
 *
 * Usage (with production DB env):
 *   node scripts/set_monthly_amount_for_user.js sharla.barber@nebo.edu 50
 *   node scripts/set_monthly_amount_for_user.js sharla.barber@nebo.edu 50 "Nebo Educator"
 *
 * This sets monthly_amount_cents and optionally discount_name for that user's latest gym_membership.
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const email = (process.argv[2] || '').trim().toLowerCase();
const amountDollars = parseFloat(process.argv[3] || '0', 10);
const discountName = (process.argv[4] || '').trim() || null;

if (!email || isNaN(amountDollars) || amountDollars < 0) {
  console.error('Usage: node scripts/set_monthly_amount_for_user.js <email> <amount_dollars> [discount_name]');
  console.error('Example: node scripts/set_monthly_amount_for_user.js sharla.barber@nebo.edu 50 "Nebo Educator"');
  process.exit(1);
}

const USE_POSTGRES = !!process.env.DB_HOST;

async function run() {
  if (!USE_POSTGRES) {
    console.error('This script expects PostgreSQL (DB_HOST). Use for production.');
    process.exit(1);
  }
  const { Client } = require('pg');
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });

  try {
    await client.connect();

    const userRes = await client.query('SELECT id FROM users WHERE LOWER(email) = $1', [email]);
    const user = userRes.rows[0] || null;
    if (!user) {
      console.error('User not found for email:', email);
      await client.end();
      process.exit(1);
    }

    const amountCents = Math.round(amountDollars * 100);
    const updateRes = await client.query(
      discountName !== null
        ? `UPDATE gym_memberships
           SET monthly_amount_cents = $1, discount_name = $2
           WHERE user_id = $3
           AND id = (SELECT id FROM gym_memberships WHERE user_id = $3 ORDER BY created_at DESC LIMIT 1)
           RETURNING id, user_id, monthly_amount_cents, discount_name`
        : `UPDATE gym_memberships
           SET monthly_amount_cents = $1
           WHERE user_id = $2
           AND id = (SELECT id FROM gym_memberships WHERE user_id = $2 ORDER BY created_at DESC LIMIT 1)
           RETURNING id, user_id, monthly_amount_cents`,
      discountName !== null ? [amountCents, discountName, user.id] : [amountCents, user.id]
    );

    if (updateRes.rowCount === 0) {
      console.error('No gym_membership found for user:', email);
      await client.end();
      process.exit(1);
    }

    console.log('Updated gym_memberships for', email, '-> monthly_amount_cents =', amountCents, '($' + amountDollars + ')' + (discountName ? ', discount_name = "' + discountName + '"' : ''));
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    await client.end();
    process.exit(1);
  }
}

run();
