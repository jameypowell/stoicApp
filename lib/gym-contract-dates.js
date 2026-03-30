'use strict';

/**
 * Gym membership contract billing dates (app-managed / PaymentIntent flow).
 *
 * Policy: `contract_start_date` / `contract_end_date` are set ONLY from a succeeded
 * payment — never from "signup started" or PaymentIntent.created while still unpaid.
 * Prefer Charge.created over PaymentIntent.created so the anchor is the day money
 * actually moved (PI can remain open for days across failed attempts).
 */

const { DateTime } = require('luxon');
const { AMERICA_DENVER } = require('./mountain-time');

/** Monthly billing window length: 30 calendar days from contract start to next charge date. */
const BILLING_CYCLE_DAYS = 30;

function ymdFromUnixSecondsDenver(unixSeconds) {
  if (unixSeconds == null || !Number.isFinite(Number(unixSeconds))) return null;
  return DateTime.fromSeconds(Number(unixSeconds), { zone: 'utc' })
    .setZone(AMERICA_DENVER)
    .toFormat('yyyy-MM-dd');
}

function addCalendarDaysYmdDenver(ymd, days) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
  const n = Number(days);
  if (!Number.isFinite(n)) return null;
  return DateTime.fromISO(String(ymd), { zone: AMERICA_DENVER })
    .startOf('day')
    .plus({ days: n })
    .toFormat('yyyy-MM-dd');
}

/** Next billing / period end YMD from contract start (monthly gym = 30 calendar days later, Mountain). */
function computeGymContractEndYmdFromStartYmd(startYmd) {
  return addCalendarDaysYmdDenver(startYmd, BILLING_CYCLE_DAYS);
}

/**
 * @param {import('stripe').Stripe} stripe
 * @param {import('stripe').Stripe.PaymentIntent} pi — succeeded intent; expand latest_charge when retrieving for best accuracy
 * @returns {Promise<{ contractStartYmd: string|null, contractEndYmd: string|null }>}
 */
async function getContractStartEndYmdFromSucceededPaymentIntent(stripe, pi) {
  if (!pi || pi.status !== 'succeeded') {
    return { contractStartYmd: null, contractEndYmd: null };
  }
  let ts = pi.created;
  if (pi.latest_charge) {
    if (typeof pi.latest_charge === 'object' && pi.latest_charge.created) {
      ts = pi.latest_charge.created;
    } else if (typeof pi.latest_charge === 'string') {
      try {
        const ch = await stripe.charges.retrieve(pi.latest_charge);
        if (ch && ch.created) ts = ch.created;
      } catch (e) {
        /* use pi.created */
      }
    }
  }
  const contractStartYmd = ymdFromUnixSecondsDenver(ts);
  if (!contractStartYmd) return { contractStartYmd: null, contractEndYmd: null };
  const contractEndYmd = computeGymContractEndYmdFromStartYmd(contractStartYmd);
  return { contractStartYmd, contractEndYmd };
}

module.exports = {
  BILLING_CYCLE_DAYS,
  ymdFromUnixSecondsDenver,
  addCalendarDaysYmdDenver,
  computeGymContractEndYmdFromStartYmd,
  getContractStartEndYmdFromSucceededPaymentIntent
};
