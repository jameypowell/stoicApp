// Script to add gym membership for Jamey Powell with family members
// Usage: node scripts/add_powell_family_membership.js

const { initDatabase, Database } = require('../database');
const bcrypt = require('bcryptjs');

async function addPowellFamilyMembership() {
  const db = new Database(await initDatabase());
  
  try {
    console.log('Setting up gym membership for Jamey Powell and family...\n');
    
    // Primary user
    const primaryEmail = 'jameypowell@gmail.com';
    const primaryName = 'Jamey Powell';
    
    // Family members
    const familyMembers = [
      { name: 'Branda Powell', email: 'brandapowell@gmail.com' },
      { name: 'Cambrie Powell', email: 'cambriepowell@gmail.com' }
    ];
    
    // Get or create primary user
    let primaryUser = await db.getUserByEmail(primaryEmail);
    
    if (!primaryUser) {
      // Create user with a placeholder password
      const passwordHash = await bcrypt.hash('temp_password_' + Date.now(), 10);
      primaryUser = await db.createUser(primaryEmail, passwordHash, primaryName);
      console.log(`✅ Created primary user: ${primaryEmail}`);
    } else {
      // Update name if needed
      if (primaryName && (!primaryUser.name || primaryUser.name !== primaryName)) {
        await db.updateUserName(primaryUser.id, primaryName);
        console.log(`✅ Updated name for primary user: ${primaryEmail} -> ${primaryName}`);
      } else {
        console.log(`ℹ️  Primary user already exists: ${primaryEmail}`);
      }
    }
    
    // Get or create family members
    const familyUserIds = [];
    for (const member of familyMembers) {
      let user = await db.getUserByEmail(member.email);
      
      if (!user) {
        const passwordHash = await bcrypt.hash('temp_password_' + Date.now(), 10);
        user = await db.createUser(member.email, passwordHash, member.name);
        console.log(`✅ Created family member user: ${member.email}`);
      } else {
        // Update name if needed
        if (member.name && (!user.name || user.name !== member.name)) {
          await db.updateUserName(user.id, member.name);
          console.log(`✅ Updated name for family member: ${member.email} -> ${member.name}`);
        } else {
          console.log(`ℹ️  Family member user already exists: ${member.email}`);
        }
      }
      
      familyUserIds.push({ id: user.id, email: user.email, name: member.name });
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
      console.log(`✅ Created family group with primary user: ${primaryEmail}`);
    } else {
      console.log(`ℹ️  Family group already exists for primary user: ${primaryEmail}`);
    }
    
    const familyGroupId = familyGroup.id;
    
    // Create or update primary user's membership (standard, monthly)
    let primaryMembership;
    if (db.isPostgres) {
      primaryMembership = await db.queryOne(
        'SELECT * FROM gym_memberships WHERE user_id = $1',
        [primaryUser.id]
      );
    } else {
      primaryMembership = await db.queryOne(
        'SELECT * FROM gym_memberships WHERE user_id = ?',
        [primaryUser.id]
      );
    }
    
    if (primaryMembership) {
      // Update existing membership
      if (db.isPostgres) {
        await db.query(
          `UPDATE gym_memberships 
           SET membership_type = $1, 
               family_group_id = $2, 
               is_primary_member = $3,
               status = 'active',
               billing_period = 'monthly',
               updated_at = CURRENT_TIMESTAMP
           WHERE user_id = $4`,
          ['standard', familyGroupId, true, primaryUser.id]
        );
      } else {
        await db.query(
          `UPDATE gym_memberships 
           SET membership_type = ?, 
               family_group_id = ?, 
               is_primary_member = ?,
               status = 'active',
               billing_period = 'monthly',
               updated_at = datetime('now')
           WHERE user_id = ?`,
          ['standard', familyGroupId, 1, primaryUser.id]
        );
      }
      console.log(`✅ Updated gym membership for primary user: ${primaryEmail} (standard, monthly)`);
    } else {
      // Create new membership
      if (db.isPostgres) {
        await db.query(
          `INSERT INTO gym_memberships 
           (user_id, membership_type, family_group_id, is_primary_member, status, billing_period)
           VALUES ($1, $2, $3, $4, 'active', 'monthly')`,
          [primaryUser.id, 'standard', familyGroupId, true]
        );
      } else {
        await db.query(
          `INSERT INTO gym_memberships 
           (user_id, membership_type, family_group_id, is_primary_member, status, billing_period)
           VALUES (?, ?, ?, ?, 'active', 'monthly')`,
          [primaryUser.id, 'standard', familyGroupId, 1]
        );
      }
      console.log(`✅ Created gym membership for primary user: ${primaryEmail} (standard, monthly)`);
    }
    
    // Create or update family members' memberships
    for (const member of familyUserIds) {
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
            ['immediate_family_member', familyGroupId, false, member.id]
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
            ['immediate_family_member', familyGroupId, 0, member.id]
          );
        }
        console.log(`✅ Updated gym membership for family member: ${member.email} (immediate_family_member)`);
      } else {
        // Create new membership
        if (db.isPostgres) {
          await db.query(
            `INSERT INTO gym_memberships 
             (user_id, membership_type, family_group_id, is_primary_member, status)
             VALUES ($1, $2, $3, $4, 'active')`,
            [member.id, 'immediate_family_member', familyGroupId, false]
          );
        } else {
          await db.query(
            `INSERT INTO gym_memberships 
             (user_id, membership_type, family_group_id, is_primary_member, status)
             VALUES (?, ?, ?, ?, 'active')`,
            [member.id, 'immediate_family_member', familyGroupId, 0]
          );
        }
        console.log(`✅ Created gym membership for family member: ${member.email} (immediate_family_member)`);
      }
    }
    
    console.log('\n✅ Gym membership setup complete!');
    console.log('\nSummary:');
    console.log(`- Primary member: ${primaryEmail} (Standard Monthly - $65/month)`);
    familyUserIds.forEach(member => {
      console.log(`- Family member: ${member.email} (Immediate Family Member - $50/month)`);
    });
    console.log(`\nTotal monthly charge: $${65 + (50 * familyUserIds.length)}.00`);
    
  } catch (error) {
    console.error('❌ Error setting up gym membership:', error);
    throw error;
  } finally {
    if (db.db.end) {
      await db.db.end();
    }
  }
}

// Run if called directly
if (require.main === module) {
  addPowellFamilyMembership()
    .then(() => {
      console.log('\n✅ Script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('\n❌ Script failed:', error);
      process.exit(1);
    });
}

module.exports = { addPowellFamilyMembership };












