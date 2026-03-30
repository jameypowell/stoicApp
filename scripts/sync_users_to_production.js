#!/usr/bin/env node

/**
 * Sync users and subscriptions from local SQLite to production PostgreSQL
 * 
 * This script:
 * 1. Reads users and subscriptions from local SQLite database
 * 2. Syncs them to production PostgreSQL database
 * 3. Handles existing users (skips or updates based on --update flag)
 * 
 * Usage:
 *   node scripts/sync_users_to_production.js [--update] [--dry-run]
 * 
 * Environment variables required for production:
 *   DB_HOST - PostgreSQL host
 *   DB_PORT - PostgreSQL port (default: 5432)
 *   DB_NAME - Database name (default: postgres)
 *   DB_USER - Database user
 *   DB_PASSWORD - Database password
 * 
 * Environment variables for local (optional):
 *   DB_PATH - Path to SQLite database (default: data/stoic-shop.db)
 */

const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const UPDATE_EXISTING = args.includes('--update');
const DRY_RUN = args.includes('--dry-run');

// Get environment variables for production PostgreSQL
const PROD_DB_HOST = process.env.DB_HOST;
const PROD_DB_PORT = process.env.DB_PORT || 5432;
const PROD_DB_NAME = process.env.DB_NAME || 'postgres';
const PROD_DB_USER = process.env.DB_USER;
const PROD_DB_PASSWORD = process.env.DB_PASSWORD;
const PROD_DB_SSL = process.env.DB_SSL !== 'false'; // Default to true

// Get local SQLite path
const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stoic-shop.db');

if (!PROD_DB_HOST || !PROD_DB_USER || !PROD_DB_PASSWORD) {
  console.error('❌ Error: Missing required environment variables for production:');
  console.error('  DB_HOST - PostgreSQL host');
  console.error('  DB_USER - PostgreSQL user');
  console.error('  DB_PASSWORD - Database password');
  console.error('\nOptional:');
  console.error('  DB_PORT - PostgreSQL port (default: 5432)');
  console.error('  DB_NAME - Database name (default: postgres)');
  console.error('  DB_SSL - Use SSL (default: true, set to "false" to disable)');
  console.error('\nFor local SQLite (optional):');
  console.error('  DB_PATH - SQLite database path (default: data/stoic-shop.db)');
  process.exit(1);
}

if (!fs.existsSync(SQLITE_PATH)) {
  console.error(`❌ Error: SQLite database not found at ${SQLITE_PATH}`);
  process.exit(1);
}

// Connect to local SQLite
const sqliteDb = new sqlite3.Database(SQLITE_PATH);

// Connect to production PostgreSQL
const pgClient = new Client({
  host: PROD_DB_HOST,
  port: PROD_DB_PORT,
  database: PROD_DB_NAME,
  user: PROD_DB_USER,
  password: PROD_DB_PASSWORD,
  ssl: PROD_DB_SSL ? { rejectUnauthorized: false } : false
});

async function getAllUsersFromSQLite() {
  return new Promise((resolve, reject) => {
    sqliteDb.all('SELECT * FROM users ORDER BY id', (err, rows) => {
      if (err) reject(err);
      else resolve(rows);
    });
  });
}

