// Script to import Functional Fitness workouts from Google Slides
// This parses each slide individually and extracts dates, then marks them as 'regular' type
// It will NOT overwrite existing core finisher workouts
const { syncAllWorkoutsFromSlides } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// Get file ID from command line argument or use the provided one
const fileId = process.argv[2] || '1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4';

// Get USE_POSTGRES from environment
const USE_POSTGRES = !!process.env.DB_HOST;

async function importFunctionalFitness() {
  console.log('🔄 Importing Functional Fitness workouts from Google Slides...\n');
  console.log('File ID:', fileId);
  console.log('');

  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // Sync all workouts from Google Slides
    const result = await syncAllWorkoutsFromSlides(fileId);

    console.log('════════════════════════════════════════════════');
    console.log('✅ Slides Parsed Successfully!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📄 File Information:');
    console.log('  File ID:', result.fileId);
    console.log('  File Name:', result.fileName);
    console.log('  Title:', result.title);
    console.log('  Total Slides:', result.totalSlides);
    console.log('');

    // Filter to only slides 16-22
    const slidesToImport = result.workouts.filter(w => w.slideNumber >= 16 && w.slideNumber <= 22);
    console.log(`📋 Filtering to slides 16-22: ${slidesToImport.length} slides found`);
    console.log('');
    
    // Show parsed workouts
    console.log('📋 Parsed Functional Fitness Workouts (Slides 16-22):');
    console.log('');
    
    const workoutsWithDates = slidesToImport.filter(w => w.date !== null);

    console.log(`✅ Workouts with dates: ${workoutsWithDates.length}`);
    workoutsWithDates.forEach((w, i) => {
      console.log(`  ${i + 1}. Slide ${w.slideNumber}: ${w.date}`);
      console.log(`     Preview: ${w.content.substring(0, 80)}...`);
    });
    console.log('');

    if (workoutsWithDates.length === 0) {
      console.log('❌ No workouts with valid dates found!');
      console.log('   Cannot store in database without dates.');
      process.exit(1);
    }

    // Prepare workouts for database with workout_type='regular' (or default)
    const workoutsToStore = workoutsWithDates.map(w => ({
      date: w.date,
      fileId: result.fileId,
      title: result.title,
      content: w.content,
      workoutType: 'regular'
    }));

    // Store all workouts in database
    console.log('💾 Storing Functional Fitness workouts in database...');
    console.log('   (Skipping any dates that already have core finisher workouts)\n');
    
    let successful = 0;
    let skipped = 0;
    let failed = 0;
    const errors = [];
    const skippedDates = [];

    for (let i = 0; i < workoutsToStore.length; i++) {
      const workout = workoutsToStore[i];
      try {
        // Check if workout already exists
        const existing = await db.getWorkoutByDate(workout.date);
        if (existing) {
          // If it's a core finisher, skip it to avoid overwriting
          if (existing.workout_type === 'core') {
            skipped++;
            skippedDates.push(workout.date);
            console.log(`  ⊘ Skipped (core finisher exists): ${workout.date}`);
            continue;
          }
          // Update existing workout to be regular type (if it wasn't already)
          if (USE_POSTGRES) {
            await dbConnection.query(
              `UPDATE workouts SET workout_type = 'regular', content = $1, title = $2, google_drive_file_id = $3 WHERE workout_date = $4`,
              [workout.content, workout.title, workout.fileId, workout.date]
            );
          } else {
            await new Promise((resolve, reject) => {
              dbConnection.run(
                `UPDATE workouts SET workout_type = 'regular', content = ?, title = ?, google_drive_file_id = ? WHERE workout_date = ?`,
                [workout.content, workout.title, workout.fileId, workout.date],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }
          console.log(`  ✓ Updated: ${workout.date}`);
        } else {
          // Create new workout with regular type
          if (USE_POSTGRES) {
            await dbConnection.query(
              `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) VALUES ($1, $2, $3, $4, 'regular')`,
              [workout.date, workout.fileId, workout.title, workout.content]
            );
          } else {
            await new Promise((resolve, reject) => {
              dbConnection.run(
                `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) VALUES (?, ?, ?, ?, 'regular')`,
                [workout.date, workout.fileId, workout.title, workout.content],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }
          console.log(`  ✓ Created: ${workout.date}`);
        }
        successful++;
      } catch (error) {
        failed++;
        errors.push({ index: i, date: workout.date, error: error.message });
        console.log(`  ✗ Failed: ${workout.date} - ${error.message}`);
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Database Results:');
    console.log('  Total processed:', workoutsToStore.length);
    console.log('  Successfully stored/updated:', successful);
    console.log('  Skipped (core finisher exists):', skipped);
    console.log('  Failed:', failed);
    console.log('');

    if (skippedDates.length > 0) {
      console.log('⚠️  Skipped dates (core finishers exist):');
      skippedDates.forEach(date => {
        console.log(`  - ${date}`);
      });
      console.log('');
    }

    if (errors.length > 0) {
      console.log('⚠️  Errors:');
      errors.forEach(err => {
        console.log(`  ${err.date}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 All Functional Fitness workouts stored in database!');
    console.log('   (Marked with workout_type = "regular")');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importFunctionalFitness();



