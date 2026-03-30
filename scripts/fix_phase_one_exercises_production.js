// Fix Phase One workouts to ensure each has exactly 4 primary and 2 secondary exercises
// Adds missing exercises based on primary_focus, secondary_focus, and FMP requirements
const { initDatabase, Database } = require('../database');

// Exercise selection logic based on focus and FMP
const exerciseMap = {
  // Quads exercises (Squat FMP)
  'Quads': [
    { name: 'Back Squat', equipment: 'Barbell', fmp: 'Squat' },
    { name: 'Front Squat', equipment: 'Barbell', fmp: 'Squat' },
    { name: 'Goblet Squat', equipment: 'Dumbbell', fmp: 'Squat' },
    { name: 'Goblet Squat', equipment: 'Kettlebell', fmp: 'Squat' },
    { name: 'Step-Up', equipment: 'Dumbbell', fmp: 'Lunge' },
    { name: 'Lunges', equipment: 'Dumbbell', fmp: 'Lunge' },
    { name: 'Lunges', equipment: 'Weighted Bar', fmp: 'Lunge' },
    { name: 'Overhead Squat', equipment: 'Barbell', fmp: 'Squat' },
    { name: 'Box Squat', equipment: 'Barbell', fmp: 'Squat' },
  ],
  
  // Glutes/Hamstrings exercises (Hinge FMP)
  'Glutes/Hamstrings': [
    { name: 'Deadlift', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'RDL', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'RDL', equipment: 'Dumbbell', fmp: 'Hinge' },
    { name: 'RDL', equipment: 'Kettlebell', fmp: 'Hinge' },
    { name: 'RDL', equipment: 'Sandbag', fmp: 'Hinge' },
    { name: 'Hip Thrust', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'Good Morning', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'Good Morning', equipment: 'Weighted Bar', fmp: 'Hinge' },
    { name: 'Deadlift', equipment: 'Dumbbell', fmp: 'Hinge' },
    { name: 'Deadlift', equipment: 'Kettlebell', fmp: 'Hinge' },
    { name: 'Deadlift', equipment: 'Sandbag', fmp: 'Hinge' },
    { name: 'Sumo Deadlift', equipment: 'Barbell', fmp: 'Hinge' },
  ],
  
  'Glutes': [
    { name: 'Hip Thrust', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'Deadlift', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'RDL', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'RDL', equipment: 'Dumbbell', fmp: 'Hinge' },
    { name: 'RDL', equipment: 'Kettlebell', fmp: 'Hinge' },
    { name: 'Good Morning', equipment: 'Barbell', fmp: 'Hinge' },
    { name: 'Deadlift', equipment: 'Dumbbell', fmp: 'Hinge' },
    { name: 'Deadlift', equipment: 'Kettlebell', fmp: 'Hinge' },
    { name: 'Sumo Deadlift', equipment: 'Barbell', fmp: 'Hinge' },
  ],
  
  // Chest/Shoulders exercises (Push FMP)
  'Chest/Shoulders': [
    { name: 'Bench Press', equipment: 'Barbell', fmp: 'Push' },
    { name: 'Bench Press', equipment: 'Dumbbell', fmp: 'Push' },
    { name: 'Strict Press', equipment: 'Barbell', fmp: 'Push' },
    { name: 'Shoulder Press', equipment: 'Dumbbell', fmp: 'Push' },
    { name: 'Push Press', equipment: 'Barbell', fmp: 'Push' },
    { name: 'Overhead Press', equipment: 'Dumbbell', fmp: 'Push' },
    { name: 'Lateral Raise', equipment: 'Dumbbell', fmp: 'Push' },
    { name: 'Chest Fly', equipment: 'Dumbbell', fmp: 'Push' },
  ],
  
  // Back exercises (Pull FMP)
  'Back': [
    { name: 'Bent Over Row', equipment: 'Barbell', fmp: 'Pull' },
    { name: 'Bent Row', equipment: 'Dumbbell', fmp: 'Pull' },
    { name: 'Bent Row', equipment: 'Weighted Bar', fmp: 'Pull' },
    { name: 'High Pull', equipment: 'Barbell', fmp: 'Pull' },
    { name: 'Pull-Up', equipment: 'Pull Up Bar', fmp: 'Pull' },
    { name: 'Chin-Up', equipment: 'Pull Up Bar', fmp: 'Pull' },
    { name: 'T-Bar Row', equipment: 'T-Bar Handle', fmp: 'Pull' },
    { name: 'Renegade Row', equipment: 'Dumbbell', fmp: 'Pull' },
  ],
  
  // Core/Stabilization exercises
  'Core/Stabilization': [
    { name: 'Rotational Throw', equipment: 'Medicine Ball', fmp: 'Rotation/Core' },
    { name: 'Rotational Throw', equipment: 'Sandbag', fmp: 'Rotation/Core' },
    { name: 'Sit-Up Throw', equipment: 'Medicine Ball', fmp: 'Rotation/Core' },
    { name: 'Renegade Row', equipment: 'Dumbbell', fmp: 'Rotation/Core' },
    { name: 'Swing', equipment: 'Kettlebell', fmp: 'Hinge,Rotation/Core' },
    { name: 'Farmer Carry', equipment: 'Dumbbell', fmp: 'Gait/Carry' },
    { name: 'Farmer Carry', equipment: 'Kettlebell', fmp: 'Gait/Carry' },
    { name: 'Pallof Press', equipment: 'Band', fmp: 'Rotation/Core' },
    { name: 'Diagonal Chop', equipment: 'Band', fmp: 'Rotation/Core' },
    { name: 'Rotational Scoop Toss', equipment: 'Medicine Ball', fmp: 'Rotation/Core' },
  ],
  
  'Core/Stability': [
    { name: 'Rotational Throw', equipment: 'Medicine Ball', fmp: 'Rotation/Core' },
    { name: 'Rotational Throw', equipment: 'Sandbag', fmp: 'Rotation/Core' },
    { name: 'Sit-Up Throw', equipment: 'Medicine Ball', fmp: 'Rotation/Core' },
    { name: 'Renegade Row', equipment: 'Dumbbell', fmp: 'Rotation/Core' },
    { name: 'Swing', equipment: 'Kettlebell', fmp: 'Hinge,Rotation/Core' },
    { name: 'Farmer Carry', equipment: 'Dumbbell', fmp: 'Gait/Carry' },
    { name: 'Farmer Carry', equipment: 'Kettlebell', fmp: 'Gait/Carry' },
    { name: 'Pallof Press', equipment: 'Band', fmp: 'Rotation/Core' },
    { name: 'Diagonal Chop', equipment: 'Band', fmp: 'Rotation/Core' },
  ],
  
  // Full Body exercises (Complex Lift FMP)
  'Full Body': [
    { name: 'Clean', equipment: 'Barbell', fmp: 'Complex Lift' },
    { name: 'Clean', equipment: 'Kettlebell', fmp: 'Complex Lift' },
    { name: 'Snatch', equipment: 'Barbell', fmp: 'Complex Lift' },
    { name: 'Thruster', equipment: 'Barbell', fmp: 'Complex Lift' },
    { name: 'Thruster', equipment: 'Dumbbell', fmp: 'Complex Lift' },
    { name: 'Thruster', equipment: 'Kettlebell', fmp: 'Complex Lift' },
    { name: 'Hang Clean', equipment: 'Barbell', fmp: 'Complex Lift' },
  ],
  
  // Unilateral Lower exercises (Lunge FMP)
  'Glutes/Quads Unilateral': [
    { name: 'Lunges', equipment: 'Dumbbell', fmp: 'Lunge' },
    { name: 'Lunges', equipment: 'Weighted Bar', fmp: 'Lunge' },
    { name: 'Step-Up', equipment: 'Dumbbell', fmp: 'Lunge' },
    { name: 'Bulgarian Split Squat', equipment: 'Dumbbell', fmp: 'Lunge' },
    { name: 'Front Rack Lunge', equipment: 'Barbell', fmp: 'Lunge' },
    { name: 'Overhead Lunge', equipment: 'Barbell', fmp: 'Lunge' },
    { name: 'Lateral Lunge', equipment: 'Dumbbell', fmp: 'Lunge' },
  ],
  
  // Shoulders/Back exercises
  'Shoulders/Back': [
    { name: 'Shoulder Press', equipment: 'Barbell', fmp: 'Push' },
    { name: 'Shoulder Press', equipment: 'Dumbbell', fmp: 'Push' },
    { name: 'Bent Over Row', equipment: 'Barbell', fmp: 'Pull' },
    { name: 'Bent Row', equipment: 'Dumbbell', fmp: 'Pull' },
    { name: 'High Pull', equipment: 'Barbell', fmp: 'Pull' },
    { name: 'Pull-Up', equipment: 'Pull-Up Bar', fmp: 'Pull' },
  ],
  
  // Mobility/Recovery exercises
  'Mobility/Recovery': [
    { name: 'Foam Roll', equipment: 'Foam Roller', fmp: 'Rotation/Core' },
    { name: 'Stretch', equipment: 'Bodyweight', fmp: 'Rotation/Core' },
  ],
};

