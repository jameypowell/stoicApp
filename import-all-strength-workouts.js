// Script to import all Strength workouts from Google Slides (all 19 slides)
// Each slide contains 3 workouts (Phase One: Beginner, Phase Two: Intermediate, Phase Three: Advanced)
// This will NOT overwrite any existing functional fitness or core finisher workouts
const { syncAllWorkoutsFromSlides } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// Get file ID from command line argument or use the provided one
const fileId = process.argv[2] || '1DFnwUrLniJyGmJcZLhqBfiMAqdi7hyUpmI1Fukbr4vw';

// Get USE_POSTGRES from environment
const USE_POSTGRES = !!process.env.DB_HOST;

// Parse a single slide content into 3 workouts (Phase One, Two, Three)
function parseSlideIntoWorkouts(slideContent, slideNumber) {
  const workouts = [];
  
  // Split content by "WARM UP:" to identify workout sections
  // Each workout has: WARM UP, Max Weight exercises, Primary/Secondary, Format instructions
  
  // Look for phase information - it might be at the end or associated with each section
  const phaseOneMatch = slideContent.match(/Phase\s+One:?\s*Beginner/i);
  const phaseTwoMatch = slideContent.match(/Phase\s+Two:?\s*Intermediate/i);
  const phaseThreeMatch = slideContent.match(/Phase\s+Three:?\s*Advanced/i);
  
  // Try to identify the three workout sections
  // Pattern: WARM UP section, then Max Weight section, then Primary/Secondary, then Format
  
  const warmUpSections = slideContent.split(/WARM UP:/gi);
  
  if (warmUpSections.length < 4) {
    // If we can't find 3 warm-up sections, try a different approach
    // Look for the pattern: WARM UP -> Max Weight -> Primary/Secondary -> Format
    console.log(`  ⚠️  Slide ${slideNumber}: Could not clearly identify 3 workout sections`);
    return workouts;
  }
  
  // We should have 3 workout sections (plus the first empty/header part)
  // Each section after the first should be: WARM UP content, Max Weight content, Primary/Secondary, Format
  
  const primaryMatches = [
    slideContent.match(/Primary:\s*Legs\s+Secondary:\s*Glutes/i),
    slideContent.match(/Primary:\s*Shoulders\s+Secondary:\s*Arms/i),
    slideContent.match(/Primary:\s*Chest\s+Secondary:\s*Back/i)
  ];
  
  // Extract the three workouts
  for (let i = 1; i < warmUpSections.length && i <= 3; i++) {
    const section = warmUpSections[i];
    
    // Extract warm-up exercises (lines after "WARM UP: 2 Sets of 10 Reps")
    const warmUpMatch = section.match(/2\s+Sets\s+of\s+10\s+Reps\s*\n?\s*(.+?)(?:\n\s*Max\s+Weight|$)/is);
    const warmUpExercises = warmUpMatch ? warmUpMatch[1].trim() : '';
    
    // Extract Max Weight section
    const maxWeightMatch = section.match(/Max\s+Weight\s*\(6-8\s+Reps\)\s*\n?\s*(.+?)(?:\n\s*WARM\s+UP|\n\s*Primary:|$)/is);
    const maxWeightExercises = maxWeightMatch ? maxWeightMatch[1].trim() : '';
    
    // Find corresponding Primary/Secondary
    let primarySecondary = '';
    if (i === 1 && primaryMatches[0]) {
      primarySecondary = 'Primary: Legs   Secondary: Glutes';
    } else if (i === 2 && primaryMatches[1]) {
      primarySecondary = 'Primary: Shoulders   Secondary: Arms';
    } else if (i === 3 && primaryMatches[2]) {
      primarySecondary = 'Primary: Chest   Secondary: Back';
    }
    
    // Extract Format instructions (appears 3 times, one for each workout)
    const formatMatch = slideContent.match(/Format\s+for\s+Each\s+Highlighted\s+Exercise\s*\n?\s*Check\s+form\s+set,\s+2\s+light\s+sets\s*\n?\s*1\s+Min\s+Max\s+Reps\s*\(Log\s+Reps\)\s*\n?\s*Eccentric\s+30%\s+of\s+Max\s+Reps\s*\(6-8\s+count\s+Down\)/gi);
    const formatText = formatMatch ? formatMatch[0] : 'Format for Each Highlighted Exercise\nCheck form set, 2 light sets\n1 Min Max Reps (Log Reps)\nEccentric 30% of Max Reps (6-8 count Down)';
    
    // Determine phase
    let phase = '';
    if (i === 1) {
      phase = 'Phase One: Beginner';
    } else if (i === 2) {
      phase = 'Phase Two: Intermediate';
    } else if (i === 3) {
      phase = 'Phase Three: Advanced';
    }
    
    // Build the workout content
    const workoutContent = `${phase}\n\n${primarySecondary}\n\nWARM UP: 2 Sets of 10 Reps\n${warmUpExercises}\n\nMax Weight (6-8 Reps)\n${maxWeightExercises}\n\n${formatText}`;
    
    workouts.push({
      phase: phase,
      primarySecondary: primarySecondary,
      slideNumber: slideNumber,
      workoutIndex: i,
      content: workoutContent
    });
  }
  
  return workouts;
}

