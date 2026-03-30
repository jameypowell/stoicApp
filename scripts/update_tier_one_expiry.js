// Script to update tier_one subscriptions to expire 10 days from their start date
const sqlite3 = require('sqlite3').verbose();
const path = require('path');

const DB_PATH = path.join(__dirname, '..', 'data', 'stoic-shop.db');

async function updateTierOneExpiry() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('Error opening database:', err);
        reject(err);
        return;
      }
      console.log('Connected to SQLite database');
    });

    // First, let's see what we're working with
    db.all(`
      SELECT 
        id,
        user_id,
        tier,
        start_date,
        end_date,
        created_at,
        status
      FROM subscriptions
      WHERE tier = 'tier_one'
      ORDER BY created_at DESC
    `, [], (err, rows) => {
      if (err) {
        console.error('Error querying subscriptions:', err);
        db.close();
        reject(err);
        return;
      }

      console.log(`\nFound ${rows.length} tier_one subscription(s):\n`);
      
      if (rows.length === 0) {
        console.log('No tier_one subscriptions found. Nothing to update.');
        db.close();
        resolve();
        return;
      }

      // Display current state
      rows.forEach((row, index) => {
        console.log(`${index + 1}. Subscription ID: ${row.id}, User ID: ${row.user_id}`);
        console.log(`   Start Date: ${row.start_date}`);
        console.log(`   Current End Date: ${row.end_date}`);
        console.log(`   Created At: ${row.created_at}`);
        console.log(`   Status: ${row.status}\n`);
      });

      // Update each subscription
      let updated = 0;
      let errors = 0;

      rows.forEach((row) => {
        // Use start_date if available, otherwise use created_at
        const baseDate = row.start_date || row.created_at;
        
        // Calculate new end date (10 days from base date)
        const baseDateObj = new Date(baseDate);
        const newEndDate = new Date(baseDateObj);
        newEndDate.setDate(newEndDate.getDate() + 10);

        const newEndDateISO = newEndDate.toISOString();

        db.run(`
          UPDATE subscriptions
          SET end_date = ?
          WHERE id = ?
        `, [newEndDateISO, row.id], function(updateErr) {
          if (updateErr) {
            console.error(`Error updating subscription ${row.id}:`, updateErr);
            errors++;
          } else {
            console.log(`✅ Updated subscription ${row.id}: New end date = ${newEndDateISO}`);
            updated++;
          }

          // Check if we've processed all rows
          if (updated + errors === rows.length) {
            console.log(`\n✅ Update complete!`);
            console.log(`   Updated: ${updated}`);
            console.log(`   Errors: ${errors}`);
            db.close();
            resolve();
          }
        });
      });
    });
  });
}

// Run the update
updateTierOneExpiry()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });























