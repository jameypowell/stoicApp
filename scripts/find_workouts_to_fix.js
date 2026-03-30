// Find workouts that need fixing
const { initDatabase, Database } = require('../database');

async function findWorkoutsNeedingFixes(db) {
  const problematicPatterns = [
    'banded pull apart',
    'Dumbbell Shoulder Fly',
    'Alternating Dumbbell Overhead Should Press',
    'Alternating Dumbbell Front Raises',
    'Alternating Dumbbell Lateral Raises',
    'Alternating Dumbbell Curls',
    'Dumbbell Single Arm Kickbacks'
  ];
  
  console.log('🔍 Searching for workouts with problematic exercises...\n');
  
  for (const pattern of problematicPatterns) {
    let results;
    if (db.isPostgres) {
      results = await db.query(`
        SELECT DISTINCT w.id, w.name, w.phase, e.name as exercise_name, wb.block_type
        FROM workout w
        JOIN workout_blocks wb ON w.id = wb.workout_id
        JOIN block_exercises be ON wb.id = be.block_id
        JOIN exercises e ON be.exercise_id = e.id
        WHERE LOWER(e.name) LIKE $1
        ORDER BY w.id, wb.block_type
      `, ['%' + pattern.toLowerCase() + '%']);
      results = results.rows || [];
    } else {
      results = await db.query(`
        SELECT DISTINCT w.id, w.name, w.phase, e.name as exercise_name, wb.block_type
        FROM workout w
        JOIN workout_blocks wb ON w.id = wb.workout_id
        JOIN block_exercises be ON wb.id = be.block_id
        JOIN exercises e ON be.exercise_id = e.id
        WHERE LOWER(e.name) LIKE ?
        ORDER BY w.id, wb.block_type
      `, ['%' + pattern.toLowerCase() + '%']);
      results = Array.isArray(results) ? results : [results];
    }
    
    if (results.length > 0) {
      console.log(`Found "${pattern}":`);
      for (const row of results) {
        const workoutId = db.isPostgres ? row.id : row.id;
        const workoutName = row.name;
        const phase = row.phase;
        const exerciseName = row.exercise_name;
        const blockType = row.block_type;
        console.log(`  Workout ID ${workoutId}: ${workoutName} (${phase}) - ${exerciseName} in ${blockType}`);
      }
      console.log('');
    }
  }
}

async function main() {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  try {
    if (db.isPostgres) {
      console.log('📋 Connected to PostgreSQL (production)\n');
    } else {
      console.log('📋 Connected to SQLite (development)\n');
    }
    
    await findWorkoutsNeedingFixes(db);
    
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

if (require.main === module) {
  main()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { findWorkoutsNeedingFixes };



















