#!/usr/bin/env node
/**
 * Link a user as immediate family on a primary's household (production-safe when .env has DB_*).
 *
 *   node scripts/link-immediate-family.js <primary_email> <member_email> [member_name]
 *   node scripts/link-immediate-family.js <primary_email> <member_name_without_@>
 *
 * Omit member_email by using only two arguments after primary, where the second token has no '@'
 * (treated as display name), or pass an empty string for member_email:
 *   node scripts/link-immediate-family.js primary@example.com "" "Kid Name"
 */
require('dotenv').config();
const { initDatabase, Database } = require('../database');

async function main() {
  const primaryEmail = process.argv[2];
  if (!primaryEmail) {
    console.error(
      'Usage: node scripts/link-immediate-family.js <primary_email> [member_email] [member_name]'
    );
    console.error(
      '  If the first arg after primary has no @, it is treated as member_name (placeholder email created).'
    );
    console.error('  Example: node scripts/link-immediate-family.js primary@x.com member@y.com "Jane"');
    console.error('  Example: node scripts/link-immediate-family.js primary@x.com "Jane Doe"');
    process.exit(1);
  }

  let memberEmail = '';
  let memberName = null;
  const a3 = process.argv[3];
  const a4 = process.argv[4];
  if (a3 != null && a3 !== '') {
    if (String(a3).includes('@')) {
      memberEmail = a3;
      memberName = a4 || null;
    } else {
      memberEmail = '';
      memberName = a3;
    }
  }

  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  try {
    const result = await db.linkImmediateFamilyMemberToPrimary({
      primaryEmail,
      memberEmail,
      memberName
    });
    console.log(JSON.stringify(result, null, 2));
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
