#!/usr/bin/env node

/**
 * Migration script: SQLite to PostgreSQL
 * 
 * This script:
 * 1. Reads data from local SQLite database
 * 2. Creates PostgreSQL schema (if needed)
 * 3. Migrates all data to PostgreSQL
 * 4. Optionally drops existing tables first (use --drop flag)
 * 
 * Usage:
 *   node scripts/migrate_to_postgres.js [--drop]
 * 
 * Environment variables required:
 *   DB_HOST - PostgreSQL host (e.g., stoic-fitness-pg.xxx.rds.amazonaws.com)
 *   DB_PORT - PostgreSQL port (default: 5432)
 *   DB_NAME - Database name (default: postgres)
 *   DB_USER - Database user
 *   DB_PASSWORD - Database password
 *   DB_PATH - Path to SQLite database (default: data/stoic-shop.db)
 */

const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const DROP_EXISTING = args.includes('--drop');

// Get environment variables
const DB_HOST = process.env.DB_HOST;
const DB_PORT = process.env.DB_PORT || 5432;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stoic-shop.db');

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('Error: Missing required environment variables:');
  console.error('  DB_HOST - PostgreSQL host');
  console.error('  DB_USER - PostgreSQL user');
  console.error('  DB_PASSWORD - PostgreSQL password');
  console.error('\nOptional:');
  console.error('  DB_PORT - PostgreSQL port (default: 5432)');
  console.error('  DB_NAME - Database name (default: postgres)');
  console.error('  DB_PATH - SQLite database path (default: data/stoic-shop.db)');
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`Error: SQLite database not found at ${SQLITE_PATH}`);
  process.exit(1);
}

// PostgreSQL schema
const POSTGRES_SCHEMA = `
-- Users table
CREATE TABLE IF NOT EXISTS users (
  id SERIAL PRIMARY KEY,
  email TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Subscriptions table
CREATE TABLE IF NOT EXISTS subscriptions (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  tier TEXT NOT NULL CHECK(tier IN ('daily', 'weekly', 'monthly')),
  stripe_customer_id TEXT,
  stripe_subscription_id TEXT,
  status TEXT NOT NULL CHECK(status IN ('active', 'canceled', 'expired')) DEFAULT 'active',
  start_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  end_date TIMESTAMP,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Workouts table
CREATE TABLE IF NOT EXISTS workouts (
  id SERIAL PRIMARY KEY,
  workout_date DATE UNIQUE NOT NULL,
  google_drive_file_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Payments table
CREATE TABLE IF NOT EXISTS payments (
  id SERIAL PRIMARY KEY,
  user_id INTEGER NOT NULL,
  stripe_payment_intent_id TEXT UNIQUE,
  amount INTEGER NOT NULL,
  currency TEXT DEFAULT 'usd',
  tier TEXT NOT NULL,
  status TEXT NOT NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Indexes
CREATE INDEX IF NOT EXISTS idx_subscriptions_user_id ON subscriptions(user_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_status ON subscriptions(status);
CREATE INDEX IF NOT EXISTS idx_workouts_date ON workouts(workout_date);
CREATE INDEX IF NOT EXISTS idx_users_email ON users(email);
`;

// Drop tables (if --drop flag is used)
const DROP_TABLES = `
DROP TABLE IF EXISTS payments CASCADE;
DROP TABLE IF EXISTS subscriptions CASCADE;
DROP TABLE IF EXISTS workouts CASCADE;
DROP TABLE IF EXISTS users CASCADE;
`;

