#!/usr/bin/env node
/**
 * Clear gym_memberships.stripe_subscription_id (and item id) so the nightly PaymentIntent
 * job charges members who no longer have an active Stripe gym subscription.
 *
 * Default: dry-run. Pass --execute to apply.
 *
 * Example:
 *   DATABASE_URL=... node scripts/clear-gym-stripe-subscription-for-app-billing.js --execute
 */

'use strict';

require('dotenv').config();
const { initDatabase, Database } = require('../database');

const DEFAULT_EMAILS = ['hazehadley80@gmail.com', 'fotujacob@gmail.com'];

async function main() {
  const execute = process.argv.includes('--execute');
  const emails = DEFAULT_EMAILS.map((e) => e.trim().toLowerCase()).filter(Boolean);
  let dbConnection;
  try {
    dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    for (const email of emails) {
      const user = await db.queryOne(
        db.isPostgres
          ? 'SELECT id, email FROM users WHERE LOWER(email) = $1'
          : 'SELECT id, email FROM users WHERE LOWER(email) = ?',
        [email]
      );
      if (!user) {
        console.log(`[skip] No user for ${email}`);
        continue;
      }
      const rows = await db.query(
        db.isPostgres
          ? `SELECT id, user_id, status, stripe_subscription_id, stripe_subscription_item_id
             FROM gym_memberships WHERE user_id = $1 ORDER BY id DESC`
          : `SELECT id, user_id, status, stripe_subscription_id, stripe_subscription_item_id
             FROM gym_memberships WHERE user_id = ? ORDER BY id DESC`,
        [user.id]
      );
      const list = rows.rows || rows || [];
      if (!list.length) {
        console.log(`[skip] No gym_memberships for ${email} (user ${user.id})`);
        continue;
      }
      for (const gm of list) {
        console.log(
          JSON.stringify({
            email,
            membership_id: gm.id,
            status: gm.status,
            stripe_subscription_id: gm.stripe_subscription_id,
            stripe_subscription_item_id: gm.stripe_subscription_item_id
          })
        );
        if (!execute) continue;
        await db.query(
          db.isPostgres
            ? `UPDATE gym_memberships SET
                 stripe_subscription_id = NULL,
                 stripe_subscription_item_id = NULL,
                 updated_at = CURRENT_TIMESTAMP
               WHERE id = $1`
            : `UPDATE gym_memberships SET
                 stripe_subscription_id = NULL,
                 stripe_subscription_item_id = NULL,
                 updated_at = datetime('now')
               WHERE id = ?`,
          [gm.id]
        );
        console.log(`[ok] Cleared Stripe subscription fields for gym_memberships.id=${gm.id}`);
      }
    }

    if (!execute) {
      console.log('\nDry run only. Re-run with --execute after verifying output.');
    }
  } finally {
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    } else if (dbConnection && typeof dbConnection.close === 'function') {
      await new Promise((resolve, reject) => dbConnection.close((e) => (e ? reject(e) : resolve())));
    }
  }
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
