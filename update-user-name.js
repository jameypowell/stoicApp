#!/usr/bin/env node
require('dotenv').config();
const { initDatabase, Database } = require('./database');

async function updateUserName() {
  const email = process.argv[2];
  const name = process.argv[3];

  if (!email || !name) {
    console.error('Usage: node update-user-name.js <email> <name>');
    console.error('Example: node update-user-name.js jbnielson16@gmail.com "JD Nielson"');
    process.exit(1);
  }

  try {
    // Force PostgreSQL connection for production
    process.env.USE_POSTGRES = 'true';
    if (!process.env.DB_HOST) {
      console.error('❌ DB_HOST environment variable is required for PostgreSQL connection.');
      process.exit(1);
    }

    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    if (!db.isPostgres) {
      throw new Error('Script connected to SQLite instead of PostgreSQL. DB_HOST must be set.');
    }

    // Find user by email
    const user = await db.getUserByEmail(email);
    if (!user) {
      console.error(`❌ User not found: ${email}`);
      process.exit(1);
    }

    console.log(`Found user: ${user.email} (ID: ${user.id})`);
    console.log(`Current name: ${user.name || '(null)'}`);

    // Update name
    const updated = await db.updateUserName(user.id, name);
    if (updated) {
      console.log(`✅ Successfully updated name to: ${name}`);
      
      // Verify the update
      const updatedUser = await db.getUserById(user.id);
      console.log(`Verified name: ${updatedUser.name}`);
    } else {
      console.error('❌ Failed to update name');
      process.exit(1);
    }

    process.exit(0);
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
}

updateUserName();
