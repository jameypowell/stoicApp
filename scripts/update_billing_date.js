// Script to update Jamey's membership billing date to the 15th
const { initDatabase, Database } = require('../database');

async function updateBillingDate() {
  const db = new Database(await initDatabase());
  
  try {
    const jamey = await db.getUserByEmail('jameypowell@gmail.com');
    if (!jamey) {
      console.error('❌ User not found');
      process.exit(1);
    }
    
    if (db.isPostgres) {
      await db.query(
        'UPDATE gym_memberships SET start_date = $1 WHERE user_id = $2',
        ['2025-12-15', jamey.id]
      );
    } else {
      await db.query(
        'UPDATE gym_memberships SET start_date = ? WHERE user_id = ?',
        ['2025-12-15', jamey.id]
      );
    }
    
    console.log('✅ Updated membership start_date to 2025-12-15');
  } catch (error) {
    console.error('❌ Error:', error);
    process.exit(1);
  } finally {
    if (db.db.end) await db.db.end();
  }
}

updateBillingDate();












