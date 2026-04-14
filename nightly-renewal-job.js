// Nightly job to charge expired subscriptions
// Runs at 1AM Mountain Time daily
const { initDatabase, Database } = require('./database');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const cron = require('node-cron');
require('dotenv').config();

// Tier pricing in cents
const TIER_PRICING = {
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

// Calculate new expiration date (30 days from today)
function calculateNewEndDate() {
  const endDate = new Date();
  endDate.setDate(endDate.getDate() + 30);
  endDate.setHours(23, 59, 59, 999); // End of day
  return endDate.toISOString();
}

// Charge a single user for their expired subscription
async function chargeExpiredSubscription(user, subscription, db) {
  try {
    const normalizedTier = normalizeTier(subscription.tier);
    const price = TIER_PRICING[normalizedTier];

    if (!price || price === 0) {
      console.log(`  ⚠️  Skipping ${user.email}: Invalid tier ${subscription.tier} (no price)`);
      return { success: false, reason: 'invalid_tier' };
    }

    // Check if user has Stripe customer ID
    if (!subscription.stripe_customer_id) {
      console.log(`  ⚠️  Skipping ${user.email}: No Stripe customer ID`);
      return { success: false, reason: 'no_stripe_customer' };
    }

    // Check if customer has a default payment method
    let hasPaymentMethod = false;
    try {
      const customer = await stripe.customers.retrieve(subscription.stripe_customer_id);
      hasPaymentMethod = !!customer.invoice_settings?.default_payment_method;
      
      // If no default, check if any payment methods exist
      if (!hasPaymentMethod) {
        const paymentMethods = await stripe.paymentMethods.list({
          customer: subscription.stripe_customer_id,
          type: 'card'
        });
        hasPaymentMethod = paymentMethods.data.length > 0;
        
        // If payment methods exist but no default, set the first one as default
        if (hasPaymentMethod && paymentMethods.data.length > 0) {
          await stripe.customers.update(subscription.stripe_customer_id, {
            invoice_settings: {
              default_payment_method: paymentMethods.data[0].id
            }
          });
          console.log(`  ✅ Set default payment method for ${user.email}`);
        }
      }
    } catch (stripeError) {
      console.log(`  ❌ Error checking payment method for ${user.email}: ${stripeError.message}`);
      return { success: false, reason: 'stripe_error', error: stripeError.message };
    }

    if (!hasPaymentMethod) {
      console.log(`  ⚠️  Skipping ${user.email}: No payment method available`);
      return { success: false, reason: 'no_payment_method' };
    }

    // Create invoice item and invoice
    try {
      // Create invoice item
      await stripe.invoiceItems.create({
        customer: subscription.stripe_customer_id,
        amount: price,
        currency: 'usd',
        description: `Subscription renewal - ${normalizedTier} (${subscription.tier})`
      });

      // Create and finalize invoice
      const invoice = await stripe.invoices.create({
        customer: subscription.stripe_customer_id,
        auto_advance: true // Automatically finalize and attempt payment
      });

      // Try to pay the invoice
      try {
        const paidInvoice = await stripe.invoices.pay(invoice.id);
        
        if (paidInvoice.status === 'paid') {
          // Update expiration date in database
          const newEndDate = calculateNewEndDate();
          await db.updateSubscription(subscription.id, {
            end_date: newEndDate,
            status: 'active'
          });

          console.log(`  ✅ Charged ${user.email} $${(price / 100).toFixed(2)} - Invoice ${invoice.id}`);
          console.log(`     New expiration date: ${newEndDate}`);
          
          return { 
            success: true, 
            invoiceId: invoice.id, 
            amount: price,
            newEndDate 
          };
        } else {
          console.log(`  ⚠️  Invoice ${invoice.id} created but not paid (status: ${paidInvoice.status})`);
          return { success: false, reason: 'invoice_not_paid', invoiceId: invoice.id };
        }
      } catch (payError) {
        console.log(`  ⚠️  Could not auto-pay invoice ${invoice.id} for ${user.email}: ${payError.message}`);
        return { success: false, reason: 'payment_failed', invoiceId: invoice.id, error: payError.message };
      }
    } catch (invoiceError) {
      console.log(`  ❌ Error creating invoice for ${user.email}: ${invoiceError.message}`);
      return { success: false, reason: 'invoice_creation_failed', error: invoiceError.message };
    }
  } catch (error) {
    console.error(`  ❌ Unexpected error charging ${user.email}:`, error);
    return { success: false, reason: 'unexpected_error', error: error.message };
  }
}

// Main job function
async function runNightlyRenewalJob() {
  const startTime = new Date();
  console.log('═══════════════════════════════════════════════════════════════');
  console.log('🌙 NIGHTLY SUBSCRIPTION RENEWAL JOB');
  console.log('═══════════════════════════════════════════════════════════════');
  console.log(`Started at: ${startTime.toISOString()}`);
  console.log('');

  let dbConnection;
  let db;

  try {
    // Initialize database
    dbConnection = await initDatabase();
    db = new Database(dbConnection);
    console.log('✅ Connected to database\n');

    // Find all expired subscriptions for users with role='user' and tier in (tier_two, tier_three, tier_four)
    const query = db.isPostgres
      ? `
        SELECT 
          u.id as user_id,
          u.email,
          u.name,
          u.role,
          s.id as subscription_id,
          s.tier,
          s.stripe_customer_id,
          s.stripe_subscription_id,
          s.status,
          s.end_date,
          CASE 
            WHEN s.end_date < NOW() THEN EXTRACT(EPOCH FROM (NOW() - s.end_date)) / 86400
            ELSE 0
          END as days_expired
        FROM users u
        INNER JOIN subscriptions s ON u.id = s.user_id
        WHERE u.role = 'user'
          AND s.tier IN ('tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')
          AND s.status = 'active'
          AND (s.stripe_subscription_id IS NULL OR TRIM(s.stripe_subscription_id::text) = '')
          AND s.end_date < NOW()
        ORDER BY s.end_date ASC
      `
      : `
        SELECT 
          u.id as user_id,
          u.email,
          u.name,
          u.role,
          s.id as subscription_id,
          s.tier,
          s.stripe_customer_id,
          s.stripe_subscription_id,
          s.status,
          s.end_date,
          CASE 
            WHEN s.end_date < datetime('now') THEN (julianday('now') - julianday(s.end_date))
            ELSE 0
          END as days_expired
        FROM users u
        INNER JOIN subscriptions s ON u.id = s.user_id
        WHERE u.role = 'user'
          AND s.tier IN ('tier_two', 'tier_three', 'tier_four', 'daily', 'weekly', 'monthly')
          AND s.status = 'active'
          AND (s.stripe_subscription_id IS NULL OR TRIM(s.stripe_subscription_id) = '')
          AND s.end_date < datetime('now')
        ORDER BY s.end_date ASC
      `;

    const result = await db.query(query);
    const expiredSubscriptions = result.rows || [];
    console.log(`Found ${expiredSubscriptions.length} expired subscriptions to process\n`);

    if (expiredSubscriptions.length === 0) {
      console.log('✅ No expired subscriptions found. Job complete.');
      console.log('═══════════════════════════════════════════════════════════════');
      return;
    }

    // Statistics
    let totalProcessed = 0;
    let successful = 0;
    let failed = 0;
    const failures = [];

    // Process each expired subscription
    for (const sub of expiredSubscriptions) {
      totalProcessed++;
      const daysExpired = Math.floor(sub.days_expired || 0);
      
      console.log(`${totalProcessed}. Processing: ${sub.email}`);
      console.log(`   Tier: ${sub.tier}`);
      console.log(`   Days Expired: ${daysExpired}`);
      console.log(`   Stripe Customer: ${sub.stripe_customer_id || 'N/A'}`);

      const user = {
        id: sub.user_id,
        email: sub.email,
        name: sub.name,
        role: sub.role
      };

      const subscription = {
        id: sub.subscription_id,
        tier: sub.tier,
        stripe_customer_id: sub.stripe_customer_id,
        stripe_subscription_id: sub.stripe_subscription_id,
        status: sub.status,
        end_date: sub.end_date
      };

      const result = await chargeExpiredSubscription(user, subscription, db);

      if (result.success) {
        successful++;
      } else {
        failed++;
        failures.push({
          email: sub.email,
          reason: result.reason,
          error: result.error
        });
      }

      console.log(''); // Blank line between users
    }

    // Print summary
    const endTime = new Date();
    const duration = ((endTime - startTime) / 1000).toFixed(2);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 JOB SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Total Processed: ${totalProcessed}`);
    console.log(`✅ Successful: ${successful}`);
    console.log(`❌ Failed: ${failed}`);
    console.log(`Duration: ${duration}s`);
    console.log('');

    if (failures.length > 0) {
      console.log('Failed Charges:');
      failures.forEach((failure, index) => {
        console.log(`  ${index + 1}. ${failure.email} - ${failure.reason}${failure.error ? ` (${failure.error})` : ''}`);
      });
      console.log('');
    }

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ Job completed');
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Fatal error in nightly renewal job:', error);
    throw error;
  } finally {
    if (dbConnection) {
      if (dbConnection.end) {
        await dbConnection.end();
      } else if (dbConnection.close) {
        dbConnection.close();
      }
    }
  }
}

// Schedule the job to run at 1AM Mountain Time daily
// Mountain Time is UTC-7 (MST) or UTC-6 (MDT)
// 1AM MST = 8AM UTC, 1AM MDT = 7AM UTC
// Using 8AM UTC (1AM MST) - adjust if needed for MDT
// Cron format: minute hour day month day-of-week
// '0 8 * * *' = 8:00 AM UTC daily (1:00 AM MST)
function startScheduledJob() {
  console.log('🕐 Starting nightly renewal job scheduler...');
  console.log('   Schedule: Daily at 1:00 AM Mountain Time (8:00 AM UTC)');
  console.log('');

  // Schedule job to run at 8:00 AM UTC (1:00 AM MST)
  // Note: This doesn't account for daylight saving time automatically
  // You may want to adjust this or use a timezone-aware cron library
  cron.schedule('0 8 * * *', async () => {
    try {
      await runNightlyRenewalJob();
    } catch (error) {
      console.error('❌ Error in scheduled job:', error);
    }
  }, {
    scheduled: true,
    timezone: 'America/Denver' // Mountain Time timezone
  });

  console.log('✅ Nightly renewal job scheduled successfully');
  console.log('   Job will run automatically at 1:00 AM Mountain Time each day');
  console.log('');
}

// If running as a standalone script, run immediately and then schedule
if (require.main === module) {
  // Check if we should run immediately (for testing)
  const runNow = process.argv.includes('--run-now') || process.argv.includes('--test');
  
  if (runNow) {
    console.log('🧪 Running job immediately (test mode)...\n');
    runNightlyRenewalJob()
      .then(() => {
        console.log('\n✅ Test run completed');
        process.exit(0);
      })
      .catch((error) => {
        console.error('\n❌ Test run failed:', error);
        process.exit(1);
      });
  } else {
    // Start the scheduler
    startScheduledJob();
    
    // Keep the process running
    console.log('⏳ Job scheduler is running. Press Ctrl+C to stop.');
    process.on('SIGINT', () => {
      console.log('\n\n🛑 Stopping job scheduler...');
      process.exit(0);
    });
  }
}

module.exports = { runNightlyRenewalJob, startScheduledJob };

