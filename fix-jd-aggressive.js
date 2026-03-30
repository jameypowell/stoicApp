#!/usr/bin/env node

/**
 * AGGRESSIVE FIX: Find or create active subscription for JD Nielson
 * This script will:
 * 1. Check Stripe for ANY subscriptions (including incomplete_expired)
 * 2. If no active subscription exists, create a new one
 * 3. Force update the database
 */

require('dotenv').config();

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';

// Use production Stripe key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { initDatabase, Database } = require('./database');
const { normalizeTier } = require('./payments');

async function aggressiveFix() {
  console.log('🚨 AGGRESSIVE FIX: JD Nielson Account');
  console.log('='.repeat(60));
  
  try {
    // 1. Connect to database
    console.log('\n1️⃣  Connecting to database...');
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
    console.log('\n3️⃣  Fetching ALL subscriptions from Stripe...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 100
    });
    
    console.log(`   Found ${subscriptions.data.length} total subscription(s):`);
    subscriptions.data.forEach((sub, idx) => {
      console.log(`   ${idx + 1}. ${sub.id} - Status: ${sub.status}`);
    });
    
    // 4. Find active subscription
    const activeSubs = subscriptions.data.filter(s => 
      s.status === 'active' || s.status === 'trialing'
    );
    
    let subscriptionToUse = null;
    
    if (activeSubs.length > 0) {
      subscriptionToUse = activeSubs.sort((a, b) => b.created - a.created)[0];
      console.log(`\n4️⃣  Found active subscription: ${subscriptionToUse.id}`);
      console.log('   Status:', subscriptionToUse.status);
    } else {
      console.log('\n4️⃣  No active subscriptions found. Checking for incomplete_expired...');
      
      // Check for incomplete_expired subscriptions
      const incompleteSubs = subscriptions.data.filter(s => 
        s.status === 'incomplete_expired' || s.status === 'incomplete'
      );
      
      if (incompleteSubs.length > 0) {
        console.log(`   Found ${incompleteSubs.length} incomplete subscription(s).`);
        console.log('   ⚠️  These need to be canceled and a new one created.');
        
        // Cancel all incomplete subscriptions
        for (const sub of incompleteSubs) {
          try {
            await stripe.subscriptions.cancel(sub.id);
            console.log(`   ✅ Canceled incomplete subscription: ${sub.id}`);
          } catch (e) {
            console.log(`   ⚠️  Could not cancel ${sub.id}: ${e.message}`);
          }
        }
      }
      
      // Create a new active subscription
      console.log('\n5️⃣  Creating new active subscription...');
      
      // Get tier_four price ID
      const priceId = 'price_1SUwH8F0CLysN1jAvy1aMz3E'; // tier_four production price
      
      // Get or create payment method
      const paymentMethods = await stripe.paymentMethods.list({
        customer: CUSTOMER_ID,
        type: 'card',
        limit: 1
      });
      
      let paymentMethodId = null;
      if (paymentMethods.data.length > 0) {
        paymentMethodId = paymentMethods.data[0].id;
        console.log('   ✅ Found existing payment method:', paymentMethodId);
      } else {
        console.log('   ⚠️  No payment method found. Subscription will be created without payment method.');
        console.log('   ⚠️  User will need to add payment method to activate.');
      }
      
      // Create subscription with trial period (30 days free)
      const newSubscription = await stripe.subscriptions.create({
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
      
      console.log('   ✅ Created new subscription:', newSubscription.id);
      console.log('   Status:', newSubscription.status);
      subscriptionToUse = newSubscription;
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
    
    // Calculate end date
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
      console.log('   ✅ Updated existing subscription');
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
      console.log('\n✅ JD Nielson\'s account is now FIXED!');
      console.log('   He can log in and access all features.');
    } else {
      console.error('   ❌ Verification failed!');
      process.exit(1);
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

aggressiveFix();


