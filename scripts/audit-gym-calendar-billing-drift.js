#!/usr/bin/env node
/**
 * Read-only audit: compare each gym_memberships row's next renewal date under
 * (A) calendar-month Denver rules vs (B) legacy +30 calendar days from current due.
 *
 * No database writes. Use after deploying calendar-month billing to spot members
 * whose first post-renewal due would differ from strict +30 continuation.
 *
 * Usage:
 *   node scripts/audit-gym-calendar-billing-drift.js
 *   node scripts/audit-gym-calendar-billing-drift.js --outliers-only
 *   node scripts/audit-gym-calendar-billing-drift.js --limit 50
 */

'use strict';

require('dotenv').config();
const { initDatabase, Database } = require('../database');
const {
  extractYmdFromDbValue,
  gymBillingAnchorYmdFromMembershipRow,
  nextGymContractEndYmdDenver,
  computeGymContractEndYmdFromStartYmd,
  addCalendarDaysYmdDenver,
  BILLING_CYCLE_DAYS
} = require('../lib/gym-contract-dates');

function parseArgs(argv) {
  const outliersOnly = argv.includes('--outliers-only');
  let limit = null;
  const li = argv.indexOf('--limit');
  if (li >= 0 && argv[li + 1]) {
    const n = parseInt(argv[li + 1], 10);
    if (Number.isFinite(n) && n > 0) limit = Math.min(50000, n);
  }
  return { outliersOnly, limit };
}

function ymdDiffDays(a, b) {
  if (!a || !b) return null;
  const da = new Date(`${a}T12:00:00`);
  const db = new Date(`${b}T12:00:00`);
  if (Number.isNaN(da.getTime()) || Number.isNaN(db.getTime())) return null;
  return Math.round((db - da) / 86400000);
}

async function main() {
  const { outliersOnly, limit } = parseArgs(process.argv.slice(2));
  let conn;
  try {
    conn = await initDatabase();
    const db = new Database(conn);

    const sql = db.isPostgres
      ? `SELECT gm.id, gm.user_id, gm.status, gm.membership_type, gm.contract_start_date, gm.contract_end_date,
                gm.family_group_id, gm.is_primary_member, gm.stripe_subscription_id,
                u.email AS user_email
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.status IN ('active', 'grace_period', 'paused')
           AND gm.contract_end_date IS NOT NULL
           AND u.role <> 'tester'
           AND u.email NOT ILIKE 'prod-test%@example.com'
           AND u.email NOT ILIKE 'qa.%@example.com'
           AND COALESCE(u.name, '') NOT ILIKE 'test %'
         ORDER BY gm.id ASC`
      : `SELECT gm.id, gm.user_id, gm.status, gm.membership_type, gm.contract_start_date, gm.contract_end_date,
                gm.family_group_id, gm.is_primary_member, gm.stripe_subscription_id,
                u.email AS user_email
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.status IN ('active', 'grace_period', 'paused')
           AND gm.contract_end_date IS NOT NULL
           AND u.role <> 'tester'
           AND u.email NOT LIKE 'prod-test%@example.com'
           AND LOWER(u.email) NOT LIKE 'qa.%@example.com'
           AND LOWER(COALESCE(u.name, '')) NOT LIKE 'test %'
         ORDER BY gm.id ASC`;

    const res = await db.query(sql, []);
    const rows = res.rows || res || [];
    const slice = limit != null ? rows.slice(0, limit) : rows;

    let printed = 0;
    for (const gm of slice) {
      const startYmd = extractYmdFromDbValue(gm.contract_start_date);
      const endYmd = extractYmdFromDbValue(gm.contract_end_date);
      const anchor = gymBillingAnchorYmdFromMembershipRow(gm);
      const nextCalendar = endYmd && anchor ? nextGymContractEndYmdDenver(endYmd, anchor) : null;
      const legacyPlus30 = endYmd ? addCalendarDaysYmdDenver(endYmd, BILLING_CYCLE_DAYS) : null;
      const firstPeriodFromStart = startYmd ? computeGymContractEndYmdFromStartYmd(startYmd) : null;
      const driftVsLegacyDays =
        nextCalendar && legacyPlus30 ? ymdDiffDays(legacyPlus30, nextCalendar) : null;
      const outlier =
        !!(nextCalendar && legacyPlus30 && nextCalendar !== legacyPlus30) || !startYmd;

      if (outliersOnly && !outlier) continue;

      const line = {
        id: gm.id,
        user_id: gm.user_id,
        email: gm.user_email,
        status: gm.status,
        membership_type: gm.membership_type,
        contract_start_ymd: startYmd,
        contract_end_ymd: endYmd,
        anchor_ymd: anchor,
        next_due_after_renewal_calendar: nextCalendar,
        next_due_after_renewal_legacy_plus30: legacyPlus30,
        drift_calendar_minus_legacy_days: driftVsLegacyDays,
        first_period_end_from_start_only: firstPeriodFromStart,
        missing_contract_start: !startYmd,
        stripe_subscription_id: gm.stripe_subscription_id ? '(set)' : null,
        outlier_calendar_vs_plus30: !!(nextCalendar && legacyPlus30 && nextCalendar !== legacyPlus30)
      };
      console.log(JSON.stringify(line));
      printed++;
    }

    console.error(
      JSON.stringify({
        summary: {
          scanned: slice.length,
          printed,
          outliers_only: outliersOnly,
          limit: limit ?? null
        }
      })
    );
  } finally {
    if (conn && typeof conn.end === 'function') await conn.end();
    else if (conn && typeof conn.close === 'function') {
      await new Promise((resolve, reject) => conn.close((e) => (e ? reject(e) : resolve())));
    }
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
