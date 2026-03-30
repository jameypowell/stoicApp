// Fix all exercises across all phases to have only one equipment per exercise
// Remove duplicate equipment entries, keeping the first one
const { initDatabase, Database } = require('../database');

async function fixAllExercisesEquipment() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Fixing All Exercises Equipment (All Phases)');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  if (!db.isPostgres) {
    console.log('⚠️  This script is for PostgreSQL production only.');
    if (dbConnection.close) dbConnection.close();
    return;
  }

  console.log('✅ Connected to PostgreSQL database');
  console.log('');

  try {
    // Get all unique exercises that are used in workouts
    const exercisesInWorkouts = await db.query(`
      SELECT DISTINCT e.id, e.name
      FROM exercises e
      JOIN block_exercises be ON e.id = be.exercise_id
      JOIN workout_blocks wb ON be.block_id = wb.id
      JOIN workout w ON wb.workout_id = w.id
      WHERE w.phase IN ('Phase One', 'Phase Two', 'Phase Three')
      ORDER BY e.name
    `);

    console.log(`Found ${exercisesInWorkouts.rows.length} unique exercises used in workouts`);
    console.log('');

    let totalFixed = 0;
    let exercisesFixed = 0;

    for (const exercise of exercisesInWorkouts.rows) {
      // Get all equipment for this exercise
      const allEquipment = await db.query(`
        SELECT ee.id, eq.id as equipment_id, eq.name as equipment_name
        FROM exercise_equipment ee
        JOIN equipment eq ON ee.equipment_id = eq.id
        WHERE ee.exercise_id = $1
        ORDER BY eq.name
      `, [exercise.id]);

      if (allEquipment.rows.length > 1) {
        // Keep the first equipment, remove the rest
        const keepEquipment = allEquipment.rows[0];
        const removeEquipment = allEquipment.rows.slice(1);

        console.log(`📋 ${exercise.name}:`);
        console.log(`   Keeping: ${keepEquipment.equipment_name}`);
        
        for (const remove of removeEquipment) {
          await db.query(`
            DELETE FROM exercise_equipment
            WHERE id = $1
          `, [remove.id]);
          console.log(`   ✅ Removed: ${remove.equipment_name}`);
          totalFixed++;
        }
        
        exercisesFixed++;
        console.log('');
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Fix Complete!');
    console.log('════════════════════════════════════════════════');
    console.log(`Exercises fixed: ${exercisesFixed}`);
    console.log(`Total equipment entries removed: ${totalFixed}`);
    console.log('');

    // Verify no exercises have multiple equipment
    console.log('Verifying fix...');
    const verifyResult = await db.query(`
      SELECT 
        e.id,
        e.name,
        COUNT(ee.id) as equipment_count,
        STRING_AGG(eq.name, ', ') as equipment_list
      FROM exercises e
      JOIN exercise_equipment ee ON e.id = ee.exercise_id
      JOIN equipment eq ON ee.equipment_id = eq.id
      WHERE e.id IN (
        SELECT DISTINCT e2.id
        FROM exercises e2
        JOIN block_exercises be ON e2.id = be.exercise_id
        JOIN workout_blocks wb ON be.block_id = wb.id
        JOIN workout w ON wb.workout_id = w.id
        WHERE w.phase IN ('Phase One', 'Phase Two', 'Phase Three')
      )
      GROUP BY e.id, e.name
      HAVING COUNT(ee.id) > 1
    `);

    if (verifyResult.rows.length === 0) {
      console.log('✅ Verification passed: All exercises now have single equipment');
    } else {
      console.log(`⚠️  Warning: ${verifyResult.rows.length} exercises still have multiple equipment:`);
      verifyResult.rows.forEach(ex => {
        console.log(`   ${ex.name}: ${ex.equipment_list}`);
      });
    }

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error);
    throw error;
  } finally {
    if (db.isPostgres) {
      await dbConnection.end();
    } else if (dbConnection.close) {
      dbConnection.close();
    }
  }
}

if (require.main === module) {
  fixAllExercisesEquipment()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixAllExercisesEquipment };




















