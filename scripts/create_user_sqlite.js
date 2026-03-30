#!/usr/bin/env node
/**
 * Create user in SQLite database with password
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const bcrypt = require('bcryptjs');
const fs = require('fs');

require('dotenv').config();

const resolveDbPath = () => {
  const envPath = process.env.DB_PATH;
  
  if (!envPath) {
    return path.join(__dirname, '..', 'data', 'stoic-shop.db');
  }
  
  return path.isAbsolute(envPath)
    ? envPath
    : path.join(__dirname, '..', envPath);
};

const DB_PATH = resolveDbPath();

async function createUser(email, password, role = 'user') {
  return new Promise((resolve, reject) => {
    console.log(`Creating user: ${email}`);
    console.log(`Using database: ${DB_PATH}`);
    
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
    
    // Check if user already exists
    db.get('SELECT id, email FROM users WHERE email = ?', [email], async (err, user) => {
      if (err) {
        console.error('❌ Error querying database:', err);
        db.close();
        reject(err);
        return;
      }
      
      if (user) {
        console.log(`User already exists: ${user.email} (ID: ${user.id})`);
        console.log('Updating password...');
        
        const passwordHash = await bcrypt.hash(password, 10);
        
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
            
            console.log(`✅ Password updated for ${email}`);
            db.close();
            resolve();
          }
        );
      } else {
        // Create new user
        const passwordHash = await bcrypt.hash(password, 10);
        
        // Check if role column exists
        db.all("PRAGMA table_info(users)", (err, columns) => {
          if (err) {
            console.error('❌ Error getting columns:', err);
            db.close();
            reject(err);
            return;
          }
          
          const hasRole = columns.some(col => col.name === 'role');
          const insertSQL = hasRole 
            ? `INSERT INTO users (email, password_hash, role) VALUES (?, ?, ?)`
            : `INSERT INTO users (email, password_hash) VALUES (?, ?)`;
          const insertParams = hasRole ? [email, passwordHash, role] : [email, passwordHash];
          
          db.run(insertSQL, insertParams, function(insertErr) {
            if (insertErr) {
              console.error('❌ Error creating user:', insertErr);
              db.close();
              reject(insertErr);
              return;
            }
            
            console.log(`✅ User created: ${email} (ID: ${this.lastID})`);
            db.close();
            resolve();
          });
        });
      }
    });
  });
}

const email = process.argv[2];
const password = process.argv[3];
const role = process.argv[4] || 'user';

if (!email || !password) {
  console.error('Usage: node scripts/create_user_sqlite.js <email> <password> [role]');
  console.error('Example: node scripts/create_user_sqlite.js jameypowell@gmail.com testtest admin');
  process.exit(1);
}

createUser(email, password, role)
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });

