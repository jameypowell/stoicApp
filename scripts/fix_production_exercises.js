// Fix exercise names and equipment in production database
const { initDatabase, Database } = require('../database');

async function findOrCreateExercise(db, name) {
  let exercise;
  if (db.isPostgres) {
    exercise = await db.queryOne(`
      SELECT id FROM exercises WHERE LOWER(name) = LOWER($1)
    `, [name]);
  } else {
    exercise = await db.queryOne(`
      SELECT id FROM exercises WHERE LOWER(name) = LOWER(?)
    `, [name]);
  }
  
  if (!exercise) {
    if (db.isPostgres) {
      const result = await db.query(`
        INSERT INTO exercises (name, created_at, updated_at)
        VALUES ($1, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
        RETURNING id
      `, [name]);
      // Handle both {rows: [...]} and direct result formats
      if (result.rows && result.rows.length > 0) {
        return result.rows[0].id;
      } else if (result.id) {
        return result.id;
      }
      return null;
    } else {
      const result = await db.query(`
        INSERT INTO exercises (name, created_at, updated_at)
        VALUES (?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      `, [name]);
      return result.lastID;
    }
  }
  
  // Handle both {rows: [...]} and direct result formats
  if (db.isPostgres) {
    return exercise.rows ? exercise.rows[0].id : exercise.id;
  } else {
    return exercise.id;
  }
}

async function findEquipment(db, name) {
  let equipment;
  if (db.isPostgres) {
    equipment = await db.queryOne(`
      SELECT id FROM equipment WHERE LOWER(name) = LOWER($1)
    `, [name]);
  } else {
    equipment = await db.queryOne(`
      SELECT id FROM equipment WHERE LOWER(name) = LOWER(?)
    `, [name]);
  }
  
  if (!equipment) {
    console.log(`   ⚠️  Equipment "${name}" not found`);
    return null;
  }
  
  // Handle both {rows: [...]} and direct result formats
  if (db.isPostgres) {
    return equipment.rows ? equipment.rows[0].id : equipment.id;
  } else {
    return equipment.id;
  }
}

