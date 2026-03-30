// Script to deduplicate Phase One strength workouts
// Removes duplicate exercises (same base name, different equipment) from Phase One workouts
const { initDatabase, Database } = require('../database');
const { normalizeExerciseName } = require('../utils/workoutUtils');
const path = require('path');

/**
 * Get all exercises from the exercise table that match a functional movement pattern
 * Note: We use the exercise table (singular) since that's where the data is
 * @param {Database} db - Database instance
 * @param {string} functionalMovementPattern - Pattern to match (e.g., "Squat", "Hinge", "Push")
 * @param {string} planeOfMotion - Plane to match (e.g., "Sagittal", "Frontal")
 * @param {Set<string>} excludeNormalized - Set of normalized exercise names to exclude
 * @returns {Promise<Array>} - Array of exercise objects with id from exercise table
 */
async function findReplacementExercises(db, functionalMovementPattern, planeOfMotion, excludeNormalized) {
  let query;
  const params = [];
  
  if (db.isPostgres) {
    query = `
      SELECT id, exercise, equipment, functional_movement_pattern, plane_of_motion
      FROM exercise
      WHERE functional_movement_pattern LIKE $1
        AND plane_of_motion LIKE $2
      ORDER BY exercise, equipment
    `;
    params.push(`%${functionalMovementPattern}%`, `%${planeOfMotion}%`);
  } else {
    query = `
      SELECT id, exercise, equipment, functional_movement_pattern, plane_of_motion
      FROM exercise
      WHERE functional_movement_pattern LIKE ?
        AND plane_of_motion LIKE ?
      ORDER BY exercise, equipment
    `;
    params.push(`%${functionalMovementPattern}%`, `%${planeOfMotion}%`);
  }
  
  const result = await db.query(query, params);
  const exercises = result.rows || result;
  
  // Filter out exercises that are already in the workout
  return exercises.filter(ex => {
    const normalized = normalizeExerciseName(ex.exercise);
    return !excludeNormalized.has(normalized);
  });
}

/**
 * Get functional movement pattern hints from workout focus
 * @param {string} focus - Primary or secondary focus (e.g., "Quads", "Chest/Shoulders")
 * @param {string} blockType - Block type (warmup, primary, secondary)
 * @returns {Object} - Object with functionalMovementPattern and planeOfMotion hints
 */
function getMovementPatternHints(focus, blockType) {
  const focusLower = (focus || '').toLowerCase();
  
  // Warmup can be any movement pattern
  if (blockType === 'warmup') {
    return { functionalMovementPattern: null, planeOfMotion: null };
  }
  
  // Primary focus patterns
  if (focusLower.includes('quad') || focusLower.includes('leg')) {
    return { functionalMovementPattern: 'Squat', planeOfMotion: 'Sagittal' };
  }
  if (focusLower.includes('glute') || focusLower.includes('hamstring')) {
    return { functionalMovementPattern: 'Hinge', planeOfMotion: 'Sagittal' };
  }
  if (focusLower.includes('chest') || focusLower.includes('shoulder') || focusLower.includes('push')) {
    return { functionalMovementPattern: 'Push', planeOfMotion: 'Sagittal' };
  }
  if (focusLower.includes('back') || focusLower.includes('pull')) {
    return { functionalMovementPattern: 'Pull', planeOfMotion: 'Sagittal' };
  }
  
  // Secondary focus patterns (more flexible)
  if (blockType === 'secondary') {
    if (focusLower.includes('chest') || focusLower.includes('shoulder')) {
      return { functionalMovementPattern: 'Push', planeOfMotion: 'Sagittal' };
    }
    if (focusLower.includes('back')) {
      return { functionalMovementPattern: 'Pull', planeOfMotion: 'Sagittal' };
    }
  }
  
  return { functionalMovementPattern: null, planeOfMotion: null };
}

/**
 * Deduplicate a single Phase One workout
 * @param {Database} db - Database instance
 * @param {Object} workout - Workout object with id, name, phase, primary_focus, secondary_focus
 * @returns {Promise<Object>} - Object with stats about what was changed
 */
