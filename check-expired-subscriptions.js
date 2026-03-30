// Script to query production database for expired subscriptions
const { Client } = require('pg');
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
    // Try IAM authentication token for RDS
    try {
      const authToken = execSync(
        `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT} --region us-east-1 --username ${process.env.DB_USER} 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      if (authToken && authToken.trim() && !authToken.includes('error')) {
        process.env.DB_PASSWORD = authToken.trim();
        console.log('✅ Using AWS IAM authentication token');
      }
    } catch (e) {
      // Try Secrets Manager
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
        // Try Parameter Store
        try {
          const param = execSync(`aws ssm get-parameter --name /stoic-fitness/db-password --region us-east-1 --with-decryption --query Parameter.Value --output text 2>/dev/null`, { encoding: 'utf-8' });
          if (param && param.trim()) {
            process.env.DB_PASSWORD = param.trim();
          }
        } catch (e3) {
          // Password not found in AWS
        }
      }
    }
  } catch (error) {
    // AWS CLI not available or no access
  }
}

async function getExpiredSubscriptions() {
  if (!process.env.DB_PASSWORD) {
    console.error('❌ Production database password required!');
    console.error('');
    console.error('Please set DB_PASSWORD environment variable:');
    console.error('  export DB_PASSWORD=your-password');
    process.exit(1);
  }

  console.log('📊 Connecting to Production Database...');
  console.log('   Host:', process.env.DB_HOST);
  console.log('   Database:', process.env.DB_NAME);
  console.log('   User:', process.env.DB_USER);
  console.log('   Port:', process.env.DB_PORT);
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

    // Query for expired subscriptions (end_date < NOW() and status = 'active')
    const expiredQuery = `
      SELECT 
        s.id as subscription_id,
        s.user_id,
        u.email,
        u.name,
        s.tier,
        s.stripe_customer_id,
        s.stripe_subscription_id,
        s.status,
        s.start_date,
        s.end_date,
        s.created_at,
        CASE 
          WHEN s.end_date < NOW() THEN EXTRACT(EPOCH FROM (NOW() - s.end_date)) / 86400
          ELSE 0
        END as days_expired
      FROM subscriptions s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.status = 'active'
        AND s.end_date < NOW()
      ORDER BY s.end_date ASC
    `;

    console.log('🔍 Querying for expired subscriptions...\n');
    const expiredResult = await client.query(expiredQuery);

    // Query for all active subscriptions to see total count
    const allActiveQuery = `
      SELECT COUNT(*) as total
      FROM subscriptions
      WHERE status = 'active'
    `;
    const allActiveResult = await client.query(allActiveQuery);
    const totalActive = allActiveResult.rows[0].total;

    // Query for subscriptions expiring soon (within 7 days)
    const expiringSoonQuery = `
      SELECT 
        s.id as subscription_id,
        s.user_id,
        u.email,
        u.name,
        s.tier,
        s.stripe_customer_id,
        s.stripe_subscription_id,
        s.status,
        s.start_date,
        s.end_date,
        CASE 
          WHEN s.end_date > NOW() THEN EXTRACT(EPOCH FROM (s.end_date - NOW())) / 86400
          ELSE 0
        END as days_until_expiry
      FROM subscriptions s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.status = 'active'
        AND s.end_date > NOW()
        AND s.end_date <= NOW() + INTERVAL '7 days'
      ORDER BY s.end_date ASC
    `;
    const expiringSoonResult = await client.query(expiringSoonQuery);

    // Query for subscriptions with Stripe subscription IDs (for checking incomplete status)
    const stripeSubscriptionsQuery = `
      SELECT 
        s.id as subscription_id,
        s.user_id,
        u.email,
        u.name,
        s.tier,
        s.stripe_customer_id,
        s.stripe_subscription_id,
        s.status,
        s.end_date
      FROM subscriptions s
      INNER JOIN users u ON s.user_id = u.id
      WHERE s.status = 'active'
        AND s.stripe_subscription_id IS NOT NULL
      ORDER BY s.end_date ASC
    `;
    const stripeSubscriptionsResult = await client.query(stripeSubscriptionsQuery);

    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📊 SUBSCRIPTION SUMMARY');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log(`Total Active Subscriptions: ${totalActive}`);
    console.log(`Expired Subscriptions: ${expiredResult.rows.length}`);
    console.log(`Expiring Soon (within 7 days): ${expiringSoonResult.rows.length}`);
    console.log(`Subscriptions with Stripe IDs: ${stripeSubscriptionsResult.rows.length}`);
    console.log('');

    if (expiredResult.rows.length > 0) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('❌ EXPIRED SUBSCRIPTIONS');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');

      expiredResult.rows.forEach((sub, index) => {
        const daysExpired = Math.floor(sub.days_expired);
        console.log(`${index + 1}. User ID: ${sub.user_id}`);
        console.log(`   Email: ${sub.email}`);
        console.log(`   Name: ${sub.name || 'N/A'}`);
        console.log(`   Tier: ${sub.tier}`);
        console.log(`   Subscription ID: ${sub.subscription_id}`);
        console.log(`   Stripe Customer ID: ${sub.stripe_customer_id || 'N/A'}`);
        console.log(`   Stripe Subscription ID: ${sub.stripe_subscription_id || 'N/A'}`);
        console.log(`   Start Date: ${sub.start_date}`);
        console.log(`   End Date: ${sub.end_date}`);
        console.log(`   Days Expired: ${daysExpired} days`);
        console.log(`   Status: ${sub.status}`);
        console.log('');
      });
    } else {
      console.log('✅ No expired subscriptions found!');
      console.log('');
    }

    if (expiringSoonResult.rows.length > 0) {
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('⚠️  SUBSCRIPTIONS EXPIRING SOON (within 7 days)');
      console.log('═══════════════════════════════════════════════════════════════');
      console.log('');

      expiringSoonResult.rows.forEach((sub, index) => {
        const daysUntilExpiry = Math.floor(sub.days_until_expiry);
        console.log(`${index + 1}. User ID: ${sub.user_id}`);
        console.log(`   Email: ${sub.email}`);
        console.log(`   Name: ${sub.name || 'N/A'}`);
        console.log(`   Tier: ${sub.tier}`);
        console.log(`   Stripe Subscription ID: ${sub.stripe_subscription_id || 'N/A'}`);
        console.log(`   End Date: ${sub.end_date}`);
        console.log(`   Days Until Expiry: ${daysUntilExpiry} days`);
        console.log('');
      });
    }

    // Display summary table
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('📋 EXPIRED SUBSCRIPTIONS SUMMARY TABLE');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('');
    console.log('User ID | Email                          | Tier      | End Date    | Days Expired | Stripe Sub ID');
    console.log('────────┼────────────────────────────────┼───────────┼─────────────┼──────────────┼─────────────────────');
    
    expiredResult.rows.forEach((sub) => {
      const daysExpired = Math.floor(sub.days_expired);
      const email = (sub.email || '').padEnd(30).substring(0, 30);
      const tier = (sub.tier || '').padEnd(11).substring(0, 11);
      const endDate = sub.end_date ? new Date(sub.end_date).toISOString().split('T')[0] : 'N/A';
      const stripeSubId = (sub.stripe_subscription_id || 'N/A').substring(0, 19);
      console.log(`${String(sub.user_id).padStart(7)} | ${email} | ${tier} | ${endDate} | ${String(daysExpired).padStart(13)} | ${stripeSubId}`);
    });

    console.log('');
    console.log('═══════════════════════════════════════════════════════════════');
    console.log('✅ Query complete!');
    console.log('═══════════════════════════════════════════════════════════════');

  } catch (error) {
    console.error('❌ Error querying database:', error);
    throw error;
  } finally {
    await client.end();
  }
}

// Run the query
getExpiredSubscriptions()
  .then(() => {
    console.log('\n✅ Script completed successfully');
    process.exit(0);
  })
  .catch((error) => {
    console.error('\n❌ Script failed:', error);
    process.exit(1);
  });