async function importAllStrengthWorkouts() {
  console.log('🔄 Importing ALL Strength workouts from Google Slides...\n');
  console.log('File ID:', fileId);
  console.log('Expected: 19 slides × 3 workouts each = 57 total workouts\n');
  console.log('');

  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // Ensure workout_type column exists and includes 'strength'
    try {
      if (USE_POSTGRES) {
        const columnCheck = await dbConnection.query(`
          SELECT column_name 
          FROM information_schema.columns 
          WHERE table_name = 'workouts' AND column_name = 'workout_type'
        `);
        
        if (columnCheck.rows.length === 0) {
          await dbConnection.query(`
            ALTER TABLE workouts 
            ADD COLUMN workout_type TEXT DEFAULT 'regular'
          `);
        }
        
        // Update CHECK constraint to include 'strength'
        try {
          await dbConnection.query(`
            ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_workout_type_check
          `);
          await dbConnection.query(`
            ALTER TABLE workouts 
            ADD CONSTRAINT workouts_workout_type_check 
            CHECK(workout_type IN ('regular', 'core', 'strength'))
          `);
        } catch (error) {
          // Constraint might already exist
        }
      } else {
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
    } catch (error) {
      console.log('⚠️  Note: workout_type column setup:', error.message);
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

    if (result.workouts.length === 0) {
      console.log('❌ No workouts found in the presentation!');
      process.exit(1);
    }

    // Parse each slide into 3 workouts
    console.log('📋 Parsing slides into individual workouts...');
    console.log('');
    
    const allWorkouts = [];
    for (let i = 0; i < result.workouts.length; i++) {
      const slide = result.workouts[i];
      const parsedWorkouts = parseSlideIntoWorkouts(slide.content, slide.slideNumber);
      
      if (parsedWorkouts.length === 0) {
        console.log(`  ⚠️  Slide ${slide.slideNumber}: Could not parse into 3 workouts`);
        // Try a simpler approach - just split by the three Primary/Secondary sections
        const legMatch = slide.content.match(/(.+?)(Primary:\s*Legs\s+Secondary:\s*Glutes)/is);
        const shoulderMatch = slide.content.match(/(Primary:\s*Shoulders\s+Secondary:\s*Arms)(.+?)(Primary:\s*Chest\s+Secondary:\s*Back|$)/is);
        const chestMatch = slide.content.match(/(Primary:\s*Chest\s+Secondary:\s*Back)(.+?)$/is);
        
        // If we can't parse properly, skip this slide for now
        console.log(`     Skipping slide ${slide.slideNumber} - manual parsing may be needed`);
      } else {
        allWorkouts.push(...parsedWorkouts);
        console.log(`  ✓ Slide ${slide.slideNumber}: Parsed into ${parsedWorkouts.length} workouts`);
      }
    }

    console.log('');
    console.log(`✅ Total workouts parsed: ${allWorkouts.length}`);
    console.log('');

    // Find available dates starting from today
    const today = new Date();
    let currentDate = new Date(today);
    const workoutsToStore = [];
    
    console.log('📅 Assigning dates to workouts...');
    console.log('');
    
    for (const workout of allWorkouts) {
      let assigned = false;
      let attempts = 0;
      const maxAttempts = 365;
      
      while (!assigned && attempts < maxAttempts) {
        const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
        
        // Check if this date already has a workout
        const existing = await db.getWorkoutByDate(dateStr);
        
        if (!existing) {
          workoutsToStore.push({
            date: dateStr,
            fileId: result.fileId,
            title: `${result.title} - ${workout.phase}`,
            content: workout.content,
            workoutType: 'strength',
            slideNumber: workout.slideNumber,
            phase: workout.phase
          });
          assigned = true;
        } else {
          // Move to next day
          currentDate.setDate(currentDate.getDate() + 1);
          attempts++;
        }
      }
      
      if (!assigned) {
        console.log(`  ❌ Could not find available date for workout from slide ${workout.slideNumber}, ${workout.phase}`);
      }
    }

    console.log(`✅ ${workoutsToStore.length} workouts ready to store`);
    console.log('');

    // Store workouts in database
    console.log('💾 Storing Strength workouts in database...');
    console.log('');
    
    let successful = 0;
    let failed = 0;
    const errors = [];

    for (const workout of workoutsToStore) {
      try {
        // Double-check the date is still available
        const existing = await db.getWorkoutByDate(workout.date);
        if (existing) {
          console.log(`  ⚠️  Skipping ${workout.date} - workout already exists`);
          failed++;
          continue;
        }

        // Create new workout with strength type
        if (USE_POSTGRES) {
          await dbConnection.query(
            `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) 
             VALUES ($1, $2, $3, $4, 'strength')`,
            [workout.date, workout.fileId, workout.title, workout.content]
          );
        } else {
          await new Promise((resolve, reject) => {
            dbConnection.run(
              `INSERT INTO workouts (workout_date, google_drive_file_id, title, content, workout_type) 
               VALUES (?, ?, ?, ?, 'strength')`,
              [workout.date, workout.fileId, workout.title, workout.content],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
        successful++;
        if (successful % 10 === 0) {
          console.log(`  ✓ Stored ${successful} workouts...`);
        }
      } catch (error) {
        failed++;
        errors.push({ date: workout.date, error: error.message });
        console.log(`  ✗ Failed: ${workout.date} - ${error.message}`);
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ IMPORT COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log(`  Total slides processed: ${result.workouts.length}`);
    console.log(`  Workouts parsed: ${allWorkouts.length}`);
    console.log(`  Workouts stored: ${successful}`);
    console.log(`  Failed: ${failed}`);
    console.log('');
    
    if (errors.length > 0) {
      console.log('⚠️  Errors:');
      errors.forEach(err => {
        console.log(`  ${err.date}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 All Strength workouts imported without overwriting existing workouts!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importAllStrengthWorkouts();



