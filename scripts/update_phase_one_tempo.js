/**
 * Migration script to update Phase One tempo text in dev database
 * Updates:
 * 1. workout_formats.format_json for Phase One
 * 2. workout_blocks.config_json for Phase One workouts
 * 3. workout.notes for Phase One workouts
 */

const { initDatabase, Database } = require('../database');

async function updatePhaseOneTempo() {
  console.log('════════════════════════════════════════════════');
  console.log('🔄 Updating Phase One Tempo Text');
  console.log('════════════════════════════════════════════════');
  console.log('');

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);

  console.log('Connected to SQLite database');
  console.log('');

  let updateCount = 0;

  try {
    // 1. Update workout_formats.format_json for Phase One
    console.log('1. Updating workout_formats.format_json...');
    const formatResult = await db.query(`
      UPDATE workout_formats
      SET format_json = REPLACE(
        REPLACE(
          format_json,
          '30% of 1RM AMRAP with tempo 4-2-1 (4s eccentric, 2s isometric hold at most contracted position, 1s concentric)',
          '30% of 1RM AMRAP with tempo 2-2-1-0 (2s eccentric, 2s bottom pause, 1s concentric, 0/no top pause)'
        ),
        'tempo 4-2-1',
        'tempo 2-2-1-0'
      )
      WHERE name LIKE '%Phase One%'
        AND (format_json LIKE '%tempo 4-2-1%' OR format_json LIKE '%4s eccentric%');
    `);
    
    if (db.isPostgres) {
      updateCount += formatResult.rowCount || 0;
    } else {
      updateCount += dbConnection.changes || 0;
    }
    console.log(`   Updated ${updateCount} workout format(s)`);
    console.log('');

    // 2. Update workout_blocks.config_json for Phase One workouts
    console.log('2. Updating workout_blocks.config_json...');
    const blocksResult = await db.query(`
      UPDATE workout_blocks
      SET config_json = REPLACE(
        REPLACE(
          config_json,
          '30% 1RM AMRAP, Tempo 4-2-1',
          '30% 1RM AMRAP, Tempo 2-2-1-0'
        ),
        'Tempo 4-2-1',
        'Tempo 2-2-1-0'
      )
      WHERE workout_id IN (
        SELECT id FROM workout WHERE phase = 'Phase One'
      )
        AND (config_json LIKE '%Tempo 4-2-1%' OR config_json LIKE '%tempo 4-2-1%');
    `);
    
    let blocksUpdated = 0;
    if (db.isPostgres) {
      blocksUpdated = blocksResult.rowCount || 0;
    } else {
      blocksUpdated = dbConnection.changes || 0;
    }
    updateCount += blocksUpdated;
    console.log(`   Updated ${blocksUpdated} workout block(s)`);
    console.log('');

    // 3. Update workout.notes for Phase One workouts
    console.log('3. Updating workout.notes...');
    const notesResult = await db.query(`
      UPDATE workout
      SET notes = REPLACE(
        REPLACE(
          REPLACE(
            REPLACE(
              notes,
              'Tempo 4-2-1 (4 sec Eccentric, 2 sec Isometric, 1 second Concentric)',
              'Tempo 2-2-1-0 (2 sec Eccentric, 2 sec Bottom Pause, 1 second Concentric, 0/No Top Pause)'
            ),
            'Tempo 4-2-1',
            'Tempo 2-2-1-0'
          ),
          '4 sec Eccentric, 2 sec Isometric, 1 second Concentric',
          '2 sec Eccentric, 2 sec Bottom Pause, 1 second Concentric, 0/No Top Pause'
        ),
        '4 Second Eccentric, 2 Second Isometric, 1 Second Concentric',
        '2 Second Eccentric, 2 Second Bottom Pause, 1 Second Concentric, 0/No Top Pause'
      )
      WHERE phase = 'Phase One'
        AND (notes LIKE '%Tempo 4-2-1%' 
          OR notes LIKE '%4 sec Eccentric%' 
          OR notes LIKE '%4 Second Eccentric%');
    `);
    
    let notesUpdated = 0;
    if (db.isPostgres) {
      notesUpdated = notesResult.rowCount || 0;
    } else {
      notesUpdated = dbConnection.changes || 0;
    }
    updateCount += notesUpdated;
    console.log(`   Updated ${notesUpdated} workout note(s)`);
    console.log('');

    console.log('════════════════════════════════════════════════');
    console.log('✅ Update Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log(`Total records updated: ${updateCount}`);
    console.log('');

    // Verify updates
    console.log('Verifying updates...');
    const verifyFormats = await db.query(`
      SELECT COUNT(*) as count
      FROM workout_formats
      WHERE name LIKE '%Phase One%'
        AND (format_json LIKE '%tempo 4-2-1%' OR format_json LIKE '%4s eccentric%');
    `);
    
    const verifyBlocks = await db.query(`
      SELECT COUNT(*) as count
      FROM workout_blocks
      WHERE workout_id IN (SELECT id FROM workout WHERE phase = 'Phase One')
        AND (config_json LIKE '%Tempo 4-2-1%' OR config_json LIKE '%tempo 4-2-1%');
    `);
    
    const verifyNotes = await db.query(`
      SELECT COUNT(*) as count
      FROM workout
      WHERE phase = 'Phase One'
        AND (notes LIKE '%Tempo 4-2-1%' 
          OR notes LIKE '%4 sec Eccentric%' 
          OR notes LIKE '%4 Second Eccentric%');
    `);

    const formatsRemaining = db.isPostgres 
      ? parseInt(verifyFormats.rows[0]?.count || 0)
      : verifyFormats[0]?.count || 0;
    const blocksRemaining = db.isPostgres
      ? parseInt(verifyBlocks.rows[0]?.count || 0)
      : verifyBlocks[0]?.count || 0;
    const notesRemaining = db.isPostgres
      ? parseInt(verifyNotes.rows[0]?.count || 0)
      : verifyNotes[0]?.count || 0;

    if (formatsRemaining === 0 && blocksRemaining === 0 && notesRemaining === 0) {
      console.log('✅ All Phase One tempo text has been updated successfully!');
    } else {
      console.log(`⚠️  Warning: Some old tempo text may still remain:`);
      console.log(`   - Format JSON: ${formatsRemaining} record(s)`);
      console.log(`   - Block config: ${blocksRemaining} record(s)`);
      console.log(`   - Workout notes: ${notesRemaining} record(s)`);
    }
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
  updatePhaseOneTempo().catch(error => {
    console.error('Fatal error:', error);
    process.exit(1);
  });
}

module.exports = { updatePhaseOneTempo };




















