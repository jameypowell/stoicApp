const { Client } = require('pg');

// Get database credentials from environment
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_PORT = process.env.DB_PORT || 5432;

// Get email argument
const email = process.argv[2];

if (!email) {
  console.error('❌ Usage: node scripts/check_user_data.js <email>');
  process.exit(1);
}

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('❌ Missing database credentials. Please set:');
  console.error('   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional), DB_PORT (optional)');
  process.exit(1);
}

async function checkUserData() {
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
    await client.connect();

    // Get user
    const userResult = await client.query(
      'SELECT * FROM users WHERE email = $1',
      [email]
    );

    if (userResult.rows.length === 0) {
      console.error(`❌ User with email ${email} not found`);
      await client.end();
      process.exit(1);
    }

    const user = userResult.rows[0];
    console.log(`\n👤 User: ${user.email} (ID: ${user.id})`);
    console.log(`   Name: ${user.name || 'N/A'}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Created: ${user.created_at}`);

    // Get subscriptions
    const subsResult = await client.query(
      'SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC',
      [user.id]
    );
    console.log(`\n📋 Subscriptions: ${subsResult.rows.length}`);
    subsResult.rows.forEach((sub, i) => {
      console.log(`   ${i + 1}. ${sub.tier} - ${sub.status} (${sub.start_date} to ${sub.end_date || 'N/A'})`);
    });

    // Get payments
    const paymentsResult = await client.query(
      'SELECT * FROM payments WHERE user_id = $1 ORDER BY created_at DESC',
      [user.id]
    );
    console.log(`\n💳 Payments: ${paymentsResult.rows.length}`);
    paymentsResult.rows.forEach((pay, i) => {
      console.log(`   ${i + 1}. $${(pay.amount / 100).toFixed(2)} ${pay.currency.toUpperCase()} - ${pay.tier} - ${pay.status}`);
    });

    // Get macro plans
    const macroResult = await client.query(
      'SELECT * FROM macro_plans WHERE user_id = $1',
      [user.id]
    );
    console.log(`\n📊 Macro Plans: ${macroResult.rows.length}`);
    if (macroResult.rows.length > 0) {
      console.log(`   Has macro plan data: Yes`);
    }

    await client.end();
  } catch (error) {
    console.error('❌ Error:', error);
    await client.end();
    process.exit(1);
  }
}

checkUserData();