async function readSqliteData(db) {
  return new Promise((resolve, reject) => {
    const data = {
      users: [],
      subscriptions: [],
      workouts: [],
      payments: []
    };

    // Read users
    db.all('SELECT * FROM users ORDER BY id', (err, rows) => {
      if (err) return reject(err);
      data.users = rows;
      console.log(`  ✓ Read ${rows.length} users from SQLite`);

      // Read subscriptions
      db.all('SELECT * FROM subscriptions ORDER BY id', (err, rows) => {
        if (err) return reject(err);
        data.subscriptions = rows;
        console.log(`  ✓ Read ${rows.length} subscriptions from SQLite`);

        // Read workouts
        db.all('SELECT * FROM workouts ORDER BY id', (err, rows) => {
          if (err) return reject(err);
          data.workouts = rows;
          console.log(`  ✓ Read ${rows.length} workouts from SQLite`);

          // Read payments
          db.all('SELECT * FROM payments ORDER BY id', (err, rows) => {
            if (err) return reject(err);
            data.payments = rows;
            console.log(`  ✓ Read ${rows.length} payments from SQLite`);
            resolve(data);
          });
        });
      });
    });
  });
}

async function migrateData(pgClient, data) {
  console.log('\n📦 Migrating data to PostgreSQL...\n');

  // Migrate users
  if (data.users.length > 0) {
    for (const user of data.users) {
      await pgClient.query(`
        INSERT INTO users (id, email, password_hash, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5)
        ON CONFLICT (id) DO UPDATE SET
          email = EXCLUDED.email,
          password_hash = EXCLUDED.password_hash,
          updated_at = EXCLUDED.updated_at
      `, [
        user.id,
        user.email,
        user.password_hash,
        user.created_at || null,
        user.updated_at || null
      ]);
    }
    console.log(`  ✓ Migrated ${data.users.length} users`);
    
    // Reset sequence for users
    const maxId = await pgClient.query('SELECT MAX(id) as max_id FROM users');
    if (maxId.rows[0] && maxId.rows[0].max_id) {
      await pgClient.query(`SELECT setval('users_id_seq', $1)`, [maxId.rows[0].max_id]);
      console.log(`  ✓ Reset users sequence`);
    }
  } else {
    console.log(`  ⚠ No users to migrate`);
  }

  // Migrate subscriptions
  if (data.subscriptions.length > 0) {
    for (const sub of data.subscriptions) {
      await pgClient.query(`
        INSERT INTO subscriptions (id, user_id, tier, stripe_customer_id, stripe_subscription_id, status, start_date, end_date, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
        ON CONFLICT (id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          tier = EXCLUDED.tier,
          stripe_customer_id = EXCLUDED.stripe_customer_id,
          stripe_subscription_id = EXCLUDED.stripe_subscription_id,
          status = EXCLUDED.status,
          start_date = EXCLUDED.start_date,
          end_date = EXCLUDED.end_date
      `, [
        sub.id,
        sub.user_id,
        sub.tier,
        sub.stripe_customer_id || null,
        sub.stripe_subscription_id || null,
        sub.status,
        sub.start_date || null,
        sub.end_date || null,
        sub.created_at || null
      ]);
    }
    console.log(`  ✓ Migrated ${data.subscriptions.length} subscriptions`);
    
    // Reset sequence for subscriptions
    const maxSubId = await pgClient.query('SELECT MAX(id) as max_id FROM subscriptions');
    if (maxSubId.rows[0] && maxSubId.rows[0].max_id) {
      await pgClient.query(`SELECT setval('subscriptions_id_seq', $1)`, [maxSubId.rows[0].max_id]);
      console.log(`  ✓ Reset subscriptions sequence`);
    }
  } else {
    console.log(`  ⚠ No subscriptions to migrate`);
  }

  // Migrate workouts
  if (data.workouts.length > 0) {
    for (const workout of data.workouts) {
      await pgClient.query(`
        INSERT INTO workouts (id, workout_date, google_drive_file_id, title, content, created_at, updated_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7)
        ON CONFLICT (workout_date) DO UPDATE SET
          google_drive_file_id = EXCLUDED.google_drive_file_id,
          title = EXCLUDED.title,
          content = EXCLUDED.content,
          updated_at = EXCLUDED.updated_at
      `, [
        workout.id,
        workout.workout_date,
        workout.google_drive_file_id,
        workout.title || null,
        workout.content || null,
        workout.created_at || null,
        workout.updated_at || null
      ]);
    }
    console.log(`  ✓ Migrated ${data.workouts.length} workouts`);
    
    // Reset sequence for workouts
    const maxWorkoutId = await pgClient.query('SELECT MAX(id) as max_id FROM workouts');
    if (maxWorkoutId.rows[0] && maxWorkoutId.rows[0].max_id) {
      await pgClient.query(`SELECT setval('workouts_id_seq', $1)`, [maxWorkoutId.rows[0].max_id]);
      console.log(`  ✓ Reset workouts sequence`);
    }
  } else {
    console.log(`  ⚠ No workouts to migrate`);
  }

  // Migrate payments
  if (data.payments.length > 0) {
    for (const payment of data.payments) {
      await pgClient.query(`
        INSERT INTO payments (id, user_id, stripe_payment_intent_id, amount, currency, tier, status, created_at)
        VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
        ON CONFLICT (stripe_payment_intent_id) DO UPDATE SET
          user_id = EXCLUDED.user_id,
          amount = EXCLUDED.amount,
          currency = EXCLUDED.currency,
          tier = EXCLUDED.tier,
          status = EXCLUDED.status
      `, [
        payment.id,
        payment.user_id,
        payment.stripe_payment_intent_id || null,
        payment.amount,
        payment.currency || 'usd',
        payment.tier,
        payment.status,
        payment.created_at || null
      ]);
    }
    console.log(`  ✓ Migrated ${data.payments.length} payments`);
    
    // Reset sequence for payments
    const maxPaymentId = await pgClient.query('SELECT MAX(id) as max_id FROM payments');
    if (maxPaymentId.rows[0] && maxPaymentId.rows[0].max_id) {
      await pgClient.query(`SELECT setval('payments_id_seq', $1)`, [maxPaymentId.rows[0].max_id]);
      console.log(`  ✓ Reset payments sequence`);
    }
  } else {
    console.log(`  ⚠ No payments to migrate`);
  }
}

