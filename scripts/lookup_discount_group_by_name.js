#!/usr/bin/env node
/**
 * Look up GRP id (and discount_groups row) by group display name.
 * Requires production DB env: DB_HOST, DB_USER, DB_PASSWORD, DB_NAME (optional), DB_PORT (optional).
 *
 * Usage:
 *   node scripts/lookup_discount_group_by_name.js "Money & Power"
 */
require('dotenv').config({ path: require('path').join(__dirname, '..', '.env') });

const { Client } = require('pg');

const nameArg = process.argv.slice(2).join(' ').trim();
if (!nameArg) {
  console.error('Usage: node scripts/lookup_discount_group_by_name.js "<group display name>"');
  process.exit(1);
}

if (!process.env.DB_HOST || !process.env.DB_USER || !process.env.DB_PASSWORD) {
  console.error('Set DB_HOST, DB_USER, DB_PASSWORD (and optionally DB_NAME, DB_PORT) for PostgreSQL.');
  process.exit(1);
}

async function main() {
  const client = new Client({
    host: process.env.DB_HOST,
    port: process.env.DB_PORT || 5432,
    database: process.env.DB_NAME || 'postgres',
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
  });
  await client.connect();

  const exact = await client.query(
    `SELECT id, group_id, group_name, group_access_code, group_leader_id
     FROM discount_groups
     WHERE TRIM(group_name) = $1`,
    [nameArg]
  );

  const fuzzy = await client.query(
    `SELECT id, group_id, group_name, group_access_code, group_leader_id
     FROM discount_groups
     WHERE group_name IS NOT NULL
       AND group_name ILIKE $1
     ORDER BY id DESC
     LIMIT 20`,
    [`%${nameArg.replace(/%/g, '')}%`]
  );

  const fromMigration = await client.query(
    `SELECT id, group_id, group_name, primary_email, status FROM admin_added_members
     WHERE group_name IS NOT NULL AND TRIM(group_name) = $1
     ORDER BY id DESC
     LIMIT 10`,
    [nameArg]
  );

  await client.end();

  if (exact.rows.length) {
    console.log('discount_groups (exact name match):');
    console.log(JSON.stringify(exact.rows, null, 2));
  } else if (fuzzy.rows.length) {
    console.log('discount_groups (ILIKE partial match):');
    console.log(JSON.stringify(fuzzy.rows, null, 2));
  } else {
    console.log('No matches in discount_groups for that name.');
  }

  if (fromMigration.rows.length) {
    console.log('admin_added_members (same group_name):');
    console.log(JSON.stringify(fromMigration.rows, null, 2));
  }
}

main().catch((e) => {
  console.error(e.message);
  process.exit(1);
});
