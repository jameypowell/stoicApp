// Assign workout numbers to strength workouts in production
// This script connects to production database and assigns workout numbers
require('dotenv').config();
const { initDatabase, Database } = require('../database');

async function assignWorkoutNumbersProduction() {
  try {
    console.log('🔄 Assigning workout numbers to strength workouts in PRODUCTION...\n');
    
    // Make sure we're using production database credentials
    if (!process.env.DB_HOST) {
      console.error('❌ Error: Production database credentials not found in environment variables');
      console.log('   Make sure DB_HOST, DB_USER, DB_PASSWORD, and DB_NAME are set');
      process.exit(1);
    }
    
    console.log('📋 Connecting to production database...');
    console.log(`   Host: ${process.env.DB_HOST}`);
    console.log(`   Database: ${process.env.DB_NAME}\n`);
    
    // Initialize database (will use PostgreSQL from env vars)
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    // Check if workout_number column exists, if not add it
    console.log('📋 Checking database schema...');
    const USE_POSTGRES = !!process.env.DB_HOST;
    
    if (USE_POSTGRES) {
      // Check if column exists
      const checkColumn = await dbConnection.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'strength_workouts' AND column_name = 'workout_number'
      `);
      
      if (checkColumn.rows.length === 0) {
        console.log('  Adding workout_number column...');
        await dbConnection.query(`
          ALTER TABLE strength_workouts 
          ADD COLUMN workout_number INTEGER
        `);
        console.log('  ✅ Column added\n');
      } else {
        console.log('  ✅ Column already exists\n');
      }
    }
    
    // Get all strength workouts grouped by phase
    const allWorkouts = await db.getAllStrengthWorkouts();
    
    // Group by phase and sort by date
    const workoutsByPhase = {};
    allWorkouts.forEach(workout => {
      const phase = workout.phase || 'Unknown';
      if (!workoutsByPhase[phase]) {
        workoutsByPhase[phase] = [];
      }
      workoutsByPhase[phase].push(workout);
    });
    
    // Sort each phase by workout_date
    Object.keys(workoutsByPhase).forEach(phase => {
      workoutsByPhase[phase].sort((a, b) => {
        return a.workout_date.localeCompare(b.workout_date);
      });
    });
    
    console.log('📊 Workouts by phase:');
    Object.keys(workoutsByPhase).forEach(phase => {
      console.log(`  ${phase}: ${workoutsByPhase[phase].length} workouts`);
    });
    console.log('');
    
    // Assign numbers in format: Phase One = 101, 102, 103... Phase Two = 201, 202, 203... Phase Three = 301, 302, 303...
    const phaseMultipliers = {
      'Phase One: Beginner': 100,
      'Phase Two: Intermediate': 200,
      'Phase Three: Advanced': 300
    };
    
    let totalUpdated = 0;
    
    for (const phase of Object.keys(workoutsByPhase)) {
      const workouts = workoutsByPhase[phase];
      const phaseMultiplier = phaseMultipliers[phase] || 100;
      
      for (let i = 0; i < workouts.length; i++) {
        const workout = workouts[i];
        const workoutNumber = phaseMultiplier + (i + 1); // 101, 102, 103... or 201, 202, 203... or 301, 302, 303...
        
        // Update workout with number
        await dbConnection.query(
          `UPDATE strength_workouts 
           SET workout_number = $1, updated_at = CURRENT_TIMESTAMP
           WHERE id = $2`,
          [workoutNumber, workout.id]
        );
        
        totalUpdated++;
      }
    }
    
    console.log(`✅ Assigned workout numbers to ${totalUpdated} workouts in PRODUCTION\n`);
    console.log('📋 Sample assignments:');
    Object.keys(workoutsByPhase).forEach(phase => {
      const workouts = workoutsByPhase[phase];
      console.log(`  ${phase}:`);
      workouts.slice(0, 3).forEach(w => {
        const phaseMultiplier = phaseMultipliers[phase] || 100;
        const expectedNumber = phaseMultiplier + (workouts.indexOf(w) + 1);
        console.log(`    Workout #${expectedNumber} (${w.workout_date})`);
      });
      if (workouts.length > 3) {
        console.log(`    ... and ${workouts.length - 3} more`);
      }
    });
    
    console.log('\n✅ Production workout numbers assignment complete!');
    
  } catch (error) {
    console.error('❌ Error assigning workout numbers:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

assignWorkoutNumbersProduction();



