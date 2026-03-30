// Test script to see workout information being extracted
const { syncWorkoutFromSlides } = require('./google-drive');
require('dotenv').config();

// Get file ID from command line argument
const fileId = process.argv[2];
const workoutDate = process.argv[3] || new Date().toISOString().split('T')[0];

if (!fileId) {
  console.log('Usage: node view-workout.js <FILE_ID> [WORKOUT_DATE]');
  console.log('');
  console.log('Example:');
  console.log('  node view-workout.js 1abc123def456 2024-11-05');
  console.log('');
  console.log('To find FILE_ID:');
  console.log('  1. Open Google Slides file');
  console.log('  2. Look at URL: https://docs.google.com/presentation/d/FILE_ID/edit');
  console.log('  3. Copy the FILE_ID part');
  process.exit(1);
}

async function viewWorkout() {
  console.log('🔍 Extracting workout information...\n');
  console.log('File ID:', fileId);
  console.log('Workout Date:', workoutDate);
  console.log('');

  try {
    const workoutData = await syncWorkoutFromSlides(fileId, workoutDate);

    console.log('════════════════════════════════════════════════');
    console.log('✅ WORKOUT EXTRACTED SUCCESSFULLY!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📄 File Information:');
    console.log('  File ID:', workoutData.fileId);
    console.log('  File Name:', workoutData.fileName);
    console.log('  Workout Date:', workoutData.workoutDate);
    console.log('  Slide Count:', workoutData.slideCount);
    console.log('');

    console.log('📋 Title:');
    console.log('  ', workoutData.title);
    console.log('');

    console.log('📝 Full Content:');
    console.log('────────────────────────────────────────────────');
    console.log(workoutData.content);
    console.log('────────────────────────────────────────────────');
    console.log('');

    console.log('📊 Content Statistics:');
    console.log('  Total Characters:', workoutData.content.length);
    console.log('  Total Words:', workoutData.content.split(/\s+/).filter(w => w.length > 0).length);
    console.log('  Total Lines:', workoutData.content.split('\n').length);
    console.log('');

    console.log('💾 Ready to store in database!');
    console.log('');
    console.log('To sync this workout to your database, use:');
    console.log(`  curl -X POST http://localhost:3000/api/admin/workouts/sync \\`);
    console.log(`    -H "Authorization: Bearer YOUR_TOKEN" \\`);
    console.log(`    -H "Content-Type: application/json" \\`);
    console.log(`    -d '{"fileId":"${fileId}","workoutDate":"${workoutDate}"}'`);

  } catch (error) {
    console.error('❌ Error extracting workout:');
    console.error('  ', error.message);
    console.error('');
    console.error('Troubleshooting:');
    console.error('  1. Check that file ID is correct');
    console.error('  2. Verify file is accessible (shared with your Google account)');
    console.error('  3. Make sure file is a Google Slides presentation');
    process.exit(1);
  }
}

viewWorkout();

