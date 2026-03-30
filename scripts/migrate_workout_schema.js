// Migration script to add new columns to workouts table
// Adds: workout_type, focus_areas, structured_data

const { Client } = require('pg');
require('dotenv').config();

async function migrateWorkoutSchema() {
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

    // Check if columns already exist
    const checkColumns = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'workouts' 
      AND column_name IN ('workout_type', 'focus_areas', 'structured_data')
    `);

    const existingColumns = checkColumns.rows.map(row => row.column_name);
    console.log('Existing columns:', existingColumns);

    // Add workout_type column if it doesn't exist
    if (!existingColumns.includes('workout_type')) {
      console.log('Adding workout_type column...');
      await client.query(`
        ALTER TABLE workouts 
        ADD COLUMN workout_type TEXT CHECK(workout_type IN ('functional_fitness', 'core_finisher', 'strength'))
      `);
      console.log('✅ Added workout_type column');
    } else {
      console.log('✅ workout_type column already exists');
    }

    // Add focus_areas column if it doesn't exist
    if (!existingColumns.includes('focus_areas')) {
      console.log('Adding focus_areas column...');
      await client.query(`
        ALTER TABLE workouts 
        ADD COLUMN focus_areas TEXT
      `);
      console.log('✅ Added focus_areas column');
    } else {
      console.log('✅ focus_areas column already exists');
    }

    // Add structured_data column if it doesn't exist
    if (!existingColumns.includes('structured_data')) {
      console.log('Adding structured_data column...');
      await client.query(`
        ALTER TABLE workouts 
        ADD COLUMN structured_data JSONB
      `);
      console.log('✅ Added structured_data column');
    } else {
      console.log('✅ structured_data column already exists');
    }

    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run migration
migrateWorkoutSchema()
  .then(() => {
    console.log('Migration script completed');
    process.exit(0);
  })
  .catch((error) => {
    console.error('Migration failed:', error);
    process.exit(1);
  });













