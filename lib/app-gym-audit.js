/**
 * Read-only audit: app subscriptions vs gym memberships (Postgres only).
 * Used by GET /api/admin/audit/app-gym and scripts/audit-app-gym-consistency.js
 */

'use strict';

const TIER_ONE_DAYS = 10; // tier-access-config.json tiers.tier_one.subscriptionDays default

const NOTES = [
  'Check & fix app access: only subscriptions with status = free_trial, tier_one, no Stripe id, active gym free_trial, AND no other active paid/Stripe app subscription (tier_two+ or any Stripe-backed row).',
  'Sets subscriptions.end_date to term start (contract_start_date, else gym start_date, else gym created_at) + tier_one subscriptionDays (default 10), Mountain end-of-day — same as tierOneEndIsoFromGymContractAnchor.',
  'Does not sync Stripe, dedupe rows, or create new Tier One rows.'
];

function tierRank(tier) {
  const t = String(tier || '');
  if (t === 'tier_four') return 40;
  if (t === 'tier_three') return 30;
  if (t === 'tier_two') return 20;
  if (t === 'monthly') return 15;
  if (t === 'tier_one') return 10;
  if (t === 'weekly' || t === 'daily') return 5;
  return 0;
}

/** Same as database getUserActiveSubscription row filter (Postgres). */
function isValidAccessRow(row) {
  if (!row || !['active', 'grace_period', 'free_trial'].includes(row.status)) return false;
  if (row.end_date) {
    const end = new Date(row.end_date);
    if (end <= new Date()) return false;
  }
  if (row.status === 'grace_period' && row.grace_period_ends_at) {
    const g = new Date(row.grace_period_ends_at);
    if (g <= new Date()) return false;
  }
  return true;
}

function sortSubscriptionsPickWinner(rows) {
  return [...rows].sort((a, b) => {
    const sa = a.stripe_subscription_id && String(a.stripe_subscription_id).trim() ? 1 : 0;
    const sb = b.stripe_subscription_id && String(b.stripe_subscription_id).trim() ? 1 : 0;
    if (sa !== sb) return sb - sa;
    const tr = tierRank(b.tier) - tierRank(a.tier);
    if (tr !== 0) return tr;
    const ca = new Date(a.created_at || 0).getTime();
    const cb = new Date(b.created_at || 0).getTime();
    if (cb !== ca) return cb - ca;
    return (b.id || 0) - (a.id || 0);
  });
}

/**
 * Expire tier_one rows that are still "active" but end_date has passed.
 */
async function expireStaleTierOneActivePastEnd(db) {
  const out = [];
  const r = await db.query(`
    SELECT id, user_id, status FROM subscriptions
    WHERE tier = 'tier_one' AND status IN ('active', 'free_trial')
      AND end_date IS NOT NULL AND end_date < CURRENT_TIMESTAMP
  `);
  for (const row of r.rows || []) {
    await db.updateSubscriptionStatus(row.id, 'expired', row.status, 'admin_reconcile_tier_one_end_passed');
    out.push({ subscription_id: row.id, user_id: row.user_id, action: 'expired_stale_tier_one' });
  }
  return out;
}

/**
 * For users with multiple active/grace rows: remove invalid rows, then dedupe valid ones.
 */
