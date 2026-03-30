// Quick script to view stored workouts
const { initDatabase, Database } = require('./database');

async function viewStoredWorkouts() {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  const workouts = await db.getAllWorkouts();

  console.log('════════════════════════════════════════════════');
  console.log('📊 Stored Workouts in Database');
  console.log('════════════════════════════════════════════════');
  console.log('');
  console.log(`Total workouts stored: ${workouts.length}`);
  console.log('');

  if (workouts.length > 0) {
    console.log('Workouts:');
    workouts.forEach((w, i) => {
      console.log(`  ${i + 1}. ${w.workout_date} - ${w.title || 'Untitled'}`);
      console.log(`     Content: ${w.content.substring(0, 60)}...`);
    });
  } else {
    console.log('No workouts stored yet.');
    console.log('');
    console.log('Run: node sync-all-workouts.js FILE_ID');
  }
}

viewStoredWorkouts().catch(console.error);

