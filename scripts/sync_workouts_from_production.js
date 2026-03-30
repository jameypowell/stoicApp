#!/usr/bin/env node
/**
 * Copy workouts from production database to localhost database
 * 
 * Usage: node scripts/sync_workouts_from_production.js [EMAIL] [PASSWORD]
 */

require('dotenv').config();
const { initDatabase, Database } = require('../database');

const email = process.argv[2] || process.env.ADMIN_EMAIL;
const password = process.argv[3] || process.env.ADMIN_PASSWORD;
const apiBase = process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com/api';

async function syncFromProduction() {
  try {
    console.log('🔄 Syncing workouts from production to localhost...\n');

    // Step 1: Login to production API
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

    // Step 2: Get all workouts from production
    console.log('📥 Fetching workouts from production...');
    
    const workoutsResponse = await fetch(`${apiBase}/admin/workouts/all`, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`
      }
    });

    if (!workoutsResponse.ok) {
      const error = await workoutsResponse.json();
      console.error('❌ Failed to fetch workouts:', error.error || 'Unknown error');
      process.exit(1);
    }

    const { workouts } = await workoutsResponse.json();
    console.log(`✅ Found ${workouts.length} workouts in production\n`);

    if (workouts.length === 0) {
      console.log('⚠️  No workouts found in production');
      process.exit(0);
    }

    // Step 3: Initialize local database
    console.log('💾 Initializing local database...');
    // Unset PostgreSQL env vars to force SQLite
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    console.log('✅ Connected to local database\n');

    // Step 4: Store workouts in local database
    console.log('📝 Storing workouts in local database...');
    
    const workoutsToStore = workouts.map(w => ({
      date: w.date || w.workout_date || (typeof w.workout_date === 'string' 
        ? w.workout_date.split('T')[0].split(' ')[0]
        : new Date(w.workout_date).toISOString().split('T')[0]),
      fileId: w.file_id || 'synced-from-production',
      title: w.title || 'Workout',
      content: w.content
    }));

    const dbResult = await db.createWorkouts(workoutsToStore);

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ SYNC COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log('  Workouts fetched from production:', workouts.length);
    console.log('  Total processed:', dbResult.total);
    console.log('  Successfully stored:', dbResult.successful);
    console.log('  Failed:', dbResult.failed);
    console.log('');

    if (dbResult.errors.length > 0) {
      console.log('⚠️  Errors:');
      dbResult.errors.forEach(err => {
        console.log(`  ${err.date || 'Unknown'}: ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 Workouts synced to localhost database!');
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

syncFromProduction();