async function deduplicateWorkout(db, workout) {
  console.log(`\nProcessing workout: ${workout.name} (ID: ${workout.id})`);
  
  // Get all blocks for this workout, ordered by order_index
  const blocksQuery = db.isPostgres
    ? `SELECT id, block_type, title, order_index FROM workout_blocks WHERE workout_id = $1 ORDER BY order_index`
    : `SELECT id, block_type, title, order_index FROM workout_blocks WHERE workout_id = ? ORDER BY order_index`;
  
  const blocksResult = await db.query(blocksQuery, [workout.id]);
  const blocks = blocksResult.rows || blocksResult;
  
  const seenExercises = new Set();
  const duplicatesToReplace = [];
  const stats = {
    workoutId: workout.id,
    workoutName: workout.name,
    duplicatesFound: 0,
    duplicatesReplaced: 0,
    duplicatesSkipped: 0
  };
  
  // Process blocks in order: warmup, primary, secondary
  for (const block of blocks) {
    // Get all exercises for this block
    // Note: block_exercises references exercises.id, but data is in exercise table
    // Use COALESCE to handle both tables
    const exercisesQuery = db.isPostgres
      ? `SELECT be.id, be.order_index, be.exercise_id, 
                COALESCE(ex.name, e.exercise) as exercise,
                COALESCE(ex.description, e.equipment) as equipment,
                e.functional_movement_pattern, e.plane_of_motion
         FROM block_exercises be
         LEFT JOIN exercises ex ON be.exercise_id = ex.id
         LEFT JOIN exercise e ON be.exercise_id = e.id
         WHERE be.block_id = $1
         ORDER BY be.order_index`
      : `SELECT be.id, be.order_index, be.exercise_id,
                COALESCE(ex.name, e.exercise) as exercise,
                COALESCE(ex.description, e.equipment) as equipment,
                e.functional_movement_pattern, e.plane_of_motion
         FROM block_exercises be
         LEFT JOIN exercises ex ON be.exercise_id = ex.id
         LEFT JOIN exercise e ON be.exercise_id = e.id
         WHERE be.block_id = ?
         ORDER BY be.order_index`;
    
    const exercisesResult = await db.query(exercisesQuery, [block.id]);
    const exercises = exercisesResult.rows || exercisesResult;
    
    // Determine focus for this block
    const focus = block.block_type === 'primary' ? workout.primary_focus : 
                  block.block_type === 'secondary' ? workout.secondary_focus : null;
    const hints = getMovementPatternHints(focus, block.block_type);
    
    for (const exercise of exercises) {
      const exerciseLabel = `${exercise.exercise} (${exercise.equipment})`;
      const normalized = normalizeExerciseName(exercise.exercise);
      
      if (seenExercises.has(normalized)) {
        // This is a duplicate
        stats.duplicatesFound++;
        console.log(`  ⚠️  Duplicate found: ${exerciseLabel} (normalized: ${normalized})`);
        
        // Try to find a replacement
        let replacement = null;
        
        if (hints.functionalMovementPattern) {
          const candidates = await findReplacementExercises(
            db,
            hints.functionalMovementPattern,
            hints.planeOfMotion || 'Sagittal',
            seenExercises
          );
          
          if (candidates.length > 0) {
            replacement = candidates[0];
            console.log(`  ✅ Found replacement: ${replacement.exercise} (${replacement.equipment})`);
          }
        }
        
        // If no replacement found with hints, try broader search
        if (!replacement && exercise.functional_movement_pattern) {
          const candidates = await findReplacementExercises(
            db,
            exercise.functional_movement_pattern,
            exercise.plane_of_motion || 'Sagittal',
            seenExercises
          );
          
          if (candidates.length > 0) {
            replacement = candidates[0];
            console.log(`  ✅ Found replacement (broader search): ${replacement.exercise} (${replacement.equipment})`);
          }
        }
        
        if (replacement) {
          // Update the block_exercises record to point to the replacement exercise
          const updateQuery = db.isPostgres
            ? `UPDATE block_exercises SET exercise_id = $1 WHERE id = $2`
            : `UPDATE block_exercises SET exercise_id = ? WHERE id = ?`;
          
          await db.query(updateQuery, [replacement.id, exercise.id]);
          stats.duplicatesReplaced++;
          
          // Add replacement to seen exercises
          seenExercises.add(normalizeExerciseName(replacement.exercise));
        } else {
          console.log(`  ⚠️  No suitable replacement found for ${exerciseLabel}`);
          stats.duplicatesSkipped++;
          // Still add to seen to prevent further duplicates of this type
          seenExercises.add(normalized);
        }
      } else {
        // Not a duplicate, add to seen
        seenExercises.add(normalized);
      }
    }
  }
  
  return stats;
}

