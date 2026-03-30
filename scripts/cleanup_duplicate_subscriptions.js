#!/usr/bin/env node
/**
 * Clean up duplicate subscriptions in production
 * 
 * This script:
 * 1. For each user, keeps only the subscription that matches PRODUCTION_USERS_SUMMARY.md
 * 2. Deletes all other subscriptions for that user
 * 3. Ensures each user has exactly one subscription with the correct tier and expiration
 * 
 * Usage: node scripts/cleanup_duplicate_subscriptions.js
 * 
 * Requires environment variables:
 * - DB_HOST (production RDS endpoint)
 * - DB_USER
 * - DB_PASSWORD
 * - DB_NAME (usually 'postgres')
 */

require('dotenv').config();
const { Client } = require('pg');

// Expected users from PRODUCTION_USERS_SUMMARY.md
const EXPECTED_USERS = [
  { email: 'jameypowell@gmail.com', role: 'admin', tier: 'monthly' },
  { email: 'kylieshot@gmail.com', role: 'tester', tier: 'weekly' },
  { email: 'brookley.pedersen@gmail.com', role: 'tester', tier: 'weekly' },
  { email: 'branda.cooper@gmail.com', role: 'tester', tier: 'weekly' },
  { email: 'davismirandafitness@gmail.com', role: 'tester', tier: 'monthly' },
  { email: 'jpowell@stoic-fit.com', role: 'tester', tier: 'daily' }
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

async function cleanupDuplicates() {
  const client = new Client(dbConfig);

  try {
    console.log('════════════════════════════════════════════════');
    console.log('🧹 Cleaning Up Duplicate Subscriptions');
    console.log('════════════════════════════════════════════════');
    console.log('');

    await client.connect();
    console.log('✅ Connected to production database');
    console.log('');

    let totalDeleted = 0;

    // Process each expected user
    for (const expectedUser of EXPECTED_USERS) {
      console.log(`Processing: ${expectedUser.email}`);
      
      // Get user
      const userResult = await client.query(
        'SELECT id, email, role FROM users WHERE email = $1',
        [expectedUser.email.toLowerCase()]
      );

      if (userResult.rows.length === 0) {
        console.log(`   ⚠️  User not found, skipping`);
        console.log('');
        continue;
      }

      const user = userResult.rows[0];
      console.log(`   User ID: ${user.id}, Role: ${user.role || 'user'}`);

      // Get all subscriptions for this user
      const subsResult = await client.query(
        'SELECT id, tier, status, end_date FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
        [user.id]
      );

      if (subsResult.rows.length === 0) {
        console.log(`   ⚠️  No subscriptions found`);
        console.log('');
        continue;
      }

      console.log(`   Found ${subsResult.rows.length} subscription(s)`);

      // Find the subscription that matches expected tier and has 2099-12-31 expiration
      const neverExpiresDate = new Date('2099-12-31T23:59:59.999Z');
      const correctSub = subsResult.rows.find(sub => 
        sub.tier === expectedUser.tier && 
        sub.end_date && 
        new Date(sub.end_date).getTime() === neverExpiresDate.getTime()
      );

      // If no correct subscription found, find the one with 2099 expiration (any tier)
      const neverExpiresSub = subsResult.rows.find(sub => 
        sub.end_date && 
        new Date(sub.end_date).getTime() === neverExpiresDate.getTime()
      );

      // Determine which subscription to keep
      const keepSub = correctSub || neverExpiresSub || subsResult.rows[0];
      
      if (keepSub) {
        console.log(`   ✅ Keeping subscription ID ${keepSub.id}: ${keepSub.tier} tier, expires ${keepSub.end_date ? new Date(keepSub.end_date).toISOString().split('T')[0] : 'never'}`);
        
        // Update it to match expected tier and expiration if needed
        if (keepSub.tier !== expectedUser.tier || !keepSub.end_date || new Date(keepSub.end_date).getTime() !== neverExpiresDate.getTime()) {
          await client.query(
            `UPDATE subscriptions 
             SET tier = $1, status = 'active', end_date = $2 
             WHERE id = $3`,
            [expectedUser.tier, neverExpiresDate, keepSub.id]
          );
          console.log(`   ✅ Updated to: ${expectedUser.tier} tier, expires never`);
        }

        // Delete all other subscriptions
        const otherSubs = subsResult.rows.filter(sub => sub.id !== keepSub.id);
        if (otherSubs.length > 0) {
          const otherSubIds = otherSubs.map(sub => sub.id);
          const deleteResult = await client.query(
            'DELETE FROM subscriptions WHERE id = ANY($1::int[])',
            [otherSubIds]
          );
          console.log(`   🗑️  Deleted ${deleteResult.rowCount} duplicate subscription(s)`);
          totalDeleted += deleteResult.rowCount;
        }
      }

      console.log('');
    }

    // Clean up subscriptions for users not in the expected list (optional - commented out for safety)
    // Uncomment if you want to remove subscriptions for unexpected users
    /*
    console.log('Cleaning up subscriptions for unexpected users...');
    const allUsersResult = await client.query('SELECT id, email FROM users');
    const expectedEmails = EXPECTED_USERS.map(u => u.email.toLowerCase());
    const unexpectedUsers = allUsersResult.rows.filter(u => !expectedEmails.includes(u.email.toLowerCase()));
    
    for (const user of unexpectedUsers) {
      const deleteResult = await client.query('DELETE FROM subscriptions WHERE user_id = $1', [user.id]);
      if (deleteResult.rowCount > 0) {
        console.log(`   Deleted ${deleteResult.rowCount} subscription(s) for ${user.email}`);
        totalDeleted += deleteResult.rowCount;
      }
    }
    */

    console.log('════════════════════════════════════════════════');
    console.log('✅ Cleanup Complete!');
    console.log('════════════════════════════════════════════════');
    console.log('');
    console.log(`📊 Summary:`);
    console.log(`   Total duplicate subscriptions deleted: ${totalDeleted}`);
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

cleanupDuplicates();






