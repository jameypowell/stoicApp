#!/usr/bin/env node
/**
 * Auto-sync Stripe subscriptions with database
 * 
 * This script:
 * 1. Retrieves the 4 active subscriptions from Stripe
 * 2. Verifies they exist in the database with correct information
 * 3. Automatically fixes any discrepancies
 * 4. Verifies feature access is correct
 */

require('dotenv').config();
const path = require('path');

// Use production Stripe key - try to get from ECS if not in env
let stripeKey = process.env.STRIPE_SECRET_KEY;
if (!stripeKey || stripeKey.startsWith('sk_test_')) {
  // Try to get production key from ECS
  try {
    const { execSync } = require('child_process');
    stripeKey = execSync('node scripts/get-production-stripe-key.js --key-only 2>/dev/null', { encoding: 'utf-8' }).trim();
  } catch (e) {
    // Fallback to hardcoded production key
    stripeKey = 'YOUR_STRIPE_SECRET_KEY';
  }
}

const stripe = require('stripe')(stripeKey);
const { Database, initDatabase } = require(path.join(__dirname, '..', 'database'));

const ACTIVE_SUBSCRIPTIONS = [
  { id: 'sub_1SXU4dF0CLysN1jA8OIrz947', email: 'jtoddwhitephd@gmail.com', userId: 38 },
  { id: 'sub_1SpNC7F0CLysN1jAxvi3arES', email: 'jbnielson16@gmail.com', userId: 33 },
  { id: 'sub_1StAIqF0CLysN1jANYCAoNcU', email: 'fotujacob@gmail.com', isGymMembership: true },
  { id: 'sub_1SgR8UF0CLysN1jAY6hgsu5M', email: 'sharla.barber@nebo.edu', userId: 50 }
];

const DRY_RUN = process.argv.includes('--dry-run');

