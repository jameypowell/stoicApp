// Migration: Add strength workout tables to Postgres production
// This migration creates all tables needed for the new strength workout system:
// - exercises (global exercise library)
// - equipment (master equipment list)
// - exercise_equipment (join table)
// - workout_types (categories of workouts)
// - workout_formats (JSON-based format definitions)
// - workout (workout templates, singular name to avoid conflict with existing workouts table)
// - workout_blocks (sections like Warm-Up, Primary, Secondary)
// - block_exercises (assign exercises to blocks)

const { initDatabase, Database } = require('../database');

async function migrateStrengthWorkoutsSchema() {
  console.log('════════════════════════════════════════════════');
  console.log('🔄 Starting Strength Workouts Schema Migration');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  if (!db.isPostgres) {
    console.log('⚠️  This migration is for PostgreSQL only.');
    console.log('   SQLite dev environment already has these tables.');
    console.log('   Skipping migration.');
    if (dbConnection.close) {
      dbConnection.close();
    }
    return;
  }

  console.log('✅ Connected to PostgreSQL database');
  console.log('');

  try {
    // Helper function to check if table exists
    async function tableExists(tableName) {
      const result = await db.query(`
        SELECT EXISTS (
          SELECT FROM information_schema.tables 
          WHERE table_schema = 'public' AND table_name = $1
        )
      `, [tableName]);
      return result.rows[0]?.exists || false;
    }

    // 1. Create exercises table
    console.log('1. Checking exercises table...');
    if (!(await tableExists('exercises'))) {
      console.log('   Creating exercises table...');
      await db.query(`
        CREATE TABLE exercises (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          description TEXT,
          video_url TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ exercises table created');
    } else {
      console.log('   ✅ exercises table already exists');
    }

    // 2. Create equipment table
    console.log('2. Checking equipment table...');
    if (!(await tableExists('equipment'))) {
      console.log('   Creating equipment table...');
      await db.query(`
        CREATE TABLE equipment (
          id SERIAL PRIMARY KEY,
          name TEXT UNIQUE NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ equipment table created');
    } else {
      console.log('   ✅ equipment table already exists');
    }

    // 3. Create exercise_equipment join table
    console.log('3. Checking exercise_equipment table...');
    if (!(await tableExists('exercise_equipment'))) {
      console.log('   Creating exercise_equipment table...');
      await db.query(`
        CREATE TABLE exercise_equipment (
          id SERIAL PRIMARY KEY,
          exercise_id INTEGER NOT NULL,
          equipment_id INTEGER NOT NULL,
          FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE,
          FOREIGN KEY (equipment_id) REFERENCES equipment(id) ON DELETE CASCADE,
          UNIQUE(exercise_id, equipment_id)
        )
      `);
      console.log('   ✅ exercise_equipment table created');
    } else {
      console.log('   ✅ exercise_equipment table already exists');
    }

    // 4. Create workout_types table
    console.log('4. Checking workout_types table...');
    if (!(await tableExists('workout_types'))) {
      console.log('   Creating workout_types table...');
      await db.query(`
        CREATE TABLE workout_types (
          id SERIAL PRIMARY KEY,
          code TEXT UNIQUE NOT NULL,
          label TEXT NOT NULL,
          description TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ workout_types table created');
    } else {
      console.log('   ✅ workout_types table already exists');
    }

    // 5. Create workout_formats table
    console.log('5. Checking workout_formats table...');
    if (!(await tableExists('workout_formats'))) {
      console.log('   Creating workout_formats table...');
      await db.query(`
        CREATE TABLE workout_formats (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL,
          phase TEXT,
          difficulty_level TEXT,
          description TEXT,
          format_json TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
        )
      `);
      console.log('   ✅ workout_formats table created');
    } else {
      console.log('   ✅ workout_formats table already exists');
    }

    // 6. Create workout table (singular, to avoid conflict with existing workouts table)
    console.log('6. Checking workout table (singular)...');
    if (!(await tableExists('workout'))) {
      console.log('   Creating workout table...');
      await db.query(`
        CREATE TABLE workout (
          id SERIAL PRIMARY KEY,
          name TEXT NOT NULL UNIQUE,
          phase TEXT,
          difficulty_level TEXT,
          workout_type_id INTEGER NOT NULL,
          primary_focus TEXT,
          secondary_focus TEXT,
          workout_format_id INTEGER,
          fmp TEXT,
          notes TEXT,
          is_active BOOLEAN DEFAULT TRUE,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workout_type_id) REFERENCES workout_types(id),
          FOREIGN KEY (workout_format_id) REFERENCES workout_formats(id)
        )
      `);
      console.log('   ✅ workout table created with UNIQUE constraint on name');
    } else {
      console.log('   ✅ workout table already exists');
      // Check if unique constraint exists, add it if not
      try {
        const constraintCheck = await db.query(`
          SELECT constraint_name 
          FROM information_schema.table_constraints 
          WHERE table_name = 'workout' 
          AND constraint_type = 'UNIQUE' 
          AND constraint_name LIKE '%name%'
        `);
        if (!constraintCheck.rows || constraintCheck.rows.length === 0) {
          console.log('   Adding UNIQUE constraint on name...');
          await db.query(`
            ALTER TABLE workout ADD CONSTRAINT workout_name_unique UNIQUE (name)
          `);
          console.log('   ✅ Added UNIQUE constraint on workout.name');
        }
      } catch (error) {
        // Constraint might already exist or there's another issue
        if (error.message.includes('already exists')) {
          console.log('   ✅ UNIQUE constraint on name already exists');
        } else {
          console.warn('   ⚠️  Could not add UNIQUE constraint:', error.message);
        }
      }
    }

    // 7. Create workout_blocks table
    console.log('7. Checking workout_blocks table...');
    if (!(await tableExists('workout_blocks'))) {
      console.log('   Creating workout_blocks table...');
      await db.query(`
        CREATE TABLE workout_blocks (
          id SERIAL PRIMARY KEY,
          workout_id INTEGER NOT NULL,
          block_type TEXT NOT NULL,
          title TEXT,
          order_index INTEGER NOT NULL,
          config_json TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (workout_id) REFERENCES workout(id) ON DELETE CASCADE
        )
      `);
      console.log('   ✅ workout_blocks table created');
    } else {
      console.log('   ✅ workout_blocks table already exists');
    }

    // 8. Create block_exercises table
    console.log('8. Checking block_exercises table...');
    if (!(await tableExists('block_exercises'))) {
      console.log('   Creating block_exercises table...');
      await db.query(`
        CREATE TABLE block_exercises (
          id SERIAL PRIMARY KEY,
          block_id INTEGER NOT NULL,
          exercise_id INTEGER NOT NULL,
          order_index INTEGER NOT NULL,
          sets INTEGER,
          reps INTEGER,
          duration_sec INTEGER,
          intensity_type TEXT,
          load_percent_1rm REAL,
          tempo TEXT,
          focus_role TEXT,
          config_json TEXT,
          created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
          FOREIGN KEY (block_id) REFERENCES workout_blocks(id) ON DELETE CASCADE,
          FOREIGN KEY (exercise_id) REFERENCES exercises(id) ON DELETE CASCADE
        )
      `);
      console.log('   ✅ block_exercises table created');
    } else {
      console.log('   ✅ block_exercises table already exists');
    }

    // 9. Create indexes for performance
    console.log('');
    console.log('9. Creating indexes...');
    
    const indexes = [
      { name: 'idx_exercise_equipment_exercise_id', table: 'exercise_equipment', column: 'exercise_id' },
      { name: 'idx_exercise_equipment_equipment_id', table: 'exercise_equipment', column: 'equipment_id' },
      { name: 'idx_workout_types_code', table: 'workout_types', column: 'code' },
      { name: 'idx_workout_formats_is_active', table: 'workout_formats', column: 'is_active' },
      { name: 'idx_workout_workout_type_id', table: 'workout', column: 'workout_type_id' },
      { name: 'idx_workout_workout_format_id', table: 'workout', column: 'workout_format_id' },
      { name: 'idx_workout_is_active', table: 'workout', column: 'is_active' },
      { name: 'idx_workout_blocks_workout_id', table: 'workout_blocks', column: 'workout_id' },
      { name: 'idx_workout_blocks_order_index', table: 'workout_blocks', columns: ['workout_id', 'order_index'] },
      { name: 'idx_block_exercises_block_id', table: 'block_exercises', column: 'block_id' },
      { name: 'idx_block_exercises_exercise_id', table: 'block_exercises', column: 'exercise_id' },
      { name: 'idx_block_exercises_order_index', table: 'block_exercises', columns: ['block_id', 'order_index'] }
    ];

    for (const idx of indexes) {
      try {
        // Check if index exists
        const indexCheck = await db.query(`
          SELECT EXISTS (
            SELECT FROM pg_indexes 
            WHERE schemaname = 'public' AND indexname = $1
          )
        `, [idx.name]);
        
        if (!indexCheck.rows[0]?.exists) {
          if (idx.columns) {
            // Composite index
            await db.query(`
              CREATE INDEX ${idx.name} ON ${idx.table} (${idx.columns.join(', ')})
            `);
          } else {
            // Single column index
            await db.query(`
              CREATE INDEX ${idx.name} ON ${idx.table} (${idx.column})
            `);
          }
          console.log(`   ✅ Created index: ${idx.name}`);
        } else {
          console.log(`   ✅ Index already exists: ${idx.name}`);
        }
      } catch (error) {
        console.warn(`   ⚠️  Warning creating index ${idx.name}:`, error.message);
      }
    }

    console.log('');
    console.log('════════════════════════════════════════════════');
    console.log('✅ Schema Migration Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Next steps:');
    console.log('  1. Run seed scripts for equipment, exercises, and workout_formats');
    console.log('  2. Run seed scripts for strength workouts');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error during migration:', error);
    throw error;
  } finally {
    if (db.isPostgres) {
      await dbConnection.end();
    } else if (dbConnection.close) {
      dbConnection.close();
    }
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateStrengthWorkoutsSchema()
    .then(() => {
      console.log('Migration script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateStrengthWorkoutsSchema };

