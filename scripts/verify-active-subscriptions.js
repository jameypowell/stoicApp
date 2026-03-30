#!/usr/bin/env node
/**
 * Verify and sync active Stripe subscriptions with database
 * 
 * This script:
 * 1. Retrieves the 4 active subscriptions from Stripe
 * 2. Verifies they exist in the database with correct information
 * 3. Identifies any discrepancies
 * 4. Optionally fixes issues (when --fix flag is provided)
 */

require('dotenv').config();
const path = require('path');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY || 'YOUR_STRIPE_SECRET_KEY');
const { Database, initDatabase } = require(path.join(__dirname, '..', 'database'));

const ACTIVE_SUBSCRIPTIONS = [
  { id: 'sub_1SXU4dF0CLysN1jA8OIrz947', email: 'jtoddwhitephd@gmail.com', userId: 38 },
  { id: 'sub_1SpNC7F0CLysN1jAxvi3arES', email: 'jbnielson16@gmail.com', userId: 33 },
  { id: 'sub_1StAIqF0CLysN1jANYCAoNcU', email: 'fotujacob@gmail.com', isGymMembership: true },
  { id: 'sub_1SgR8UF0CLysN1jAY6hgsu5M', email: 'sharla.barber@nebo.edu', userId: 50 }
];

const FIX_MODE = process.argv.includes('--fix');

