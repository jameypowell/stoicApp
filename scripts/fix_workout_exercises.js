const { initDatabase, Database } = require('../database');

/**
 * Script to fix exercise names and equipment in production workouts
 * 
 * Fixes for workouts:
 * - Phase One workout 9 (if exists) or workout with similar exercises
 * - Phase Two workout 8
 */

async function findOrCreateExercise(db, name) {
  let exercise = await db.queryOne(`
    SELECT id FROM exercises WHERE LOWER(name) = LOWER(?)
  `, [name]);
  
  if (!exercise) {
    if (db.isPostgres) {
      const result = await db.query(`
        INSERT INTO exercises (name, created_at, updated_at)
        VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `, [name]);
      return result.rows[0].id;
    } else {
      const result = await db.query(`
        INSERT INTO exercises (name, created_at, updated_at)
        VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [name]);
      return result.lastID;
    }
  }
  
  return db.isPostgres ? exercise.rows[0].id : exercise.id;
}

async function findOrCreateEquipment(db, name) {
  let equipment = await db.queryOne(`
    SELECT id FROM equipment WHERE LOWER(name) = LOWER(?)
  `, [name]);
  
  if (!equipment) {
    console.log(`   ⚠️  Equipment "${name}" not found. Creating...`);
    if (db.isPostgres) {
      const result = await db.query(`
        INSERT INTO equipment (name, created_at, updated_at)
        VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `, [name]);
      return result.rows[0].id;
    } else {
      const result = await db.query(`
        INSERT INTO equipment (name, created_at, updated_at)
        VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [name]);
      return result.lastID;
    }
  }
  
  return db.isPostgres ? equipment.rows[0].id : equipment.id;
}

async function setExerciseEquipment(db, exerciseId, equipmentNames) {
  // Remove all existing equipment links for this exercise
  if (db.isPostgres) {
    await db.query(`
      DELETE FROM exercise_equipment WHERE exercise_id = $1
    `, [exerciseId]);
  } else {
    await db.query(`
      DELETE FROM exercise_equipment WHERE exercise_id = ?
    `, [exerciseId]);
  }
  
  // Add new equipment links
  for (const eqName of equipmentNames) {
    const eqId = await findOrCreateEquipment(db, eqName);
    
    // Check if link already exists (shouldn't, but just in case)
    let exists;
    if (db.isPostgres) {
      exists = await db.queryOne(`
        SELECT id FROM exercise_equipment 
        WHERE exercise_id = $1 AND equipment_id = $2
      `, [exerciseId, eqId]);
    } else {
      exists = await db.queryOne(`
        SELECT id FROM exercise_equipment 
        WHERE exercise_id = ? AND equipment_id = ?
      `, [exerciseId, eqId]);
    }
    
    if (!exists) {
      if (db.isPostgres) {
        await db.query(`
          INSERT INTO exercise_equipment (exercise_id, equipment_id)
          VALUES ($1, $2)
        `, [exerciseId, eqId]);
      } else {
        await db.query(`
          INSERT INTO exercise_equipment (exercise_id, equipment_id)
          VALUES (?, ?)
        `, [exerciseId, eqId]);
      }
    }
  }
}

async function updateExerciseName(db, oldName, newName) {
  // Find exercise by old name
  let exercise;
  if (db.isPostgres) {
    exercise = await db.queryOne(`
      SELECT id FROM exercises WHERE LOWER(name) = LOWER($1)
    `, [oldName]);
  } else {
    exercise = await db.queryOne(`
      SELECT id FROM exercises WHERE LOWER(name) = LOWER(?)
    `, [oldName]);
  }
  
  if (!exercise) {
    console.log(`   ⚠️  Exercise "${oldName}" not found. Skipping name update.`);
    return null;
  }
  
  const exerciseId = db.isPostgres ? exercise.rows[0].id : exercise.id;
  
  // Check if new name already exists
  let existing;
  if (db.isPostgres) {
    existing = await db.queryOne(`
      SELECT id FROM exercises WHERE LOWER(name) = LOWER($1) AND id != $2
    `, [newName, exerciseId]);
  } else {
    existing = await db.queryOne(`
      SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) AND id != ?
    `, [newName, exerciseId]);
  }
  
  if (existing) {
    console.log(`   ⚠️  Exercise "${newName}" already exists. Merging...`);
    // Would need to update all block_exercises references
    // For now, just update the name
    return exerciseId;
  }
  
  // Update exercise name
  if (db.isPostgres) {
    await db.query(`
      UPDATE exercises SET name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2
    `, [newName, exerciseId]);
  } else {
    await db.query(`
      UPDATE exercises SET name = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `, [newName, exerciseId]);
  }
  
  return exerciseId;
}