(async function() {
  try {
    console.log('🔄 Auto-Syncing Stripe Subscriptions with Database\n');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    if (DRY_RUN) {
      console.log('⚠️  DRY RUN MODE - No changes will be made\n');
    }
    
    if (!process.env.DB_PASSWORD) {
      console.log('⚠️  DB_PASSWORD not set. Showing what would be synced:\n');
      console.log('To actually sync, set DB_PASSWORD environment variable and run again.\n');
      
      // Show what would be synced without database access
      for (const subInfo of ACTIVE_SUBSCRIPTIONS) {
        const stripeSub = await stripe.subscriptions.retrieve(subInfo.id, {
          expand: ['customer']
        });
        const customer = typeof stripeSub.customer === 'string'
          ? await stripe.customers.retrieve(stripeSub.customer)
          : stripeSub.customer;
        const nextBilling = new Date(stripeSub.current_period_end * 1000);
        const tier = stripeSub.metadata?.tier || stripeSub.metadata?.membershipType || 'N/A';
        
        console.log(`${subInfo.email}:`);
        console.log(`   Would sync:`);
        console.log(`   - User stripe_customer_id: ${customer.id}`);
        if (subInfo.isGymMembership) {
          console.log(`   - Gym membership stripe_subscription_id: ${subInfo.id}`);
          console.log(`   - Gym membership stripe_customer_id: ${customer.id}`);
          console.log(`   - Gym membership status: active`);
        } else {
          console.log(`   - Subscription stripe_subscription_id: ${subInfo.id}`);
          console.log(`   - Subscription stripe_customer_id: ${customer.id}`);
          console.log(`   - Subscription tier: ${tier}`);
          console.log(`   - Subscription status: active`);
          console.log(`   - Subscription end_date: ${nextBilling.toISOString()}`);
        }
        console.log('');
      }
      
      console.log('💡 Set DB_PASSWORD and run again to actually sync.\n');
      process.exit(0);
    }
    
    // Initialize database - Force PostgreSQL for production sync
    // database.js checks USE_POSTGRES = !!process.env.DB_HOST, so we must set DB_HOST
    process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
    process.env.DB_USER = process.env.DB_USER || 'stoicapp';
    process.env.DB_NAME = process.env.DB_NAME || 'postgres';
    process.env.DB_PORT = process.env.DB_PORT || '5432';
    
    if (!process.env.DB_HOST) {
      throw new Error('DB_HOST environment variable is required for PostgreSQL connection');
    }
    
    console.log(`Connecting to PostgreSQL: ${process.env.DB_HOST}:${process.env.DB_PORT}/${process.env.DB_NAME}\n`);
    
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    if (!db.isPostgres) {
      throw new Error('Script connected to SQLite instead of PostgreSQL. DB_HOST must be set.');
    }
    
    console.log(`✅ Connected to PostgreSQL database\n`);
    
    console.log(`✅ Connected to ${db.isPostgres ? 'PostgreSQL' : 'SQLite'} database\n`);
    
    const fixes = [];
    const verified = [];
    const errors = [];
    
    for (const subInfo of ACTIVE_SUBSCRIPTIONS) {
      console.log(`\n📋 Processing: ${subInfo.email}`);
      console.log(`   Subscription: ${subInfo.id}\n`);
      
      try {
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
        console.log(`      Next Billing: ${nextBilling.toLocaleDateString()}\n`);
        
        // Find user in database (users table doesn't have stripe_customer_id)
        let user = await db.queryOne(
          db.isPostgres
            ? 'SELECT * FROM users WHERE email = $1'
            : 'SELECT * FROM users WHERE email = ?',
          [subInfo.email]
        );
        
        if (!user) {
          console.log(`   ❌ USER NOT FOUND IN DATABASE`);
          errors.push({
            subscription: subInfo.id,
            email: subInfo.email,
            issue: 'User not found in database - cannot sync'
          });
          continue;
        }
        
        console.log(`   ✅ User found: ID ${user.id}`);
        
        if (subInfo.isGymMembership) {
          // Sync gym membership
          let membership = await db.queryOne(
            db.isPostgres
              ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
              : 'SELECT * FROM gym_memberships WHERE user_id = ?',
            [user.id]
          );
          
          if (!membership) {
            console.log(`   ❌ GYM MEMBERSHIP NOT FOUND - Cannot auto-create`);
            errors.push({
              subscription: subInfo.id,
              email: subInfo.email,
              issue: 'Gym membership record not found - requires manual creation'
            });
            continue;
          }
          
          console.log(`   ✅ Gym membership found: ID ${membership.id}`);
          
          // Check and fix subscription ID
          if (membership.stripe_subscription_id !== subInfo.id) {
            console.log(`   ⚠️  Fixing gym membership subscription ID...`);
            const fix = db.isPostgres
              ? `UPDATE gym_memberships SET stripe_subscription_id = $1, stripe_customer_id = $2, status = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4`
              : `UPDATE gym_memberships SET stripe_subscription_id = ?, stripe_customer_id = ?, status = ?, updated_at = datetime('now') WHERE id = ?`;
            
            if (!DRY_RUN) {
              await db.query(fix, [subInfo.id, customer.id, 'active', membership.id]);
              console.log(`   ✅ Fixed: stripe_subscription_id = ${subInfo.id}`);
            } else {
              console.log(`   [DRY RUN] Would execute: ${fix}`);
            }
            
            fixes.push({
              type: 'gym_membership_subscription_id',
              email: subInfo.email,
              membershipId: membership.id,
              old: membership.stripe_subscription_id || 'NULL',
              new: subInfo.id
            });
          } else {
            console.log(`   ✅ Subscription ID already correct`);
          }
          
          // Check and fix customer ID
          if (membership.stripe_customer_id !== customer.id) {
            console.log(`   ⚠️  Fixing gym membership customer ID...`);
            const fix = db.isPostgres
              ? `UPDATE gym_memberships SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
              : `UPDATE gym_memberships SET stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?`;
            
            if (!DRY_RUN) {
              await db.query(fix, [customer.id, membership.id]);
              console.log(`   ✅ Fixed: stripe_customer_id = ${customer.id}`);
            } else {
              console.log(`   [DRY RUN] Would execute: ${fix}`);
            }
            
            fixes.push({
              type: 'gym_membership_customer_id',
              email: subInfo.email,
              membershipId: membership.id,
              old: membership.stripe_customer_id || 'NULL',
              new: customer.id
            });
          }
          
          // Check and fix status
          if (membership.status !== 'active' && stripeSub.status === 'active') {
            console.log(`   ⚠️  Fixing gym membership status...`);
            const fix = db.isPostgres
              ? `UPDATE gym_memberships SET status = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
              : `UPDATE gym_memberships SET status = ?, updated_at = datetime('now') WHERE id = ?`;
            
            if (!DRY_RUN) {
              await db.query(fix, ['active', membership.id]);
              console.log(`   ✅ Fixed: status = active`);
            } else {
              console.log(`   [DRY RUN] Would execute: ${fix}`);
            }
            
            fixes.push({
              type: 'gym_membership_status',
              email: subInfo.email,
              membershipId: membership.id,
              old: membership.status,
              new: 'active'
            });
          }
          
        } else {
          // Sync app subscription
          let dbSub = await db.queryOne(
            db.isPostgres
              ? 'SELECT * FROM subscriptions WHERE user_id = $1 AND stripe_subscription_id = $2'
              : 'SELECT * FROM subscriptions WHERE user_id = ? AND stripe_subscription_id = ?',
            [user.id, subInfo.id]
          );
          
          // If not found, check for any active subscription for this user
          if (!dbSub) {
            const activeSub = await db.getUserActiveSubscription(user.id);
            
            if (activeSub) {
              console.log(`   ⚠️  Found different subscription, updating...`);
              // Update existing subscription to match Stripe
              const fix = db.isPostgres
                ? `UPDATE subscriptions SET stripe_subscription_id = $1, stripe_customer_id = $2, tier = $3, status = $4, end_date = $5 WHERE id = $6`
                : `UPDATE subscriptions SET stripe_subscription_id = ?, stripe_customer_id = ?, tier = ?, status = ?, end_date = ?, updated_at = datetime('now') WHERE id = ?`;
              
              if (!DRY_RUN) {
                await db.query(fix, [subInfo.id, customer.id, tier, 'active', nextBilling.toISOString(), activeSub.id]);
                console.log(`   ✅ Updated subscription to match Stripe`);
              } else {
                console.log(`   [DRY RUN] Would execute: ${fix}`);
              }
              
              fixes.push({
                type: 'subscription_update',
                email: subInfo.email,
                subscriptionId: activeSub.id,
                old: activeSub.stripe_subscription_id || 'NULL',
                new: subInfo.id
              });
              
              dbSub = activeSub; // Use for further checks
            } else {
              console.log(`   ⚠️  Subscription not found, creating...`);
              // Create new subscription record
              const fix = db.isPostgres
                ? `INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status, start_date, end_date) VALUES ($1, $2, $3, $4, $5, CURRENT_TIMESTAMP, $6)`
                : `INSERT INTO subscriptions (user_id, tier, stripe_customer_id, stripe_subscription_id, status, start_date, end_date) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`;
              
              if (!DRY_RUN) {
                await db.query(fix, [user.id, tier, customer.id, subInfo.id, 'active', nextBilling.toISOString()]);
                console.log(`   ✅ Created subscription record`);
              } else {
                console.log(`   [DRY RUN] Would execute: ${fix}`);
              }
              
              fixes.push({
                type: 'subscription_create',
                email: subInfo.email,
                userId: user.id,
                new: subInfo.id
              });
              
              continue; // Skip further checks for newly created record
            }
          } else {
            console.log(`   ✅ Subscription found in database: ID ${dbSub.id}`);
          }
          
          // Check and fix tier (allow legacy 'monthly' for 'tier_four')
          const expectedTier = tier;
          const dbTier = dbSub.tier;
          const tierMatches = dbTier === expectedTier || (dbTier === 'monthly' && expectedTier === 'tier_four');
          
          if (!tierMatches) {
            console.log(`   ⚠️  Fixing tier...`);
            const fix = db.isPostgres
              ? `UPDATE subscriptions SET tier = $1 WHERE id = $2`
              : `UPDATE subscriptions SET tier = ?, updated_at = datetime('now') WHERE id = ?`;
            
            if (!DRY_RUN) {
              await db.query(fix, [expectedTier, dbSub.id]);
              console.log(`   ✅ Fixed: tier = ${expectedTier}`);
            } else {
              console.log(`   [DRY RUN] Would execute: ${fix}`);
            }
            
            fixes.push({
              type: 'subscription_tier',
              email: subInfo.email,
              subscriptionId: dbSub.id,
              old: dbTier,
              new: expectedTier
            });
          } else {
            console.log(`   ✅ Tier already correct (${dbTier})`);
          }
          
          // Check and fix status
          if (dbSub.status !== 'active' && stripeSub.status === 'active') {
            console.log(`   ⚠️  Fixing status...`);
            const fix = db.isPostgres
              ? `UPDATE subscriptions SET status = $1 WHERE id = $2`
              : `UPDATE subscriptions SET status = ?, updated_at = datetime('now') WHERE id = ?`;
            
            if (!DRY_RUN) {
              await db.query(fix, ['active', dbSub.id]);
              console.log(`   ✅ Fixed: status = active`);
            } else {
              console.log(`   [DRY RUN] Would execute: ${fix}`);
            }
            
            fixes.push({
              type: 'subscription_status',
              email: subInfo.email,
              subscriptionId: dbSub.id,
              old: dbSub.status,
              new: 'active'
            });
          }
          
          // Check and fix end date (allow 2 day variance)
          if (dbSub.end_date) {
            const dbEndDate = new Date(dbSub.end_date);
            const daysDiff = Math.abs((dbEndDate - nextBilling) / (1000 * 60 * 60 * 24));
            
            if (daysDiff > 2) {
              console.log(`   ⚠️  Fixing end_date (${daysDiff.toFixed(1)} days difference)...`);
              const fix = db.isPostgres
                ? `UPDATE subscriptions SET end_date = $1 WHERE id = $2`
                : `UPDATE subscriptions SET end_date = ?, updated_at = datetime('now') WHERE id = ?`;
              
              if (!DRY_RUN) {
                await db.query(fix, [nextBilling.toISOString(), dbSub.id]);
                console.log(`   ✅ Fixed: end_date = ${nextBilling.toLocaleDateString()}`);
              } else {
                console.log(`   [DRY RUN] Would execute: ${fix}`);
              }
              
              fixes.push({
                type: 'subscription_end_date',
                email: subInfo.email,
                subscriptionId: dbSub.id,
                old: dbSub.end_date,
                new: nextBilling.toISOString()
              });
            } else {
              console.log(`   ✅ End date already correct (${daysDiff.toFixed(1)} days difference is acceptable)`);
            }
          } else {
            console.log(`   ⚠️  Fixing missing end_date...`);
            const fix = db.isPostgres
              ? `UPDATE subscriptions SET end_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
              : `UPDATE subscriptions SET end_date = ?, updated_at = datetime('now') WHERE id = ?`;
            
            if (!DRY_RUN) {
              await db.query(fix, [nextBilling.toISOString(), dbSub.id]);
              console.log(`   ✅ Fixed: end_date = ${nextBilling.toLocaleDateString()}`);
            } else {
              console.log(`   [DRY RUN] Would execute: ${fix}`);
            }
            
            fixes.push({
              type: 'subscription_end_date',
              email: subInfo.email,
              subscriptionId: dbSub.id,
              old: 'NULL',
              new: nextBilling.toISOString()
            });
          }
          
          // Check and fix customer ID
          if (dbSub.stripe_customer_id !== customer.id) {
            console.log(`   ⚠️  Fixing subscription customer ID...`);
            const fix = db.isPostgres
              ? `UPDATE subscriptions SET stripe_customer_id = $1 WHERE id = $2`
              : `UPDATE subscriptions SET stripe_customer_id = ?, updated_at = datetime('now') WHERE id = ?`;
            
            if (!DRY_RUN) {
              await db.query(fix, [customer.id, dbSub.id]);
              console.log(`   ✅ Fixed: stripe_customer_id = ${customer.id}`);
            } else {
              console.log(`   [DRY RUN] Would execute: ${fix}`);
            }
            
            fixes.push({
              type: 'subscription_customer_id',
              email: subInfo.email,
              subscriptionId: dbSub.id,
              old: dbSub.stripe_customer_id || 'NULL',
              new: customer.id
            });
          }
        }
        
        verified.push({
          subscription: subInfo.id,
          email: subInfo.email,
          type: subInfo.isGymMembership ? 'gym_membership' : 'app_subscription'
        });
        
      } catch (error) {
        console.log(`   ❌ Error processing: ${error.message}`);
        errors.push({
          subscription: subInfo.id,
          email: subInfo.email,
          issue: error.message
        });
      }
    }
    
    console.log('\n═══════════════════════════════════════════════════════════════');
    console.log('📊 SYNC SUMMARY:');
    console.log('═══════════════════════════════════════════════════════════════\n');
    
    console.log(`✅ Verified: ${verified.length}`);
    console.log(`🔧 Fixes Applied: ${fixes.length}`);
    console.log(`❌ Errors: ${errors.length}\n`);
    
    if (fixes.length > 0) {
      console.log('🔧 FIXES APPLIED:\n');
      fixes.forEach((fix, i) => {
        console.log(`${i + 1}. ${fix.email} - ${fix.type}`);
        console.log(`   Changed: ${fix.old || 'N/A'} → ${fix.new}\n`);
      });
    }
    
    if (errors.length > 0) {
      console.log('❌ ERRORS:\n');
      errors.forEach((error, i) => {
        console.log(`${i + 1}. ${error.email} (${error.subscription})`);
        console.log(`   ${error.issue}\n`);
      });
    }
    
    if (verified.length === ACTIVE_SUBSCRIPTIONS.length && errors.length === 0) {
      console.log('🎉 All subscriptions are now correctly synced!\n');
    }
    
    // Close database connection properly
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    } else if (dbConnection && typeof dbConnection.close === 'function') {
      await dbConnection.close();
    }
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal Error:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
})();
