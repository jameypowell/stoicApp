#!/usr/bin/env node

/**
 * Production Script to Fix JD Nielson's Account
 * Run this on the production server via AWS ECS exec or SSH
 * 
 * Usage:
 *   node fix-jd-production.js
 * 
 * Or via AWS ECS exec:
 *   aws ecs execute-command --cluster <cluster> --task <task-id> --container <container> --interactive --command "node /app/fix-jd-production.js"
 */

require('dotenv').config();

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';

// Use production Stripe key (should be set in production environment)
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { initDatabase, Database } = require('./database');
const { syncSubscriptionFromStripe } = require('./subscription-sync');

async function fixJDProduction() {
  console.log('🚨 PRODUCTION FIX: JD Nielson Account');
  console.log('='.repeat(60));
  console.log('Customer ID:', CUSTOMER_ID);
  console.log('User Email:', USER_EMAIL);
  console.log('Environment:', process.env.NODE_ENV || 'production');
  console.log('');
  
  try {
    // 1. Connect to database
    console.log('1️⃣  Connecting to database...');
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    console.log('   ✅ Connected to', db.isPostgres ? 'PostgreSQL' : 'SQLite');
    
    // 2. Find user
    console.log('\n2️⃣  Finding JD Nielson in database...');
    let user = await db.getUserByEmail(USER_EMAIL);
    if (!user) {
      const sql = db.isPostgres
        ? 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = $1 LIMIT 1'
        : 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = ? LIMIT 1';
      user = await db.queryOne(sql, [CUSTOMER_ID]);
    }
    
    if (!user) {
      console.error('   ❌ User not found!');
      console.error('   Email:', USER_EMAIL);
      console.error('   Customer ID:', CUSTOMER_ID);
      process.exit(1);
    }
    
    console.log('   ✅ Found user:', user.email, '(ID:', user.id + ')');
    
    // 3. Get current subscription from database
    console.log('\n3️⃣  Current subscription in database:');
    const currentSub = await db.getUserLatestSubscription(user.id);
    if (currentSub) {
      console.log('   ID:', currentSub.id);
      console.log('   Tier:', currentSub.tier);
      console.log('   Status:', currentSub.status);
      console.log('   Stripe Subscription ID:', currentSub.stripe_subscription_id || 'N/A');
      console.log('   Stripe Customer ID:', currentSub.stripe_customer_id || 'N/A');
    } else {
      console.log('   ⚠️  No subscription found in database');
    }
    
    // 4. Get subscriptions from Stripe
    console.log('\n4️⃣  Fetching subscriptions from Stripe...');
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log('   ✅ Customer:', customer.email || customer.id);
    
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 10
    });
    
    console.log(`   Found ${subscriptions.data.length} subscription(s) in Stripe:`);
    subscriptions.data.forEach((sub, idx) => {
      console.log(`   ${idx + 1}. ${sub.id} - Status: ${sub.status} - Created: ${new Date(sub.created * 1000).toLocaleDateString()}`);
    });
    
    // 5. Find active subscription
    const activeSubs = subscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing');
    if (activeSubs.length === 0) {
      console.error('\n❌ No active subscriptions found in Stripe!');
      console.error('   JD needs an active subscription in Stripe first.');
      process.exit(1);
    }
    
    const latestActive = activeSubs.sort((a, b) => b.created - a.created)[0];
    console.log(`\n5️⃣  Using active subscription: ${latestActive.id}`);
    console.log('   Status:', latestActive.status);
    console.log('   Current period end:', new Date(latestActive.current_period_end * 1000).toLocaleDateString());
    
    // 6. Sync subscription
    console.log('\n6️⃣  Syncing subscription from Stripe to database...');
    const result = await syncSubscriptionFromStripe(latestActive, db);
    
    if (result.error) {
      console.error('   ❌ Sync failed:', result.message || result.error);
      process.exit(1);
    }
    
    if (result.updated) {
      console.log('   ✅ Subscription updated in database');
    } else if (result.created) {
      console.log('   ✅ Subscription created in database');
    } else if (result.reactivated) {
      console.log('   ✅ Subscription reactivated in database');
    } else if (result.skipped) {
      console.log('   ⚠️  Subscription skipped:', result.reason);
    }
    
    // 7. Verify the fix
    console.log('\n7️⃣  Verifying fix...');
    const updatedSub = await db.getUserLatestSubscription(user.id);
    if (updatedSub) {
      console.log('   ✅ Updated subscription:');
      console.log('      ID:', updatedSub.id);
      console.log('      Tier:', updatedSub.tier);
      console.log('      Status:', updatedSub.status);
      console.log('      Stripe Subscription ID:', updatedSub.stripe_subscription_id);
      console.log('      End Date:', updatedSub.end_date);
      
      if (updatedSub.status === 'active') {
        console.log('\n✅ SUCCESS! JD Nielson\'s account has been fixed!');
        console.log('   Status: ACTIVE');
        console.log('   Tier:', updatedSub.tier);
        console.log('   He should now have access to all features.');
        console.log('\n✅ Fix complete! JD can now log in and access his account.');
      } else {
        console.log('\n⚠️  Subscription status:', updatedSub.status);
        console.log('   This may need further investigation.');
      }
    } else {
      console.error('   ❌ Could not verify subscription after sync');
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Run the fix
fixJDProduction();


