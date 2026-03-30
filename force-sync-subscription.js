#!/usr/bin/env node

/**
 * Script to force sync a subscription from Stripe to the database
 * Usage: node force-sync-subscription.js <customer_id>
 */

require('dotenv').config();

// Set production database defaults BEFORE requiring database module
// This ensures USE_POSTGRES is set correctly
process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
process.env.DB_USER = process.env.DB_USER || 'stoicapp';
process.env.DB_NAME = process.env.DB_NAME || 'postgres';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_SSL = process.env.DB_SSL !== 'false' ? 'true' : 'false';

// Unset DB_PATH to force PostgreSQL when DB_HOST is set
if (process.env.DB_HOST) {
  delete process.env.DB_PATH;
}

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY);
const { initDatabase, Database } = require('./database');
const { normalizeTier } = require('./payments');

const CUSTOMER_ID = process.argv[2] || 'cus_TTQrfuTZCoc0Yy';

async function main() {
  try {
    console.log('🔄 Force syncing subscription for customer:', CUSTOMER_ID);
    
    // Get customer from Stripe
    console.log('\n1. Fetching customer from Stripe...');
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log(`   ✅ Customer: ${customer.email || customer.id}`);
    
    // Get active subscriptions from Stripe
    console.log('\n2. Fetching subscriptions from Stripe...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      limit: 10,
      status: 'all'
    });
    
    const activeSubs = subscriptions.data.filter(s => s.status !== 'canceled');
    if (activeSubs.length === 0) {
      console.log('   ⚠️  No active subscriptions found in Stripe');
      return;
    }
    
    console.log(`   ✅ Found ${activeSubs.length} active subscription(s)`);
    const stripeSub = activeSubs[0]; // Use the first active subscription
    console.log(`   Subscription ID: ${stripeSub.id}`);
    console.log(`   Status: ${stripeSub.status}`);
    console.log(`   Current period end: ${new Date(stripeSub.current_period_end * 1000).toISOString()}`);
    
    // Get tier from subscription metadata or price
    let tier = stripeSub.metadata?.tier;
    if (!tier && stripeSub.items.data.length > 0) {
      const priceId = stripeSub.items.data[0].price.id;
      // Map price IDs to tiers (production)
      const priceToTier = {
        'price_1SUwEpF0CLysN1jANPvhIp7s': 'tier_two',
        'price_1SUwG8F0CLysN1jA367NrtiT': 'tier_three',
        'price_1SUwH8F0CLysN1jAvy1aMz3E': 'tier_four'
      };
      tier = priceToTier[priceId] || 'tier_four'; // Default to tier_four
    }
    tier = normalizeTier(tier) || 'tier_four';
    console.log(`   Tier: ${tier}`);
    
    // Connect to database
    console.log('\n3. Connecting to database...');
    
    // Try to get password from AWS if not set
    if (!process.env.DB_PASSWORD) {
      const { execSync } = require('child_process');
      console.log('   Attempting to retrieve database password from AWS...');
      try {
        try {
          const authToken = execSync(
            `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT} --region us-east-1 --username ${process.env.DB_USER} 2>/dev/null`,
            { encoding: 'utf-8' }
          );
          if (authToken && authToken.trim() && !authToken.includes('error')) {
            process.env.DB_PASSWORD = authToken.trim();
            console.log('   ✅ Retrieved password from RDS auth token');
          }
        } catch (e) {
          try {
            const secretName = process.env.DB_SECRET_NAME || 'stoic-fitness-db-password';
            const secret = execSync(`aws secretsmanager get-secret-value --secret-id ${secretName} --region us-east-1 --query SecretString --output text 2>/dev/null`, { encoding: 'utf-8' });
            if (secret && secret.trim() && !secret.includes('error')) {
              try {
                const parsed = JSON.parse(secret);
                process.env.DB_PASSWORD = parsed.password || parsed.DB_PASSWORD || secret.trim();
              } catch {
                process.env.DB_PASSWORD = secret.trim();
              }
              console.log('   ✅ Retrieved password from Secrets Manager');
            }
          } catch (e2) {
            console.warn('   ⚠️  Could not retrieve password from AWS');
          }
        }
      } catch (error) {
        console.warn('   ⚠️  AWS CLI not available');
      }
    }
    
    if (!process.env.DB_PASSWORD) {
      throw new Error('DB_PASSWORD not set and could not retrieve from AWS. Please set DB_PASSWORD environment variable.');
    }
    
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    console.log(`   ✅ Connected to ${db.isPostgres ? 'PostgreSQL' : 'SQLite'}`);
    if (!db.isPostgres) {
      throw new Error('Connected to SQLite instead of PostgreSQL. Please ensure DB_HOST is set correctly.');
    }
    
    // Find user by customer ID or email
    console.log('\n4. Finding user in database...');
    let user = null;
    
    // Try to find by customer ID in subscriptions
    const sqlByCustomer = db.isPostgres
      ? 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = $1 LIMIT 1'
      : 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = ? LIMIT 1';
    user = await db.queryOne(sqlByCustomer, [CUSTOMER_ID]);
    
    if (!user && customer.email) {
      // Try by email
      user = await db.getUserByEmail(customer.email);
    }
    
    if (!user) {
      throw new Error(`User not found for customer ${CUSTOMER_ID} (email: ${customer.email}). Please create the user first.`);
    }
    
    console.log(`   ✅ Found user: ${user.email} (ID: ${user.id})`);
    
    // Check if subscription exists in database
    console.log('\n5. Checking database for existing subscription...');
    const existingSub = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1'
        : 'SELECT * FROM subscriptions WHERE stripe_subscription_id = ?',
      [stripeSub.id]
    );
    
    // Calculate end date
    const endDate = new Date(stripeSub.current_period_end * 1000);
    endDate.setDate(endDate.getDate() + 30); // Add 30 days for next billing cycle
    
    // Map Stripe status to database status
    let dbStatus = 'active';
    if (stripeSub.status === 'canceled') {
      dbStatus = 'canceled';
    } else if (stripeSub.status === 'active' || stripeSub.status === 'trialing') {
      dbStatus = 'active';
    } else if (stripeSub.status === 'past_due' || stripeSub.status === 'unpaid' || stripeSub.status === 'incomplete' || stripeSub.status === 'incomplete_expired') {
      dbStatus = 'active'; // Keep as active in DB, but access will be denied via Stripe status check
    }
    
    if (existingSub) {
      // Update existing subscription
      console.log(`   ✅ Subscription exists in database (ID: ${existingSub.id})`);
      console.log('\n6. Updating subscription in database...');
      
      await db.updateSubscription(existingSub.id, {
        tier: tier,
        status: dbStatus,
        stripe_customer_id: CUSTOMER_ID,
        stripe_subscription_id: stripeSub.id,
        end_date: endDate.toISOString()
      });
      
      console.log(`   ✅ Updated subscription:`);
      console.log(`      - Status: ${dbStatus} (Stripe: ${stripeSub.status})`);
      console.log(`      - Tier: ${tier}`);
      console.log(`      - End date: ${endDate.toISOString()}`);
    } else {
      // Create new subscription
      console.log('   ⚠️  Subscription not found in database');
      console.log('\n6. Creating subscription in database...');
      
      // Cancel any existing active subscriptions first
      const existingActive = await db.getUserActiveSubscriptions(user.id);
      if (existingActive && existingActive.length > 0) {
        console.log(`   Canceling ${existingActive.length} existing subscription(s)...`);
        for (const sub of existingActive) {
          await db.updateSubscriptionStatus(sub.id, 'canceled');
        }
      }
      
      await db.createSubscription(
        user.id,
        tier,
        CUSTOMER_ID,
        stripeSub.id,
        endDate.toISOString()
      );
      
      console.log(`   ✅ Created subscription:`);
      console.log(`      - Status: ${dbStatus} (Stripe: ${stripeSub.status})`);
      console.log(`      - Tier: ${tier}`);
      console.log(`      - End date: ${endDate.toISOString()}`);
    }
    
    console.log('\n✅ Sync complete!');
    console.log(`   User: ${user.email}`);
    console.log(`   Subscription: ${stripeSub.id}`);
    console.log(`   Status: ${dbStatus} (Stripe: ${stripeSub.status})`);
    console.log(`   Tier: ${tier}`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

