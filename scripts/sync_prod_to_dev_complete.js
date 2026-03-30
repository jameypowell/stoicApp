// Complete sync of production workout changes to dev database
// This script will match exercises by name and update/create as needed
const { initDatabase, Database } = require('../database');

async function syncProdToDevComplete() {
  console.log('════════════════════════════════════════════════');
  console.log('🔄 Complete Sync: Production → Dev');
  console.log('════════════════════════════════════════════════');
  console.log('');

  // Connect to dev (SQLite)
  const devConnection = await initDatabase();
  const devDb = new Database(devConnection);

  if (devDb.isPostgres) {
    console.log('⚠️  This script should run against SQLite dev database.');
    if (devConnection.close) devConnection.close();
    return;
  }

  console.log('✅ Connected to SQLite dev database');
  console.log('');

  try {
    // Helper to find or create exercise
    async function findOrCreateExercise(name) {
      let result = await devDb.query(`SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
      if (result.rows.length > 0) {
        return result.rows[0].id;
      }
      // Create it
      await devDb.query(`
        INSERT INTO exercises (name, description, created_at, updated_at)
        VALUES (?, NULL, datetime('now'), datetime('now'))
      `, [name]);
      result = await devDb.query(`SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    }

    // Helper to find equipment ID
    async function findEqId(name) {
      if (!name) return null;
      let eqName = name;
      if (eqName === 'Medicine Ball') eqName = 'Medicine Ball/Wall Ball';
      if (eqName === 'Dumbbells') eqName = 'Dumbbell';
      if (eqName === 'Kettlebells') eqName = 'Kettlebell';
      const result = await devDb.query(`SELECT id FROM equipment WHERE LOWER(name) = LOWER(?) LIMIT 1`, [eqName]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    }

    // Helper to set equipment for exercise
    async function setEquipment(exerciseId, equipmentName) {
      if (!equipmentName || !exerciseId) return;
      const eqId = await findEqId(equipmentName);
      if (eqId) {
        await devDb.query(`DELETE FROM exercise_equipment WHERE exercise_id = ?`, [exerciseId]);
        await devDb.query(`INSERT OR IGNORE INTO exercise_equipment (exercise_id, equipment_id) VALUES (?, ?)`, [exerciseId, eqId]);
      }
    }

    // Helper to replace exercise in block
    async function replaceInBlock(workoutId, blockType, oldNamePattern, newName, equipment = null) {
      const block = await devDb.query(`SELECT id FROM workout_blocks WHERE workout_id = ? AND block_type = ? LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) {
        console.log(`   ⚠️  Block ${blockType} not found for workout ${workoutId}`);
        return false;
      }

      // Find the exercise to replace
      const oldEx = await devDb.query(`
        SELECT be.id, be.exercise_id, e.name
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = ? AND LOWER(e.name) LIKE ?
        LIMIT 1
      `, [block.rows[0].id, '%' + oldNamePattern + '%']);

      if (oldEx.rows.length === 0) {
        console.log(`   ⚠️  Exercise matching "${oldNamePattern}" not found in ${blockType} block`);
        return false;
      }

      const newExId = await findOrCreateExercise(newName);
      if (!newExId) {
        console.log(`   ⚠️  Failed to create exercise "${newName}"`);
        return false;
      }

      await devDb.query(`UPDATE block_exercises SET exercise_id = ? WHERE id = ?`, [newExId, oldEx.rows[0].id]);
      await setEquipment(newExId, equipment);
      return true;
    }

    // Helper to update equipment for existing exercise
    async function updateEquipment(workoutId, blockType, exerciseName, newEquipment) {
      const block = await devDb.query(`SELECT id FROM workout_blocks WHERE workout_id = ? AND block_type = ? LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) return false;

      const ex = await devDb.query(`
        SELECT be.exercise_id FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = ? AND LOWER(e.name) LIKE ?
        LIMIT 1
      `, [block.rows[0].id, '%' + exerciseName + '%']);

      if (ex.rows.length === 0 || !ex.rows[0].exercise_id) return false;
      await setEquipment(ex.rows[0].exercise_id, newEquipment);
      return true;
    }

    // Helper to remove exercise
    async function removeFromBlock(workoutId, blockType, exerciseName) {
      const block = await devDb.query(`SELECT id FROM workout_blocks WHERE workout_id = ? AND block_type = ? LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) return false;

      const ex = await devDb.query(`
        SELECT be.id FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = ? AND LOWER(e.name) LIKE ?
        LIMIT 1
      `, [block.rows[0].id, '%' + exerciseName + '%']);

      if (ex.rows.length > 0) {
        await devDb.query(`DELETE FROM block_exercises WHERE id = ?`, [ex.rows[0].id]);
        return true;
      }
      return false;
    }

    // Helper to add exercise
    async function addToBlock(workoutId, blockType, exerciseName, equipment = null) {
      const block = await devDb.query(`SELECT id FROM workout_blocks WHERE workout_id = ? AND block_type = ? LIMIT 1`, [workoutId, blockType]);
      if (block.rows.length === 0) return false;

      const exId = await findOrCreateExercise(exerciseName);
      if (!exId) return false;

      const maxOrder = await devDb.query(`SELECT COALESCE(MAX(order_index), 0) + 1 as next FROM block_exercises WHERE block_id = ?`, [block.rows[0].id]);
      const orderIndex = parseInt(maxOrder.rows[0].next);

      await devDb.query(`INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role) VALUES (?, ?, ?, ?)`, 
        [block.rows[0].id, exId, orderIndex, blockType === 'warmup' ? 'warmup' : blockType]);

      await setEquipment(exId, equipment);
      return true;
    }

    // Apply all changes from production
    console.log('Applying changes...');
    console.log('');

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
    console.log('✅ All Changes Synced to Dev!');
    console.log('════════════════════════════════════════════════');

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error);
    throw error;
  } finally {
    if (devConnection.close) {
      devConnection.close();
    }
  }
}

if (require.main === module) {
  syncProdToDevComplete()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { syncProdToDevComplete };




















