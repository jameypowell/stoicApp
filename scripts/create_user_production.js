#!/usr/bin/env node

const { Client } = require('pg');

// Get database credentials from environment
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_PORT = process.env.DB_PORT || 5432;

// Get arguments
const email = process.argv[2];
const tier = process.argv[3]; // 'tier_one', 'tier_two', 'tier_three', or 'tier_four'
const startDateStr = process.argv[4]; // YYYY-MM-DD format
const months = parseInt(process.argv[5]) || 1; // Number of months for subscription

if (!email || !tier || !startDateStr) {
  console.error('❌ Usage: node scripts/create_user_production.js <email> <tier> <start_date> [months]');
  console.error('   Example: node scripts/create_user_production.js user@example.com tier_three 2024-11-16 1');
  console.error('   Tier options: tier_one, tier_two, tier_three, tier_four');
  process.exit(1);
}

if (!['tier_one', 'tier_two', 'tier_three', 'tier_four'].includes(tier)) {
  console.error('❌ Invalid tier. Must be: tier_one, tier_two, tier_three, or tier_four');
  process.exit(1);
}

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('❌ Missing database credentials. Please set:');
  console.error('   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional), DB_PORT (optional)');
  process.exit(1);
}

// Calculate end date from today and months
function calculateEndDateFromToday(months) {
  const date = new Date();
  date.setMonth(date.getMonth() + months);
  return date.toISOString().split('T')[0];
}

async function createUserInProduction() {
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
      'SELECT id, email FROM users WHERE email = $1',
      [email]
    );

    if (existingUser.rows.length > 0) {
      console.error(`❌ User with email ${email} already exists (ID: ${existingUser.rows[0].id})`);
      await client.end();
      process.exit(1);
    }

    // Create OAuth placeholder password (OAuth users can't use password login)
    const placeholderPassword = 'OAUTH_USER_' + Date.now() + Math.random().toString(36);
    console.log(`🔐 Creating OAuth user (no password required)...`);

    // Parse start date
    const startDate = new Date(startDateStr);
    if (isNaN(startDate.getTime())) {
      console.error(`❌ Invalid start date format: ${startDateStr}. Use YYYY-MM-DD format.`);
      await client.end();
      process.exit(1);
    }

    // Calculate end date from today (1 month from today)
    const endDate = calculateEndDateFromToday(months);
    const startDateISO = startDate.toISOString();
    const endDateISO = new Date(endDate + 'T23:59:59.999Z').toISOString();

    console.log(`📝 Creating user: ${email}`);
    console.log(`   Tier: ${tier}`);
    console.log(`   Start Date: ${startDateStr}`);
    console.log(`   End Date: ${endDate} (${months} month${months !== 1 ? 's' : ''} from today)\n`);

    // Create user
    const userResult = await client.query(
      'INSERT INTO users (email, password_hash, created_at, updated_at) VALUES ($1, $2, $3, $4) RETURNING id, email, created_at',
      [email, placeholderPassword, startDateISO, startDateISO]
    );

    const userId = userResult.rows[0].id;
    console.log(`✅ User created successfully!`);
    console.log(`   User ID: ${userId}`);
    console.log(`   Email: ${email}`);
    console.log(`   Created At: ${userResult.rows[0].created_at}\n`);

    // Create subscription
    console.log(`📝 Creating subscription...`);
    const subscriptionResult = await client.query(
      `INSERT INTO subscriptions 
       (user_id, tier, status, start_date, end_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, tier, status, start_date, end_date`,
      [userId, tier, 'active', startDateISO, endDateISO, startDateISO]
    );

    const subscription = subscriptionResult.rows[0];
    console.log(`✅ Subscription created successfully!`);
    console.log(`   Subscription ID: ${subscription.id}`);
    console.log(`   Tier: ${subscription.tier}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Start Date: ${subscription.start_date}`);
    console.log(`   End Date: ${subscription.end_date}\n`);

    console.log('════════════════════════════════════════════════');
    console.log('✅ USER CREATION COMPLETE!');
    console.log('════════════════════════════════════════════════');
    console.log(`📧 Email: ${email}`);
    console.log(`🔐 Authentication: OAuth (Google) - No password required`);
    console.log(`📅 Subscription: ${tier} plan`);
    console.log(`   Start: ${startDateStr}`);
    console.log(`   End: ${endDate}`);
    console.log('════════════════════════════════════════════════');

    await client.end();
  } catch (error) {
    console.error('❌ Error creating user:', error);
    await client.end();
    process.exit(1);
  }
}

createUserInProduction();



