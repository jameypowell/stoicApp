#!/usr/bin/env node
/**
 * CLI: same audit as Admin → Health → "Run app vs gym audit" (read-only).
 *
 * Usage (Postgres — uses .env):
 *   node scripts/audit-app-gym-consistency.js
 *   npm run audit:app-gym -- --strict   # exit 1 if section B has rows
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });

const STRICT_EXIT = process.argv.includes('--strict');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));
const { runAppGymAuditDb } = require(path.join(__dirname, '..', 'lib', 'app-gym-audit'));

async function main() {
  if (!process.env.DB_HOST || !process.env.DB_USER) {
    console.error('Missing DB_HOST / DB_USER (and DB_PASSWORD). Load .env or export Postgres credentials.');
    process.exit(2);
  }
  process.env.USE_POSTGRES = 'true';
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  const result = await runAppGymAuditDb(db);

  if (!result.supported) {
    console.error(result.message || 'Audit not supported for this database.');
    process.exit(2);
  }

  console.log('\n══════════════════════════════════════════════════════════════');
  console.log('  App vs gym subscription consistency audit (READ-ONLY)');
  console.log('  Generated:', result.generatedAt);
  console.log('══════════════════════════════════════════════════════════════\n');

  for (const sec of result.sections) {
    const flag = sec.severity === 'high' && sec.rowCount > 0 ? ' [! HIGH]' : '';
    console.log(`--- ${sec.title}${flag} ---`);
    console.log(`    Rows: ${sec.rowCount}\n`);
    if (sec.rows && sec.rows.length > 0) {
      console.table(sec.rows);
      console.log('');
    }
  }

  console.log('Notes:');
  for (const n of result.notes || []) {
    console.log('  •', n);
  }
  console.log('');

  if (STRICT_EXIT && result.highSeverityRowCount > 0) {
    console.error(`Strict mode: ${result.highSeverityRowCount} high-severity row(s) in section B.`);
    process.exit(1);
  }
  process.exit(0);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
