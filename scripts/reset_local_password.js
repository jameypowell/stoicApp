#!/usr/bin/env node
/**
 * Reset password for a user in the local database
 * 
 * Usage: node scripts/reset_local_password.js <email> <newPassword>
 * Example: node scripts/reset_local_password.js jameypowell@gmail.com testtest
 */

require('dotenv').config();
const { initDatabase, Database } = require('../database');
const bcrypt = require('bcryptjs');

async function resetPassword(email, newPassword) {
  try {
    console.log(`Resetting password for ${email}...`);
    
    // Force SQLite for local development by unsetting DB_HOST
    const originalDbHost = process.env.DB_HOST;
    delete process.env.DB_HOST;
    
    // Initialize database (will use SQLite if DB_HOST is not set)
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    // Restore DB_HOST if it was set
    if (originalDbHost) {
      process.env.DB_HOST = originalDbHost;
    }
    
    // Check if user exists
    const user = await db.getUserByEmail(email);
    if (!user) {
      console.error(`❌ User with email ${email} not found`);
      process.exit(1);
    }
    
    console.log(`Found user: ${user.email} (ID: ${user.id})`);
    
    // Hash the new password
    const passwordHash = await bcrypt.hash(newPassword, 10);
    
    // Update password
    const updated = await db.updateUserPassword(user.id, passwordHash);
    
    if (updated) {
      console.log(`✅ Password reset successfully for ${email}`);
      console.log(`   New password: ${newPassword}`);
    } else {
      console.error(`❌ Failed to update password`);
      process.exit(1);
    }
    
    // Close database connection
    if (dbConnection.close) {
      dbConnection.close();
    } else if (dbConnection.end) {
      await dbConnection.end();
    }
    
    process.exit(0);
  } catch (error) {
    console.error('❌ Error resetting password:', error);
    process.exit(1);
  }
}

// Get command line arguments
const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: node scripts/reset_local_password.js <email> <newPassword>');
  console.error('Example: node scripts/reset_local_password.js jameypowell@gmail.com testtest');
  process.exit(1);
}

resetPassword(email, newPassword);