async function getSubscriptionsForUser(userId) {
  return new Promise((resolve, reject) => {
    sqliteDb.all(
      'SELECT * FROM subscriptions WHERE user_id = ? ORDER BY created_at DESC',
      [userId],
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

async function userExistsInPostgres(email) {
  const result = await pgClient.query('SELECT id FROM users WHERE email = $1', [email]);
  return result.rows.length > 0 ? result.rows[0].id : null;
}

async function syncUser(user) {
  const existingUserId = await userExistsInPostgres(user.email);
  
  if (existingUserId) {
    if (UPDATE_EXISTING) {
      console.log(`  ↻ Updating existing user: ${user.email}`);
      await pgClient.query(
        'UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2',
        [user.password_hash, user.email]
      );
      return existingUserId;
    } else {
      console.log(`  ⊘ Skipping existing user: ${user.email}`);
      return existingUserId;
    }
  } else {
    console.log(`  ✓ Creating new user: ${user.email}`);
    const result = await pgClient.query(
      'INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id',
      [user.email, user.password_hash, user.created_at, user.updated_at || user.created_at]
    );
    return result.rows[0].id;
  }
}

// Normalize date to YYYY-MM-DD or ISO string format
function normalizeDate(dateValue) {
  if (!dateValue) return null;
  
  // If already a string in YYYY-MM-DD format, return as-is
  if (typeof dateValue === 'string') {
    // If it's just a date (YYYY-MM-DD), return as-is
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateValue)) {
      return dateValue;
    }
    // If it has time component, extract date part
    if (dateValue.includes('T') || dateValue.includes(' ')) {
      return dateValue.split('T')[0].split(' ')[0];
    }
    return dateValue;
  }
  
  // If it's a Date object, convert to ISO string and extract date
  if (dateValue instanceof Date) {
    return dateValue.toISOString().split('T')[0];
  }
  
  return dateValue;
}

// Normalize datetime to ISO string format
function normalizeDateTime(dateTimeValue) {
  if (!dateTimeValue) return null;
  
  // If already a string, try to parse and normalize
  if (typeof dateTimeValue === 'string') {
    // If it's just a date, add time component
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateTimeValue)) {
      return dateTimeValue + 'T00:00:00.000Z';
    }
    // If it has time component, ensure it's in ISO format
    const date = new Date(dateTimeValue);
    if (!isNaN(date.getTime())) {
      return date.toISOString();
    }
    return dateTimeValue;
  }
  
  // If it's a Date object, convert to ISO string
  if (dateTimeValue instanceof Date) {
    return dateTimeValue.toISOString();
  }
  
  return dateTimeValue;
}

