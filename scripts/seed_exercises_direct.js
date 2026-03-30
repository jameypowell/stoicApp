// Direct exercise seeding - reads SQL files and executes properly
const { initDatabase, Database } = require('../database');
const fs = require('fs');
const path = require('path');

async function seedExercisesDirect() {
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  if (!db.isPostgres) {
    console.log('⚠️  This script is for PostgreSQL only.');
    if (dbConnection.close) dbConnection.close();
    return;
  }

  console.log('Seeding exercises from SQL files...');

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

  let totalInserted = 0;
  let totalSkipped = 0;

  for (const file of exerciseFiles) {
    const filePath = path.join(__dirname, '..', 'db', 'seeds', file);
    if (!fs.existsSync(filePath)) {
      console.log(`   ⚠️  File not found: ${file}`);
      continue;
    }

    const sql = fs.readFileSync(filePath, 'utf8');
    // Extract the VALUES part
    const valuesMatch = sql.match(/VALUES\s*\(([\s\S]+)\);/);
    
    if (valuesMatch) {
      const valuesStr = valuesMatch[1];
      // Split by ),( to get individual rows
      const rows = valuesStr.split(/\),\s*\(/).map((row, idx, arr) => {
        // Remove leading/trailing parentheses
        let cleaned = row;
        if (idx === 0) cleaned = cleaned.replace(/^\(/, '');
        if (idx === arr.length - 1) cleaned = cleaned.replace(/\)$/, '');
        return cleaned;
      });

      for (const row of rows) {
        // Parse the row - handle NULL, strings with quotes, etc.
        const values = [];
        let current = '';
        let inString = false;
        let stringChar = '';
        
        for (let i = 0; i < row.length; i++) {
          const char = row[i];
          const prevChar = i > 0 ? row[i - 1] : '';
          
          if (!inString && char === "'" && prevChar !== '\\') {
            inString = true;
            stringChar = "'";
            continue;
          }
          
          if (inString && char === stringChar && prevChar !== '\\') {
            inString = false;
            stringChar = '';
            continue;
          }
          
          if (!inString && char === ',' && (i === 0 || row[i - 1] !== '\\')) {
            const trimmed = current.trim();
            values.push(trimmed === 'NULL' ? null : trimmed);
            current = '';
            continue;
          }
          
          current += char;
        }
        
        // Add last value
        const trimmed = current.trim();
        values.push(trimmed === 'NULL' ? null : trimmed);

        if (values.length >= 6) {
          const [exercise, description, demo_video, fmp, plane, equipment] = values;
          
          // Clean up string values (remove quotes)
          const cleanValue = (val) => {
            if (!val || val === 'NULL') return null;
            return val.replace(/^'|'$/g, '').replace(/\\'/g, "'");
          };

          const exName = cleanValue(exercise);
          const exDesc = cleanValue(description);
          const exVideo = cleanValue(demo_video);
          const exFmp = cleanValue(fmp);
          const exPlane = cleanValue(plane);
          const exEquip = cleanValue(equipment);

          if (exName && exEquip) {
            try {
              // Check if exists
              const existing = await db.queryOne(`
                SELECT id FROM exercise 
                WHERE exercise = $1 AND equipment = $2
              `, [exName, exEquip]);

              if (!existing) {
                await db.query(`
                  INSERT INTO exercise (exercise, description, demo_video, functional_movement_pattern, plane_of_motion, equipment)
                  VALUES ($1, $2, $3, $4, $5, $6)
                `, [exName, exDesc, exVideo, exFmp, exPlane, exEquip]);
                totalInserted++;
              } else {
                totalSkipped++;
              }
            } catch (error) {
              if (!error.message.includes('duplicate') && !error.message.includes('UNIQUE')) {
                console.warn(`   ⚠️  Error inserting ${exName} (${exEquip}): ${error.message.substring(0, 50)}`);
              } else {
                totalSkipped++;
              }
            }
          }
        }
      }
    }
  }

  console.log(`✅ Exercises seeded: ${totalInserted} inserted, ${totalSkipped} skipped`);

  // Update exercise names
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

  if (db.isPostgres) {
    await dbConnection.end();
  } else if (dbConnection.close) {
    dbConnection.close();
  }
}

if (require.main === module) {
  seedExercisesDirect()
    .then(() => {
      console.log('Exercise seeding completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Exercise seeding failed:', error);
      process.exit(1);
    });
}

module.exports = { seedExercisesDirect };




















