#!/usr/bin/env node

/**
 * Script to call the admin sync-all endpoint
 * Usage: node call-sync-endpoint.js [admin_token]
 * If no token provided, will prompt for admin email/password
 */

require('dotenv').config();

const API_BASE = process.env.PRODUCTION_API_BASE || 'https://app.stoic-fit.com/api';

// Accept token as first arg, or email/password as first two args
let ADMIN_TOKEN = null;
let ADMIN_EMAIL = null;
let ADMIN_PASSWORD = null;

if (process.argv.length >= 3) {
  // If only one arg provided, assume it's a token
  if (process.argv.length === 3) {
    ADMIN_TOKEN = process.argv[2];
  } else {
    // Two args = email and password
    ADMIN_EMAIL = process.argv[2];
    ADMIN_PASSWORD = process.argv[3];
  }
}

async function main() {
  try {
    let token = ADMIN_TOKEN;
    
    // If no token provided, try to login
    if (!token && ADMIN_EMAIL && ADMIN_PASSWORD) {
      console.log('Logging in as admin...');
      const loginResponse = await fetch(`${API_BASE}/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: ADMIN_EMAIL,
          password: ADMIN_PASSWORD
        })
      });
      
      if (!loginResponse.ok) {
        throw new Error('Login failed. Please check credentials.');
      }
      
      const loginData = await loginResponse.json();
      token = loginData.token;
      console.log('✅ Logged in successfully\n');
    }
    
    if (!token) {
      console.error('❌ Error: Admin token required');
      console.error('\nUsage:');
      console.error('  node call-sync-endpoint.js <admin_email> <admin_password>');
      console.error('  OR');
      console.error('  node call-sync-endpoint.js <admin_jwt_token>');
      process.exit(1);
    }
    
    console.log('🔄 Calling admin sync-all endpoint...');
    console.log(`   Endpoint: ${API_BASE}/admin/subscriptions/sync-all\n`);
    
    const response = await fetch(`${API_BASE}/admin/subscriptions/sync-all`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json'
      }
    });
    
    const data = await response.json();
    
    if (!response.ok) {
      console.error('❌ Error:', data.error || data.message || 'Unknown error');
      if (data.details) {
        console.error('   Details:', data.details);
      }
      process.exit(1);
    }
    
    console.log('✅ Sync completed successfully!\n');
    console.log('📊 Statistics:');
    console.log(`   Processed: ${data.stats.processed}`);
    console.log(`   Created: ${data.stats.created}`);
    console.log(`   Updated: ${data.stats.updated}`);
    console.log(`   Skipped: ${data.stats.skipped}`);
    console.log(`   Errors: ${data.stats.errors}`);
    console.log(`   Duration: ${data.stats.duration}ms`);
    
    process.exit(0);
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

// Use fetch polyfill if needed (Node 18+ has fetch built-in)
if (typeof fetch === 'undefined') {
  global.fetch = require('node-fetch');
}

main();