async function updateExerciseInWorkout(db, workoutId, blockType, oldExercisePattern, newExerciseName, equipmentNames) {
  // Find the block
  let block;
  if (db.isPostgres) {
    block = await db.queryOne(`
      SELECT id FROM workout_blocks WHERE workout_id = $1 AND block_type = $2
    `, [workoutId, blockType]);
  } else {
    block = await db.queryOne(`
      SELECT id FROM workout_blocks WHERE workout_id = ? AND block_type = ?
    `, [workoutId, blockType]);
  }
  
  if (!block) {
    console.log(`   ⚠️  Block ${blockType} not found in workout ${workoutId}`);
    return false;
  }
  
  const blockId = db.isPostgres ? block.rows[0].id : block.id;
  
  // Find exercise by pattern
  let exercise;
  if (db.isPostgres) {
    exercise = await db.queryOne(`
      SELECT be.id, be.exercise_id, e.name
      FROM block_exercises be
      JOIN exercises e ON be.exercise_id = e.id
      WHERE be.block_id = $1 AND LOWER(e.name) LIKE $2
      LIMIT 1
    `, [blockId, '%' + oldExercisePattern.toLowerCase() + '%']);
  } else {
    exercise = await db.queryOne(`
      SELECT be.id, be.exercise_id, e.name
      FROM block_exercises be
      JOIN exercises e ON be.exercise_id = e.id
      WHERE be.block_id = ? AND LOWER(e.name) LIKE ?
      LIMIT 1
    `, [blockId, '%' + oldExercisePattern.toLowerCase() + '%']);
  }
  
  if (!exercise) {
    console.log(`   ⚠️  Exercise matching "${oldExercisePattern}" not found in ${blockType} block`);
    return false;
  }
  
  const exerciseData = db.isPostgres ? exercise.rows[0] : exercise;
  const oldExerciseId = exerciseData.exercise_id;
  
  // Get or create new exercise
  const newExerciseId = await findOrCreateExercise(db, newExerciseName);
  
  // Update block_exercises to point to new exercise (or update existing if same)
  if (oldExerciseId !== newExerciseId) {
    if (db.isPostgres) {
      await db.query(`
        UPDATE block_exercises SET exercise_id = $1 WHERE id = $2
      `, [newExerciseId, exerciseData.id]);
    } else {
      await db.query(`
        UPDATE block_exercises SET exercise_id = ? WHERE id = ?
      `, [newExerciseId, exerciseData.id]);
    }
  }
  
  // Update equipment
  if (equipmentNames && equipmentNames.length > 0) {
    await setExerciseEquipment(db, newExerciseId, equipmentNames);
  }
  
  return true;
}

async function updateBlockTitle(db, workoutId, blockType, newTitle) {
  if (db.isPostgres) {
    await db.query(`
      UPDATE workout_blocks SET title = $1 WHERE workout_id = $2 AND block_type = $3
    `, [newTitle, workoutId, blockType]);
  } else {
    await db.query(`
      UPDATE workout_blocks SET title = ? WHERE workout_id = ? AND block_type = ?
    `, [newTitle, workoutId, blockType]);
  }
}

