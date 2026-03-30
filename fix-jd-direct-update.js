#!/usr/bin/env node

/**
 * DIRECT FIX: Force update JD Nielson's subscription status
 * This bypasses all sync logic and directly updates the database
 */

require('dotenv').config();

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';

// Use production Stripe key
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const { initDatabase, Database } = require('./database');

async function directFix() {
  console.log('🚨 DIRECT FIX: JD Nielson Account');
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
    
    // 3. Get subscription from Stripe
    console.log('\n3️⃣  Fetching subscription from Stripe...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 10
    });
    
    const activeSubs = subscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing');
    if (activeSubs.length === 0) {
      console.error('   ❌ No active subscriptions in Stripe!');
      process.exit(1);
    }
    
    const latestActive = activeSubs.sort((a, b) => b.created - a.created)[0];
    console.log('   ✅ Active subscription:', latestActive.id);
    console.log('   Status:', latestActive.status);
    
    // Get tier from price
    const priceId = latestActive.items.data[0]?.price?.id;
    const priceToTier = {
      'price_1SUwEpF0CLysN1jANPvhIp7s': 'tier_two',
      'price_1SUwG8F0CLysN1jA367NrtiT': 'tier_three',
      'price_1SUwH8F0CLysN1jAvy1aMz3E': 'tier_four'
    };
    const tier = priceToTier[priceId] || 'tier_four';
    
    // Calculate end date
    const endDate = new Date(latestActive.current_period_end * 1000);
    endDate.setDate(endDate.getDate() + 30);
    const endDateStr = endDate.toISOString().split('T')[0];
    
    console.log('   Tier:', tier);
    console.log('   End Date:', endDateStr);
    
    // 4. DIRECT UPDATE - Find and update subscription
    console.log('\n4️⃣  Directly updating database...');
    
    // First, find existing subscription
    const existingSub = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM subscriptions WHERE user_id = $1 AND stripe_customer_id = $2 ORDER BY created_at DESC LIMIT 1'
        : 'SELECT * FROM subscriptions WHERE user_id = ? AND stripe_customer_id = ? ORDER BY created_at DESC LIMIT 1',
      [user.id, CUSTOMER_ID]
    );
    
    if (existingSub) {
      // Update existing subscription directly with raw SQL
      console.log('   Found existing subscription ID:', existingSub.id);
      console.log('   Current status:', existingSub.status);
      
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
      
      const updateParams = db.isPostgres
        ? ['active', tier, latestActive.id, endDateStr, existingSub.id]
        : ['active', tier, latestActive.id, endDateStr, existingSub.id];
      
      await db.query(updateSql, updateParams);
      console.log('   ✅ Updated subscription directly');
      
    } else {
      // Check if subscription exists with different customer ID
      const subByStripeId = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM subscriptions WHERE stripe_subscription_id = $1'
          : 'SELECT * FROM subscriptions WHERE stripe_subscription_id = ?',
        [latestActive.id]
      );
      
      if (subByStripeId) {
        // Update this one
        console.log('   Found subscription by Stripe ID:', subByStripeId.id);
        const updateSql = db.isPostgres
          ? `UPDATE subscriptions 
             SET status = $1, 
                 tier = $2, 
                 stripe_customer_id = $3, 
                 end_date = $4,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $5`
          : `UPDATE subscriptions 
             SET status = ?, 
                 tier = ?, 
                 stripe_customer_id = ?, 
                 end_date = ?,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`;
        
        const updateParams = db.isPostgres
          ? ['active', tier, CUSTOMER_ID, endDateStr, subByStripeId.id]
          : ['active', tier, CUSTOMER_ID, endDateStr, subByStripeId.id];
        
        await db.query(updateSql, updateParams);
        console.log('   ✅ Updated subscription by Stripe ID');
      } else {
        // Create new subscription
        console.log('   Creating new subscription...');
        const insertSql = db.isPostgres
          ? `INSERT INTO subscriptions (user_id, tier, status, stripe_customer_id, stripe_subscription_id, start_date, end_date, created_at, updated_at)
             VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
             RETURNING *`
          : `INSERT INTO subscriptions (user_id, tier, status, stripe_customer_id, stripe_subscription_id, start_date, end_date, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`;
        
        const insertParams = db.isPostgres
          ? [user.id, tier, 'active', CUSTOMER_ID, latestActive.id, endDateStr]
          : [user.id, tier, 'active', CUSTOMER_ID, latestActive.id, endDateStr];
        
        await db.query(insertSql, insertParams);
        console.log('   ✅ Created new subscription');
      }
    }
    
    // 5. Verify
    console.log('\n5️⃣  Verifying fix...');
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

directFix();


