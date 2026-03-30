// Export strength workouts to CSV
const { initDatabase, Database } = require('./database');
const fs = require('fs');
require('dotenv').config();

async function exportStrengthWorkoutsToCSV() {
  try {
    console.log('🔄 Exporting strength workouts to CSV...\n');
    
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    // Get all strength workouts
    const workouts = await db.getAllStrengthWorkouts();
    
    console.log(`✅ Found ${workouts.length} strength workouts\n`);
    
    // Define CSV headers
    const headers = [
      'ID',
      'Workout Date',
      'Phase',
      'Primary Focus',
      'Secondary Focus',
      'Slide Number',
      'Workout Index',
      'Title',
      'Content',
      'Created At',
      'Updated At'
    ];
    
    // Create CSV rows
    const rows = [headers.join(',')];
    
    workouts.forEach(workout => {
      const row = [
        workout.id || '',
        workout.workout_date || '',
        `"${(workout.phase || '').replace(/"/g, '""')}"`,
        `"${(workout.primary_focus || '').replace(/"/g, '""')}"`,
        `"${(workout.secondary_focus || '').replace(/"/g, '""')}"`,
        workout.slide_number || '',
        workout.workout_index || '',
        `"${(workout.title || '').replace(/"/g, '""')}"`,
        `"${(workout.content || '').replace(/"/g, '""').replace(/\n/g, '\\n')}"`,
        workout.created_at || '',
        workout.updated_at || ''
      ];
      rows.push(row.join(','));
    });
    
    // Write to CSV file
    const csvContent = rows.join('\n');
    const filename = `strength-workouts-export-${new Date().toISOString().split('T')[0]}.csv`;
    fs.writeFileSync(filename, csvContent, 'utf8');
    
    console.log(`✅ Exported ${workouts.length} strength workouts to: ${filename}`);
    console.log(`📄 File size: ${(csvContent.length / 1024).toFixed(2)} KB\n`);
    
    return filename;
  } catch (error) {
    console.error('❌ Error exporting strength workouts:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

exportStrengthWorkoutsToCSV();



