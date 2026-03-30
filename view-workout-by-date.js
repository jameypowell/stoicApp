// Script to view a workout by date
const { initDatabase, Database } = require('./database');
require('dotenv').config();

const workoutDate = process.argv[2] || '2025-12-22';

async function viewWorkout() {
  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // Get workout by date
    const workout = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM workouts WHERE workout_date = $1'
        : 'SELECT * FROM workouts WHERE workout_date = ?',
      [workoutDate]
    );

    if (!workout) {
      console.log(`❌ No workout found for date: ${workoutDate}`);
      process.exit(1);
    }

    console.log('════════════════════════════════════════════════');
    console.log('📅 Workout Details');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Date:', workout.workout_date);
    console.log('Title:', workout.title || 'N/A');
    console.log('Workout Type:', workout.workout_type || 'regular');
    console.log('File ID:', workout.google_drive_file_id || 'N/A');
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('📝 Workout Content:');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log(workout.content || 'No content');
    console.log('');
    console.log('════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

viewWorkout();