/**
 * Main function to deduplicate all Phase One strength workouts
 */
async function main() {
  console.log('════════════════════════════════════════════════');
  console.log('🔍 Phase One Strength Workout Deduplication');
  console.log('════════════════════════════════════════════════');
  console.log('');
  
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  // Disable foreign key checks for SQLite (they're already off by default, but ensure)
  if (!db.isPostgres) {
    await db.query('PRAGMA foreign_keys = OFF');
  }
  
  try {
    // Get all Phase One strength workouts
    const workoutsQuery = db.isPostgres
      ? `SELECT w.id, w.name, w.phase, w.primary_focus, w.secondary_focus
         FROM workout w
         JOIN workout_types wt ON w.workout_type_id = wt.id
         WHERE wt.code = 'STRENGTH' AND w.phase = 'Phase One' AND w.is_active = 1
         ORDER BY w.id`
      : `SELECT w.id, w.name, w.phase, w.primary_focus, w.secondary_focus
         FROM workout w
         JOIN workout_types wt ON w.workout_type_id = wt.id
         WHERE wt.code = 'STRENGTH' AND w.phase = 'Phase One' AND w.is_active = 1
         ORDER BY w.id`;
    
    const workoutsResult = await db.query(workoutsQuery);
    const workouts = workoutsResult.rows || workoutsResult;
    
    console.log(`Found ${workouts.length} Phase One strength workouts to process\n`);
    
    if (workouts.length === 0) {
      console.log('No Phase One workouts found. Exiting.');
      return;
    }
    
    const allStats = [];
    
    // Process each workout
    for (const workout of workouts) {
      const stats = await deduplicateWorkout(db, workout);
      allStats.push(stats);
    }
    
    // Print summary
    console.log('\n════════════════════════════════════════════════');
    console.log('📊 Summary');
    console.log('════════════════════════════════════════════════');
    console.log('');
    
    const totalDuplicates = allStats.reduce((sum, s) => sum + s.duplicatesFound, 0);
    const totalReplaced = allStats.reduce((sum, s) => sum + s.duplicatesReplaced, 0);
    const totalSkipped = allStats.reduce((sum, s) => sum + s.duplicatesSkipped, 0);
    
    console.log(`Total workouts processed: ${workouts.length}`);
    console.log(`Total duplicates found: ${totalDuplicates}`);
    console.log(`Total duplicates replaced: ${totalReplaced}`);
    console.log(`Total duplicates skipped (no replacement): ${totalSkipped}`);
    console.log('');
    
    if (totalSkipped > 0) {
      console.log('⚠️  Workouts with duplicates that could not be replaced:');
      allStats
        .filter(s => s.duplicatesSkipped > 0)
        .forEach(s => {
          console.log(`  - ${s.workoutName} (${s.duplicatesSkipped} skipped)`);
        });
      console.log('');
    }
    
    console.log('✅ Deduplication complete!');
    
  } catch (error) {
    console.error('❌ Error during deduplication:', error);
    throw error;
  } finally {
    // Re-enable foreign keys for SQLite
    if (!db.isPostgres) {
      await db.query('PRAGMA foreign_keys = ON');
    }
    
    if (db.isPostgres) {
      await dbConnection.end();
    } else {
      dbConnection.close();
    }
  }
}

// Run if called directly
if (require.main === module) {
  main()
    .then(() => {
      console.log('');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { normalizeExerciseName, deduplicateWorkout, main };

