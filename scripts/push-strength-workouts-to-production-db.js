#!/usr/bin/env node
/**
 * Push strength workouts directly to production database
 * Can filter by phase for incremental testing
 * 
 * Usage: node scripts/push-strength-workouts-to-production-db.js [PHASE]
 *   PHASE can be: "Phase One: Beginner", "Phase Two: Intermediate", "Phase Three: Advanced", or "all"
 */

require('dotenv').config();
const { initDatabase, Database } = require('../database');
const { Client } = require('pg');

const phaseFilter = process.argv[2] || 'Phase One: Beginner'; // Default to Phase One for testing

async function pushStrengthWorkoutsToProductionDB() {
  let localDbConnection, prodDbConnection;
  
  try {
    console.log(`🔄 Pushing Strength workouts (${phaseFilter}) from localhost to production database...\n`);

    // Step 1: Get strength workouts from localhost
    console.log('📥 Reading Strength workouts from localhost database...');
    
    // Clear production DB env vars to force SQLite
    const originalDbHost = process.env.DB_HOST;
    const originalDbUser = process.env.DB_USER;
    const originalDbPassword = process.env.DB_PASSWORD;
    const originalDbName = process.env.DB_NAME;
    
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    
    localDbConnection = await initDatabase();
    const localDb = new Database(localDbConnection);
    
    let allStrengthWorkouts = await localDb.getAllStrengthWorkouts();
    
    // Filter by phase if specified
    if (phaseFilter !== 'all') {
      allStrengthWorkouts = allStrengthWorkouts.filter(w => w.phase === phaseFilter);
    }
    
    console.log(`✅ Found ${allStrengthWorkouts.length} Strength workouts in localhost (filter: ${phaseFilter})\n`);

    if (allStrengthWorkouts.length === 0) {
      console.log('⚠️  No Strength workouts found matching the filter');
      process.exit(0);
    }

    // Step 2: Connect directly to production PostgreSQL database
    console.log('📤 Connecting to production database...');
    
    const prodDbHost = originalDbHost || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
    const prodDbUser = originalDbUser || 'stoicapp';
    const prodDbName = originalDbName || 'postgres';
    const prodDbPassword = originalDbPassword || 'StoicDBtrong';
    const prodDbPort = '5432';
    
    console.log(`   Host: ${prodDbHost}`);
    console.log(`   Database: ${prodDbName}\n`);
    
    // Create PostgreSQL client directly
    prodDbConnection = new Client({
      host: prodDbHost,
      port: prodDbPort,
      database: prodDbName,
      user: prodDbUser,
      password: prodDbPassword,
      ssl: { rejectUnauthorized: false }
    });
    
    await prodDbConnection.connect();
    console.log('✅ Connected to production database\n');
    
    // Step 3: Insert/update workouts in production
    console.log('💾 Inserting/updating workouts in production database...\n');
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const workout of allStrengthWorkouts) {
      try {
        // Check if workout already exists
        const existingResult = await prodDbConnection.query(
          'SELECT * FROM strength_workouts WHERE workout_date = $1',
          [workout.workout_date]
        );
        const existing = existingResult.rows[0];
        
        if (existing) {
          // Update existing workout
          await prodDbConnection.query(
            `UPDATE strength_workouts 
             SET google_drive_file_id = $1, title = $2, content = $3, phase = $4, 
                 primary_focus = $5, secondary_focus = $6, slide_number = $7, 
                 workout_index = $8, workout_number = $9, updated_at = CURRENT_TIMESTAMP
             WHERE workout_date = $10`,
            [
              workout.google_drive_file_id,
              workout.title || `Strength - ${workout.phase}`,
              workout.content,
              workout.phase,
              workout.primary_focus,
              workout.secondary_focus,
              workout.slide_number,
              workout.workout_index,
              workout.workout_number,
              workout.workout_date
            ]
          );
          console.log(`  ↻ Updated ${workout.workout_date} (${workout.phase}) - Workout:${workout.workout_number || 'N/A'}`);
        } else {
          // Insert new workout
          await prodDbConnection.query(
            `INSERT INTO strength_workouts 
             (workout_date, google_drive_file_id, title, content, phase, primary_focus, 
              secondary_focus, slide_number, workout_index, workout_number)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)`,
            [
              workout.workout_date,
              workout.google_drive_file_id,
              workout.title || `Strength - ${workout.phase}`,
              workout.content,
              workout.phase,
              workout.primary_focus,
              workout.secondary_focus,
              workout.slide_number,
              workout.workout_index,
              workout.workout_number
            ]
          );
          console.log(`  ✓ Created ${workout.workout_date} (${workout.phase}) - Workout:${workout.workout_number || 'N/A'}`);
        }
        
        successCount++;
      } catch (error) {
        failCount++;
        errors.push({ date: workout.workout_date, error: error.message });
        console.log(`  ✗ Error ${workout.workout_date}: ${error.message}`);
      }
    }

    console.log('\n════════════════════════════════════════════════');
    console.log('✅ PUSH COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log(`\n📊 Summary:`);
    console.log(`  Total workouts: ${allStrengthWorkouts.length}`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Failed: ${failCount}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors:');
      errors.forEach(err => {
        console.log(`  ${err.date}: ${err.error}`);
      });
    }

    console.log('\n🎉 Strength workouts push complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  } finally {
    // Close connections
    if (localDbConnection && typeof localDbConnection.close === 'function') {
      localDbConnection.close();
    }
    if (prodDbConnection) {
      await prodDbConnection.end();
    }
  }
}

pushStrengthWorkoutsToProductionDB();
