#!/usr/bin/env node
/**
 * Reset password for a user in the local SQLite database
 * 
 * Usage: node scripts/reset_local_password_sqlite.js <email> <newPassword>
 * Example: node scripts/reset_local_password_sqlite.js jameypowell@gmail.com testtest
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

// Get database path (same logic as database.js)
const resolveDbPath = () => {
  require('dotenv').config();
  const envPath = process.env.DB_PATH;
  
  if (!envPath) {
    return path.join(__dirname, '..', 'data', 'stoic-shop.db');
  }
  
  return path.isAbsolute(envPath)
    ? envPath
    : path.join(__dirname, '..', envPath);
};

const DB_PATH = resolveDbPath();

async function resetPassword(email, newPassword) {
  return new Promise((resolve, reject) => {
    console.log(`Resetting password for ${email}...`);
    console.log(`Using database: ${DB_PATH}`);
    
    // Check if database file exists
    if (!fs.existsSync(DB_PATH)) {
      console.error(`❌ Database file not found: ${DB_PATH}`);
      process.exit(1);
    }
    
    const db = new sqlite3.Database(DB_PATH, (err) => {
      if (err) {
        console.error('❌ Error opening database:', err);
        reject(err);
        return;
      }
    });
    
    // Check if user exists
    db.get('SELECT id, email FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        console.error('❌ Error querying database:', err);
        db.close();
        reject(err);
        return;
      }
      
      if (!user) {
        console.error(`❌ User with email ${email} not found`);
        db.close();
        process.exit(1);
      }
      
      console.log(`Found user: ${user.email} (ID: ${user.id})`);
      
      // Hash the new password
      const passwordHash = await bcrypt.hash(newPassword, 10);
      
      // Update password
      db.run(
        `UPDATE users SET password_hash = ?, updated_at = datetime('now') WHERE id = ?`,
        [passwordHash, user.id],
        function(updateErr) {
          if (updateErr) {
            console.error('❌ Error updating password:', updateErr);
            db.close();
            reject(updateErr);
            return;
          }
          
          if (this.changes > 0) {
            console.log(`✅ Password reset successfully for ${email}`);
            console.log(`   New password: ${newPassword}`);
            db.close();
            resolve();
          } else {
            console.error(`❌ Failed to update password (no rows affected)`);
            db.close();
            process.exit(1);
          }
        }
      );
    });
  });
}

// Get command line arguments
const email = process.argv[2];
const newPassword = process.argv[3];

if (!email || !newPassword) {
  console.error('Usage: node scripts/reset_local_password_sqlite.js <email> <newPassword>');
  console.error('Example: node scripts/reset_local_password_sqlite.js jameypowell@gmail.com testtest');
  process.exit(1);
}

resetPassword(email, newPassword)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error resetting password:', error);
    process.exit(1);
  });






