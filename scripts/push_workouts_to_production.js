#!/usr/bin/env node
/**
 * Push workouts from localhost SQLite database to production via API
 * 
 * Usage: node scripts/push_workouts_to_production.js [EMAIL] [PASSWORD]
 */

require('dotenv').config();

// CRITICAL: Delete PostgreSQL env vars BEFORE requiring database module to force SQLite
delete process.env.DB_HOST;
delete process.env.DB_USER;
delete process.env.DB_PASSWORD;
delete process.env.DB_NAME;

const { initDatabase, Database } = require('../database');

const email = process.argv[2] || process.env.ADMIN_EMAIL;
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
const apiBase = process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com/api';

async function pushToProduction() {
  try {
    console.log('🔄 Pushing workouts from localhost to production...\n');

    // Step 1: Get workouts from localhost
    console.log('📥 Reading workouts from localhost database...');
    
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    // Get only the workouts we want to push (Dec 22, 2025 - Jan 23, 2026)
    const allWorkouts = await db.getAllWorkouts();
    const workouts = allWorkouts.filter(w => {
      const date = typeof w.workout_date === 'string' 
        ? w.workout_date.split('T')[0].split(' ')[0]
        : new Date(w.workout_date).toISOString().split('T')[0];
      return date >= '2025-12-22' && date <= '2026-01-23' &&
             w.google_drive_file_id === '1cmFR_i_jtu7oN3l5e0Feq522-xMls9AkBZljYgLg3So';
    });
    
    console.log(`✅ Found ${workouts.length} workouts to push (Dec 22, 2025 - Jan 23, 2026)\n`);

    if (workouts.length === 0) {
      console.log('⚠️  No workouts found in the date range (Dec 22, 2025 - Jan 23, 2026)');
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

    // Step 3: Push workouts to production in batches
    console.log('📤 Pushing workouts to production (in batches)...');
    
    const workoutsToPush = workouts.map(w => ({
      date: typeof w.workout_date === 'string' 
        ? w.workout_date.split('T')[0].split(' ')[0]
        : new Date(w.workout_date).toISOString().split('T')[0],
      fileId: w.google_drive_file_id || 'synced-from-localhost',
      title: w.title || 'Workout',
      content: w.content,
      workout_type: w.workout_type || 'regular' // Include workout_type field
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

    // Create a summary result object
    const result = {
      summary: {
        total: workoutsToPush.length,
        successful: totalSuccessful,
        failed: totalFailed,
        errors: allErrors
      }
    };
    
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ SYNC COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log('  Workouts from localhost:', workouts.length);
    console.log('  Total processed:', result.summary.total);
    console.log('  Successfully synced:', result.summary.successful);
    console.log('  Failed:', result.summary.failed);
    console.log('');

    if (result.summary.errors && result.summary.errors.length > 0) {
      console.log('⚠️  Errors:');
      result.summary.errors.forEach(err => {
        console.log(`  ${err.index !== undefined ? `Workout ${err.index + 1}` : 'Unknown'}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 Workouts synced to production database!');
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

pushToProduction();

