#!/usr/bin/env node
/**
 * Set contract_start_date / contract_end_date / start_date for a household (see database.setHouseholdGymAnchorDates).
 * Requires PostgreSQL: set DB_HOST (and DB_USER, DB_PASSWORD, DB_NAME) in the environment or .env.
 *
 * Usage:
 *   node scripts/set-household-gym-anchor-dates.js <primary_email> <YYYY-MM-DD> <YYYY-MM-DD>
 *
 * Example:
 *   node scripts/set-household-gym-anchor-dates.js ccfrancom45@hotmail.com 2026-04-06 2026-04-06
 */
require('dotenv').config();
const { initDatabase, Database } = require('../database');

async function main() {
  const primaryEmail = process.argv[2];
  const startYmd = process.argv[3];
  const endYmd = process.argv[4];
  if (!primaryEmail || !startYmd || !endYmd) {
    console.error(
      'Usage: node scripts/set-household-gym-anchor-dates.js <primary_email> <contract_start YYYY-MM-DD> <contract_end YYYY-MM-DD>'
    );
    process.exit(1);
  }

  if (!process.env.DB_HOST) {
    console.error('DB_HOST is not set. Configure PostgreSQL (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME) for production.');
    process.exit(1);
  }

  const conn = await initDatabase();
  const db = new Database(conn);

  try {
    const result = await db.setHouseholdGymAnchorDates(primaryEmail, startYmd, endYmd);
    console.log(JSON.stringify(result, null, 2));
  } finally {
    if (conn && typeof conn.end === 'function') await conn.end();
    else if (conn && typeof conn.close === 'function') conn.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
