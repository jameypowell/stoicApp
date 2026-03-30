#!/usr/bin/env node
/**
 * Sync workouts from Google Slides to production database via API
 * 
 * Usage: node scripts/sync_workouts_to_production.js <FILE_ID> [EMAIL] [PASSWORD]
 */

require('dotenv').config();

const fileId = process.argv[2];
const email = process.argv[3] || process.env.ADMIN_EMAIL;
const password = process.argv[4] || process.env.ADMIN_PASSWORD;
const apiBase = process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com/api';

if (!fileId) {
  console.error('❌ Error: File ID required');
  console.log('');
  console.log('Usage: node scripts/sync_workouts_to_production.js <FILE_ID> [EMAIL] [PASSWORD]');
  console.log('');
  console.log('Example:');
  console.log('  node scripts/sync_workouts_to_production.js 1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4');
  console.log('');
  process.exit(1);
}

async function syncToProduction() {
  try {
    console.log('🔄 Syncing workouts to production...\n');
    console.log('File ID:', fileId);
    console.log('API Base:', apiBase);
    console.log('');

    // Step 1: Login to get token
    if (!email || !password) {
      console.error('❌ Error: Email and password required for authentication');
      console.log('   Provide via command line or set ADMIN_EMAIL and ADMIN_PASSWORD in .env');
      process.exit(1);
    }

    console.log('🔐 Authenticating...');
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

    // Step 2: Sync workouts
    console.log('📥 Syncing workouts from Google Slides...');
    const syncResponse = await fetch(`${apiBase}/admin/workouts/sync-all`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`
      },
      body: JSON.stringify({ fileId })
    });

    if (!syncResponse.ok) {
      const error = await syncResponse.json();
      console.error('❌ Sync failed:', error.error || 'Unknown error');
      if (error.parsed) {
        console.log('\n📋 Parsed slides:');
        error.parsed.forEach((slide, i) => {
          console.log(`  ${i + 1}. Slide ${slide.slideNumber}: ${slide.hasDate ? '✅ Has date' : '❌ No date'}`);
          if (slide.rawDate) {
            console.log(`     Raw date: ${slide.rawDate}`);
          }
        });
      }
      process.exit(1);
    }

    const result = await syncResponse.json();
    
    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ SYNC COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📄 File Information:');
    console.log('  File Name:', result.summary.fileName);
    console.log('  Total Slides:', result.summary.totalSlides);
    console.log('');
    console.log('📋 Workout Summary:');
    console.log('  Workouts Found:', result.summary.workoutsFound);
    console.log('  Workouts with Dates:', result.summary.workoutsWithDates);
    console.log('  Successfully Stored:', result.summary.successfullyStored);
    console.log('  Failed:', result.summary.failed);
    console.log('');

    if (result.summary.errors && result.summary.errors.length > 0) {
      console.log('⚠️  Errors:');
      result.summary.errors.forEach(err => {
        console.log(`  Slide ${err.index + 1}: ${err.error}`);
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

syncToProduction();






