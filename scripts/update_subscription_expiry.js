/**
 * Script to update subscription expiration dates
 * Usage: node scripts/update_subscription_expiry.js <email> <action> [days]
 * 
 * Actions:
 *   expire - Set subscription to expired (status='expired', end_date=today)
 *   extend - Extend subscription by N days (default: 5)
 *   set - Set expiration to N days from today
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDatabase } = require('../database');

async function updateSubscriptionExpiry(email, action, days = 5) {
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
    
    // Get user's active subscription
    const subscription = await db.getUserActiveSubscription(user.id);
    if (!subscription) {
      console.error(`User ${email} has no active subscription.`);
      process.exit(1);
    }
    
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    
    let newEndDate;
    let newStatus;
    
    if (action === 'expire') {
      // Set to expired - end date is today (or yesterday)
      newEndDate = new Date(today);
      newEndDate.setDate(today.getDate() - 1); // Set to yesterday to ensure it's expired
      newStatus = 'expired';
    } else if (action === 'set') {
      // Set expiration to N days from today
      newEndDate = new Date(today);
      newEndDate.setDate(today.getDate() + days);
      newStatus = 'active'; // Keep active
    } else if (action === 'extend') {
      // Extend by N days from current end date
      const currentEndDate = subscription.end_date 
        ? new Date(subscription.end_date)
        : new Date(today);
      currentEndDate.setHours(0, 0, 0, 0);
      newEndDate = new Date(currentEndDate);
      newEndDate.setDate(currentEndDate.getDate() + days);
      newStatus = 'active'; // Keep active
    } else {
      console.error(`Invalid action: ${action}. Use 'expire', 'set', or 'extend'.`);
      process.exit(1);
    }
    
    // Format date for database (YYYY-MM-DD)
    const endDateStr = `${newEndDate.getFullYear()}-${String(newEndDate.getMonth() + 1).padStart(2, '0')}-${String(newEndDate.getDate()).padStart(2, '0')}`;
    
    // Update subscription
    if (db.isPostgres) {
      await db.query(
        `UPDATE subscriptions 
         SET end_date = $1, status = $2 
         WHERE id = $3`,
        [endDateStr, newStatus, subscription.id]
      );
    } else {
      await db.query(
        `UPDATE subscriptions 
         SET end_date = ?, status = ? 
         WHERE id = ?`,
        [endDateStr, newStatus, subscription.id]
      );
    }
    
    console.log(`✅ Updated subscription for ${email}:`);
    console.log(`   Status: ${newStatus}`);
    console.log(`   End Date: ${endDateStr}`);
    console.log(`   Action: ${action}`);
    if (action === 'extend' || action === 'set') {
      const daysUntilExpiry = Math.ceil((newEndDate - today) / (1000 * 60 * 60 * 24));
      console.log(`   Days until expiry: ${daysUntilExpiry}`);
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
    console.log('Usage: node scripts/update_subscription_expiry.js <email> <action> [days]');
    console.log('');
    console.log('Actions:');
    console.log('  expire - Set subscription to expired');
    console.log('  set    - Set expiration to N days from today (default: 5)');
    console.log('  extend - Extend subscription by N days (default: 5)');
    console.log('');
    console.log('Examples:');
    console.log('  node scripts/update_subscription_expiry.js user@example.com expire');
    console.log('  node scripts/update_subscription_expiry.js user@example.com set 5');
    console.log('  node scripts/update_subscription_expiry.js user@example.com extend 10');
    process.exit(1);
  }
  
  const email = args[0];
  const action = args[1];
  const days = args[2] ? parseInt(args[2], 10) : 5;
  
  updateSubscriptionExpiry(email, action, days)
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { updateSubscriptionExpiry };






