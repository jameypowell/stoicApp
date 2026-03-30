// Migration script that uses the application's database connection
// This way we can leverage the existing connection logic and credentials

const { initDatabase, Database } = require('../database');

async function migrateGymMemberships() {
  let db;
  
  try {
    console.log('Initializing database connection...');
    const dbConnection = await initDatabase();
    db = new Database(dbConnection);
    
    if (!db.isPostgres) {
      console.error('This migration is for PostgreSQL production database only');
      process.exit(1);
    }
    
    console.log('Connected to production database');
    console.log('Starting gym_memberships table migration...');

    // Start transaction
    await db.query('BEGIN');

    // 1. Add 'paused' to status CHECK constraint
    console.log('Updating status constraint to include "paused"...');
    await db.query(`
      ALTER TABLE gym_memberships 
      DROP CONSTRAINT IF EXISTS gym_memberships_status_check;
    `);

    await db.query(`
      ALTER TABLE gym_memberships 
      ADD CONSTRAINT gym_memberships_status_check 
      CHECK (status IN ('active', 'paused', 'inactive', 'expired'));
    `);

    // 2. Add new columns for contract tracking
    console.log('Adding contract tracking columns...');
    
    // Check if columns exist before adding
    const columnCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gym_memberships' 
      AND column_name IN ('contract_start_date', 'contract_end_date', 'contract_months', 'cancellation_fee_charged', 'cancellation_fee_amount', 'pauses_used_this_contract')
    `);
    
    const existingColumns = columnCheck.rows ? columnCheck.rows.map(r => r.column_name) : [];

    if (!existingColumns.includes('contract_start_date')) {
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN contract_start_date TIMESTAMP;
      `);
      console.log('✓ Added contract_start_date column');
    } else {
      console.log('  contract_start_date already exists');
    }

    if (!existingColumns.includes('contract_end_date')) {
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN contract_end_date TIMESTAMP;
      `);
      console.log('✓ Added contract_end_date column');
    } else {
      console.log('  contract_end_date already exists');
    }

    if (!existingColumns.includes('contract_months')) {
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN contract_months INTEGER DEFAULT 12;
      `);
      console.log('✓ Added contract_months column');
    } else {
      console.log('  contract_months already exists');
    }

    if (!existingColumns.includes('cancellation_fee_charged')) {
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN cancellation_fee_charged BOOLEAN DEFAULT FALSE;
      `);
      console.log('✓ Added cancellation_fee_charged column');
    } else {
      console.log('  cancellation_fee_charged already exists');
    }

    if (!existingColumns.includes('cancellation_fee_amount')) {
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN cancellation_fee_amount INTEGER DEFAULT 0;
      `);
      console.log('✓ Added cancellation_fee_amount column');
    } else {
      console.log('  cancellation_fee_amount already exists');
    }

    // 3. Handle pause tracking field
    const oldPauseCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gym_memberships' 
      AND column_name = 'pauses_used_this_year'
    `);

    const newPauseCheck = await db.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'gym_memberships' 
      AND column_name = 'pauses_used_this_contract'
    `);

    const hasOldPause = oldPauseCheck.rows && oldPauseCheck.rows.length > 0;
    const hasNewPause = newPauseCheck.rows && newPauseCheck.rows.length > 0;

    if (hasOldPause && !hasNewPause) {
      console.log('Migrating pause tracking data...');
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN pauses_used_this_contract INTEGER DEFAULT 0;
      `);
      
      await db.query(`
        UPDATE gym_memberships 
        SET pauses_used_this_contract = pauses_used_this_year 
        WHERE pauses_used_this_year IS NOT NULL;
      `);
      
      console.log('✓ Migrated pause data. Old column kept for safety.');
    } else if (!hasNewPause) {
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN pauses_used_this_contract INTEGER DEFAULT 0;
      `);
      console.log('✓ Added pauses_used_this_contract column');
    } else {
      console.log('  pauses_used_this_contract already exists');
    }

    // Commit transaction
    await db.query('COMMIT');
    console.log('\n✅ Migration completed successfully!');

  } catch (error) {
    // Rollback on error
    if (db) {
      try {
        await db.query('ROLLBACK');
      } catch (rollbackError) {
        console.error('Error during rollback:', rollbackError);
      }
    }
    console.error('\n❌ Migration failed:', error.message);
    console.error(error.stack);
    throw error;
  } finally {
    if (db && db.client) {
      await db.client.end();
      console.log('Database connection closed');
    }
  }
}

// Run migration
migrateGymMemberships()
  .then(() => {
    console.log('\nMigration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error);
    process.exit(1);
  });






