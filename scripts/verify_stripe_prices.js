/**
 * Script to verify Stripe Price IDs exist in the current Stripe account
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function verifyPrices() {
  console.log('\n🔍 Verifying Stripe Price IDs...\n');
  
  const expectedPrices = {
    tier_two: process.env.STRIPE_PRICE_TIER_TWO || process.env.STRIPE_PRICE_DAILY,
    tier_three: process.env.STRIPE_PRICE_TIER_THREE || process.env.STRIPE_PRICE_WEEKLY,
    tier_four: process.env.STRIPE_PRICE_TIER_FOUR || process.env.STRIPE_PRICE_MONTHLY
  };
  
  console.log('Expected Price IDs from .env:');
  console.log(`  tier_two:   ${expectedPrices.tier_two || 'NOT SET'}`);
  console.log(`  tier_three: ${expectedPrices.tier_three || 'NOT SET'}`);
  console.log(`  tier_four:  ${expectedPrices.tier_four || 'NOT SET'}`);
  console.log(`\nStripe API Key Mode: ${process.env.STRIPE_SECRET_KEY?.startsWith('sk_test_') ? 'TEST' : 'LIVE'}\n`);
  
  // Verify each price
  for (const [tier, priceId] of Object.entries(expectedPrices)) {
    if (!priceId) {
      console.log(`❌ ${tier}: Price ID not configured in .env`);
      continue;
    }
    
    try {
      const price = await stripe.prices.retrieve(priceId);
      console.log(`✅ ${tier}: ${priceId}`);
      console.log(`   Product: ${price.product} | Amount: $${(price.unit_amount / 100).toFixed(2)}/${price.recurring?.interval || 'one-time'}`);
    } catch (error) {
      if (error.code === 'resource_missing') {
        console.log(`❌ ${tier}: ${priceId} - NOT FOUND in Stripe`);
      } else {
        console.log(`❌ ${tier}: ${priceId} - Error: ${error.message}`);
      }
    }
  }
  
  // List all available prices
  console.log('\n📋 All Prices in Your Stripe Account:\n');
  try {
    const prices = await stripe.prices.list({ limit: 100, active: true });
    
    if (prices.data.length === 0) {
      console.log('  No prices found in your Stripe account.');
    } else {
      prices.data.forEach(price => {
        const amount = price.unit_amount ? `$${(price.unit_amount / 100).toFixed(2)}` : 'N/A';
        const interval = price.recurring ? `/${price.recurring.interval}` : '';
        console.log(`  ${price.id} - ${amount}${interval} (Product: ${price.product})`);
      });
    }
  } catch (error) {
    console.log(`  Error listing prices: ${error.message}`);
  }
  
  console.log('\n💡 If prices are missing, you need to:');
  console.log('   1. Go to https://dashboard.stripe.com/test/products');
  console.log('   2. Create products for each tier (or use existing ones)');
  console.log('   3. Create recurring prices: $7/month, $12/month, $18/month');
  console.log('   4. Copy the Price IDs and update your .env file\n');
}

verifyPrices().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
