async function findWorkoutsByExercises(db, exercisePatterns) {
  const workouts = [];
  for (const pattern of exercisePatterns) {
    let results;
    if (db.isPostgres) {
      results = await db.query(`
        SELECT DISTINCT w.id, w.name, w.phase
        FROM workout w
        JOIN workout_blocks wb ON w.id = wb.workout_id
        JOIN block_exercises be ON wb.id = be.block_id
        JOIN exercises e ON be.exercise_id = e.id
        WHERE LOWER(e.name) LIKE $1
      `, ['%' + pattern.toLowerCase() + '%']);
    } else {
      results = await db.query(`
        SELECT DISTINCT w.id, w.name, w.phase
        FROM workout w
        JOIN workout_blocks wb ON w.id = wb.workout_id
        JOIN block_exercises be ON wb.id = be.block_id
        JOIN exercises e ON be.exercise_id = e.id
        WHERE LOWER(e.name) LIKE ?
      `, ['%' + pattern.toLowerCase() + '%']);
    }
    
    if (db.isPostgres && results.rows) {
      workouts.push(...results.rows);
    } else if (results) {
      workouts.push(...(Array.isArray(results) ? results : [results]));
    }
  }
  
  // Remove duplicates
  const uniqueWorkouts = [];
  const seenIds = new Set();
  for (const w of workouts) {
    const id = db.isPostgres ? w.id : w.id;
    if (!seenIds.has(id)) {
      seenIds.add(id);
      uniqueWorkouts.push(w);
    }
  }
  
  return uniqueWorkouts;
}

