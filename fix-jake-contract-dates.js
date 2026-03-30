// Fix Jake Fotu's contract dates
// Customer ID: cus_Tn4vCyVuETJUTe
// Issue: contract_end_date is set to 12 months instead of 30 days
// Fix: Set contract_start_date to Jan 14, 2026 and contract_end_date to Feb 13, 2026

require('dotenv').config();
process.env.USE_POSTGRES = 'true';

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY);
const { Database, initDatabase } = require('./database');

const CUSTOMER_ID = 'cus_Tn4vCyVuETJUTe';

async function fixJakeContractDates() {
  try {
    console.log('🔧 Fixing Jake Fotu\'s contract dates...\n');
    
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    // Step 1: Get customer from Stripe
    console.log('Step 1: Retrieving customer from Stripe...');
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log(`✅ Customer found: ${customer.email || 'No email'}\n`);
    
    // Step 2: Find user in database
    console.log('Step 2: Finding user in database...');
    const user = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM users WHERE stripe_customer_id = $1'
        : 'SELECT * FROM users WHERE stripe_customer_id = ?',
      [CUSTOMER_ID]
    );
    
    if (!user) {
      throw new Error('User not found in database with this Stripe customer ID');
    }
    console.log(`✅ User found: ID ${user.id}, Email: ${user.email}\n`);
    
    // Step 3: Get gym membership record
    console.log('Step 3: Finding gym membership record...');
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
        : 'SELECT * FROM gym_memberships WHERE user_id = ?',
      [user.id]
    );
    
    if (!membership) {
      throw new Error('Gym membership record not found');
    }
    
    console.log('Current membership dates:');
    console.log(`  Contract Start Date: ${membership.contract_start_date || 'NULL'}`);
    console.log(`  Contract End Date: ${membership.contract_end_date || 'NULL'}`);
    console.log(`  Contract Months: ${membership.contract_months || 'NULL'}\n`);
    
    // Step 4: Set correct dates
    // Payment was on Jan 14, 2026
    // Billing period is 30 days (monthly)
    const contractStartDate = '2026-01-14';
    const contractEndDate = '2026-02-13'; // 30 days later
    
    console.log('Step 4: Updating contract dates...');
    console.log(`  New Contract Start Date: ${contractStartDate}`);
    console.log(`  New Contract End Date: ${contractEndDate}\n`);
    
    // Update membership with correct dates
    await db.query(
      db.isPostgres
        ? 'UPDATE gym_memberships SET contract_start_date = $1, contract_end_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3'
        : 'UPDATE gym_memberships SET contract_start_date = ?, contract_end_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [contractStartDate, contractEndDate, membership.id]
    );
    
    console.log('✅ Contract dates updated successfully\n');
    
    // Step 5: Verify update
    console.log('Step 5: Verifying update...');
    const updatedMembership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1'
        : 'SELECT * FROM gym_memberships WHERE id = ?',
      [membership.id]
    );
    
    console.log('Updated membership dates:');
    console.log(`  Contract Start Date: ${updatedMembership.contract_start_date}`);
    console.log(`  Contract End Date: ${updatedMembership.contract_end_date}\n`);
    
    console.log('🎉 Jake Fotu\'s contract dates have been fixed!');
    console.log(`\n📋 Summary:`);
    console.log(`   Contract Start: ${contractStartDate} (payment date)`);
    console.log(`   Contract End: ${contractEndDate} (30 days later)`);
    console.log(`   Billing Period: 30 days (monthly)\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error fixing contract dates:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

fixJakeContractDates();

