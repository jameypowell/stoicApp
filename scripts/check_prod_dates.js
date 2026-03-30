#!/usr/bin/env node

/**
 * Quick script to check subscription dates in production
 * Usage: node scripts/check_prod_dates.js [email]
 */

const { Client } = require('pg');

const PROD_DB_HOST = process.env.DB_HOST;
const PROD_DB_PORT = process.env.DB_PORT || 5432;
const PROD_DB_NAME = process.env.DB_NAME || 'postgres';
const PROD_DB_USER = process.env.DB_USER;
const PROD_DB_PASSWORD = process.env.DB_PASSWORD;
const PROD_DB_SSL = process.env.DB_SSL !== 'false';

const emailFilter = process.argv[2] || '%';

if (!PROD_DB_HOST || !PROD_DB_USER || !PROD_DB_PASSWORD) {
  console.error('❌ Error: Missing required environment variables:');
  console.error('  DB_HOST, DB_USER, DB_PASSWORD');
  process.exit(1);
}

const pgClient = new Client({
  host: PROD_DB_HOST,
  port: PROD_DB_PORT,
  database: PROD_DB_NAME,
  user: PROD_DB_USER,
  password: PROD_DB_PASSWORD,
  ssl: PROD_DB_SSL ? { rejectUnauthorized: false } : false
});

async function main() {
  try {
    await pgClient.connect();
    console.log('✅ Connected to production database\n');
    
    const result = await pgClient.query(
      `SELECT 
        u.email,
        s.id,
        s.tier,
        s.status,
        s.start_date,
        s.end_date,
        s.created_at
      FROM subscriptions s
      JOIN users u ON s.user_id = u.id
      WHERE u.email LIKE $1
      ORDER BY u.email, s.created_at DESC`,
      [emailFilter]
    );
    
    if (result.rows.length === 0) {
      console.log(`No subscriptions found for email pattern: ${emailFilter}`);
      return;
    }
    
    console.log(`Found ${result.rows.length} subscription(s):\n`);
    
    result.rows.forEach((sub, idx) => {
      console.log(`${idx + 1}. ${sub.email}`);
      console.log(`   Tier: ${sub.tier}, Status: ${sub.status}`);
      console.log(`   Start: ${sub.start_date} (${typeof sub.start_date})`);
      console.log(`   End:   ${sub.end_date} (${typeof sub.end_date})`);
      console.log(`   Created: ${sub.created_at}`);
      console.log('');
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  } finally {
    await pgClient.end();
  }
}

main();