async function verifySubscriptions() {
  try {
    console.log('🔍 Verifying Active Subscriptions\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    // Initialize database
    process.env.USE_POSTGRES = 'true';
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    console.log(`✅ Connected to ${db.isPostgres ? 'PostgreSQL' : 'SQLite'} database\n`);
    
    const issues = [];
    const verified = [];
    
    for (const subInfo of ACTIVE_SUBSCRIPTIONS) {
      console.log(`\n📋 ${subInfo.email}`);
      console.log(`   Subscription: ${subInfo.id}\n`);
      
      // Get Stripe subscription
      const stripeSub = await stripe.subscriptions.retrieve(subInfo.id, {
        expand: ['customer']
      });
      
      const customer = typeof stripeSub.customer === 'string'
        ? await stripe.customers.retrieve(stripeSub.customer)
        : stripeSub.customer;
      
      const nextBilling = new Date(stripeSub.current_period_end * 1000);
      const tier = stripeSub.metadata?.tier || stripeSub.metadata?.membershipType || 'N/A';
      const type = stripeSub.metadata?.type || 'app_subscription';
      
      console.log(`   Stripe:`);
      console.log(`      Status: ${stripeSub.status}`);
      console.log(`      Customer ID: ${customer.id}`);
      console.log(`      Tier: ${tier}`);
      console.log(`      Next Billing: ${nextBilling.toLocaleDateString()}`);
      
      // Find user in database
      const user = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM users WHERE email = $1 OR stripe_customer_id = $2'
          : 'SELECT * FROM users WHERE email = ? OR stripe_customer_id = ?',
        [subInfo.email, customer.id]
      );
      
      if (!user) {
        console.log(`   ❌ USER NOT FOUND IN DATABASE`);
        issues.push({
          subscription: subInfo.id,
          email: subInfo.email,
          issue: 'User not found in database',
          fix: `Create user record for ${subInfo.email}`
        });
        continue;
      }
      
      console.log(`   ✅ User found: ID ${user.id}`);
      
      // Check user's stripe_customer_id
      if (user.stripe_customer_id !== customer.id) {
        console.log(`   ⚠️  User stripe_customer_id mismatch:`);
        console.log(`      Database: ${user.stripe_customer_id || 'NULL'}`);
        console.log(`      Stripe: ${customer.id}`);
        issues.push({
          subscription: subInfo.id,
          email: subInfo.email,
          userId: user.id,
          issue: `User stripe_customer_id mismatch`,
          fix: `UPDATE users SET stripe_customer_id = '${customer.id}' WHERE id = ${user.id}`
        });
      } else {
        console.log(`   ✅ User stripe_customer_id matches`);
      }
      
      if (subInfo.isGymMembership) {
        // Check gym membership
        const membership = await db.queryOne(
          db.isPostgres
            ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
            : 'SELECT * FROM gym_memberships WHERE user_id = ?',
          [user.id]
        );
        
        if (!membership) {
          console.log(`   ❌ GYM MEMBERSHIP NOT FOUND`);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            issue: 'Gym membership record not found',
            fix: `Create gym membership record for user ${user.id}`
          });
          continue;
        }
        
        console.log(`   ✅ Gym membership found: ID ${membership.id}`);
        console.log(`      Type: ${membership.membership_type}`);
        console.log(`      Status: ${membership.status}`);
        
        // Check subscription ID
        if (membership.stripe_subscription_id !== subInfo.id) {
          console.log(`   ⚠️  Subscription ID mismatch:`);
          console.log(`      Database: ${membership.stripe_subscription_id || 'NULL'}`);
          console.log(`      Stripe: ${subInfo.id}`);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            membershipId: membership.id,
            issue: `Gym membership subscription ID mismatch`,
            fix: db.isPostgres
              ? `UPDATE gym_memberships SET stripe_subscription_id = '${subInfo.id}', stripe_customer_id = '${customer.id}', status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ${membership.id}`
              : `UPDATE gym_memberships SET stripe_subscription_id = '${subInfo.id}', stripe_customer_id = '${customer.id}', status = 'active', updated_at = datetime('now') WHERE id = ${membership.id}`
          });
        } else {
          console.log(`   ✅ Subscription ID matches`);
        }
        
        // Check customer ID
        if (membership.stripe_customer_id !== customer.id) {
          console.log(`   ⚠️  Customer ID mismatch in gym membership`);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            membershipId: membership.id,
            issue: `Gym membership customer ID mismatch`,
            fix: db.isPostgres
              ? `UPDATE gym_memberships SET stripe_customer_id = '${customer.id}', updated_at = CURRENT_TIMESTAMP WHERE id = ${membership.id}`
              : `UPDATE gym_memberships SET stripe_customer_id = '${customer.id}', updated_at = datetime('now') WHERE id = ${membership.id}`
          });
        }
        
        // Check status
        if (membership.status !== 'active' && stripeSub.status === 'active') {
          console.log(`   ⚠️  Status mismatch:`);
          console.log(`      Database: ${membership.status}`);
          console.log(`      Stripe: ${stripeSub.status}`);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            membershipId: membership.id,
            issue: `Status mismatch`,
            fix: db.isPostgres
              ? `UPDATE gym_memberships SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ${membership.id}`
              : `UPDATE gym_memberships SET status = 'active', updated_at = datetime('now') WHERE id = ${membership.id}`
          });
        }
        
      } else {
        // Check app subscription
        const dbSub = await db.queryOne(
          db.isPostgres
            ? 'SELECT * FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id = $2'
            : 'SELECT * FROM subscriptions WHERE user_id = ? AND stripe_subscription_id = ?',
          [user.id, subInfo.id]
        );
        
        if (!dbSub) {
          // Try to find any active subscription
          const activeSub = await db.getUserActiveSubscription(user.id);
          
          if (activeSub && activeSub.stripe_subscription_id !== subInfo.id) {
            console.log(`   ⚠️  Subscription ID mismatch:`);
            console.log(`      Database has: ${activeSub.stripe_subscription_id || 'NULL'}`);
            console.log(`      Stripe has: ${subInfo.id}`);
            issues.push({
              subscription: subInfo.id,
              email: subInfo.email,
              userId: user.id,
              issue: `Subscription ID mismatch - database has different subscription`,
              fix: db.isPostgres
                ? `UPDATE subscriptions SET stripe_subscription_id = '${subInfo.id}', stripe_customer_id = '${customer.id}', tier = '${tier}', status = 'active', end_date = '${nextBilling.toISOString()}', updated_at = CURRENT_TIMESTAMP WHERE id = ${activeSub.id}`
                : `UPDATE subscriptions SET stripe_subscription_id = '${subInfo.id}', stripe_customer_id = '${customer.id}', tier = '${tier}', status = 'active', end_date = '${nextBilling.toISOString()}', updated_at = datetime('now') WHERE id = ${activeSub.id}`
            });
          } else {
            console.log(`   ❌ SUBSCRIPTION NOT FOUND IN DATABASE`);
            issues.push({
              subscription: subInfo.id,
              email: subInfo.email,
              userId: user.id,
              issue: 'Subscription not found in database',
              fix: db.isPostgres
                ? `INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status, start_date, end_date) VALUES (${user.id}, '${tier}', '${customer.id}', '${subInfo.id}', 'active', CURRENT_TIMESTAMP, '${nextBilling.toISOString()}')`
                : `INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status, start_date, end_date) VALUES (${user.id}, '${tier}', '${customer.id}', '${subInfo.id}', 'active', datetime('now'), '${nextBilling.toISOString()}')`
            });
          }
          continue;
        }
        
        console.log(`   ✅ Subscription found in database: ID ${dbSub.id}`);
        console.log(`      Tier: ${dbSub.tier}`);
        console.log(`      Status: ${dbSub.status}`);
        
        // Check tier matches (allow legacy 'monthly' for 'tier_four')
        const expectedTier = tier;
        const dbTier = dbSub.tier;
        const tierMatches = dbTier === expectedTier || (dbTier === 'monthly' && expectedTier === 'tier_four');
        
        if (!tierMatches) {
          console.log(`   ⚠️  Tier mismatch:`);
          console.log(`      Database: ${dbTier}`);
          console.log(`      Stripe: ${expectedTier}`);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            subscriptionId: dbSub.id,
            issue: `Tier mismatch`,
            fix: db.isPostgres
              ? `UPDATE subscriptions SET tier = '${expectedTier}', updated_at = CURRENT_TIMESTAMP WHERE id = ${dbSub.id}`
              : `UPDATE subscriptions SET tier = '${expectedTier}', updated_at = datetime('now') WHERE id = ${dbSub.id}`
          });
        } else {
          console.log(`   ✅ Tier matches (${dbTier})`);
        }
        
        // Check status
        if (dbSub.status !== 'active' && stripeSub.status === 'active') {
          console.log(`   ⚠️  Status mismatch:`);
          console.log(`      Database: ${dbSub.status}`);
          console.log(`      Stripe: ${stripeSub.status}`);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            subscriptionId: dbSub.id,
            issue: `Status mismatch`,
            fix: db.isPostgres
              ? `UPDATE subscriptions SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = ${dbSub.id}`
              : `UPDATE subscriptions SET status = 'active', updated_at = datetime('now') WHERE id = ${dbSub.id}`
          });
        }
        
        // Check end date (allow 2 day variance)
        if (dbSub.end_date) {
          const dbEndDate = new Date(dbSub.end_date);
          const stripeEndDate = new Date(stripeSub.current_period_end * 1000);
          const daysDiff = Math.abs((dbEndDate - stripeEndDate) / (1000 * 60 * 60 * 24));
          
          if (daysDiff > 2) {
            console.log(`   ⚠️  End date mismatch (${daysDiff.toFixed(1)} days):`);
            console.log(`      Database: ${dbSub.end_date}`);
            console.log(`      Stripe: ${stripeEndDate.toISOString()}`);
            issues.push({
              subscription: subInfo.id,
              email: subInfo.email,
              userId: user.id,
              subscriptionId: dbSub.id,
              issue: `End date mismatch`,
              fix: db.isPostgres
                ? `UPDATE subscriptions SET end_date = '${stripeEndDate.toISOString()}', updated_at = CURRENT_TIMESTAMP WHERE id = ${dbSub.id}`
                : `UPDATE subscriptions SET end_date = '${stripeEndDate.toISOString()}', updated_at = datetime('now') WHERE id = ${dbSub.id}`
            });
          } else {
            console.log(`   ✅ End date matches (${daysDiff.toFixed(1)} days difference is acceptable)`);
          }
        } else {
          console.log(`   ⚠️  End date not set in database`);
          const stripeEndDate = new Date(stripeSub.current_period_end * 1000);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            subscriptionId: dbSub.id,
            issue: `End date not set`,
            fix: db.isPostgres
              ? `UPDATE subscriptions SET end_date = '${stripeEndDate.toISOString()}', updated_at = CURRENT_TIMESTAMP WHERE id = ${dbSub.id}`
              : `UPDATE subscriptions SET end_date = '${stripeEndDate.toISOString()}', updated_at = datetime('now') WHERE id = ${dbSub.id}`
          });
        }
        
        // Check customer ID
        if (dbSub.stripe_customer_id !== customer.id) {
          console.log(`   ⚠️  Customer ID mismatch in subscription`);
          issues.push({
            subscription: subInfo.id,
            email: subInfo.email,
            userId: user.id,
            subscriptionId: dbSub.id,
            issue: `Subscription customer ID mismatch`,
            fix: db.isPostgres
              ? `UPDATE subscriptions SET stripe_customer_id = '${customer.id}', updated_at = CURRENT_TIMESTAMP WHERE id = ${dbSub.id}`
              : `UPDATE subscriptions SET stripe_customer_id = '${customer.id}', updated_at = datetime('now') WHERE id = ${dbSub.id}`
          });
        }
      }
      
      verified.push({
        subscription: subInfo.id,
        email: subInfo.email,
        type: subInfo.isGymMembership ? 'gym_membership' : 'app_subscription'
      });
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 VERIFICATION SUMMARY:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log(`✅ Verified: ${verified.length}`);
    console.log(`⚠️  Issues Found: ${issues.length}\n`);
    
    if (issues.length > 0) {
      console.log('⚠️  ISSUES TO FIX:\n');
      issues.forEach((issue, i) => {
        console.log(`${i + 1}. ${issue.email} (${issue.subscription})`);
        console.log(`   Issue: ${issue.issue}`);
        if (issue.fix) {
          console.log(`   Fix SQL: ${issue.fix}\n`);
        } else {
          console.log('');
        }
      });
      
      if (FIX_MODE) {
        console.log('\n🔧 Applying fixes...\n');
        for (const issue of issues) {
          if (issue.fix && issue.fix.startsWith('UPDATE') || issue.fix.startsWith('INSERT')) {
            try {
              await db.query(issue.fix);
              console.log(`✅ Fixed: ${issue.email} - ${issue.issue}`);
            } catch (error) {
              console.error(`❌ Error fixing ${issue.email}: ${error.message}`);
            }
          }
        }
        console.log('\n✅ Fixes applied!\n');
      } else {
        console.log('\n💡 To apply fixes automatically, run with --fix flag:\n');
        console.log('   node scripts/verify-active-subscriptions.js --fix\n');
      }
    } else {
      console.log('✅ All subscriptions are correctly synced!\n');
    }
    
    // Verify feature access
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('🔐 FEATURE ACCESS VERIFICATION:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    const TIER_ACCESS_CONFIG = require(path.join(__dirname, '..', 'tier-access-config.json'));
    
    for (const subInfo of ACTIVE_SUBSCRIPTIONS) {
      if (subInfo.isGymMembership) continue; // Skip gym memberships for feature access
      
      const stripeSub = await stripe.subscriptions.retrieve(subInfo.id);
      const tier = stripeSub.metadata?.tier || 'N/A';
      
      console.log(`${subInfo.email} (${tier}):`);
      
      // Check each feature
      const features = [
        'functional_fitness_workouts',
        'core_finishers',
        'strength_phase_one',
        'strength_phase_two',
        'strength_phase_three',
        'meal_plan_calculator',
        'body_composition_measurements',
        'one_rm_lifts'
      ];
      
      features.forEach(featureKey => {
        const feature = TIER_ACCESS_CONFIG.features[featureKey];
        if (!feature) return;
        
        const tierAccess = feature.tierAccess[tier];
        const hasAccess = tierAccess && tierAccess.access;
        const limit = tierAccess?.limit;
        
        const accessStr = hasAccess 
          ? `✅ Access${limit !== null ? ` (limit: ${limit})` : ' (unlimited)'}`
          : '❌ No access';
        
        console.log(`   ${feature.name}: ${accessStr}`);
      });
      console.log('');
    }
    
    await dbConnection.end();
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

verifySubscriptions();