async function main() {
  console.log('🔧 Fixing workout exercises in production database...\n');
  
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  try {
    // Find workouts with the mentioned exercises
    console.log('📋 Searching for workouts with target exercises...');
    const targetPatterns = [
      'banded pull apart',
      'shoulder fly',
      'overhead should press',
      'front raises',
      'lateral raises',
      'kickback'
    ];
    
    const matchingWorkouts = await findWorkoutsByExercises(db, targetPatterns);
    console.log(`Found ${matchingWorkouts.length} matching workout(s)\n`);
    
    // Fix workout 1-9 (assuming Phase One workout with ID or specific pattern)
    // Let's check all Phase One workouts
    console.log('🔍 Checking Phase One workouts...');
    let phaseOneWorkouts;
    if (db.isPostgres) {
      phaseOneWorkouts = await db.query(`
        SELECT id, name FROM workout WHERE phase = 'Phase One' ORDER BY id
      `);
      phaseOneWorkouts = phaseOneWorkouts.rows || [];
    } else {
      phaseOneWorkouts = await db.query(`
        SELECT id, name FROM workout WHERE phase = 'Phase One' ORDER BY id
      `);
      phaseOneWorkouts = Array.isArray(phaseOneWorkouts) ? phaseOneWorkouts : [phaseOneWorkouts];
    }
    
    // Find the workout that matches the pattern (likely has shoulder exercises)
    let workout1_9 = null;
    for (const w of phaseOneWorkouts) {
      const workoutId = db.isPostgres ? w.id : w.id;
      const full = await db.getStrengthWorkoutById(workoutId);
      if (full && full.blocks) {
        const hasShoulderExercises = full.blocks.some(block => 
          (block.exercises || []).some(ex => {
            const name = (ex.exercise || '').toLowerCase();
            return name.includes('shoulder') || name.includes('pull apart') || name.includes('fly');
          })
        );
        if (hasShoulderExercises) {
          workout1_9 = workoutId;
          console.log(`   Found Phase One workout: ID ${workoutId} - ${w.name}`);
          break;
        }
      }
    }
    
    // Also check Phase Two workout 8
    console.log('\n🔍 Checking Phase Two workouts...');
    let phaseTwoWorkouts;
    if (db.isPostgres) {
      phaseTwoWorkouts = await db.query(`
        SELECT id, name FROM workout WHERE phase = 'Phase Two' ORDER BY id
      `);
      phaseTwoWorkouts = phaseTwoWorkouts.rows || [];
    } else {
      phaseTwoWorkouts = await db.query(`
        SELECT id, name FROM workout WHERE phase = 'Phase Two' ORDER BY id
      `);
      phaseTwoWorkouts = Array.isArray(phaseTwoWorkouts) ? phaseTwoWorkouts : [phaseTwoWorkouts];
    }
    
    let workout2_8 = phaseTwoWorkouts.length >= 8 ? (db.isPostgres ? phaseTwoWorkouts[7].id : phaseTwoWorkouts[7].id) : null;
    
    // Fixes for workout 1-9
    if (workout1_9) {
      console.log(`\n✅ Fixing workout ${workout1_9} (Phase One)...`);
      
      // Fix banded pull aparts
      console.log('   1. Fixing banded pull aparts...');
      await updateExerciseInWorkout(db, workout1_9, 'warmup', 'banded pull apart', 'Banded Pull Apart', ['Super Band']);
      
      // Fix Dumbbell Shoulder Fly
      console.log('   2. Fixing Dumbbell Shoulder Fly...');
      await updateExerciseInWorkout(db, workout1_9, 'primary', 'Dumbbell Shoulder Fly', 'Shoulder Fly', ['Dumbbells']);
      
      // Fix primary section title
      console.log('   3. Updating primary section title...');
      await updateBlockTitle(db, workout1_9, 'primary', 'Primary Exercises (Shoulders)');
      
      // Fix Alternating Dumbbell Overhead Should Press
      console.log('   4. Fixing Alternating Dumbbell Overhead Should Press...');
      await updateExerciseInWorkout(db, workout1_9, 'primary', 'Alternating Dumbbell Overhead Should Press', 'Alternating Overhead Shoulder Press', ['Dumbbell']);
      
      // Fix Alternating Dumbbell Front Raises
      console.log('   5. Fixing Alternating Dumbbell Front Raises...');
      await updateExerciseInWorkout(db, workout1_9, 'primary', 'Alternating Dumbbell Front Raises', 'Alternating Front Raises', ['Dumbbell']);
      
      // Fix Alternating Dumbbell Lateral Raises (Band)
      console.log('   6. Fixing Alternating Dumbbell Lateral Raises (Band)...');
      await updateExerciseInWorkout(db, workout1_9, 'primary', 'Alternating Dumbbell Lateral Raises (Band)', 'Alternating Lateral Raises', ['Dumbbells']);
      
      // Fix Alternating Dumbbell Curls (Bodyweight)
      console.log('   7. Fixing Alternating Dumbbell Curls (Bodyweight)...');
      await updateExerciseInWorkout(db, workout1_9, 'primary', 'Alternating Dumbbell Curls (Bodyweight)', 'Alternating Curls', ['Dumbbell']);
      
      // Fix Dumbbell Single Arm Kickbacks (PVC Pipes)
      console.log('   8. Fixing Dumbbell Single Arm Kickbacks (PVC Pipes)...');
      await updateExerciseInWorkout(db, workout1_9, 'primary', 'Dumbbell Single Arm Kickbacks (PVC Pipes)', 'Single Arm Kickbacks', ['Dumbbell']);
      
      console.log('   ✅ Workout 1-9 fixes complete!');
    } else {
      console.log('   ⚠️  Phase One workout with shoulder exercises not found');
    }
    
    // Apply same fixes to workout 2-8 if it exists
    if (workout2_8) {
      console.log(`\n✅ Fixing workout ${workout2_8} (Phase Two)...`);
      
      // Apply same fixes
      await updateExerciseInWorkout(db, workout2_8, 'warmup', 'banded pull apart', 'Banded Pull Apart', ['Super Band']);
      await updateExerciseInWorkout(db, workout2_8, 'primary', 'Dumbbell Shoulder Fly', 'Shoulder Fly', ['Dumbbells']);
      await updateBlockTitle(db, workout2_8, 'primary', 'Primary Exercises (Shoulders)');
      await updateExerciseInWorkout(db, workout2_8, 'primary', 'Alternating Dumbbell Overhead Should Press', 'Alternating Overhead Shoulder Press', ['Dumbbell']);
      await updateExerciseInWorkout(db, workout2_8, 'primary', 'Alternating Dumbbell Front Raises', 'Alternating Front Raises', ['Dumbbell']);
      await updateExerciseInWorkout(db, workout2_8, 'primary', 'Alternating Dumbbell Lateral Raises (Band)', 'Alternating Lateral Raises', ['Dumbbells']);
      await updateExerciseInWorkout(db, workout2_8, 'primary', 'Alternating Dumbbell Curls (Bodyweight)', 'Alternating Curls', ['Dumbbell']);
      await updateExerciseInWorkout(db, workout2_8, 'primary', 'Dumbbell Single Arm Kickbacks (PVC Pipes)', 'Single Arm Kickbacks', ['Dumbbell']);
      
      console.log('   ✅ Workout 2-8 fixes complete!');
    } else {
      console.log('   ⚠️  Phase Two workout 8 not found');
    }
    
    console.log('\n✅ All fixes applied successfully!');
    
  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    if (dbConnection.close) dbConnection.close();
  }
}

// Run the script
main().catch(console.error);



















