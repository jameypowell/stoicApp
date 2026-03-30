#!/usr/bin/env node
/**
 * Charge a gym member's saved payment method via production API (admin only).
 * Usage: node scripts/charge-member-now.js [email]
 *        ADMIN_TOKEN=<jwt> node scripts/charge-member-now.js fotujacob@gmail.com
 *        Or set ADMIN_EMAIL and ADMIN_PASSWORD in .env to login and get a token.
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const email = process.argv[2] || process.env.CHARGE_EMAIL || 'fotujacob@gmail.com';
const API_BASE = process.env.API_URL || process.env.PRODUCTION_URL
  ? `${(process.env.API_URL || process.env.PRODUCTION_URL).replace(/\/$/, '')}/api`
  : 'https://app.stoic-fit.com/api';

async function getToken() {
  if (process.env.ADMIN_TOKEN) return process.env.ADMIN_TOKEN;
  if (process.env.ADMIN_EMAIL && process.env.ADMIN_PASSWORD) {
    const res = await fetch(`${API_BASE}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        email: process.env.ADMIN_EMAIL,
        password: process.env.ADMIN_PASSWORD
      })
    });
    if (!res.ok) throw new Error('Login failed: ' + (await res.text()));
    const data = await res.json();
    if (!data.token) throw new Error('No token in login response');
    return data.token;
  }
  return null;
}

async function main() {
  const token = await getToken();
  if (!token) {
    console.error('No admin credentials. Set one of:');
    console.error('  ADMIN_TOKEN=<jwt>');
    console.error('  ADMIN_EMAIL and ADMIN_PASSWORD');
    console.error('Then run: node scripts/charge-member-now.js ' + email);
    process.exit(1);
  }
  console.log('Charging', email, 'via', API_BASE);
  const res = await fetch(`${API_BASE}/admin/gym-memberships/charge-now`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`
    },
    body: JSON.stringify({ email })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error('Charge failed:', res.status, data.error || data);
    process.exit(1);
  }
  console.log('Success:', data.message || data);
  console.log('  Amount:', data.amount, data.currency);
  console.log('  New contract end:', data.newContractEndDate);
  console.log('  PaymentIntent:', data.paymentIntentId);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
