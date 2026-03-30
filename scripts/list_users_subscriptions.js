/**
 * Script to list all users and their subscription tiers
 * Usage: node scripts/list_users_subscriptions.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDatabase } = require('../database');

async function listUsersAndSubscriptions() {
  let db;
  
  try {
    // Initialize database connection
    const dbInstance = await initDatabase();
    const { Database } = require('../database');
    db = new Database(dbInstance);
    
    // Query to get all users with their subscriptions
    const query = `
      SELECT 
        u.id,
        u.email,
        u.created_at as user_created_at,
        s.tier,
        s.status,
        s.start_date,
        s.end_date,
        s.created_at as subscription_created_at
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id
      ORDER BY u.id, s.created_at DESC
    `;
    
    const result = await db.query(query, []);
    const rows = result.rows || [];
    
    if (rows.length === 0) {
      console.log('No users found in the database.');
      return;
    }
    
    // Group by user (in case of multiple subscriptions)
    const usersMap = new Map();
    
    rows.forEach(row => {
      const userId = row.id;
      if (!usersMap.has(userId)) {
        usersMap.set(userId, {
          id: userId,
          email: row.email,
          created_at: row.user_created_at,
          subscriptions: []
        });
      }
      
      if (row.tier) {
        usersMap.get(userId).subscriptions.push({
          tier: row.tier,
          status: row.status,
          start_date: row.start_date,
          end_date: row.end_date,
          created_at: row.subscription_created_at
        });
      }
    });
    
    // Display results
    console.log('\n=== Users and Subscriptions ===\n');
    console.log(`Total Users: ${usersMap.size}\n`);
    
    usersMap.forEach((user, userId) => {
      console.log(`User ID: ${user.id}`);
      console.log(`Email: ${user.email}`);
      console.log(`Created: ${user.created_at || 'N/A'}`);
      
      if (user.subscriptions.length === 0) {
        console.log('Subscription: None\n');
      } else {
        console.log(`Subscriptions (${user.subscriptions.length}):`);
        user.subscriptions.forEach((sub, index) => {
          console.log(`  ${index + 1}. Tier: ${sub.tier.toUpperCase()}`);
          console.log(`     Status: ${sub.status}`);
          console.log(`     Start Date: ${sub.start_date || 'N/A'}`);
          console.log(`     End Date: ${sub.end_date || 'N/A'}`);
          console.log(`     Created: ${sub.created_at || 'N/A'}`);
        });
        console.log('');
      }
      console.log('─'.repeat(50));
      console.log('');
    });
    
    // Summary statistics
    const activeSubscriptions = rows.filter(r => r.status === 'active').length;
    const tiersCount = {
      daily: rows.filter(r => r.tier === 'daily').length,
      weekly: rows.filter(r => r.tier === 'weekly').length,
      monthly: rows.filter(r => r.tier === 'monthly').length
    };
    
    console.log('=== Summary ===');
    console.log(`Total Users: ${usersMap.size}`);
    console.log(`Users with Subscriptions: ${Array.from(usersMap.values()).filter(u => u.subscriptions.length > 0).length}`);
    console.log(`Active Subscriptions: ${activeSubscriptions}`);
    console.log(`  - Daily: ${tiersCount.daily}`);
    console.log(`  - Weekly: ${tiersCount.weekly}`);
    console.log(`  - Monthly: ${tiersCount.monthly}`);
    console.log('');
    
  } catch (error) {
    console.error('Error listing users and subscriptions:', error);
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

// Run the script
if (require.main === module) {
  listUsersAndSubscriptions()
    .then(() => {
      console.log('Done.');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { listUsersAndSubscriptions };






