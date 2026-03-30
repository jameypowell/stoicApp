#!/usr/bin/env node

const { Client } = require('pg');

// Get database credentials from environment
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_PORT = process.env.DB_PORT || 5432;

// Users to update
const usersToUpdate = [
  {
    email: 'jpowell@stoic-fit.com',
    name: 'Demo',
    role: null // Don't change role
  },
  {
    email: 'admin@stoic-fit.com',
    name: 'Admin',
    role: 'admin'
  }
];

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('❌ Missing database credentials. Please set:');
  console.error('   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional), DB_PORT (optional)');
  process.exit(1);
}

async function updateUsers() {
  const client = new Client({
    host: DB_HOST,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    console.log('🔌 Connecting to production database...');
    await client.connect();
    console.log('✅ Connected to production database\n');

    for (const userUpdate of usersToUpdate) {
      console.log(`🔍 Finding user: ${userUpdate.email}`);
      
      // Check if user exists
      const existingUser = await client.query(
        'SELECT id, email, name, role FROM users WHERE email = $1',
        [userUpdate.email]
      );

      if (existingUser.rows.length === 0) {
        console.error(`❌ User with email ${userUpdate.email} not found`);
        continue;
      }

      const user = existingUser.rows[0];
      console.log(`   Current: name="${user.name || '(null)'}", role="${user.role || '(null)'}"`);

      // Build update query
      const updates = [];
      const values = [];
      let paramIndex = 1;

      if (userUpdate.name !== null && userUpdate.name !== undefined) {
        updates.push(`name = $${paramIndex}`);
        values.push(userUpdate.name);
        paramIndex++;
      }

      if (userUpdate.role !== null && userUpdate.role !== undefined) {
        updates.push(`role = $${paramIndex}`);
        values.push(userUpdate.role);
        paramIndex++;
      }

      if (updates.length === 0) {
        console.log(`   ⚠️  No changes to make for ${userUpdate.email}`);
        continue;
      }

      // Add updated_at
      updates.push(`updated_at = CURRENT_TIMESTAMP`);
      
      // Add user ID to values
      values.push(user.id);

      const updateQuery = `UPDATE users SET ${updates.join(', ')} WHERE id = $${paramIndex}`;
      
      console.log(`📝 Updating user...`);
      await client.query(updateQuery, values);

      // Verify the update
      const updatedUser = await client.query(
        'SELECT id, email, name, role FROM users WHERE id = $1',
        [user.id]
      );

      const updated = updatedUser.rows[0];
      console.log(`✅ User updated successfully!`);
      console.log(`   Email: ${updated.email}`);
      console.log(`   Name: ${updated.name || '(null)'}`);
      console.log(`   Role: ${updated.role || '(null)'}\n`);
    }

    console.log('════════════════════════════════════════════════');
    console.log('✅ ALL USERS UPDATED!');
    console.log('════════════════════════════════════════════════');

    await client.end();
  } catch (error) {
    console.error('❌ Error updating users:', error);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    await client.end();
    process.exit(1);
  }
}

updateUsers();














