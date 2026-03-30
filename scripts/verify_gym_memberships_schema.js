/**
 * Verification script to check which gym_memberships schema columns exist in production
 * This helps determine what migrations need to be run before deployment
 */

require('dotenv').config();
const { Client } = require('pg');

const requiredColumns = [
  'household_id',
  'pauses_used_this_contract',
  'contract_start_date',
  'contract_end_date',
  'contract_months',
  'cancellation_fee_charged',
  'cancellation_fee_amount'
];

const requiredStatusValues = ['active', 'paused', 'inactive', 'expired'];

async function verifySchema() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
  });

  try {
    console.log('🔍 Connecting to production database...');
    console.log(`   Host: ${process.env.DB_HOST}`);
    console.log(`   Database: ${process.env.DB_NAME}`);
    console.log(`   User: ${process.env.DB_USER}\n`);

    await client.connect();
    console.log('✅ Connected successfully\n');

    // Check if gym_memberships table exists
    const tableExists = await client.query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public' 
        AND table_name = 'gym_memberships'
      );
    `);

    if (!tableExists.rows[0].exists) {
      console.log('❌ gym_memberships table does not exist');
      await client.end();
      process.exit(1);
    }

    console.log('✅ gym_memberships table exists\n');

    // Get all columns in gym_memberships table
    const columnsResult = await client.query(`
      SELECT column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      AND table_name = 'gym_memberships'
      ORDER BY ordinal_position;
    `);

    const existingColumns = columnsResult.rows.map(row => row.column_name);
    console.log('📋 Existing columns in gym_memberships:');
    columnsResult.rows.forEach(col => {
      console.log(`   - ${col.column_name} (${col.data_type})`);
    });
    console.log('');

    // Check for required columns
    console.log('🔍 Checking for required columns:\n');
    const missingColumns = [];
    
    for (const col of requiredColumns) {
      const exists = existingColumns.includes(col);
      if (exists) {
        console.log(`   ✅ ${col} - EXISTS`);
      } else {
        console.log(`   ❌ ${col} - MISSING`);
        missingColumns.push(col);
      }
    }

    // Check status constraint
    console.log('\n🔍 Checking status constraint:\n');
    const constraintResult = await client.query(`
      SELECT constraint_name, check_clause
      FROM information_schema.check_constraints
      WHERE constraint_name LIKE '%gym_memberships%status%';
    `);

    if (constraintResult.rows.length > 0) {
      const constraint = constraintResult.rows[0];
      console.log(`   Constraint: ${constraint.constraint_name}`);
      console.log(`   Check clause: ${constraint.check_clause}`);
      
      // Check if 'paused' is in the constraint
      const hasPaused = constraint.check_clause.includes("'paused'");
      if (hasPaused) {
        console.log('   ✅ Status constraint includes "paused"\n');
      } else {
        console.log('   ❌ Status constraint does NOT include "paused"\n');
      }
    } else {
      console.log('   ⚠️  No status constraint found\n');
    }

    // Check for household_id index
    console.log('🔍 Checking for household_id index:\n');
    const indexResult = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'gym_memberships'
      AND indexname LIKE '%household_id%';
    `);

    if (indexResult.rows.length > 0) {
      console.log('   ✅ household_id index exists:');
      indexResult.rows.forEach(idx => {
        console.log(`      - ${idx.indexname}`);
      });
    } else {
      console.log('   ❌ household_id index MISSING');
    }

    // Summary
    console.log('\n' + '='.repeat(60));
    console.log('📊 VERIFICATION SUMMARY');
    console.log('='.repeat(60));

    if (missingColumns.length === 0) {
      console.log('✅ All required columns exist!');
    } else {
      console.log(`❌ Missing ${missingColumns.length} column(s):`);
      missingColumns.forEach(col => console.log(`   - ${col}`));
    }

    // Check if old column exists (pauses_used_this_year)
    if (existingColumns.includes('pauses_used_this_year')) {
      console.log('\n⚠️  Old column "pauses_used_this_year" still exists');
      console.log('   This should be migrated to "pauses_used_this_contract"');
    }

    console.log('\n' + '='.repeat(60));

    if (missingColumns.length > 0) {
      console.log('\n⚠️  ACTION REQUIRED:');
      console.log('   Run migration script: scripts/migrate_gym_memberships_schema.js');
      await client.end();
      process.exit(1);
    } else {
      console.log('\n✅ Schema is up to date! Safe to deploy.');
      await client.end();
      process.exit(0);
    }

  } catch (error) {
    console.error('❌ Error verifying schema:', error.message);
    console.error(error);
    await client.end();
    process.exit(1);
  }
}

// Check for required environment variables
const requiredEnvVars = ['DB_HOST', 'DB_NAME', 'DB_USER', 'DB_PASSWORD'];
const missingEnvVars = requiredEnvVars.filter(v => !process.env[v]);

if (missingEnvVars.length > 0) {
  console.error('❌ Missing required environment variables:');
  missingEnvVars.forEach(v => console.error(`   - ${v}`));
  console.error('\nPlease set these in your .env file or environment');
  process.exit(1);
}

verifySchema();











