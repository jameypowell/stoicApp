// Verification script for production migration
// Run this after migration to verify everything is set up correctly

const { initDatabase, Database } = require('../database');

async function verifyMigration() {
  console.log('════════════════════════════════════════════════');
  console.log('🔍 Verifying Production Migration');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  if (!db.isPostgres) {
    console.log('⚠️  This verification is for PostgreSQL production only.');
    console.log('   Skipping verification.');
    if (dbConnection.close) {
      dbConnection.close();
    }
    return;
  }

  console.log('✅ Connected to PostgreSQL database');
  console.log('');

  let allChecksPassed = true;

  try {
    // 1. Check all tables exist
    console.log('1. Checking table existence...');
    const requiredTables = [
      'exercises', 'equipment', 'exercise_equipment',
      'workout_types', 'workout_formats', 'workout',
      'workout_blocks', 'block_exercises'
    ];

    for (const table of requiredTables) {
      const result = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [table]);
      
      const exists = result.rows[0]?.exists || false;
      if (exists) {
        console.log(`   ✅ ${table} exists`);
      } else {
        console.log(`   ❌ ${table} MISSING`);
        allChecksPassed = false;
      }
    }

    // 2. Check reference data
    console.log('\n2. Checking reference data...');
    
    const equipmentCount = await db.queryOne(`
      SELECT COUNT(*) as count FROM equipment
    `);
    console.log(`   Equipment: ${equipmentCount?.count || 0} items`);
    if ((equipmentCount?.count || 0) < 20) {
      console.log('   ⚠️  Warning: Expected ~30 equipment items');
      allChecksPassed = false;
    }

    const exerciseCount = await db.queryOne(`
      SELECT COUNT(*) as count FROM exercise
    `);
    console.log(`   Exercises: ${exerciseCount?.count || 0} items`);
    if ((exerciseCount?.count || 0) < 300) {
      console.log('   ⚠️  Warning: Expected ~400 exercises');
      allChecksPassed = false;
    }

    const formatCount = await db.queryOne(`
      SELECT COUNT(*) as count FROM workout_formats
    `);
    console.log(`   Workout Formats: ${formatCount?.count || 0} formats`);
    if ((formatCount?.count || 0) !== 3) {
      console.log('   ❌ Expected 3 workout formats (Phase One, Two, Three)');
      allChecksPassed = false;
    }

    const workoutTypeCount = await db.queryOne(`
      SELECT COUNT(*) as count FROM workout_types WHERE code = 'STRENGTH'
    `);
    console.log(`   Workout Types: ${workoutTypeCount?.count || 0} STRENGTH type(s)`);
    if ((workoutTypeCount?.count || 0) !== 1) {
      console.log('   ❌ Expected 1 STRENGTH workout type');
      allChecksPassed = false;
    }

    // 3. Check workouts by phase
    console.log('\n3. Checking workouts by phase...');
    
    const phaseOneCount = await db.queryOne(`
      SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase One'
    `);
    console.log(`   Phase One: ${phaseOneCount?.count || 0} workouts`);
    if ((phaseOneCount?.count || 0) !== 8) {
      console.log('   ❌ Expected 8 Phase One workouts');
      allChecksPassed = false;
    }

    const phaseTwoCount = await db.queryOne(`
      SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase Two'
    `);
    console.log(`   Phase Two: ${phaseTwoCount?.count || 0} workouts`);
    if ((phaseTwoCount?.count || 0) !== 7) {
      console.log('   ❌ Expected 7 Phase Two workouts');
      allChecksPassed = false;
    }

    const phaseThreeCount = await db.queryOne(`
      SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase Three'
    `);
    console.log(`   Phase Three: ${phaseThreeCount?.count || 0} workouts`);
    if ((phaseThreeCount?.count || 0) !== 7) {
      console.log('   ❌ Expected 7 Phase Three workouts');
      allChecksPassed = false;
    }

    // 4. Check workout structure (blocks and exercises)
    console.log('\n4. Checking workout structure...');
    
    const workoutStructure = await db.query(`
      SELECT 
        w.id,
        w.name,
        w.phase,
        COUNT(DISTINCT wb.id) as block_count,
        COUNT(be.id) as exercise_count
      FROM workout w
      LEFT JOIN workout_blocks wb ON w.id = wb.workout_id
      LEFT JOIN block_exercises be ON wb.id = be.block_id
      WHERE w.phase IN ('Phase One', 'Phase Two', 'Phase Three')
      GROUP BY w.id, w.name, w.phase
      ORDER BY w.phase, w.id
      LIMIT 5
    `);

    console.log('   Sample workouts:');
    for (const workout of workoutStructure.rows || workoutStructure) {
      const hasBlocks = (workout.block_count || 0) > 0;
      const hasExercises = (workout.exercise_count || 0) > 0;
      const status = (hasBlocks && hasExercises) ? '✅' : '❌';
      console.log(`   ${status} ${workout.name}: ${workout.block_count} blocks, ${workout.exercise_count} exercises`);
      
      if (!hasBlocks || !hasExercises) {
        allChecksPassed = false;
      }
    }

    // 5. Check for duplicate exercises in workouts
    console.log('\n5. Checking for duplicate exercises within workouts...');
    
    const duplicates = await db.query(`
      SELECT 
        w.id,
        w.name,
        e.exercise,
        COUNT(*) as count
      FROM workout w
      JOIN workout_blocks wb ON w.id = wb.workout_id
      JOIN block_exercises be ON wb.id = be.block_id
      JOIN exercise e ON be.exercise_id = e.id
      WHERE w.phase IN ('Phase One', 'Phase Two', 'Phase Three')
      GROUP BY w.id, w.name, e.exercise
      HAVING COUNT(*) > 1
      LIMIT 10
    `);

    if (duplicates.rows && duplicates.rows.length > 0) {
      console.log(`   ⚠️  Found ${duplicates.rows.length} potential duplicate exercises:`);
      for (const dup of duplicates.rows) {
        console.log(`      ${dup.name}: ${dup.exercise} (appears ${dup.count} times)`);
      }
      // Note: This might be okay if exercises have different equipment
      // But Phase One should not have duplicates
    } else {
      console.log('   ✅ No duplicate exercises found (within same workout)');
    }

    // 6. Check unique constraint on workout.name
    console.log('\n6. Checking constraints...');
    
    const uniqueConstraint = await db.query(`
      SELECT constraint_name 
      FROM information_schema.table_constraints 
      WHERE table_name = 'workout' 
      AND constraint_type = 'UNIQUE'
      AND constraint_name LIKE '%name%'
    `);
    
    if (uniqueConstraint.rows && uniqueConstraint.rows.length > 0) {
      console.log('   ✅ UNIQUE constraint on workout.name exists');
    } else {
      console.log('   ⚠️  UNIQUE constraint on workout.name not found');
      // This is not critical, but recommended
    }

    // Summary
    console.log('');
    console.log('════════════════════════════════════════════════');
    if (allChecksPassed) {
      console.log('✅ All Verification Checks Passed!');
      console.log('════════════════════════════════════════════════');
      console.log('');
      console.log('Next steps:');
      console.log('  1. Test API endpoints');
      console.log('  2. Verify UI rendering');
      console.log('  3. Test phase switching');
      console.log('');
    } else {
      console.log('❌ Some Verification Checks Failed');
      console.log('════════════════════════════════════════════════');
      console.log('');
      console.log('Please review the errors above and fix any issues.');
      console.log('You may need to re-run the migration scripts.');
      console.log('');
    }

  } catch (error) {
    console.error('');
    console.error('❌ Error during verification:', error);
    throw error;
  } finally {
    if (db.isPostgres) {
      await dbConnection.end();
    } else if (dbConnection.close) {
      dbConnection.close();
    }
  }
}

// Run if called directly
if (require.main === module) {
  verifyMigration()
    .then(() => {
      process.exit(0);
    })
    .catch((error) => {
      console.error('Verification failed:', error);
      process.exit(1);
    });
}

module.exports = { verifyMigration };




















