/**
 * Check migration state for a user by email (e.g. sharla.barber@nebo.edu).
 * Use to see: admin_added_members (pending), customer_profiles (partial save), gym_memberships, payments.
 *
 * Run in prod Docker (with prod env):
 *   docker run --rm --env-file .env.production $(docker images -q stoic-fitness-app:latest 2>/dev/null | head -1) node scripts/check_migration_user.js sharla.barber@nebo.edu
 * Or with env vars set: node scripts/check_migration_user.js <email>
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage: node scripts/check_migration_user.js <email>');
  process.exit(1);
}

const USE_POSTGRES = !!process.env.DB_HOST;

async function run() {
  if (!USE_POSTGRES) {
    console.error('This script expects PostgreSQL (DB_HOST). Use for production check.');
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

    console.log('\n=== Migration check for:', email, '===\n');

    const userRes = await client.query('SELECT id, email, name, role, created_at FROM users WHERE LOWER(email) = $1', [email]);
    const user = userRes.rows[0] || null;
    if (!user) {
      console.log('Users: no row found for this email.');
    } else {
      console.log('Users:', { id: user.id, email: user.email, name: user.name, role: user.role, created_at: user.created_at });
    }

    const pendingRes = await client.query(
      "SELECT id, primary_email, primary_first_name, primary_last_name, primary_phone, membership_type, membership_start_date, status, created_at, address_street, address_city, address_state, address_zip FROM admin_added_members WHERE LOWER(primary_email) = $1 ORDER BY id DESC LIMIT 1",
      [email]
    );
    const pending = pendingRes.rows[0] || null;
    if (!pending) {
      console.log('\nadmin_added_members: no row for this email.');
    } else {
      console.log('\nadmin_added_members:', {
        id: pending.id,
        primary_email: pending.primary_email,
        primary_first_name: pending.primary_first_name,
        primary_last_name: pending.primary_last_name,
        membership_type: pending.membership_type,
        membership_start_date: pending.membership_start_date,
        membership_start_date_type: pending.membership_start_date != null ? typeof pending.membership_start_date : 'null',
        status: pending.status,
        created_at: pending.created_at,
        address: [pending.address_street, pending.address_city, pending.address_state, pending.address_zip].filter(Boolean).join(', ') || null
      });
    }

    if (user) {
      const cpRes = await client.query('SELECT * FROM customer_profiles WHERE user_id = $1', [user.id]);
      const cp = cpRes.rows[0] || null;
      if (!cp) {
        console.log('\ncustomer_profiles: no row for this user.');
      } else {
        console.log('\ncustomer_profiles:', {
          user_id: cp.user_id,
          first_name: cp.first_name,
          last_name: cp.last_name,
          phone: cp.phone,
          street: cp.street,
          city: cp.city,
          state: cp.state,
          zip: cp.zip
        });
      }

      const gmRes = await client.query('SELECT id, user_id, membership_type, status, contract_start_date, contract_end_date, created_at FROM gym_memberships WHERE user_id = $1 ORDER BY id DESC', [user.id]);
      const gms = gmRes.rows || [];
      console.log('\ngym_memberships:', gms.length === 0 ? 'none' : gms);

      const payRes = await client.query(
        "SELECT id, amount, tier, status, created_at FROM payments WHERE user_id = $1 AND tier IN ('gym_membership', 'gym_membership_late_fee') ORDER BY created_at DESC LIMIT 5",
        [user.id]
      );
      console.log('\nGym-related payments:', payRes.rows.length === 0 ? 'none' : payRes.rows);
    }

    console.log('\n=== End ===\n');
    await client.end();
  } catch (err) {
    console.error('Error:', err.message);
    await client.end();
    process.exit(1);
  }
}

run();
