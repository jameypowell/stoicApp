// Script to add 3 test members to jamey's discount group
const { initDatabase, Database } = require('../database');

async function addTestGroupMembers() {
    const db = new Database(await initDatabase());

    try {
        // Get jamey's discount group
        const jamey = await db.getUserByEmail('jameypowell@gmail.com');
        if (!jamey) {
            console.error('❌ User jameypowell@gmail.com not found');
            return;
        }

        const discountGroup = await db.queryOne(
            db.isPostgres 
                ? 'SELECT * FROM discount_groups WHERE group_leader_id = $1'
                : 'SELECT * FROM discount_groups WHERE group_leader_id = ?',
            [jamey.id]
        );

        if (!discountGroup) {
            console.error('❌ Discount group not found for jamey');
            return;
        }

        console.log(`✅ Found discount group: ${discountGroup.group_id}`);

        // Create 3 test users and add them to the group
        const testMembers = [
            { email: 'testmember1@example.com', name: 'Test Member 1', status: 'active' },
            { email: 'testmember2@example.com', name: 'Test Member 2', status: 'active' },
            { email: 'testmember3@example.com', name: 'Test Member 3', status: 'active' }
        ];

        for (const testMember of testMembers) {
            // Check if user exists
            let user = await db.getUserByEmail(testMember.email);
            
            if (!user) {
                // Create user
                const bcrypt = require('bcryptjs');
                const passwordHash = await bcrypt.hash('password123', 10);
                user = await db.createUser(testMember.email, passwordHash, testMember.name);
                console.log(`✅ Created user: ${testMember.email}`);
            } else {
                console.log(`ℹ️  User already exists: ${testMember.email}`);
            }

            // Check if membership exists
            let membership = await db.queryOne(
                db.isPostgres 
                    ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
                    : 'SELECT * FROM gym_memberships WHERE user_id = ?',
                [user.id]
            );

            if (!membership) {
                // Create membership
                if (db.isPostgres) {
                    await db.query(
                        `INSERT INTO gym_memberships (user_id, membership_type, discount_group_id, status)
                         VALUES ($1, 'standard', $2, $3)`,
                        [user.id, discountGroup.id, testMember.status]
                    );
                } else {
                    await db.query(
                        `INSERT INTO gym_memberships (user_id, membership_type, discount_group_id, status)
                         VALUES (?, 'standard', ?, ?)`,
                        [user.id, discountGroup.id, testMember.status]
                    );
                }
                console.log(`✅ Added membership for ${testMember.email} to discount group`);
            } else {
                // Update existing membership to add to discount group
                if (db.isPostgres) {
                    await db.query(
                        'UPDATE gym_memberships SET discount_group_id = $1, status = $2 WHERE user_id = $3',
                        [discountGroup.id, testMember.status, user.id]
                    );
                } else {
                    await db.query(
                        'UPDATE gym_memberships SET discount_group_id = ?, status = ? WHERE user_id = ?',
                        [discountGroup.id, testMember.status, user.id]
                    );
                }
                console.log(`✅ Updated membership for ${testMember.email} to join discount group`);
            }
        }

        console.log('\n✅ Test group members added successfully!');
        console.log('\nAdded to group:');
        testMembers.forEach(tm => {
            console.log(`- ${tm.name} (${tm.email})`);
        });

    } catch (error) {
        console.error('❌ Error adding test group members:', error);
    } finally {
        if (db.db.end) await db.db.end();
    }
}

addTestGroupMembers().catch(console.error);



















