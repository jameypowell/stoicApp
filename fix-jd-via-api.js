#!/usr/bin/env node

/**
 * Fix JD Nielson's account via Production API
 * This uses the admin endpoint to trigger the sync
 */

require('dotenv').config();

const CUSTOMER_ID = 'cus_TTQrfuTZCoc0Yy';
const PROD_API_URL = process.env.PROD_API_URL || 'https://api.stoic-fit.com' || 'https://stoic-fit.com';

// You need to provide an admin token
const ADMIN_TOKEN = process.env.ADMIN_TOKEN || process.argv[2];

if (!ADMIN_TOKEN) {
  console.error('❌ Admin token required!');
  console.error('');
  console.error('Usage:');
  console.error('  ADMIN_TOKEN=<token> node fix-jd-via-api.js');
  console.error('  OR');
  console.error('  node fix-jd-via-api.js <admin_token>');
  console.error('');
  console.error('To get an admin token:');
  console.error('  1. Log in to production as an admin user');
  console.error('  2. Copy the JWT token from localStorage or browser dev tools');
  console.error('  3. Use it as ADMIN_TOKEN');
  process.exit(1);
}

async function fixViaAPI() {
  console.log('🚨 Fixing JD Nielson via Production API');
  console.log('='.repeat(60));
  console.log('API URL:', PROD_API_URL);
  console.log('Customer ID:', CUSTOMER_ID);
  console.log('');
  
  try {
    // Option 1: Sync specific customer
    console.log('1️⃣  Syncing JD Nielson\'s subscription...');
    const syncResponse = await fetch(`${PROD_API_URL}/api/admin/subscriptions/sync`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${ADMIN_TOKEN}`
      },
      body: JSON.stringify({
        customerId: CUSTOMER_ID
      })
    });
    
    const syncData = await syncResponse.json();
    
    if (syncResponse.ok) {
      console.log('   ✅ Sync successful!');
      console.log('   Result:', JSON.stringify(syncData, null, 2));
    } else {
      console.error('   ❌ Sync failed:', syncData.error || syncData);
      
      // Try full sync instead
      console.log('\n2️⃣  Trying full sync instead...');
      const fullSyncResponse = await fetch(`${PROD_API_URL}/api/admin/subscriptions/sync-all`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${ADMIN_TOKEN}`
        }
      });
      
      const fullSyncData = await fullSyncResponse.json();
      
      if (fullSyncResponse.ok) {
        console.log('   ✅ Full sync successful!');
        console.log('   Stats:', JSON.stringify(fullSyncData.stats, null, 2));
      } else {
        console.error('   ❌ Full sync also failed:', fullSyncData.error || fullSyncData);
        process.exit(1);
      }
    }
    
    console.log('\n✅ JD Nielson\'s account should now be fixed!');
    console.log('   He should be able to log in and access all features.');
    
  } catch (error) {
    console.error('\n❌ Error:', error.message);
    console.error('');
    console.error('Make sure:');
    console.error('  1. PROD_API_URL is correct (or set it in .env)');
    console.error('  2. ADMIN_TOKEN is valid');
    console.error('  3. You have network access to the production API');
    process.exit(1);
  }
}

fixViaAPI();


