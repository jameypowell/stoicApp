// Script to update tier_one subscriptions to expire 10 days from their start date in production
// This script connects to PostgreSQL production database
const { Client } = require('pg');
require('dotenv').config();

// Production database connection (from environment variables)
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME,
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL === 'true' ? { rejectUnauthorized: false } : false
});

async function updateTierOneExpiry() {
  try {
    console.log('Connecting to PostgreSQL database...');
    await client.connect();
    console.log('✅ Connected to database\n');

    // First, let's see what we're working with
    const queryResult = await client.query(`
      SELECT 
        id,
        user_id,
        tier,
        start_date,
        end_date,
        created_at,
        status
      FROM subscriptions
      WHERE tier = 'tier_one'
      ORDER BY created_at DESC
    `);

    const rows = queryResult.rows;
    console.log(`Found ${rows.length} tier_one subscription(s):\n`);

    if (rows.length === 0) {
      console.log('No tier_one subscriptions found. Nothing to update.');
      await client.end();
      return;
    }

    // Display current state
    rows.forEach((row, index) => {
      console.log(`${index + 1}. Subscription ID: ${row.id}, User ID: ${row.user_id}`);
      console.log(`   Start Date: ${row.start_date}`);
      console.log(`   Current End Date: ${row.end_date}`);
      console.log(`   Created At: ${row.created_at}`);
      console.log(`   Status: ${row.status}\n`);
    });

    // Update each subscription
    let updated = 0;
    let errors = 0;

    for (const row of rows) {
      try {
        // Use start_date if available, otherwise use created_at
        const baseDate = row.start_date || row.created_at;

        // Calculate new end date (10 days from base date)
        const baseDateObj = new Date(baseDate);
        const newEndDate = new Date(baseDateObj);
        newEndDate.setDate(newEndDate.getDate() + 10);

        const newEndDateISO = newEndDate.toISOString();

        await client.query(`
          UPDATE subscriptions
          SET end_date = $1
          WHERE id = $2
        `, [newEndDateISO, row.id]);

        console.log(`✅ Updated subscription ${row.id}: New end date = ${newEndDateISO}`);
        updated++;
      } catch (error) {
        console.error(`❌ Error updating subscription ${row.id}:`, error.message);
        errors++;
      }
    }

    console.log(`\n✅ Update complete!`);
    console.log(`   Updated: ${updated}`);
    console.log(`   Errors: ${errors}`);

    await client.end();
    console.log('\n✅ Database connection closed');
  } catch (error) {
    console.error('❌ Error:', error);
    if (client) {
      await client.end();
    }
    process.exit(1);
  }
}

// Run the update
updateTierOneExpiry()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((err) => {
    console.error('\n❌ Script failed:', err);
    process.exit(1);
  });























