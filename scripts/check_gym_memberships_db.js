/**
 * Diagnostic script: list gym_memberships and recent gym-related payments.
 * Run inside Docker: docker compose run --rm app node scripts/check_gym_memberships_db.js
 * Or locally with .env: node scripts/check_gym_memberships_db.js
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const USE_POSTGRES = !!process.env.DB_HOST;

async function run() {
  if (USE_POSTGRES) {
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
      const count = await client.query('SELECT COUNT(*) AS n FROM gym_memberships');
      console.log('gym_memberships count:', count.rows[0].n);
      const rows = await client.query(`
        SELECT gm.id, gm.user_id, gm.membership_type, gm.status, gm.household_id,
               gm.stripe_subscription_id, gm.created_at,
               u.email, u.name
        FROM gym_memberships gm
        JOIN users u ON u.id = gm.user_id
        ORDER BY gm.created_at DESC
        LIMIT 20
      `);
      console.log('\nRecent gym_memberships (up to 20):');
      console.table(rows.rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        type: r.membership_type,
        status: r.status,
        stripe_sub: r.stripe_subscription_id ? 'yes' : 'no',
        created: r.created_at
      })));
      const payments = await client.query(`
        SELECT p.id, p.user_id, p.amount, p.tier, p.status, p.created_at, p.stripe_payment_intent_id
        FROM payments p
        WHERE p.tier IN ('gym_membership', 'gym_membership_late_fee')
        ORDER BY p.created_at DESC
        LIMIT 15
      `);
      console.log('\nRecent gym-related payments (up to 15):');
      console.table(payments.rows.map(p => ({
        id: p.id,
        user_id: p.user_id,
        amount: (p.amount / 100).toFixed(2),
        tier: p.tier,
        status: p.status,
        created: p.created_at
      })));
      await client.end();
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    }
  } else {
    const sqlite3 = require('sqlite3');
    const path = require('path');
    const dbPath = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stoic.db');
    const db = new sqlite3.Database(dbPath);
    const run = (sql, params = []) => new Promise((resolve, reject) => {
      db.all(sql, params, (err, rows) => { if (err) reject(err); else resolve(rows || []); });
    });
    const get = (sql, params = []) => new Promise((resolve, reject) => {
      db.get(sql, params, (err, row) => { if (err) reject(err); else resolve(row); });
    });
    try {
      const countRow = await get('SELECT COUNT(*) AS n FROM gym_memberships');
      console.log('gym_memberships count:', countRow.n);
      const rows = await run(`
        SELECT gm.id, gm.user_id, gm.membership_type, gm.status, gm.household_id,
               gm.stripe_subscription_id, gm.created_at,
               u.email, u.name
        FROM gym_memberships gm
        JOIN users u ON u.id = gm.user_id
        ORDER BY gm.created_at DESC
        LIMIT 20
      `);
      console.log('\nRecent gym_memberships (up to 20):');
      console.table(rows.map(r => ({
        id: r.id,
        user_id: r.user_id,
        email: r.email,
        name: r.name,
        type: r.membership_type,
        status: r.status,
        stripe_sub: r.stripe_subscription_id ? 'yes' : 'no',
        created: r.created_at
      })));
      const payments = await run(`
        SELECT id, user_id, amount, tier, status, created_at
        FROM payments
        WHERE tier IN ('gym_membership', 'gym_membership_late_fee')
        ORDER BY created_at DESC
        LIMIT 15
      `);
      console.log('\nRecent gym-related payments (up to 15):');
      console.table(payments.map(p => ({
        id: p.id,
        user_id: p.user_id,
        amount: (p.amount / 100).toFixed(2),
        tier: p.tier,
        status: p.status,
        created: p.created_at
      })));
    } catch (err) {
      console.error('Error:', err.message);
      process.exit(1);
    } finally {
      db.close();
    }
  }
}

run();
