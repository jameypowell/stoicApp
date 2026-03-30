#!/usr/bin/env node

/**
 * Production test runner
 * Runs all production tests: API, DB, Stripe, Webhooks.
 *
 * Usage:
 *   node scripts/production-tests/index.js
 *   PROD_URL=https://app.stoic-fit.com node scripts/production-tests/index.js
 *   PROD_URL=... DB_HOST=... DB_USER=... DB_PASSWORD=... node scripts/production-tests/index.js
 *
 * Environment variables:
 *   PROD_URL          - Production API base (default: https://app.stoic-fit.com)
 *   DB_HOST, DB_USER, DB_PASSWORD - For direct DB tests (optional)
 *   STRIPE_SECRET_KEY - For Stripe API tests (optional)
 *   PROD_TEST_EMAIL, PROD_TEST_PASSWORD - Existing test user (optional; register creates ephemeral)
 */

const config = require('./config');
const { run } = require('./runner');
const { apiTests } = require('./api');
const { dbTests } = require('./db');
const { stripeTests } = require('./stripe');
const { webhookTests } = require('./webhooks');

const suites = [
  { name: 'API', tests: apiTests },
  { name: 'Database', tests: dbTests },
  { name: 'Stripe', tests: stripeTests },
  { name: 'Webhooks', tests: webhookTests }
];

async function main() {
  console.log('\n========================================');
  console.log('  Production Tests');
  console.log('========================================');
  console.log('  PROD_URL:', config.prodUrl);
  console.log('  DB:', config.db ? 'configured' : 'skipped (no DB_HOST)');
  console.log('  Stripe:', config.stripeSecretKey ? 'configured' : 'skipped (no STRIPE_SECRET_KEY)');
  console.log('========================================\n');

  let totalPassed = 0;
  let totalFailed = 0;

  for (const { name, tests } of suites) {
    const suite = tests();
    const { passed, failed, results } = await run(suite);

    console.log('--- ' + name + ' ---');
    for (const r of results) {
      const icon = r.ok ? '\u2713' : '\u2717';
      const color = r.ok ? '\x1b[32m' : '\x1b[31m';
      const reset = '\x1b[0m';
      console.log('  ' + color + icon + ' ' + r.name + reset);
      if (!r.ok && r.error) {
        console.log('      ' + r.error);
      }
    }
    console.log('  ' + passed + ' passed, ' + failed + ' failed\n');

    totalPassed += passed;
    totalFailed += failed;
  }

  console.log('========================================');
  console.log('  Total: ' + totalPassed + ' passed, ' + totalFailed + ' failed');
  console.log('========================================\n');

  process.exit(totalFailed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
