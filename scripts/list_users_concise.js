/**
 * Script to list all users with subscription tier and status (concise format)
 * Usage: node scripts/list_users_concise.js
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });
const { initDatabase } = require('../database');

async function listUsersConcise() {
  let db;
  
  try {
    // Initialize database connection
    const dbInstance = await initDatabase();
    const { Database } = require('../database');
    db = new Database(dbInstance);
    
    // Query to get all users with their active subscriptions
    const query = `
      SELECT 
        u.email,
        s.tier,
        s.status,
        s.end_date
      FROM users u
      LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
      ORDER BY u.email
    `;
    
    const result = await db.query(query, []);
    const rows = result.rows || [];
    
    if (rows.length === 0) {
      console.log('No users found.');
      return;
    }
    
    // Display concise list
    console.log('\nUsers and Subscriptions:\n');
    console.log('Email'.padEnd(35) + 'Tier'.padEnd(12) + 'Status'.padEnd(12) + 'End Date');
    console.log('-'.repeat(75));
    
    rows.forEach(row => {
      const email = (row.email || 'N/A').padEnd(35);
      const tier = (row.tier ? row.tier.toUpperCase() : 'None').padEnd(12);
      const status = (row.status || 'None').padEnd(12);
      const endDate = row.end_date || 'N/A';
      
      console.log(`${email}${tier}${status}${endDate}`);
    });
    
    // Summary
    const withSubscriptions = rows.filter(r => r.tier).length;
    const activeCount = rows.filter(r => r.status === 'active').length;
    const expiredCount = rows.filter(r => r.status === 'expired').length;
    
    console.log('\n' + '-'.repeat(75));
    console.log(`Total Users: ${rows.length}`);
    console.log(`With Subscriptions: ${withSubscriptions}`);
    console.log(`Active: ${activeCount} | Expired: ${expiredCount} | None: ${rows.length - withSubscriptions}`);
    console.log('');
    
  } catch (error) {
    console.error('Error:', error);
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
  listUsersConcise()
    .then(() => process.exit(0))
    .catch((error) => {
      console.error('Fatal error:', error);
      process.exit(1);
    });
}

module.exports = { listUsersConcise };






