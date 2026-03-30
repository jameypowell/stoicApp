#!/usr/bin/env node
/**
 * Push Core Finisher workouts directly from local SQLite to production PostgreSQL
 * 
 * This script:
 * 1. Reads Core Finisher workouts from local SQLite database
 * 2. Pushes them directly to production PostgreSQL database
 * 
 * Usage:
 *   node scripts/push_core_finishers_direct.js
 * 
 * Environment variables required for production:
 *   DB_HOST - PostgreSQL host
 *   DB_PORT - PostgreSQL port (default: 5432)
 *   DB_NAME - Database name (default: postgres)
 *   DB_USER - Database user
 *   DB_PASSWORD - Database password
 */

const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

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

async function getCoreFinishersFromSQLite() {
  return new Promise((resolve, reject) => {
    sqliteDb.all(
      `SELECT * FROM workouts 
       WHERE workout_type = 'core' 
          OR (workout_type IS NULL AND google_drive_file_id = '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4')
       ORDER BY workout_date`,
      (err, rows) => {
        if (err) reject(err);
        else resolve(rows);
      }
    );
  });
}

async function ensureWorkoutTypeColumn() {
  try {
    // Check if column exists
    const checkResult = await pgClient.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'workouts' AND column_name = 'workout_type'
    `);
    
    if (checkResult.rows.length === 0) {
      console.log('📝 Adding workout_type column to production database...');
      await pgClient.query(`
        ALTER TABLE workouts 
        ADD COLUMN workout_type TEXT DEFAULT 'regular' 
        CHECK(workout_type IN ('regular', 'core'))
      `);
      console.log('✅ workout_type column added');
    } else {
      console.log('✅ workout_type column already exists');
    }
  } catch (error) {
    console.error('⚠️  Error checking/adding workout_type column:', error.message);
    // Continue anyway - might already exist
  }
}

async function pushCoreFinishers() {
  try {
    console.log('🔄 Pushing Core Finisher workouts from local to production...\n');

    // Connect to production
    console.log('🔌 Connecting to production database...');
    await pgClient.connect();
    console.log('✅ Connected to production database\n');

    // Ensure workout_type column exists
    await ensureWorkoutTypeColumn();
    console.log('');

    // Get core finishers from local database
    console.log('📥 Reading Core Finisher workouts from local database...');
    const coreWorkouts = await getCoreFinishersFromSQLite();
    console.log(`✅ Found ${coreWorkouts.length} Core Finisher workouts\n`);

    if (coreWorkouts.length === 0) {
      console.log('⚠️  No Core Finisher workouts found in local database');
      await pgClient.end();
      process.exit(0);
    }

    // Push each workout
    console.log('📤 Pushing workouts to production...');
    let successful = 0;
    let failed = 0;
    const errors = [];

    for (const workout of coreWorkouts) {
      try {
        const workoutDate = typeof workout.workout_date === 'string' 
          ? workout.workout_date.split('T')[0].split(' ')[0]
          : new Date(workout.workout_date).toISOString().split('T')[0];

        // Check if workout already exists
        const existing = await pgClient.query(
          'SELECT id FROM workouts WHERE workout_date = $1',
          [workoutDate]
        );

        if (existing.rows.length > 0) {
          // Update existing workout
          await pgClient.query(
            `UPDATE workouts 
             SET google_drive_file_id = $1, 
                 title = $2, 
                 content = $3, 
                 workout_type = 'core',
                 updated_at = CURRENT_TIMESTAMP
             WHERE workout_date = $4`,
            [
              workout.google_drive_file_id || '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4',
              workout.title || 'Core Finisher',
              workout.content,
              workoutDate
            ]
          );
          console.log(`  ✓ Updated: ${workoutDate}`);
        } else {
          // Insert new workout
          await pgClient.query(
            `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type)
             VALUES ($1, $2, $3, $4, 'core')`,
            [
              workoutDate,
              workout.google_drive_file_id || '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4',
              workout.title || 'Core Finisher',
              workout.content
            ]
          );
          console.log(`  ✓ Created: ${workoutDate}`);
        }
        successful++;
      } catch (error) {
        failed++;
        const workoutDate = typeof workout.workout_date === 'string' 
          ? workout.workout_date.split('T')[0].split(' ')[0]
          : new Date(workout.workout_date).toISOString().split('T')[0];
        errors.push({ date: workoutDate, error: error.message });
        console.log(`  ✗ Failed: ${workoutDate} - ${error.message}`);
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ SYNC COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log('  Total Core Finisher workouts:', coreWorkouts.length);
    console.log('  Successfully synced:', successful);
    console.log('  Failed:', failed);
    console.log('');

    if (errors.length > 0) {
      console.log('⚠️  Errors:');
      errors.forEach(err => {
        console.log(`  ${err.date}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 Core Finisher workouts synced to production database!');

    await pgClient.end();
  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    if (pgClient) {
      await pgClient.end();
    }
    process.exit(1);
  }
}

pushCoreFinishers();





