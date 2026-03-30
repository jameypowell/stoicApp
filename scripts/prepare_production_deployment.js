// Preparation script for production deployment
// Verifies environment and readiness before running migration

const { Client } = require('pg');
require('dotenv').config();

async function prepareDeployment() {
  console.log('════════════════════════════════════════════════');
  console.log('🔍 Production Deployment Preparation');
  console.log('════════════════════════════════════════════════');
  console.log('');

  // Check environment variables
  console.log('1. Checking environment variables...');
  const requiredVars = ['DB_HOST', 'DB_USER', 'DB_PASSWORD'];
  const optionalVars = ['DB_NAME', 'DB_PORT', 'DB_SSL'];
  
  let allSet = true;
  for (const varName of requiredVars) {
    if (process.env[varName]) {
      if (varName === 'DB_PASSWORD') {
        console.log(`   ✅ ${varName}: ******** (set)`);
      } else {
        console.log(`   ✅ ${varName}: ${process.env[varName]}`);
      }
    } else {
      console.log(`   ❌ ${varName}: NOT SET`);
      allSet = false;
    }
  }
  
  for (const varName of optionalVars) {
    if (process.env[varName]) {
      console.log(`   ℹ️  ${varName}: ${process.env[varName]}`);
    } else {
      console.log(`   ℹ️  ${varName}: using default`);
    }
  }

  if (!allSet) {
    console.log('');
    console.log('❌ Missing required environment variables!');
    console.log('   Set them with:');
    console.log('   export DB_HOST=your-production-host');
    console.log('   export DB_USER=your-db-user');
    console.log('   export DB_PASSWORD=your-db-password');
    console.log('   export DB_NAME=your-db-name  # optional, defaults to postgres');
    return false;
  }

  // Test database connection
  console.log('');
  console.log('2. Testing database connection...');
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? {
      rejectUnauthorized: false
    } : false
  });

  try {
    await client.connect();
    console.log('   ✅ Connection successful');

    // Get database info
    const versionResult = await client.query('SELECT version()');
    console.log(`   ℹ️  PostgreSQL: ${versionResult.rows[0].version.split(' ')[0]} ${versionResult.rows[0].version.split(' ')[1]}`);

    // Check if new tables already exist
    console.log('');
    console.log('3. Checking existing tables...');
    const tablesCheck = await client.query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name IN ('workout', 'workout_blocks', 'block_exercises', 
                         'exercises', 'equipment', 'workout_types', 
                         'workout_formats', 'exercise_equipment')
      ORDER BY table_name
    `);

    if (tablesCheck.rows.length > 0) {
      console.log('   ⚠️  Some tables already exist:');
      tablesCheck.rows.forEach(row => {
        console.log(`      - ${row.table_name}`);
      });
      console.log('   ℹ️  Migration will skip creating existing tables (safe)');
    } else {
      console.log('   ✅ No new tables exist yet (ready for migration)');
    }

    // Check if old strength_workouts table exists
    const oldTableCheck = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_name = 'strength_workouts'
      )
    `);
    
    if (oldTableCheck.rows[0].exists) {
      console.log('   ℹ️  Old strength_workouts table exists (will remain untouched)');
    }

    // Check database size (rough estimate)
    const dbSizeResult = await client.query(`
      SELECT pg_size_pretty(pg_database_size(current_database())) as size
    `);
    console.log(`   ℹ️  Database size: ${dbSizeResult.rows[0].size}`);

    await client.end();

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Environment Ready for Migration!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Create a database backup:');
    console.log('     pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME > backup_$(date +%Y%m%d_%H%M%S).sql');
    console.log('');
    console.log('  2. Run the migration:');
    console.log('     ./scripts/run_production_migration.sh');
    console.log('');
    console.log('  3. Or run phases individually:');
    console.log('     node migrations/migrate_strength_workouts_schema.js');
    console.log('     node scripts/seed_strength_reference_data_simple.js');
    console.log('     node scripts/seed_strength_workouts.js');
    console.log('     node scripts/verify_production_migration.js');
    console.log('');
    return true;

  } catch (error) {
    console.log('');
    console.log('❌ Connection failed!');
    console.log(`   Error: ${error.message}`);
    console.log('');
    console.log('Please check:');
    console.log('  - Database host is correct');
    console.log('  - Database credentials are correct');
    console.log('  - Network connectivity to database');
    console.log('  - Firewall rules allow connection');
    console.log('  - SSL settings (if required)');
    return false;
  }
}

// Run if called directly
if (require.main === module) {
  prepareDeployment()
    .then((ready) => {
      process.exit(ready ? 0 : 1);
    })
    .catch((error) => {
      console.error('Preparation failed:', error);
      process.exit(1);
    });
}

module.exports = { prepareDeployment };




















