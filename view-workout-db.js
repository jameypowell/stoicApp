// View a specific workout from the database
const { initDatabase, Database } = require('./database');

async function viewWorkout(date) {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  const workout = await db.getWorkoutByDate(date);

  if (!workout) {
    console.log(`❌ No workout found for date: ${date}`);
    console.log('');
    console.log('Available dates:');
    const allWorkouts = await db.getAllWorkouts();
    const dates = allWorkouts.map(w => w.workout_date).slice(0, 10);
    dates.forEach(d => console.log(`  - ${d}`));
    if (allWorkouts.length > 10) {
      console.log(`  ... and ${allWorkouts.length - 10} more`);
    }
    return;
  }

  console.log('════════════════════════════════════════════════');
  console.log('📅 Workout Data in Database');
  console.log('════════════════════════════════════════════════');
  console.log('');
  console.log('Database Record:');
  console.log('────────────────────────────────────────────────');
  console.log(JSON.stringify(workout, null, 2));
  console.log('────────────────────────────────────────────────');
  console.log('');
  console.log('Formatted View:');
  console.log('────────────────────────────────────────────────');
  console.log(`ID: ${workout.id}`);
  console.log(`Date: ${workout.workout_date}`);
  console.log(`Google Drive File ID: ${workout.google_drive_file_id}`);
  console.log(`Title: ${workout.title || 'N/A'}`);
  console.log(`Created: ${workout.created_at}`);
  console.log(`Updated: ${workout.updated_at}`);
  console.log('');
  console.log('Content:');
  console.log('────────────────────────────────────────────────');
  console.log(workout.content);
  console.log('────────────────────────────────────────────────');
  console.log('');
  console.log('Content Statistics:');
  console.log(`  Characters: ${workout.content.length}`);
  console.log(`  Words: ${workout.content.split(/\s+/).filter(w => w.length > 0).length}`);
  console.log(`  Lines: ${workout.content.split('\n').length}`);
}

const date = process.argv[2] || '2025-11-03';
viewWorkout(date).catch(console.error);

