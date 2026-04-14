#!/usr/bin/env node
/**
 * Backfill stored discount labels to match lib/gym-discount-display-name.js (canonical:
 * "Loyalty (original price)" for legacy "Family Percentage Discount (...)" and
 * "Loyalty Discount (original price)" rows).
 *
 * Updates:
 *   - gym_memberships.discount_name
 *   - admin_added_members.discount_1_name, discount_2_name, discount_3_name (when set)
 *
 * Usage:
 *   node scripts/normalize-gym-discount-names.js           # dry-run (no writes)
 *   node scripts/normalize-gym-discount-names.js --apply   # persist changes
 *
 * With production env:
 *   node -r dotenv/config scripts/normalize-gym-discount-names.js --apply
 *   DOTENV_CONFIG_PATH=.env.production node scripts/normalize-gym-discount-names.js --apply
 */
const path = require('path');
require('dotenv').config({ path: path.join(__dirname, '..', '.env') });
if (!process.env.DB_HOST && require('fs').existsSync(path.join(__dirname, '..', '.env.production'))) {
  require('dotenv').config({ path: path.join(__dirname, '..', '.env.production') });
}

const { initDatabase, Database } = require('../database');
const { normalizeGymDiscountDisplayName } = require('../lib/gym-discount-display-name');

function shouldReplace(raw) {
  if (raw == null) return { next: null, change: false };
  const trimmed = String(raw).trim();
  if (!trimmed) return { next: null, change: false };
  const next = normalizeGymDiscountDisplayName(trimmed);
  if (next == null) return { next: null, change: false };
  return { next, change: next !== trimmed };
}

async function main() {
  const apply = process.argv.includes('--apply');
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  const isPg = db.isPostgres;

  try {
    const gmRes = await db.query(
      isPg
        ? `SELECT id, discount_name FROM gym_memberships WHERE discount_name IS NOT NULL AND TRIM(discount_name) <> ''`
        : `SELECT id, discount_name FROM gym_memberships WHERE discount_name IS NOT NULL AND TRIM(discount_name) != ''`
    );
    const gmRows = gmRes.rows || [];
    let gmUpdated = 0;
    for (const row of gmRows) {
      const { next, change } = shouldReplace(row.discount_name);
      if (!change) continue;
      console.log(
        `[gym_memberships id=${row.id}] "${String(row.discount_name).trim()}" -> "${next}"${apply ? '' : ' (dry-run)'}`
      );
      if (apply) {
        await db.query(
          isPg
            ? `UPDATE gym_memberships SET discount_name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
            : `UPDATE gym_memberships SET discount_name = ?, updated_at = datetime('now') WHERE id = ?`,
          [next, row.id]
        );
        gmUpdated += 1;
      }
    }

    const aamRes = await db.query(
      `SELECT id, discount_1_name, discount_2_name, discount_3_name FROM admin_added_members`
    );
    const aamRows = aamRes.rows || [];
    let aamUpdated = 0;
    for (const row of aamRows) {
      const d1 = shouldReplace(row.discount_1_name);
      const d2 = shouldReplace(row.discount_2_name);
      const d3 = shouldReplace(row.discount_3_name);
      if (!d1.change && !d2.change && !d3.change) continue;

      const new1 = d1.change ? d1.next : row.discount_1_name;
      const new2 = d2.change ? d2.next : row.discount_2_name;
      const new3 = d3.change ? d3.next : row.discount_3_name;

      console.log(
        `[admin_added_members id=${row.id}] discount names -> ` +
          `1:${JSON.stringify(new1)} 2:${JSON.stringify(new2)} 3:${JSON.stringify(new3)}${apply ? '' : ' (dry-run)'}`
      );
      if (apply) {
        await db.query(
          isPg
            ? `UPDATE admin_added_members SET discount_1_name = $1, discount_2_name = $2, discount_3_name = $3 WHERE id = $4`
            : `UPDATE admin_added_members SET discount_1_name = ?, discount_2_name = ?, discount_3_name = ? WHERE id = ?`,
          [new1, new2, new3, row.id]
        );
        aamUpdated += 1;
      }
    }

    if (!apply) {
      console.log('');
      console.log('Dry-run only: no rows were written. Re-run with --apply to persist.');
    } else {
      console.log('');
      console.log(`Done. gym_memberships rows updated: ${gmUpdated}, admin_added_members rows updated: ${aamUpdated}`);
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
