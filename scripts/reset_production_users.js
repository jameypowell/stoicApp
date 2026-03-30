#!/usr/bin/env node
/**
 * Reset production users - Delete all users and create admin/test users
 * 
 * This script:
 * 1. Connects to production PostgreSQL database
 * 2. Deletes all existing users (cascades to subscriptions, payments)
 * 3. Creates new admin and test users with never-expiring subscriptions
 * 
 * Usage: node scripts/reset_production_users.js
 * 
 * Requires environment variables:
 * - DB_HOST (production RDS endpoint)
 * - DB_USER
 * - DB_PASSWORD
 * - DB_NAME (usually 'postgres')
 */

require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// Production users configuration
const PRODUCTION_USERS = [
  {
    email: 'jameypowell@gmail.com',
    role: 'admin',
    tier: 'monthly',
    expiresNever: true
  },
  {
    email: 'kylieshot@gmail.com',
    role: 'tester',
    tier: 'weekly',
    expiresNever: true
  },
  {
    email: 'brookley.pedersen@gmail.com',
    role: 'tester',
    tier: 'weekly',
    expiresNever: true
  },
  {
    email: 'branda.cooper@gmail.com',
    role: 'tester',
    tier: 'weekly',
    expiresNever: true
  },
  {
    email: 'davismirandafitness@gmail.com',
    role: 'tester',
    tier: 'monthly',
    expiresNever: true
  },
  {
    email: 'jpowell@stoic-fit.com',
    role: 'tester',
    tier: 'daily',
    expiresNever: true
  }
];

// Check for required environment variables
if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.error('❌ Error: Missing required environment variables');
  console.log('');
  console.log('Required:');
  console.log('  DB_HOST=<production-rds-endpoint>');
  console.log('  DB_USER=<database-user>');
  console.log('  DB_PASSWORD=<database-password>');
  console.log('  DB_NAME=<database-name> (default: postgres)');
  console.log('');
  console.log('Example:');
  console.log('  DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com');
  console.log('  DB_USER=stoicapp');
  console.log('  DB_PASSWORD=your-password');
  console.log('  DB_NAME=postgres');
  console.log('');
  process.exit(1);
}

const dbConfig = {
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME || 'postgres',
  ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
};

async function resetProductionUsers() {
  const client = new Client(dbConfig);

  try {
    console.log('════════════════════════════════════════════════');
    console.log('🔄 Resetting Production Users');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('Database:', dbConfig.host);
    console.log('');

    // Connect to database
    console.log('📡 Connecting to production database...');
    await client.connect();
    console.log('✅ Connected');
    console.log('');

    // Check if users table has role column, if not add it
    console.log('🔍 Checking database schema...');
    const tableCheck = await client.query(`
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'users' AND column_name = 'role'
    `);

    if (tableCheck.rows.length === 0) {
      console.log('   Adding "role" column to users table...');
      await client.query(`
        ALTER TABLE users 
        ADD COLUMN role TEXT DEFAULT 'user' 
        CHECK(role IN ('user', 'admin', 'tester'))
      `);
      console.log('   ✅ Role column added');
    } else {
      console.log('   ✅ Role column exists');
    }
    console.log('');

    // Delete all existing users (cascades to subscriptions and payments)
    console.log('🗑️  Deleting all existing users...');
    const deleteResult = await client.query('DELETE FROM users');
    console.log(`   ✅ Deleted ${deleteResult.rowCount} users`);
    console.log('');

    // Create new users
    console.log('👥 Creating production users...');
    console.log('');

    for (const userConfig of PRODUCTION_USERS) {
      try {
        // Generate a placeholder password hash (users will use Google OAuth)
        // OAuth users don't need passwords - this is just a placeholder that will never match
        const placeholderPassword = `OAUTH_USER_${Date.now()}_${Math.random().toString(36)}`;
        const passwordHash = await bcrypt.hash(placeholderPassword, 10);

        // Insert user
        const userResult = await client.query(
          `INSERT INTO users (email, password_hash, role) 
           VALUES ($1, $2, $3) 
           RETURNING id, email, role`,
          [userConfig.email.toLowerCase(), passwordHash, userConfig.role]
        );

        const userId = userResult.rows[0].id;
        console.log(`   ✅ Created ${userConfig.role}: ${userConfig.email} (ID: ${userId})`);

        // Create subscription that never expires (set to year 2099)
        const neverExpiresDate = new Date('2099-12-31T23:59:59.999Z');
        
        await client.query(
          `INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) 
           VALUES ($1, $2, 'active', CURRENT_TIMESTAMP, $3)`,
          [userId, userConfig.tier, neverExpiresDate]
        );

        console.log(`      Subscription: ${userConfig.tier} tier, expires: never`);
        console.log('');

      } catch (error) {
        console.error(`   ❌ Error creating user ${userConfig.email}:`, error.message);
        console.log('');
      }
    }

    // Summary
    console.log('════════════════════════════════════════════════');
    console.log('✅ Production Users Reset Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log('📊 Summary:');
    console.log(`   Total users created: ${PRODUCTION_USERS.length}`);
    console.log(`   Admin users: ${PRODUCTION_USERS.filter(u => u.role === 'admin').length}`);
    console.log(`   Tester users: ${PRODUCTION_USERS.filter(u => u.role === 'tester').length}`);
    console.log('');
    console.log('✅ Users can sign in immediately using Google OAuth!');
    console.log('   They do not need to reset their password.');
    console.log('   Just click "Sign in with Google" and use their Google account.');
    console.log('');

  } catch (error) {
    console.error('');
    console.error('❌ Error:', error.message);
    if (error.stack) {
      console.error('');
      console.error('Stack trace:');
      console.error(error.stack);
    }
    process.exit(1);
  } finally {
    await client.end();
    console.log('📡 Database connection closed');
  }
}

resetProductionUsers();

