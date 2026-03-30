#!/usr/bin/env node
/**
 * Call admin gym membership sync endpoint.
 * Usage: node scripts/call-gym-sync.js <admin_email> <admin_password>
 *    OR: ADMIN_TOKEN=<token> node scripts/call-gym-sync.js
 *    OR: node scripts/call-gym-sync.js <admin_token>
 */

require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const API_BASE = process.env.PROD_API_URL || process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com';
const API_URL = API_BASE.replace(/\/$/, '') + (API_BASE.includes('/api') ? '' : '/api');

let token = process.env.ADMIN_TOKEN || (process.argv.length === 3 && process.argv[2]);

async function main() {
  try {
    if (!token && process.argv.length >= 4) {
      const email = process.argv[2];
      const password = process.argv[3];
      console.log('Logging in as admin...');
      const loginRes = await fetch(`${API_URL}/auth/login`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password })
      });
      if (!loginRes.ok) throw new Error('Login failed');
      const data = await loginRes.json();
      token = data.token;
      console.log('Logged in.\n');
    }
    if (!token) {
      console.error('Usage: node scripts/call-gym-sync.js <admin_email> <admin_password>');
      console.error('   OR: ADMIN_TOKEN=<token> node scripts/call-gym-sync.js');
      process.exit(1);
    }

    console.log('Calling admin gym membership sync...');
    const res = await fetch(`${API_URL}/admin/gym-memberships/sync`, {
      method: 'POST',
      headers: { 'Authorization': `Bearer ${token}`, 'Content-Type': 'application/json' }
    });
    const data = await res.json();

    if (!res.ok) {
      console.error('Error:', data.error || 'Sync failed');
      process.exit(1);
    }
    console.log('Sync completed:', JSON.stringify(data, null, 2));
  } catch (err) {
    console.error(err.message);
    process.exit(1);
  }
}

main();
