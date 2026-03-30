// Direct seeding script for reference data - executes SQL files properly
const { initDatabase, Database } = require('../database');
const fs = require('fs');
const path = require('path');

async function seedReferenceDataDirect() {
  console.log('════════════════════════════════════════════════');
  console.log('🌱 Seeding Reference Data (Direct SQL Execution)');
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
    // 1. Seed workout_types
    console.log('1. Seeding workout_types...');
    await db.query(`
      INSERT INTO workout_types (code, label, description)
      VALUES ('STRENGTH', 'Strength Workout', 'Strength-focused workout format')
      ON CONFLICT (code) DO NOTHING
    `);
    console.log('   ✅ workout_types seeded');

    // 2. Seed equipment - read SQL file and convert
    console.log('2. Seeding equipment...');
    const equipmentPath = path.join(__dirname, '..', 'db', 'seeds', 'seed_equipment.sql');
    if (fs.existsSync(equipmentPath)) {
      const equipmentSql = fs.readFileSync(equipmentPath, 'utf8');
      // Convert INSERT OR IGNORE to INSERT ... ON CONFLICT
      const convertedSql = equipmentSql
        .replace(/INSERT OR IGNORE INTO equipment/i, 'INSERT INTO equipment')
        .replace(/;?\s*$/, ' ON CONFLICT (name) DO NOTHING;');
      
      await db.query(convertedSql);
      console.log('   ✅ Equipment seeded');
    }

    // 3. Seed workout_formats
    console.log('3. Seeding workout_formats...');
    const formatsPath = path.join(__dirname, '..', 'db', 'seeds', 'seed_workout_formats.sql');
    if (fs.existsSync(formatsPath)) {
      const formatsSql = fs.readFileSync(formatsPath, 'utf8');
      
      // Parse each INSERT statement
      const insertMatches = formatsSql.matchAll(/INSERT OR IGNORE INTO workout_formats\s*\([^)]+\)\s*VALUES\s*\([^)]+\)/gis);
      
      for (const match of insertMatches) {
        let statement = match[0];
        // Convert to Postgres
        statement = statement.replace('INSERT OR IGNORE INTO workout_formats', 'INSERT INTO workout_formats');
        
        // Extract name to check if exists
        const nameMatch = statement.match(/name\s*=\s*'([^']+)'/i) || statement.match(/'([^']+)',\s*'Phase/);
        if (nameMatch) {
          const formatName = nameMatch[1];
          const existing = await db.queryOne(`
            SELECT id FROM workout_formats WHERE name = $1
          `, [formatName]);
          
          if (!existing) {
            // Add ON CONFLICT
            statement = statement.replace(/;?\s*$/, ' ON CONFLICT (name) DO NOTHING;');
            await db.query(statement);
          }
        }
      }
      
      // Also ensure Phase Three format has correct JSON
      const phaseThreeFormat = {
        name: 'Phase Three – Advanced',
        format_json: JSON.stringify({
          warmup: {
            instructions: "2 sets of 10 reps each",
            exercise_count: 3
          },
          format_title: "Phase Three Format",
          format_bullets: [
            "Find 2-4RM Using the 1RM Calc",
            "85%-90% of 1RM for 3 Sets of Each Exercise",
            "One exercise at a time for all 3 sets",
            "Tempo 3-2-1-0",
            "3 Second Eccentric, 2 Second Bottom Pause, 1 Second Concentric, 0/No Top Pause"
          ],
          primary_format: {
            steps: [
              "One exercise at a time for all three sets",
              "Tempo per rep: 2-0-2 (2s eccentric, 0 pause, 2s concentric)",
              "Find 2–4 rep max then complete 3 working sets for each primary exercise"
            ]
          },
          primary_exercise_count: 3,
          finisher: {
            instructions: "2 sets max reps each",
            exercise_count: 3
          }
        })
      };

      await db.query(`
        UPDATE workout_formats 
        SET format_json = $1 
        WHERE name = $2
      `, [phaseThreeFormat.format_json, phaseThreeFormat.name]);
    }
    console.log('   ✅ workout_formats seeded');

    // 4. Seed exercises - read all exercise seed files
    console.log('4. Seeding exercises...');
    const exerciseFiles = [
      'seed_exercises.sql',
      'seed_exercises_part2.sql',
      'seed_exercises_part3.sql',
      'seed_exercises_part4.sql',
      'seed_exercises_part5.sql',
      'seed_exercises_part6.sql',
      'seed_exercises_part7.sql',
      'seed_exercises_part8.sql',
      'seed_foam_roller_exercises.sql'
    ];

    let totalExercises = 0;
    for (const file of exerciseFiles) {
      const filePath = path.join(__dirname, '..', 'db', 'seeds', file);
      if (fs.existsSync(filePath)) {
        const sql = fs.readFileSync(filePath, 'utf8');
        // Convert INSERT OR IGNORE to INSERT
        let convertedSql = sql.replace(/INSERT OR IGNORE INTO exercise/gi, 'INSERT INTO exercise');
        
        // Split by semicolons and process each INSERT
        const statements = convertedSql.split(';').filter(s => s.trim().length > 0 && s.includes('INSERT'));
        
        for (const statement of statements) {
          try {
            // For exercise table, we need to handle the fact that there's no unique constraint
            // So we'll check if exists first, or just insert and catch errors
            const trimmed = statement.trim();
            if (trimmed.startsWith('INSERT INTO exercise')) {
              // Extract values to check for duplicates
              const valuesMatch = trimmed.match(/VALUES\s*\(([^)]+)\)/i);
              if (valuesMatch) {
                // Try to insert - if it fails due to duplicate, that's okay
                try {
                  await db.query(trimmed + ';');
                  totalExercises++;
                } catch (err) {
                  // Ignore duplicate errors
                  if (!err.message.includes('duplicate') && !err.message.includes('UNIQUE')) {
                    throw err;
                  }
                }
              }
            }
          } catch (error) {
            // Continue with next statement
            if (!error.message.includes('duplicate') && !error.message.includes('UNIQUE')) {
              console.warn(`   ⚠️  Warning: ${error.message.substring(0, 50)}`);
            }
          }
        }
      }
    }
    console.log(`   ✅ Seeded ${totalExercises} exercises`);

    // 5. Update exercise names
    console.log('5. Updating exercise names...');
    await db.query(`
      UPDATE exercise 
      SET exercise = 'Romanian Deadlift' 
      WHERE exercise = 'RDL' AND equipment = 'Dumbbell'
    `);
    await db.query(`
      UPDATE exercise 
      SET exercise = 'Alternating Single Arm Swing' 
      WHERE exercise = 'Alternating Swing' AND equipment = 'Kettlebell'
    `);
    console.log('   ✅ Exercise names updated');

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Reference Data Seeding Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error during seeding:', error);
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
  seedReferenceDataDirect()
    .then(() => {
      console.log('Seed script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed script failed:', error);
      process.exit(1);
    });
}

module.exports = { seedReferenceDataDirect };




