async function setExerciseEquipment(db, exerciseId, equipmentNames) {
  // Remove all existing equipment links
  if (db.isPostgres) {
    await db.query(`DELETE FROM exercise_equipment WHERE exercise_id = $1`, [exerciseId]);
  } else {
    await db.query(`DELETE FROM exercise_equipment WHERE exercise_id = ?`, [exerciseId]);
  }
  
  // Add new equipment links
  for (const eqName of equipmentNames) {
    const eqId = await findEquipment(db, eqName);
    if (!eqId) {
      console.log(`   ⚠️  Skipping equipment "${eqName}" - not found`);
      continue;
    }
    
    // Check if link exists
    let exists;
    if (db.isPostgres) {
      exists = await db.queryOne(`
        SELECT id FROM exercise_equipment 
        WHERE exercise_id = $1 AND equipment_id = $2
      `, [exerciseId, eqId]);
      // Handle both {rows: [...]} and direct result formats
      exists = exists ? (exists.rows ? exists.rows[0] : exists) : null;
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
          ON CONFLICT (exercise_id, equipment_id) DO NOTHING
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

async function updateExerciseInWorkout(db, workoutId, blockType, searchPattern, newName, equipmentNames) {
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
    return false;
  }
  
  // Handle both {rows: [...]} and direct result formats
  const blockId = db.isPostgres ? (block.rows ? block.rows[0].id : block.id) : block.id;
  
  // Find exercise by pattern (case-insensitive partial match)
  let exercise;
  if (db.isPostgres) {
    exercise = await db.queryOne(`
      SELECT be.id, be.exercise_id, e.name
      FROM block_exercises be
      JOIN exercises e ON be.exercise_id = e.id
      WHERE be.block_id = $1 AND LOWER(e.name) LIKE $2
      LIMIT 1
    `, [blockId, '%' + searchPattern.toLowerCase() + '%']);
  } else {
    exercise = await db.queryOne(`
      SELECT be.id, be.exercise_id, e.name
      FROM block_exercises be
      JOIN exercises e ON be.exercise_id = e.id
      WHERE be.block_id = ? AND LOWER(e.name) LIKE ?
      LIMIT 1
    `, [blockId, '%' + searchPattern.toLowerCase() + '%']);
  }
  
  if (!exercise) {
    return false;
  }
  
  // Handle both {rows: [...]} and direct result formats
  const exerciseData = db.isPostgres ? (exercise.rows ? exercise.rows[0] : exercise) : exercise;
  const oldExerciseId = exerciseData.exercise_id;
  const oldName = exerciseData.name;
  
  // Get or create new exercise
  const newExerciseId = await findOrCreateExercise(db, newName);
  
  // Update block_exercises if exercise changed
          if (oldExerciseId !== newExerciseId) {
            const exerciseRowId = exerciseData.id;
            if (db.isPostgres) {
              await db.query(`
                UPDATE block_exercises SET exercise_id = $1 WHERE id = $2
              `, [newExerciseId, exerciseRowId]);
            } else {
              await db.query(`
                UPDATE block_exercises SET exercise_id = ? WHERE id = ?
              `, [newExerciseId, exerciseRowId]);
            }
          }
  
  // Update equipment
  if (equipmentNames && equipmentNames.length > 0) {
    await setExerciseEquipment(db, newExerciseId, equipmentNames);
  }
  
  return { updated: true, oldName, newName };
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

async function fixWorkout(db, workoutId, phase, workoutNumber) {
  console.log(`\n🔧 Fixing ${phase} workout ${workoutNumber} (ID: ${workoutId})...`);
  
  const fixes = [
    // Fix banded pull aparts in warmup
    { blockType: 'warmup', search: 'banded pull apart', newName: 'Banded Pull Apart', equipment: ['Monster/Super Band'] },
    // Fix shoulder exercises in warmup and primary
    { blockType: 'warmup', search: 'Dumbbell Shoulder Fly', newName: 'Shoulder Fly', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Dumbbell Shoulder Fly', newName: 'Shoulder Fly', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Shoulder Fly', newName: 'Shoulder Fly', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Alternating Dumbbell Overhead Should Press', newName: 'Alternating Overhead Shoulder Press', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Alternating Dumbbell Front Raises', newName: 'Alternating Front Raises', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Alternating Dumbbell Lateral Raises (Band)', newName: 'Alternating Lateral Raises', equipment: ['Dumbbells'] },
            { blockType: 'primary', search: 'Alternating Dumbbell Lateral Raises', newName: 'Alternating Lateral Raises', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Alternating Dumbbell Curls (Bodyweight)', newName: 'Alternating Curls', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Alternating Dumbbell Curls', newName: 'Alternating Curls', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Dumbbell Single Arm Kickbacks (PVC Pipes)', newName: 'Single Arm Kickbacks', equipment: ['Dumbbell'] },
    { blockType: 'primary', search: 'Dumbbell Single Arm Kickbacks', newName: 'Single Arm Kickbacks', equipment: ['Dumbbell'] },
    // Fix exercises in secondary blocks
    { blockType: 'secondary', search: 'Alternating Dumbbell Curls', newName: 'Alternating Curls', equipment: ['Dumbbell'] },
    { blockType: 'secondary', search: 'Dumbbell Single Arm Kickbacks', newName: 'Single Arm Kickbacks', equipment: ['Dumbbell'] },
  ];
  
  let fixCount = 0;
  
  // Apply exercise fixes
  for (const fix of fixes) {
    const result = await updateExerciseInWorkout(
      db, 
      workoutId, 
      fix.blockType, 
      fix.search, 
      fix.newName, 
      fix.equipment
    );
    
    if (result && result.updated) {
      console.log(`   ✅ ${result.oldName} → ${result.newName}${fix.equipment ? ' (' + fix.equipment.join(', ') + ')' : ''}`);
      fixCount++;
    }
  }
  
  // Update primary block title if it's a shoulder-focused workout
  // Check if workout has shoulder exercises in primary block
  let block;
  if (db.isPostgres) {
    block = await db.queryOne(`
      SELECT id FROM workout_blocks WHERE workout_id = $1 AND block_type = 'primary'
    `, [workoutId]);
  } else {
    block = await db.queryOne(`
      SELECT id FROM workout_blocks WHERE workout_id = ? AND block_type = 'primary'
    `, [workoutId]);
  }
  
  if (block) {
    await updateBlockTitle(db, workoutId, 'primary', 'Primary Exercises (Shoulders)');
    console.log(`   ✅ Updated primary block title to "Primary Exercises (Shoulders)"`);
    fixCount++;
  }
  
  console.log(`   ✅ Applied ${fixCount} fixes to workout ${workoutId}`);
  
  return fixCount;
}

async function findWorkoutById(db, workoutId) {
  let workout;
  if (db.isPostgres) {
    workout = await db.queryOne(`
      SELECT id, name, phase FROM workout WHERE id = $1
    `, [workoutId]);
    if (!workout) return null;
    // Handle both {rows: [...]} and direct result formats
    if (workout.rows && workout.rows.length > 0) {
      return workout.rows[0];
    } else if (workout.id) {
      return workout;
    }
    return null;
  } else {
    workout = await db.queryOne(`
      SELECT id, name, phase FROM workout WHERE id = ?
    `, [workoutId]);
    return workout;
  }
}

async function findWorkoutsByPhase(db, phase) {
  let workouts;
  if (db.isPostgres) {
    workouts = await db.query(`
      SELECT id, name, phase FROM workout WHERE phase = $1 ORDER BY id
    `, [phase]);
    return workouts.rows || [];
  } else {
    workouts = await db.query(`
      SELECT id, name, phase FROM workout WHERE phase = ? ORDER BY id
    `, [phase]);
    return Array.isArray(workouts) ? workouts : [workouts];
  }
}

async function main() {
  console.log('🔧 Fixing workout exercises in production database...\n');
  
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  if (!db.isPostgres) {
    console.log('⚠️  This script is designed for PostgreSQL production database.');
    console.log('   Set DB_HOST environment variable to connect to production.');
    if (dbConnection.close) dbConnection.close();
    return;
  }
  
  try {
    // Find all workouts that need fixing (search by problematic exercise patterns)
    console.log('🔍 Finding workouts that need fixes...\n');
    
    const problematicPatterns = [
      { pattern: 'banded pull apart', phase: null },
      { pattern: 'Dumbbell Shoulder Fly', phase: null },
      { pattern: 'Alternating Dumbbell Overhead Should Press', phase: null },
      { pattern: 'Alternating Dumbbell Front Raises', phase: null },
      { pattern: 'Alternating Dumbbell Lateral Raises', phase: null },
      { pattern: 'Alternating Dumbbell Curls', phase: null },
      { pattern: 'Dumbbell Single Arm Kickbacks', phase: null }
    ];
    
    const workoutsToFix = new Set();
    
    for (const { pattern } of problematicPatterns) {
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
        results = results.rows || [];
      } else {
        results = await db.query(`
          SELECT DISTINCT w.id, w.name, w.phase
          FROM workout w
          JOIN workout_blocks wb ON w.id = wb.workout_id
          JOIN block_exercises be ON wb.id = be.block_id
          JOIN exercises e ON be.exercise_id = e.id
          WHERE LOWER(e.name) LIKE ?
        `, ['%' + pattern.toLowerCase() + '%']);
        results = Array.isArray(results) ? results : [results];
      }
      
      for (const row of results) {
        const workoutId = db.isPostgres ? row.id : row.id;
        workoutsToFix.add(JSON.stringify({ id: workoutId, name: row.name, phase: row.phase }));
      }
    }
    
    const workoutList = Array.from(workoutsToFix).map(w => JSON.parse(w));
    console.log(`   Found ${workoutList.length} workout(s) that need fixes:\n`);
    workoutList.forEach(w => {
      console.log(`   - ID ${w.id}: ${w.name} (${w.phase})`);
    });
    
    // Also check specific workout IDs mentioned (1-9 and 2-8)
    const workout1_9 = await findWorkoutById(db, 9);
    const workout2_8 = await findWorkoutById(db, 8);
    
    if (workout1_9 && !workoutList.find(w => w.id === 9)) {
      workoutList.push({ id: 9, name: workout1_9.name, phase: workout1_9.phase });
      console.log(`   - Adding workout ID 9: ${workout1_9.name} (${workout1_9.phase})`);
    }
    
    if (workout2_8 && !workoutList.find(w => w.id === 8)) {
      workoutList.push({ id: 8, name: workout2_8.name, phase: workout2_8.phase });
      console.log(`   - Adding workout ID 8: ${workout2_8.name} (${workout2_8.phase})`);
    }
    
    let totalFixes = 0;
    
    // Fix all workouts that need fixing
    for (const workout of workoutList) {
      const fixes = await fixWorkout(db, workout.id, workout.phase, `${workout.phase} ID ${workout.id}`);
      totalFixes += fixes;
    }
    
    console.log(`\n✅ All fixes complete! Applied ${totalFixes} total fixes.`);
    
  } catch (error) {
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

// Run the script
if (require.main === module) {
  main()
    .then(() => {
      console.log('\nScript completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\nScript failed:', error);
      process.exit(1);
    });
}

module.exports = { main };

