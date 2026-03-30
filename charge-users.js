// Script to charge specific users and reset their expiration dates
const { Client } = require('pg');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
require('dotenv').config();

// Production database credentials
process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
process.env.DB_USER = process.env.DB_USER || 'stoicapp';
process.env.DB_NAME = process.env.DB_NAME || 'postgres';
process.env.DB_PORT = process.env.DB_PORT || '5432';
process.env.DB_SSL = process.env.DB_SSL !== 'false' ? 'true' : 'false';

// Try to get password from AWS if not set
if (!process.env.DB_PASSWORD) {
  const { execSync } = require('child_process');
  try {
    try {
      const authToken = execSync(
        `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT} --region us-east-1 --username ${process.env.DB_USER} 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      if (authToken && authToken.trim() && !authToken.includes('error')) {
        process.env.DB_PASSWORD = authToken.trim();
      }
    } catch (e) {
      try {
        const secretName = process.env.DB_SECRET_NAME || 'stoic-fitness-db-password';
        const secret = execSync(`aws secretsmanager get-secret-value --secret-id ${secretName} --region us-east-1 --query SecretString --output text 2>/dev/null`, { encoding: 'utf-8' });
        if (secret && secret.trim() && !secret.includes('error')) {
          try {
            const parsed = JSON.parse(secret);
            process.env.DB_PASSWORD = parsed.password || parsed.DB_PASSWORD || secret.trim();
          } catch {
            process.env.DB_PASSWORD = secret.trim();
          }
        }
      } catch (e2) {
        try {
          const param = execSync(`aws ssm get-parameter --name /stoic-fitness/db-password --region us-east-1 --with-decryption --query Parameter.Value --output text 2>/dev/null`, { encoding: 'utf-8' });
          if (param && param.trim()) {
            process.env.DB_PASSWORD = param.trim();
          }
        } catch (e3) {
          // Password not found
        }
      }
    }
  } catch (error) {
    // AWS CLI not available
  }
}

// Tier pricing in cents
const TIER_PRICING = {
  tier_one: 0,
  tier_two: 700,   // $7.00/month
  tier_three: 1200, // $12.00/month
  tier_four: 1800   // $18.00/month
};

// Normalize tier names
function normalizeTier(tier) {
  if (!tier) return tier;
  const legacyMap = {
    'daily': 'tier_two',
    'weekly': 'tier_three',
    'monthly': 'tier_four'
  };
  return legacyMap[tier] || tier;
}

async function chargeUsers(emails) {
  if (!process.env.DB_PASSWORD) {
    console.error('❌ Production database password required!');
    console.error('Please set DB_PASSWORD environment variable');
    process.exit(1);
  }

  if (!process.env.STRIPE_SECRET_KEY) {
    console.error('❌ Stripe secret key required!');
    console.error('Please set STRIPE_SECRET_KEY environment variable');
    process.exit(1);
  }

  console.log('📊 Connecting to Production Database...');
  console.log('   Host:', process.env.DB_HOST);
  console.log('   Database:', process.env.DB_NAME);
  console.log('   User:', process.env.DB_USER);
  console.log('');

  const client = new Client({
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT),
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? {
      rejectUnauthorized: false
    } : false
  });

  try {
    await client.connect();
    console.log('✅ Connected to production database\n');

    // Calculate new expiration date (30 days from today)
    const newEndDate = new Date();
    newEndDate.setDate(newEndDate.getDate() + 30);
    const newEndDateISO = newEndDate.toISOString();

    console.log('📅 New expiration date will be:', newEndDateISO);
    console.log('');

    for (const email of emails) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log(`Processing: ${email}`);
      console.log('═══════════════════════════════════════════════════════════════');

      // Find user and their active subscription
      const userQuery = `
        SELECT u.id as user_id, u.email, u.name,
               s.id as subscription_id, s.tier, s.stripe_customer_id, 
               s.stripe_subscription_id, s.status, s.end_date
        FROM users u
        LEFT JOIN subscriptions s ON u.id = s.user_id AND s.status = 'active'
        WHERE u.email = $1
        ORDER BY s.id DESC
        LIMIT 1
      `;

      const userResult = await client.query(userQuery, [email]);

      if (userResult.rows.length === 0) {
        console.log(`❌ User not found: ${email}`);
        console.log('');
        continue;
      }

      const user = userResult.rows[0];
      console.log(`✅ Found user: ${user.name || 'N/A'} (ID: ${user.user_id})`);

      if (!user.subscription_id) {
        console.log(`⚠️  No active subscription found for ${email}`);
        console.log('');
        continue;
      }

      console.log(`   Current Tier: ${user.tier}`);
      console.log(`   Current End Date: ${user.end_date}`);
      console.log(`   Stripe Customer ID: ${user.stripe_customer_id || 'N/A'}`);
      console.log(`   Stripe Subscription ID: ${user.stripe_subscription_id || 'N/A'}`);
      console.log('');

      const normalizedTier = normalizeTier(user.tier);
      const price = TIER_PRICING[normalizedTier] || 0;

      // If user has a Stripe subscription ID, try to charge via Stripe
      if (user.stripe_subscription_id) {
        try {
          console.log(`   Attempting to charge via Stripe subscription...`);
          
          // Get subscription from Stripe
          const stripeSubscription = await stripe.subscriptions.retrieve(user.stripe_subscription_id);
          
          // Check if there's an open invoice
          if (stripeSubscription.latest_invoice) {
            const invoice = await stripe.invoices.retrieve(stripeSubscription.latest_invoice);
            
            if (invoice.status === 'open' || invoice.status === 'draft') {
              try {
                // Try to pay the invoice
                await stripe.invoices.pay(invoice.id);
                console.log(`   ✅ Successfully paid invoice ${invoice.id}`);
              } catch (payError) {
                console.log(`   ⚠️  Could not pay invoice automatically: ${payError.message}`);
                console.log(`   Creating new invoice item and charging...`);
                
                // Create invoice item and finalize invoice
                await stripe.invoiceItems.create({
                  customer: user.stripe_customer_id,
                  amount: price,
                  currency: 'usd',
                  description: `Subscription renewal - ${normalizedTier}`
                });
                
                // Create and pay invoice
                const newInvoice = await stripe.invoices.create({
                  customer: user.stripe_customer_id,
                  auto_advance: true
                });
                
                try {
                  await stripe.invoices.pay(newInvoice.id);
                  console.log(`   ✅ Successfully charged via new invoice ${newInvoice.id}`);
                } catch (newPayError) {
                  console.log(`   ⚠️  Could not auto-pay new invoice: ${newPayError.message}`);
                  console.log(`   Invoice ${newInvoice.id} created but requires manual payment`);
                }
              }
            } else if (invoice.status === 'paid') {
              console.log(`   ℹ️  Latest invoice already paid`);
            } else {
              console.log(`   ℹ️  Invoice status: ${invoice.status}`);
            }
          }

          // Update subscription period in Stripe if needed
          if (stripeSubscription.status === 'active' || stripeSubscription.status === 'past_due') {
            // Update subscription to extend period
            await stripe.subscriptions.update(user.stripe_subscription_id, {
              billing_cycle_anchor: Math.floor(newEndDate.getTime() / 1000),
              proration_behavior: 'none'
            });
            console.log(`   ✅ Updated Stripe subscription billing cycle`);
          }

        } catch (stripeError) {
          console.log(`   ⚠️  Stripe error: ${stripeError.message}`);
          console.log(`   Will update database expiration date anyway...`);
        }
      } else if (user.stripe_customer_id && price > 0) {
        // User has Stripe customer but no subscription - create invoice
        try {
          console.log(`   Creating invoice for customer...`);
          
          await stripe.invoiceItems.create({
            customer: user.stripe_customer_id,
            amount: price,
            currency: 'usd',
            description: `Subscription renewal - ${normalizedTier}`
          });
          
          const invoice = await stripe.invoices.create({
            customer: user.stripe_customer_id,
            auto_advance: true
          });
          
          try {
            await stripe.invoices.pay(invoice.id);
            console.log(`   ✅ Successfully charged via invoice ${invoice.id}`);
          } catch (payError) {
            console.log(`   ⚠️  Could not auto-pay invoice: ${payError.message}`);
            console.log(`   Invoice ${invoice.id} created but requires manual payment`);
          }
        } catch (invoiceError) {
          console.log(`   ⚠️  Could not create invoice: ${invoiceError.message}`);
        }
      } else {
        console.log(`   ℹ️  No Stripe customer/subscription found - updating expiration date only`);
      }

      // Update expiration date in database
      const updateQuery = `
        UPDATE subscriptions
        SET end_date = $1
        WHERE id = $2
      `;

      await client.query(updateQuery, [newEndDateISO, user.subscription_id]);
      console.log(`   ✅ Updated expiration date to: ${newEndDateISO}`);
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ All users processed!');
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Get emails from command line arguments or use default list
const emails = process.argv.slice(2).length > 0 
  ? process.argv.slice(2)
  : [
      'jtoddwhitephd@gmail.com',
      'jbnielson16@gmail.com',
      'streetkylee@gmail.com'
    ];

console.log('💰 Charging Users and Resetting Expiration Dates');
console.log('═══════════════════════════════════════════════════════════════');
console.log('Users to process:');
emails.forEach((email, index) => {
  console.log(`  ${index + 1}. ${email}`);
});
console.log('');

chargeUsers(emails)
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });




