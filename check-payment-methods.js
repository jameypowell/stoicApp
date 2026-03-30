// Script to check if existing customers have payment methods saved in Stripe
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

async function checkPaymentMethods() {
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

  console.log('📊 Checking Payment Methods for Existing Customers');
  console.log('═══════════════════════════════════════════════════════════════');
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

    // Get all users with Stripe customer IDs and active subscriptions for tier_two, tier_three, tier_four
    const query = `
      SELECT DISTINCT
        u.id as user_id,
        u.email,
        u.name,
        u.role,
        s.tier,
        s.status as subscription_status,
        s.stripe_customer_id,
        s.stripe_subscription_id,
        s.end_date
      FROM users u
      INNER JOIN subscriptions s ON u.id = s.user_id
      WHERE u.role = 'user'
        AND s.tier IN ('tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')
        AND s.stripe_customer_id IS NOT NULL
        AND s.status = 'active'
      ORDER BY u.email
    `;

    const result = await client.query(query);
    const customers = result.rows;

    console.log(`Found ${customers.length} customers with Stripe customer IDs\n`);

    if (customers.length === 0) {
      console.log('No customers found to check.');
      await client.end();
      return;
    }

    // Statistics
    let totalChecked = 0;
    let withPaymentMethods = 0;
    let withDefaultPaymentMethod = 0;
    let withoutPaymentMethods = 0;
    let subscriptionActive = 0;
    let subscriptionPastDue = 0;
    let subscriptionIncomplete = 0;
    let subscriptionOther = 0;

    const details = [];

    for (const customer of customers) {
      totalChecked++;
      
      try {
        // Get customer from Stripe
        const stripeCustomer = await stripe.customers.retrieve(customer.stripe_customer_id);
        
        // Check for payment methods
        const paymentMethods = await stripe.paymentMethods.list({
          customer: customer.stripe_customer_id,
          type: 'card'
        });

        const hasPaymentMethods = paymentMethods.data.length > 0;
        const defaultPaymentMethod = stripeCustomer.invoice_settings?.default_payment_method;
        const hasDefault = !!defaultPaymentMethod;

        // Check subscription status if they have one
        let stripeSubscriptionStatus = null;
        if (customer.stripe_subscription_id) {
          try {
            const stripeSub = await stripe.subscriptions.retrieve(customer.stripe_subscription_id);
            stripeSubscriptionStatus = stripeSub.status;
            
            if (stripeSub.status === 'active') subscriptionActive++;
            else if (stripeSub.status === 'past_due') subscriptionPastDue++;
            else if (stripeSub.status === 'incomplete' || stripeSub.status === 'incomplete_expired') subscriptionIncomplete++;
            else subscriptionOther++;
          } catch (subError) {
            stripeSubscriptionStatus = 'not_found';
          }
        }

        if (hasPaymentMethods) withPaymentMethods++;
        if (hasDefault) withDefaultPaymentMethod++;
        if (!hasPaymentMethods) withoutPaymentMethods++;

        // Get payment method details if available
        let paymentMethodDetails = null;
        if (hasDefault) {
          try {
            const pm = await stripe.paymentMethods.retrieve(defaultPaymentMethod);
            paymentMethodDetails = {
              type: pm.type,
              card: pm.card ? {
                brand: pm.card.brand,
                last4: pm.card.last4,
                exp_month: pm.card.exp_month,
                exp_year: pm.card.exp_year
              } : null
            };
          } catch (pmError) {
            // Payment method might have been deleted
          }
        } else if (hasPaymentMethods && paymentMethods.data.length > 0) {
          // Use first payment method if no default
          const pm = paymentMethods.data[0];
          paymentMethodDetails = {
            type: pm.type,
            card: pm.card ? {
              brand: pm.card.brand,
              last4: pm.card.last4,
              exp_month: pm.card.exp_month,
              exp_year: pm.card.exp_year
            } : null
          };
        }

        details.push({
          email: customer.email,
          name: customer.name,
          tier: customer.tier,
          hasPaymentMethods,
          hasDefault,
          paymentMethodCount: paymentMethods.data.length,
          defaultPaymentMethod: defaultPaymentMethod || 'NONE',
          paymentMethodDetails,
          stripeSubscriptionStatus,
          subscriptionEndDate: customer.end_date
        });

      } catch (error) {
        console.error(`Error checking customer ${customer.email}:`, error.message);
        details.push({
          email: customer.email,
          name: customer.name,
          tier: customer.tier,
          error: error.message
        });
      }
    }

    // Print summary
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Total Customers Checked: ${totalChecked}`);
    console.log(`With Payment Methods: ${withPaymentMethods} (${((withPaymentMethods/totalChecked)*100).toFixed(1)}%)`);
    console.log(`With Default Payment Method: ${withDefaultPaymentMethod} (${((withDefaultPaymentMethod/totalChecked)*100).toFixed(1)}%)`);
    console.log(`Without Payment Methods: ${withoutPaymentMethods} (${((withoutPaymentMethods/totalChecked)*100).toFixed(1)}%)`);
    console.log('');
    console.log('Subscription Status (Stripe):');
    console.log(`  Active: ${subscriptionActive}`);
    console.log(`  Past Due: ${subscriptionPastDue}`);
    console.log(`  Incomplete/Expired: ${subscriptionIncomplete}`);
    console.log(`  Other: ${subscriptionOther}`);
    console.log('');

    // Print detailed results
    console.log('════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════════ off');
    console.log('📋 DETAILED RESULTS');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');

    details.forEach((detail, index) => {
      console.log(`${index + 1}. ${detail.email}`);
      if (detail.name) console.log(`   Name: ${detail.name}`);
      console.log(`   Tier: ${detail.tier}`);
      
      if (detail.error) {
        console.log(`   ❌ Error: ${detail.error}`);
      } else {
        console.log(`   Payment Methods: ${detail.hasPaymentMethods ? `✅ ${detail.paymentMethodCount} found` : '❌ None'}`);
        console.log(`   Default Payment Method: ${detail.hasDefault ? '✅ Set' : '❌ Not Set'}`);
        
        if (detail.paymentMethodDetails) {
          if (detail.paymentMethodDetails.card) {
            const card = detail.paymentMethodDetails.card;
            console.log(`   Card: ${card.brand.toUpperCase()} ****${card.last4} (exp: ${card.exp_month}/${card.exp_year})`);
          }
        }
        
        if (detail.stripeSubscriptionStatus) {
          const statusEmoji = detail.stripeSubscriptionStatus === 'active' ? '✅' : 
                             detail.stripeSubscriptionStatus === 'past_due' ? '⚠️' : 
                             detail.stripeSubscriptionStatus === 'incomplete' || detail.stripeSubscriptionStatus === 'incomplete_expired' ? '❌' : 'ℹ️';
          console.log(`   Stripe Subscription: ${statusEmoji} ${detail.stripeSubscriptionStatus}`);
        }
        
        if (detail.subscriptionEndDate) {
          const endDate = new Date(detail.subscriptionEndDate);
          const now = new Date();
          const isExpired = endDate < now;
          console.log(`   Subscription End: ${endDate.toISOString().split('T')[0]} ${isExpired ? '❌ EXPIRED' : '✅ Active'}`);
        }
      }
      console.log('');
    });

    // List customers who need payment methods
    const needPaymentMethods = details.filter(d => !d.error && !d.hasDefault);
    if (needPaymentMethods.length > 0) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('⚠️  CUSTOMERS NEEDING PAYMENT METHODS');
      console.log('═══════════════════════════════════════════════════════════════');
      needPaymentMethods.forEach((customer, index) => {
        console.log(`${index + 1}. ${customer.email} (${customer.tier})`);
      });
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ Check complete!');
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error:', error);
    throw error;
  } finally {
    await client.end();
  }
}

checkPaymentMethods()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });




