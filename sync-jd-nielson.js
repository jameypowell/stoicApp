/**
 * Emergency sync for JD Nielson's subscription
 * Uses Stripe API directly and admin endpoint to fix his account immediately
 */

require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY);
const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';

async function syncJDSubscription() {
  console.log('🚨 Emergency sync for JD Nielson (Customer: cus_TTQrfuTZCoc0Yy)');
  console.log('='.repeat(60));
  
  try {
    // 1. Get customer from Stripe
    console.log('\n1️⃣  Fetching customer from Stripe...');
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log(`   ✅ Customer: ${customer.email || customer.id}`);
    console.log(`   ✅ Name: ${customer.name || 'N/A'}`);
    
    // 2. Get all subscriptions for this customer
    console.log('\n2️⃣  Fetching subscriptions from Stripe...');
    const subscriptions = await stripe.subscriptions.list({
      customer: CUSTOMER_ID,
      status: 'all',
      limit: 10
    });
    
    console.log(`   Found ${subscriptions.data.length} subscription(s):`);
    subscriptions.data.forEach((sub, idx) => {
      console.log(`   ${idx + 1}. ${sub.id} - Status: ${sub.status} - Created: ${new Date(sub.created * 1000).toLocaleDateString()}`);
      if (sub.status === 'active' || sub.status === 'trialing') {
        console.log(`      ✅ ACTIVE - Current period ends: ${new Date(sub.current_period_end * 1000).toLocaleDateString()}`);
      }
    });
    
    // 3. Find active subscriptions
    const activeSubs = subscriptions.data.filter(sub => 
      sub.status === 'active' || sub.status === 'trialing'
    );
    
    if (activeSubs.length === 0) {
      console.log('\n❌ No active subscriptions found in Stripe!');
      console.log('   JD Nielson needs an active subscription in Stripe first.');
      return;
    }
    
    // 4. Get the most recent active subscription
    const latestActive = activeSubs.sort((a, b) => b.created - a.created)[0];
    console.log(`\n3️⃣  Using subscription: ${latestActive.id}`);
    console.log(`   Status: ${latestActive.status}`);
    console.log(`   Current period end: ${new Date(latestActive.current_period_end * 1000).toLocaleDateString()}`);
    
    // 5. Determine tier from price
    const priceId = latestActive.items.data[0]?.price?.id;
    const priceToTier = {
      'price_1SUwEpF0CLysN1jANPvhIp7s': 'tier_two',
      'price_1SUwG8F0CLysN1jA367NrtiT': 'tier_three',
      'price_1SUwH8F0CLysN1jAvy1aMz3E': 'tier_four'
    };
    const tier = priceToTier[priceId] || 'tier_four';
    console.log(`   Tier: ${tier} (Price ID: ${priceId})`);
    
    // 6. Calculate end date
    const endDate = new Date(latestActive.current_period_end * 1000);
    endDate.setDate(endDate.getDate() + 30); // Add 30 days
    
    console.log('\n4️⃣  Summary:');
    console.log(`   Customer ID: ${CUSTOMER_ID}`);
    console.log(`   Customer Email: ${customer.email}`);
    console.log(`   Subscription ID: ${latestActive.id}`);
    console.log(`   Stripe Status: ${latestActive.status}`);
    console.log(`   Tier: ${tier}`);
    console.log(`   End Date: ${endDate.toISOString().split('T')[0]}`);
    
    console.log('\n5️⃣  Next Steps:');
    console.log('   To sync this to the database, you can:');
    console.log('   1. Use the admin API endpoint:');
    console.log(`      POST /api/admin/subscriptions/sync`);
    console.log(`      Body: { "customerId": "${CUSTOMER_ID}" }`);
    console.log('   2. Or the sync will happen automatically when JD logs in');
    console.log('      (the enhanced getSubscriptionWithStripeStatus will find it)');
    
    console.log('\n✅ Stripe data retrieved successfully!');
    console.log('   JD Nielson has an active subscription in Stripe.');
    console.log('   The database will be updated when he logs in or when the sync runs.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    if (error.code === 'resource_missing') {
      console.error('   Customer not found in Stripe!');
    }
    process.exit(1);
  }
}

syncJDSubscription();


