#!/usr/bin/env node

/**
 * Script to create a new tier_four subscription for JD Nielson
 * with a 30-day trial period (no charge today, first payment in 30 days)
 * 
 * Usage: node create-free-subscription.js
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

// Allow overriding Stripe key for production (use STRIPE_SECRET_KEY_PROD if available)
// For production, you can set it via: STRIPE_SECRET_KEY_PROD=sk_live_... node create-free-subscription.js
const stripeKey = process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY;

// For production database, set these environment variables:
// DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com
// DB_PORT=5432
// DB_NAME=postgres
// DB_USER=stoicapp
// DB_PASSWORD=your-password
// DB_SSL=true
if (!stripeKey) {
  console.error('❌ Error: STRIPE_SECRET_KEY or STRIPE_SECRET_KEY_PROD must be set');
  console.error('\nFor production, run:');
  console.error('  STRIPE_SECRET_KEY_PROD=sk_live_... node create-free-subscription.js');
  process.exit(1);
}
const stripe = require('stripe')(stripeKey);
const isLive = stripeKey.startsWith('sk_live');
console.log(`Using Stripe key: ${stripeKey.substring(0, 12)}... (${isLive ? 'LIVE/PRODUCTION' : 'TEST'})`);
if (!isLive && CUSTOMER_ID.startsWith('cus_')) {
  console.warn('⚠️  WARNING: Using TEST key but customer ID looks like production. Make sure you\'re using the correct Stripe key!');
}
const { initDatabase, Database } = require('./database');
const { normalizeTier } = require('./payments');

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const TIER = 'tier_four';

// Get price ID for tier_four
function getPriceIdForTier(tier) {
  const normalizedTier = normalizeTier(tier);
  const priceMap = {
    tier_two: process.env.STRIPE_PRICE_TIER_TWO || process.env.STRIPE_PRICE_DAILY || 'price_1SUwEpF0CLysN1jANPvhIp7s',
    tier_three: process.env.STRIPE_PRICE_TIER_THREE || process.env.STRIPE_PRICE_WEEKLY || 'price_1SUwG8F0CLysN1jA367NrtiT',
    tier_four: process.env.STRIPE_PRICE_TIER_FOUR || process.env.STRIPE_PRICE_MONTHLY || 'price_1SUwH8F0CLysN1jAvy1aMz3E'
  };
  return priceMap[normalizedTier];
}

async function main() {
  try {
    console.log('🔍 Looking up customer in Stripe...');
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log(`✅ Found customer: ${customer.email || customer.id}`);
    
    // Try to connect to database to find user ID (optional - we can create subscription without it)
    let targetUser = null;
    let db = null;
    
    try {
      console.log('\n🔍 Attempting to connect to database to find user...');
      console.log(`   Host: ${process.env.DB_HOST}`);
      console.log(`   User: ${process.env.DB_USER}`);
      console.log(`   Database: ${process.env.DB_NAME}`);
      
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
              // Password not found - will continue without DB connection
            }
          }
        } catch (error) {
          // AWS CLI not available - will continue without DB connection
        }
      }
      
      if (process.env.DB_PASSWORD) {
        const dbConnection = await initDatabase();
        db = new Database(dbConnection);
        console.log(`✅ Connected to ${db.isPostgres ? 'PostgreSQL' : 'SQLite'} database`);
        
        // Find user by Stripe customer ID
        console.log(`\n🔍 Finding user by Stripe customer ID: ${CUSTOMER_ID}...`);
        const sql = db.isPostgres
          ? 'SELECT * FROM users WHERE id IN (SELECT user_id FROM subscriptions WHERE stripe_customer_id = $1 LIMIT 1)'
          : 'SELECT * FROM users WHERE id IN (SELECT user_id FROM subscriptions WHERE stripe_customer_id = ? LIMIT 1)';
        const user = await db.queryOne(sql, [CUSTOMER_ID]);
        
        if (!user && customer.email) {
          console.log(`\n🔍 Trying to find user by email: ${customer.email}...`);
          const userByEmail = await db.getUserByEmail(customer.email);
          if (userByEmail) {
            console.log(`✅ Found user by email: ${userByEmail.email} (ID: ${userByEmail.id})`);
            targetUser = userByEmail;
          }
        } else if (user) {
          console.log(`✅ Found user: ${user.email} (ID: ${user.id})`);
          targetUser = user;
        }
      }
    } catch (dbError) {
      console.warn(`\n⚠️  Could not connect to database: ${dbError.message}`);
      console.warn(`   Will create subscription in Stripe without user ID in metadata.`);
      console.warn(`   The webhook will sync it to the database when it receives the event.`);
    }
    
    // Get price ID - use production price IDs when using production Stripe key
    let priceId;
    if (isLive) {
      // Use production price IDs directly for live mode
      const prodPriceMap = {
        tier_two: 'price_1SUwEpF0CLysN1jANPvhIp7s',
        tier_three: 'price_1SUwG8F0CLysN1jA367NrtiT',
        tier_four: 'price_1SUwH8F0CLysN1jAvy1aMz3E'
      };
      priceId = prodPriceMap[normalizeTier(TIER)];
      console.log(`\n✅ Using production price ID for ${TIER}`);
    } else {
      // Use environment variable price IDs for test mode
      priceId = getPriceIdForTier(TIER);
      if (!priceId || priceId.includes('test') || priceId.includes('replace')) {
        throw new Error(`Price ID not configured for ${TIER}. Please set STRIPE_PRICE_TIER_FOUR or STRIPE_PRICE_MONTHLY`);
      }
      console.log(`\n✅ Using test price ID for ${TIER}`);
    }
    if (!priceId) {
      throw new Error(`Price ID not found for ${TIER}`);
    }
    console.log(`   Price ID: ${priceId}`);
    
    // Calculate trial end date (30 days from now)
    const trialEnd = Math.floor(Date.now() / 1000) + (30 * 24 * 60 * 60);
    const trialEndDate = new Date(trialEnd * 1000);
    console.log(`\n📅 Trial period: Today until ${trialEndDate.toISOString()} (30 days)`);
    console.log(`   First payment will be charged on: ${trialEndDate.toLocaleDateString()}`);
    
    // Create subscription with 30-day trial
    // Use collection_method: 'send_invoice' to avoid requiring payment method upfront
    console.log(`\n🔄 Creating subscription with 30-day trial...`);
    const subscriptionData = {
      customer: CUSTOMER_ID,
      items: [{
        price: priceId,
      }],
      trial_period_days: 30,
      collection_method: 'send_invoice', // Send invoice instead of auto-charging (allows trial without payment method)
      days_until_due: 30, // Invoice due 30 days from now (after trial ends)
      metadata: {
        tier: TIER,
      },
      expand: ['latest_invoice'],
    };
    
    // Add userId to metadata if we have it
    if (targetUser && targetUser.id) {
      subscriptionData.metadata.userId = targetUser.id.toString();
    }
    
    const subscription = await stripe.subscriptions.create(subscriptionData);
    
    console.log(`✅ Subscription created: ${subscription.id}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Trial end: ${new Date(subscription.trial_end * 1000).toISOString()}`);
    console.log(`   Current period end: ${new Date(subscription.current_period_end * 1000).toISOString()}`);
    
    // Calculate end date for database (30 days from trial end, which is when first payment happens)
    const endDate = new Date(subscription.current_period_end * 1000);
    endDate.setDate(endDate.getDate() + 30); // Add 30 days after first payment
    
    // Create subscription in database if we have the user
    // The webhook will also create it, but we'll create it now to ensure it's there
    if (targetUser && targetUser.id) {
      console.log(`\n💾 Creating subscription record in database...`);
      try {
        await db.createSubscription(
          targetUser.id,
          TIER,
          CUSTOMER_ID,
          subscription.id,
          endDate.toISOString()
        );
        console.log(`✅ Subscription created in database`);
      } catch (dbError) {
        console.warn(`⚠️  Could not create subscription in database: ${dbError.message}`);
        console.warn(`   The webhook will create it when it receives the subscription.created event`);
      }
    } else {
      console.log(`\n⚠️  Could not create subscription in database - user not found`);
      console.log(`   The webhook will create it when it receives the subscription.created event`);
      console.log(`   Make sure the user exists in the production database with email: ${customer.email}`);
    }
    
    console.log(`\n✅ Success! Subscription created:`);
    if (targetUser) {
      console.log(`   - User: ${targetUser.email} (ID: ${targetUser.id})`);
    } else {
      console.log(`   - User: ${customer.email} (user ID not found in database)`);
    }
    console.log(`   - Tier: ${TIER}`);
    console.log(`   - Stripe Subscription ID: ${subscription.id}`);
    console.log(`   - Status: ${subscription.status}`);
    console.log(`   - Trial period: 30 days (no charge today)`);
    console.log(`   - Trial ends: ${new Date(subscription.trial_end * 1000).toLocaleDateString()}`);
    console.log(`   - First payment due: ${new Date(subscription.current_period_end * 1000).toLocaleDateString()}`);
    if (targetUser && db) {
      console.log(`   - Database end date: ${endDate.toISOString()}`);
    }
    
    console.log(`\n📝 Note: The webhook will sync this subscription to the database when it receives the 'customer.subscription.created' event.`);
    if (!targetUser) {
      console.log(`   ⚠️  Make sure the user exists in the production database with email: ${customer.email}`);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();

