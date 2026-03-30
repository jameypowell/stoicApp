require('dotenv').config();

const { Client } = require('pg');

// Get database credentials from environment
const DB_HOST = process.env.DB_HOST;
const DB_USER = process.env.DB_USER;
const DB_PASSWORD = process.env.DB_PASSWORD;
const DB_NAME = process.env.DB_NAME || 'postgres';
const DB_PORT = process.env.DB_PORT || 5432;

// Get email arguments
const oldEmail = process.argv[2];
const newEmail = process.argv[3];

if (!oldEmail || !newEmail) {
  console.error('❌ Usage: node scripts/update_user_email.js <old_email> <new_email>');
  console.error('   Example: node scripts/update_user_email.js old@example.com new@example.com');
  process.exit(1);
}

if (!DB_HOST || !DB_USER || !DB_PASSWORD) {
  console.error('❌ Missing database credentials. Please set:');
  console.error('   DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional), DB_PORT (optional)');
  process.exit(1);
}

async function updateUserEmail() {
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

    // Check if user exists
    console.log(`🔍 Checking if user exists: ${oldEmail}`);
    const checkResult = await client.query(
      'SELECT id, email, name, role, created_at FROM users WHERE email = $1',
      [oldEmail]
    );

    if (checkResult.rows.length === 0) {
      console.error(`❌ User with email ${oldEmail} not found in database`);
      await client.end();
      process.exit(1);
    }

    const user = checkResult.rows[0];
    console.log(`✅ Found user:`);
    console.log(`   ID: ${user.id}`);
    console.log(`   Email: ${user.email}`);
    console.log(`   Name: ${user.name || 'N/A'}`);
    console.log(`   Role: ${user.role}`);
    console.log(`   Created: ${user.created_at}\n`);

    // Check if new email already exists
    console.log(`🔍 Checking if new email already exists: ${newEmail}`);
    const emailCheckResult = await client.query(
      'SELECT id, email FROM users WHERE email = $1',
      [newEmail]
    );

    if (emailCheckResult.rows.length > 0) {
      console.error(`❌ Email ${newEmail} already exists in database (user ID: ${emailCheckResult.rows[0].id})`);
      await client.end();
      process.exit(1);
    }

    // Update the email
    console.log(`📝 Updating email from ${oldEmail} to ${newEmail}...`);
    const updateResult = await client.query(
      'UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE email = $2 RETURNING id, email, updated_at',
      [newEmail, oldEmail]
    );

    if (updateResult.rows.length === 0) {
      console.error('❌ Failed to update email');
      await client.end();
      process.exit(1);
    }

    const updatedUser = updateResult.rows[0];
    console.log('✅ Email updated successfully!');
    console.log(`   User ID: ${updatedUser.id}`);
    console.log(`   New Email: ${updatedUser.email}`);
    console.log(`   Updated At: ${updatedUser.updated_at}\n`);

    try {
      const adminAdded = await client.query(
        'UPDATE admin_added_members SET primary_email = $1 WHERE primary_email = $2 RETURNING id',
        [newEmail, oldEmail]
      );
      if (adminAdded.rowCount > 0) {
        console.log(`✅ Updated admin_added_members.primary_email on ${adminAdded.rowCount} row(s).\n`);
      }
    } catch (aamErr) {
      console.warn('⚠️  admin_added_members update skipped:', aamErr.message);
    }

    console.log('════════════════════════════════════════════════');
    console.log('✅ UPDATE COMPLETE!');
    console.log('════════════════════════════════════════════════');

    await client.end();
  } catch (error) {
    console.error('❌ Error updating user email:', error);
    await client.end();
    process.exit(1);
  }
}

updateUserEmail();




