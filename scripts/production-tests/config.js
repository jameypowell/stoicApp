/**
 * Production test configuration
 * Set via environment variables - see README.md for required vars.
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env'), override: true });

const config = {
  // Production API base URL (required for API and webhook tests)
  prodUrl: process.env.PROD_URL || process.env.PRODUCTION_API_BASE?.replace(/\/api$/, '') || 'https://app.stoic-fit.com',

  // Database (optional - for direct DB tests; if not set, DB tests will skip)
  db: process.env.DB_HOST ? {
    host: process.env.DB_HOST,
    port: parseInt(process.env.DB_PORT || '5432', 10),
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  } : null,

  // Stripe (optional - for direct Stripe API tests; uses STRIPE_SECRET_KEY from env)
  stripeSecretKey: process.env.STRIPE_SECRET_KEY,

  // Test user for auth-gated endpoints (optional - register creates ephemeral user)
  testUserEmail: process.env.PROD_TEST_EMAIL,
  testUserPassword: process.env.PROD_TEST_PASSWORD,

  // Timeouts
  timeoutMs: parseInt(process.env.PROD_TEST_TIMEOUT_MS || '15000', 10)
};

module.exports = config;
