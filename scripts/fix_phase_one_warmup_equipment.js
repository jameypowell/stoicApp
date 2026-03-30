// Fix warm-up exercises to only show one equipment per exercise
// Remove duplicate equipment entries from exercise_equipment for warm-up exercises
const { initDatabase, Database } = require('../database');

async function fixWarmupEquipment() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Fixing Warm-Up Exercise Equipment');
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
    // Get all Phase One workouts
    const workouts = await db.query(`
      SELECT id, name
      FROM workout
      WHERE phase = 'Phase One'
      ORDER BY id
    `);

    let totalFixed = 0;

    for (const workout of workouts.rows) {
      // Get warm-up exercises
      const warmupExercises = await db.query(`
        SELECT 
          be.id as block_exercise_id,
          be.exercise_id,
          e.name as exercise_name,
          STRING_AGG(eq.id::text || ':' || eq.name, ', ') as equipment_list
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        JOIN workout_blocks wb ON be.block_id = wb.id
        LEFT JOIN exercise_equipment ee ON e.id = ee.exercise_id
        LEFT JOIN equipment eq ON ee.equipment_id = eq.id
        WHERE wb.workout_id = $1 AND wb.block_type = 'warmup'
        GROUP BY be.id, be.exercise_id, e.name
        ORDER BY be.order_index
      `, [workout.id]);

      let workoutFixed = false;

      for (const ex of warmupExercises.rows) {
        if (!ex.equipment_list) continue;

        // Check if exercise has multiple equipment
        const equipmentCount = ex.equipment_list.split(',').length;
        
        if (equipmentCount > 1) {
          if (!workoutFixed) {
            console.log(`📋 ${workout.name}:`);
            workoutFixed = true;
          }

          // Get all equipment for this exercise
          const allEquipment = await db.query(`
            SELECT ee.id, eq.id as equipment_id, eq.name as equipment_name
            FROM exercise_equipment ee
            JOIN equipment eq ON ee.equipment_id = eq.id
            WHERE ee.exercise_id = $1
            ORDER BY eq.name
          `, [ex.exercise_id]);

          if (allEquipment.rows.length > 1) {
            // Keep the first equipment, remove the rest
            const keepEquipment = allEquipment.rows[0];
            const removeEquipment = allEquipment.rows.slice(1);

            console.log(`   Exercise: ${ex.exercise_name}`);
            console.log(`   Keeping: ${keepEquipment.equipment_name}`);
            
            for (const remove of removeEquipment) {
              await db.query(`
                DELETE FROM exercise_equipment
                WHERE id = $1
              `, [remove.id]);
              console.log(`   ✅ Removed: ${remove.equipment_name}`);
              totalFixed++;
            }
          }
        }
      }

      if (workoutFixed) {
        console.log('');
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Fix Complete!');
    console.log('════════════════════════════════════════════════');
    console.log(`Total equipment entries removed: ${totalFixed}`);
    console.log('');

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
  fixWarmupEquipment()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixWarmupEquipment };




















