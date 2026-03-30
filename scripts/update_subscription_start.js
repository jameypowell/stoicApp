/**
 * Script to update subscription start date
 * Usage: node scripts/update_subscription_start.js <email> <start_date>
 * 
 * Example:
 *   node scripts/update_subscription_start.js cambrie@poopypants.com 2025-10-19
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDatabase } = require('../database');

async function updateSubscriptionStart(email, startDateStr) {
  let db;
  
  try {
    // Initialize database connection
    const dbInstance = await initDatabase();
    const { Database } = require('../database');
    db = new Database(dbInstance);
    
    // Get user by email
    const user = await db.getUserByEmail(email);
    if (!user) {
      console.error(`User with email ${email} not found.`);
      process.exit(1);
    }
    
    // Get user's latest subscription (active or expired)
    const subscription = await db.getUserLatestSubscription(user.id);
    if (!subscription) {
      console.error(`User ${email} has no subscription.`);
      process.exit(1);
    }
    
    // Parse start date
    const startDate = new Date(startDateStr + 'T00:00:00');
    if (isNaN(startDate.getTime())) {
      console.error(`Invalid date format: ${startDateStr}. Use YYYY-MM-DD format.`);
      process.exit(1);
    }
    
    // Format date for database (YYYY-MM-DD)
    const startDateFormatted = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
    
    // Update subscription start date
    if (db.isPostgres) {
      await db.query(
        `UPDATE subscriptions 
         SET start_date = $1 
         WHERE id = $2`,
        [startDateFormatted, subscription.id]
      );
    } else {
      await db.query(
        `UPDATE subscriptions 
         SET start_date = ? 
         WHERE id = ?`,
        [startDateFormatted, subscription.id]
      );
    }
    
    console.log(`✅ Updated subscription start date for ${email}:`);
    console.log(`   Start Date: ${startDateFormatted}`);
    console.log(`   Tier: ${subscription.tier}`);
    console.log(`   Status: ${subscription.status}`);
    
    // If subscription has an end date, show the duration
    if (subscription.end_date) {
      const endDate = new Date(subscription.end_date);
      const daysDiff = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
      console.log(`   End Date: ${subscription.end_date}`);
      console.log(`   Duration: ${daysDiff} days`);
    }
    
  } catch (error) {
    console.error('Error updating subscription:', error);
    process.exit(1);
  } finally {
    // Close database connection
    if (db && db.db) {
      if (db.isPostgres) {
        await db.db.end();
      } else {
        return new Promise((resolve) => {
          db.db.close((err) => {
            if (err) console.error('Error closing database:', err);
            resolve();
          });
        });
      }
    }
  }
}

// Main execution
if (require.main === module) {
  const args = process.argv.slice(2);
  
  if (args.length < 2) {
    console.log('Usage: node scripts/update_subscription_start.js <email> <start_date>');
    console.log('');
    console.log('Example:');
    console.log('  node scripts/update_subscription_start.js cambrie@poopypants.com 2025-10-19');
    process.exit(1);
  }
  
  const email = args[0];
  const startDate = args[1];
  
  updateSubscriptionStart(email, startDate)
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { updateSubscriptionStart };






