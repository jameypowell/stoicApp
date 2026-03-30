// Fix Jake Fotu's gym membership - create subscription without charging
// Customer ID: cus_Tn4vCyVuETJUTe
// Issue: Charged but subscription was not created
// Solution: Create subscription with billing_cycle_anchor 30 days from today

require('dotenv').config();
process.env.USE_POSTGRES = 'true';

// Use production Stripe key if available, otherwise use regular key
const stripeKey = process.env.STRIPE_SECRET_KEY_PROD || process.env.STRIPE_SECRET_KEY;
if (!stripeKey) {
  console.error('❌ ERROR: STRIPE_SECRET_KEY or STRIPE_SECRET_KEY_PROD must be set');
  process.exit(1);
}

const stripe = require('stripe')(stripeKey);
const { Database, initDatabase } = require('./database');

const CUSTOMER_ID = 'cus_Tn4vCyVuETJUTe';

async function fixJakeFotuMembership() {
  try {
    console.log('🔧 Fixing Jake Fotu\'s gym membership...\n');
    
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    // Step 1: Get customer from Stripe
    console.log('Step 1: Retrieving customer from Stripe...');
    const customer = await stripe.customers.retrieve(CUSTOMER_ID);
    console.log(`✅ Customer found: ${customer.email || 'No email'}`);
    console.log(`   Customer ID: ${customer.id}`);
    console.log(`   Name: ${customer.name || 'No name'}\n`);
    
    // Step 2: Find user in database by Stripe customer ID
    console.log('Step 2: Finding user in database...');
    const user = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM users WHERE stripe_customer_id = $1'
        : 'SELECT * FROM users WHERE stripe_customer_id = ?',
      [CUSTOMER_ID]
    );
    
    if (!user) {
      throw new Error('User not found in database with this Stripe customer ID');
    }
    console.log(`✅ User found: ID ${user.id}, Email: ${user.email}\n`);
    
    // Step 3: Get gym membership record
    console.log('Step 3: Finding gym membership record...');
    const membership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
        : 'SELECT * FROM gym_memberships WHERE user_id = ?',
      [user.id]
    );
    
    if (!membership) {
      throw new Error('Gym membership record not found');
    }
    console.log(`✅ Membership found: ID ${membership.id}`);
    console.log(`   Membership Type: ${membership.membership_type}`);
    console.log(`   Status: ${membership.status}`);
    console.log(`   Stripe Subscription ID: ${membership.stripe_subscription_id || 'NULL ❌'}\n`);
    
    // Step 4: Check if subscription already exists in Stripe
    if (membership.stripe_subscription_id) {
      try {
        const existingSub = await stripe.subscriptions.retrieve(membership.stripe_subscription_id);
        console.log('⚠️  Subscription already exists in Stripe:');
        console.log(`   Subscription ID: ${existingSub.id}`);
        console.log(`   Status: ${existingSub.status}`);
        console.log(`   Current Period End: ${new Date(existingSub.current_period_end * 1000).toLocaleDateString()}`);
        console.log('\n❌ Subscription already exists. No action needed.');
        process.exit(0);
      } catch (error) {
        if (error.code === 'resource_missing') {
          console.log('⚠️  Subscription ID in database but not found in Stripe. Will create new one.\n');
        } else {
          throw error;
        }
      }
    }
    
    // Step 5: Get customer's payment methods
    console.log('Step 4: Retrieving customer payment methods...');
    const paymentMethods = await stripe.paymentMethods.list({
      customer: CUSTOMER_ID,
      type: 'card'
    });
    
    if (paymentMethods.data.length === 0) {
      throw new Error('No payment methods found for customer. Cannot create subscription.');
    }
    
    const defaultPaymentMethod = paymentMethods.data.find(pm => pm.id === customer.invoice_settings?.default_payment_method) 
      || paymentMethods.data[0];
    
    console.log(`✅ Found ${paymentMethods.data.length} payment method(s)`);
    console.log(`   Using: ${defaultPaymentMethod.id} (${defaultPaymentMethod.card?.brand} ****${defaultPaymentMethod.card?.last4})\n`);
    
    // Step 6: Determine membership type and price
    console.log('Step 5: Determining membership price...');
    const membershipTypeToPrice = {
      'standard': 6500,              // $65.00/month
      'immediate_family_member': 5000,      // $50.00/month
      'expecting_or_recovering_mother': 3000,  // $30.00/month
      'entire_family': 18500           // $185.00/month
    };
    
    const amount = membershipTypeToPrice[membership.membership_type] || 6500;
    console.log(`✅ Membership type: ${membership.membership_type}`);
    console.log(`   Price: $${(amount / 100).toFixed(2)}/month\n`);
    
    // Step 7: Find or create Stripe price
    console.log('Step 6: Finding or creating Stripe price...');
    let priceId = null;
    const prices = await stripe.prices.list({
      active: true,
      limit: 100
    });
    
    const existingPrice = prices.data.find(p => 
      p.metadata.membership_type === membership.membership_type && 
      p.unit_amount === amount &&
      p.recurring?.interval === 'month'
    );
    
    if (existingPrice) {
      priceId = existingPrice.id;
      console.log(`✅ Using existing price: ${priceId}\n`);
    } else {
      const productName = {
        'standard': 'Standard Gym Membership',
        'immediate_family_member': 'Immediate Family Gym Membership',
        'expecting_or_recovering_mother': 'Expecting/Recovering Mother Gym Membership',
        'entire_family': 'Full Family Gym Membership'
      }[membership.membership_type] || 'Gym Membership';
      
      const price = await stripe.prices.create({
        unit_amount: amount,
        currency: 'usd',
        recurring: {
          interval: 'month'
        },
        product_data: {
          name: productName
        },
        metadata: {
          membership_type: membership.membership_type,
          type: 'gym_membership'
        }
      });
      priceId = price.id;
      console.log(`✅ Created new price: ${priceId}\n`);
    }
    
    // Step 8: Calculate billing cycle anchor (30 days from today)
    console.log('Step 7: Calculating billing cycle anchor...');
    const today = new Date();
    const billingCycleAnchor = new Date(today);
    billingCycleAnchor.setDate(billingCycleAnchor.getDate() + 30);
    billingCycleAnchor.setHours(0, 0, 0, 0); // Set to midnight UTC
    
    const billingCycleAnchorUnix = Math.floor(billingCycleAnchor.getTime() / 1000);
    console.log(`✅ Billing cycle anchor: ${billingCycleAnchor.toLocaleDateString()} (${billingCycleAnchorUnix})\n`);
    
    // Step 9: Create subscription WITHOUT charging
    // Setting billing_cycle_anchor to future date means:
    // - Subscription is active immediately
    // - Current period runs from now until billing_cycle_anchor
    // - No charge until billing_cycle_anchor date
    // Customer was already charged, so subscription should be active now with next charge in 30 days
    console.log('Step 8: Creating subscription...');
    const subscription = await stripe.subscriptions.create({
      customer: CUSTOMER_ID,
      items: [{ price: priceId }],
      default_payment_method: defaultPaymentMethod.id,
      billing_cycle_anchor: billingCycleAnchorUnix, // Next charge in 30 days
      proration_behavior: 'none', // Don't charge for prorated period
      metadata: {
        userId: user.id.toString(),
        membershipId: membership.id.toString(),
        membershipType: membership.membership_type,
        type: 'gym_membership',
        created_manually: 'true',
        reason: 'fix_missing_subscription'
      },
      expand: ['latest_invoice.payment_intent']
    });
    
    console.log(`✅ Subscription created: ${subscription.id}`);
    console.log(`   Status: ${subscription.status}`);
    console.log(`   Current Period Start: ${new Date(subscription.current_period_start * 1000).toLocaleDateString()}`);
    console.log(`   Current Period End: ${new Date(subscription.current_period_end * 1000).toLocaleDateString()}`);
    console.log(`   Billing Cycle Anchor: ${new Date(subscription.billing_cycle_anchor * 1000).toLocaleDateString()}`);
    
    // Check if invoice was created and its status
    if (subscription.latest_invoice) {
      const invoice = typeof subscription.latest_invoice === 'string' 
        ? await stripe.invoices.retrieve(subscription.latest_invoice)
        : subscription.latest_invoice;
      console.log(`   Latest Invoice: ${invoice.id}`);
      console.log(`   Invoice Status: ${invoice.status}`);
      console.log(`   Invoice Amount: $${(invoice.amount_due / 100).toFixed(2)}`);
      if (invoice.amount_due === 0) {
        console.log('   ✅ No charge - invoice is $0.00');
      } else {
        console.log('   ⚠️  WARNING: Invoice has amount due. This should be $0.00.');
      }
    }
    console.log('');
    
    // Step 10: Update database
    console.log('Step 9: Updating database...');
    await db.query(
      db.isPostgres
        ? 'UPDATE gym_memberships SET stripe_subscription_id = $1, stripe_subscription_item_id = $2, billing_period = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4'
        : 'UPDATE gym_memberships SET stripe_subscription_id = ?, stripe_subscription_item_id = ?, billing_period = ?, updated_at = datetime(\'now\') WHERE id = ?',
      [
        subscription.id,
        subscription.items.data[0].id,
        'monthly',
        membership.id
      ]
    );
    
    console.log('✅ Database updated successfully\n');
    
    // Step 11: Verify final state
    console.log('Step 10: Verifying final state...');
    const updatedMembership = await db.queryOne(
      db.isPostgres
        ? 'SELECT * FROM gym_memberships WHERE id = $1'
        : 'SELECT * FROM gym_memberships WHERE id = ?',
      [membership.id]
    );
    
    console.log('✅ Final membership state:');
    console.log(`   Stripe Subscription ID: ${updatedMembership.stripe_subscription_id}`);
    console.log(`   Stripe Subscription Item ID: ${updatedMembership.stripe_subscription_item_id}`);
    console.log(`   Billing Period: ${updatedMembership.billing_period}`);
    console.log(`   Status: ${updatedMembership.status}\n`);
    
    console.log('🎉 Jake Fotu\'s gym membership has been fixed!');
    console.log(`\n📋 Summary:`);
    console.log(`   Customer: ${customer.email || customer.id}`);
    console.log(`   Subscription ID: ${subscription.id}`);
    console.log(`   Next billing date: ${billingCycleAnchor.toLocaleDateString()}`);
    console.log(`   Membership type: ${membership.membership_type}`);
    console.log(`   Monthly price: $${(amount / 100).toFixed(2)}\n`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error fixing membership:', error.message);
    if (error.stack) {
      console.error(error.stack);
    }
    process.exit(1);
  }
}

fixJakeFotuMembership();

