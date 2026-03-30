/**
 * Set discount_name for a gym membership by user email.
 *
 * Usage (with production DB env):
 *   node scripts/set_discount_name_for_user.js sharla.barber@nebo.edu "Loyalty Discount (original price)"
 * With production env file:
 *   node -r dotenv/config scripts/set_discount_name_for_user.js sharla.barber@nebo.edu "Loyalty Discount (original price)" (with DOTENV_CONFIG_PATH=.env.production)
 *   Or: env $(cat .env.production | xargs) node scripts/set_discount_name_for_user.js sharla.barber@nebo.edu "Loyalty Discount (original price)"
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.DB_HOST && require('fs').existsSync(path.join(__dirname, '..', '.env.production'))) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.production') });
}

const email = (process.argv[2] || '').trim().toLowerCase();
const discountName = (process.argv[3] || '').trim();

if (!email || !discountName) {
  console.error('Usage: node scripts/set_discount_name_for_user.js <email> "<discount name>"');
  console.error('Example: node scripts/set_discount_name_for_user.js sharla.barber@nebo.edu "Loyalty Discount (original price)"');
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

    const updateRes = await client.query(
      `UPDATE gym_memberships
       SET discount_name = $1
       WHERE user_id = $2
       AND id = (SELECT id FROM gym_memberships WHERE user_id = $2 ORDER BY created_at DESC LIMIT 1)
       RETURNING id, user_id, discount_name`,
      [discountName, user.id]
    );

    if (updateRes.rowCount === 0) {
      console.error('No gym_membership found for user:', email);
      await client.end();
      process.exit(1);
    }

    console.log('Updated gym_memberships for', email, '-> discount_name =', JSON.stringify(discountName));
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    await client.end();
    process.exit(1);
  }
}

run();
