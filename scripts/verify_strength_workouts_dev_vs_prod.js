// Verify that strength workouts, exercises, and equipment in dev (SQLite)
// match production (Postgres) for Phase One, Two, and Three.
// READ-ONLY for production; dev is also read-only in this script.

const path = require('path');
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');

async function verifyStrengthWorkouts() {
  console.log('════════════════════════════════════════════════');
  console.log('🔍 Verify Strength Workouts: Prod vs Dev');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const workoutIds = [
    1, 2, 3, 4, 5, 6, 7, 8,     // Phase One
    9, 10, 11, 12, 13, 14, 15,  // Phase Two
    16, 17, 18, 19, 20, 21, 22  // Phase Three
  ];

  // Resolve dev SQLite DB path (same logic as database.js)
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
  const sqliteDb = new sqlite3.Database(DB_PATH);

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

  try {
    console.log('🔐 Connecting to production Postgres...');
    await pgClient.connect();
    console.log('✅ Connected to production Postgres');
    console.log(`📁 Dev SQLite DB: ${DB_PATH}`);
    console.log('');

    let mismatches = 0;

    for (const workoutId of workoutIds) {
      console.log(`📋 Checking Workout ID ${workoutId}...`);

      // Prod: basic workout info
      const prodInfoRes = await pgClient.query(
        `
        SELECT w.name, w.phase
        FROM workout w
        JOIN workout_types wt ON w.workout_type_id = wt.id
        WHERE wt.code = 'STRENGTH' AND w.id = $1
        `,
        [workoutId]
      );
      const prodInfo = prodInfoRes.rows[0];
      if (!prodInfo) {
        console.log('   ⚠️ Workout missing in prod, skipping');
        continue;
      }

      // Dev: basic workout info
      const devInfo = await sqliteGet(
        `
        SELECT name, phase
        FROM workout w
        JOIN workout_types wt ON w.workout_type_id = wt.id
        WHERE wt.code = 'STRENGTH' AND w.id = ?
        `,
        [workoutId]
      );

      if (!devInfo) {
        console.log('   ❌ Workout missing in dev');
        mismatches++;
        continue;
      }

      // Prod: counts per block_type
      const prodBlocksRes = await pgClient.query(
        `
        SELECT wb.block_type, COUNT(be.id) AS exercise_count
        FROM workout_blocks wb
        LEFT JOIN block_exercises be ON wb.id = be.block_id
        WHERE wb.workout_id = $1
        GROUP BY wb.block_type
        `,
        [workoutId]
      );
      const prodBlocks = {};
      for (const row of prodBlocksRes.rows) {
        prodBlocks[row.block_type] = Number(row.exercise_count);
      }

      // Dev: counts per block_type
      const devBlocksRows = await sqliteAll(
        `
        SELECT wb.block_type, COUNT(be.id) AS exercise_count
        FROM workout_blocks wb
        LEFT JOIN block_exercises be ON wb.id = be.block_id
        WHERE wb.workout_id = ?
        GROUP BY wb.block_type
        `,
        [workoutId]
      );
      const devBlocks = {};
      for (const row of devBlocksRows) {
        devBlocks[row.block_type] = Number(row.exercise_count);
      }

      // Compare per block_type
      const allBlockTypes = new Set([
        ...Object.keys(prodBlocks),
        ...Object.keys(devBlocks)
      ]);

      let workoutMismatch = false;
      for (const bt of allBlockTypes) {
        const prodCount = prodBlocks[bt] || 0;
        const devCount = devBlocks[bt] || 0;
        if (prodCount !== devCount) {
          if (!workoutMismatch) {
            console.log(
              `   ❌ Mismatch for ${prodInfo.phase} – ${prodInfo.name}`
            );
            workoutMismatch = true;
          }
          console.log(
            `      Block "${bt}": prod=${prodCount}, dev=${devCount}`
          );
        }
      }

      if (!workoutMismatch) {
        console.log(
          `   ✅ Blocks & exercise counts match for "${prodInfo.phase} – ${prodInfo.name}"`
        );
      } else {
        mismatches++;
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    if (mismatches === 0) {
      console.log('✅ All checked strength workouts match between prod and dev.');
    } else {
      console.log(
        `⚠️  Found ${mismatches} workout(s) with block/exercise count mismatches.`
      );
    }
    console.log('════════════════════════════════════════════════');
  } catch (err) {
    console.error('❌ Verification failed:', err);
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
  verifyStrengthWorkouts()
    .then(() => {
      console.log('Verification script completed');
      process.exit(0);
    })
    .catch((err) => {
      console.error('Script failed:', err);
      process.exit(1);
    });
}

module.exports = { verifyStrengthWorkouts };





















