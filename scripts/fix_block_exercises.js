// Fix block_exercises by mapping exercise table to exercises table
const { initDatabase, Database } = require('../database');
const fs = require('fs');
const path = require('path');

async function fixBlockExercises() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Fixing Block Exercises');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  if (!db.isPostgres) {
    console.log('⚠️  This script is for PostgreSQL only.');
    if (dbConnection.close) dbConnection.close();
    return;
  }

  console.log('✅ Connected to PostgreSQL database');
  console.log('');

  try {
    // Step 1: Get all workouts with their blocks
    const workouts = await db.query(`
      SELECT w.id as workout_id, w.name as workout_name, wb.id as block_id, wb.block_type, wb.order_index
      FROM workout w
      JOIN workout_blocks wb ON wb.workout_id = w.id
      ORDER BY w.id, wb.order_index
    `);

    console.log(`Found ${workouts.rows.length} workout blocks`);
    console.log('');

    // Step 2: Read seed files to get exercise mappings
    const seedFiles = [
      'seed_phase_one_glutes_quads_workout.sql',
      'seed_phase_one_week_workouts.sql',
      'seed_phase_two_week_workouts.sql',
      'seed_phase_three_workouts.sql'
    ];

    let totalInserted = 0;
    let totalSkipped = 0;

    for (const seedFile of seedFiles) {
      const filePath = path.join(__dirname, '..', 'db', 'seeds', seedFile);
      if (!fs.existsSync(filePath)) {
        console.log(`⚠️  File not found: ${seedFile}`);
        continue;
      }

      console.log(`📄 Processing ${seedFile}...`);
      const sql = fs.readFileSync(filePath, 'utf8');

      // Extract block_exercises INSERT statements
      const blockExerciseMatches = sql.matchAll(
        /INSERT INTO block_exercises[^;]+;/gis
      );

      for (const match of blockExerciseMatches) {
        const statement = match[0];
        
        // Extract workout name, block type, exercise name, equipment, order_index, etc.
        const workoutNameMatch = statement.match(/name = '([^']+)'/);
        const blockTypeMatch = statement.match(/block_type = '([^']+)'/);
        const exerciseNameMatch = statement.match(/exercise = '([^']+)'/);
        const equipmentMatch = statement.match(/equipment = '([^']+)'/);
        const orderIndexMatch = statement.match(/order_index,\s*(\d+)/);
        const setsMatch = statement.match(/sets,\s*(\d+)/);
        const repsMatch = statement.match(/reps,\s*(\d+)/);
        const focusRoleMatch = statement.match(/focus_role,\s*'([^']+)'/);

        if (!workoutNameMatch || !blockTypeMatch || !exerciseNameMatch) {
          continue;
        }

        const workoutName = workoutNameMatch[1];
        const blockType = blockTypeMatch[1];
        const exerciseName = exerciseNameMatch[1];
        const equipment = equipmentMatch ? equipmentMatch[1] : null;
        const orderIndex = orderIndexMatch ? parseInt(orderIndexMatch[1]) : null;
        const sets = setsMatch ? parseInt(setsMatch[1]) : null;
        const reps = repsMatch ? parseInt(repsMatch[1]) : null;
        const focusRole = focusRoleMatch ? focusRoleMatch[1] : null;

        // Find the workout and block
        const workout = workouts.rows.find(
          w => w.workout_name === workoutName && w.block_type === blockType
        );

        if (!workout) {
          console.log(`   ⚠️  Could not find block for ${workoutName} - ${blockType}`);
          continue;
        }

        // Find exercise in exercises table (plural)
        let exerciseId = null;
        
        // First try exact match
        if (equipment) {
          // For exercises table, we need to find by name only (no equipment column)
          const exerciseResult = await db.queryOne(`
            SELECT id FROM exercises WHERE name = $1 LIMIT 1
          `, [exerciseName]);
          
          if (exerciseResult) {
            exerciseId = exerciseResult.id;
          } else {
            // Try to find in exercise table and map to exercises
            const exerciseTableResult = await db.queryOne(`
              SELECT id FROM exercise 
              WHERE exercise = $1 AND equipment = $2 
              LIMIT 1
            `, [exerciseName, equipment]);
            
            if (exerciseTableResult) {
              // Find or create in exercises table
              const exercisesResult = await db.queryOne(`
                SELECT id FROM exercises WHERE name = $1 LIMIT 1
              `, [exerciseName]);
              
              if (exercisesResult) {
                exerciseId = exercisesResult.id;
              } else {
                // Create in exercises table
                const newExercise = await db.query(`
                  INSERT INTO exercises (name, description)
                  SELECT exercise, description FROM exercise 
                  WHERE exercise = $1 AND equipment = $2
                  LIMIT 1
                  ON CONFLICT (name) DO NOTHING
                  RETURNING id
                `, [exerciseName, equipment]);
                
                if (newExercise.rows && newExercise.rows[0]) {
                  exerciseId = newExercise.rows[0].id;
                } else {
                  // Try to get it after insert
                  const getExercise = await db.queryOne(`
                    SELECT id FROM exercises WHERE name = $1 LIMIT 1
                  `, [exerciseName]);
                  if (getExercise) {
                    exerciseId = getExercise.id;
                  }
                }
              }
            }
          }
        } else {
          // No equipment specified, just find by name
          const exerciseResult = await db.queryOne(`
            SELECT id FROM exercises WHERE name = $1 LIMIT 1
          `, [exerciseName]);
          
          if (exerciseResult) {
            exerciseId = exerciseResult.id;
          }
        }

        if (!exerciseId) {
          console.log(`   ⚠️  Could not find exercise: ${exerciseName} (${equipment || 'no equipment'})`);
          continue;
        }

        // Check if block_exercise already exists
        const existing = await db.queryOne(`
          SELECT id FROM block_exercises
          WHERE block_id = $1 AND exercise_id = $2 AND order_index = $3
        `, [workout.block_id, exerciseId, orderIndex || 1]);

        if (existing) {
          totalSkipped++;
          continue;
        }

        // Insert block_exercise
        try {
          await db.query(`
            INSERT INTO block_exercises (
              block_id, exercise_id, order_index, 
              sets, reps, focus_role
            )
            VALUES ($1, $2, $3, $4, $5, $6)
          `, [
            workout.block_id,
            exerciseId,
            orderIndex || 1,
            sets,
            reps,
            focusRole
          ]);
          totalInserted++;
        } catch (err) {
          if (err.code === '23505') {
            totalSkipped++;
          } else {
            console.warn(`   ⚠️  Error inserting: ${err.message.substring(0, 50)}`);
          }
        }
      }
    }

    console.log('');
    console.log(`✅ Block exercises fixed: ${totalInserted} inserted, ${totalSkipped} skipped`);

    // Verify
    const blockExercisesCount = await db.query('SELECT COUNT(*) as count FROM block_exercises');
    console.log(`Total block_exercises: ${blockExercisesCount.rows[0].count}`);

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Block Exercises Fix Complete!');
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
  fixBlockExercises()
    .then(() => {
      console.log('Fix script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fix script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixBlockExercises };




















