// Script to create a discount group for Jamey and add 5 members from the database
// Usage: node scripts/add_group_members_to_jamey.js

const { initDatabase, Database } = require('../database');
const bcrypt = require('bcryptjs');
const crypto = require('crypto');

async function addGroupMembersToJamey() {
  const db = new Database(await initDatabase());
  
  try {
    console.log('Setting up discount group for Jamey Powell...\n');
    
    // Get Jamey's user
    const jamey = await db.getUserByEmail('jameypowell@gmail.com');
    if (!jamey) {
      console.error('❌ User jameypowell@gmail.com not found');
      process.exit(1);
    }
    
    console.log(`✅ Found user: ${jamey.email} (ID: ${jamey.id})`);
    
    // Create or get discount group
    let discountGroup;
    if (db.isPostgres) {
      discountGroup = await db.queryOne(
        'SELECT * FROM discount_groups WHERE group_leader_id = $1',
        [jamey.id]
      );
    } else {
      discountGroup = await db.queryOne(
        'SELECT * FROM discount_groups WHERE group_leader_id = ?',
        [jamey.id]
      );
    }
    
    if (!discountGroup) {
      // Create discount group
      const groupId = `GROUP-${Date.now()}`;
      const accessCode = crypto.randomBytes(4).toString('hex').toUpperCase();
      
      if (db.isPostgres) {
        const result = await db.query(
          'INSERT INTO discount_groups (group_id, group_access_code, group_leader_id) VALUES ($1, $2, $3) RETURNING id',
          [groupId, accessCode, jamey.id]
        );
        discountGroup = { id: result.rows[0].id, group_id: groupId, group_access_code: accessCode, group_leader_id: jamey.id };
      } else {
        const result = await db.query(
          'INSERT INTO discount_groups (group_id, group_access_code, group_leader_id) VALUES (?, ?, ?)',
          [groupId, accessCode, jamey.id]
        );
        discountGroup = { id: result.lastID, group_id: groupId, group_access_code: accessCode, group_leader_id: jamey.id };
      }
      console.log(`✅ Created discount group: ${groupId} (Access Code: ${accessCode})`);
    } else {
      console.log(`ℹ️  Discount group already exists: ${discountGroup.group_id}`);
    }
    
    // Get Jamey's gym membership and update it to include discount_group_id
    let jameyMembership;
    if (db.isPostgres) {
      jameyMembership = await db.queryOne(
        'SELECT * FROM gym_memberships WHERE user_id = $1',
        [jamey.id]
      );
    } else {
      jameyMembership = await db.queryOne(
        'SELECT * FROM gym_memberships WHERE user_id = ?',
        [jamey.id]
      );
    }
    
    if (jameyMembership && !jameyMembership.discount_group_id) {
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
      console.log(`✅ Added Jamey to discount group`);
    } else if (jameyMembership && jameyMembership.discount_group_id) {
      console.log(`ℹ️  Jamey is already in a discount group`);
    }
    
    // Get 5 users from the database (excluding Jamey and his family)
    let availableUsers;
    if (db.isPostgres) {
      const result = await db.query(
        `SELECT u.id, u.email, u.name 
         FROM users u
         WHERE u.id != $1 
           AND u.email NOT IN ($2, $3)
           AND NOT EXISTS (
             SELECT 1 FROM gym_memberships gm 
             WHERE gm.user_id = u.id 
             AND gm.discount_group_id = $4
           )
         LIMIT 5`,
        [jamey.id, 'brandapowell@gmail.com', 'cambriepowell@gmail.com', discountGroup.id]
      );
      availableUsers = result.rows || [];
    } else {
      const result = await db.query(
        `SELECT u.id, u.email, u.name 
         FROM users u
         WHERE u.id != ? 
           AND u.email NOT IN (?, ?)
           AND NOT EXISTS (
             SELECT 1 FROM gym_memberships gm 
             WHERE gm.user_id = u.id 
             AND gm.discount_group_id = ?
           )
         LIMIT 5`,
        [jamey.id, 'brandapowell@gmail.com', 'cambriepowell@gmail.com', discountGroup.id]
      );
      availableUsers = (result && result.rows) ? result.rows : (Array.isArray(result) ? result : []);
    }
    
    console.log(`\nFound ${availableUsers.length} available users to add to group`);
    
    // If we don't have 5 users, create some test users
    const usersToAdd = [];
    if (availableUsers.length < 5) {
      const needed = 5 - availableUsers.length;
      console.log(`\nCreating ${needed} test users...`);
      
      for (let i = 1; i <= needed; i++) {
        const testEmail = `groupmember${i}@stoicfitness.com`;
        const testName = `Group Member ${i}`;
        
        // Check if user already exists
        let user = await db.getUserByEmail(testEmail);
        
        if (!user) {
          const passwordHash = await bcrypt.hash('temp_password_' + Date.now(), 10);
          user = await db.createUser(testEmail, passwordHash, testName);
          console.log(`✅ Created test user: ${testEmail}`);
        } else {
          console.log(`ℹ️  Test user already exists: ${testEmail}`);
        }
        
        usersToAdd.push({ id: user.id, email: user.email, name: user.name || testName });
      }
    }
    
    // Add all available users to the list
    availableUsers.forEach(u => {
      usersToAdd.push({ id: u.id, email: u.email, name: u.name || u.email });
    });
    
    // Add each user to the discount group
    console.log(`\nAdding ${usersToAdd.length} members to discount group...`);
    for (const member of usersToAdd) {
      // Check if membership exists
      let membership;
      if (db.isPostgres) {
        membership = await db.queryOne(
          'SELECT * FROM gym_memberships WHERE user_id = $1',
          [member.id]
        );
      } else {
        membership = await db.queryOne(
          'SELECT * FROM gym_memberships WHERE user_id = ?',
          [member.id]
        );
      }
      
      if (!membership) {
        // Create membership with discount group
        if (db.isPostgres) {
          await db.query(
            `INSERT INTO gym_memberships (user_id, membership_type, discount_group_id, status)
             VALUES ($1, 'standard', $2, 'active')`,
            [member.id, discountGroup.id]
          );
        } else {
          await db.query(
            `INSERT INTO gym_memberships (user_id, membership_type, discount_group_id, status)
             VALUES (?, 'standard', ?, 'active')`,
            [member.id, discountGroup.id]
          );
        }
        console.log(`✅ Created membership and added ${member.email} to discount group`);
      } else {
        // Update existing membership to add to discount group
        if (db.isPostgres) {
          await db.query(
            'UPDATE gym_memberships SET discount_group_id = $1, status = $2 WHERE user_id = $3',
            [discountGroup.id, 'active', member.id]
          );
        } else {
          await db.query(
            'UPDATE gym_memberships SET discount_group_id = ?, status = ? WHERE user_id = ?',
            [discountGroup.id, 'active', member.id]
          );
        }
        console.log(`✅ Added ${member.email} to discount group`);
      }
    }
    
    console.log('\n✅ Group setup complete!');
    console.log(`\nSummary:`);
    console.log(`- Discount Group: ${discountGroup.group_id}`);
    console.log(`- Access Code: ${discountGroup.group_access_code}`);
    console.log(`- Group Leader: Jamey Powell (jameypowell@gmail.com)`);
    console.log(`- Total Members: ${usersToAdd.length + 1} (including Jamey)`);
    console.log(`\nGroup Members:`);
    console.log(`- Jamey Powell (jameypowell@gmail.com) - Group Leader`);
    usersToAdd.forEach(member => {
      console.log(`- ${member.name || member.email} (${member.email})`);
    });
    
  } catch (error) {
    console.error('❌ Error setting up group:', error);
    throw error;
  } finally {
    if (db.db.end) {
      await db.db.end();
    }
  }
}

// Run if called directly
if (require.main === module) {
  addGroupMembersToJamey()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addGroupMembersToJamey };