async function main() {
  console.log('🚀 Starting SQLite to PostgreSQL migration\n');
  console.log(`SQLite DB: ${SQLITE_PATH}`);
  console.log(`PostgreSQL: ${DB_USER}@${DB_HOST}:${DB_PORT}/${DB_NAME}\n`);

  // Connect to SQLite
  console.log('📖 Reading data from SQLite...\n');
  const sqliteDb = new sqlite3.Database(SQLITE_PATH, sqlite3.OPEN_READONLY, (err) => {
    if (err) {
      console.error('Error opening SQLite database:', err);
      process.exit(1);
    }
  });

  let data;
  try {
    data = await readSqliteData(sqliteDb);
  } catch (err) {
    console.error('Error reading SQLite data:', err);
    sqliteDb.close();
    process.exit(1);
  } finally {
    sqliteDb.close();
  }

  // Connect to PostgreSQL
  const pgClient = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await pgClient.connect();
    console.log('✓ Connected to PostgreSQL\n');

    // Drop existing tables if requested
    if (DROP_EXISTING) {
      console.log('🗑️  Dropping existing tables...\n');
      await pgClient.query(DROP_TABLES);
      console.log('  ✓ Dropped existing tables\n');
    }

    // Create schema
    console.log('📋 Creating PostgreSQL schema...\n');
    await pgClient.query(POSTGRES_SCHEMA);
    console.log('  ✓ Schema created\n');

    // Migrate data
    await migrateData(pgClient, data);

    console.log('\n✅ Migration completed successfully!');
    console.log(`\nSummary:`);
    console.log(`  Users: ${data.users.length}`);
    console.log(`  Subscriptions: ${data.subscriptions.length}`);
    console.log(`  Workouts: ${data.workouts.length}`);
    console.log(`  Payments: ${data.payments.length}`);

  } catch (err) {
    console.error('\n❌ Migration failed:', err);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

main();

