// Direct updates to workouts - making all requested changes
const { initDatabase, Database } = require('../database');

async function updateWorkoutsDirect() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Updating Workouts - Direct Changes');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  if (!db.isPostgres) {
    console.log('⚠️  This script is for PostgreSQL production only.');
    if (dbConnection.close) dbConnection.close();
    return;
  }

  try {
    // Helper to find exercise ID
    async function findExId(name) {
      const result = await db.query(`SELECT id FROM exercises WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    }

    // Helper to find equipment ID
    async function findEqId(name) {
      const result = await db.query(`SELECT id FROM equipment WHERE LOWER(name) = LOWER($1) LIMIT 1`, [name]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    }

    // Helper to replace exercise in block
    async function replaceInBlock(workoutId, blockType, oldName, newName, equipment = null) {
      const block = await db.query(`SELECT id FROM workout_blocks WHERE workout_id = $1 AND block_type = $2 LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) return false;

      const oldEx = await db.query(`
        SELECT be.id, be.exercise_id FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1 AND LOWER(e.name) LIKE LOWER($2)
        LIMIT 1
      `, [block.rows[0].id, '%' + oldName + '%']);

      if (oldEx.rows.length === 0) return false;

      const newExId = await findExId(newName);
      if (!newExId) return false;

      await db.query(`UPDATE block_exercises SET exercise_id = $1 WHERE id = $2`, [newExId, oldEx.rows[0].id]);

      if (equipment) {
        const eqId = await findEqId(equipment);
        if (eqId) {
          await db.query(`DELETE FROM exercise_equipment WHERE exercise_id = $1`, [newExId]);
          await db.query(`INSERT INTO exercise_equipment (exercise_id, equipment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [newExId, eqId]);
        }
      }

      return true;
    }

    // Helper to update equipment for existing exercise
    async function updateEquipment(workoutId, blockType, exerciseName, newEquipment) {
      const block = await db.query(`SELECT id FROM workout_blocks WHERE workout_id = $1 AND block_type = $2 LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) return false;

      const ex = await db.query(`
        SELECT be.exercise_id FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1 AND LOWER(e.name) LIKE LOWER($2)
        LIMIT 1
      `, [block.rows[0].id, '%' + exerciseName + '%']);

      if (ex.rows.length === 0 || !ex.rows[0].exercise_id) return false;

      const exerciseId = ex.rows[0].exercise_id;

      let eqName = newEquipment;
      if (eqName === 'Medicine Ball') eqName = 'Medicine Ball/Wall Ball';
      if (eqName === 'Dumbbells') eqName = 'Dumbbell';
      if (eqName === 'Kettlebells') eqName = 'Kettlebell';

      const eqId = await findEqId(eqName);
      if (eqId && exerciseId) {
        await db.query(`DELETE FROM exercise_equipment WHERE exercise_id = $1`, [exerciseId]);
        await db.query(`INSERT INTO exercise_equipment (exercise_id, equipment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [exerciseId, eqId]);
        return true;
      }
      return false;
    }

    // Helper to remove exercise
    async function removeFromBlock(workoutId, blockType, exerciseName) {
      const block = await db.query(`SELECT id FROM workout_blocks WHERE workout_id = $1 AND block_type = $2 LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) return false;

      const ex = await db.query(`
        SELECT be.id FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1 AND LOWER(e.name) LIKE LOWER($2)
        LIMIT 1
      `, [block.rows[0].id, '%' + exerciseName + '%']);

      if (ex.rows.length > 0) {
        await db.query(`DELETE FROM block_exercises WHERE id = $1`, [ex.rows[0].id]);
        return true;
      }
      return false;
    }

    // Helper to add exercise
    async function addToBlock(workoutId, blockType, exerciseName, equipment = null, orderIndex = null) {
      const block = await db.query(`SELECT id FROM workout_blocks WHERE workout_id = $1 AND block_type = $2 LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) return false;

      const exId = await findExId(exerciseName);
      if (!exId) return false;

      if (orderIndex === null) {
        const maxOrder = await db.query(`SELECT COALESCE(MAX(order_index), 0) + 1 as next FROM block_exercises WHERE block_id = $1`, [block.rows[0].id]);
        orderIndex = parseInt(maxOrder.rows[0].next);
      }

      await db.query(`INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role) VALUES ($1, $2, $3, $4)`, 
        [block.rows[0].id, exId, orderIndex, blockType === 'warmup' ? 'warmup' : blockType]);

      if (equipment) {
        let eqName = equipment;
        if (eqName === 'Medicine Ball') eqName = 'Medicine Ball/Wall Ball';
        const eqId = await findEqId(eqName);
        if (eqId) {
          await db.query(`DELETE FROM exercise_equipment WHERE exercise_id = $1`, [exId]);
          await db.query(`INSERT INTO exercise_equipment (exercise_id, equipment_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [exId, eqId]);
        }
      }

      return true;
    }

    // 1-1: Phase One – Glutes/Quads A
    console.log('📋 Workout 1-1: Phase One – Glutes/Quads A');
    if (await replaceInBlock(1, 'primary', 'RDL', 'Single Leg Romanian Deadlift', 'Kettlebell')) {
      console.log('   ✅ Replaced RDL with Single Leg Romanian Deadlift (Kettlebell)');
    }
    if (await replaceInBlock(1, 'secondary', 'Squat to Slam', 'Squat to Overhead Slam', 'Medicine Ball/Wall Ball')) {
      console.log('   ✅ Replaced Squat to Slam with Squat to Overhead Slam');
    }
    console.log('');

    // 1-2: Phase One – Day 1
    console.log('📋 Workout 1-2: Phase One – Day 1');
    if (await replaceInBlock(2, 'primary', 'Step-Up', 'Box Step-Up', 'Dumbbell')) {
      console.log('   ✅ Replaced Step-Up with Box Step-Up (Dumbbell)');
    }
    if (await removeFromBlock(2, 'warmup', 'Chest Pass')) {
      console.log('   ✅ Removed Chest Pass from warmup');
    }
    if (await addToBlock(2, 'warmup', 'Push-Ups', null)) {
      console.log('   ✅ Added Push-Ups to warmup');
    }
    console.log('');

    // 1-3: Phase One – Day 2
    console.log('📋 Workout 1-3: Phase One – Day 2');
    if (await updateEquipment(3, 'warmup', 'Deadlift', 'Kettlebell')) {
      console.log('   ✅ Changed Deadlift equipment to Kettlebell in warmup');
    }
    if (await replaceInBlock(3, 'primary', 'RDL', 'Deficit Sumo Squat', 'Kettlebell')) {
      console.log('   ✅ Replaced RDL with Deficit Sumo Squat (Kettlebell)');
    }
    console.log('');

    // 1-4: Phase One – Day 3
    console.log('📋 Workout 1-4: Phase One – Day 3');
    if (await replaceInBlock(4, 'warmup', 'Wall Ball Shot', 'Wall Ball Squat Toss', 'Medicine Ball/Wall Ball')) {
      console.log('   ✅ Replaced Wall Ball Shot with Wall Ball Squat Toss');
    }
    if (await replaceInBlock(4, 'warmup', 'Chest Pass', 'Plank to Pike', null)) {
      console.log('   ✅ Replaced Chest Pass with Plank to Pike');
    }
    if (await replaceInBlock(4, 'primary', 'Strict Press', 'Lateral Shoulder Fly', 'Dumbbell')) {
      console.log('   ✅ Replaced Strict Press with Lateral Shoulder Fly (Dumbbell)');
    }
    console.log('');

    // 1-6: Phase One – Day 5
    console.log('📋 Workout 1-6: Phase One – Day 5');
    if (await replaceInBlock(6, 'warmup', 'Step-Up', 'Box Step-Up', null)) {
      console.log('   ✅ Replaced Step-Up with Box Step-Up in warmup');
    }
    if (await replaceInBlock(6, 'primary', 'Farmer Carry', 'Farmer Carry 30m', 'Kettlebell')) {
      console.log('   ✅ Replaced Farmer Carry with Farmer Carry 30m (Kettlebell)');
    }
    if (await replaceInBlock(6, 'primary', 'Front Rack Lunge', 'Front Rack Forward Lunge', null)) {
      console.log('   ✅ Replaced Front Rack Lunge with Front Rack Forward Lunge');
    }
    if (await replaceInBlock(6, 'primary', 'Overhead Lunge', 'Overhead Reverse Lunge', 'Weighted Bar')) {
      console.log('   ✅ Replaced Overhead Lunge with Overhead Reverse Lunge (Weighted Bar)');
    }
    if (await replaceInBlock(6, 'secondary', 'Rotational Throw', 'Alternating Over the Shoulder Toss', null)) {
      console.log('   ✅ Replaced Rotational Throw with Alternating Over the Shoulder Toss');
    }
    console.log('');

    // 1-7: Phase One – Day 6
    console.log('📋 Workout 1-7: Phase One – Day 6');
    if (await updateEquipment(7, 'warmup', 'Good Morning', 'Weighted Bar')) {
      console.log('   ✅ Changed Good Morning equipment to Weighted Bar in warmup');
    }
    if (await replaceInBlock(7, 'primary', 'Thruster', 'Squat Thruster', 'Barbell')) {
      console.log('   ✅ Replaced Thruster with Squat Thruster (Barbell)');
    }
    if (await replaceInBlock(7, 'primary', 'Snatch', 'Alternating Single Arm Snatch', 'Dumbbell')) {
      console.log('   ✅ Replaced Snatch with Alternating Single Arm Snatch (Dumbbell)');
    }
    if (await replaceInBlock(7, 'secondary', 'Shoulder Press', 'Alternating Shoulder Press', 'Dumbbell')) {
      console.log('   ✅ Replaced Shoulder Press with Alternating Shoulder Press (Dumbbell)');
    }
    console.log('');

    // 1-8: Phase One – Day 7
    console.log('📋 Workout 1-8: Phase One – Day 7');
    if (await replaceInBlock(8, 'warmup', 'Rotational Throw', 'Banded Pull Aparts', 'Monster/Super Band')) {
      console.log('   ✅ Replaced Rotational Throw with Banded Pull Aparts');
    }
    if (await replaceInBlock(8, 'primary', 'Sit-Up Throw', 'Weighted Overhead Sit-up', 'Medicine Ball/Wall Ball')) {
      console.log('   ✅ Replaced Sit-Up Throw with Weighted Overhead Sit-up');
    }
    if (await replaceInBlock(8, 'primary', 'Farmer Carry', 'Iso Squat Hold with Upright Row', 'Dumbbell')) {
      console.log('   ✅ Replaced Farmer Carry with Iso Squat Hold with Upright Row');
    }
    if (await replaceInBlock(8, 'primary', 'Pallof Press', 'Active Stance Anchored Banded Chest Press, Each Side', 'Tube/Handle Band')) {
      console.log('   ✅ Replaced Pallof Press with Active Stance Anchored Banded Chest Press, Each Side');
    }
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
  updateWorkoutsDirect()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { updateWorkoutsDirect };

