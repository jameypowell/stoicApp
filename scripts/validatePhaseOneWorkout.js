// Helper script to validate Phase One workouts don't have duplicates
// Can be used to check seed scripts before running them
const { initDatabase, Database } = require('../database');
const { normalizeExerciseName } = require('../utils/workoutUtils');

/**
 * Validate a Phase One workout doesn't have duplicate exercises
 * @param {Database} db - Database instance
 * @param {number} workoutId - Workout ID to validate
 * @returns {Promise<Object>} - Validation result with duplicates found
 */
async function validateWorkout(db, workoutId) {
  const workoutQuery = db.isPostgres
    ? `SELECT w.id, w.name, w.phase FROM workout w WHERE w.id = $1`
    : `SELECT w.id, w.name, w.phase FROM workout w WHERE w.id = ?`;
  
  const workoutResult = await db.query(workoutQuery, [workoutId]);
  const workout = (workoutResult.rows || workoutResult)[0];
  
  if (!workout) {
    return { valid: false, error: 'Workout not found' };
  }
  
  // Get all exercises for this workout
  const exercisesQuery = db.isPostgres
    ? `SELECT wb.block_type, wb.order_index as block_order, be.order_index as exercise_order,
                COALESCE(ex.name, e.exercise) as exercise, COALESCE(ex.description, e.equipment) as equipment
         FROM workout_blocks wb
         JOIN block_exercises be ON wb.id = be.block_id
         LEFT JOIN exercises ex ON be.exercise_id = ex.id
         LEFT JOIN exercise e ON be.exercise_id = e.id
         WHERE wb.workout_id = $1
         ORDER BY wb.order_index, be.order_index`
    : `SELECT wb.block_type, wb.order_index as block_order, be.order_index as exercise_order,
                COALESCE(ex.name, e.exercise) as exercise, COALESCE(ex.description, e.equipment) as equipment
         FROM workout_blocks wb
         JOIN block_exercises be ON wb.id = be.block_id
         LEFT JOIN exercises ex ON be.exercise_id = ex.id
         LEFT JOIN exercise e ON be.exercise_id = e.id
         WHERE wb.workout_id = ?
         ORDER BY wb.order_index, be.order_index`;
  
  const exercisesResult = await db.query(exercisesQuery, [workoutId]);
  const exercises = exercisesResult.rows || exercisesResult;
  
  const seenExercises = new Map(); // Map normalized name -> first occurrence
  const duplicates = [];
  
  for (const ex of exercises) {
    const normalized = normalizeExerciseName(ex.exercise);
    const label = `${ex.exercise} (${ex.equipment})`;
    
    if (seenExercises.has(normalized)) {
      const firstOccurrence = seenExercises.get(normalized);
      duplicates.push({
        normalized,
        first: firstOccurrence,
        duplicate: {
          block: ex.block_type,
          exercise: label,
          blockOrder: ex.block_order,
          exerciseOrder: ex.exercise_order
        }
      });
    } else {
      seenExercises.set(normalized, {
        block: ex.block_type,
        exercise: label,
        blockOrder: ex.block_order,
        exerciseOrder: ex.exercise_order
      });
    }
  }
  
  return {
    valid: duplicates.length === 0,
    workout: workout.name,
    duplicates,
    totalExercises: exercises.length,
    uniqueExercises: seenExercises.size
  };
}

/**
 * Validate all Phase One workouts
 */
async function validateAllPhaseOneWorkouts() {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  try {
    const workoutsQuery = db.isPostgres
      ? `SELECT w.id, w.name FROM workout w
         JOIN workout_types wt ON w.workout_type_id = wt.id
         WHERE wt.code = 'STRENGTH' AND w.phase = 'Phase One' AND w.is_active = 1
         ORDER BY w.id`
      : `SELECT w.id, w.name FROM workout w
         JOIN workout_types wt ON w.workout_type_id = wt.id
         WHERE wt.code = 'STRENGTH' AND w.phase = 'Phase One' AND w.is_active = 1
         ORDER BY w.id`;
    
    const workoutsResult = await db.query(workoutsQuery);
    const workouts = workoutsResult.rows || workoutsResult;
    
    console.log(`Validating ${workouts.length} Phase One workouts...\n`);
    
    let totalDuplicates = 0;
    for (const workout of workouts) {
      const result = await validateWorkout(db, workout.id);
      if (!result.valid) {
        console.log(`❌ ${workout.name} (ID: ${workout.id})`);
        console.log(`   Found ${result.duplicates.length} duplicate(s):`);
        result.duplicates.forEach(dup => {
          console.log(`   - "${dup.normalized}" appears in:`);
          console.log(`     • ${dup.first.block}: ${dup.first.exercise}`);
          console.log(`     • ${dup.duplicate.block}: ${dup.duplicate.exercise}`);
        });
        console.log('');
        totalDuplicates += result.duplicates.length;
      } else {
        console.log(`✅ ${workout.name} (ID: ${workout.id}) - ${result.uniqueExercises} unique exercises`);
      }
    }
    
    console.log(`\nSummary: ${totalDuplicates} duplicate(s) found across all workouts`);
    
  } finally {
    if (db.isPostgres) {
      await dbConnection.end();
    } else {
      dbConnection.close();
    }
  }
}

if (require.main === module) {
  validateAllPhaseOneWorkouts()
    .then(() => process.exit(0))
    .catch(error => {
      console.error('Error:', error);
      process.exit(1);
    });
}

module.exports = { validateWorkout, validateAllPhaseOneWorkouts };




















