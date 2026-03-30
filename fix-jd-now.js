#!/usr/bin/env node

/**
 * EMERGENCY FIX: Update JD Nielson's subscription status directly
 * This script connects to production and fixes his account immediately
 */

require('dotenv').config();

// Force production database connection
process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
process.env.DB_USER = process.env.DB_USER || 'stoicapp';
process.env.DB_NAME = process.env.DB_NAME || 'postgres';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_SSL = process.env.DB_SSL !== 'false' ? 'true' : 'false';
process.env.USE_POSTGRES = 'true';
delete process.env.DB_PATH;

// Get password from AWS
const { execSync } = require('child_process');
if (!process.env.DB_PASSWORD) {
  try {
    // Try RDS auth token
    try {
      const authToken = execSync(
        `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT} --region us-east-1 --username ${process.env.DB_USER} 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      if (authToken && authToken.trim() && !authToken.includes('error')) {
        process.env.DB_PASSWORD = authToken.trim();
        console.log('✅ Got RDS auth token');
      }
    } catch (e) {
      // Try Secrets Manager
      try {
        const secret = execSync(
          `aws secretsmanager get-secret-value --secret-id stoic-fitness-db-password --region us-east-1 --query SecretString --output text 2>/dev/null`,
          { encoding: 'utf-8' }
        );
        if (secret && secret.trim()) {
          try {
            const parsed = JSON.parse(secret);
            process.env.DB_PASSWORD = parsed.password || parsed.DB_PASSWORD || secret.trim();
          } catch {
            process.env.DB_PASSWORD = secret.trim();
          }
          console.log('✅ Got password from Secrets Manager');
        }
      } catch (e2) {
        console.error('❌ Could not get database password. Please set DB_PASSWORD environment variable.');
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ Error getting credentials:', error.message);
    process.exit(1);
  }
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY);
const { initDatabase, Database } = require('./database');
const { syncSubscriptionFromStripe } = require('./subscription-sync');

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';

async function fixJD() {
  console.log('🚨 EMERGENCY FIX: JD Nielson Account');
  console.log('='.repeat(60));
  
  try {
    // 1. Connect to database
    console.log('\n1️⃣  Connecting to production database...');
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    console.log('   ✅ Connected to', db.isPostgres ? 'PostgreSQL' : 'SQLite');
    
    // 2. Find JD's user account
    console.log('\n2️⃣  Finding JD Nielson in database...');
    let user = await db.getUserByEmail(USER_EMAIL);
    if (!user) {
      // Try to find by customer ID
      const sql = db.isPostgres
        ? 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = $1 LIMIT 1'
        : 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = ? LIMIT 1';
      user = await db.queryOne(sql, [CUSTOMER_ID]);
    }
    
    if (!user) {
      console.error('   ❌ User not found in database!');
      console.error('   Email:', USER_EMAIL);
      console.error('   Customer ID:', CUSTOMER_ID);
      process.exit(1);
    }
    
    console.log('   ✅ Found user:', user.email, '(ID:', user.id + ')');
    
    // 3. Get current subscription from database
    console.log('\n3️⃣  Checking current subscription in database...');
    const currentSub = await db.getUserLatestSubscription(user.id);
    if (currentSub) {
      console.log('   Current subscription:', {
        id: currentSub.id,
        tier: currentSub.tier,
        status: currentSub.status,
        stripe_subscription_id: currentSub.stripe_subscription_id,
        stripe_customer_id: currentSub.stripe_customer_id
      });
    } else {
      console.log('   ⚠️  No subscription found in database');
    }
    
    // 4. Get subscriptions from Stripe
    console.log('\n4️⃣  Fetching subscriptions from Stripe...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 10
    });
    
    console.log(`   Found ${subscriptions.data.length} subscription(s) in Stripe:`);
    subscriptions.data.forEach((sub, idx) => {
      console.log(`   ${idx + 1}. ${sub.id} - Status: ${sub.status}`);
    });
    
    // 5. Find active subscription
    const activeSubs = subscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing');
    if (activeSubs.length === 0) {
      console.error('\n❌ No active subscriptions found in Stripe!');
      console.error('   JD needs an active subscription in Stripe first.');
      process.exit(1);
    }
    
    const latestActive = activeSubs.sort((a, b) => b.created - a.created)[0];
    console.log(`\n5️⃣  Using active subscription: ${latestActive.id} (Status: ${latestActive.status})`);
    
    // 6. Sync subscription from Stripe to database
    console.log('\n6️⃣  Syncing subscription to database...');
    const result = await syncSubscriptionFromStripe(latestActive, db);
    
    if (result.error) {
      console.error('   ❌ Sync failed:', result.message);
      process.exit(1);
    }
    
    if (result.updated) {
      console.log('   ✅ Subscription updated in database');
    } else if (result.created) {
      console.log('   ✅ Subscription created in database');
    } else if (result.reactivated) {
      console.log('   ✅ Subscription reactivated in database');
    }
    
    // 7. Verify the fix
    console.log('\n7️⃣  Verifying fix...');
    const updatedSub = await db.getUserLatestSubscription(user.id);
    console.log('   Updated subscription:', {
      id: updatedSub.id,
      tier: updatedSub.tier,
      status: updatedSub.status,
      stripe_subscription_id: updatedSub.stripe_subscription_id
    });
    
    if (updatedSub.status === 'active') {
      console.log('\n✅ SUCCESS! JD Nielson\'s account has been fixed!');
      console.log('   Status: ACTIVE');
      console.log('   Tier:', updatedSub.tier);
      console.log('   He should now have access to all features.');
    } else {
      console.log('\n⚠️  Subscription status:', updatedSub.status);
      console.log('   This may need further investigation.');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixJD();


