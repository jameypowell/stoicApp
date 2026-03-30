/**
 * Add a functional fitness workout for a given date (default: tomorrow).
 * Content is formatted so the app's parser shows section headers as bold/underlined.
 *
 * Usage:
 *   node scripts/add_functional_fitness_workout.js              # tomorrow
 *   node scripts/add_functional_fitness_workout.js 2026-03-09   # specific date
 *
 * For production, set DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (and optionally DB_SSL=false).
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDatabase, Database } = require('../database');

const FUNCTIONAL_FITNESS_FILE_ID = '1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4';

function getTomorrowDate() {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return d.toISOString().split('T')[0];
}

const WORKOUT_CONTENT = `MONDAY, March 9th

Warm Up – 5 minutes
(40 sec each / continuous rotation)
1. 40 sec Jog
2. Mini Band Lateral Walks
3. Toy Soldiers
4. Hamstring Scoops
5. PVC Overhead Squats
6. Reverse Lunges
7. Air Squats

Core Conditioning – 5 minutes:
40 sec work / 20 sec transition
1. Hollow Hold
2. DB Farmer Carry March
3. Mini Band Deadbugs
4. Plank Shoulder Taps
5. Hollow Hold
repeat sequence

Main Circuit-Lower Body/Squat Dominant 35 min:
1. Barbell Front Squat 3–4 sets x4–6 reps Blue pill (Hypertrophy 70%-85% of 1RM: 45 sec rest) 1–2 sets x10–12 reps Green pill (Conditioning 30%-50% of 1RM: 20 sec rest)
2. DB Step Ups 3–4 sets x4–6 reps ea Blue pill (Hypertrophy 70%-85% of 1RM: 45 sec rest) 1–2 sets x10–12 reps alt Green pill (Conditioning 30%-50% of 1RM: 20 sec rest)
3. DB Walking Lunges x16–20 reps alt
4. Jump Squats 2 sets x30 sec
5. Weighted Bar Overhead Squats x12 reps
6. KB Goblet Cyclist Squats x12 reps
7. Rower – Sprint Pace x1 min max effort
8. KB Swings 2 sets x6–8 reps`;

const CAROUSEL_SUBHEADER = 'Lower Body — Squat Dominant';

async function addWorkout() {
  const workoutDate = process.argv[2] || getTomorrowDate();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(workoutDate)) {
    console.error('Invalid date. Use YYYY-MM-DD (e.g. 2026-03-09) or no argument for tomorrow.');
    process.exit(1);
  }

  console.log('\n📅 Adding Functional Fitness workout');
  console.log(`   Date: ${workoutDate}`);
  console.log(`   Carousel subheader: ${CAROUSEL_SUBHEADER}\n`);

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  const isPostgres = !!process.env.DB_HOST;

  try {
    await db.createWorkout(
      workoutDate,
      FUNCTIONAL_FITNESS_FILE_ID,
      'Functional Fitness',
      WORKOUT_CONTENT,
      'functional_fitness'
    );
    console.log('✅ Workout created/updated.');

    try {
      if (isPostgres) {
        await db.query(
          `UPDATE workouts SET focus_areas = $1 WHERE workout_date = $2`,
          [CAROUSEL_SUBHEADER, workoutDate]
        );
      } else {
        await db.query(
          `UPDATE workouts SET focus_areas = ? WHERE workout_date = ?`,
          [CAROUSEL_SUBHEADER, workoutDate]
        );
      }
      console.log('✅ focus_areas (carousel subheader) set.');
    } catch (e) {
      if (e.message && e.message.includes('focus_areas')) {
        console.log('⚠️  focus_areas column not found; carousel subheader may not show.');
      } else {
        throw e;
      }
    }

    const row = await db.getWorkoutByDate(workoutDate);
    if (row) {
      console.log('\n📋 Stored workout preview:');
      console.log('─'.repeat(60));
      console.log((row.content || '').split('\n').slice(0, 20).join('\n'));
      console.log('─'.repeat(60));
      if (row.focus_areas) {
        console.log(`Carousel subheader: ${row.focus_areas}`);
      }
    }
    console.log('\n✅ Done.\n');
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  } finally {
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    }
  }
}

addWorkout();
