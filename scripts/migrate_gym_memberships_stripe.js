// Migration script to add Stripe and pause fields to gym_memberships table
// Usage: node scripts/migrate_gym_memberships_stripe.js

const { initDatabase, Database } = require('../database');

async function migrateGymMemberships() {
  const db = new Database(await initDatabase());
  
  try {
    console.log('Starting gym_memberships migration...\n');
    
    // Check if columns already exist
    let columnsToAdd = [];
    
    if (db.isPostgres) {
      // Check existing columns in PostgreSQL
      const existingColumns = await db.query(
        `SELECT column_name 
         FROM information_schema.columns 
         WHERE table_name = 'gym_memberships'`
      );
      const columnNames = (existingColumns.rows || []).map(row => row.column_name);
      
      const requiredColumns = [
        { name: 'discount_group_id', type: 'INTEGER' }, // May be missing in older databases
        { name: 'stripe_customer_id', type: 'TEXT' },
        { name: 'stripe_subscription_id', type: 'TEXT' },
        { name: 'stripe_subscription_item_id', type: 'TEXT' },
        { name: 'billing_period', type: 'TEXT CHECK(billing_period IN (\'monthly\', \'yearly\'))' },
        { name: 'paused_at', type: 'TIMESTAMP' },
        { name: 'paused_until', type: 'TIMESTAMP' },
        { name: 'pauses_used_this_year', type: 'INTEGER DEFAULT 0' },
        { name: 'pause_resume_scheduled', type: 'BOOLEAN DEFAULT FALSE' }
      ];
      
      for (const col of requiredColumns) {
        if (!columnNames.includes(col.name)) {
          columnsToAdd.push(col);
        }
      }
      
      // Update membership_type constraint if needed
      const membershipTypeCheck = await db.query(
        `SELECT constraint_name, check_clause 
         FROM information_schema.check_constraints 
         WHERE constraint_name LIKE '%gym_memberships%membership_type%'`
      );
      
      const hasEntireFamily = (membershipTypeCheck.rows || []).some(
        row => row.check_clause && row.check_clause.includes('entire_family')
      );
      
      if (!hasEntireFamily) {
        console.log('Updating membership_type constraint to include \'entire_family\'...');
        // Drop old constraint and add new one
        await db.query(
          `ALTER TABLE gym_memberships 
           DROP CONSTRAINT IF EXISTS gym_memberships_membership_type_check`
        );
        await db.query(
          `ALTER TABLE gym_memberships 
           ADD CONSTRAINT gym_memberships_membership_type_check 
           CHECK (membership_type IN ('standard', 'immediate_family_member', 'expecting_or_recovering_mother', 'entire_family'))`
        );
        console.log('✅ Updated membership_type constraint\n');
      }
      
    } else {
      // Check existing columns in SQLite
      const tableInfo = await db.query('PRAGMA table_info(gym_memberships)');
      const columnNames = (tableInfo.rows || []).map(row => row.name);
      
      const requiredColumns = [
        { name: 'discount_group_id', type: 'INTEGER' }, // May be missing in older databases
        { name: 'stripe_customer_id', type: 'TEXT' },
        { name: 'stripe_subscription_id', type: 'TEXT' },
        { name: 'stripe_subscription_item_id', type: 'TEXT' },
        { name: 'billing_period', type: 'TEXT' },
        { name: 'paused_at', type: 'DATETIME' },
        { name: 'paused_until', type: 'DATETIME' },
        { name: 'pauses_used_this_year', type: 'INTEGER DEFAULT 0' },
        { name: 'pause_resume_scheduled', type: 'INTEGER DEFAULT 0' }
      ];
      
      for (const col of requiredColumns) {
        if (!columnNames.includes(col.name)) {
          columnsToAdd.push(col);
        }
      }
      
      // SQLite doesn't support modifying CHECK constraints easily
      // The constraint will be updated when the table is recreated
      // For now, we'll just add the columns
      console.log('Note: SQLite CHECK constraints are defined at table creation.');
      console.log('The membership_type constraint will be updated on next table creation.\n');
    }
    
    // Add missing columns
    if (columnsToAdd.length > 0) {
      console.log(`Adding ${columnsToAdd.length} new column(s)...`);
      
      for (const col of columnsToAdd) {
        try {
          if (db.isPostgres) {
            await db.query(
              `ALTER TABLE gym_memberships ADD COLUMN ${col.name} ${col.type}`
            );
          } else {
            // SQLite - billing_period needs special handling for CHECK constraint
            if (col.name === 'billing_period') {
              await db.query(
                `ALTER TABLE gym_memberships ADD COLUMN ${col.name} TEXT`
              );
            } else {
              await db.query(
                `ALTER TABLE gym_memberships ADD COLUMN ${col.name} ${col.type}`
              );
            }
          }
          console.log(`✅ Added column: ${col.name}`);
        } catch (error) {
          if (error.message && error.message.includes('duplicate') || 
              error.message && error.message.includes('already exists')) {
            console.log(`ℹ️  Column ${col.name} already exists, skipping...`);
          } else {
            throw error;
          }
        }
      }
      console.log('');
    } else {
      console.log('✅ All columns already exist\n');
    }
    
    // Verify migration
    console.log('Verifying migration...');
    if (db.isPostgres) {
      const verifyColumns = await db.query(
        `SELECT column_name, data_type, column_default
         FROM information_schema.columns 
         WHERE table_name = 'gym_memberships'
         ORDER BY ordinal_position`
      );
      console.log('\nCurrent gym_memberships columns:');
      (verifyColumns.rows || []).forEach(col => {
        console.log(`  - ${col.column_name} (${col.data_type})${col.column_default ? ` DEFAULT ${col.column_default}` : ''}`);
      });
    } else {
      const verifyColumns = await db.query('PRAGMA table_info(gym_memberships)');
      console.log('\nCurrent gym_memberships columns:');
      (verifyColumns.rows || []).forEach(col => {
        console.log(`  - ${col.name} (${col.type})${col.dflt_value ? ` DEFAULT ${col.dflt_value}` : ''}`);
      });
    }
    
    console.log('\n✅ Migration completed successfully!');
    
  } catch (error) {
    console.error('❌ Migration failed:', error);
    throw error;
  } finally {
    if (db.db.end) {
      await db.db.end();
    }
  }
}

// Run if called directly
if (require.main === module) {
  migrateGymMemberships()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { migrateGymMemberships };

