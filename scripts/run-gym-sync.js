#!/usr/bin/env node
/**
 * Run gym membership sync from Stripe to database.
 * Usage: node scripts/run-gym-sync.js
 * Or from container: node /app/scripts/run-gym-sync.js
 */

const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const { initDatabase, Database } = require('../database');
const { syncAllGymMemberships } = require('../gym-membership-sync');

async function main() {
  const conn = await initDatabase();
  const db = new Database(conn);
  const result = await syncAllGymMemberships(db);
  console.log('Gym membership sync result:', JSON.stringify(result, null, 2));
  process.exit(result?.errors > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error('Gym sync failed:', err);
  process.exit(1);
});