async function dedupeDuplicateActiveAppSubscriptions(db) {
  const actions = [];
  const dupUsers = await db.query(`
    SELECT user_id FROM subscriptions
    WHERE status IN ('active', 'grace_period', 'free_trial')
    GROUP BY user_id
    HAVING COUNT(*) > 1
  `);
  for (const { user_id: userId } of dupUsers.rows || []) {
    let res = await db.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'grace_period', 'free_trial') ORDER BY id`,
      [userId]
    );
    let list = res.rows || [];
    if (list.length <= 1) continue;

    for (const row of list) {
      if (isValidAccessRow(row)) continue;
      const old = row.status;
      if (row.end_date && new Date(row.end_date) <= new Date()) {
        await db.updateSubscriptionStatus(row.id, 'expired', old, 'admin_reconcile_stale_end_date');
        actions.push({ user_id: userId, subscription_id: row.id, action: 'expired_stale' });
      } else {
        await db.updateSubscriptionStatus(row.id, 'canceled', old, 'admin_reconcile_invalid_access_row');
        actions.push({ user_id: userId, subscription_id: row.id, action: 'canceled_invalid' });
      }
    }

    res = await db.query(
      `SELECT * FROM subscriptions WHERE user_id = $1 AND status IN ('active', 'grace_period', 'free_trial') ORDER BY id`,
      [userId]
    );
    list = (res.rows || []).filter(isValidAccessRow);
    if (list.length <= 1) continue;

    const sorted = sortSubscriptionsPickWinner(list);
    const winner = sorted[0];
    for (let i = 1; i < sorted.length; i++) {
      const loser = sorted[i];
      await db.updateSubscriptionStatus(loser.id, 'canceled', loser.status, 'admin_reconcile_duplicate_active');
      actions.push({
        user_id: userId,
        subscription_id: loser.id,
        action: 'canceled_duplicate_kept_' + winner.id,
        kept_subscription_id: winner.id
      });
    }
  }
  return actions;
}

/**
 * @param {*} db - Database instance (database.js)
 * @returns {Promise<object>}
 */
async function runAppGymAuditDb(db) {
  if (!db || !db.isPostgres) {
    return {
      ok: true,
      supported: false,
      database: db && !db.isPostgres ? 'sqlite' : 'unknown',
      message: 'App vs gym audit requires PostgreSQL (production). SQLite/local dev is not supported for these checks.',
      sections: [],
      notes: NOTES,
      highSeverityRowCount: 0,
      generatedAt: new Date().toISOString()
    };
  }

  const sections = [];

  const q1 = await db.query(`
    SELECT u.id AS user_id, u.email, gm.membership_type, gm.contract_start_date, gm.created_at AS gym_created
    FROM gym_memberships gm
    JOIN users u ON u.id = gm.user_id
    WHERE gm.status = 'active'
      AND u.role = 'user'
      AND NOT EXISTS (SELECT 1 FROM subscriptions s WHERE s.user_id = u.id)
    ORDER BY u.email
  `);
  sections.push({
    id: 'A',
    title: 'A) Active gym member, NO rows in subscriptions (no Tier One row yet)',
    severity: 'info',
    rowCount: q1.rows.length,
    rows: q1.rows
  });

  const q2 = await db.query(`
    SELECT s.user_id, u.email, COUNT(*)::int AS n,
           array_agg(s.id ORDER BY s.id) AS subscription_ids,
           array_agg(s.status ORDER BY s.id) AS statuses
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.status IN ('active', 'grace_period', 'free_trial')
    GROUP BY s.user_id, u.email
    HAVING COUNT(*) > 1
    ORDER BY n DESC, u.email
  `);
  sections.push({
    id: 'B',
    title: 'B) Multiple active/grace_period/free_trial APP subscriptions per user',
    severity: 'high',
    rowCount: q2.rows.length,
    rows: q2.rows
  });

  const q3 = await db.query(`
    SELECT s.id, s.user_id, u.email, s.status, s.stripe_subscription_id, s.end_date
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.tier = 'tier_one'
      AND s.stripe_subscription_id IS NOT NULL
      AND TRIM(s.stripe_subscription_id) <> ''
    ORDER BY u.email
  `);
  sections.push({
    id: 'C',
    title: 'C) tier_one rows WITH stripe_subscription_id (review — often paid/trial Stripe path)',
    severity: 'info',
    rowCount: q3.rows.length,
    rows: q3.rows
  });

  const q4 = await db.query(
    `
    SELECT s.id, s.user_id, u.email, s.status,
           s.created_at::date AS created_day,
           s.end_date::date AS end_day,
           (s.end_date::date - s.created_at::date) AS span_days
    FROM subscriptions s
    JOIN users u ON u.id = s.user_id
    WHERE s.tier = 'tier_one'
      AND s.status IN ('active', 'free_trial')
      AND s.end_date IS NOT NULL
      AND ABS((s.end_date::date - s.created_at::date) - $1) > 1
    ORDER BY u.email
  `,
    [TIER_ONE_DAYS]
  );
  sections.push({
    id: 'D',
    title: `D) Active tier_one where (end_date - created_at) is NOT ~${TIER_ONE_DAYS} days (±1 day)`,
    severity: 'info',
    rowCount: q4.rows.length,
    rows: q4.rows
  });

  const q5 = await db.query(`
    SELECT u.email,
           gm.contract_start_date::date AS gym_contract_start,
           s.created_at::date AS tier_one_created,
           s.end_date::date AS tier_one_end,
           (s.end_date::date - gm.contract_start_date::date) AS days_from_gym_start_to_tier_end
    FROM gym_memberships gm
    JOIN users u ON u.id = gm.user_id
    JOIN subscriptions s ON s.user_id = u.id AND s.tier = 'tier_one' AND s.status IN ('active', 'free_trial')
    WHERE gm.status = 'active'
      AND gm.contract_start_date IS NOT NULL
      AND s.end_date IS NOT NULL
    ORDER BY u.email
    LIMIT 200
  `);
  sections.push({
    id: 'E',
    title:
      'E) Active gym + active tier_one (sample): days from gym contract_start to tier_one end — NOT enforced by app code',
    severity: 'info',
    rowCount: q5.rows.length,
    rows: q5.rows
  });

  const q6 = await db.query(`
    SELECT u.email,
           (SELECT COUNT(*)::int FROM subscriptions s1 WHERE s1.user_id = u.id AND s1.tier = 'tier_one' AND s1.status = 'expired') AS expired_tier_one_count,
           (SELECT COUNT(*)::int FROM subscriptions s2 WHERE s2.user_id = u.id AND s2.tier IN ('tier_two','tier_three','tier_four') AND s2.status = 'active') AS active_paid_count
    FROM users u
    WHERE EXISTS (
      SELECT 1 FROM subscriptions s1 WHERE s1.user_id = u.id AND s1.tier = 'tier_one' AND s1.status = 'expired'
    )
    AND EXISTS (
      SELECT 1 FROM subscriptions s2 WHERE s2.user_id = u.id AND s2.tier IN ('tier_two','tier_three','tier_four') AND s2.status = 'active'
    )
    ORDER BY u.email
    LIMIT 100
  `);
  sections.push({
    id: 'F',
    title: 'F) Had expired tier_one AND now has active paid tier (proxy: used free tier then upgraded)',
    severity: 'info',
    rowCount: q6.rows.length,
    rows: q6.rows
  });

  let highSeverityRowCount = 0;
  for (const s of sections) {
    if (s.severity === 'high') highSeverityRowCount += s.rows.length;
  }

  return {
    ok: true,
    supported: true,
    database: 'postgresql',
    tierOneDaysExpected: TIER_ONE_DAYS,
    sections,
    notes: NOTES,
    highSeverityRowCount,
    generatedAt: new Date().toISOString()
  };
}

/**
 * App free trial (subscriptions.status = free_trial): ensure Tier One end_date is
 * term_start + subscriptionDays (Mountain end-of-day), same as tierOneEndIsoFromGymContractAnchor.
 *
 * Only rows: tier_one, status free_trial, no Stripe id, active gym free_trial for term anchor,
 * AND user has NO other currently valid paid/Stripe app subscription (avoids touching stale tier_one
 * rows left behind after upgrade to tier_two+).
 */
async function syncFreeTrialGymAccessEnds(db) {
  const path = require('path');
  const tierConfig = require(path.join(__dirname, '..', 'tier-access-config.json'));
  const subscriptionDays = tierConfig.tiers?.tier_one?.subscriptionDays ?? TIER_ONE_DAYS;
  const { tierOneEndIsoFromGymContractAnchor } = require('./mountain-time');

  let query;
  if (db.isPostgres) {
    query = `
      SELECT DISTINCT ON (u.id)
        u.id AS user_id,
        u.email,
        gm.contract_start_date,
        gm.start_date AS gym_start_date,
        gm.created_at AS gym_created,
        s.id AS subscription_id,
        s.end_date
      FROM gym_memberships gm
      INNER JOIN users u ON u.id = gm.user_id
      INNER JOIN subscriptions s ON s.user_id = u.id
      WHERE gm.membership_type = 'free_trial'
        AND gm.status = 'active'
        AND u.role = 'user'
        AND s.status = 'free_trial'
        AND s.tier = 'tier_one'
        AND (s.stripe_subscription_id IS NULL OR TRIM(s.stripe_subscription_id::text) = '')
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions s2
          WHERE s2.user_id = u.id
            AND s2.id <> s.id
            AND s2.status IN ('active', 'grace_period', 'free_trial')
            AND (s2.end_date IS NULL OR s2.end_date > CURRENT_TIMESTAMP)
            AND (
              s2.status <> 'grace_period'
              OR s2.grace_period_ends_at IS NULL
              OR s2.grace_period_ends_at > CURRENT_TIMESTAMP
            )
            AND (
              s2.tier IN ('tier_two', 'tier_three', 'tier_four')
              OR (s2.stripe_subscription_id IS NOT NULL AND TRIM(s2.stripe_subscription_id::text) <> '')
            )
        )
      ORDER BY u.id, s.created_at DESC
    `;
  } else {
    query = `
      SELECT u.id AS user_id, u.email, gm.contract_start_date, gm.start_date AS gym_start_date, gm.created_at AS gym_created,
             s.id AS subscription_id, s.end_date
      FROM gym_memberships gm
      INNER JOIN users u ON u.id = gm.user_id
      INNER JOIN subscriptions s ON s.user_id = u.id
      WHERE gm.membership_type = 'free_trial'
        AND gm.status = 'active'
        AND u.role = 'user'
        AND s.status = 'free_trial'
        AND s.tier = 'tier_one'
        AND (s.stripe_subscription_id IS NULL OR TRIM(s.stripe_subscription_id) = '')
        AND NOT EXISTS (
          SELECT 1 FROM subscriptions o
          WHERE o.user_id = u.id AND o.id <> s.id
            AND o.status IN ('active', 'grace_period', 'free_trial')
            AND (o.end_date IS NULL OR datetime(o.end_date) > datetime('now'))
            AND (
              o.status != 'grace_period'
              OR o.grace_period_ends_at IS NULL
              OR datetime(o.grace_period_ends_at) > datetime('now')
            )
            AND (
              o.tier IN ('tier_two', 'tier_three', 'tier_four')
              OR (o.stripe_subscription_id IS NOT NULL AND TRIM(o.stripe_subscription_id) != '')
            )
        )
        AND s.id = (
          SELECT s2.id FROM subscriptions s2
          WHERE s2.user_id = u.id AND s2.tier = 'tier_one'
            AND s2.status = 'free_trial'
            AND (s2.stripe_subscription_id IS NULL OR TRIM(s2.stripe_subscription_id) = '')
          ORDER BY s2.created_at DESC
          LIMIT 1
        )
    `;
  }

  const r = await db.query(query, []);
  const rows = r.rows || [];
  const fixed = [];
  const failed = [];

  const DRIFT_MS = 90 * 1000;

  for (const row of rows) {
    try {
      const anchor = row.contract_start_date || row.gym_start_date || row.gym_created || null;
      const expectedIso = tierOneEndIsoFromGymContractAnchor(anchor, subscriptionDays);
      const expectedMs = new Date(expectedIso).getTime();
      const actualMs = row.end_date ? new Date(row.end_date).getTime() : NaN;
      if (Number.isNaN(expectedMs)) {
        failed.push({
          user_id: row.user_id,
          email: row.email,
          reason: 'Could not compute expected end_date from term start'
        });
        continue;
      }
      if (!Number.isNaN(actualMs) && Math.abs(actualMs - expectedMs) <= DRIFT_MS) {
        continue;
      }
      await db.updateSubscription(row.subscription_id, { end_date: expectedIso });
      fixed.push({
        user_id: row.user_id,
        email: row.email,
        subscription_id: row.subscription_id,
        previous_end_date: row.end_date,
        end_date: expectedIso,
        term_anchor: anchor ? String(anchor).split('T')[0] : 'fallback_today'
      });
    } catch (err) {
      failed.push({
        user_id: row.user_id,
        email: row.email,
        reason: err.message || String(err)
      });
    }
  }

  return {
    scanned: rows.length,
    updated: fixed.length,
    unchanged: Math.max(0, rows.length - fixed.length - failed.length),
    subscriptionDays,
    fixed,
    failed
  };
}

/**
 * Check & fix app access: gym free trial only — align Tier One access expires with term start + 10 days (config).
 *
 * @param {*} db
 * @param {*} _stripe - unused (kept for route compatibility)
 */
async function reconcileGymMemberAppAccess(db, _stripe) {
  if (!db || !db.isPostgres) {
    return {
      ok: true,
      supported: false,
      message: 'Reconcile requires PostgreSQL (production).',
      freeTrialScanned: 0,
      freeTrialUpdated: 0,
      generatedAt: new Date().toISOString()
    };
  }

  const path = require('path');
  const tierConfig = require(path.join(__dirname, '..', 'tier-access-config.json'));
  const subscriptionDays = tierConfig.tiers?.tier_one?.subscriptionDays ?? TIER_ONE_DAYS;

  let result;
  try {
    result = await syncFreeTrialGymAccessEnds(db);
  } catch (e) {
    return {
      ok: false,
      supported: true,
      error: e.message || String(e),
      freeTrialScanned: 0,
      freeTrialUpdated: 0,
      generatedAt: new Date().toISOString()
    };
  }

  const { scanned, updated, unchanged, fixed, failed } = result;
  const msg =
    updated > 0
      ? `Updated access expires for ${updated} free trial member(s) (term start + ${subscriptionDays} days).`
      : scanned === 0
        ? 'No active gym free trial members with a DB-only Tier One app row were found.'
        : `All ${scanned} free trial app row(s) already had the correct access expires (±90s).`;

  return {
    ok: true,
    supported: true,
    message: msg,
    whyThisMatters:
      'Only app subscriptions with status free_trial (tier_one, no Stripe id), active gym free_trial, and no other active paid or Stripe-backed subscription row. Access expires is set to end of gym term start day (contract_start_date, else gym start_date, else gym created_at) plus ' +
      subscriptionDays +
      ' calendar days in Mountain Time — same rule as new Tier One signups. If that window is already in the past, tierOneEndIsoFromGymContractAnchor falls back to today + those days.',
    subscriptionDays,
    freeTrialScanned: scanned,
    freeTrialUpdated: updated,
    freeTrialUnchanged: unchanged,
    fixed,
    failed,
    generatedAt: new Date().toISOString()
  };
}

module.exports = {
  runAppGymAuditDb,
  reconcileGymMemberAppAccess,
  syncFreeTrialGymAccessEnds,
  expireStaleTierOneActivePastEnd,
  dedupeDuplicateActiveAppSubscriptions,
  TIER_ONE_DAYS,
  NOTES
};
