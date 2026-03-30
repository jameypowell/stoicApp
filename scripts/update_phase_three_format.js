/**
 * Migration script to update Phase Three format JSON in dev database
 * Adds format_title and format_bullets to Phase Three workout format
 */

const { initDatabase, Database } = require('../database');

async function updatePhaseThreeFormat() {
  console.log('════════════════════════════════════════════════');
  console.log('🔄 Updating Phase Three Format JSON');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log('Connected to SQLite database');
  console.log('');

  try {
    // Get current Phase Three format
    const currentFormat = await db.queryOne(`
      SELECT id, format_json
      FROM workout_formats
      WHERE name LIKE '%Phase Three%'
    `);

    if (!currentFormat) {
      console.log('❌ Phase Three format not found in database');
      return;
    }

    console.log('Current Phase Three format found');
    console.log('');

    // Parse current JSON
    let formatJson;
    try {
      formatJson = typeof currentFormat.format_json === 'string'
        ? JSON.parse(currentFormat.format_json)
        : currentFormat.format_json;
    } catch (e) {
      console.error('❌ Error parsing current format JSON:', e);
      return;
    }

    // Add new format fields if they don't exist
    if (!formatJson.format_title) {
      formatJson.format_title = 'Phase Three Format';
    }
    
    if (!formatJson.format_bullets || !Array.isArray(formatJson.format_bullets)) {
      formatJson.format_bullets = [
        'Find 2-4RM Using the 1RM Calc',
        '85%-90% of 1RM for 3 Sets of Each Exercise',
        'One exercise at a time for all 3 sets',
        'Tempo 3-2-1-0',
        '3 Second Eccentric, 2 Second Bottom Pause, 1 Second Concentric, 0/No Top Pause'
      ];
    }

    // Update the database
    const updatedJson = JSON.stringify(formatJson, null, 2);
    const updateResult = await db.query(`
      UPDATE workout_formats
      SET format_json = ?
      WHERE id = ?
    `, [updatedJson, currentFormat.id]);

    let updateCount = 0;
    if (db.isPostgres) {
      updateCount = updateResult.rowCount || 0;
    } else {
      updateCount = dbConnection.changes || 0;
    }

    console.log('════════════════════════════════════════════════');
    console.log('✅ Update Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log(`Updated ${updateCount} workout format(s)`);
    console.log('');
    console.log('New format_bullets:');
    formatJson.format_bullets.forEach((bullet, i) => {
      console.log(`  ${i + 1}. ${bullet}`);
    });
    console.log('');

  } catch (error) {
    console.error('❌ Error during update:', error);
    throw error;
  } finally {
    if (db.isPostgres) {
      await dbConnection.end();
    } else {
      dbConnection.close();
    }
  }
}

if (require.main === module) {
  updatePhaseThreeFormat().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { updatePhaseThreeFormat };




