async function getAvailableExercises(focus, fmpList, existingExercises) {
  const existingNames = new Set(existingExercises.map(e => e.name.toLowerCase()));
  const fmpArray = fmpList ? fmpList.split(',').map(f => f.trim()) : [];
  
  // Get exercises for this focus
  let candidates = exerciseMap[focus] || [];
  
  // Filter by FMP if specified - exercise FMP should contain at least one of the workout FMPs
  if (fmpArray.length > 0) {
    candidates = candidates.filter(ex => {
      const exFmpArray = ex.fmp.split(',').map(f => f.trim());
      return fmpArray.some(workoutFmp => 
        exFmpArray.some(exFmp => exFmp.includes(workoutFmp) || workoutFmp.includes(exFmp))
      );
    });
  }
  
  // Remove duplicates (by name, case-insensitive)
  const uniqueCandidates = [];
  const seen = new Set();
  
  for (const candidate of candidates) {
    const key = candidate.name.toLowerCase();
    if (!seen.has(key) && !existingNames.has(key)) {
      seen.add(key);
      uniqueCandidates.push(candidate);
    }
  }
  
  return uniqueCandidates;
}

async function fixPhaseOneWorkouts() {
  console.log('════════════════════════════════════════════════');
  console.log('🔧 Fixing Phase One Workouts');
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
      // Get current blocks
      const blocks = await db.query(`
        SELECT wb.id, wb.block_type, wb.title, wb.order_index
        FROM workout_blocks wb
        WHERE wb.workout_id = $1
        ORDER BY wb.order_index
      `, [workout.id]);

      const primaryBlock = blocks.rows.find(b => b.block_type === 'primary');
      const secondaryBlock = blocks.rows.find(b => b.block_type === 'secondary');

      if (!primaryBlock || !secondaryBlock) {
        console.log(`⚠️  ${workout.name}: Missing primary or secondary block`);
        continue;
      }

      // Get existing exercises for this workout
      const existingExercises = await db.query(`
        SELECT 
          e.name as exercise_name,
          be.order_index,
          wb.block_type
        FROM block_exercises be
        JOIN exercises e ON be.exercise_id = e.id
        JOIN workout_blocks wb ON be.block_id = wb.id
        WHERE wb.workout_id = $1
        ORDER BY wb.order_index, be.order_index
      `, [workout.id]);

      const primaryExercises = existingExercises.rows.filter(e => e.block_type === 'primary');
      const secondaryExercises = existingExercises.rows.filter(e => e.block_type === 'secondary');
      const allExercises = existingExercises.rows.map(e => ({ name: e.exercise_name }));

      const primaryNeeded = 4 - primaryExercises.length;
      const secondaryNeeded = 2 - secondaryExercises.length;

      if (primaryNeeded > 0 || secondaryNeeded > 0) {
        console.log(`📋 ${workout.name}:`);
        console.log(`   Primary: ${primaryExercises.length}/4 (need ${primaryNeeded} more)`);
        console.log(`   Secondary: ${secondaryExercises.length}/2 (need ${secondaryNeeded} more)`);
        console.log(`   Focus: ${workout.primary_focus} / ${workout.secondary_focus}`);
        console.log(`   FMP: ${workout.fmp}`);

        // Get available exercises for primary focus
        if (primaryNeeded > 0) {
          const primaryCandidates = await getAvailableExercises(
            workout.primary_focus,
            workout.fmp,
            allExercises
          );

          if (primaryCandidates.length < primaryNeeded) {
            console.log(`   ⚠️  Warning: Only ${primaryCandidates.length} candidates available for primary, need ${primaryNeeded}`);
          }

          for (let i = 0; i < primaryNeeded && i < primaryCandidates.length; i++) {
            const candidate = primaryCandidates[i];
            
            // Find exercise ID
            const exerciseResult = await db.query(`
              SELECT e.id
              FROM exercises e
              LEFT JOIN exercise_equipment ee ON e.id = ee.exercise_id
              LEFT JOIN equipment eq ON ee.equipment_id = eq.id
              WHERE LOWER(e.name) = LOWER($1)
                AND LOWER(eq.name) = LOWER($2)
              LIMIT 1
            `, [candidate.name, candidate.equipment]);

            if (exerciseResult.rows.length === 0) {
              console.log(`   ⚠️  Exercise not found: ${candidate.name} (${candidate.equipment})`);
              continue;
            }

            const exerciseId = exerciseResult.rows[0].id;
            const nextOrder = primaryExercises.length + i + 1;

            await db.query(`
              INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role)
              VALUES ($1, $2, $3, 'primary')
            `, [primaryBlock.id, exerciseId, nextOrder]);

            console.log(`   ✅ Added primary: ${candidate.name} (${candidate.equipment})`);
            totalAdded++;
            allExercises.push({ name: candidate.name });
          }
        }

        // Get available exercises for secondary focus
        if (secondaryNeeded > 0) {
          const secondaryCandidates = await getAvailableExercises(
            workout.secondary_focus,
            workout.fmp,
            allExercises
          );

          if (secondaryCandidates.length < secondaryNeeded) {
            console.log(`   ⚠️  Warning: Only ${secondaryCandidates.length} candidates available for secondary, need ${secondaryNeeded}`);
          }

          for (let i = 0; i < secondaryNeeded && i < secondaryCandidates.length; i++) {
            const candidate = secondaryCandidates[i];
            
            // Find exercise ID
            const exerciseResult = await db.query(`
              SELECT e.id
              FROM exercises e
              LEFT JOIN exercise_equipment ee ON e.id = ee.exercise_id
              LEFT JOIN equipment eq ON ee.equipment_id = eq.id
              WHERE LOWER(e.name) = LOWER($1)
                AND LOWER(eq.name) = LOWER($2)
              LIMIT 1
            `, [candidate.name, candidate.equipment]);

            if (exerciseResult.rows.length === 0) {
              console.log(`   ⚠️  Exercise not found: ${candidate.name} (${candidate.equipment})`);
              continue;
            }

            const exerciseId = exerciseResult.rows[0].id;
            const nextOrder = secondaryExercises.length + i + 1;

            await db.query(`
              INSERT INTO block_exercises (block_id, exercise_id, order_index, focus_role)
              VALUES ($1, $2, $3, 'secondary')
            `, [secondaryBlock.id, exerciseId, nextOrder]);

            console.log(`   ✅ Added secondary: ${candidate.name} (${candidate.equipment})`);
            totalAdded++;
            allExercises.push({ name: candidate.name });
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

    // Verify all workouts now have correct counts
    console.log('Verifying all workouts...');
    for (const workout of workouts.rows) {
      const blocks = await db.query(`
        SELECT wb.block_type, COUNT(be.id) as exercise_count
        FROM workout_blocks wb
        LEFT JOIN block_exercises be ON wb.id = be.block_id
        WHERE wb.workout_id = $1
        GROUP BY wb.block_type
      `, [workout.id]);

      const primaryCount = blocks.rows.find(b => b.block_type === 'primary')?.exercise_count || 0;
      const secondaryCount = blocks.rows.find(b => b.block_type === 'secondary')?.exercise_count || 0;

      const status = (primaryCount === 4 && secondaryCount === 2) ? '✅' : '❌';
      console.log(`${status} ${workout.name}: Primary ${primaryCount}/4, Secondary ${secondaryCount}/2`);
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
  fixPhaseOneWorkouts()
    .then(() => {
      console.log('');
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { fixPhaseOneWorkouts };

