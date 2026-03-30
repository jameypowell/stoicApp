// Script to import a single Strength workout from Google Slides (first slide only)
// This will NOT overwrite any existing workouts
const { syncAllWorkoutsFromSlides } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// Get file ID from command line argument or use the provided one
const fileId = process.argv[2] || '1DFnwUrLniJyGmJcZLhqBfiMAqdi7hyUpmI1Fukbr4vw';

// Get USE_POSTGRES from environment
const USE_POSTGRES = !!process.env.DB_HOST;

async function importStrengthWorkout() {
  console.log('🔄 Importing Strength workout from Google Slides (first slide only)...\n');
  console.log('File ID:', fileId);
  console.log('');

  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // First, add workout_type column if it doesn't exist and update CHECK constraint
    try {
      if (USE_POSTGRES) {
        // Check if column exists
        const columnCheck = await dbConnection.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'workouts' AND column_name = 'workout_type'
        `);
        
        if (columnCheck.rows.length === 0) {
          // Add column
          await dbConnection.query(`
            ALTER TABLE workouts 
            ADD COLUMN workout_type TEXT DEFAULT 'regular'
          `);
          console.log('✅ Added workout_type column');
        }
        
        // Update CHECK constraint to include 'strength'
        // PostgreSQL doesn't support modifying CHECK constraints directly, so we need to drop and recreate
        // But first, let's check if we can just add the constraint (it might fail if it exists)
        try {
          // Try to drop the old constraint if it exists (this will fail silently if it doesn't exist)
          await dbConnection.query(`
            ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_workout_type_check
          `);
          
          // Add new constraint with 'strength' included
          await dbConnection.query(`
            ALTER TABLE workouts 
            ADD CONSTRAINT workouts_workout_type_check 
            CHECK(workout_type IN ('regular', 'core', 'strength'))
          `);
          console.log('✅ Updated workout_type constraint to include "strength"');
        } catch (error) {
          // Constraint might already exist or be named differently
          console.log('⚠️  Note: workout_type constraint may already exist or need manual update');
        }
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
          console.log('✅ Added workout_type column');
        }
        // SQLite doesn't enforce CHECK constraints the same way, so we'll just use the column
        console.log('✅ Database schema ready (SQLite)');
      }
    } catch (error) {
      console.log('⚠️  Note: workout_type column may already exist:', error.message);
    }

    // Sync workouts from Google Slides
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

    // Get only the first slide
    if (result.workouts.length === 0) {
      console.log('❌ No workouts found in the presentation!');
      process.exit(1);
    }

    const firstWorkout = result.workouts[0];
    console.log('📋 First Slide Workout:');
    console.log(`  Slide Number: ${firstWorkout.slideNumber}`);
    console.log(`  Date Found: ${firstWorkout.date || 'None'}`);
    console.log(`  Content Preview: ${firstWorkout.content.substring(0, 100)}...`);
    console.log('');

    // Find a date that doesn't conflict with existing workouts
    let workoutDate = firstWorkout.date;
    let dateAssigned = false;

    if (!workoutDate) {
      // If no date in slide, find the next available date starting from today
      const today = new Date();
      let checkDate = new Date(today);
      let attempts = 0;
      const maxAttempts = 365; // Don't check more than a year ahead

      while (attempts < maxAttempts) {
        const dateStr = `${checkDate.getFullYear()}-${String(checkDate.getMonth() + 1).padStart(2, '0')}-${String(checkDate.getDate()).padStart(2, '0')}`;
        
        // Check if this date already has a workout
        const existing = await db.getWorkoutByDate(dateStr);
        
        if (!existing) {
          workoutDate = dateStr;
          dateAssigned = true;
          console.log(`📅 Assigned date: ${workoutDate} (no existing workout found)`);
          break;
        }
        
        // Move to next day
        checkDate.setDate(checkDate.getDate() + 1);
        attempts++;
      }

      if (!workoutDate) {
        console.log('❌ Could not find an available date within the next year!');
        process.exit(1);
      }
    } else {
      // Date was found in slide, but check if it conflicts
      const existing = await db.getWorkoutByDate(workoutDate);
      if (existing) {
        console.log(`⚠️  WARNING: Date ${workoutDate} already has a workout!`);
        console.log(`   Existing workout type: ${existing.workout_type || 'regular'}`);
        console.log(`   Skipping import to avoid overwriting existing workout.`);
        console.log('');
        console.log('💡 Suggestion: The slide contains a date that conflicts with an existing workout.');
        console.log('   Please modify the slide to use a different date, or manually assign a date.');
        process.exit(1);
      }
    }

    // Prepare workout for database with workout_type='strength'
    const workoutToStore = {
      date: workoutDate,
      fileId: result.fileId,
      title: result.title,
      content: firstWorkout.content,
      workoutType: 'strength'
    };

    // Store workout in database
    console.log('💾 Storing Strength workout in database...');
    console.log(`   Date: ${workoutDate}`);
    console.log(`   Type: strength`);
    console.log(`   ${dateAssigned ? '(Date was assigned automatically)' : '(Date found in slide)'}`);
    console.log('');

    try {
      // Check one more time if workout exists (race condition protection)
      const existing = await db.getWorkoutByDate(workoutDate);
      if (existing) {
        console.log(`❌ ERROR: Workout for date ${workoutDate} was created between checks!`);
        console.log(`   This should not happen, but skipping to be safe.`);
        process.exit(1);
      }

      // Create new workout with strength type
      if (USE_POSTGRES) {
        await dbConnection.query(
          `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) 
           VALUES ($1, $2, $3, $4, 'strength')`,
          [workoutToStore.date, workoutToStore.fileId, workoutToStore.title, workoutToStore.content]
        );
      } else {
        await new Promise((resolve, reject) => {
          dbConnection.run(
            `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) 
             VALUES (?, ?, ?, ?, 'strength')`,
            [workoutToStore.date, workoutToStore.fileId, workoutToStore.title, workoutToStore.content],
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
      }
      console.log(`  ✅ Created: ${workoutDate} (strength workout)`);
    } catch (error) {
      if (error.message.includes('UNIQUE constraint') || error.message.includes('duplicate key')) {
        console.log(`  ❌ Failed: ${workoutDate} - A workout already exists for this date!`);
        console.log(`     This should not happen, but the database prevented overwriting.`);
      } else {
        console.log(`  ❌ Failed: ${workoutDate} - ${error.message}`);
      }
      throw error;
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ IMPORT COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log(`  Date: ${workoutDate}`);
    console.log(`  Type: strength`);
    console.log(`  Slide: ${firstWorkout.slideNumber}`);
    console.log(`  Status: Successfully stored`);
    console.log('');
    console.log('🎉 Strength workout imported without overwriting any existing workouts!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importStrengthWorkout();



