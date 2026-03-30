// Migration script to add household_id column to gym_memberships table in production
// This script safely adds the column without breaking existing functionality
// 
// Usage: 
//   Set environment variables: DB_HOST, DB_NAME, DB_USER, DB_PASSWORD, DB_PORT (optional), DB_SSL (optional)
//   Or run: DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... node scripts/migrate_add_household_id.js

const { Client } = require('pg');
const path = require('path');

// Try to load .env file if it exists
try {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
} catch (e) {
  // .env file not found, use environment variables directly
}

async function migrateHouseholdId() {
  // Check for required environment variables
  if (!process.env.DB_HOST) {
    console.error('Error: DB_HOST environment variable is not set');
    console.error('Please set DB_HOST, DB_NAME, DB_USER, and DB_PASSWORD');
    process.exit(1);
  }

  const dbConfig = {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432'),
    database: process.env.DB_NAME || process.env.DB_DATABASE,
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

    console.log('Starting household_id column migration...');

    // Check if column already exists
    const columnCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gym_memberships' 
      AND column_name = 'household_id'
    `);
    
    if (columnCheck.rows.length > 0) {
      console.log('✓ household_id column already exists');
    } else {
      // Add household_id column
      console.log('Adding household_id column...');
      await client.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN household_id TEXT UNIQUE;
      `);
      console.log('✓ Added household_id column');
    }

    // Check if index already exists
    const indexCheck = await client.query(`
      SELECT indexname 
      FROM pg_indexes 
      WHERE tablename = 'gym_memberships' 
      AND indexname = 'idx_gym_memberships_household_id'
    `);

    if (indexCheck.rows.length > 0) {
      console.log('✓ household_id index already exists');
    } else {
      // Add index for performance
      console.log('Adding household_id index...');
      await client.query(`
        CREATE INDEX IF NOT EXISTS idx_gym_memberships_household_id 
        ON gym_memberships(household_id);
      `);
      console.log('✓ Added household_id index');
    }

    // Commit transaction
    await client.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    // Rollback on error
    await client.query('ROLLBACK');
    console.error('\n❌ Migration failed, rolling back:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    await client.end();
    console.log('Database connection closed');
  }
}

// Run migration
migrateHouseholdId()
  .then(() => {
    console.log('\nMigration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error);
    process.exit(1);
  });











