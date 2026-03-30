// Script to import all Strength workouts from Google Slides (all 19 slides)
// Each slide contains 3 workouts (Phase One: Beginner, Phase Two: Intermediate, Phase Three: Advanced)
// This will NOT overwrite any existing functional fitness or core finisher workouts
const { getSlidesAPI } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// Get file ID from command line argument or use the provided one
const fileId = process.argv[2] || '1DFnwUrLniJyGmJcZLhqBfiMAqdi7hyUpmI1Fukbr4vw';

// Get USE_POSTGRES from environment
const USE_POSTGRES = !!process.env.DB_HOST;

// Parse a single slide into 3 workouts by analyzing the text blocks
function parseSlideIntoWorkouts(slideElements, slideNumber) {
  const workouts = [];
  
  // Extract all text blocks from slide elements
  const textBlocks = [];
  slideElements.forEach((element, idx) => {
    if (element.shape && element.shape.text) {
      const textElements = element.shape.text.textElements || [];
      let blockText = '';
      textElements.forEach(textElement => {
        if (textElement.textRun && textElement.textRun.content) {
          blockText += textElement.textRun.content;
        }
      });
      if (blockText.trim().length > 0) {
        textBlocks.push({
          index: idx,
          text: blockText.trim()
        });
      }
    }
  });
  
  // Find the three workout sections
  // Pattern: Each workout has WARM UP block, Max Weight block, then Primary/Secondary appears later
  
  // Find all Primary/Secondary labels
  const primaryLabels = [
    { text: 'Primary: Legs   Secondary: Glutes', phase: 'Phase One: Beginner' },
    { text: 'Primary: Shoulders   Secondary: Arms', phase: 'Phase Two: Intermediate' },
    { text: 'Primary: Chest   Secondary: Back', phase: 'Phase Three: Advanced' }
  ];
  
  // Find phase labels
  let phaseOneIndex = -1;
  let phaseTwoIndex = -1;
  let phaseThreeIndex = -1;
  
  textBlocks.forEach((block, idx) => {
    if (/Phase\s+One:?\s*Beginner/i.test(block.text)) {
      phaseOneIndex = idx;
    }
    if (/Phase\s+Two:?\s*Intermediate/i.test(block.text)) {
      phaseTwoIndex = idx;
    }
    if (/Phase\s+Three:?\s*Advanced/i.test(block.text)) {
      phaseThreeIndex = idx;
    }
  });
  
  // Find Primary/Secondary labels
  const primaryIndices = [];
  primaryLabels.forEach((label, labelIdx) => {
    textBlocks.forEach((block, idx) => {
      if (block.text.includes(label.text)) {
        primaryIndices[labelIdx] = idx;
      }
    });
  });
  
  // Find WARM UP blocks
  const warmUpIndices = [];
  textBlocks.forEach((block, idx) => {
    if (/WARM UP:?\s*2\s+Sets\s+of\s+10\s+Reps/i.test(block.text)) {
      warmUpIndices.push(idx);
    }
  });
  
  // Find Max Weight blocks
  const maxWeightIndices = [];
  textBlocks.forEach((block, idx) => {
    if (/Max\s+Weight\s*\(6-8\s+Reps\)/i.test(block.text)) {
      maxWeightIndices.push(idx);
    }
  });
  
  // Find Format blocks
  const formatBlocks = [];
  textBlocks.forEach((block, idx) => {
    if (/Format\s+for\s+Each\s+Highlighted\s+Exercise/i.test(block.text)) {
      formatBlocks.push(block.text);
    }
  });
  
  // Build workouts - each workout consists of:
  // 1. Phase label
  // 2. Primary/Secondary
  // 3. WARM UP block
  // 4. Max Weight block
  // 5. Format block
  
  for (let i = 0; i < 3; i++) {
    const phase = primaryLabels[i].phase;
    const primarySecondary = primaryLabels[i].text;
    
    // Get corresponding warm-up and max weight blocks (should be in order)
    const warmUpBlock = warmUpIndices[i] !== undefined ? textBlocks[warmUpIndices[i]] : null;
    const maxWeightBlock = maxWeightIndices[i] !== undefined ? textBlocks[maxWeightIndices[i]] : null;
    const formatBlock = formatBlocks[i] || formatBlocks[0] || 'Format for Each Highlighted Exercise\nCheck form set, 2 light sets\n1 Min Max Reps (Log Reps)\nEccentric 30% of Max Reps (6-8 count Down)';
    
    // Build workout content
    let workoutContent = `${phase}\n\n${primarySecondary}\n\n`;
    
    if (warmUpBlock) {
      workoutContent += `${warmUpBlock.text}\n\n`;
    }
    
    if (maxWeightBlock) {
      workoutContent += `${maxWeightBlock.text}\n\n`;
    }
    
    workoutContent += `${formatBlock}`;
    
    // Add reference if it exists
    const allText = textBlocks.map(b => b.text).join('\n');
    if (allText.includes('StrengthLevel.com')) {
      workoutContent += '\n\nStrengthLevel.com/one-rep-max-calculator';
    }
    
    workouts.push({
      phase: phase,
      primarySecondary: primarySecondary,
      slideNumber: slideNumber,
      workoutIndex: i + 1,
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

    // Get slides directly from API
    const slides = require('./google-drive').getSlidesAPI();
    const presentation = await slides.presentations.get({
      presentationId: fileId
    });

    const slidesData = presentation.data.slides || [];
    console.log(`✅ Found ${slidesData.length} slides in presentation`);
    console.log('');

    // Parse each slide into 3 workouts
    console.log('📋 Parsing slides into individual workouts...');
    console.log('');
    
    const allWorkouts = [];
    for (let i = 0; i < slidesData.length; i++) {
      const slide = slidesData[i];
      const parsedWorkouts = parseSlideIntoWorkouts(slide.pageElements || [], i + 1);
      
      if (parsedWorkouts.length === 3) {
        allWorkouts.push(...parsedWorkouts);
        console.log(`  ✓ Slide ${i + 1}: Parsed into 3 workouts`);
      } else {
        console.log(`  ⚠️  Slide ${i + 1}: Only parsed ${parsedWorkouts.length} workouts (expected 3)`);
        if (parsedWorkouts.length > 0) {
          allWorkouts.push(...parsedWorkouts);
        }
      }
    }

    console.log('');
    console.log(`✅ Total workouts parsed: ${allWorkouts.length}`);
    console.log('');

    // Find available dates starting from today
    const today = new Date();
    let currentDate = new Date(today);
    const workoutsToStore = [];
    
    console.log('📅 Assigning dates to workouts (checking for conflicts)...');
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
            fileId: fileId,
            title: `Strength - ${workout.phase}`,
            content: workout.content,
            workoutType: 'strength',
            slideNumber: workout.slideNumber,
            phase: workout.phase
          });
          assigned = true;
          currentDate.setDate(currentDate.getDate() + 1);
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
          console.log(`  ⚠️  Skipping ${workout.date} - workout already exists (type: ${existing.workout_type || 'regular'})`);
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
    console.log(`  Total slides processed: ${slidesData.length}`);
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



