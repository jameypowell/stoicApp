#!/usr/bin/env node
/**
 * Set up admin user with never-expiring subscription in localhost SQLite database
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
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

async function setupAdmin(email, tier = 'monthly') {
  return new Promise((resolve, reject) => {
    console.log(`Setting up admin: ${email}`);
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
    
    // Check if user exists
    db.get('SELECT id, email FROM users WHERE email = ?', [email], (err, user) => {
      if (err) {
        console.error('❌ Error querying user:', err);
        db.close();
        reject(err);
        return;
      }
      
      if (!user) {
        console.error(`❌ User not found: ${email}`);
        db.close();
        process.exit(1);
      }
      
      console.log(`Found user: ${user.email} (ID: ${user.id})`);
      
      // Check if role column exists and update it
      db.all("PRAGMA table_info(users)", (err, columns) => {
        if (err) {
          console.error('❌ Error getting columns:', err);
          db.close();
          reject(err);
          return;
        }
        
        const hasRole = columns.some(col => col.name === 'role');
        
        if (hasRole) {
          // Update role to admin
          db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id], (updateErr) => {
            if (updateErr) {
              console.error('❌ Error updating role:', updateErr);
              db.close();
              reject(updateErr);
              return;
            }
            console.log('✅ User role set to admin');
            createSubscription(db, user.id, tier, resolve, reject);
          });
        } else {
          // Add role column
          console.log('Adding role column to users table...');
          db.run('ALTER TABLE users ADD COLUMN role TEXT DEFAULT "user"', (alterErr) => {
            if (alterErr) {
              console.error('❌ Error adding role column:', alterErr);
              db.close();
              reject(alterErr);
              return;
            }
            // Update role to admin
            db.run('UPDATE users SET role = ? WHERE id = ?', ['admin', user.id], (updateErr) => {
              if (updateErr) {
                console.error('❌ Error updating role:', updateErr);
                db.close();
                reject(updateErr);
                return;
              }
              console.log('✅ User role set to admin');
              createSubscription(db, user.id, tier, resolve, reject);
            });
          });
        }
      });
    });
  });
}

function createSubscription(db, userId, tier, resolve, reject) {
  // Check for existing subscription
  db.get('SELECT id, status FROM subscriptions WHERE user_id = ?', [userId], (err, existing) => {
    if (err) {
      console.error('❌ Error checking subscription:', err);
      db.close();
      reject(err);
      return;
    }
    
    // Set end_date to a far future date (year 2099) to simulate "never expires"
    const neverExpiresDate = '2099-12-31 23:59:59';
    
    if (existing) {
      // Update existing subscription
      db.run(
        `UPDATE subscriptions SET tier = ?, status = 'active', end_date = ? WHERE user_id = ?`,
        [tier, neverExpiresDate, userId],
        function(updateErr) {
          if (updateErr) {
            console.error('❌ Error updating subscription:', updateErr);
            db.close();
            reject(updateErr);
            return;
          }
          console.log(`✅ Subscription updated: ${tier} tier, expires: never (${neverExpiresDate})`);
          db.close();
          resolve();
        }
      );
    } else {
      // Create new subscription
      db.run(
        `INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) VALUES (?, ?, 'active', datetime('now'), ?)`,
        [userId, tier, neverExpiresDate],
        function(insertErr) {
          if (insertErr) {
            console.error('❌ Error creating subscription:', insertErr);
            db.close();
            reject(insertErr);
            return;
          }
          console.log(`✅ Subscription created: ${tier} tier, expires: never (${neverExpiresDate})`);
          db.close();
          resolve();
        }
      );
    }
  });
}

const email = process.argv[2] || 'jameypowell@gmail.com';
const tier = process.argv[3] || 'monthly';

setupAdmin(email, tier)
  .then(() => {
    console.log('\n✅ Admin setup complete!');
    process.exit(0);
  })
  .catch((error) => {
    console.error('❌ Error:', error);
    process.exit(1);
  });






