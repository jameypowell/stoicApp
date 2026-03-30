// Script to import Core Finisher workouts from Google Slides
// This parses each slide individually and extracts dates, then marks them as 'core' type
const { syncAllWorkoutsFromSlides } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// Get file ID from command line argument or use the provided one
const fileId = process.argv[2] || '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4';

// Get USE_POSTGRES from environment
const USE_POSTGRES = !!process.env.DB_HOST;

async function importCoreFinishers() {
  console.log('🔄 Importing Core Finisher workouts from Google Slides...\n');
  console.log('File ID:', fileId);
  console.log('');

  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // First, add workout_type column if it doesn't exist
    try {
      if (USE_POSTGRES) {
        await dbConnection.query(`
          ALTER TABLE workouts 
          ADD COLUMN IF NOT EXISTS workout_type TEXT DEFAULT 'regular' CHECK(workout_type IN ('regular', 'core'))
        `);
      } else {
        // SQLite - check if column exists first
        const tableInfo = await new Promise((resolve, reject) => {
          dbConnection.all("PRAGMA table_info(workouts)", (err, rows) => {
            if (err) reject(err);
            else resolve(rows);
          });
        });
        
        const hasTypeColumn = tableInfo.some(col => col.name === 'workout_type');
        if (!hasTypeColumn) {
          await new Promise((resolve, reject) => {
            dbConnection.run("ALTER TABLE workouts ADD COLUMN workout_type TEXT DEFAULT 'regular'", (err) => {
              if (err) reject(err);
              else resolve();
            });
          });
        }
      }
      console.log('✅ Database schema updated (workout_type column)');
    } catch (error) {
      console.log('⚠️  Note: workout_type column may already exist:', error.message);
    }

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

    // Show parsed workouts
    console.log('📋 Parsed Core Finisher Workouts:');
    console.log('');
    
    // For core finishers without dates, assign sequential dates starting from today
    const today = new Date();
    const baseDate = new Date(today.getFullYear(), today.getMonth(), today.getDate());
    
    const workoutsWithDates = result.workouts
      .map((w, index) => {
        // If no date found, assign a date based on slide number (starting from today)
        if (w.date === null) {
          const assignedDate = new Date(baseDate);
          assignedDate.setDate(baseDate.getDate() + index);
          const dateStr = `${assignedDate.getFullYear()}-${String(assignedDate.getMonth() + 1).padStart(2, '0')}-${String(assignedDate.getDate()).padStart(2, '0')}`;
          return { ...w, date: dateStr, assignedDate: true };
        }
        return { ...w, assignedDate: false };
      })
      .filter(w => w.date !== null);

    console.log(`✅ Workouts to import: ${workoutsWithDates.length}`);
    workoutsWithDates.forEach((w, i) => {
      const dateLabel = w.assignedDate ? `(assigned: ${w.date})` : w.date;
      console.log(`  ${i + 1}. Slide ${w.slideNumber}: ${dateLabel}`);
      console.log(`     Preview: ${w.content.substring(0, 80)}...`);
    });
    console.log('');

    // Prepare workouts for database with workout_type='core'
    const workoutsToStore = workoutsWithDates.map(w => ({
      date: w.date,
      fileId: result.fileId,
      title: result.title,
      content: w.content,
      workoutType: 'core'
    }));

    if (workoutsToStore.length === 0) {
      console.log('❌ No workouts with valid dates found!');
      console.log('   Cannot store in database without dates.');
      process.exit(1);
    }

    // Store all workouts in database
    console.log('💾 Storing Core Finisher workouts in database...');
    
    // Use createWorkouts but we need to modify it to support workout_type
    // For now, let's use createWorkout for each one
    let successful = 0;
    let failed = 0;
    const errors = [];

    for (let i = 0; i < workoutsToStore.length; i++) {
      const workout = workoutsToStore[i];
      try {
        // Check if workout already exists
        const existing = await db.getWorkoutByDate(workout.date);
        if (existing) {
          // Update existing workout to be core type
          if (USE_POSTGRES) {
            await dbConnection.query(
              `UPDATE workouts SET workout_type = 'core', content = $1, title = $2, google_drive_file_id = $3 WHERE workout_date = $4`,
              [workout.content, workout.title, workout.fileId, workout.date]
            );
          } else {
            await new Promise((resolve, reject) => {
              dbConnection.run(
                `UPDATE workouts SET workout_type = 'core', content = ?, title = ?, google_drive_file_id = ? WHERE workout_date = ?`,
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
          // Create new workout with core type
          if (USE_POSTGRES) {
            await dbConnection.query(
              `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) VALUES ($1, $2, $3, $4, 'core')`,
              [workout.date, workout.fileId, workout.title, workout.content]
            );
          } else {
            await new Promise((resolve, reject) => {
              dbConnection.run(
                `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) VALUES (?, ?, ?, ?, 'core')`,
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
    console.log('  Failed:', failed);
    console.log('');

    if (errors.length > 0) {
      console.log('⚠️  Errors:');
      errors.forEach(err => {
        console.log(`  ${err.date}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 All Core Finisher workouts stored in database!');
    console.log('   (Marked with workout_type = "core")');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importCoreFinishers();

