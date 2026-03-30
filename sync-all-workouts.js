// Script to sync all workouts from a Google Slides presentation
// This parses each slide individually and extracts dates
const { syncAllWorkoutsFromSlides } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// Get file ID from command line argument
const fileId = process.argv[2];

if (!fileId) {
  console.log('Usage: node sync-all-workouts.js <FILE_ID>');
  console.log('');
  console.log('Example:');
  console.log('  node sync-all-workouts.js 1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4');
  console.log('');
  console.log('This will:');
  console.log('  1. Extract each slide individually');
  console.log('  2. Parse dates from each slide');
  console.log('  3. Store each workout in the database');
  process.exit(1);
}

async function syncAllWorkouts() {
  console.log('🔄 Syncing all workouts from Google Slides...\n');
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

    // Show parsed workouts
    console.log('📋 Parsed Workouts:');
    console.log('');
    
    const workoutsWithDates = result.workouts.filter(w => w.date !== null);
    const workoutsWithoutDates = result.workouts.filter(w => w.date === null);

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
      content: w.content
    }));

    if (workoutsToStore.length === 0) {
      console.log('❌ No workouts with valid dates found!');
      console.log('   Cannot store in database without dates.');
      console.log('');
      console.log('Troubleshooting:');
      console.log('  - Check that slides contain dates in formats like:');
      console.log('    • November 3rd, 2025');
      console.log('    • 11/3/2025');
      console.log('    • 2025-11-03');
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
    console.log('You can now:');
    console.log('  • Query workouts by date');
    console.log('  • Access workouts via API');
    console.log('  • Deploy to production (database will persist)');

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Check that file ID is correct');
    console.error('  2. Verify file is accessible');
    console.error('  3. Make sure Google Slides API is enabled');
    process.exit(1);
  }
}

syncAllWorkouts();

