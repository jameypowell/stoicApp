#!/usr/bin/env node
/**
 * Migration script to update subscriptions table CHECK constraint
 * to allow both legacy (daily/weekly/monthly) and new (tier_one/tier_two/tier_three/tier_four) tier names
 * 
 * Usage:
 *   DB_HOST=... DB_USER=... DB_PASSWORD=... DB_NAME=... node scripts/migrate_tier_constraint.js
 */

const { Client } = require('pg');

const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_PORT = process.env.DB_PORT || 5432;

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('❌ Error: Missing required environment variables');
  console.error('   Required: DB_HOST, DB_USER, DB_PASSWORD');
  console.error('   Optional: DB_NAME (default: postgres), DB_PORT (default: 5432)');
  console.error('');
  console.error('   Example:');
  console.error('   export DB_HOST=your-host');
  console.error('   export DB_USER=your-user');
  console.error('   export DB_PASSWORD=your-password');
  console.error('   export DB_NAME=your-db-name');
  console.error('   node scripts/migrate_tier_constraint.js');
  process.exit(1);
}

async function runMigration() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔌 Connecting to database...');
    console.log(`   Host: ${DB_HOST}`);
    console.log(`   Database: ${DB_NAME}`);
    console.log(`   User: ${DB_USER}`);
    await client.connect();
    console.log('✅ Connected successfully\n');

    // Check current constraint
    console.log('📋 Checking current constraint...');
    const constraintCheck = await client.query(`
      SELECT 
        conname as constraint_name,
        pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'subscriptions'::regclass
        AND contype = 'c'
        AND conname LIKE '%tier%'
    `);

    if (constraintCheck.rows.length > 0) {
      console.log('   Current constraint:');
      constraintCheck.rows.forEach(row => {
        console.log(`   - ${row.constraint_name}: ${row.constraint_definition}`);
      });
    } else {
      console.log('   No tier constraint found (may be using different constraint name)');
    }
    console.log('');

    // Drop existing constraint if it exists
    console.log('🗑️  Dropping existing tier constraint...');
    try {
      // Try to drop by name (common names)
      const dropQueries = [
        "ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check",
        "ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS subscriptions_tier_check1",
        "ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS check_tier"
      ];

      for (const query of dropQueries) {
        await client.query(query);
      }

      // Also try to find and drop any constraint that checks tier
      const constraints = await client.query(`
        SELECT conname
        FROM pg_constraint
        WHERE conrelid = 'subscriptions'::regclass
          AND contype = 'c'
          AND pg_get_constraintdef(oid) LIKE '%tier%'
      `);

      for (const row of constraints.rows) {
        await client.query(`ALTER TABLE subscriptions DROP CONSTRAINT IF EXISTS ${row.conname}`);
        console.log(`   Dropped constraint: ${row.conname}`);
      }

      console.log('✅ Existing constraints dropped\n');
    } catch (error) {
      if (error.message.includes('does not exist')) {
        console.log('   No existing constraint to drop\n');
      } else {
        throw error;
      }
    }

    // Add new constraint with both legacy and new tier names
    console.log('➕ Adding new tier constraint...');
    await client.query(`
      ALTER TABLE subscriptions 
      ADD CONSTRAINT subscriptions_tier_check 
      CHECK (tier IN ('daily', 'weekly', 'monthly', 'tier_one', 'tier_two', 'tier_three', 'tier_four'))
    `);
    console.log('✅ New constraint added successfully\n');

    // Verify the constraint
    console.log('✅ Verifying constraint...');
    const verifyCheck = await client.query(`
      SELECT pg_get_constraintdef(oid) as constraint_definition
      FROM pg_constraint
      WHERE conrelid = 'subscriptions'::regclass
        AND contype = 'c'
        AND conname = 'subscriptions_tier_check'
    `);

    if (verifyCheck.rows.length > 0) {
      console.log('   New constraint:');
      console.log(`   ${verifyCheck.rows[0].constraint_definition}\n`);
    }

    // Check existing subscriptions to ensure they're still valid
    console.log('📊 Checking existing subscriptions...');
    const subscriptions = await client.query(`
      SELECT tier, COUNT(*) as count
      FROM subscriptions
      GROUP BY tier
      ORDER BY tier
    `);

    if (subscriptions.rows.length > 0) {
      console.log('   Existing subscription tiers:');
      subscriptions.rows.forEach(row => {
        console.log(`   - ${row.tier}: ${row.count} subscription(s)`);
      });
    } else {
      console.log('   No subscriptions found');
    }
    console.log('');

    console.log('✅ Migration completed successfully!');
    console.log('');
    console.log('📝 Summary:');
    console.log('   - Updated subscriptions table CHECK constraint');
    console.log('   - Now supports both legacy (daily/weekly/monthly) and new (tier_one/tier_two/tier_three/tier_four) tier names');
    console.log('   - All existing subscriptions remain valid');
    console.log('   - Ready for deployment');

  } catch (error) {
    console.error('❌ Migration failed:');
    console.error(error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    await client.end();
  }
}

runMigration();













