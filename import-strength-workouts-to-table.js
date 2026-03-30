// Script to import all Strength workouts from Google Slides into the strength_workouts table
// Each slide contains 3 workouts (Phase One: Beginner, Phase Two: Intermediate, Phase Three: Advanced)
const { getSlidesAPI } = require('./google-drive');
const { initDatabase } = require('./database');
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
  
  // Find all Primary/Secondary labels
  const primaryLabels = [
    { text: 'Primary: Legs   Secondary: Glutes', phase: 'Phase One: Beginner', primary: 'Legs', secondary: 'Glutes' },
    { text: 'Primary: Shoulders   Secondary: Arms', phase: 'Phase Two: Intermediate', primary: 'Shoulders', secondary: 'Arms' },
    { text: 'Primary: Chest   Secondary: Back', phase: 'Phase Three: Advanced', primary: 'Chest', secondary: 'Back' }
  ];
  
  // Find WARM UP blocks
  const warmUpIndices = [];
  textBlocks.forEach((block, idx) => {
    if (/WARM UP:?\s*2\s+Sets\s+of\s+10\s+Reps/i.test(block.text)) {
      warmUpIndices.push(idx);
    }
  });
  
  // Find Format blocks (these mark the end of the main workout section)
  const formatIndices = [];
  textBlocks.forEach((block, idx) => {
    if (/Format\s+for\s+Each\s+Highlighted\s+Exercise/i.test(block.text)) {
      formatIndices.push(idx);
    }
  });
  
  // Find the middle section blocks
  // The middle section is the block immediately after each WARM UP block
  // This can be "Max Weight", "Max Reps", "2-4 Rep Max", etc.
  const middleSectionBlocks = [];
  for (let i = 0; i < 3; i++) {
    const warmUpIdx = warmUpIndices[i];
    
    if (warmUpIdx !== undefined) {
      // The middle section is the block immediately after WARM UP
      const middleBlockIdx = warmUpIdx + 1;
      if (textBlocks[middleBlockIdx] && !/WARM UP/i.test(textBlocks[middleBlockIdx].text)) {
        // Found the middle section block
        middleSectionBlocks.push([textBlocks[middleBlockIdx]]);
      } else {
        // No middle section found
        middleSectionBlocks.push([]);
      }
    } else {
      middleSectionBlocks.push([]);
    }
  }
  
  // Build workouts - each workout consists of:
  // 1. Phase label
  // 2. Primary/Secondary
  // 3. WARM UP block
  // 4. Middle section (Max Weight, Max Reps, Working Sets, etc.)
  // 5. Format block
  
  for (let i = 0; i < 3; i++) {
    const phase = primaryLabels[i].phase;
    const primarySecondary = primaryLabels[i].text;
    const primary = primaryLabels[i].primary;
    const secondary = primaryLabels[i].secondary;
    
    // Get corresponding warm-up and middle section blocks
    const warmUpBlock = warmUpIndices[i] !== undefined ? textBlocks[warmUpIndices[i]] : null;
    const middleBlocks = middleSectionBlocks[i] || [];
    const formatBlock = formatIndices[i] !== undefined ? textBlocks[formatIndices[i]] : 
                       (formatIndices[0] !== undefined ? textBlocks[formatIndices[0]] : 
                       'Format for Each Highlighted Exercise\nCheck form set, 2 light sets\n1 Min Max Reps (Log Reps)\nEccentric 30% of Max Reps (6-8 count Down)');
    
    // Build workout content
    let workoutContent = `${phase}\n\n${primarySecondary}\n\n`;
    
    if (warmUpBlock) {
      workoutContent += `${warmUpBlock.text}\n\n`;
    }
    
    // Add all middle section blocks (this could be "Max Weight", "Max Reps", "Working Sets", etc.)
    if (middleBlocks.length > 0) {
      middleBlocks.forEach(block => {
        workoutContent += `${block.text}\n\n`;
      });
    }
    
    workoutContent += `${formatBlock.text || formatBlock}`;
    
    // Add reference if it exists
    const allText = textBlocks.map(b => b.text).join('\n');
    if (allText.includes('StrengthLevel.com')) {
      workoutContent += '\n\nStrengthLevel.com/one-rep-max-calculator';
    }
    
    workouts.push({
      phase: phase,
      primarySecondary: primarySecondary,
      primary: primary,
      secondary: secondary,
      slideNumber: slideNumber,
      workoutIndex: i + 1,
      content: workoutContent
    });
  }
  
  return workouts;
}

