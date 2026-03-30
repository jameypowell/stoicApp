// Complete sync of workout structure from production to dev
// This will pull all exercises from production and recreate them in dev with the changes applied
const { initDatabase, Database } = require('../database');

async function syncFullWorkouts() {
  console.log('════════════════════════════════════════════════');
  console.log('🔄 Full Sync: Production → Dev');
  console.log('════════════════════════════════════════════════');
  console.log('');

  // Save original env
  const originalEnv = { ...process.env };

  // Set production env vars
  process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
  process.env.DB_USER = process.env.DB_USER || 'stoicapp';
  process.env.DB_PASSWORD = process.env.DB_PASSWORD || 'StoicDBtrong';
  process.env.DB_NAME = process.env.DB_NAME || 'postgres';
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.DB_SSL = process.env.DB_SSL || 'true';

  // Connect to production
  const prodConnection = await initDatabase();
  const prodDb = new Database(prodConnection);

  if (!prodDb.isPostgres) {
    console.log('⚠️  Production connection failed - need Postgres environment variables');
    if (prodConnection.close) prodConnection.close();
    return;
  }

  // Connect to dev (SQLite) - unset Postgres vars
  delete process.env.DB_HOST;
  delete process.env.DB_USER;
  delete process.env.DB_PASSWORD;
  delete process.env.DB_NAME;
  delete process.env.DB_PORT;
  delete process.env.DB_SSL;

  const devConnection = await initDatabase();
  const devDb = new Database(devConnection);

  // Restore original env
  Object.assign(process.env, originalEnv);

  if (devDb.isPostgres) {
    console.log('⚠️  Dev connection failed - should be SQLite');
    if (devConnection.close) devConnection.close();
    if (prodConnection.end) await prodConnection.end();
    return;
  }

  console.log('✅ Connected to both databases');
  console.log('');

  try {
    // Sync all Phase One (1–8), Phase Two (9–15), and Phase Three (16–22) workouts
    const workoutIds = [
      1, 2, 3, 4, 5, 6, 7, 8,     // Phase One
      9, 10, 11, 12, 13, 14, 15,  // Phase Two
      16, 17, 18, 19, 20, 21, 22  // Phase Three
    ];

    // Helper to find or create exercise in dev
    async function findOrCreateExercise(name) {
      let result = await devDb.query(`SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
      if (result.rows.length > 0) {
        return result.rows[0].id;
      }
      await devDb.query(`
        INSERT INTO exercises (name, description, created_at, updated_at)
        VALUES (?, NULL, datetime('now'), datetime('now'))
      `, [name]);
      result = await devDb.query(`SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1`, [name]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    }

    // Helper to find equipment ID in dev
    async function findEqId(name) {
      if (!name) return null;
      let eqName = name;
      if (eqName === 'Medicine Ball') eqName = 'Medicine Ball/Wall Ball';
      if (eqName === 'Dumbbells') eqName = 'Dumbbell';
      if (eqName === 'Kettlebells') eqName = 'Kettlebell';
      const result = await devDb.query(`SELECT id FROM equipment WHERE LOWER(name) = LOWER(?) LIMIT 1`, [eqName]);
      return result.rows.length > 0 ? result.rows[0].id : null;
    }

    // Helper to set equipment
    async function setEquipment(exerciseId, equipmentName) {
      if (!equipmentName || !exerciseId) return;
      const eqId = await findEqId(equipmentName);
      if (eqId) {
        await devDb.query(`DELETE FROM exercise_equipment WHERE exercise_id = ?`, [exerciseId]);
        await devDb.query(`INSERT OR IGNORE INTO exercise_equipment (exercise_id, equipment_id) VALUES (?, ?)`, [exerciseId, eqId]);
      }
    }

    for (const workoutId of workoutIds) {
      console.log(`📋 Syncing Workout ${workoutId}...`);

      // Get workout structure from production
      const prodExercises = await prodDb.query(`
        SELECT 
          be.order_index,
          e.name as exercise_name,
          wb.block_type,
          eq.name as equipment_name
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        JOIN workout_blocks wb ON be.block_id = wb.id
        LEFT JOIN exercise_equipment ee ON e.id = ee.exercise_id
        LEFT JOIN equipment eq ON ee.equipment_id = eq.id
        WHERE wb.workout_id = $1
        ORDER BY wb.order_index, be.order_index
      `, [workoutId]);

      // Get or create blocks in dev
      const devBlocks = {};
      for (const blockType of ['warmup', 'primary', 'secondary', 'finisher']) {
        const block = await devDb.query(`
          SELECT id FROM workout_blocks 
          WHERE workout_id = ? AND block_type = ? 
          LIMIT 1
        `, [workoutId, blockType]);
        if (block.rows.length > 0) {
          devBlocks[blockType] = block.rows[0].id;
        } else {
          // Create block
          const maxOrder = await devDb.query(`
            SELECT COALESCE(MAX(order_index), 0) + 1 as next 
            FROM workout_blocks WHERE workout_id = ?
          `, [workoutId]);
          const orderIndex = parseInt(maxOrder.rows[0].next);
          await devDb.query(`
            INSERT INTO workout_blocks (workout_id, block_type, order_index, created_at, updated_at)
            VALUES (?, ?, ?, datetime('now'), datetime('now'))
          `, [workoutId, blockType, orderIndex]);
          const newBlock = await devDb.query(`
            SELECT id FROM workout_blocks 
            WHERE workout_id = ? AND block_type = ? 
            LIMIT 1
          `, [workoutId, blockType]);
          if (newBlock.rows.length > 0) {
            devBlocks[blockType] = newBlock.rows[0].id;
          }
        }
      }

      // Clear existing exercises in dev for this workout
      for (const blockId of Object.values(devBlocks)) {
        await devDb.query(`DELETE FROM block_exercises WHERE block_id = ?`, [blockId]);
      }

      // Add exercises from production
      for (const ex of prodExercises.rows) {
        if (!devBlocks[ex.block_type]) continue;

        const exerciseId = await findOrCreateExercise(ex.exercise_name);
        if (!exerciseId) {
          console.log(`   ⚠️  Failed to create exercise: ${ex.exercise_name}`);
          continue;
        }

        const maxOrder = await devDb.query(`
          SELECT COALESCE(MAX(order_index), 0) + 1 as next 
          FROM block_exercises WHERE block_id = ?
        `, [devBlocks[ex.block_type]]);
        const orderIndex = parseInt(maxOrder.rows[0].next);

        await devDb.query(`
          INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role, created_at, updated_at)
          VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))
        `, [devBlocks[ex.block_type], exerciseId, orderIndex, ex.block_type === 'warmup' ? 'warmup' : ex.block_type]);

        await setEquipment(exerciseId, ex.equipment_name);
      }

      console.log(`   ✅ Synced ${prodExercises.rows.length} exercises`);
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Full Sync Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('Dev database now matches production for workouts 1-8');

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error);
    throw error;
  } finally {
    if (devConnection.close) {
      devConnection.close();
    }
    if (prodConnection.end) {
      await prodConnection.end();
    }
  }
}

if (require.main === module) {
  syncFullWorkouts()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { syncFullWorkouts };

