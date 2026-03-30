// Migration: Ensure exercise table exists with all required columns
// This migration creates the exercise table if it doesn't exist,
// or adds missing columns if it does exist

const { initDatabase, Database } = require('../database');

async function migrateExerciseTable() {
  console.log('Starting exercise table migration...');
  
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  try {
    // Check if exercise table exists
    let tableExists = false;
    try {
      if (db.isPostgres) {
        const result = await db.query(`
          SELECT EXISTS (
            SELECT FROM information_schema.tables 
            WHERE table_name = 'exercise'
          )
        `);
        tableExists = result.rows[0]?.exists || false;
      } else {
        // SQLite
        const result = await db.query(`
          SELECT name FROM sqlite_master 
          WHERE type='table' AND name='exercise'
        `);
        tableExists = result.rows && result.rows.length > 0;
      }
    } catch (error) {
      console.log('Error checking table existence:', error.message);
      tableExists = false;
    }

    if (!tableExists) {
      // Create the table with all columns
      console.log('Creating exercise table...');
      if (db.isPostgres) {
        await db.query(`
          CREATE TABLE exercise (
            id SERIAL PRIMARY KEY,
            exercise TEXT NOT NULL,
            description TEXT,
            demo_video TEXT,
            functional_movement_pattern TEXT,
            plane_of_motion TEXT,
            equipment TEXT
          )
        `);
      } else {
        // SQLite
        await db.query(`
          CREATE TABLE exercise (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            exercise TEXT NOT NULL,
            description TEXT,
            demo_video TEXT,
            functional_movement_pattern TEXT,
            plane_of_motion TEXT,
            equipment TEXT
          )
        `);
      }
      console.log('Exercise table created successfully');
    } else {
      // Table exists - check and add missing columns
      console.log('Exercise table exists, checking for missing columns...');
      
      const requiredColumns = [
        { name: 'exercise', type: 'TEXT NOT NULL' },
        { name: 'description', type: 'TEXT' },
        { name: 'demo_video', type: 'TEXT' },
        { name: 'functional_movement_pattern', type: 'TEXT' },
        { name: 'plane_of_motion', type: 'TEXT' },
        { name: 'equipment', type: 'TEXT' }
      ];

      for (const col of requiredColumns) {
        try {
          let columnExists = false;
          
          if (db.isPostgres) {
            const result = await db.query(`
              SELECT EXISTS (
                SELECT FROM information_schema.columns 
                WHERE table_name = 'exercise' AND column_name = $1
              )
            `, [col.name]);
            columnExists = result.rows[0]?.exists || false;
          } else {
            // SQLite - get table schema
            const result = await db.query(`
              SELECT sql FROM sqlite_master 
              WHERE type='table' AND name='exercise'
            `);
            if (result.rows && result.rows.length > 0) {
              const schema = result.rows[0].sql || '';
              columnExists = schema.toLowerCase().includes(col.name.toLowerCase());
            }
          }

          if (!columnExists) {
            console.log(`Adding missing column: ${col.name}`);
            // SQLite doesn't support NOT NULL in ALTER TABLE ADD COLUMN for existing tables
            // So we'll add it as nullable, then update if needed
            const alterType = col.type.includes('NOT NULL') 
              ? col.type.replace('NOT NULL', '').trim() 
              : col.type;
            
            if (db.isPostgres) {
              await db.query(`
                ALTER TABLE exercise ADD COLUMN ${col.name} ${col.type}
              `);
            } else {
              await db.query(`
                ALTER TABLE exercise ADD COLUMN ${col.name} ${alterType}
              `);
            }
            console.log(`Column ${col.name} added successfully`);
          } else {
            console.log(`Column ${col.name} already exists`);
          }
        } catch (error) {
          // Column might already exist or there's another issue
          if (error.message.includes('duplicate column') || 
              error.message.includes('already exists')) {
            console.log(`Column ${col.name} already exists (ignoring error)`);
          } else {
            console.warn(`Warning adding column ${col.name}:`, error.message);
          }
        }
      }
    }
    
    console.log('Exercise table migration completed successfully!');
    
    // Close database connection
    if (db.isPostgres) {
      await dbConnection.end();
    } else {
      dbConnection.close();
    }
    
  } catch (error) {
    console.error('Error during migration:', error);
    throw error;
  }
}

// Run migration if called directly
if (require.main === module) {
  migrateExerciseTable()
    .then(() => {
      console.log('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateExerciseTable };




















