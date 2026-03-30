#!/usr/bin/env node
/**
 * Push strength workouts from localhost SQLite database to production
 * Can filter by phase for incremental testing
 * 
 * Usage: node scripts/push-strength-workouts-to-production.js [PHASE]
 *   PHASE can be: "Phase One: Beginner", "Phase Two: Intermediate", "Phase Three: Advanced", or "all"
 */

require('dotenv').config();
const { initDatabase, Database } = require('../database');

const phaseFilter = process.argv[2] || 'Phase One: Beginner'; // Default to Phase One for testing
const email = process.env.ADMIN_EMAIL;
const password = process.env.ADMIN_PASSWORD;
const apiBase = process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com/api';

async function pushStrengthWorkoutsToProduction() {
  try {
    console.log(`🔄 Pushing Strength workouts (${phaseFilter}) from localhost to production...\n`);

    // Step 1: Get strength workouts from localhost
    console.log('📥 Reading Strength workouts from localhost database...');
    delete process.env.DB_HOST;
    delete process.env.DB_USER;
    delete process.env.DB_PASSWORD;
    delete process.env.DB_NAME;
    
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    let allStrengthWorkouts = await db.getAllStrengthWorkouts();
    
    // Filter by phase if specified
    if (phaseFilter !== 'all') {
      allStrengthWorkouts = allStrengthWorkouts.filter(w => w.phase === phaseFilter);
    }
    
    console.log(`✅ Found ${allStrengthWorkouts.length} Strength workouts in localhost (filter: ${phaseFilter})\n`);

    if (allStrengthWorkouts.length === 0) {
      console.log('⚠️  No Strength workouts found matching the filter');
      process.exit(0);
    }

    // Step 2: Authenticate with production
    if (!email || !password) {
      console.error('❌ Error: Email and password required for authentication');
      console.log('   Set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
      process.exit(1);
    }

    console.log('🔐 Authenticating with production API...');
    const loginResponse = await fetch(`${apiBase}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password })
    });

    if (!loginResponse.ok) {
      const errorData = await loginResponse.json();
      console.error('❌ Authentication failed:', errorData.error || loginResponse.statusText);
      process.exit(1);
    }

    const { token } = await loginResponse.json();
    console.log('✅ Authenticated successfully\n');

    // Step 3: Push workouts to production via API
    console.log('📤 Pushing workouts to production...\n');
    
    let successCount = 0;
    let failCount = 0;
    const errors = [];

    for (const workout of allStrengthWorkouts) {
      try {
        // Format workout data for API
        const workoutData = {
          workout_date: workout.workout_date,
          google_drive_file_id: workout.google_drive_file_id,
          title: workout.title || `Strength - ${workout.phase}`,
          content: workout.content,
          phase: workout.phase,
          primary_focus: workout.primary_focus,
          secondary_focus: workout.secondary_focus,
          slide_number: workout.slide_number,
          workout_index: workout.workout_index,
          workout_number: workout.workout_number
        };

        // Use a bulk endpoint or individual create endpoint
        // For now, we'll use a direct database approach via an admin endpoint if available
        // Or we can create a bulk endpoint
        
        const response = await fetch(`${apiBase}/admin/strength-workouts`, {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${token}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify(workoutData)
        });

        if (response.ok) {
          successCount++;
          console.log(`  ✓ Pushed ${workout.workout_date} (${workout.phase}) - Workout:${workout.workout_number || 'N/A'}`);
        } else {
          const errorData = await response.json().catch(() => ({ error: response.statusText }));
          failCount++;
          errors.push({ date: workout.workout_date, error: errorData.error || response.statusText });
          console.log(`  ✗ Failed ${workout.workout_date}: ${errorData.error || response.statusText}`);
        }
      } catch (error) {
        failCount++;
        errors.push({ date: workout.workout_date, error: error.message });
        console.log(`  ✗ Error pushing ${workout.workout_date}: ${error.message}`);
      }
    }

    console.log('\n════════════════════════════════════════════════');
    console.log('✅ PUSH COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log(`\n📊 Summary:`);
    console.log(`  Total workouts: ${allStrengthWorkouts.length}`);
    console.log(`  Successful: ${successCount}`);
    console.log(`  Failed: ${failCount}`);
    
    if (errors.length > 0) {
      console.log('\n⚠️  Errors:');
      errors.forEach(err => {
        console.log(`  ${err.date}: ${err.error}`);
      });
    }

    console.log('\n🎉 Strength workouts push complete!');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

pushStrengthWorkoutsToProduction();



