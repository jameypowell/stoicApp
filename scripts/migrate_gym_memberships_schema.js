// Migration script to update gym_memberships table to align with membership-rules.json
// This script safely adds new columns and updates constraints without breaking existing functionality
// 
// Usage: 
//   Set environment variables: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT (optional), DB_SSL (optional)
//   Or run: DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... node scripts/migrate_gym_memberships_schema.js

const { Client } = require('pg');
const path = require('path');

// Try to load .env file if it exists
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // .env file not found, use environment variables directly
}

async function migrateGymMemberships() {
  // Check for required environment variables
  if (!process.env.DB_HOST) {
    console.error('Error: DB_HOST environment variable is not set');
    console.error('Please set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD');
    process.exit(1);
  }

  // Try to get database name - if null, use 'postgres' as default
  const dbName = process.env.DB_NAME || process.env.DB_DATABASE || 'postgres';
  
  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: dbName,
    user: process.env.DB_USER || process.env.DB_USERNAME,
    password: process.env.DB_PASSWORD,
  };

  // Add SSL if configured
  if (process.env.DB_SSL === 'true' || process.env.DB_SSL === 'require') {
    dbConfig.ssl = { rejectUnauthorized: false };
  }

  console.log(`Connecting to database: ${dbConfig.host}:${dbConfig.port}/${dbConfig.database} as ${dbConfig.user}`);

  const client = new Client(dbConfig);

  try {
    await client.connect();
    console.log('Connected to production database');

    // Start transaction
    await client.query('BEGIN');

    console.log('Starting gym_memberships table migration...');

    // 1. Add 'paused' to status CHECK constraint
    // First, drop the existing constraint
    console.log('Updating status constraint to include "paused"...');
    await client.query(`
      ALTER TABLE gym_memberships 
      DROP CONSTRAINT IF EXISTS gym_memberships_status_check;
    `);

    // Add new constraint with 'paused' included
    await client.query(`
      ALTER TABLE gym_memberships 
      ADD CONSTRAINT gym_memberships_status_check 
      CHECK (status IN ('active', 'paused', 'inactive', 'expired'));
    `);

    // 2. Add new column for contract tracking (if it doesn't exist)
    console.log('Adding contract tracking columns...');
    
    // Check if columns exist before adding
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gym_memberships' 
      AND column_name IN ('contract_start_date', 'contract_end_date', 'contract_months', 'cancellation_fee_charged', 'cancellation_fee_amount', 'pauses_used_this_contract')
    `);
    
    const existingColumns = columnCheck.rows.map(r => r.column_name);

    if (!existingColumns.includes('contract_start_date')) {
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN contract_start_date TIMESTAMP;
      `);
      console.log('Added contract_start_date column');
    }

    if (!existingColumns.includes('contract_end_date')) {
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN contract_end_date TIMESTAMP;
      `);
      console.log('Added contract_end_date column');
    }

    if (!existingColumns.includes('contract_months')) {
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN contract_months INTEGER DEFAULT 12;
      `);
      console.log('Added contract_months column');
    }

    if (!existingColumns.includes('cancellation_fee_charged')) {
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN cancellation_fee_charged BOOLEAN DEFAULT FALSE;
      `);
      console.log('Added cancellation_fee_charged column');
    }

    if (!existingColumns.includes('cancellation_fee_amount')) {
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN cancellation_fee_amount INTEGER DEFAULT 0;
      `);
      console.log('Added cancellation_fee_amount column');
    }

    // 3. Handle pause tracking field rename
    // Check if old column exists
    const oldPauseCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gym_memberships' 
      AND column_name = 'pauses_used_this_year'
    `);

    const newPauseCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gym_memberships' 
      AND column_name = 'pauses_used_this_contract'
    `);

    if (oldPauseCheck.rows.length > 0 && newPauseCheck.rows.length === 0) {
      // Migrate data from old column to new column
      console.log('Migrating pause tracking data...');
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN pauses_used_this_contract INTEGER DEFAULT 0;
      `);
      
      await client.query(`
        UPDATE gym_memberships 
        SET pauses_used_this_contract = pauses_used_this_year 
        WHERE pauses_used_this_year IS NOT NULL;
      `);
      
      // Keep old column for now (don't drop it to avoid breaking anything)
      // It can be dropped in a future migration after verifying everything works
      console.log('Migrated pause data. Old column kept for safety.');
    } else if (newPauseCheck.rows.length === 0) {
      // Just add the new column if neither exists
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN pauses_used_this_contract INTEGER DEFAULT 0;
      `);
      console.log('Added pauses_used_this_contract column');
    } else {
      console.log('pauses_used_this_contract column already exists');
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log('Migration completed successfully!');

  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('Migration failed, rolling back:', error);
    throw error;
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

// Run migration
migrateGymMemberships()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration script failed:', error);
    process.exit(1);
  });

