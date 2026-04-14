#!/usr/bin/env node
/**
 * Read-only guardrail:
 * Detect gym members charged on consecutive Denver calendar days or multiple times
 * on the same Denver day (likely double-charge patterns).
 *
 * Usage:
 *   node scripts/audit-gym-renewal-repeat-charges.js
 *   node scripts/audit-gym-renewal-repeat-charges.js --days 30
 *   node scripts/audit-gym-renewal-repeat-charges.js --include-refunded
 *
 * Exit code:
 *   0 => no suspicious patterns in window
 *   2 => suspicious patterns found
 *   1 => runtime error
 */
'use strict';

require('dotenv').config();
const { Client } = require('pg');

function parseArgs(argv) {
  const out = {
    days: 14,
    includeRefunded: false
  };
  const i = argv.indexOf('--days');
  if (i >= 0 && argv[i + 1]) {
    const n = parseInt(argv[i + 1], 10);
    if (Number.isFinite(n) && n > 0) out.days = Math.min(120, n);
  }
  out.includeRefunded = argv.includes('--include-refunded');
  return out;
}

function createClient() {
  const url = process.env.DATABASE_URL && String(process.env.DATABASE_URL).trim();
  if (url) {
    return new Client({
      connectionString: url,
      ssl: process.env.DB_SSL === 'false' ? false : { rejectUnauthorized: false }
    });
  }
  if (process.env.DB_HOST && process.env.DB_USER && process.env.DB_PASSWORD) {
    return new Client({
      host: process.env.DB_HOST,
      port: process.env.DB_PORT || 5432,
      database: process.env.DB_NAME || 'postgres',
      user: process.env.DB_USER,
      password: process.env.DB_PASSWORD,
      ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
    });
  }
  throw new Error('Set DATABASE_URL or DB_HOST + DB_USER + DB_PASSWORD.');
}

async function main() {
  const { days, includeRefunded } = parseArgs(process.argv.slice(2));
  const statuses = includeRefunded
    ? ['succeeded', 'refunded', 'partially_refunded']
    : ['succeeded'];

  const c = createClient();
  await c.connect();

  // Daily rollup in Denver calendar days.
  const daily = await c.query(
    `WITH daily AS (
       SELECT
         p.user_id,
         u.email,
         (p.created_at AT TIME ZONE 'America/Denver')::date AS denver_day,
         COUNT(*) AS charges,
         SUM(p.amount)::bigint AS amount_cents
       FROM payments p
       JOIN users u ON u.id = p.user_id
       WHERE p.tier IN ('gym_membership', 'gym_membership_late_fee')
         AND p.status = ANY($1::text[])
         AND p.created_at >= (CURRENT_TIMESTAMP - ($2::text || ' days')::interval)
         AND u.role <> 'tester'
       GROUP BY p.user_id, u.email, (p.created_at AT TIME ZONE 'America/Denver')::date
     ),
     lagged AS (
       SELECT
         d.*,
         LAG(d.denver_day) OVER (PARTITION BY d.user_id ORDER BY d.denver_day) AS prev_day,
         LAG(d.charges) OVER (PARTITION BY d.user_id ORDER BY d.denver_day) AS prev_charges
       FROM daily d
     )
     SELECT
       user_id,
       email,
       denver_day,
       charges,
       amount_cents,
       prev_day,
       prev_charges,
       CASE
         WHEN charges > 1 THEN 'same_day_multi_charge'
         WHEN prev_day IS NOT NULL AND denver_day = prev_day + 1 THEN 'consecutive_day_charge'
         ELSE NULL
       END AS reason
     FROM lagged
     WHERE charges > 1 OR (prev_day IS NOT NULL AND denver_day = prev_day + 1)
     ORDER BY denver_day DESC, email ASC`,
    [statuses, String(days)]
  );

  // Pull latest gym membership state for flagged users.
  const userIds = [...new Set((daily.rows || []).map((r) => r.user_id))];
  let latestMembershipByUser = new Map();
  if (userIds.length) {
    const gm = await c.query(
      `SELECT DISTINCT ON (gm.user_id)
          gm.user_id,
          gm.id AS membership_id,
          gm.status AS membership_status,
          gm.contract_start_date::date AS contract_start_date,
          gm.contract_end_date::date AS contract_end_date,
          gm.monthly_amount_cents,
          gm.payment_method_id IS NOT NULL AS has_payment_method,
          gm.stripe_subscription_id
       FROM gym_memberships gm
       WHERE gm.user_id = ANY($1::int[])
       ORDER BY gm.user_id, gm.created_at DESC`,
      [userIds]
    );
    latestMembershipByUser = new Map((gm.rows || []).map((r) => [r.user_id, r]));
  }

  await c.end();

  const findings = (daily.rows || []).map((r) => ({
    ...r,
    latestMembership: latestMembershipByUser.get(r.user_id) || null
  }));

  console.log(
    JSON.stringify(
      {
        window_days: days,
        statuses_checked: statuses,
        suspicious_count: findings.length,
        findings
      },
      null,
      2
    )
  );

  process.exit(findings.length ? 2 : 0);
}

main().catch((e) => {
  console.error(e.message || e);
  process.exit(1);
});
