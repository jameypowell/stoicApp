// Script to sync specific slides (6-30) from Google Slides presentation
// For functional fitness workouts: Dec 22, 2025 - Jan 23, 2026
const { syncAllWorkoutsFromSlides } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// File ID from the Google Slides URL
const fileId = '1cmFR_i_jtu7oN3l5e0Feq522-xMls9AkBZljYgLg3So';
const startSlide = 6;  // Dec 22, 2025
const endSlide = 30;   // Jan 23, 2026

async function syncSpecificWorkouts() {
  console.log('🔄 Syncing functional fitness workouts from Google Slides...\n');
  console.log('File ID:', fileId);
  console.log(`Slides: ${startSlide} - ${endSlide} (Dec 22, 2025 - Jan 23, 2026)`);
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

    // Filter to only slides 6-30
    const filteredWorkouts = result.workouts.filter(w => 
      w.slideNumber >= startSlide && w.slideNumber <= endSlide
    );

    console.log(`📋 Filtered Workouts (Slides ${startSlide}-${endSlide}):`);
    console.log('');
    
    const workoutsWithDates = filteredWorkouts.filter(w => w.date !== null);
    const workoutsWithoutDates = filteredWorkouts.filter(w => w.date === null);

    console.log(`✅ Workouts with dates: ${workoutsWithDates.length}`);
    workoutsWithDates.forEach((w, i) => {
      console.log(`  ${i + 1}. Slide ${w.slideNumber}: ${w.date}`);
      console.log(`     Preview: ${w.content.substring(0, 80)}...`);
    });
    console.log('');

    if (workoutsWithoutDates.length > 0) {
      console.log(`⚠️  Workouts without dates: ${workoutsWithoutDates.length}`);
      workoutsWithoutDates.forEach((w, i) => {
        console.log(`  ${i + 1}. Slide ${w.slideNumber}: No date found`);
        console.log(`     Preview: ${w.content.substring(0, 80)}...`);
      });
      console.log('');
    }

    // Prepare workouts for database
    const workoutsToStore = workoutsWithDates.map(w => ({
      date: w.date,
      fileId: result.fileId,
      title: result.title,
      content: w.content,
      workoutType: 'regular' // Functional fitness workouts
    }));

    if (workoutsToStore.length === 0) {
      console.log('❌ No workouts with valid dates found in slides 6-30!');
      console.log('   Cannot store in database without dates.');
      process.exit(1);
    }

    // Store all workouts in database
    console.log('💾 Storing workouts in database...');
    const dbResult = await db.createWorkouts(workoutsToStore);

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Database Results:');
    console.log('  Total processed:', dbResult.total);
    console.log('  Successfully stored:', dbResult.successful);
    console.log('  Failed:', dbResult.failed);
    console.log('');

    if (dbResult.errors.length > 0) {
      console.log('⚠️  Errors:');
      dbResult.errors.forEach(err => {
        console.log(`  Slide ${err.index + 1}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 All workouts stored in database!');
    console.log('');
    console.log('Stored workouts:');
    workoutsToStore.forEach(w => {
      console.log(`  • ${w.date}: ${w.content.substring(0, 60)}...`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Stack:', error.stack);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Check that file ID is correct');
    console.error('  2. Verify file is accessible');
    console.error('  3. Make sure Google Slides API is enabled');
    console.error('  4. Verify Google credentials are configured');
    process.exit(1);
  }
}

syncSpecificWorkouts();







