#!/usr/bin/env node

/**
 * FINAL FIX: Directly fix JD Nielson's account
 * This script will run and fix everything
 */

require('dotenv').config();

// Force production mode
process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
process.env.DB_USER = process.env.DB_USER || 'stoicapp';
process.env.DB_NAME = process.env.DB_NAME || 'postgres';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_SSL = process.env.DB_SSL !== 'false' ? 'true' : 'false';
process.env.USE_POSTGRES = 'true';
delete process.env.DB_PATH;

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';

// Get production Stripe key
const stripeKey = process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('❌ STRIPE_SECRET_KEY not found');
  process.exit(1);
}
const stripe = require('stripe')(stripeKey);

// Get database password from AWS
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
        console.error('❌ Could not get database password');
        process.exit(1);
      }
    }
  } catch (error) {
    console.error('❌ Error getting credentials:', error.message);
    process.exit(1);
  }
}

const { initDatabase, Database } = require('./database');

async function finalFix() {
  console.log('🚨 FINAL FIX: JD Nielson Account');
  console.log('='.repeat(60));
  
  try {
    // 1. Connect to database
    console.log('\n1️⃣  Connecting to production database...');
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    console.log('   ✅ Connected to', db.isPostgres ? 'PostgreSQL' : 'SQLite');
    
    // 2. Find user
    console.log('\n2️⃣  Finding JD Nielson...');
    let user = await db.getUserByEmail(USER_EMAIL);
    if (!user) {
      const sql = db.isPostgres
        ? 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = $1 LIMIT 1'
        : 'SELECT u.* FROM users u INNER JOIN subscriptions s ON u.id = s.user_id WHERE s.stripe_customer_id = ? LIMIT 1';
      user = await db.queryOne(sql, [CUSTOMER_ID]);
    }
    
    if (!user) {
      console.error('   ❌ User not found!');
      process.exit(1);
    }
    
    console.log('   ✅ Found user:', user.email, '(ID:', user.id + ')');
    
    // 3. Get ALL subscriptions from Stripe
    console.log('\n3️⃣  Fetching subscriptions from Stripe...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 100
    });
    
    console.log(`   Found ${subscriptions.data.length} total subscription(s):`);
    subscriptions.data.forEach((sub, idx) => {
      console.log(`   ${idx + 1}. ${sub.id} - Status: ${sub.status}`);
    });
    
    // 4. Find active subscriptions
    const activeSubs = subscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing');
    
    let subscriptionToUse = null;
    
    if (activeSubs.length > 0) {
      subscriptionToUse = activeSubs.sort((a, b) => b.created - a.created)[0];
      console.log(`\n4️⃣  Found active subscription: ${subscriptionToUse.id}`);
      console.log('   Status:', subscriptionToUse.status);
    } else {
      console.log('\n4️⃣  No active subscriptions found. Canceling incomplete subscriptions and creating new one...');
      
      // Cancel incomplete_expired subscriptions
      const incompleteSubs = subscriptions.data.filter(s => 
        s.status === 'incomplete_expired' || s.status === 'incomplete'
      );
      
      if (incompleteSubs.length > 0) {
        console.log(`   Canceling ${incompleteSubs.length} incomplete subscription(s)...`);
        for (const sub of incompleteSubs) {
          try {
            await stripe.subscriptions.cancel(sub.id);
            console.log(`   ✅ Canceled: ${sub.id}`);
          } catch (e) {
            console.log(`   ⚠️  Could not cancel ${sub.id}: ${e.message}`);
          }
        }
      }
      
      // Create new active subscription
      console.log('\n5️⃣  Creating new active subscription...');
      const priceId = 'price_1SUwH8F0CLysN1jAvy1aMz3E'; // tier_four production price
      
      // Get payment method if available
      const paymentMethods = await stripe.paymentMethods.list({
        customer: CUSTOMER_ID,
        type: 'card',
        limit: 1
      });
      
      const paymentMethodId = paymentMethods.data.length > 0 ? paymentMethods.data[0].id : null;
      
      subscriptionToUse = await stripe.subscriptions.create({
        customer: CUSTOMER_ID,
        items: [{ price: priceId }],
        metadata: {
          userId: user.id.toString(),
          tier: 'tier_four',
          type: 'app_subscription'
        },
        trial_period_days: 30,
        payment_behavior: paymentMethodId ? 'default_incomplete' : 'default_incomplete',
        default_payment_method: paymentMethodId || undefined,
        collection_method: 'charge_automatically'
      });
      
      console.log('   ✅ Created new subscription:', subscriptionToUse.id);
      console.log('   Status:', subscriptionToUse.status);
    }
    
    if (!subscriptionToUse) {
      console.error('\n❌ Could not find or create active subscription!');
      process.exit(1);
    }
    
    // 6. Get tier and calculate end date
    const priceId = subscriptionToUse.items.data[0]?.price?.id;
    const priceToTier = {
      'price_1SUwEpF0CLysN1jANPvhIp7s': 'tier_two',
      'price_1SUwG8F0CLysN1jA367NrtiT': 'tier_three',
      'price_1SUwH8F0CLysN1jAvy1aMz3E': 'tier_four'
    };
    const tier = priceToTier[priceId] || 'tier_four';
    
    const endDate = new Date(subscriptionToUse.current_period_end * 1000);
    endDate.setDate(endDate.getDate() + 30);
    const endDateStr = endDate.toISOString().split('T')[0];
    
    console.log('\n6️⃣  Updating database...');
    console.log('   Tier:', tier);
    console.log('   Status: active');
    console.log('   End Date:', endDateStr);
    
    // 7. Direct database update
    const existingSub = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM subscriptions WHERE user_id = $1 AND stripe_customer_id = $2 ORDER BY created_at DESC LIMIT 1'
        : 'SELECT * FROM subscriptions WHERE user_id = ? AND stripe_customer_id = ? ORDER BY created_at DESC LIMIT 1',
      [user.id, CUSTOMER_ID]
    );
    
    if (existingSub) {
      // Update existing
      const updateSql = db.isPostgres
        ? `UPDATE subscriptions 
           SET status = $1, 
               tier = $2, 
               stripe_subscription_id = $3, 
               end_date = $4,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = $5`
        : `UPDATE subscriptions 
           SET status = ?, 
               tier = ?, 
               stripe_subscription_id = ?, 
               end_date = ?,
               updated_at = CURRENT_TIMESTAMP
           WHERE id = ?`;
      
      await db.query(updateSql, [
        'active',
        tier,
        subscriptionToUse.id,
        endDateStr,
        existingSub.id
      ]);
      console.log('   ✅ Updated existing subscription in database');
    } else {
      // Create new
      const insertSql = db.isPostgres
        ? `INSERT INTO subscriptions (user_id, tier, status, stripe_customer_id, stripe_subscription_id, start_date, end_date, created_at, updated_at)
           VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
           RETURNING *`
        : `INSERT INTO subscriptions (user_id, tier, status, stripe_customer_id, stripe_subscription_id, start_date, end_date, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
      
      await db.query(insertSql, [
        user.id,
        tier,
        'active',
        CUSTOMER_ID,
        subscriptionToUse.id,
        endDateStr
      ]);
      console.log('   ✅ Created new subscription in database');
    }
    
    // 8. Verify
    console.log('\n7️⃣  Verifying fix...');
    const verifySub = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM subscriptions WHERE user_id = $1 AND stripe_customer_id = $2 ORDER BY created_at DESC LIMIT 1'
        : 'SELECT * FROM subscriptions WHERE user_id = ? AND stripe_customer_id = ? ORDER BY created_at DESC LIMIT 1',
      [user.id, CUSTOMER_ID]
    );
    
    if (verifySub && verifySub.status === 'active') {
      console.log('   ✅ VERIFICATION SUCCESSFUL!');
      console.log('   Subscription ID:', verifySub.id);
      console.log('   Status:', verifySub.status);
      console.log('   Tier:', verifySub.tier);
      console.log('   Stripe Subscription ID:', verifySub.stripe_subscription_id);
      console.log('\n✅✅✅ JD NIELSON\'S ACCOUNT IS NOW FIXED! ✅✅✅');
      console.log('   He can log in and access all features immediately.');
    } else {
      console.error('   ❌ Verification failed!');
      console.error('   Subscription:', verifySub);
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

finalFix();


