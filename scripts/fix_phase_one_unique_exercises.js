// Fix Phase One workouts to have 4 unique primary exercises (after deduplication)
// The deduplication function removes exercises with the same base name, so we need 4 unique base names
const { initDatabase, Database } = require('../database');

function normalizeExerciseName(label) {
  if (!label) return '';
  return label.split('(')[0].trim().toLowerCase();
}

async function fixUniquePrimaryExercises() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Fixing Phase One Workouts - Unique Exercises');
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
    const workouts = await db.query(`
      SELECT id, name, primary_focus, secondary_focus, fmp
      FROM workout
      WHERE phase = 'Phase One'
      ORDER BY id
    `);

    let totalAdded = 0;

    for (const workout of workouts.rows) {
      const primaryBlock = await db.query(`
        SELECT id FROM workout_blocks 
        WHERE workout_id = $1 AND block_type = 'primary' LIMIT 1
      `, [workout.id]);

      if (primaryBlock.rows.length === 0) continue;

      const blockId = primaryBlock.rows[0].id;

      // Get all primary exercises
      const primaryExercises = await db.query(`
        SELECT be.id, be.order_index, e.name
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        WHERE be.block_id = $1
        ORDER BY be.order_index
      `, [blockId]);

      // Get unique base names
      const uniqueBaseNames = new Set();
      primaryExercises.rows.forEach(ex => {
        const baseName = normalizeExerciseName(ex.name);
        uniqueBaseNames.add(baseName);
      });

      const uniqueCount = uniqueBaseNames.size;

      if (uniqueCount < 4) {
        console.log(`📋 ${workout.name}:`);
        console.log(`   Current unique exercises: ${uniqueCount}/4`);
        console.log(`   Existing: ${Array.from(uniqueBaseNames).join(', ')}`);
        console.log(`   Focus: ${workout.primary_focus}, FMP: ${workout.fmp}`);

        // Get all exercises in workout (all blocks) to avoid duplicates
        const allExercises = await db.query(`
          SELECT DISTINCT e.name
          FROM block_exercises be
          JOIN exercises e ON be.exercise_id = e.id
          JOIN workout_blocks wb ON be.block_id = wb.id
          WHERE wb.workout_id = $1
        `, [workout.id]);

        const allBaseNames = new Set();
        allExercises.rows.forEach(ex => {
          const baseName = normalizeExerciseName(ex.name);
          allBaseNames.add(baseName);
        });

        const needed = 4 - uniqueCount;

        // Find suitable exercises based on focus
        const focusLower = workout.primary_focus.toLowerCase();
        let candidateNames = [];

        if (focusLower.includes('quads')) {
          candidateNames = ['back squat', 'front squat', 'goblet squat', 'step-up', 'lunges', 'overhead squat', 'box squat', 'split squat'];
        } else if (focusLower.includes('glutes') || focusLower.includes('hamstring')) {
          candidateNames = ['deadlift', 'rdl', 'hip thrust', 'good morning', 'sumo deadlift', 'romanian deadlift'];
        } else if (focusLower.includes('chest') || focusLower.includes('shoulder')) {
          candidateNames = ['bench press', 'shoulder press', 'strict press', 'push press', 'overhead press', 'lateral raise', 'chest fly'];
        } else if (focusLower.includes('back')) {
          candidateNames = ['bent over row', 'bent row', 'high pull', 'pull-up', 'chin-up', 't-bar row', 'renegade row'];
        } else if (focusLower.includes('core') || focusLower.includes('stabil')) {
          candidateNames = ['rotational throw', 'swing', 'farmer carry', 'sit-up throw', 'renegade row', 'pallof press'];
        } else if (focusLower.includes('full body')) {
          candidateNames = ['clean', 'snatch', 'thruster', 'hang clean', 'muscle clean'];
        } else if (focusLower.includes('unilateral') || focusLower.includes('lunge')) {
          candidateNames = ['lunges', 'step-up', 'bulgarian split squat', 'front rack lunge', 'overhead lunge', 'lateral lunge', 'reverse lunge'];
        }

        // Filter out exercises already in workout
        const availableCandidates = candidateNames.filter(name => !allBaseNames.has(name));

        for (let i = 0; i < needed && i < availableCandidates.length; i++) {
          const candidateName = availableCandidates[i];

          // Find exercise with this name
          const exerciseResult = await db.query(`
            SELECT e.id, e.name, eq.name as equipment
            FROM exercises e
            LEFT JOIN exercise_equipment ee ON e.id = ee.exercise_id
            LEFT JOIN equipment eq ON ee.equipment_id = eq.id
            WHERE LOWER(e.name) = $1
            LIMIT 1
          `, [candidateName]);

          if (exerciseResult.rows.length > 0) {
            const exerciseId = exerciseResult.rows[0].id;
            const nextOrder = primaryExercises.rows.length + i + 1;

            await db.query(`
              INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role)
              VALUES ($1, $2, $3, 'primary')
            `, [blockId, exerciseId, nextOrder]);

            console.log(`   ✅ Added: ${exerciseResult.rows[0].name} (${exerciseResult.rows[0].equipment || 'N/A'})`);
            totalAdded++;
            allBaseNames.add(candidateName);
          }
        }

        console.log('');
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Fix Complete!');
    console.log('════════════════════════════════════════════════');
    console.log(`Total exercises added: ${totalAdded}`);
    console.log('');

    // Verify
    console.log('Verifying all workouts have 4 unique exercises...');
    for (const workout of workouts.rows) {
      const primaryBlock = await db.query(`
        SELECT id FROM workout_blocks 
        WHERE workout_id = $1 AND block_type = 'primary' LIMIT 1
      `, [workout.id]);

      if (primaryBlock.rows.length > 0) {
        const primaryExercises = await db.query(`
          SELECT e.name
          FROM block_exercises be
          JOIN exercises e ON be.exercise_id = e.id
          WHERE be.block_id = $1
          ORDER BY be.order_index
        `, [primaryBlock.rows[0].id]);

        const uniqueBaseNames = new Set();
        primaryExercises.rows.forEach(ex => {
          const baseName = normalizeExerciseName(ex.name);
          uniqueBaseNames.add(baseName);
        });

        const count = uniqueBaseNames.size;
        const status = count === 4 ? '✅' : '❌';
        console.log(`${status} ${workout.name}: ${count} unique exercises`);
      }
    }

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
  fixUniquePrimaryExercises()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixUniquePrimaryExercises };




















