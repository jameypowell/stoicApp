// Script to view the imported strength workout
const { initDatabase, Database } = require('./database');
require('dotenv').config();

const USE_POSTGRES = !!process.env.DB_HOST;

async function viewStrengthWorkout() {
  try {
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // Get the strength workout we just imported (2025-11-22)
    const workout = await db.getWorkoutByDate('2025-11-22');

    if (!workout) {
      console.log('❌ No workout found for date 2025-11-22');
      process.exit(1);
    }

    console.log('════════════════════════════════════════════════');
    console.log('📋 STRENGTH WORKOUT - DATABASE RECORD');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('🗄️  Database Structure:');
    console.log('────────────────────────────────────────────────');
    console.log(JSON.stringify(workout, null, 2));
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('📄 Formatted View:');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log(`ID: ${workout.id}`);
    console.log(`Date: ${workout.workout_date}`);
    console.log(`Type: ${workout.workout_type || 'regular'}`);
    console.log(`Title: ${workout.title || 'N/A'}`);
    console.log(`Google Drive File ID: ${workout.google_drive_file_id}`);
    console.log(`Created At: ${workout.created_at}`);
    console.log(`Updated At: ${workout.updated_at}`);
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('📝 Content:');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log(workout.content);
    console.log('');

    // Also show all strength workouts
    console.log('════════════════════════════════════════════════');
    console.log('💪 All Strength Workouts in Database:');
    console.log('════════════════════════════════════════════════');
    console.log('');

    let strengthWorkouts;
    if (USE_POSTGRES) {
      const result = await dbConnection.query(
        "SELECT * FROM workouts WHERE workout_type = 'strength' ORDER BY workout_date"
      );
      strengthWorkouts = result.rows;
    } else {
      strengthWorkouts = await new Promise((resolve, reject) => {
        dbConnection.all(
          "SELECT * FROM workouts WHERE workout_type = 'strength' ORDER BY workout_date",
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          }
        );
      });
    }

    if (strengthWorkouts.length === 0) {
      console.log('  No strength workouts found.');
    } else {
      strengthWorkouts.forEach((w, i) => {
        console.log(`  ${i + 1}. Date: ${w.workout_date}`);
        console.log(`     Type: ${w.workout_type}`);
        console.log(`     Title: ${w.title || 'N/A'}`);
        console.log(`     Content Preview: ${w.content.substring(0, 80)}...`);
        console.log('');
      });
    }

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

viewStrengthWorkout();



