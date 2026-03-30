#!/usr/bin/env node
/**
 * Print gym profile fields (from config/gym-member-profile-schema.js) + core user row for an email.
 *
 * Usage: node scripts/show-user-profile.js <email>
 * Requires: .env with DB_* for Postgres (or SQLite path via DATABASE_URL / local default)
 */

require('dotenv').config();
const path = require('path');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));
const {
  REQUIRED_FIELDS,
  OPTIONAL_FIELDS
} = require(path.join(__dirname, '..', 'config', 'gym-member-profile-schema.js'));

async function main() {
  const email = (process.argv[2] || '').trim();
  if (!email) {
    console.error('Usage: node scripts/show-user-profile.js <email>');
    process.exit(1);
  }

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  const user = await db.getUserByEmail(email);
  if (!user) {
    console.error(`No user found for email: ${email}`);
    process.exit(1);
  }

  const uid = user.id;
  const profile = await db.queryOne(
    db.isPostgres
      ? 'SELECT * FROM customer_profiles WHERE user_id = $1'
      : 'SELECT * FROM customer_profiles WHERE user_id = ?',
    [uid]
  );

  const gm = await db.queryOne(
    db.isPostgres
      ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
      : 'SELECT * FROM gym_memberships WHERE user_id = ?',
    [uid]
  );

  console.log('');
  console.log(`=== User (users table) — ${email} ===`);
  const uOut = { ...user };
  delete uOut.password_hash;
  for (const [k, v] of Object.entries(uOut)) {
    console.log(`${k}: ${v == null ? '' : JSON.stringify(v)}`);
  }

  console.log('');
  console.log('=== Profile fields from config/gym-member-profile-schema.js (customer_profiles) ===');
  const allSchema = [...REQUIRED_FIELDS, ...OPTIONAL_FIELDS];
  if (!profile) {
    console.log('(no customer_profiles row)');
    for (const f of allSchema) {
      console.log(`${f.dbKey}: `);
    }
  } else {
    for (const f of allSchema) {
      const v = profile[f.dbKey];
      console.log(`${f.dbKey}: ${v == null ? '' : String(v)}`);
    }
    console.log('');
    console.log('=== customer_profiles (raw columns not in schema list) ===');
    const schemaKeys = new Set(allSchema.map((x) => x.dbKey));
    for (const [k, v] of Object.entries(profile)) {
      if (!schemaKeys.has(k) && k !== 'id' && k !== 'user_id') {
        console.log(`${k}: ${v == null ? '' : JSON.stringify(v)}`);
      }
    }
    console.log(`id: ${profile.id}`);
    console.log(`user_id: ${profile.user_id}`);
  }

  console.log('');
  console.log('=== Gym membership (gym_memberships) — summary ===');
  if (!gm) {
    console.log('(no gym_memberships row)');
  } else {
    for (const [k, v] of Object.entries(gm)) {
      console.log(`${k}: ${v == null ? '' : JSON.stringify(v)}`);
    }
  }

  console.log('');
  if (typeof dbConnection.end === 'function') {
    await dbConnection.end();
  } else if (typeof dbConnection.close === 'function') {
    await new Promise((resolve, reject) => {
      dbConnection.close((err) => (err ? reject(err) : resolve()));
    });
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
