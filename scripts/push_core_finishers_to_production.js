#!/usr/bin/env node
/**
 * Push only Core Finisher workouts from localhost SQLite database to production via API
 * 
 * Usage: node scripts/push_core_finishers_to_production.js [EMAIL] [PASSWORD]
 */

require('dotenv').config();
const { initDatabase, Database } = require('../database');

const email = process.argv[2] || process.env.ADMIN_EMAIL;
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
const apiBase = process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com/api';

async function pushCoreFinishersToProduction() {
  try {
    console.log('🔄 Pushing Core Finisher workouts from localhost to production...\n');

    // Step 1: Get core finisher workouts from localhost
    console.log('📥 Reading Core Finisher workouts from localhost database...');
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    const allWorkouts = await db.getAllWorkouts();
    const coreWorkouts = allWorkouts.filter(w => 
      w.workout_type === 'core' || 
      (w.workout_type === null && w.google_drive_file_id === '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4')
    );
    
    console.log(`✅ Found ${coreWorkouts.length} Core Finisher workouts in localhost\n`);

    if (coreWorkouts.length === 0) {
      console.log('⚠️  No Core Finisher workouts found in localhost database');
      process.exit(0);
    }

    // Step 2: Authenticate with production
    if (!email || !password) {
      console.error('❌ Error: Email and password required for authentication');
      console.log('   Provide via command line or set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
      process.exit(1);
    }

    console.log('🔐 Authenticating with production API...');
    const loginResponse = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!loginResponse.ok) {
      const error = await loginResponse.json();
      console.error('❌ Login failed:', error.error || 'Unknown error');
      process.exit(1);
    }

    const { token } = await loginResponse.json();
    console.log('✅ Authenticated successfully\n');

    // Step 3: Push core finisher workouts to production in batches
    console.log('📤 Pushing Core Finisher workouts to production (in batches)...');
    
    const workoutsToPush = coreWorkouts.map(w => ({
      date: typeof w.workout_date === 'string' 
        ? w.workout_date.split('T')[0].split(' ')[0]
        : new Date(w.workout_date).toISOString().split('T')[0],
      fileId: w.google_drive_file_id || '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4',
      title: w.title || 'Core Finisher',
      content: w.content,
      workout_type: 'core' // Explicitly set as core
    }));

    // Send in batches of 50 to avoid payload size limits
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

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ SYNC COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log('  Core Finisher workouts from localhost:', coreWorkouts.length);
    console.log('  Total processed:', workoutsToPush.length);
    console.log('  Successfully synced:', totalSuccessful);
    console.log('  Failed:', totalFailed);
    console.log('');

    if (allErrors.length > 0) {
      console.log('⚠️  Errors:');
      allErrors.forEach(err => {
        console.log(`  ${err.index !== undefined ? `Workout ${err.index + 1}` : 'Unknown'}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 Core Finisher workouts synced to production database!');
    console.log('');

  } catch (error) {
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('\nStack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  }
}

pushCoreFinishersToProduction();





