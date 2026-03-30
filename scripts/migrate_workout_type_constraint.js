// Migration script to update workouts table CHECK constraint for workout_type
// Updates from: ('regular', 'core') to ('functional_fitness', 'core_finisher', 'strength', 'regular', 'core')
// This maintains backward compatibility with existing data

const { Client } = require('pg');
require('dotenv').config();

async function migrateWorkoutTypeConstraint() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? {
      rejectUnauthorized: false
    } : false
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL database');

    // Drop the old constraint
    console.log('Dropping old workout_type constraint...');
    await client.query(`
      ALTER TABLE workouts 
      DROP CONSTRAINT IF EXISTS workouts_workout_type_check
    `);
    console.log('✅ Dropped old constraint');

    // Add new constraint with all allowed values (including legacy for backward compatibility)
    console.log('Adding new workout_type constraint...');
    await client.query(`
      ALTER TABLE workouts 
      ADD CONSTRAINT workouts_workout_type_check 
      CHECK (workout_type IN ('functional_fitness', 'core_finisher', 'strength', 'regular', 'core'))
    `);
    console.log('✅ Added new constraint');

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migration
migrateWorkoutTypeConstraint()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });













