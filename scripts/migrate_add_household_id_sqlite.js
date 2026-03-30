// Migration script to add household_id column to gym_memberships table in SQLite
// Usage: node scripts/migrate_add_household_id_sqlite.js

const { initDatabase, Database } = require('../database');

async function migrateHouseholdIdSQLite() {
  const db = new Database(await initDatabase());
  
  try {
    console.log('Migrating SQLite database to add household_id column...\n');
    
    if (db.isPostgres) {
      console.log('This script is for SQLite only. Use migrate_add_household_id.js for PostgreSQL.');
      return;
    }
    
    // Check if column already exists by trying to query it
    let hasHouseholdId = false;
    try {
      await db.query('SELECT household_id FROM gym_memberships LIMIT 1');
      hasHouseholdId = true;
    } catch (error) {
      if (error.message && error.message.includes('no such column')) {
        hasHouseholdId = false;
      } else {
        throw error;
      }
    }
    
    if (hasHouseholdId) {
      console.log('✓ household_id column already exists');
    } else {
      // Add household_id column (SQLite doesn't support UNIQUE in ALTER TABLE ADD COLUMN)
      console.log('Adding household_id column...');
      await db.query(`
        ALTER TABLE gym_memberships 
        ADD COLUMN household_id TEXT;
      `);
      console.log('✓ Added household_id column');
      
      // Add unique constraint via a unique index
      console.log('Adding unique constraint...');
      await db.query(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_gym_memberships_household_id_unique 
        ON gym_memberships(household_id) WHERE household_id IS NOT NULL;
      `);
      console.log('✓ Added unique constraint');
    }
    
    // Add regular index for performance
    console.log('Adding household_id index...');
    await db.query(`
      CREATE INDEX IF NOT EXISTS idx_gym_memberships_household_id 
      ON gym_memberships(household_id);
    `);
    console.log('✓ Added household_id index');
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('\n❌ Migration failed:', error.message);
    throw error;
  } finally {
    if (db && db.client) {
      await db.client.end();
      console.log('Database connection closed');
    }
  }
}

// Run migration
migrateHouseholdIdSQLite()
  .then(() => {
    console.log('\nMigration script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nMigration script failed:', error);
    process.exit(1);
  });

