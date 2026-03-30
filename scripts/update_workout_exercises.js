// Update specific exercises in production workouts as requested
const { initDatabase, Database } = require('../database');

async function updateWorkoutExercises() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Updating Workout Exercises');
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
    // Helper function to find exercise ID by name and equipment
    async function findExerciseId(exerciseName, equipmentName) {
      // First try with exact name match
      let result = await db.query(`
        SELECT e.id
        FROM exercises e
        WHERE LOWER(e.name) = LOWER($1)
        LIMIT 1
      `, [exerciseName]);

      if (result.rows.length > 0) {
        return result.rows[0].id;
      }

      // Try with LIKE for partial matches
      result = await db.query(`
        SELECT e.id
        FROM exercises e
        WHERE LOWER(e.name) LIKE LOWER($1)
        LIMIT 1
      `, ['%' + exerciseName + '%']);

      return result.rows.length > 0 ? result.rows[0].id : null;
    }

    // Helper function to replace exercise in a block
    async function replaceExercise(workoutId, blockType, oldExerciseName, newExerciseName, newEquipment, orderIndex = null) {
      const block = await db.query(`
        SELECT id FROM workout_blocks 
        WHERE workout_id = $1 AND block_type = $2 LIMIT 1
      `, [workoutId, blockType]);

      if (block.rows.length === 0) {
        console.log(`⚠️  Block ${blockType} not found for workout ${workoutId}`);
        return false;
      }

      const blockId = block.rows[0].id;

      // Find the exercise to replace - try exact match first, then partial
      let oldExercise = await db.query(`
        SELECT be.id, be.order_index
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1
          AND LOWER(e.name) = LOWER($2)
        ${orderIndex !== null ? `AND be.order_index = ${orderIndex}` : ''}
        ORDER BY be.order_index
        LIMIT 1
      `, [blockId, oldExerciseName]);

      // If not found, try partial match
      if (oldExercise.rows.length === 0) {
        oldExercise = await db.query(`
          SELECT be.id, be.order_index
          FROM block_exercises be
          JOIN exercises e ON be.exercise_id = e.id
          WHERE be.block_id = $1
            AND LOWER(e.name) LIKE LOWER($2)
          ${orderIndex !== null ? `AND be.order_index = ${orderIndex}` : ''}
          ORDER BY be.order_index
          LIMIT 1
        `, [blockId, '%' + oldExerciseName + '%']);
      }

      if (oldExercise.rows.length === 0) {
        console.log(`⚠️  Exercise "${oldExerciseName}" not found in ${blockType} block`);
        return false;
      }

      const newExerciseId = await findExerciseId(newExerciseName, newEquipment);
      if (!newExerciseId) {
        console.log(`⚠️  Exercise "${newExerciseName}" (${newEquipment || 'N/A'}) not found`);
        return false;
      }

      // Update the exercise
      await db.query(`
        UPDATE block_exercises
        SET exercise_id = $1
        WHERE id = $2
      `, [newExerciseId, oldExercise.rows[0].id]);

      // Update equipment if specified
      if (newEquipment && newExerciseId) {
        // Handle equipment name variations
        let equipmentName = newEquipment;
        if (equipmentName === 'Medicine Ball') {
          equipmentName = 'Medicine Ball/Wall Ball';
        } else if (equipmentName === 'Dumbbells') {
          equipmentName = 'Dumbbell';
        } else if (equipmentName === 'Kettlebells') {
          equipmentName = 'Kettlebell';
        }

        // Remove old equipment
        await db.query(`
          DELETE FROM exercise_equipment
          WHERE exercise_id = $1
        `, [newExerciseId]);

        // Add new equipment
        const equipmentId = await db.query(`
          SELECT id FROM equipment WHERE LOWER(name) = LOWER($1) LIMIT 1
        `, [equipmentName]);

        if (equipmentId.rows.length > 0) {
          await db.query(`
            INSERT INTO exercise_equipment (exercise_id, equipment_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [newExerciseId, equipmentId.rows[0].id]);
        } else {
          console.log(`   ⚠️  Equipment "${equipmentName}" not found for ${newExerciseName}`);
        }
      }

      return true;
    }

    // Helper function to remove exercise
    async function removeExercise(workoutId, blockType, exerciseName) {
      const block = await db.query(`
        SELECT id FROM workout_blocks 
        WHERE workout_id = $1 AND block_type = $2 LIMIT 1
      `, [workoutId, blockType]);

      if (block.rows.length === 0) return false;

      const blockId = block.rows[0].id;

      const exercise = await db.query(`
        SELECT be.id
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1
          AND LOWER(e.name) = LOWER($2)
        LIMIT 1
      `, [blockId, exerciseName]);

      if (exercise.rows.length > 0) {
        await db.query(`DELETE FROM block_exercises WHERE id = $1`, [exercise.rows[0].id]);
        return true;
      }
      return false;
    }

    // Helper function to add exercise
    async function addExercise(workoutId, blockType, exerciseName, equipment, orderIndex = null) {
      const block = await db.query(`
        SELECT id FROM workout_blocks 
        WHERE workout_id = $1 AND block_type = $2 LIMIT 1
      `, [workoutId, blockType]);

      if (block.rows.length === 0) return false;

      const blockId = block.rows[0].id;

      const exerciseId = await findExerciseId(exerciseName, equipment);
      if (!exerciseId) {
        console.log(`⚠️  Exercise "${exerciseName}" (${equipment || 'N/A'}) not found`);
        return false;
      }

      // Get max order_index if not specified
      let nextOrder = orderIndex;
      if (nextOrder === null) {
        const maxOrder = await db.query(`
          SELECT COALESCE(MAX(order_index), 0) + 1 as next_order
          FROM block_exercises
          WHERE block_id = $1
        `, [blockId]);
        nextOrder = parseInt(maxOrder.rows[0].next_order);
      }

      await db.query(`
        INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role)
        VALUES ($1, $2, $3, $4)
      `, [blockId, exerciseId, nextOrder, blockType === 'warmup' ? 'warmup' : blockType]);

      // Update equipment if specified
      if (equipment) {
        await db.query(`
          DELETE FROM exercise_equipment WHERE exercise_id = $1
        `, [exerciseId]);

        const equipmentId = await db.query(`
          SELECT id FROM equipment WHERE LOWER(name) = LOWER($1) LIMIT 1
        `, [equipment]);

        if (equipmentId.rows.length > 0) {
          await db.query(`
            INSERT INTO exercise_equipment (exercise_id, equipment_id)
            VALUES ($1, $2)
            ON CONFLICT DO NOTHING
          `, [exerciseId, equipmentId.rows[0].id]);
        }
      }

      return true;
    }

    // 1-1: Phase One – Glutes/Quads A
    console.log('📋 Workout 1-1: Phase One – Glutes/Quads A');
    const result1_1a = await replaceExercise(1, 'primary', 'RDL', 'Single Leg Romanian Deadlift', 'Kettlebell');
    if (result1_1a) console.log('   ✅ Replaced RDL with Single Leg Romanian Deadlift');
    const result1_1b = await replaceExercise(1, 'secondary', 'Squat to Slam', 'Squat to Overhead Slam', 'Medicine Ball/Wall Ball');
    if (result1_1b) console.log('   ✅ Replaced Squat to Slam with Squat to Overhead Slam');
    console.log('');

    // 1-2: Phase One – Day 1
    console.log('📋 Workout 1-2: Phase One – Day 1');
    const result1_2a = await replaceExercise(2, 'primary', 'Step-Up', 'Box Step-Up', 'Dumbbell');
    if (result1_2a) console.log('   ✅ Replaced Step-Up with Box Step-Up');
    const result1_2b = await removeExercise(2, 'warmup', 'Chest Pass');
    if (result1_2b) console.log('   ✅ Removed Chest Pass from warmup');
    const result1_2c = await addExercise(2, 'warmup', 'Push-Ups', null);
    if (result1_2c) console.log('   ✅ Added Push-Ups to warmup');
    console.log('');

    // 1-3: Phase One – Day 2
    console.log('📋 Workout 1-3: Phase One – Day 2');
    // For warmup Deadlift, we need to update the equipment on the existing exercise
    const warmupBlock3 = await db.query(`SELECT id FROM workout_blocks WHERE workout_id = 3 AND block_type = 'warmup' LIMIT 1`);
    if (warmupBlock3.rows.length > 0) {
      const deadliftEx = await db.query(`
        SELECT be.exercise_id FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1 AND LOWER(e.name) = 'deadlift'
        LIMIT 1
      `, [warmupBlock3.rows[0].id]);
      if (deadliftEx.rows.length > 0) {
        // Update equipment for Deadlift
        await db.query(`DELETE FROM exercise_equipment WHERE exercise_id = $1`, [deadliftEx.rows[0].id]);
        const kbId = await db.query(`SELECT id FROM equipment WHERE LOWER(name) = 'kettlebell' LIMIT 1`);
        if (kbId.rows.length > 0) {
          await db.query(`INSERT INTO exercise_equipment (exercise_id, equipment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, 
            [deadliftEx.rows[0].id, kbId.rows[0].id]);
          console.log('   ✅ Changed Deadlift equipment to Kettlebell in warmup');
        }
      }
    }
    const result1_3b = await replaceExercise(3, 'primary', 'RDL', 'Deficit Sumo Squat', 'Kettlebell');
    if (result1_3b) console.log('   ✅ Replaced RDL with Deficit Sumo Squat');
    console.log('');

    // 1-4: Phase One – Day 3
    console.log('📋 Workout 1-4: Phase One – Day 3');
    const result1_4a = await replaceExercise(4, 'warmup', 'Wall Ball Shot', 'Wall Ball Squat Toss', 'Medicine Ball/Wall Ball');
    if (result1_4a) console.log('   ✅ Replaced Wall Ball Shot with Wall Ball Squat Toss');
    const result1_4b = await replaceExercise(4, 'warmup', 'Chest Pass', 'Plank to Pike', null);
    if (result1_4b) console.log('   ✅ Replaced Chest Pass with Plank to Pike');
    const result1_4c = await replaceExercise(4, 'primary', 'Strict Press', 'Lateral Shoulder Fly', 'Dumbbell');
    if (result1_4c) console.log('   ✅ Replaced Strict Press with Lateral Shoulder Fly');
    console.log('');

    // 1-6: Phase One – Day 5
    console.log('📋 Workout 1-6: Phase One – Day 5');
    const result1_6a = await replaceExercise(6, 'warmup', 'Step-Up', 'Box Step-Up', null);
    if (result1_6a) console.log('   ✅ Replaced Step-Up with Box Step-Up in warmup');
    const result1_6b = await replaceExercise(6, 'primary', 'Farmer Carry', 'Farmer Carry 30m', 'Kettlebell');
    if (result1_6b) console.log('   ✅ Replaced Farmer Carry with Farmer Carry 30m');
    const result1_6c = await replaceExercise(6, 'primary', 'Front Rack Lunge', 'Front Rack Forward Lunge', null);
    if (result1_6c) console.log('   ✅ Replaced Front Rack Lunge with Front Rack Forward Lunge');
    const result1_6d = await replaceExercise(6, 'primary', 'Overhead Lunge', 'Overhead Reverse Lunge', 'Weighted Bar');
    if (result1_6d) console.log('   ✅ Replaced Overhead Lunge with Overhead Reverse Lunge');
    const result1_6e = await replaceExercise(6, 'secondary', 'Rotational Throw', 'Alternating Over the Shoulder Toss', null);
    if (result1_6e) console.log('   ✅ Replaced Rotational Throw with Alternating Over the Shoulder Toss');
    console.log('');

    // 1-7: Phase One – Day 6
    console.log('📋 Workout 1-7: Phase One – Day 6');
    // For warmup Good Morning, update equipment
    const warmupBlock7 = await db.query(`SELECT id FROM workout_blocks WHERE workout_id = 7 AND block_type = 'warmup' LIMIT 1`);
    if (warmupBlock7.rows.length > 0) {
      const goodMorningEx = await db.query(`
        SELECT be.exercise_id FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1 AND LOWER(e.name) = 'good morning'
        LIMIT 1
      `, [warmupBlock7.rows[0].id]);
      if (goodMorningEx.rows.length > 0) {
        await db.query(`DELETE FROM exercise_equipment WHERE exercise_id = $1`, [goodMorningEx.rows[0].id]);
        const wbId = await db.query(`SELECT id FROM equipment WHERE LOWER(name) = 'weighted bar' LIMIT 1`);
        if (wbId.rows.length > 0) {
          await db.query(`INSERT INTO exercise_equipment (exercise_id, equipment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, 
            [goodMorningEx.rows[0].id, wbId.rows[0].id]);
          console.log('   ✅ Changed Good Morning equipment to Weighted Bar in warmup');
        }
      }
    }
    const result1_7b = await replaceExercise(7, 'primary', 'Thruster', 'Squat Thruster', 'Barbell');
    if (result1_7b) console.log('   ✅ Replaced Thruster with Squat Thruster');
    const result1_7c = await replaceExercise(7, 'primary', 'Snatch', 'Alternating Single Arm Snatch', 'Dumbbell');
    if (result1_7c) console.log('   ✅ Replaced Snatch with Alternating Single Arm Snatch');
    const result1_7d = await replaceExercise(7, 'secondary', 'Shoulder Press', 'Alternating Shoulder Press', 'Dumbbell');
    if (result1_7d) console.log('   ✅ Replaced Shoulder Press with Alternating Shoulder Press');
    console.log('');

    // 1-8: Phase One – Day 7
    console.log('📋 Workout 1-8: Phase One – Day 7');
    const result1_8a = await replaceExercise(8, 'warmup', 'Rotational Throw', 'Banded Pull Aparts', 'Monster/Super Band');
    if (result1_8a) console.log('   ✅ Replaced Rotational Throw with Banded Pull Aparts');
    const result1_8b = await replaceExercise(8, 'primary', 'Sit-Up Throw', 'Weighted Overhead Sit-up', 'Medicine Ball/Wall Ball');
    if (result1_8b) console.log('   ✅ Replaced Sit-Up Throw with Weighted Overhead Sit-up');
    const result1_8c = await replaceExercise(8, 'primary', 'Farmer Carry', 'Iso Squat Hold with Upright Row', 'Dumbbell');
    if (result1_8c) console.log('   ✅ Replaced Farmer Carry with Iso Squat Hold with Upright Row');
    const result1_8d = await replaceExercise(8, 'primary', 'Pallof Press', 'Active Stance Anchored Banded Chest Press, Each Side', 'Tube/Handle Band');
    if (result1_8d) console.log('   ✅ Replaced Pallof Press with Active Stance Anchored Banded Chest Press, Each Side');
    console.log('');

    console.log('════════════════════════════════════════════════');
    console.log('✅ All Updates Complete!');
    console.log('════════════════════════════════════════════════');

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
  updateWorkoutExercises()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { updateWorkoutExercises };

