// Seed script for strength workout reference data (Phase 2) - Simplified version
// Seeds: equipment, exercises (from exercise table), workout_formats, workout_types
// Works with both SQLite (dev) and Postgres (production)
// Executes SQL seed files directly, converting syntax as needed

const { initDatabase, Database } = require('../database');
const fs = require('fs');
const path = require('path');

async function seedReferenceData() {
  console.log('════════════════════════════════════════════════');
  console.log('🌱 Seeding Strength Workout Reference Data');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log(`✅ Connected to ${db.isPostgres ? 'PostgreSQL' : 'SQLite'} database`);
  console.log('');

  try {
    // Helper to convert SQLite SQL to Postgres SQL
    function convertToPostgres(sql) {
      if (!db.isPostgres) return sql;
      
      // Convert INSERT OR IGNORE to INSERT ... ON CONFLICT DO NOTHING
      // This is a simplified conversion - assumes first column is unique
      sql = sql.replace(/INSERT OR IGNORE INTO (\w+)/gi, (match, table) => {
        // For equipment, name is unique
        if (table === 'equipment') {
          return `INSERT INTO ${table}`;
        }
        // For workout_formats, we'll handle name uniqueness
        if (table === 'workout_formats') {
          return `INSERT INTO ${table}`;
        }
        // For exercise, exercise+equipment combination should be unique
        // But we'll use a simpler approach: just convert the syntax
        return `INSERT INTO ${table}`;
      });

      // Add ON CONFLICT clauses where appropriate
      // This is a simplified approach - for production, we'd want more robust parsing
      if (db.isPostgres) {
        // For equipment table
        sql = sql.replace(
          /INSERT INTO equipment \(name\) VALUES([^;]+);/gi,
          (match, values) => {
            return `INSERT INTO equipment (name) VALUES${values} ON CONFLICT (name) DO NOTHING;`;
          }
        );

        // For workout_formats - we'll handle this separately with proper conflict resolution
        // For now, we'll use a different approach: execute and catch errors
      }

      return sql;
    }

    // Helper to execute SQL file
    async function executeSqlFile(filePath, description) {
      if (!fs.existsSync(filePath)) {
        console.log(`   ⚠️  File not found: ${filePath}`);
        return;
      }

      console.log(`   Processing ${description}...`);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      
      // Split by semicolons to get individual statements
      const statements = sqlContent
        .split(';')
        .map(s => s.trim())
        .filter(s => s.length > 0 && !s.startsWith('--'));

      let executed = 0;
      for (const statement of statements) {
        try {
          // Convert SQLite syntax to Postgres if needed
          let convertedSql = convertToPostgres(statement);
          
          // For Postgres, handle INSERT OR IGNORE more carefully
          if (db.isPostgres && convertedSql.includes('INSERT INTO')) {
            // Try to add ON CONFLICT for known tables
            if (convertedSql.includes('INSERT INTO equipment')) {
              // Equipment: name is unique
              if (!convertedSql.includes('ON CONFLICT')) {
                convertedSql = convertedSql.replace(
                  /INSERT INTO equipment \(name\) VALUES/i,
                  'INSERT INTO equipment (name) VALUES'
                );
                // Add ON CONFLICT at the end before semicolon
                convertedSql = convertedSql.replace(/;?\s*$/, ' ON CONFLICT (name) DO NOTHING;');
              }
            } else if (convertedSql.includes('INSERT INTO workout_formats')) {
              // Workout_formats: name should be unique (we'll add a unique constraint if needed)
              // For now, we'll catch the error and continue
            } else if (convertedSql.includes('INSERT INTO exercise')) {
              // Exercise: we'll handle duplicates by checking first
              // For now, just execute and catch unique constraint errors
            } else if (convertedSql.includes('INSERT INTO workout_types')) {
              // Workout_types: code is unique
              if (!convertedSql.includes('ON CONFLICT')) {
                convertedSql = convertedSql.replace(/;?\s*$/, ' ON CONFLICT (code) DO NOTHING;');
              }
            }
          }

          await db.query(convertedSql);
          executed++;
        } catch (error) {
          // Ignore duplicate key errors
          if (error.message.includes('duplicate key') || 
              error.message.includes('UNIQUE constraint') ||
              error.message.includes('already exists')) {
            // Expected for idempotent inserts
            continue;
          } else {
            console.warn(`   ⚠️  Warning executing statement: ${error.message}`);
            // Continue with other statements
          }
        }
      }
      
      console.log(`   ✅ Executed ${executed} statements from ${description}`);
    }

    // 1. Seed workout_types
    console.log('1. Seeding workout_types...');
    if (db.isPostgres) {
      await db.query(`
        INSERT INTO workout_types (code, label, description)
        VALUES ('STRENGTH', 'Strength Workout', 'Strength-focused workout format')
        ON CONFLICT (code) DO NOTHING
      `);
    } else {
      await db.query(`
        INSERT OR IGNORE INTO workout_types (code, label, description)
        VALUES ('STRENGTH', 'Strength Workout', 'Strength-focused workout format')
      `);
    }
    console.log('   ✅ workout_types seeded');

    // 2. Seed equipment
    console.log('2. Seeding equipment...');
    await executeSqlFile(
      path.join(__dirname, '..', 'db', 'seeds', 'seed_equipment.sql'),
      'equipment'
    );

    // 3. Seed workout_formats
    console.log('3. Seeding workout_formats...');
    const formatsPath = path.join(__dirname, '..', 'db', 'seeds', 'seed_workout_formats.sql');
    if (fs.existsSync(formatsPath)) {
      const formatsSql = fs.readFileSync(formatsPath, 'utf8');
      
      // Parse and insert each format
      const formatMatches = formatsSql.matchAll(/INSERT OR IGNORE INTO workout_formats[^;]+;/gis);
      
      for (const match of formatMatches) {
        let statement = match[0];
        
        if (db.isPostgres) {
          // Convert to Postgres syntax
          statement = statement.replace('INSERT OR IGNORE INTO', 'INSERT INTO');
          // Extract the VALUES part
          const valuesMatch = statement.match(/VALUES\s+(.+);/is);
          if (valuesMatch) {
            // For Postgres, we need to handle the JSON properly and add ON CONFLICT
            // Since workout_formats.name might not have a unique constraint yet, we'll
            // use a different approach: check if exists first, then insert
            const nameMatch = statement.match(/name\s*=\s*'([^']+)'/i);
            if (nameMatch) {
              const formatName = nameMatch[1];
              // Check if format exists
              const existing = await db.queryOne(`
                SELECT id FROM workout_formats WHERE name = $1
              `, [formatName]);
              
              if (!existing) {
                // Insert the format
                statement = statement.replace('INSERT INTO workout_formats', 'INSERT INTO workout_formats');
                // Remove the semicolon and add ON CONFLICT
                statement = statement.replace(/;?\s*$/, ' ON CONFLICT (name) DO NOTHING;');
                await db.query(statement);
              }
            }
          }
        } else {
          await db.query(statement);
        }
      }
      
      // Also ensure we have the correct format JSON by updating if needed
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

      if (db.isPostgres) {
        await db.query(`
          UPDATE workout_formats 
          SET format_json = $1 
          WHERE name = $2
        `, [phaseThreeFormat.format_json, phaseThreeFormat.name]);
      } else {
        await db.query(`
          UPDATE workout_formats 
          SET format_json = ? 
          WHERE name = ?
        `, [phaseThreeFormat.format_json, phaseThreeFormat.name]);
      }
    }
    console.log('   ✅ workout_formats seeded');

    // 4. Seed exercises - execute all exercise seed files
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

    for (const file of exerciseFiles) {
      const filePath = path.join(__dirname, '..', 'db', 'seeds', file);
      await executeSqlFile(filePath, file);
    }

    // Ensure "Romanian Deadlift" and "Alternating Single Arm Swing" are correctly named
    console.log('5. Updating exercise names (Romanian Deadlift, Alternating Single Arm Swing)...');
    if (db.isPostgres) {
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
    } else {
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
    }
    console.log('   ✅ Exercise names updated');

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Reference Data Seeding Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Next step: Run seed_strength_workouts.js to seed Phase One, Two, and Three workouts');
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

// Run if called directly
if (require.main === module) {
  seedReferenceData()
    .then(() => {
      console.log('Seed script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed script failed:', error);
      process.exit(1);
    });
}

module.exports = { seedReferenceData };




















