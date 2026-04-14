#!/usr/bin/env node
/**
 * Backfill gym_memberships.monthly_amount_cents for shared family_group_id households:
 * each row gets its list-price share of the household discount (same split as confirm-migration).
 * Primary's Stripe charge = SUM(monthly_amount_cents) for the group (nightly job sums this).
 *
 *   node scripts/repair-household-primary-monthly.js
 *   node scripts/repair-household-primary-monthly.js primary@email.com
 */
require('dotenv').config();
const { initDatabase, Database } = require('../database');

async function main() {
  const primaryEmail = process.argv[2] && String(process.argv[2]).trim();
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  try {
    const result = await db.repairPrimaryHouseholdMonthlyAmounts(
      primaryEmail ? { primaryEmail } : {}
    );
    console.log(`Updated ${result.updated} primary household row(s).`);
    if (result.updates && result.updates.length) {
      console.log(JSON.stringify(result.updates, null, 2));
    }
  } finally {
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    } else if (dbConnection && typeof dbConnection.close === 'function') {
      dbConnection.close();
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
