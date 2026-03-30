#!/usr/bin/env node

/**
 * Update subscription end dates in production to match local dev
 * 
 * This script compares subscription end dates between local and production
 * and updates production to match local.
 * 
 * Usage:
 *   node scripts/update_subscription_dates.js [--dry-run]
 * 
 * Environment variables required for production:
 *   DB_HOST, DB_USER, DB_PASSWORD (same as sync script)
 */

const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

const args = process.argv.slice(2);
const DRY_RUN = args.includes('--dry-run');

// Get environment variables for production PostgreSQL
const PROD_DB_HOST = process.env.DB_HOST;
const PROD_DB_PORT = process.env.DB_PORT || 5432;
const PROD_DB_NAME = process.env.DB_NAME || 'postgres';
const PROD_DB_USER = process.env.DB_USER;
const PROD_DB_PASSWORD = process.env.DB_PASSWORD;
const PROD_DB_SSL = process.env.DB_SSL !== 'false';

// Get local SQLite path
const SQLITE_PATH = process.env.DB_PATH || path.join(__dirname, '..', 'data', 'stoic-shop.db');

if (!PROD_DB_HOST || !PROD_DB_USER || !PROD_DB_PASSWORD) {
  console.error('❌ Error: Missing required environment variables for production:');
  console.error('  DB_HOST, DB_USER, DB_PASSWORD');
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

// Normalize date to YYYY-MM-DD format for comparison
function normalizeDate(dateValue) {
  if (!dateValue) return null;
  
  if (typeof dateValue === 'string') {
    // Extract date part if it has time component
    const dateStr = dateValue.split('T')[0].split(' ')[0];
    // Ensure it's in YYYY-MM-DD format
    if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
      return dateStr;
    }
    // Try to parse and reformat
    const date = new Date(dateValue);
    if (!isNaN(date.getTime())) {
      return date.toISOString().split('T')[0];
    }
    return dateStr;
  }
  
  if (dateValue instanceof Date) {
    return dateValue.toISOString().split('T')[0];
  }
  
  return dateValue;
}

// Get all users and subscriptions from local
async function getLocalSubscriptions() {
  return new Promise((resolve, reject) => {
    sqliteDb.all(
      `SELECT 
        u.email,
        s.id,
        s.tier,
        s.status,
        s.start_date,
        s.end_date,
        s.created_at,
        s.stripe_subscription_id
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      ORDER BY u.email, s.created_at DESC`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

// Get subscription from production by email and tier
async function getProdSubscriptionByEmail(email, tier, localStartDate) {
  // Normalize local start date for comparison
  const normalizedStart = normalizeDate(localStartDate);
  
  // First try exact match on start_date
  let result = await pgClient.query(
    `SELECT s.* 
     FROM subscriptions s
     JOIN users u ON s.user_id = u.id
     WHERE u.email = $1 AND s.tier = $2
       AND DATE(s.start_date) = $3
     LIMIT 1`,
    [email, tier, normalizedStart]
  );
  
  // If no exact match, try closest match (within 1 day)
  if (result.rows.length === 0) {
    result = await pgClient.query(
      `SELECT s.* 
       FROM subscriptions s
       JOIN users u ON s.user_id = u.id
       WHERE u.email = $1 AND s.tier = $2
       ORDER BY ABS(EXTRACT(EPOCH FROM (s.start_date - $3::timestamp))) ASC
       LIMIT 1`,
      [email, tier, localStartDate]
    );
    
    // Only use if within 1 day
    if (result.rows.length > 0) {
      const prodStart = normalizeDate(result.rows[0].start_date);
      const diffDays = Math.abs((new Date(normalizedStart) - new Date(prodStart)) / (1000 * 60 * 60 * 24));
      if (diffDays > 1) {
        return null; // Too far apart, probably different subscription
      }
    }
  }
  
  return result.rows[0] || null;
}

async function main() {
  console.log('🔄 Comparing and updating subscription end dates\n');
  
  if (DRY_RUN) {
    console.log('⚠️  DRY RUN MODE - No changes will be made\n');
  }
  
  try {
    // Connect to PostgreSQL
    console.log('▶ Connecting to production PostgreSQL...');
    await pgClient.connect();
    console.log('✅ Connected to production database\n');
    
    // Get local subscriptions
    console.log('▶ Reading subscriptions from local SQLite database...');
    const localSubs = await getLocalSubscriptions();
    console.log(`✅ Found ${localSubs.length} subscription(s) in local database\n`);
    
    if (localSubs.length === 0) {
      console.log('ℹ️  No subscriptions to compare.');
      return;
    }
    
    let updatedCount = 0;
    let matchCount = 0;
    let notFoundCount = 0;
    let errors = [];
    
    // Compare each subscription
    for (const localSub of localSubs) {
      const localEndDate = normalizeDate(localSub.end_date);
      const localStartDate = localSub.start_date;
      const localStartDateNorm = normalizeDate(localStartDate);
      
      console.log(`\n📧 User: ${localSub.email}`);
      console.log(`   Tier: ${localSub.tier}, Status: ${localSub.status}`);
      console.log(`   Local start: ${localStartDateNorm}, end: ${localEndDate || 'None'}`);
      
      // Find matching subscription in production
      const prodSub = await getProdSubscriptionByEmail(
        localSub.email,
        localSub.tier,
        localStartDate
      );
      
      if (!prodSub) {
        console.log(`   ⚠️  No matching subscription found in production`);
        console.log(`   (Looking for tier: ${localSub.tier}, start_date: ${localStartDateNorm})`);
        notFoundCount++;
        continue;
      }
      
      const prodStartDateNorm = normalizeDate(prodSub.start_date);
      const prodEndDate = normalizeDate(prodSub.end_date);
      console.log(`   Prod start: ${prodStartDateNorm}, end: ${prodEndDate || 'None'}`);
      
      // Compare dates
      if (localEndDate === prodEndDate) {
        console.log(`   ✅ End dates match`);
        matchCount++;
      } else {
        console.log(`   ⚠️  End date mismatch!`);
        console.log(`       Local: ${localEndDate || 'NULL'}`);
        console.log(`       Prod:  ${prodEndDate || 'NULL'}`);
        
        if (DRY_RUN) {
          console.log(`   [DRY RUN] Would update to: ${localEndDate || 'NULL'}`);
          updatedCount++;
        } else {
          try {
            // For PostgreSQL, we can use DATE type directly with YYYY-MM-DD string
            // PostgreSQL will convert it properly
            await pgClient.query(
              'UPDATE subscriptions SET end_date = $1::date WHERE id = $2',
              [localEndDate, prodSub.id]
            );
            console.log(`   ✅ Updated to: ${localEndDate || 'NULL'}`);
            updatedCount++;
          } catch (error) {
            console.log(`   ❌ Error updating: ${error.message}`);
            errors.push({ email: localSub.email, error: error.message });
          }
        }
      }
    }
    
    console.log('\n' + '='.repeat(50));
    console.log('✅ Comparison complete!');
    console.log('='.repeat(50));
    console.log(`Subscriptions matched: ${matchCount}`);
    console.log(`Subscriptions updated: ${updatedCount}`);
    console.log(`Subscriptions not found: ${notFoundCount}`);
    if (errors.length > 0) {
      console.log(`Errors: ${errors.length}`);
      errors.forEach(e => console.log(`  - ${e.email}: ${e.error}`));
    }
    console.log('='.repeat(50));
    
  } catch (error) {
    console.error('\n❌ Error during update:', error);
    process.exit(1);
  } finally {
    await pgClient.end();
    sqliteDb.close();
  }
}

main();

