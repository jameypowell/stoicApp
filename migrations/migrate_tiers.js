// Migration script to update subscription tiers from daily/weekly/monthly to tier_one/tier_two/tier_three/tier_four
// Run this script once to migrate existing subscriptions

const { initDatabase, Database } = require('../database');

async function migrateTiers() {
  console.log('Starting tier migration...');
  
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  try {
    // First, update the database schema to allow new tier names
    // For PostgreSQL
    if (db.isPostgres) {
      // Drop the old CHECK constraint
      await db.query(`
        ALTER TABLE subscriptions 
        DROP CONSTRAINT IF EXISTS subscriptions_tier_check
      `);
      
      // Add new CHECK constraint
      await db.query(`
        ALTER TABLE subscriptions 
        ADD CONSTRAINT subscriptions_tier_check 
        CHECK(tier IN ('tier_one', 'tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly'))
      `);
      
      console.log('PostgreSQL: Updated tier constraint to allow new and old tier names');
    } else {
      // SQLite doesn't support ALTER TABLE DROP CONSTRAINT easily
      // We'll need to recreate the table or use a workaround
      // For now, we'll just update the data and note that the constraint check needs manual update
      console.log('SQLite: Note - You may need to manually update the schema constraint');
    }
    
    // Map old tiers to new tiers
    // daily → tier_two, weekly → tier_three, monthly → tier_four
    const tierMapping = {
      'daily': 'tier_two',
      'weekly': 'tier_three',
      'monthly': 'tier_four'
    };
    
    // Update all subscriptions
    for (const [oldTier, newTier] of Object.entries(tierMapping)) {
      if (db.isPostgres) {
        const result = await db.query(
          `UPDATE subscriptions SET tier = $1 WHERE tier = $2`,
          [newTier, oldTier]
        );
        console.log(`Updated ${result.changes} subscriptions from ${oldTier} to ${newTier}`);
      } else {
        const result = await db.query(
          `UPDATE subscriptions SET tier = ? WHERE tier = ?`,
          [newTier, oldTier]
        );
        console.log(`Updated ${result.changes} subscriptions from ${oldTier} to ${newTier}`);
      }
    }
    
    // Update payments table tier references
    for (const [oldTier, newTier] of Object.entries(tierMapping)) {
      if (db.isPostgres) {
        const result = await db.query(
          `UPDATE payments SET tier = $1 WHERE tier = $2`,
          [newTier, oldTier]
        );
        console.log(`Updated ${result.changes} payment records from ${oldTier} to ${newTier}`);
      } else {
        const result = await db.query(
          `UPDATE payments SET tier = ? WHERE tier = ?`,
          [newTier, oldTier]
        );
        console.log(`Updated ${result.changes} payment records from ${oldTier} to ${newTier}`);
      }
    }
    
    // Now remove old tier names from constraint (PostgreSQL only)
    if (db.isPostgres) {
      await db.query(`
        ALTER TABLE subscriptions 
        DROP CONSTRAINT IF EXISTS subscriptions_tier_check
      `);
      
      await db.query(`
        ALTER TABLE subscriptions 
        ADD CONSTRAINT subscriptions_tier_check 
        CHECK(tier IN ('tier_one', 'tier_two', 'tier_three', 'tier_four'))
      `);
      
      console.log('PostgreSQL: Finalized tier constraint to only allow new tier names');
    }
    
    console.log('Tier migration completed successfully!');
    
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
  migrateTiers()
    .then(() => {
      console.log('Migration script completed');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Migration failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateTiers };



