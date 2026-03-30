/**
 * Script to find December 5th workout in production
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDatabase, Database } = require('../database');

async function findWorkout() {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  // Try both 2024 and 2025
  const dates = ['2024-12-05', '2025-12-05'];
  
  for (const date of dates) {
    const workout = await db.getWorkoutByDate(date);
    if (workout) {
      console.log(`✅ Found workout for ${date}:`);
      console.log(`   Title: ${workout.title || 'N/A'}`);
      console.log(`   Content preview: ${workout.content.substring(0, 200)}...`);
      console.log('');
      
      // Check if it contains "45 Min Field Day"
      if (workout.content.includes('45 Min Field Day')) {
        console.log('✅ This is the correct workout!');
        return { date, workout };
      }
    }
  }
  
  // Search for workouts containing "45 Min Field Day"
  console.log('🔍 Searching for workouts containing "45 Min Field Day"...');
  const allWorkouts = await db.getAllWorkouts();
  const matching = allWorkouts.filter(w => 
    w.content && w.content.includes('45 Min Field Day')
  );
  
  if (matching.length > 0) {
    console.log(`\nFound ${matching.length} workout(s) with "45 Min Field Day":`);
    matching.forEach(w => {
      console.log(`  Date: ${w.workout_date}`);
      console.log(`  Title: ${w.title || 'N/A'}`);
      console.log('');
    });
  } else {
    console.log('❌ No workouts found with "45 Min Field Day"');
  }
  
  if (dbConnection && typeof dbConnection.end === 'function') {
    await dbConnection.end();
  }
}

findWorkout();
















