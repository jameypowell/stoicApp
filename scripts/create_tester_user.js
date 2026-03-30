#!/usr/bin/env node

const { Client } = require('pg');
const bcrypt = require('bcryptjs');

// Get database credentials from environment
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_PORT = process.env.DB_PORT || 5432;

// User details
const email = 'prestonjames100@gmail.com';
const role = 'tester';
const tier = 'tier_four';
const neverExpiresDate = new Date('2099-12-31T23:59:59.999Z');

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('❌ Missing database credentials. Please set:');
  console.error('   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional), DB_PORT (optional)');
  process.exit(1);
}

async function createTesterUser() {
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

    // Check if user already exists
    console.log(`🔍 Checking if user exists: ${email}`);
    const existingUser = await client.query(
      'SELECT id, email, role FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      console.error(`❌ User with email ${email} already exists (ID: ${existingUser.rows[0].id}, Role: ${existingUser.rows[0].role})`);
      await client.end();
      process.exit(1);
    }

    // Create OAuth placeholder password
    const placeholderPassword = 'OAUTH_USER_' + Date.now() + Math.random().toString(36);
    const passwordHash = await bcrypt.hash(placeholderPassword, 10);
    console.log(`🔐 Creating user with tester role...`);

    const startDate = new Date();
    const startDateISO = startDate.toISOString();

    console.log(`📝 Creating user: ${email}`);
    console.log(`   Role: ${role}`);
    console.log(`   Tier: ${tier}`);
    console.log(`   Expiration: Never (2099-12-31)\n`);

    // Create user with tester role
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, role, created_at, updated_at) VALUES ($1, $2, $3, $4, $5) RETURNING id, email, role, created_at',
      [email, passwordHash, role, startDateISO, startDateISO]
    );

    const userId = userResult.rows[0].id;
    console.log(`✅ User created successfully!`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Email: ${email}`);
    console.log(`   Role: ${userResult.rows[0].role}`);
    console.log(`   Created At: ${userResult.rows[0].created_at}\n`);

    // Create subscription with never expires date
    console.log(`📝 Creating subscription...`);
    const subscriptionResult = await client.query(
      `INSERT INTO subscriptions 
       (user_id, tier, status, start_date, end_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tier, status, start_date, end_date`,
      [userId, tier, 'active', startDateISO, neverExpiresDate.toISOString(), startDateISO]
    );

    const subscription = subscriptionResult.rows[0];
    console.log(`✅ Subscription created successfully!`);
    console.log(`   Subscription ID: ${subscription.id}`);
    console.log(`   Tier: ${subscription.tier}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Start Date: ${subscription.start_date}`);
    console.log(`   End Date: ${subscription.end_date} (Never expires)\n`);

    console.log('════════════════════════════════════════════════');
    console.log('✅ USER CREATION COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log(`📧 Email: ${email}`);
    console.log(`👤 Role: ${role}`);
    console.log(`🔐 Authentication: OAuth (Google) - No password required`);
    console.log(`📅 Subscription: ${tier} plan`);
    console.log(`   Start: ${startDate.toISOString().split('T')[0]}`);
    console.log(`   End: Never (2099-12-31)`);
    console.log('════════════════════════════════════════════════');

    await client.end();
  } catch (error) {
    console.error('❌ Error creating user:', error);
    if (error.stack) {
      console.error('Stack:', error.stack);
    }
    await client.end();
    process.exit(1);
  }
}

createTesterUser();














