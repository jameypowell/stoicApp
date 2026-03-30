/**
 * Script to create Stripe Price IDs for subscription tiers
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Stripe = require('stripe');
const stripe = new Stripe(process.env.STRIPE_SECRET_KEY);

async function createPrices() {
  console.log('\n🔨 Creating Stripe Prices for Subscription Tiers...\n');
  
  const tiers = [
    { name: 'Tier Two', amount: 700, interval: 'month', tier: 'tier_two' },
    { name: 'Tier Three', amount: 1200, interval: 'month', tier: 'tier_three' },
    { name: 'Tier Four', amount: 1800, interval: 'month', tier: 'tier_four' }
  ];
  
  const createdPrices = {};
  
  for (const tier of tiers) {
    try {
      // First, create or get the product
      let product;
      const productName = `Stoic Fitness - ${tier.name}`;
      
      // Check if product already exists
      const products = await stripe.products.list({ limit: 100 });
      const existingProduct = products.data.find(p => p.name === productName);
      
      if (existingProduct) {
        product = existingProduct;
        console.log(`✅ Using existing product: ${productName} (${product.id})`);
      } else {
        product = await stripe.products.create({
          name: productName,
          description: `Stoic Fitness App Subscription - ${tier.name}`,
        });
        console.log(`✅ Created product: ${productName} (${product.id})`);
      }
      
      // Create the price
      const price = await stripe.prices.create({
        product: product.id,
        unit_amount: tier.amount,
        currency: 'usd',
        recurring: {
          interval: tier.interval,
        },
        metadata: {
          tier: tier.tier,
        }
      });
      
      createdPrices[tier.tier] = price.id;
      console.log(`✅ Created price for ${tier.name}: ${price.id} ($${(tier.amount / 100).toFixed(2)}/${tier.interval})\n`);
      
    } catch (error) {
      console.error(`❌ Error creating ${tier.name}:`, error.message);
    }
  }
  
  console.log('\n📋 Add these to your .env file:\n');
  console.log(`STRIPE_PRICE_TIER_TWO=${createdPrices.tier_two}`);
  console.log(`STRIPE_PRICE_TIER_THREE=${createdPrices.tier_three}`);
  console.log(`STRIPE_PRICE_TIER_FOUR=${createdPrices.tier_four}\n`);
  
  return createdPrices;
}

createPrices().catch(error => {
  console.error('Error:', error.message);
  process.exit(1);
});
















