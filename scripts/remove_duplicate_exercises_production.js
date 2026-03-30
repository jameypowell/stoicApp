// Remove duplicate exercises from production workouts
// For each workout, if an exercise name appears multiple times, keep the first occurrence and remove the rest
const { initDatabase, Database } = require('../database');

async function removeDuplicateExercises() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Removing Duplicate Exercises from Production');
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
    // Get all workouts
    const workouts = await db.query(`
      SELECT id, name, phase
      FROM workout
      WHERE phase IN ('Phase One', 'Phase Two', 'Phase Three')
      ORDER BY phase, id
    `);

    let totalRemoved = 0;
    const removed = [];

    for (const workout of workouts.rows) {
      // Get all exercises for this workout
      const exercises = await db.query(`
        SELECT 
          be.id as block_exercise_id,
          be.block_id,
          be.order_index,
          e.name as exercise_name,
          wb.block_type,
          wb.order_index as block_order
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        JOIN workout_blocks wb ON be.block_id = wb.id
        WHERE wb.workout_id = $1
        ORDER BY wb.order_index, be.order_index
      `, [workout.id]);

      // Find duplicates by exercise name (case-insensitive)
      const seenExercises = new Set();
      const toRemove = [];

      exercises.rows.forEach(ex => {
        const name = ex.exercise_name.toLowerCase();
        if (seenExercises.has(name)) {
          // This is a duplicate - mark for removal
          toRemove.push({
            block_exercise_id: ex.block_exercise_id,
            exercise_name: ex.exercise_name,
            block_type: ex.block_type,
            order_index: ex.order_index
          });
        } else {
          // First occurrence - keep it
          seenExercises.add(name);
        }
      });

      if (toRemove.length > 0) {
        console.log(`📋 ${workout.name}:`);
        console.log(`   Found ${toRemove.length} duplicate(s) to remove`);
        
        for (const dup of toRemove) {
          try {
            await db.query(`
              DELETE FROM block_exercises
              WHERE id = $1
            `, [dup.block_exercise_id]);
            
            console.log(`   ✅ Removed: ${dup.exercise_name} (${dup.block_type}, order ${dup.order_index})`);
            totalRemoved++;
            removed.push({
              workout: workout.name,
              exercise: dup.exercise_name,
              block_type: dup.block_type
            });
          } catch (error) {
            console.error(`   ❌ Error removing ${dup.exercise_name}: ${error.message}`);
          }
        }
        console.log('');
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Duplicate Removal Complete!');
    console.log('════════════════════════════════════════════════');
    console.log(`Total duplicates removed: ${totalRemoved}`);
    console.log('');

    // Verify no duplicates remain
    console.log('Verifying no duplicates remain...');
    let remainingDuplicates = 0;
    
    for (const workout of workouts.rows) {
      const exercises = await db.query(`
        SELECT 
          e.name as exercise_name
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        JOIN workout_blocks wb ON be.block_id = wb.id
        WHERE wb.workout_id = $1
      `, [workout.id]);
      
      const exerciseCounts = {};
      exercises.rows.forEach(ex => {
        const name = ex.exercise_name.toLowerCase();
        exerciseCounts[name] = (exerciseCounts[name] || 0) + 1;
      });
      
      Object.keys(exerciseCounts).forEach(name => {
        if (exerciseCounts[name] > 1) {
          remainingDuplicates += exerciseCounts[name] - 1;
        }
      });
    }
    
    if (remainingDuplicates === 0) {
      console.log('✅ Verification passed: No duplicates remain');
    } else {
      console.log(`⚠️  Warning: ${remainingDuplicates} duplicates still found`);
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
  removeDuplicateExercises()
    .then(() => {
      console.log('');
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { removeDuplicateExercises };




















