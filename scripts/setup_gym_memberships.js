// Script to set up gym membership data for dev environment only
// Usage: node scripts/setup_gym_memberships.js

const { initDatabase, Database } = require('../database');
const bcrypt = require('bcryptjs');

const MEMBERSHIP_PRICING = {
  'standard': 65,
  'immediate_family_member': 50,
  'expecting_or_recovering_mother': 30
};

async function setupGymMemberships() {
  const db = new Database(await initDatabase());
  
  try {
    console.log('Setting up gym memberships for dev environment...\n');
    
    // Users to set up
    const users = [
      { email: 'jameypowell@gmail.com', name: 'Jamey Powell', type: 'standard', isPrimary: true },
      { email: 'branda.cooper@gmail.com', name: 'Branda Powell', type: 'immediate_family_member', isPrimary: false },
      { email: 'cambriebpowell@gmail.com', name: 'Cambrie Powell', type: 'immediate_family_member', isPrimary: false }
    ];
    
    const userIds = [];
    
    // Ensure all users exist and get/create them
    for (const userInfo of users) {
      let user = await db.getUserByEmail(userInfo.email);
      
      if (!user) {
        // Create user with a placeholder password
        const passwordHash = await bcrypt.hash('placeholder_password_' + Date.now(), 10);
        user = await db.createUser(userInfo.email, passwordHash, userInfo.name);
        console.log(`✅ Created user: ${userInfo.email}`);
      } else {
        // Update name if needed
        if (userInfo.name && (!user.name || user.name !== userInfo.name)) {
          await db.updateUserName(user.id, userInfo.name);
          console.log(`✅ Updated name for user: ${userInfo.email} -> ${userInfo.name}`);
        } else {
          console.log(`ℹ️  User already exists: ${userInfo.email}`);
        }
      }
      
      userIds.push({ id: user.id, ...userInfo });
    }
    
    // Find or create primary user (Jamey)
    const primaryUser = userIds.find(u => u.isPrimary);
    
    if (!primaryUser) {
      throw new Error('Primary user not found');
    }
    
    // Create or get family group
    let familyGroup;
    if (db.isPostgres) {
      familyGroup = await db.queryOne(
        'SELECT * FROM family_groups WHERE primary_user_id = $1',
        [primaryUser.id]
      );
    } else {
      familyGroup = await db.queryOne(
        'SELECT * FROM family_groups WHERE primary_user_id = ?',
        [primaryUser.id]
      );
    }
    
    if (!familyGroup) {
      if (db.isPostgres) {
        const result = await db.query(
          'INSERT INTO family_groups (primary_user_id) VALUES ($1) RETURNING id',
          [primaryUser.id]
        );
        familyGroup = { id: result.rows[0].id, primary_user_id: primaryUser.id };
      } else {
        const result = await db.query(
          'INSERT INTO family_groups (primary_user_id) VALUES (?)',
          [primaryUser.id]
        );
        familyGroup = { id: result.lastID, primary_user_id: primaryUser.id };
      }
      console.log(`✅ Created family group with primary user: ${primaryUser.email}`);
    } else {
      console.log(`ℹ️  Family group already exists for primary user: ${primaryUser.email}`);
    }
    
    // Create or update gym memberships
    for (const userInfo of userIds) {
      // Check if membership already exists
      let membership;
      if (db.isPostgres) {
        membership = await db.queryOne(
          'SELECT * FROM gym_memberships WHERE user_id = $1',
          [userInfo.id]
        );
      } else {
        membership = await db.queryOne(
          'SELECT * FROM gym_memberships WHERE user_id = ?',
          [userInfo.id]
        );
      }
      
      const isPrimary = userInfo.isPrimary || false;
      const familyGroupId = familyGroup.id;
      
      if (membership) {
        // Update existing membership
        if (db.isPostgres) {
          await db.query(
            `UPDATE gym_memberships 
             SET membership_type = $1, 
                 family_group_id = $2, 
                 is_primary_member = $3,
                 status = 'active',
                 updated_at = CURRENT_TIMESTAMP
             WHERE user_id = $4`,
            [userInfo.type, familyGroupId, isPrimary, userInfo.id]
          );
        } else {
          await db.query(
            `UPDATE gym_memberships 
             SET membership_type = ?, 
                 family_group_id = ?, 
                 is_primary_member = ?,
                 status = 'active',
                 updated_at = datetime('now')
             WHERE user_id = ?`,
            [userInfo.type, familyGroupId, isPrimary ? 1 : 0, userInfo.id]
          );
        }
        console.log(`✅ Updated gym membership for: ${userInfo.email} (${userInfo.type})`);
      } else {
        // Create new membership
        if (db.isPostgres) {
          await db.query(
            `INSERT INTO gym_memberships 
             (user_id, membership_type, family_group_id, is_primary_member, status)
             VALUES ($1, $2, $3, $4, 'active')`,
            [userInfo.id, userInfo.type, familyGroupId, isPrimary]
          );
        } else {
          await db.query(
            `INSERT INTO gym_memberships 
             (user_id, membership_type, family_group_id, is_primary_member, status)
             VALUES (?, ?, ?, ?, 'active')`,
            [userInfo.id, userInfo.type, familyGroupId, isPrimary ? 1 : 0]
          );
        }
        console.log(`✅ Created gym membership for: ${userInfo.email} (${userInfo.type})`);
      }
    }
    
    console.log('\n✅ Gym membership setup complete!');
    console.log('\nSummary:');
    console.log(`- Primary member: ${primaryUser.email} (Standard - $${MEMBERSHIP_PRICING.standard}/month)`);
    userIds.filter(u => !u.isPrimary).forEach(u => {
      console.log(`- Family member: ${u.email} (${u.type.replace(/_/g, ' ')} - $${MEMBERSHIP_PRICING[u.type]}/month)`);
    });
    
  } catch (error) {
    console.error('❌ Error setting up gym memberships:', error);
    throw error;
  } finally {
    if (db.db.end) {
      await db.db.end();
    }
  }
}

// Run if called directly
if (require.main === module) {
  setupGymMemberships()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { setupGymMemberships };



















