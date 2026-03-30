// Assign workout numbers to strength workouts (ID:01, ID:02, etc. per phase)
const { initDatabase, Database } = require('./database');
require('dotenv').config();

async function assignWorkoutNumbers() {
  try {
    console.log('🔄 Assigning workout numbers to strength workouts...\n');
    
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    // Check if workout_number column exists, if not add it
    console.log('📋 Checking database schema...');
    const USE_POSTGRES = !!process.env.DB_HOST;
    
    if (USE_POSTGRES) {
      // Check if column exists
      const checkColumn = await dbConnection.query(`
        SELECT column_name 
        FROM information_schema.columns 
        WHERE table_name = 'strength_workouts' AND column_name = 'workout_number'
      `);
      
      if (checkColumn.rows.length === 0) {
        console.log('  Adding workout_number column...');
        await dbConnection.query(`
          ALTER TABLE strength_workouts 
          ADD COLUMN workout_number INTEGER
        `);
        console.log('  ✅ Column added\n');
      } else {
        console.log('  ✅ Column already exists\n');
      }
    } else {
      // SQLite - check if column exists
      const tableInfo = await new Promise((resolve, reject) => {
        dbConnection.all("PRAGMA table_info(strength_workouts)", [], (err, rows) => {
          if (err) reject(err);
          else resolve(rows);
        });
      });
      
      const hasColumn = tableInfo.some(col => col.name === 'workout_number');
      
      if (!hasColumn) {
        console.log('  Adding workout_number column...');
        await new Promise((resolve, reject) => {
          dbConnection.run(
            "ALTER TABLE strength_workouts ADD COLUMN workout_number INTEGER",
            (err) => {
              if (err) reject(err);
              else resolve();
            }
          );
        });
        console.log('  ✅ Column added\n');
      } else {
        console.log('  ✅ Column already exists\n');
      }
    }
    
    // Get all strength workouts grouped by phase
    const allWorkouts = await db.getAllStrengthWorkouts();
    
    // Group by phase and sort by date
    const workoutsByPhase = {};
    allWorkouts.forEach(workout => {
      const phase = workout.phase || 'Unknown';
      if (!workoutsByPhase[phase]) {
        workoutsByPhase[phase] = [];
      }
      workoutsByPhase[phase].push(workout);
    });
    
    // Sort each phase by workout_date
    Object.keys(workoutsByPhase).forEach(phase => {
      workoutsByPhase[phase].sort((a, b) => {
        return a.workout_date.localeCompare(b.workout_date);
      });
    });
    
    console.log('📊 Workouts by phase:');
    Object.keys(workoutsByPhase).forEach(phase => {
      console.log(`  ${phase}: ${workoutsByPhase[phase].length} workouts`);
    });
    console.log('');
    
    // Assign numbers in format: Phase One = 101, 102, 103... Phase Two = 201, 202, 203... Phase Three = 301, 302, 303...
    const phaseMultipliers = {
      'Phase One: Beginner': 100,
      'Phase Two: Intermediate': 200,
      'Phase Three: Advanced': 300
    };
    
    let totalUpdated = 0;
    
    for (const phase of Object.keys(workoutsByPhase)) {
      const workouts = workoutsByPhase[phase];
      const phaseMultiplier = phaseMultipliers[phase] || 100;
      
      for (let i = 0; i < workouts.length; i++) {
        const workout = workouts[i];
        const workoutNumber = phaseMultiplier + (i + 1); // 101, 102, 103... or 201, 202, 203... or 301, 302, 303...
        
        // Update workout with number
        if (USE_POSTGRES) {
          await dbConnection.query(
            `UPDATE strength_workouts 
             SET workout_number = $1, updated_at = CURRENT_TIMESTAMP
             WHERE id = $2`,
            [workoutNumber, workout.id]
          );
        } else {
          await new Promise((resolve, reject) => {
            dbConnection.run(
              `UPDATE strength_workouts 
               SET workout_number = ?, updated_at = CURRENT_TIMESTAMP
               WHERE id = ?`,
              [workoutNumber, workout.id],
              (err) => {
                if (err) reject(err);
                else resolve();
              }
            );
          });
        }
        
        totalUpdated++;
      }
    }
    
    console.log(`✅ Assigned workout numbers to ${totalUpdated} workouts\n`);
    console.log('📋 Sample assignments:');
    Object.keys(workoutsByPhase).forEach(phase => {
      const workouts = workoutsByPhase[phase];
      console.log(`  ${phase}:`);
      workouts.slice(0, 3).forEach(w => {
        console.log(`    ID:${String(w.id).padStart(2, '0')} → Workout #${w.workout_number || 'N/A'} (${w.workout_date})`);
      });
      if (workouts.length > 3) {
        console.log(`    ... and ${workouts.length - 3} more`);
      }
    });
    
  } catch (error) {
    console.error('❌ Error assigning workout numbers:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

assignWorkoutNumbers();

