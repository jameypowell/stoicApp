// Script to backfill household_id for existing standard gym memberships
// Usage: node scripts/backfill_household_ids.js

const { initDatabase, Database, generateHouseholdId } = require('../database');

async function backfillHouseholdIds() {
  const db = new Database(await initDatabase());
  
  try {
    console.log('Backfilling household IDs for standard gym memberships...\n');
    
    // Get all standard memberships without household_id
    let memberships;
    if (db.isPostgres) {
      const result = await db.query(
        'SELECT * FROM gym_memberships WHERE membership_type = $1 AND (household_id IS NULL OR household_id = \'\')',
        ['standard']
      );
      memberships = result.rows || [];
    } else {
      const result = await db.query(
        'SELECT * FROM gym_memberships WHERE membership_type = ? AND (household_id IS NULL OR household_id = \'\')',
        ['standard']
      );
      memberships = result.rows || [];
    }
    
    console.log(`Found ${memberships.length} standard memberships without household_id\n`);
    
    if (memberships.length === 0) {
      console.log('✅ All standard memberships already have household_id');
      return;
    }
    
    // Generate and assign household_id for each membership
    let updated = 0;
    for (const membership of memberships) {
      let householdId;
      let attempts = 0;
      const maxAttempts = 10;
      
      // Generate unique household_id (retry if collision)
      do {
        householdId = generateHouseholdId();
        attempts++;
        
        // Check if household_id already exists
        let existing;
        if (db.isPostgres) {
          existing = await db.queryOne(
            'SELECT id FROM gym_memberships WHERE household_id = $1',
            [householdId]
          );
        } else {
          existing = await db.queryOne(
            'SELECT id FROM gym_memberships WHERE household_id = ?',
            [householdId]
          );
        }
        
        if (!existing) {
          break; // Unique household_id found
        }
        
        if (attempts >= maxAttempts) {
          throw new Error(`Failed to generate unique household_id after ${maxAttempts} attempts`);
        }
      } while (true);
      
      // Update membership with household_id
      if (db.isPostgres) {
        await db.query(
          'UPDATE gym_memberships SET household_id = $1 WHERE id = $2',
          [householdId, membership.id]
        );
      } else {
        await db.query(
          'UPDATE gym_memberships SET household_id = ? WHERE id = ?',
          [householdId, membership.id]
        );
      }
      
      // Get user email for logging
      const user = await db.getUserById(membership.user_id);
      console.log(`✅ Assigned household_id ${householdId} to ${user?.email || membership.user_id}`);
      updated++;
    }
    
    console.log(`\n✅ Successfully backfilled ${updated} household IDs`);
    
  } catch (error) {
    console.error('❌ Error backfilling household IDs:', error);
    throw error;
  } finally {
    if (db && db.client) {
      await db.client.end();
      console.log('Database connection closed');
    }
  }
}

// Run backfill
backfillHouseholdIds()
  .then(() => {
    console.log('\nBackfill script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\nBackfill script failed:', error);
    process.exit(1);
  });











