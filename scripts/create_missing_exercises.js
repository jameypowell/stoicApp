// Create missing exercises and link them to equipment
const { initDatabase, Database } = require('../database');

async function createMissingExercises() {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  if (!db.isPostgres) {
    console.log('⚠️  This script is for PostgreSQL production only.');
    if (dbConnection.close) dbConnection.close();
    return;
  }

  const exercisesToCreate = [
    { name: 'Single Leg Romanian Deadlift', equipment: 'Kettlebell' },
    { name: 'Squat to Overhead Slam', equipment: 'Medicine Ball' },
    { name: 'Push-Ups', equipment: null },
    { name: 'Deficit Sumo Squat', equipment: 'Kettlebell' },
    { name: 'Wall Ball Squat Toss', equipment: 'Medicine Ball' },
    { name: 'Plank to Pike', equipment: null },
    { name: 'Lateral Shoulder Fly', equipment: 'Dumbbell' },
    { name: 'Farmer Carry 30m', equipment: 'Kettlebell' },
    { name: 'Front Rack Forward Lunge', equipment: null },
    { name: 'Overhead Reverse Lunge', equipment: 'Weighted Bar' },
    { name: 'Alternating Over the Shoulder Toss', equipment: null },
    { name: 'Squat Thruster', equipment: 'Barbell' },
    { name: 'Alternating Single Arm Snatch', equipment: 'Dumbbell' },
    { name: 'Alternating Shoulder Press', equipment: 'Dumbbell' },
    { name: 'Banded Pull Aparts', equipment: 'Monster/Super Band' },
    { name: 'Weighted Overhead Sit-up', equipment: 'Medicine Ball' },
    { name: 'Iso Squat Hold with Upright Row', equipment: 'Dumbbell' },
    { name: 'Active Stance Anchored Banded Chest Press, Each Side', equipment: 'Tube/Handle Band' },
  ];

  console.log('Creating missing exercises...');
  console.log('');

  for (const ex of exercisesToCreate) {
    // Check if exercise already exists
    const existing = await db.query(`
      SELECT id FROM exercises WHERE LOWER(name) = LOWER($1) LIMIT 1
    `, [ex.name]);

    if (existing.rows.length > 0) {
      console.log(`✅ Already exists: ${ex.name}`);
      continue;
    }

    // Create exercise
    const result = await db.query(`
      INSERT INTO exercises (name, description, created_at, updated_at)
      VALUES ($1, NULL, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
      RETURNING id
    `, [ex.name]);

    const exerciseId = result.rows[0].id;
    console.log(`✅ Created: ${ex.name} (ID: ${exerciseId})`);

    // Link equipment if specified
    if (ex.equipment) {
      const equipmentResult = await db.query(`
        SELECT id FROM equipment WHERE LOWER(name) = LOWER($1) LIMIT 1
      `, [ex.equipment]);

      if (equipmentResult.rows.length > 0) {
        await db.query(`
          INSERT INTO exercise_equipment (exercise_id, equipment_id)
          VALUES ($1, $2)
          ON CONFLICT DO NOTHING
        `, [exerciseId, equipmentResult.rows[0].id]);
        console.log(`   Linked to: ${ex.equipment}`);
      } else {
        console.log(`   ⚠️  Equipment "${ex.equipment}" not found`);
      }
    }
  }

  console.log('');
  console.log('✅ All exercises created');

  if (db.isPostgres) {
    await dbConnection.end();
  }
}

if (require.main === module) {
  createMissingExercises()
    .then(() => {
      console.log('Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Script failed:', error);
      process.exit(1);
    });
}

module.exports = { createMissingExercises };




















