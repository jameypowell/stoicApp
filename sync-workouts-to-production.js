// Script to sync workouts directly to production PostgreSQL database
const { syncAllWorkoutsFromSlides } = require('./google-drive');
const { initDatabase, Database } = require('./database');
require('dotenv').config();

// File ID from the Google Slides URL (docs.google.com/presentation/d/FILE_ID/...)
const fileId = '1PPK-SWA5ifk6PepElxYIY5bzk4mnNh3goTMJ54k9WsU';
// Date range for filtering: Jan 26 to Mar 6, 2026
const startDate = '2026-01-26';
const endDate = '2026-03-06';

// Production database credentials (from set_production_env.sh defaults)
// These can be overridden via environment variables
process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
process.env.DB_USER = process.env.DB_USER || 'stoicapp';
process.env.DB_NAME = process.env.DB_NAME || 'postgres';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_SSL = process.env.DB_SSL !== 'false' ? 'true' : 'false';

// Try to get password from AWS if not set
if (!process.env.DB_PASSWORD) {
  const { execSync } = require('child_process');
  try {
    // Try IAM authentication token for RDS
    try {
      const authToken = execSync(
        `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT} --region us-east-1 --username ${process.env.DB_USER} 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      if (authToken && authToken.trim() && !authToken.includes('error')) {
        process.env.DB_PASSWORD = authToken.trim();
        console.log('✅ Using AWS IAM authentication token');
      }
    } catch (e) {
      // Try Secrets Manager
      try {
        const secretName = process.env.DB_SECRET_NAME || 'stoic-fitness-db-password';
        const secret = execSync(`aws secretsmanager get-secret-value --secret-id ${secretName} --region us-east-1 --query SecretString --output text 2>/dev/null`, { encoding: 'utf-8' });
        if (secret && secret.trim() && !secret.includes('error')) {
          try {
            const parsed = JSON.parse(secret);
            process.env.DB_PASSWORD = parsed.password || parsed.DB_PASSWORD || secret.trim();
          } catch {
            process.env.DB_PASSWORD = secret.trim();
          }
        }
      } catch (e2) {
        // Try Parameter Store
        try {
          const param = execSync(`aws ssm get-parameter --name /stoic-fitness/db-password --region us-east-1 --with-decryption --query Parameter.Value --output text 2>/dev/null`, { encoding: 'utf-8' });
          if (param && param.trim()) {
            process.env.DB_PASSWORD = param.trim();
          }
        } catch (e3) {
          // Password not found in AWS
        }
      }
    }
  } catch (error) {
    // AWS CLI not available or no access
  }
}

async function syncToProduction() {
  console.log('🔄 Syncing functional fitness workouts to PRODUCTION...\n');
  console.log('File ID:', fileId);
  console.log(`Date Range: ${startDate} to ${endDate} (Jan 26 - Mar 6, 2026)`);
  console.log('');

  // Check if production database password is set
  if (!process.env.DB_PASSWORD) {
    console.error('❌ Production database password required!');
    console.error('');
    console.error('The password was not found in AWS Secrets Manager or Parameter Store.');
    console.error('Please set DB_PASSWORD environment variable:');
    console.error('  export DB_PASSWORD=your-password');
    console.error('');
    console.error('Or add it to your .env file:');
    console.error('  DB_PASSWORD=your-password');
    process.exit(1);
  }

  console.log('📊 Database Configuration:');
  console.log('   Type: PostgreSQL (Production)');
  console.log('   Host:', process.env.DB_HOST);
  console.log('   Database:', process.env.DB_NAME);
  console.log('   User:', process.env.DB_USER);
  console.log('   Port:', process.env.DB_PORT);
  console.log('');

  try {
    // Step 1: Connect to production database
    console.log('🔌 Connecting to production database...');
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    console.log('✅ Connected to production database\n');

    // Step 2: Fetch workouts from Google Slides
    console.log('📥 Fetching workouts from Google Slides...');
    const result = await syncAllWorkoutsFromSlides(fileId);

    console.log('✅ Slides Parsed Successfully!\n');
    console.log('📄 File Information:');
    console.log('  File ID:', result.fileId);
    console.log('  File Name:', result.fileName);
    console.log('  Title:', result.title);
    console.log('  Total Slides:', result.totalSlides);
    console.log('');

    // Filter workouts by date range (Jan 3 to Jan 23, 2026)
    const workoutsWithDates = result.workouts.filter(w => w.date !== null);
    const workoutsWithoutDates = result.workouts.filter(w => w.date === null);

    console.log(`📋 All Workouts Found:`);
    console.log(`  ✅ Workouts with dates: ${workoutsWithDates.length}`);
    if (workoutsWithoutDates.length > 0) {
      console.log(`  ⚠️  Workouts without dates: ${workoutsWithoutDates.length}`);
    }
    console.log('');

    // Filter by date range and prepare for database
    const workoutsToStore = workoutsWithDates
      .map(w => {
        // Ensure January dates are 2026, not 2025
        let workoutDate = w.date;
        if (workoutDate && workoutDate.startsWith('2025-01-')) {
          workoutDate = workoutDate.replace('2025-01-', '2026-01-');
          console.log(`  🔧 Correcting date: ${w.date} → ${workoutDate}`);
        }
        return {
          ...w,
          date: workoutDate
        };
      })
      .filter(w => {
        // Filter to only dates between Jan 26 and Mar 6, 2026
        return w.date >= startDate && w.date <= endDate;
      })
      .map(w => ({
        date: w.date,
        fileId: result.fileId,
        title: result.title,
        content: w.content,
        workout_type: 'functional_fitness' // Functional fitness workouts
      }));

    console.log(`📅 Filtered to date range ${startDate} to ${endDate}:`);
    console.log(`  ✅ Workouts in range: ${workoutsToStore.length}`);
    console.log('');

    if (workoutsToStore.length === 0) {
      console.log(`❌ No workouts found in date range ${startDate} to ${endDate}!`);
      console.log('');
      console.log('Available dates found:');
      workoutsWithDates.forEach(w => {
        let date = w.date;
        if (date && date.startsWith('2025-01-')) {
          date = date.replace('2025-01-', '2026-01-');
        }
        console.log(`  • ${date} (Slide ${w.slideNumber})`);
      });
      process.exit(1);
    }

    // Step 3: Store workouts directly in production database
    console.log('💾 Storing workouts in PRODUCTION database...');
    console.log('');
    
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
        console.log(`  ${err.error}`);
      });
      console.log('');
    }

    console.log('🎉 All functional fitness workouts stored in PRODUCTION database!');
    console.log('');
    console.log(`Stored ${workoutsToStore.length} workouts for ${startDate} to ${endDate}:`);
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
    console.error('  5. Check production database connection settings');
    console.error('  6. Verify AWS credentials are configured');
    process.exit(1);
  }
}

syncToProduction();
