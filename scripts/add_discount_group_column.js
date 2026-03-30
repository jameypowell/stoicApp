// Script to add discount_group_id column to gym_memberships table
const { initDatabase, Database } = require('../database');

async function addDiscountGroupColumn() {
    const db = new Database(await initDatabase());

    try {
        console.log('Adding discount_group_id column to gym_memberships table...');
        
        if (db.isPostgres) {
            // Check if column already exists
            const checkColumn = await db.query(
                `SELECT column_name 
                 FROM information_schema.columns 
                 WHERE table_name='gym_memberships' AND column_name='discount_group_id'`
            );
            
            if (checkColumn.rows.length === 0) {
                await db.query(
                    'ALTER TABLE gym_memberships ADD COLUMN discount_group_id INTEGER'
                );
                console.log('✅ Added discount_group_id column to gym_memberships');
            } else {
                console.log('✅ Column discount_group_id already exists');
            }
        } else {
            // SQLite - check if column exists
            const tableInfo = await db.query('PRAGMA table_info(gym_memberships)');
            const hasColumn = tableInfo.some(col => col.name === 'discount_group_id');
            
            if (!hasColumn) {
                // SQLite doesn't support ALTER TABLE ADD COLUMN easily, need to recreate
                console.log('⚠️  SQLite detected. Column will be added via schema initialization.');
            } else {
                console.log('✅ Column discount_group_id already exists');
            }
        }

    } catch (error) {
        console.error('❌ Error adding column:', error);
    } finally {
        if (db.db.end) await db.db.end();
    }
}

addDiscountGroupColumn().catch(console.error);



