async function importStrengthWorkouts() {
  console.log('🔄 Importing ALL Strength workouts into strength_workouts table...\n');
  console.log('File ID:', fileId);
  console.log('Expected: 19 slides × 3 workouts each = 57 total strength workouts\n');
  console.log('');

  try {
    // Initialize database
    const dbConnection = await initDatabase();

    // Get slides directly from API
    const slides = require('./google-drive').getSlidesAPI();
    const presentation = await slides.presentations.get({
      presentationId: fileId
    });

    const slidesData = presentation.data.slides || [];
    console.log(`✅ Found ${slidesData.length} slides in presentation`);
    console.log('');

    // Parse each slide into 3 workouts
    console.log('📋 Parsing slides into individual strength workouts...');
    console.log('');
    
    const allWorkouts = [];
    for (let i = 0; i < slidesData.length; i++) {
      const slide = slidesData[i];
      const parsedWorkouts = parseSlideIntoWorkouts(slide.pageElements || [], i + 1);
      
      if (parsedWorkouts.length === 3) {
        allWorkouts.push(...parsedWorkouts);
        console.log(`  ✓ Slide ${i + 1}: Parsed into 3 strength workouts`);
      } else {
        console.log(`  ⚠️  Slide ${i + 1}: Only parsed ${parsedWorkouts.length} workouts (expected 3)`);
        if (parsedWorkouts.length > 0) {
          allWorkouts.push(...parsedWorkouts);
        }
      }
    }

    console.log('');
    console.log(`✅ Total strength workouts parsed: ${allWorkouts.length}`);
    console.log('');

    // Get all existing strength workouts to update them
    let existingWorkouts = [];
    if (USE_POSTGRES) {
      const result = await dbConnection.query('SELECT * FROM strength_workouts ORDER BY workout_date');
      existingWorkouts = result.rows;
    } else {
      existingWorkouts = await new Promise((resolve, reject) => {
        dbConnection.all('SELECT * FROM strength_workouts ORDER BY workout_date', [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
    }
    
    console.log(`📅 Found ${existingWorkouts.length} existing strength workouts to update`);
    console.log(`📅 Will update existing workouts and create new ones if needed...`);
    console.log('');
    
    const workoutsToStore = [];
    
    // Match workouts by slide_number and workout_index, not by sequential order
    for (const workout of allWorkouts) {
      // Find ALL existing workouts with matching slide_number and workout_index
      // Handle both string and number types for comparison
      const matchingWorkouts = existingWorkouts.filter(e => 
        (String(e.slide_number) === String(workout.slideNumber) || Number(e.slide_number) === Number(workout.slideNumber)) &&
        (String(e.workout_index) === String(workout.workoutIndex) || Number(e.workout_index) === Number(workout.workoutIndex))
      );
      
      if (matchingWorkouts.length > 0) {
        // Update ALL matching workouts with the same content
        matchingWorkouts.forEach(existing => {
          workoutsToStore.push({
            date: existing.workout_date,
            fileId: fileId,
            title: `Strength - ${workout.phase}`,
            content: workout.content,
            phase: workout.phase,
            primary: workout.primary,
            secondary: workout.secondary,
            slideNumber: workout.slideNumber,
            workoutIndex: workout.workoutIndex,
            isUpdate: true
          });
        });
      } else {
        // Create new workout - find available date
        const today = new Date();
        let currentDate = new Date(today);
        let assigned = false;
        let attempts = 0;
        const maxAttempts = 365;
        
        while (!assigned && attempts < maxAttempts) {
          const dateStr = `${currentDate.getFullYear()}-${String(currentDate.getMonth() + 1).padStart(2, '0')}-${String(currentDate.getDate()).padStart(2, '0')}`;
          
          // Check if this date already has a strength workout
          let existing = null;
          if (USE_POSTGRES) {
            const result = await dbConnection.query(
              'SELECT * FROM strength_workouts WHERE workout_date = $1',
              [dateStr]
            );
            existing = result.rows.length > 0 ? result.rows[0] : null;
          } else {
            existing = await new Promise((resolve, reject) => {
              dbConnection.get('SELECT * FROM strength_workouts WHERE workout_date = ?', [dateStr], (err, row) => {
                if (err) reject(err);
                else resolve(row);
              });
            });
          }
          
          if (!existing) {
            workoutsToStore.push({
              date: dateStr,
              fileId: fileId,
              title: `Strength - ${workout.phase}`,
              content: workout.content,
              phase: workout.phase,
              primary: workout.primary,
              secondary: workout.secondary,
              slideNumber: workout.slideNumber,
              workoutIndex: workout.workoutIndex,
              isUpdate: false
            });
            assigned = true;
          } else {
            currentDate.setDate(currentDate.getDate() + 1);
            attempts++;
          }
        }
        
        if (!assigned) {
          console.log(`  ❌ Could not find available date for strength workout from slide ${workout.slideNumber}, ${workout.phase}`);
        }
      }
    }

    console.log(`✅ ${workoutsToStore.length} strength workouts ready to store`);
    console.log('');

    // Store strength workouts in database
    console.log('💾 Storing Strength workouts in strength_workouts table...');
    console.log('');
    
    let successful = 0;
    let failed = 0;
    const errors = [];

    for (const workout of workoutsToStore) {
      try {
        // Double-check the date is still available
        let existing = null;
        if (USE_POSTGRES) {
          const result = await dbConnection.query(
            'SELECT * FROM strength_workouts WHERE workout_date = $1',
            [workout.date]
          );
          existing = result.rows.length > 0 ? result.rows[0] : null;
        } else {
          existing = await new Promise((resolve, reject) => {
            dbConnection.get('SELECT * FROM strength_workouts WHERE workout_date = ?', [workout.date], (err, row) => {
              if (err) reject(err);
              else resolve(row);
            });
          });
        }
        
        // Update existing workout or create new one
        if (workout.isUpdate || existing) {
          // Update existing workout
          if (workout.date === '2026-05-07' || (workout.slideNumber === 19 && workout.workoutIndex === 1)) {
            console.log(`  🔍 DEBUG UPDATE: Updating ${workout.date}`);
            console.log(`     Content length: ${workout.content.length}`);
            console.log(`     Has middle section: ${workout.content.includes('2-4 Rep Max') || workout.content.includes('Max Weight')}`);
          }
          if (USE_POSTGRES) {
            await dbConnection.query(
              `UPDATE strength_workouts 
               SET google_drive_file_id = $2, title = $3, content = $4, phase = $5, primary_focus = $6, secondary_focus = $7, slide_number = $8, workout_index = $9, updated_at = CURRENT_TIMESTAMP
               WHERE workout_date = $1`,
              [workout.date, workout.fileId, workout.title, workout.content, workout.phase, workout.primary, workout.secondary, workout.slideNumber, workout.workoutIndex]
            );
          } else {
            await new Promise((resolve, reject) => {
              dbConnection.run(
                `UPDATE strength_workouts 
                 SET google_drive_file_id = ?, title = ?, content = ?, phase = ?, primary_focus = ?, secondary_focus = ?, slide_number = ?, workout_index = ?, updated_at = CURRENT_TIMESTAMP
                 WHERE workout_date = ?`,
                [workout.fileId, workout.title, workout.content, workout.phase, workout.primary, workout.secondary, workout.slideNumber, workout.workoutIndex, workout.date],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }
          console.log(`  ↻ Updated ${workout.date}`);
        } else {
          // Create new strength workout
          if (USE_POSTGRES) {
            await dbConnection.query(
              `INSERT INTO strength_workouts (workout_date, google_drive_file_id, title, content, phase, primary_focus, secondary_focus, slide_number, workout_index) 
               VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
              [workout.date, workout.fileId, workout.title, workout.content, workout.phase, workout.primary, workout.secondary, workout.slideNumber, workout.workoutIndex]
            );
          } else {
            await new Promise((resolve, reject) => {
              dbConnection.run(
                `INSERT INTO strength_workouts (workout_date, google_drive_file_id, title, content, phase, primary_focus, secondary_focus, slide_number, workout_index) 
                 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
                [workout.date, workout.fileId, workout.title, workout.content, workout.phase, workout.primary, workout.secondary, workout.slideNumber, workout.workoutIndex],
                (err) => {
                  if (err) reject(err);
                  else resolve();
                }
              );
            });
          }
          console.log(`  ✓ Created ${workout.date}`);
        }
        successful++;
        if (successful % 10 === 0) {
          console.log(`  ✓ Stored ${successful} strength workouts...`);
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
    console.log(`  Strength workouts parsed: ${allWorkouts.length}`);
    console.log(`  Strength workouts stored: ${successful}`);
    console.log(`  Failed: ${failed}`);
    console.log('');
    
    if (errors.length > 0) {
      console.log('⚠️  Errors:');
      errors.forEach(err => {
        console.log(`  ${err.date}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 All Strength workouts imported into strength_workouts table!');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

importStrengthWorkouts();

