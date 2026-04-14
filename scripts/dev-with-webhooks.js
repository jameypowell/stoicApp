#!/usr/bin/env node
/**
 * Dev script that runs the server + Stripe webhook listener together.
 * Use this for local development when testing payments (subscriptions, drop-in, etc).
 * Captures webhook secret from stripe listen and passes it to the server.
 *
 * Requires: Stripe CLI installed and logged in.
 * Run: npm run dev
 */
const { spawn } = require('child_process');
const path = require('path');

require('dotenv').config({ path: path.join(__dirname, '..', '.env'), override: true });

const PORT = process.env.PORT || 3000;

// Ensure dev mode
process.env.NODE_ENV = 'development';

let serverProcess = null;
let stripeListenProcess = null;

function startServer(webhookSecret) {
  if (serverProcess) return;
  const env = { ...process.env };
  if (webhookSecret) env.STRIPE_WEBHOOK_SECRET = webhookSecret;
  serverProcess = spawn('npx', ['nodemon', path.join(__dirname, '..', 'server.js')], {
    stdio: 'inherit',
    env,
    cwd: path.join(__dirname, '..'),
    shell: true
  });
}

function runStripeListen() {
  stripeListenProcess = spawn('stripe', [
    'listen',
    '--forward-to',
    `http://localhost:${PORT}/api/webhooks/stripe`
  ], {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  stripeListenProcess.stdout.on('data', (data) => {
    const str = data.toString();
    process.stdout.write(str);
    if (str.includes('whsec_')) {
      const match = str.match(/whsec_[a-zA-Z0-9]+/);
      if (match) {
        const secret = match[0];
        console.log('\n[dev] Captured Stripe webhook secret, starting server...\n');
        startServer(secret);
      }
    }
  });

  stripeListenProcess.stderr.on('data', (data) => process.stderr.write(data.toString()));
  stripeListenProcess.on('error', () => {
    console.error('\n[dev] Stripe CLI required for local payment testing.');
    console.error('');
    console.error('  Install:  brew install stripe/stripe-cli/stripe');
    console.error('  Then:     stripe login');
    console.error('');
    console.error('  For server-only (no webhooks): npm run dev:server');
    console.error('');
    process.exit(1);
  });
  stripeListenProcess.on('exit', (code) => {
    if (code !== 0 && code !== null) {
      process.exit(code);
    }
  });

  // Fail if we never captured the secret (stripe listen may have exited)
  setTimeout(() => {
    if (!serverProcess) {
      console.error('\n[dev] Could not capture Stripe webhook secret. Ensure Stripe CLI is installed and you have run: stripe login\n');
      process.exit(1);
    }
  }, 15000);
}

// Pre-flight: Stripe keys
const hasStripeKeys = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY;
if (!hasStripeKeys) {
  console.error('[dev] STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY must be set in .env for development.');
  process.exit(1);
}

// Pre-flight: Stripe CLI (fail fast with clear message)
try {
  require('child_process').execSync('which stripe', { stdio: 'ignore' });
} catch {
  console.error('\n[dev] Stripe CLI required for local payment testing.');
  console.error('');
  console.error('  Install:  brew install stripe/stripe-cli/stripe');
  console.error('  Then:     stripe login');
  console.error('');
  console.error('  For server-only (no webhooks): npm run dev:server');
  console.error('');
  process.exit(1);
}

runStripeListen();

process.on('SIGINT', () => {
  if (stripeListenProcess) stripeListenProcess.kill('SIGINT');
  if (serverProcess) serverProcess.kill('SIGINT');
  process.exit(0);
});
process.on('SIGTERM', () => {
  if (stripeListenProcess) stripeListenProcess.kill('SIGTERM');
  if (serverProcess) serverProcess.kill('SIGTERM');
  process.exit(0);
});
