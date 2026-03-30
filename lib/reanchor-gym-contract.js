'use strict';

/**
 * One-off / admin: set gym_memberships.contract_* from the first successful
 * Stripe PaymentIntent with metadata.type=gym_membership, or from an explicit start date.
 */

const {
  getContractStartEndYmdFromSucceededPaymentIntent,
  addCalendarDaysYmdDenver,
  BILLING_CYCLE_DAYS
} = require('./gym-contract-dates');

/**
 * Collect succeeded gym_membership PIs for a user across one or more Stripe customer IDs.
 * @param {import('stripe').Stripe} stripe
 * @param {number} userId
 * @param {string[]} customerIds - deduped non-empty strings
 * @returns {Promise<import('stripe').Stripe.PaymentIntent[]>}
 */
async function listSucceededGymMembershipPaymentIntents(stripe, userId, customerIds) {
  const seen = new Set();
  const ids = [...new Set((customerIds || []).filter(Boolean).map((c) => String(c).trim()))];
  const out = [];
  for (const customer of ids) {
    let startingAfter = null;
    for (;;) {
      const list = await stripe.paymentIntents.list({
        customer,
        limit: 100,
        ...(startingAfter ? { starting_after: startingAfter } : {})
      });
      for (const pi of list.data) {
        if (pi.status !== 'succeeded') continue;
        if (String(pi.metadata?.type || '') !== 'gym_membership') continue;
        if (pi.metadata?.userId && String(pi.metadata.userId) !== String(userId)) continue;
        if (seen.has(pi.id)) continue;
        seen.add(pi.id);
        out.push(pi);
      }
      if (!list.has_more) break;
      startingAfter = list.data[list.data.length - 1].id;
    }
  }
  out.sort((a, b) => a.created - b.created);
  return out;
}

/**
 * Earliest succeeded gym_membership PI for this user (any of the given customers).
 */
async function getEarliestSucceededGymMembershipPI(stripe, userId, customerIds) {
  const list = await listSucceededGymMembershipPaymentIntents(stripe, userId, customerIds);
  return list[0] || null;
}

/**
 * @param {import('stripe').Stripe} stripe
 * @param {object} db - Database with isPostgres, query, queryOne
 * @param {string} email
 * @param {{ manualStartYmd?: string|null, dryRun?: boolean }} [options]
 * @returns {Promise<{
 *   ok: boolean,
 *   email: string,
 *   userId: number|null,
 *   membershipId: number|null,
 *   source: 'stripe'|'manual'|'none',
 *   paymentIntentId: string|null,
 *   before: { contract_start_date: any, contract_end_date: any },
 *   after: { contract_start_date: string|null, contract_end_date: string|null },
 *   message: string
 * }>}
 */
async function reanchorGymContractForEmail(stripe, db, email, options = {}) {
  const dryRun = !!options.dryRun;
  const manualStartYmd = options.manualStartYmd && /^\d{4}-\d{2}-\d{2}$/.test(String(options.manualStartYmd).trim())
    ? String(options.manualStartYmd).trim()
    : null;

  const em = String(email || '').trim().toLowerCase();
  const user = await db.queryOne(
    db.isPostgres ? 'SELECT id, email, stripe_customer_id FROM users WHERE LOWER(email) = $1' : 'SELECT id, email, stripe_customer_id FROM users WHERE LOWER(email) = ?',
    [em]
  );
  if (!user) {
    return {
      ok: false,
      email: em,
      userId: null,
      membershipId: null,
      source: 'none',
      paymentIntentId: null,
      before: {},
      after: {},
      message: 'User not found'
    };
  }

  const membership = await db.queryOne(
    db.isPostgres
      ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
      : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
    [user.id]
  );
  if (!membership) {
    return {
      ok: false,
      email: em,
      userId: user.id,
      membershipId: null,
      source: 'none',
      paymentIntentId: null,
      before: {},
      after: {},
      message: 'No gym_memberships row'
    };
  }

  const before = {
    contract_start_date: membership.contract_start_date,
    contract_end_date: membership.contract_end_date
  };

  let contractStartYmd = manualStartYmd;
  let contractEndYmd = manualStartYmd ? addCalendarDaysYmdDenver(manualStartYmd, BILLING_CYCLE_DAYS) : null;
  let source = manualStartYmd ? 'manual' : 'none';
  let paymentIntentId = null;

  if (!manualStartYmd) {
    const customers = [membership.stripe_customer_id, user.stripe_customer_id].filter(Boolean);
    const earliest = await getEarliestSucceededGymMembershipPI(stripe, user.id, customers);
    if (!earliest) {
      return {
        ok: false,
        email: em,
        userId: user.id,
        membershipId: membership.id,
        source: 'none',
        paymentIntentId: null,
        before,
        after: { contract_start_date: null, contract_end_date: null },
        message: 'No succeeded PaymentIntent with metadata.type=gym_membership found. Pass manualStartYmd (YYYY-MM-DD) or charge the member once.'
      };
    }
    paymentIntentId = earliest.id;
    const piFull = await stripe.paymentIntents.retrieve(earliest.id, { expand: ['latest_charge'] });
    const dates = await getContractStartEndYmdFromSucceededPaymentIntent(stripe, piFull);
    contractStartYmd = dates.contractStartYmd;
    contractEndYmd = dates.contractEndYmd;
    source = 'stripe';
  }

  if (!contractStartYmd || !contractEndYmd) {
    return {
      ok: false,
      email: em,
      userId: user.id,
      membershipId: membership.id,
      source,
      paymentIntentId,
      stripeSubscriptionId: membership.stripe_subscription_id || null,
      before,
      after: { contract_start_date: contractStartYmd, contract_end_date: contractEndYmd },
      message: 'Could not compute contract dates'
    };
  }

  let extraNote = '';
  if (membership.stripe_subscription_id) {
    extraNote =
      ' Note: This row has stripe_subscription_id — invoice webhooks may resync contract dates from Stripe subscription periods until Stripe is aligned.';
  }

  if (!dryRun) {
    await db.query(
      db.isPostgres
        ? 'UPDATE gym_memberships SET contract_start_date = $1, contract_end_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3'
        : "UPDATE gym_memberships SET contract_start_date = ?, contract_end_date = ?, updated_at = datetime('now') WHERE id = ?",
      [contractStartYmd, contractEndYmd, membership.id]
    );
  }

  return {
    ok: true,
    email: em,
    userId: user.id,
    membershipId: membership.id,
    source,
    paymentIntentId,
    stripeSubscriptionId: membership.stripe_subscription_id || null,
    before,
    after: { contract_start_date: contractStartYmd, contract_end_date: contractEndYmd },
    message:
      (dryRun ? 'Dry run — no DB write' : 'Updated gym_memberships contract dates') + extraNote
  };
}

module.exports = {
  listSucceededGymMembershipPaymentIntents,
  getEarliestSucceededGymMembershipPI,
  reanchorGymContractForEmail
};
