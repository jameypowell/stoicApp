// Add missing primary exercises to Phase One workouts that only have 3
// This script adds one exercise to each workout that needs it
const { initDatabase, Database } = require('../database');

async function addMissingPrimaryExercises() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Adding Missing Primary Exercises');
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
    // Get all Phase One workouts
    const workouts = await db.query(`
      SELECT id, name, primary_focus, secondary_focus, fmp
      FROM workout
      WHERE phase = 'Phase One'
      ORDER BY id
    `);

    let totalAdded = 0;

    for (const workout of workouts.rows) {
      // Get primary block
      const primaryBlock = await db.query(`
        SELECT id FROM workout_blocks 
        WHERE workout_id = $1 AND block_type = 'primary' LIMIT 1
      `, [workout.id]);

      if (primaryBlock.rows.length === 0) {
        console.log(`⚠️  ${workout.name}: No primary block found`);
        continue;
      }

      const blockId = primaryBlock.rows[0].id;

      // Count current primary exercises
      const countResult = await db.query(`
        SELECT COUNT(*) as count FROM block_exercises WHERE block_id = $1
      `, [blockId]);

      const currentCount = parseInt(countResult.rows[0].count);

      if (currentCount === 3) {
        console.log(`📋 ${workout.name}:`);
        console.log(`   Current: ${currentCount}/4 primary exercises`);
        console.log(`   Focus: ${workout.primary_focus}`);
        console.log(`   FMP: ${workout.fmp}`);

        // Get existing exercises in this workout (all blocks)
        const existingExercises = await db.query(`
          SELECT DISTINCT e.name
          FROM block_exercises be
          JOIN exercises e ON be.exercise_id = e.id
          JOIN workout_blocks wb ON be.block_id = wb.id
          WHERE wb.workout_id = $1
        `, [workout.id]);

        const existingNames = new Set(existingExercises.rows.map(e => e.name.toLowerCase()));

        // Get existing primary exercises to understand what's already there
        const primaryExercises = await db.query(`
          SELECT e.name
          FROM block_exercises be
          JOIN exercises e ON be.exercise_id = e.id
          WHERE be.block_id = $1
          ORDER BY be.order_index
        `, [blockId]);

        console.log(`   Existing primary: ${primaryExercises.rows.map(e => e.name).join(', ')}`);

        // Find a suitable exercise based on focus and FMP
        const fmpArray = workout.fmp ? workout.fmp.split(',').map(f => f.trim()) : [];
        
        // Build query to find suitable exercises
        let candidateQuery = `
          SELECT DISTINCT e.id, e.name, eq.name as equipment
          FROM exercises e
          LEFT JOIN exercise_equipment ee ON e.id = ee.exercise_id
          LEFT JOIN equipment eq ON ee.equipment_id = eq.id
          WHERE LOWER(e.name) NOT IN (${Array.from(existingNames).map(n => `'${n}'`).join(',')})
        `;

        // Add focus-based filtering
        const focusLower = workout.primary_focus.toLowerCase();
        if (focusLower.includes('quads')) {
          candidateQuery += ` AND LOWER(e.name) IN ('back squat', 'front squat', 'goblet squat', 'step-up', 'lunges', 'overhead squat', 'box squat')`;
        } else if (focusLower.includes('glutes') || focusLower.includes('hamstring')) {
          candidateQuery += ` AND LOWER(e.name) IN ('deadlift', 'rdl', 'hip thrust', 'good morning', 'sumo deadlift')`;
        } else if (focusLower.includes('chest') || focusLower.includes('shoulder')) {
          candidateQuery += ` AND LOWER(e.name) IN ('bench press', 'shoulder press', 'strict press', 'push press', 'overhead press', 'lateral raise')`;
        } else if (focusLower.includes('back')) {
          candidateQuery += ` AND LOWER(e.name) IN ('bent over row', 'bent row', 'high pull', 'pull-up', 'chin-up', 't-bar row')`;
        } else if (focusLower.includes('core') || focusLower.includes('stabil')) {
          candidateQuery += ` AND LOWER(e.name) IN ('rotational throw', 'swing', 'farmer carry', 'sit-up throw', 'renegade row')`;
        } else if (focusLower.includes('full body')) {
          candidateQuery += ` AND LOWER(e.name) IN ('clean', 'snatch', 'thruster', 'hang clean')`;
        } else if (focusLower.includes('unilateral') || focusLower.includes('lunge')) {
          candidateQuery += ` AND LOWER(e.name) IN ('lunges', 'step-up', 'bulgarian split squat', 'front rack lunge', 'overhead lunge', 'lateral lunge')`;
        }

        candidateQuery += ` LIMIT 10`;

        const candidates = await db.query(candidateQuery);

        if (candidates.rows.length > 0) {
          // Pick the first candidate
          const candidate = candidates.rows[0];
          const nextOrder = currentCount + 1;

          await db.query(`
            INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role)
            VALUES ($1, $2, $3, 'primary')
          `, [blockId, candidate.id, nextOrder]);

          console.log(`   ✅ Added: ${candidate.name} (${candidate.equipment || 'N/A'})`);
          totalAdded++;
        } else {
          console.log(`   ⚠️  No suitable candidates found`);
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

    // Verify all workouts now have 4 primary exercises
    console.log('Verifying all workouts...');
    for (const workout of workouts.rows) {
      const primaryBlock = await db.query(`
        SELECT id FROM workout_blocks 
        WHERE workout_id = $1 AND block_type = 'primary' LIMIT 1
      `, [workout.id]);

      if (primaryBlock.rows.length > 0) {
        const countResult = await db.query(`
          SELECT COUNT(*) as count FROM block_exercises WHERE block_id = $1
        `, [primaryBlock.rows[0].id]);

        const count = parseInt(countResult.rows[0].count);
        const status = count === 4 ? '✅' : '❌';
        console.log(`${status} ${workout.name}: ${count}/4 primary exercises`);
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
  addMissingPrimaryExercises()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addMissingPrimaryExercises };




















