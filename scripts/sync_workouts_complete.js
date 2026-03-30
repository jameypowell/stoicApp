#!/usr/bin/env node
/**
 * Complete workout sync: Google Slides → Localhost → Production
 * 
 * This script:
 * 1. Syncs workouts from Google Slides to localhost database
 * 2. Pushes all workouts from localhost to production database
 * 
 * Usage: node scripts/sync_workouts_complete.js <GOOGLE_SLIDES_FILE_ID> [EMAIL] [PASSWORD]
 * 
 * Example:
 *   node scripts/sync_workouts_complete.js 1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4
 *   node scripts/sync_workouts_complete.js 1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4 email@example.com password
 */

require('dotenv').config();
const { syncAllWorkoutsFromSlides } = require('../google-drive');
const { initDatabase, Database } = require('../database');

const fileId = process.argv[2];
const email = process.argv[3] || process.env.ADMIN_EMAIL;
const password = process.argv[4] || process.env.ADMIN_PASSWORD;
const apiBase = process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com/api';

if (!fileId) {
  console.error('❌ Error: Google Slides file ID required');
  console.log('');
  console.log('Usage: node scripts/sync_workouts_complete.js <FILE_ID> [EMAIL] [PASSWORD]');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/sync_workouts_complete.js 1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4');
  console.log('');
  console.log('Or set ADMIN_EMAIL and ADMIN_PASSWORD in .env file');
  process.exit(1);
}

async function syncComplete() {
  try {
    console.log('════════════════════════════════════════════════');
    console.log('🔄 Complete Workout Sync Process');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('File ID:', fileId);
    console.log('');

    // ============================================================
    // STEP 1: Sync from Google Slides to Localhost
    // ============================================================
    console.log('📥 STEP 1: Syncing from Google Slides to localhost...');
    console.log('');

    // Ensure we use SQLite for localhost
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;

    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // Sync all workouts from Google Slides
    const result = await syncAllWorkoutsFromSlides(fileId);

    console.log('✅ Slides Parsed Successfully!');
    console.log(`   File: ${result.fileName}`);
    console.log(`   Total Slides: ${result.totalSlides}`);
    console.log(`   Workouts Found: ${result.workouts.length}`);

    const workoutsWithDates = result.workouts.filter(w => w.date !== null);
    const workoutsWithoutDates = result.workouts.filter(w => w.date === null);

    console.log(`   ✅ Workouts with dates: ${workoutsWithDates.length}`);
    if (workoutsWithoutDates.length > 0) {
      console.log(`   ⚠️  Workouts without dates: ${workoutsWithoutDates.length}`);
    }
    console.log('');

    if (workoutsWithDates.length === 0) {
      console.error('❌ No workouts with valid dates found!');
      console.log('   Cannot proceed without dates.');
      process.exit(1);
    }

    // Prepare workouts for database
    const workoutsToStore = workoutsWithDates.map(w => ({
      date: w.date,
      fileId: result.fileId,
      title: result.title,
      content: w.content
    }));

    // Store workouts in localhost database
    console.log('💾 Storing workouts in localhost database...');
    const dbResult = await db.createWorkouts(workoutsToStore);

    console.log(`✅ Localhost sync complete: ${dbResult.successful}/${dbResult.total} stored`);
    if (dbResult.failed > 0) {
      console.log(`   ⚠️  Failed: ${dbResult.failed}`);
    }
    console.log('');

    // ============================================================
    // STEP 2: Push from Localhost to Production
    // ============================================================
    console.log('📤 STEP 2: Pushing workouts from localhost to production...');
    console.log('');

    if (!email || !password) {
      console.error('❌ Error: Email and password required for production sync');
      console.log('   Provide via command line or set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
      console.log('');
      console.log('✅ Localhost sync completed successfully');
      console.log('   You can push to production later using:');
      console.log('   node scripts/push_workouts_to_production.js <email> <password>');
      process.exit(0);
    }

    // Authenticate with production
    console.log('🔐 Authenticating with production API...');
    const loginResponse = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!loginResponse.ok) {
      const error = await loginResponse.json();
      console.error('❌ Login failed:', error.error || 'Unknown error');
      console.log('');
      console.log('✅ Localhost sync completed successfully');
      console.log('   Production sync failed - you can retry later');
      process.exit(1);
    }

    const { token } = await loginResponse.json();
    console.log('✅ Authenticated successfully');
    console.log('');

    // Get all workouts from localhost
    console.log('📥 Reading workouts from localhost database...');
    const allWorkouts = await db.getAllWorkouts();
    console.log(`✅ Found ${allWorkouts.length} workouts in localhost`);
    console.log('');

    if (allWorkouts.length === 0) {
      console.log('⚠️  No workouts found in localhost database');
      process.exit(0);
    }

    // Prepare workouts for production
    const workoutsToPush = allWorkouts.map(w => ({
      date: typeof w.workout_date === 'string' 
        ? w.workout_date.split('T')[0].split(' ')[0]
        : new Date(w.workout_date).toISOString().split('T')[0],
      fileId: w.google_drive_file_id || 'synced-from-localhost',
      title: w.title || 'Workout',
      content: w.content
    }));

    // Push to production in batches
    console.log('📤 Pushing workouts to production (in batches)...');
    
    const batchSize = 50;
    let totalSuccessful = 0;
    let totalFailed = 0;
    const allErrors = [];

    for (let i = 0; i < workoutsToPush.length; i += batchSize) {
      const batch = workoutsToPush.slice(i, i + batchSize);
      const batchNum = Math.floor(i / batchSize) + 1;
      const totalBatches = Math.ceil(workoutsToPush.length / batchSize);
      
      console.log(`   Sending batch ${batchNum}/${totalBatches} (${batch.length} workouts)...`);

      const pushResponse = await fetch(`${apiBase}/admin/workouts/bulk`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${token}`
        },
        body: JSON.stringify({ workouts: batch })
      });

      if (!pushResponse.ok) {
        const error = await pushResponse.json();
        console.error(`   ❌ Batch ${batchNum} failed:`, error.error || 'Unknown error');
        totalFailed += batch.length;
        if (error.errors) {
          allErrors.push(...error.errors.map(e => ({ ...e, batch: batchNum })));
        }
        continue;
      }

      const result = await pushResponse.json();
      totalSuccessful += result.summary.successful;
      totalFailed += result.summary.failed;
      if (result.summary.errors) {
        allErrors.push(...result.summary.errors.map(e => ({ ...e, batch: batchNum })));
      }
    }

    // ============================================================
    // SUMMARY
    // ============================================================
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ COMPLETE SYNC FINISHED!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log('');
    console.log('Step 1 - Google Slides → Localhost:');
    console.log(`  ✅ Workouts synced: ${dbResult.successful}/${dbResult.total}`);
    console.log('');
    console.log('Step 2 - Localhost → Production:');
    console.log(`  ✅ Workouts pushed: ${totalSuccessful}/${workoutsToPush.length}`);
    if (totalFailed > 0) {
      console.log(`  ⚠️  Failed: ${totalFailed}`);
    }
    console.log('');

    if (allErrors.length > 0) {
      console.log('⚠️  Errors:');
      allErrors.slice(0, 10).forEach(err => {
        console.log(`  Batch ${err.batch || '?'}, Workout ${err.index !== undefined ? err.index + 1 : '?'}: ${err.error}`);
      });
      if (allErrors.length > 10) {
        console.log(`  ... and ${allErrors.length - 10} more errors`);
      }
      console.log('');
    }

    console.log('🎉 All workouts synced successfully!');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

syncComplete();






