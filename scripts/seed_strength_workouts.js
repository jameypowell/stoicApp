// Seed script for strength workouts (Phase 3)
// Seeds Phase One, Phase Two, and Phase Three workouts
// Works with both SQLite (dev) and Postgres (production)
// Executes SQL seed files with syntax conversion

const { initDatabase, Database } = require('../database');
const fs = require('fs');
const path = require('path');

async function seedStrengthWorkouts() {
  console.log('════════════════════════════════════════════════');
  console.log('🌱 Seeding Strength Workouts (Phase One, Two, Three)');
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
      // For workout table, we'll use name as the conflict column
      sql = sql.replace(/INSERT OR IGNORE INTO workout\s*\(/gi, (match) => {
        return `INSERT INTO workout (`;
      });

      // For workout_blocks and block_exercises, we don't have unique constraints
      // so we'll use a different approach: check if exists first, or use INSERT ... ON CONFLICT
      sql = sql.replace(/INSERT OR IGNORE INTO workout_blocks/gi, 'INSERT INTO workout_blocks');
      sql = sql.replace(/INSERT OR IGNORE INTO block_exercises/gi, 'INSERT INTO block_exercises');
      sql = sql.replace(/INSERT OR IGNORE INTO exercise/gi, 'INSERT INTO exercise');
      sql = sql.replace(/INSERT OR IGNORE INTO workout_types/gi, 'INSERT INTO workout_types');
      
      // Convert boolean values: is_active = 1 to is_active = true
      // Handle SELECT ... 1; at the end (for is_active)
      sql = sql.replace(/,\s*1\s*;\s*$/m, ', true;');
      // Also handle cases where 1 is in the middle of SELECT
      sql = sql.replace(/SELECT\s+([^,]+),\s*1\s+FROM/gi, 'SELECT $1, true FROM');
      // Handle VALUES with 1
      sql = sql.replace(/VALUES\s*\([^)]*,\s*1\s*\)/gi, (match) => {
        return match.replace(/,\s*1\s*\)$/, ', true)');
      });

      return sql;
    }

    // Helper to execute SQL statement with Postgres conflict handling
    async function executeStatement(statement, description = '') {
      try {
        let convertedSql = convertToPostgres(statement);
        
        // For Postgres, add ON CONFLICT for workout table inserts
        if (db.isPostgres && convertedSql.includes('INSERT INTO workout (')) {
          // Extract the workout name from the SELECT subquery or VALUES clause
          let workoutName = null;
          
          // Try to match name in SELECT subquery: SELECT 'Phase One – Day 1...'
          const selectMatch = convertedSql.match(/SELECT\s+'([^']+)'/i);
          if (selectMatch) {
            workoutName = selectMatch[1];
          }
          
          // Try to match in VALUES: VALUES ('Phase One...', ...)
          if (!workoutName) {
            const valuesMatch = convertedSql.match(/VALUES\s*\([^)]*'([^']+)'/i);
            if (valuesMatch) {
              workoutName = valuesMatch[1];
            }
          }
          
          if (workoutName) {
            // Check if workout already exists
            const existing = await db.queryOne(`
              SELECT id FROM workout WHERE name = $1
            `, [workoutName]);
            
            if (existing) {
              if (description) console.log(`   ⏭️  Skipping ${description} (already exists)`);
              return { skipped: true };
            }
          }
          
          // Add ON CONFLICT clause for workout inserts (name has UNIQUE constraint)
          if (!convertedSql.includes('ON CONFLICT')) {
            convertedSql = convertedSql.replace(/;?\s*$/, ' ON CONFLICT (name) DO NOTHING;');
          }
        }

        // Execute the statement
        await db.query(convertedSql);
        
        if (description) console.log(`   ✅ ${description}`);
        return { success: true };
      } catch (error) {
        // Ignore duplicate key errors and unique constraint violations
        if (error.message.includes('duplicate key') || 
            error.message.includes('UNIQUE constraint') ||
            error.message.includes('already exists') ||
            error.code === '23505') { // Postgres unique violation
          if (description) console.log(`   ⏭️  Skipping ${description} (already exists)`);
          return { skipped: true };
        } else {
          // For other errors, log a warning but continue
          console.warn(`   ⚠️  Warning executing statement: ${error.message}`);
          if (description) console.warn(`      Statement: ${description}`);
          return { error: error.message };
        }
      }
    }

    // Helper to execute SQL file
    async function executeSqlFile(filePath, phaseName) {
      if (!fs.existsSync(filePath)) {
        console.log(`   ⚠️  File not found: ${filePath}`);
        return;
      }

      console.log(`\n📄 Processing ${phaseName} workouts from ${path.basename(filePath)}...`);
      const sqlContent = fs.readFileSync(filePath, 'utf8');
      
      // Split by semicolons to get individual statements
      // But be careful with semicolons inside JSON strings
      const statements = [];
      let current = '';
      let inString = false;
      let stringChar = '';
      let inJson = false;
      
      for (let i = 0; i < sqlContent.length; i++) {
        const char = sqlContent[i];
        const nextChar = sqlContent[i + 1];
        
        if (!inString && char === '-' && nextChar === '-') {
          // Skip comment until newline
          while (i < sqlContent.length && sqlContent[i] !== '\n') {
            i++;
          }
          continue;
        }
        
        if (!inString && char === "'") {
          inString = true;
          stringChar = "'";
        } else if (inString && char === stringChar && sqlContent[i - 1] !== '\\') {
          inString = false;
          stringChar = '';
        }
        
        current += char;
        
        if (!inString && char === ';') {
          const trimmed = current.trim();
          if (trimmed.length > 0 && !trimmed.startsWith('--')) {
            statements.push(trimmed);
          }
          current = '';
        }
      }
      
      // Add last statement if no semicolon at end
      if (current.trim().length > 0) {
        statements.push(current.trim());
      }

      let executed = 0;
      let skipped = 0;
      let errors = 0;

      for (let i = 0; i < statements.length; i++) {
        const statement = statements[i];
        
        // Skip empty statements
        if (!statement || statement.trim().length === 0) continue;
        
        // Determine description based on statement type
        let description = '';
        if (statement.includes('INSERT INTO workout (')) {
          const nameMatch = statement.match(/'Phase (One|Two|Three)[^']*'/i);
          if (nameMatch) {
            description = `Workout: ${nameMatch[0].replace(/'/g, '')}`;
          }
        } else if (statement.includes('INSERT INTO workout_blocks')) {
          description = 'Workout block';
        } else if (statement.includes('INSERT INTO block_exercises')) {
          description = 'Block exercise';
        } else if (statement.includes('INSERT INTO exercise')) {
          description = 'Exercise';
        } else if (statement.includes('INSERT INTO workout_types')) {
          description = 'Workout type';
        }

        const result = await executeStatement(statement, description);
        
        if (result.success) {
          executed++;
        } else if (result.skipped) {
          skipped++;
        } else if (result.error) {
          errors++;
        }
      }
      
      console.log(`   📊 Results: ${executed} executed, ${skipped} skipped, ${errors} errors`);
      return { executed, skipped, errors };
    }

    // Seed Phase One workouts
    console.log('1. Seeding Phase One workouts...');
    const phaseOnePath = path.join(__dirname, '..', 'db', 'seeds', 'seed_phase_one_week_workouts.sql');
    const phaseOneGlutesPath = path.join(__dirname, '..', 'db', 'seeds', 'seed_phase_one_glutes_quads_workout.sql');
    
    await executeSqlFile(phaseOneGlutesPath, 'Phase One (Glutes/Quads A)');
    await executeSqlFile(phaseOnePath, 'Phase One (Week Template)');

    // Seed Phase Two workouts
    console.log('\n2. Seeding Phase Two workouts...');
    const phaseTwoPath = path.join(__dirname, '..', 'db', 'seeds', 'seed_phase_two_week_workouts.sql');
    await executeSqlFile(phaseTwoPath, 'Phase Two');

    // Seed Phase Three workouts
    console.log('\n3. Seeding Phase Three workouts...');
    const phaseThreePath = path.join(__dirname, '..', 'db', 'seeds', 'seed_phase_three_workouts.sql');
    await executeSqlFile(phaseThreePath, 'Phase Three');

    // Verify seeding
    console.log('\n4. Verifying seeded workouts...');
    let phaseOneCount, phaseTwoCount, phaseThreeCount;
    
    if (db.isPostgres) {
      phaseOneCount = await db.queryOne(`
        SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase One'
      `);
      phaseTwoCount = await db.queryOne(`
        SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase Two'
      `);
      phaseThreeCount = await db.queryOne(`
        SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase Three'
      `);
    } else {
      phaseOneCount = await db.queryOne(`
        SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase One'
      `);
      phaseTwoCount = await db.queryOne(`
        SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase Two'
      `);
      phaseThreeCount = await db.queryOne(`
        SELECT COUNT(*) as count FROM workout WHERE phase = 'Phase Three'
      `);
    }

    console.log(`   Phase One: ${phaseOneCount?.count || phaseOneCount?.count || 0} workouts`);
    console.log(`   Phase Two: ${phaseTwoCount?.count || phaseTwoCount?.count || 0} workouts`);
    console.log(`   Phase Three: ${phaseThreeCount?.count || phaseThreeCount?.count || 0} workouts`);

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Strength Workouts Seeding Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Verify workouts are accessible via API');
    console.log('  2. Test UI rendering for all three phases');
    console.log('  3. Verify workout numbering (1-1, 1-2, 2-1, etc.)');
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
  seedStrengthWorkouts()
    .then(() => {
      console.log('Seed script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Seed script failed:', error);
      process.exit(1);
    });
}

module.exports = { seedStrengthWorkouts };

