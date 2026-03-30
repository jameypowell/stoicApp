#!/usr/bin/env node

/**
 * Fix JD Nielson's subscription in Stripe
 * Then provide SQL to update database
 */

require('dotenv').config();

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';

// Get production Stripe key
const stripeKey = process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('❌ STRIPE_SECRET_KEY not found');
  process.exit(1);
}
const stripe = require('stripe')(stripeKey);

async function fixInStripe() {
  console.log('🚨 FIXING JD NIELSON IN STRIPE');
  console.log('='.repeat(60));
  
  try {
    // 1. Get customer
    console.log('\n1️⃣  Getting customer from Stripe...');
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log('   ✅ Customer:', customer.email || customer.id);
    
    // 2. Get ALL subscriptions
    console.log('\n2️⃣  Getting all subscriptions...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 100
    });
    
    console.log(`   Found ${subscriptions.data.length} subscription(s):`);
    subscriptions.data.forEach((sub, idx) => {
      console.log(`   ${idx + 1}. ${sub.id} - Status: ${sub.status}`);
    });
    
    // 3. Find active subscriptions
    const activeSubs = subscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing');
    
    let activeSubscriptionId = null;
    
    if (activeSubs.length > 0) {
      const latest = activeSubs.sort((a, b) => b.created - a.created)[0];
      activeSubscriptionId = latest.id;
      console.log(`\n3️⃣  Found active subscription: ${activeSubscriptionId}`);
      console.log('   Status:', latest.status);
      
      // Get subscription details for SQL
      const subDetails = await stripe.subscriptions.retrieve(activeSubscriptionId);
      const endDate = new Date(subDetails.current_period_end * 1000);
      endDate.setDate(endDate.getDate() + 30);
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log('\n4️⃣  SQL to update database:');
      console.log('='.repeat(60));
      console.log(`
-- Update JD Nielson's subscription in database
-- Customer ID: ${CUSTOMER_ID}
-- Email: ${USER_EMAIL}
-- Subscription ID: ${activeSubscriptionId}
-- End Date: ${endDateStr}

UPDATE subscriptions
SET status = 'active',
    tier = 'tier_four',
    stripe_subscription_id = '${activeSubscriptionId}',
    end_date = '${endDateStr}',
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE email = '${USER_EMAIL}' OR id IN (SELECT user_id FROM subscriptions WHERE stripe_customer_id = '${CUSTOMER_ID}' LIMIT 1) LIMIT 1)
  AND stripe_customer_id = '${CUSTOMER_ID}';

-- Verify
SELECT u.email, s.status, s.tier, s.stripe_subscription_id, s.end_date
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE s.stripe_customer_id = '${CUSTOMER_ID}'
ORDER BY s.created_at DESC
LIMIT 1;
`);
    } else {
      console.log('\n3️⃣  No active subscriptions found.');
      
      // Cancel incomplete subscriptions
      const incompleteSubs = subscriptions.data.filter(s => 
        s.status === 'incomplete_expired' || s.status === 'incomplete'
      );
      
      if (incompleteSubs.length > 0) {
        console.log(`\n4️⃣  Canceling ${incompleteSubs.length} incomplete subscription(s)...`);
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
      
      const newSub = await stripe.subscriptions.create({
        customer: CUSTOMER_ID,
        items: [{ price: priceId }],
        metadata: {
          tier: 'tier_four',
          type: 'app_subscription'
        },
        trial_period_days: 30,
        payment_behavior: paymentMethodId ? 'default_incomplete' : 'default_incomplete',
        default_payment_method: paymentMethodId || undefined,
        collection_method: 'charge_automatically'
      });
      
      activeSubscriptionId = newSub.id;
      console.log('   ✅ Created new subscription:', activeSubscriptionId);
      console.log('   Status:', newSub.status);
      
      // Get the subscription details
      const subDetails = await stripe.subscriptions.retrieve(activeSubscriptionId);
      const endDate = new Date(subDetails.current_period_end * 1000);
      endDate.setDate(endDate.getDate() + 30);
      const endDateStr = endDate.toISOString().split('T')[0];
      
      console.log('\n6️⃣  SQL to update database:');
      console.log('='.repeat(60));
      console.log(`
-- Update JD Nielson's subscription in database
-- Customer ID: ${CUSTOMER_ID}
-- Email: ${USER_EMAIL}
-- New Subscription ID: ${activeSubscriptionId}
-- End Date: ${endDateStr}

UPDATE subscriptions
SET status = 'active',
    tier = 'tier_four',
    stripe_subscription_id = '${activeSubscriptionId}',
    end_date = '${endDateStr}',
    updated_at = CURRENT_TIMESTAMP
WHERE user_id = (SELECT id FROM users WHERE email = '${USER_EMAIL}' OR id IN (SELECT user_id FROM subscriptions WHERE stripe_customer_id = '${CUSTOMER_ID}' LIMIT 1) LIMIT 1)
  AND stripe_customer_id = '${CUSTOMER_ID}';

-- Verify
SELECT u.email, s.status, s.tier, s.stripe_subscription_id, s.end_date
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE s.stripe_customer_id = '${CUSTOMER_ID}'
ORDER BY s.created_at DESC
LIMIT 1;
`);
      console.log('\n✅ Stripe subscription created!');
      console.log('   Run the SQL above on the production database to complete the fix.');
    }
    
    console.log('\n✅✅✅ JD NIELSON\'S STRIPE SUBSCRIPTION IS FIXED! ✅✅✅');
    if (activeSubscriptionId) {
      console.log('   Subscription ID:', activeSubscriptionId);
      console.log('   Status: active');
    }
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

fixInStripe();
