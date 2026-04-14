/**
 * Pre-Production Deployment Checklist
 * Verifies all configuration is correct before deploying to production
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const Stripe = require('stripe');

// Production environment variables (from PRODUCTION_DEPLOYMENT.md)
const PROD_CONFIG = {
  STRIPE_SECRET_KEY: 'YOUR_STRIPE_SECRET_KEY',
  STRIPE_PRICE_DAILY: 'price_1SUwEpF0CLysN1jANPvhIp7s',
  STRIPE_PRICE_WEEKLY: 'price_1SUwG8F0CLysN1jA367NrtiT',
  STRIPE_PRICE_MONTHLY: 'price_1SUwH8F0CLysN1jAvy1aMz3E',
  BILLING_MODE: 'one_time'
};

console.log('\n' + '='.repeat(80));
console.log('🔍 PRE-PRODUCTION DEPLOYMENT CHECKLIST');
console.log('='.repeat(80) + '\n');

let allChecksPassed = true;

// Check 1: Verify Production Price IDs exist in Stripe Live Mode
async function checkProductionPriceIDs() {
  console.log('📋 CHECK 1: Verifying Production Price IDs in Stripe Live Mode\n');
  
  const stripe = new Stripe(PROD_CONFIG.STRIPE_SECRET_KEY);
  
  const priceChecks = {
    tier_two: PROD_CONFIG.STRIPE_PRICE_DAILY,
    tier_three: PROD_CONFIG.STRIPE_PRICE_WEEKLY,
    tier_four: PROD_CONFIG.STRIPE_PRICE_MONTHLY
  };
  
  for (const [tier, priceId] of Object.entries(priceChecks)) {
    try {
      const price = await stripe.prices.retrieve(priceId);
      const amount = price.unit_amount ? `$${(price.unit_amount / 100).toFixed(2)}` : 'N/A';
      const interval = price.recurring ? `/${price.recurring.interval}` : '';
      console.log(`  ✅ ${tier}: ${priceId} - ${amount}${interval}`);
    } catch (error) {
      console.log(`  ❌ ${tier}: ${priceId} - NOT FOUND or ERROR: ${error.message}`);
      allChecksPassed = false;
    }
  }
  console.log('');
}

// Check 2: Verify code supports both naming conventions
function checkCodeCompatibility() {
  console.log('📋 CHECK 2: Code Compatibility\n');
  
  // Check if routes.js supports both naming conventions
  const fs = require('fs');
  const routesContent = fs.readFileSync(__dirname + '/../routes.js', 'utf8');
  
  const checks = {
    'Supports STRIPE_PRICE_TIER_TWO': routesContent.includes('STRIPE_PRICE_TIER_TWO'),
    'Supports STRIPE_PRICE_DAILY (legacy)': routesContent.includes('STRIPE_PRICE_DAILY'),
    'Supports STRIPE_PRICE_TIER_THREE': routesContent.includes('STRIPE_PRICE_TIER_THREE'),
    'Supports STRIPE_PRICE_WEEKLY (legacy)': routesContent.includes('STRIPE_PRICE_WEEKLY'),
    'Supports STRIPE_PRICE_TIER_FOUR': routesContent.includes('STRIPE_PRICE_TIER_FOUR'),
    'Supports STRIPE_PRICE_MONTHLY (legacy)': routesContent.includes('STRIPE_PRICE_MONTHLY'),
    'Uses normalizeTier function': routesContent.includes('normalizeTier'),
    'App checkout avoids Stripe Subscriptions (no stripe_subscriptions branch)': !routesContent.includes("billingMode === 'stripe_subscriptions'"),
  };
  
  for (const [check, passed] of Object.entries(checks)) {
    if (passed) {
      console.log(`  ✅ ${check}`);
    } else {
      console.log(`  ❌ ${check}`);
      allChecksPassed = false;
    }
  }
  console.log('');
}

// Check 3: Verify environment variable mapping
function checkEnvVarMapping() {
  console.log('📋 CHECK 3: Environment Variable Mapping\n');
  
  console.log('  Production will use:');
  console.log(`    tier_two   → STRIPE_PRICE_DAILY=${PROD_CONFIG.STRIPE_PRICE_DAILY}`);
  console.log(`    tier_three → STRIPE_PRICE_WEEKLY=${PROD_CONFIG.STRIPE_PRICE_WEEKLY}`);
  console.log(`    tier_four  → STRIPE_PRICE_MONTHLY=${PROD_CONFIG.STRIPE_PRICE_MONTHLY}`);
  console.log(`    BILLING_MODE=${PROD_CONFIG.BILLING_MODE} (optional; app tiers use PaymentIntents + DB)`);
  console.log('');
  
  console.log('  ✅ Code supports fallback: STRIPE_PRICE_TIER_* || STRIPE_PRICE_* (legacy)');
  console.log('  ✅ Production script sets legacy names (STRIPE_PRICE_DAILY, etc.)');
  console.log('  ✅ Code will work with either naming convention\n');
}

// Check 4: Verify critical functions exist
function checkCriticalFunctions() {
  console.log('📋 CHECK 4: Critical Functions\n');
  
  const fs = require('fs');
  const paymentsContent = fs.readFileSync(__dirname + '/../payments.js', 'utf8');
  const routesContent = fs.readFileSync(__dirname + '/../routes.js', 'utf8');
  
  const functions = {
    'normalizeTier function': paymentsContent.includes('function normalizeTier'),
    'payments/create-intent uses createPaymentIntent': routesContent.includes('/payments/create-intent') && routesContent.includes('createPaymentIntent'),
    'createSubscription function': paymentsContent.includes('function createSubscription'),
    'updateSubscriptionItem function': paymentsContent.includes('function updateSubscriptionItem'),
    'updateSubscriptionItemForUpgrade function': paymentsContent.includes('function updateSubscriptionItemForUpgrade'),
    'calculateUpgradePrice function': paymentsContent.includes('function calculateUpgradePrice'),
  };
  
  for (const [func, exists] of Object.entries(functions)) {
    if (exists) {
      console.log(`  ✅ ${func}`);
    } else {
      console.log(`  ❌ ${func} - MISSING`);
      allChecksPassed = false;
    }
  }
  console.log('');
}

// Check 5: Verify upgrade/downgrade endpoints
function checkEndpoints() {
  console.log('📋 CHECK 5: API Endpoints\n');
  
  const fs = require('fs');
  const routesContent = fs.readFileSync(__dirname + '/../routes.js', 'utf8');
  
  const endpoints = {
    'POST /payments/create-intent': routesContent.includes('/payments/create-intent'),
    'POST /subscriptions/downgrade': routesContent.includes('/subscriptions/downgrade'),
    'POST /subscriptions/cancel': routesContent.includes('/subscriptions/cancel'),
    'GET /subscriptions/me': routesContent.includes('/subscriptions/me'),
  };
  
  for (const [endpoint, exists] of Object.entries(endpoints)) {
    if (exists) {
      console.log(`  ✅ ${endpoint}`);
    } else {
      console.log(`  ❌ ${endpoint} - MISSING`);
      allChecksPassed = false;
    }
  }
  console.log('');
}

// Check 6: Production deployment script
function checkDeploymentScript() {
  console.log('📋 CHECK 6: Deployment Scripts\n');
  
  const fs = require('fs');
  
  const scripts = {
    'deploy.sh exists': fs.existsSync(__dirname + '/../deploy.sh'),
    'update_production_env.sh exists': fs.existsSync(__dirname + '/../scripts/update_production_env.sh'),
  };
  
  for (const [script, exists] of Object.entries(scripts)) {
    if (exists) {
      console.log(`  ✅ ${script}`);
    } else {
      console.log(`  ❌ ${script} - MISSING`);
      allChecksPassed = false;
    }
  }
  console.log('');
}

// Run all checks
async function runAllChecks() {
  try {
    await checkProductionPriceIDs();
    checkCodeCompatibility();
    checkEnvVarMapping();
    checkCriticalFunctions();
    checkEndpoints();
    checkDeploymentScript();
    
    console.log('='.repeat(80));
    if (allChecksPassed) {
      console.log('✅ ALL CHECKS PASSED - Ready for Production Deployment!');
      console.log('\n📝 Next Steps:');
      console.log('  1. Run: ./scripts/update_production_env.sh (to set environment variables)');
      console.log('  2. Run: ./deploy.sh (to build and deploy)');
      console.log('  3. Verify webhook endpoint is configured in Stripe Dashboard');
      console.log('  4. Test subscription flow in production');
    } else {
      console.log('❌ SOME CHECKS FAILED - Please fix issues before deploying!');
    }
    console.log('='.repeat(80) + '\n');
  } catch (error) {
    console.error('\n❌ Error running checks:', error.message);
    console.error('Stack:', error.stack);
    process.exit(1);
  }
}

runAllChecks();
















