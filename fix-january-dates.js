// Script to fix January workout dates from 2025 to 2026
const { initDatabase, Database } = require('./database');
require('dotenv').config();

async function fixJanuaryDates() {
  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    console.log('🔍 Checking January workouts...\n');

    // Find all workouts with dates in January 2025 (should be 2026)
    // Find all workouts with dates in January 2025 (should be 2026)
    let workouts = [];
    
    if (db.isPostgres) {
      const result = await db.query(
        `SELECT * FROM workouts 
         WHERE workout_date >= '2025-01-01' 
         AND workout_date < '2025-02-01'
         AND google_drive_file_id = '1cmFR_i_jtu7oN3l5e0Feq522-xMls9AkBZljYgLg3So'`
      );
      workouts = result.rows || [];
    } else {
      workouts = await new Promise((resolve, reject) => {
        db.db.all(
          `SELECT * FROM workouts 
           WHERE workout_date >= '2025-01-01' 
           AND workout_date < '2025-02-01'
           AND google_drive_file_id = '1cmFR_i_jtu7oN3l5e0Feq522-xMls9AkBZljYgLg3So'`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
    }

    if (workouts.length === 0) {
      console.log('✅ No January 2025 workouts found. All dates are correct!');
      process.exit(0);
    }

    console.log(`⚠️  Found ${workouts.length} workout(s) with incorrect dates (2025 instead of 2026):\n`);
    
    workouts.forEach(w => {
      console.log(`  • ${w.workout_date}: ${w.content.substring(0, 60)}...`);
    });

    console.log('\n🔄 Updating dates to 2026...\n');

    // Update each workout date from 2025 to 2026
    for (const workout of workouts) {
      const oldDate = workout.workout_date;
      const newDate = oldDate.replace('2025-', '2026-');
      
      // Check if a workout with the new date already exists
      const existing = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM workouts WHERE workout_date = $1'
          : 'SELECT * FROM workouts WHERE workout_date = ?',
        [newDate]
      );

      if (existing) {
        // Update the existing workout
        await db.query(
          db.isPostgres
            ? `UPDATE workouts 
               SET content = $1, updated_at = CURRENT_TIMESTAMP 
               WHERE workout_date = $2`
            : `UPDATE workouts 
               SET content = ?, updated_at = datetime('now') 
               WHERE workout_date = ?`,
          [workout.content, newDate]
        );
        // Delete the old one
        await db.query(
          db.isPostgres
            ? 'DELETE FROM workouts WHERE workout_date = $1'
            : 'DELETE FROM workouts WHERE workout_date = ?',
          [oldDate]
        );
        console.log(`  ✅ Updated ${oldDate} → ${newDate} (merged with existing)`);
      } else {
        // Update the date directly
        await db.query(
          db.isPostgres
            ? `UPDATE workouts 
               SET workout_date = $1, updated_at = CURRENT_TIMESTAMP 
               WHERE workout_date = $2`
            : `UPDATE workouts 
               SET workout_date = ?, updated_at = datetime('now') 
               WHERE workout_date = ?`,
          [newDate, oldDate]
        );
        console.log(`  ✅ Updated ${oldDate} → ${newDate}`);
      }
    }

    console.log('\n✅ All January dates have been corrected to 2026!');
    console.log('\n📋 Verifying all January 2026 workouts:\n');

    // Verify all January 2026 workouts
    let jan2026 = [];
    
    if (db.isPostgres) {
      const result = await db.query(
        `SELECT workout_date, SUBSTR(content, 1, 60) as preview 
         FROM workouts 
         WHERE workout_date >= '2026-01-01' 
         AND workout_date < '2026-02-01'
         AND google_drive_file_id = '1cmFR_i_jtu7oN3l5e0Feq522-xMls9AkBZljYgLg3So'
         ORDER BY workout_date`
      );
      jan2026 = result.rows || [];
    } else {
      jan2026 = await new Promise((resolve, reject) => {
        db.db.all(
          `SELECT workout_date, SUBSTR(content, 1, 60) as preview 
           FROM workouts 
           WHERE workout_date >= '2026-01-01' 
           AND workout_date < '2026-02-01'
           AND google_drive_file_id = '1cmFR_i_jtu7oN3l5e0Feq522-xMls9AkBZljYgLg3So'
           ORDER BY workout_date`,
          [],
          (err, rows) => {
            if (err) reject(err);
            else resolve(rows || []);
          }
        );
      });
    }
    
    console.log(`Found ${jan2026.length} January 2026 workout(s):`);
    jan2026.forEach(w => {
      console.log(`  • ${w.workout_date}: ${w.preview}...`);
    });

  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

fixJanuaryDates();

