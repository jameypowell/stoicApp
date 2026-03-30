/**
 * Find JD Nielson's customer in Stripe
 */

require('dotenv').config();

const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY);
const isLive = (process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY || '').startsWith('sk_live');
console.log(`Using ${isLive ? 'LIVE' : 'TEST'} Stripe key`);

async function findCustomer() {
  try {
    // Try the known customer ID first
    console.log('\n1️⃣  Trying known customer ID: cus_TTQrfuTZCoc0Yy');
    try {
      const customer = await stripe.customers.retrieve('cus_TTQrfuTZCoc0Yy');
      console.log('   ✅ Found:', customer.email, customer.name || '');
      console.log('   Customer ID:', customer.id);
      return;
    } catch (e) {
      console.log('   ❌ Not found with this key');
    }
    
    // Search by email
    console.log('\n2️⃣  Searching by email: jbnielson16@gmail.com');
    const customers = await stripe.customers.list({
      email: 'jbnielson16@gmail.com',
      limit: 10
    });
    
    if (customers.data.length > 0) {
      console.log(`   ✅ Found ${customers.data.length} customer(s):`);
      customers.data.forEach((c, idx) => {
        console.log(`   ${idx + 1}. ID: ${c.id}, Email: ${c.email}, Name: ${c.name || 'N/A'}`);
        
        // Get subscriptions for this customer
        stripe.subscriptions.list({ customer: c.id, limit: 5 }).then(subs => {
          console.log(`      Subscriptions: ${subs.data.length}`);
          subs.data.forEach(sub => {
            console.log(`        - ${sub.id}: ${sub.status} (created ${new Date(sub.created * 1000).toLocaleDateString()})`);
          });
        });
      });
    } else {
      console.log('   ❌ No customer found with this email');
    }
    
    // List recent customers
    console.log('\n3️⃣  Listing recent customers (last 10)...');
    const recent = await stripe.customers.list({ limit: 10 });
    console.log(`   Found ${recent.data.length} recent customers:`);
    recent.data.forEach((c, idx) => {
      console.log(`   ${idx + 1}. ${c.id} - ${c.email || 'no email'} - ${c.name || 'no name'}`);
    });
    
  } catch (error) {
    console.error('❌ Error:', error.message);
  }
}

findCustomer();


