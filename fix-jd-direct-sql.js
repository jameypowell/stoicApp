#!/usr/bin/env node

/**
 * Generate SQL to directly fix JD Nielson's subscription
 * This script uses Stripe API to get the correct data, then generates SQL
 */

require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY);
const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const USER_EMAIL = 'jbnielson16@gmail.com';

async function generateFixSQL() {
  console.log('🔍 Fetching JD Nielson\'s subscription from Stripe...');
  console.log('='.repeat(60));
  
  try {
    // Get customer
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log('✅ Customer:', customer.email);
    
    // Get subscriptions
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 10
    });
    
    const activeSubs = subscriptions.data.filter(s => s.status === 'active' || s.status === 'trialing');
    if (activeSubs.length === 0) {
      console.error('❌ No active subscriptions found in Stripe!');
      process.exit(1);
    }
    
    const latestActive = activeSubs.sort((a, b) => b.created - a.created)[0];
    console.log('✅ Active subscription:', latestActive.id);
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
    
    // Generate SQL
    console.log('\n📝 SQL to fix JD Nielson\'s subscription:');
    console.log('='.repeat(60));
    console.log(`
-- Fix JD Nielson's subscription
-- Customer ID: ${CUSTOMER_ID}
-- Email: ${customer.email}
-- Subscription ID: ${latestActive.id}

-- First, find the user ID
DO $$
DECLARE
    v_user_id INTEGER;
    v_sub_id INTEGER;
BEGIN
    -- Find user by email or customer ID
    SELECT id INTO v_user_id
    FROM users
    WHERE email = '${USER_EMAIL}'
       OR id IN (
           SELECT user_id FROM subscriptions WHERE stripe_customer_id = '${CUSTOMER_ID}' LIMIT 1
       )
    LIMIT 1;
    
    IF v_user_id IS NULL THEN
        RAISE EXCEPTION 'User not found for email ${USER_EMAIL} or customer ${CUSTOMER_ID}';
    END IF;
    
    -- Check if subscription exists
    SELECT id INTO v_sub_id
    FROM subscriptions
    WHERE stripe_subscription_id = '${latestActive.id}'
       OR (user_id = v_user_id AND stripe_customer_id = '${CUSTOMER_ID}')
    LIMIT 1;
    
    IF v_sub_id IS NOT NULL THEN
        -- Update existing subscription
        UPDATE subscriptions
        SET tier = '${tier}',
            status = 'active',
            stripe_customer_id = '${CUSTOMER_ID}',
            stripe_subscription_id = '${latestActive.id}',
            end_date = '${endDateStr}',
            updated_at = CURRENT_TIMESTAMP
        WHERE id = v_sub_id;
        
        RAISE NOTICE 'Updated subscription ID: %', v_sub_id;
    ELSE
        -- Create new subscription
        INSERT INTO subscriptions (
            user_id,
            tier,
            status,
            stripe_customer_id,
            stripe_subscription_id,
            start_date,
            end_date,
            created_at,
            updated_at
        ) VALUES (
            v_user_id,
            '${tier}',
            'active',
            '${CUSTOMER_ID}',
            '${latestActive.id}',
            CURRENT_TIMESTAMP,
            '${endDateStr}',
            CURRENT_TIMESTAMP,
            CURRENT_TIMESTAMP
        );
        
        RAISE NOTICE 'Created new subscription for user ID: %', v_user_id;
    END IF;
END $$;

-- Verify the fix
SELECT 
    u.email,
    s.tier,
    s.status,
    s.stripe_subscription_id,
    s.end_date
FROM subscriptions s
JOIN users u ON s.user_id = u.id
WHERE u.email = '${USER_EMAIL}' OR s.stripe_customer_id = '${CUSTOMER_ID}'
ORDER BY s.created_at DESC
LIMIT 1;
`);
    
    console.log('\n✅ SQL generated!');
    console.log('\nTo execute:');
    console.log('  1. Connect to production database');
    console.log('  2. Run the SQL above');
    console.log('  3. Verify JD can log in');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    process.exit(1);
  }
}

generateFixSQL();