async function syncSubscription(subscription, prodUserId) {
  // Normalize dates before syncing
  const startDate = normalizeDateTime(subscription.start_date);
  const endDate = subscription.end_date ? normalizeDate(subscription.end_date) : null;
  const createdAt = normalizeDateTime(subscription.created_at);
  
  // Check if subscription already exists (by user_id and created_at or stripe_subscription_id)
  let existingSub = null;
  
  if (subscription.stripe_subscription_id) {
    const result = await pgClient.query(
      'SELECT id FROM subscriptions WHERE stripe_subscription_id = $1',
      [subscription.stripe_subscription_id]
    );
    if (result.rows.length > 0) {
      existingSub = result.rows[0].id;
    }
  }
  
  // If no match by stripe_subscription_id, check by user_id and email + tier + start_date
  if (!existingSub) {
    // Try to match by user_id, tier, and similar start_date (within 1 day)
    const result = await pgClient.query(
      `SELECT id, start_date FROM subscriptions 
       WHERE user_id = $1 AND tier = $2 
       ORDER BY ABS(EXTRACT(EPOCH FROM (start_date - $3::timestamp))) ASC LIMIT 1`,
      [prodUserId, subscription.tier, startDate]
    );
    if (result.rows.length > 0) {
      // Check if dates are within 1 day of each other
      const prodStartDate = new Date(result.rows[0].start_date);
      const localStartDate = new Date(startDate);
      const diffDays = Math.abs((prodStartDate - localStartDate) / (1000 * 60 * 60 * 24));
      if (diffDays < 1) {
        existingSub = result.rows[0].id;
      }
    }
  }
  
  if (existingSub) {
    if (UPDATE_EXISTING) {
      console.log(`    ↻ Updating subscription ${subscription.id} (tier: ${subscription.tier})`);
      console.log(`       End date: ${subscription.end_date} → ${endDate}`);
      await pgClient.query(
        `UPDATE subscriptions 
         SET tier = $1, stripe_customer_id = $2, stripe_subscription_id = $3, 
             status = $4, start_date = $5, end_date = $6
         WHERE id = $7`,
        [
          subscription.tier,
          subscription.stripe_customer_id,
          subscription.stripe_subscription_id,
          subscription.status,
          startDate,
          endDate,
          existingSub
        ]
      );
    } else {
      // Even if not updating, show what the difference is
      const existing = await pgClient.query('SELECT end_date FROM subscriptions WHERE id = $1', [existingSub]);
      const existingEndDateRaw = existing.rows[0]?.end_date;
      const existingEndDate = normalizeDate(existingEndDateRaw);
      console.log(`    ⊘ Skipping existing subscription ${subscription.id} (tier: ${subscription.tier})`);
      if (existingEndDate !== endDate) {
        console.log(`       ⚠️  Date mismatch - Local: ${endDate}, Prod: ${existingEndDate || existingEndDateRaw}`);
        console.log(`       Use --update to sync the end_date, or run: node scripts/update_subscription_dates.js`);
      } else {
        console.log(`       ✓ End date matches: ${endDate}`);
      }
    }
  } else {
    console.log(`    ✓ Creating subscription ${subscription.id} (tier: ${subscription.tier})`);
    console.log(`       End date: ${endDate}`);
    await pgClient.query(
      `INSERT INTO subscriptions 
       (user_id, tier, stripe_customer_id, stripe_subscription_id, status, start_date, end_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [
        prodUserId,
        subscription.tier,
        subscription.stripe_customer_id,
        subscription.stripe_subscription_id,
        subscription.status,
        startDate,
        endDate,
        createdAt
      ]
    );
  }
}

async function main() {
  console.log('🔄 Syncing users from local SQLite to production PostgreSQL\n');
  
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }
  
  if (UPDATE_EXISTING) {
    console.log('⚠️  UPDATE MODE - Existing users will be updated\n');
  } else {
    console.log('ℹ️  SKIP MODE - Existing users will be skipped (use --update to change)\n');
  }
  
  try {
    // Connect to PostgreSQL
    console.log('▶ Connecting to production PostgreSQL...');
    await pgClient.connect();
    console.log('✅ Connected to production database\n');
    
    // Get all users from SQLite
    console.log('▶ Reading users from local SQLite database...');
    const users = await getAllUsersFromSQLite();
    console.log(`✅ Found ${users.length} user(s) in local database\n`);
    
    if (users.length === 0) {
      console.log('ℹ️  No users to sync.');
      return;
    }
    
    let syncedCount = 0;
    let skippedCount = 0;
    let updatedCount = 0;
    let subscriptionCount = 0;
    
    // Sync each user
    for (const user of users) {
      console.log(`\n📧 Processing user: ${user.email}`);
      
      if (DRY_RUN) {
        const exists = await userExistsInPostgres(user.email);
        if (exists) {
          console.log(`  [DRY RUN] Would ${UPDATE_EXISTING ? 'update' : 'skip'} existing user`);
          skippedCount++;
        } else {
          console.log(`  [DRY RUN] Would create new user`);
          syncedCount++;
        }
        
        // Get subscriptions for dry run
        const subscriptions = await getSubscriptionsForUser(user.id);
        subscriptionCount += subscriptions.length;
        continue;
      }
      
      const prodUserId = await syncUser(user);
      
      if (prodUserId) {
        if (UPDATE_EXISTING && await userExistsInPostgres(user.email)) {
          updatedCount++;
        } else if (!await userExistsInPostgres(user.email)) {
          syncedCount++;
        } else {
          skippedCount++;
        }
        
        // Sync subscriptions for this user
        const subscriptions = await getSubscriptionsForUser(user.id);
        console.log(`  📋 Found ${subscriptions.length} subscription(s)`);
        
        for (const subscription of subscriptions) {
          await syncSubscription(subscription, prodUserId);
          subscriptionCount++;
        }
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Sync complete!');
    console.log('='.repeat(50));
    console.log(`Users synced: ${syncedCount}`);
    console.log(`Users updated: ${updatedCount}`);
    console.log(`Users skipped: ${skippedCount}`);
    console.log(`Subscriptions processed: ${subscriptionCount}`);
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('\n❌ Error during sync:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
    sqliteDb.close();
  }
}

main();

