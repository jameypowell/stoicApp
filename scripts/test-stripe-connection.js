#!/usr/bin/env node

/**
 * Test Stripe Connection from ECS
 * Simple script to verify Stripe API connectivity
 */

require('dotenv').config();
const Stripe = require('stripe');

const stripeSecretKey = process.env.STRIPE_SECRET_KEY;
if (!stripeSecretKey) {
  console.error('ERROR: STRIPE_SECRET_KEY environment variable is not set!');
  process.exit(1);
}

const stripe = new Stripe(stripeSecretKey, {
  timeout: 10000,
  maxNetworkRetries: 2
});

async function testConnection() {
  console.log('Testing Stripe connection from ECS...\n');
  console.log(`Using key: ${stripeSecretKey.substring(0, 20)}...${stripeSecretKey.substring(stripeSecretKey.length - 4)}\n`);
  
  try {
    // Try to list customers (simple API call)
    const customers = await stripe.customers.list({ limit: 1 });
    console.log('✅ Stripe connection successful!');
    console.log(`   Retrieved ${customers.data.length} customer(s) as test`);
    process.exit(0);
  } catch (error) {
    console.error('❌ Stripe connection failed!');
    console.error(`   Error: ${error.message}`);
    console.error(`   Type: ${error.type || 'unknown'}`);
    if (error.code) {
      console.error(`   Code: ${error.code}`);
    }
    process.exit(1);
  }
}

testConnection();
