'use strict';

/**
 * Gym membership contract billing dates (app-managed / PaymentIntent flow).
 *
 * Policy: `contract_start_date` / `contract_end_date` are set ONLY from a succeeded
 * payment — never from "signup started" or PaymentIntent.created while still unpaid.
 * Prefer Charge.created over PaymentIntent.created so the anchor is the day money
 * actually moved (PI can remain open for days across failed attempts).
 *
 * Billing cadence (America/Denver): same calendar day each month. If the anchor
 * day is the last day of its month, every renewal is the last day of the following
 * month (e.g. Jan 31 → Feb 28/29 → Mar 31).
 */

const { DateTime } = require('luxon');
const { AMERICA_DENVER } = require('./mountain-time');

/** @deprecated Legacy 30-day window; kept for scripts that still reference the constant. */
const BILLING_CYCLE_DAYS = 30;

function ymdFromUnixSecondsDenver(unixSeconds) {
  if (unixSeconds == null || !Number.isFinite(Number(unixSeconds))) return null;
  return DateTime.fromSeconds(Number(unixSeconds), { zone: 'utc' })
    .setZone(AMERICA_DENVER)
    .toFormat('yyyy-MM-dd');
}

function denverDtFromYmd(ymd) {
  return DateTime.fromISO(String(ymd), { zone: AMERICA_DENVER }).startOf('day');
}

/** True when the anchor date is the last calendar day of its month in Denver (end-of-month billing). */
function isEomAnchorDenver(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return false;
  const dt = denverDtFromYmd(ymd);
  return dt.day === dt.endOf('month').day;
}

/**
 * One monthly billing step: the due date in the calendar month **after** `fromYmd`,
 * using `billingAnchorStartYmd` for day-of-month / end-of-month behavior.
 * @param {string} fromYmd
 * @param {string} billingAnchorStartYmd
 * @returns {string|null} `yyyy-MM-dd`
 */
function advanceOneBillingPeriodDenver(fromYmd, billingAnchorStartYmd) {
  if (!fromYmd || !billingAnchorStartYmd) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(fromYmd)) || !/^\d{4}-\d{2}-\d{2}$/.test(String(billingAnchorStartYmd))) {
    return null;
  }
  const anchor = denverDtFromYmd(billingAnchorStartYmd);
  const from = denverDtFromYmd(fromYmd);
  const eom = isEomAnchorDenver(billingAnchorStartYmd);
  const anchorDay = anchor.day;
  const nextMonthStart = from.startOf('month').plus({ months: 1 });
  let t;
  if (eom) {
    t = nextMonthStart.endOf('month').startOf('day');
  } else {
    const dim = nextMonthStart.daysInMonth;
    t = nextMonthStart.set({ day: Math.min(anchorDay, dim) });
  }
  return t.toFormat('yyyy-MM-dd');
}

/** First period end from first charge day (same anchor for start and billing rule). */
function computeGymContractEndYmdFromStartYmd(startYmd) {
  return advanceOneBillingPeriodDenver(startYmd, startYmd);
}

/**
 * After a successful renewal: next due date from current due + membership anchor.
 * @param {string} currentEndYmd
 * @param {string|null|undefined} contractStartYmd
 */
function nextGymContractEndYmdDenver(currentEndYmd, contractStartYmd) {
  const anchor =
    contractStartYmd && /^\d{4}-\d{2}-\d{2}$/.test(String(contractStartYmd).trim())
      ? String(contractStartYmd).trim()
      : currentEndYmd;
  return advanceOneBillingPeriodDenver(currentEndYmd, anchor);
}

function extractYmdFromDbValue(value) {
  if (value == null) return null;
  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return DateTime.fromJSDate(value, { zone: 'utc' }).setZone(AMERICA_DENVER).toFormat('yyyy-MM-dd');
  }
  const p = String(value).trim().split('T')[0].split(' ')[0];
  return /^\d{4}-\d{2}-\d{2}$/.test(p) ? p : null;
}

/** Prefer contract_start_date; fall back to contract_end_date for legacy rows. */
function gymBillingAnchorYmdFromMembershipRow(m) {
  return extractYmdFromDbValue(m?.contract_start_date) || extractYmdFromDbValue(m?.contract_end_date);
}

/**
 * `contract_start_date` to store after a succeeded charge when the row may still have no anchor.
 * Never replaces an existing start YMD; prefers charge-derived YMD, then billing anchor from the row.
 * @param {object|null|undefined} membership — row before update
 * @param {string|null|undefined} paymentChargeStartYmd — from succeeded PI / Stripe period (Denver YMD)
 */
function gymContractStartYmdToPersistOnPayment(membership, paymentChargeStartYmd) {
  const existing = extractYmdFromDbValue(membership?.contract_start_date);
  if (existing) return existing;
  const pay =
    paymentChargeStartYmd && /^\d{4}-\d{2}-\d{2}$/.test(String(paymentChargeStartYmd).trim())
      ? String(paymentChargeStartYmd).trim()
      : null;
  if (pay) return pay;
  return gymBillingAnchorYmdFromMembershipRow(membership);
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

/** Denver calendar day of an ISO / DB timestamp (UTC-safe). */
function ymdFromJsOrDbTimestampDenver(value) {
  if (value == null) return null;
  const s = String(value).trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
  const dt = DateTime.fromISO(s, { zone: 'utc' });
  if (!dt.isValid) {
    const d2 = DateTime.fromJSDate(value instanceof Date ? value : new Date(value), { zone: 'utc' });
    if (!d2.isValid) return null;
    return d2.setZone(AMERICA_DENVER).toFormat('yyyy-MM-dd');
  }
  return dt.setZone(AMERICA_DENVER).toFormat('yyyy-MM-dd');
}

function isoEndOfDayUtcFromDenverYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
  return DateTime.fromISO(String(ymd), { zone: AMERICA_DENVER }).endOf('day').toUTC().toISO();
}

/** Unix seconds at end of calendar day in Denver (for Stripe period_end-style fields). */
function denverEndOfDayUnixFromYmd(ymd) {
  if (!ymd || !/^\d{4}-\d{2}-\d{2}$/.test(String(ymd))) return null;
  return Math.floor(DateTime.fromISO(String(ymd), { zone: AMERICA_DENVER }).endOf('day').toSeconds());
}

/**
 * Next app subscription `end_date` (ISO UTC end-of-day Denver) from DB row.
 * @param {{ end_date?: any, start_date?: any, created_at?: any }} subscription
 */
function nextAppSubscriptionEndIsoFromRow(subscription) {
  const endYmd = ymdFromJsOrDbTimestampDenver(subscription?.end_date);
  const anchorYmd =
    ymdFromJsOrDbTimestampDenver(subscription?.start_date) ||
    ymdFromJsOrDbTimestampDenver(subscription?.created_at) ||
    endYmd;
  if (!endYmd || !anchorYmd) return null;
  const nextYmd = advanceOneBillingPeriodDenver(endYmd, anchorYmd);
  return isoEndOfDayUtcFromDenverYmd(nextYmd);
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
  advanceOneBillingPeriodDenver,
  computeGymContractEndYmdFromStartYmd,
  nextGymContractEndYmdDenver,
  gymBillingAnchorYmdFromMembershipRow,
  extractYmdFromDbValue,
  gymContractStartYmdToPersistOnPayment,
  ymdFromJsOrDbTimestampDenver,
  isoEndOfDayUtcFromDenverYmd,
  denverEndOfDayUnixFromYmd,
  nextAppSubscriptionEndIsoFromRow,
  isEomAnchorDenver,
  getContractStartEndYmdFromSucceededPaymentIntent
};
