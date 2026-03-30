// Script to set up jamey as group leader with access code
const { initDatabase, Database } = require('../database');

async function setupGroupLeader() {
    const db = new Database(await initDatabase());

    try {
        // Get jamey's user ID
        const jamey = await db.getUserByEmail('jameypowell@gmail.com');
        if (!jamey) {
            console.error('❌ User jameypowell@gmail.com not found');
            return;
        }

        console.log(`✅ Found user: ${jamey.email} (ID: ${jamey.id})`);

        // Generate group ID and access code
        const groupId = `GRP-${Date.now().toString().slice(-6)}`;
        const groupAccessCode = `CODE-${Math.random().toString(36).substring(2, 8).toUpperCase()}`;

        console.log(`📝 Creating discount group:`);
        console.log(`   Group ID: ${groupId}`);
        console.log(`   Access Code: ${groupAccessCode}`);
        console.log(`   Leader: ${jamey.email}`);

        // Create discount group
        let discountGroup;
        if (db.isPostgres) {
            const result = await db.query(
                `INSERT INTO discount_groups (group_id, group_access_code, group_leader_id)
                 VALUES ($1, $2, $3)
                 ON CONFLICT (group_id) DO UPDATE SET
                   group_access_code = EXCLUDED.group_access_code,
                   group_leader_id = EXCLUDED.group_leader_id
                 RETURNING *`,
                [groupId, groupAccessCode, jamey.id]
            );
            discountGroup = result.rows[0];
        } else {
            // Check if group already exists
            const existing = await db.queryOne(
                'SELECT * FROM discount_groups WHERE group_leader_id = ?',
                [jamey.id]
            );
            
            if (existing) {
                await db.query(
                    'UPDATE discount_groups SET group_id = ?, group_access_code = ? WHERE id = ?',
                    [groupId, groupAccessCode, existing.id]
                );
                discountGroup = await db.queryOne(
                    'SELECT * FROM discount_groups WHERE id = ?',
                    [existing.id]
                );
            } else {
                await db.query(
                    'INSERT INTO discount_groups (group_id, group_access_code, group_leader_id) VALUES (?, ?, ?)',
                    [groupId, groupAccessCode, jamey.id]
                );
                discountGroup = await db.queryOne(
                    'SELECT * FROM discount_groups WHERE group_leader_id = ?',
                    [jamey.id]
                );
            }
        }

        if (!discountGroup) {
            console.error('❌ Failed to create discount group');
            return;
        }

        console.log(`✅ Created discount group with ID: ${discountGroup.id}`);

        // Update jamey's gym membership to link to discount group
        const membership = await db.queryOne(
            db.isPostgres 
                ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
                : 'SELECT * FROM gym_memberships WHERE user_id = ?',
            [jamey.id]
        );

        if (membership) {
            if (db.isPostgres) {
                await db.query(
                    'UPDATE gym_memberships SET discount_group_id = $1 WHERE user_id = $2',
                    [discountGroup.id, jamey.id]
                );
            } else {
                await db.query(
                    'UPDATE gym_memberships SET discount_group_id = ? WHERE user_id = ?',
                    [discountGroup.id, jamey.id]
                );
            }
            console.log(`✅ Updated jamey's gym membership to link to discount group`);
        } else {
            console.log(`⚠️  Jamey doesn't have a gym membership yet. You'll need to create one first.`);
        }

        console.log('\n✅ Group setup complete!');
        console.log(`\nGroup Details:`);
        console.log(`- Group ID: ${groupId}`);
        console.log(`- Access Code: ${groupAccessCode}`);
        console.log(`- Leader: ${jamey.email} (${jamey.name || 'N/A'})`);

    } catch (error) {
        console.error('❌ Error setting up group leader:', error);
    } finally {
        if (db.db.end) await db.db.end();
    }
}

setupGroupLeader().catch(console.error);



















