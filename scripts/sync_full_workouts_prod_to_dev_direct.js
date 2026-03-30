// Direct full sync of strength workout structure from production (Postgres) to dev (SQLite)
// - READS from production only (RDS Postgres)
// - WRITES to dev only (local SQLite stoic-shop.db)
// - Does NOT modify production data

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

async function syncFullWorkoutsDirect() {
  console.log('════════════════════════════════════════════════');
  console.log('🔄 Full Sync (Direct): Production → Dev (SQLite)');
  console.log('════════════════════════════════════════════════');
  console.log('');

  // Workout IDs for all three phases
  const workoutIds = [
    1, 2, 3, 4, 5, 6, 7, 8,     // Phase One
    9, 10, 11, 12, 13, 14, 15,  // Phase Two
    16, 17, 18, 19, 20, 21, 22  // Phase Three
  ];

  // Resolve dev SQLite DB path in the same way as database.js
  const resolveDbPath = () => {
    const envPath = process.env.DB_PATH;
    if (!envPath) {
      return path.join(__dirname, '..', 'data', 'stoic-shop.db');
    }
    return path.isAbsolute(envPath)
      ? envPath
      : path.join(path.join(__dirname, '..'), envPath);
  };

  const DB_PATH = resolveDbPath();

  // Postgres connection config (prod)
  const pgConfig = {
    host: process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com',
    port: Number(process.env.DB_PORT || 5432),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER || 'stoicapp',
    password: process.env.DB_PASSWORD || 'StoicDBtrong',
    ssl: process.env.DB_SSL === 'false'
      ? false
      : {
          rejectUnauthorized: false
        }
  };

  const pgClient = new Client(pgConfig);

  // Open SQLite (dev)
  const sqliteDb = new sqlite3.Database(DB_PATH);

  // Promisified helpers for SQLite
  const sqliteAll = (sql, params = []) =>
    new Promise((resolve, reject) => {
      sqliteDb.all(sql, params, (err, rows) => {
        if (err) reject(err);
        else resolve(rows || []);
      });
    });

  const sqliteGet = (sql, params = []) =>
    new Promise((resolve, reject) => {
      sqliteDb.get(sql, params, (err, row) => {
        if (err) reject(err);
        else resolve(row || null);
      });
    });

  const sqliteRun = (sql, params = []) =>
    new Promise((resolve, reject) => {
      sqliteDb.run(sql, params, function (err) {
        if (err) reject(err);
        else resolve({ lastID: this.lastID, changes: this.changes });
      });
    });

  try {
    console.log('🔐 Connecting to production Postgres...');
    await pgClient.connect();
    console.log('✅ Connected to production Postgres');
    console.log(`📁 Dev SQLite DB: ${DB_PATH}`);
    console.log('');

    // Helper: find or create exercise in dev
    async function findOrCreateExerciseDev(name) {
      if (!name) return null;
      const existing = await sqliteGet(
        `SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1`,
        [name]
      );
      if (existing) return existing.id;

      await sqliteRun(
        `INSERT INTO exercises (name, description, created_at, updated_at)
         VALUES (?, NULL, datetime('now'), datetime('now'))`,
        [name]
      );

      const created = await sqliteGet(
        `SELECT id FROM exercises WHERE LOWER(name) = LOWER(?) LIMIT 1`,
        [name]
      );
      return created ? created.id : null;
    }

    // Helper: normalize equipment names to dev naming
    function normalizeEquipmentName(name) {
      if (!name) return null;
      let eqName = name;
      if (eqName === 'Medicine Ball') eqName = 'Medicine Ball/Wall Ball';
      if (eqName === 'Dumbbells') eqName = 'Dumbbell';
      if (eqName === 'Kettlebells') eqName = 'Kettlebell';
      return eqName;
    }

    // Helper: find equipment ID in dev
    async function findEquipmentIdDev(name) {
      if (!name) return null;
      const eqName = normalizeEquipmentName(name);
      if (!eqName) return null;

      const row = await sqliteGet(
        `SELECT id FROM equipment WHERE LOWER(name) = LOWER(?) LIMIT 1`,
        [eqName]
      );
      return row ? row.id : null;
    }

    // Helper: set equipment for an exercise in dev (one equipment only)
    async function setEquipmentDev(exerciseId, equipmentName) {
      if (!exerciseId || !equipmentName) return;
      const eqId = await findEquipmentIdDev(equipmentName);
      if (!eqId) return;

      await sqliteRun(
        `DELETE FROM exercise_equipment WHERE exercise_id = ?`,
        [exerciseId]
      );
      await sqliteRun(
        `INSERT OR IGNORE INTO exercise_equipment (exercise_id, equipment_id)
         VALUES (?, ?)`,
        [exerciseId, eqId]
      );
    }

    // Helper: get or create a block in dev
    async function getOrCreateBlockDev(workoutId, blockType) {
      const existing = await sqliteGet(
        `SELECT id FROM workout_blocks
         WHERE workout_id = ? AND block_type = ?
         LIMIT 1`,
        [workoutId, blockType]
      );
      if (existing) return existing.id;

      const nextOrderRow = await sqliteGet(
        `SELECT COALESCE(MAX(order_index), 0) + 1 AS next
         FROM workout_blocks
         WHERE workout_id = ?`,
        [workoutId]
      );
      const orderIndex = parseInt(nextOrderRow?.next || 1, 10);

      await sqliteRun(
        `INSERT INTO workout_blocks (workout_id, block_type, order_index, created_at, updated_at)
         VALUES (?, ?, ?, datetime('now'), datetime('now'))`,
        [workoutId, blockType, orderIndex]
      );

      const created = await sqliteGet(
        `SELECT id FROM workout_blocks
         WHERE workout_id = ? AND block_type = ?
         LIMIT 1`,
        [workoutId, blockType]
      );
      return created ? created.id : null;
    }

    for (const workoutId of workoutIds) {
      console.log(`📋 Syncing Workout ID ${workoutId}...`);

      // Pull structure from production
      const prodRes = await pgClient.query(
        `
        SELECT 
          wb.block_type,
          be.order_index,
          e.name AS exercise_name,
          eq.name AS equipment_name
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        JOIN workout_blocks wb ON be.block_id = wb.id
        LEFT JOIN exercise_equipment ee ON e.id = ee.exercise_id
        LEFT JOIN equipment eq ON ee.equipment_id = eq.id
        WHERE wb.workout_id = $1
        ORDER BY wb.order_index, be.order_index
        `,
        [workoutId]
      );

      const rows = prodRes.rows || [];
      console.log(`   • Found ${rows.length} exercises in production`);

      // Ensure blocks exist in dev, collect their IDs
      const blockTypes = ['warmup', 'primary', 'secondary', 'finisher'];
      const devBlocks = {};
      for (const bt of blockTypes) {
        devBlocks[bt] = await getOrCreateBlockDev(workoutId, bt);
      }

      // Clear existing block_exercises for these blocks in dev
      const blockIdsToClear = Object.values(devBlocks).filter(Boolean);
      for (const blockId of blockIdsToClear) {
        await sqliteRun(
          `DELETE FROM block_exercises WHERE block_id = ?`,
          [blockId]
        );
      }

      // Recreate from production
      let inserted = 0;
      for (const ex of rows) {
        const blockType = ex.block_type;
        const blockId = devBlocks[blockType];
        if (!blockId) continue;

        const exerciseId = await findOrCreateExerciseDev(ex.exercise_name);
        if (!exerciseId) {
          console.log(`   ⚠️ Could not create/find exercise "${ex.exercise_name}"`);
          continue;
        }

        const nextOrderRow = await sqliteGet(
          `SELECT COALESCE(MAX(order_index), 0) + 1 AS next
           FROM block_exercises
           WHERE block_id = ?`,
          [blockId]
        );
        const orderIndex = parseInt(nextOrderRow?.next || 1, 10);

        await sqliteRun(
          `INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role, created_at, updated_at)
           VALUES (?, ?, ?, ?, datetime('now'), datetime('now'))`,
          [
            blockId,
            exerciseId,
            orderIndex,
            blockType === 'warmup' ? 'warmup' : blockType
          ]
        );

        await setEquipmentDev(exerciseId, ex.equipment_name);
        inserted++;
      }

      console.log(`   ✅ Synced ${inserted} exercises to dev`);
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Direct Full Sync Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('Dev strength workouts for Phase One, Two, and Three now mirror production.');
  } catch (err) {
    console.error('');
    console.error('❌ Direct sync failed:', err);
    throw err;
  } finally {
    try {
      await pgClient.end();
    } catch (e) {
      // ignore
    }
    sqliteDb.close();
  }
}

if (require.main === module) {
  syncFullWorkoutsDirect()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Script failed:', err);
      process.exit(1);
    });
}

module.exports = { syncFullWorkoutsDirect };





















