'use strict';

/**
 * Stoic Fit operates in America/Denver (Mountain Time) for member-facing dates.
 * Use these helpers when persisting "end of day" boundaries so ECS (UTC) does not shift calendar days.
 */

const { DateTime } = require('luxon');

const AMERICA_DENVER = 'America/Denver';

/**
 * ISO timestamp (UTC) for end of the calendar day in Denver that is `days` after "now" in Denver.
 * Example: Mar 16 afternoon → +10 days → end of Mar 26 in Denver (not UTC midnight).
 *
 * @param {number} days - e.g. tier_one subscriptionDays (10)
 * @returns {string}
 */
function endOfDayDenverPlusCalendarDays(days) {
  const end = DateTime.now().setZone(AMERICA_DENVER).plus({ days }).endOf('day');
  return end.toUTC().toISO();
}

/**
 * ISO timestamp for end of the calendar day in Denver that is `days` after the start of "today" in Denver.
 * Used for staff renewal windows (e.g. +30 days from start of today).
 *
 * @param {number} days
 * @returns {string}
 */
function endOfDayDenverPlusDaysFromStartOfToday(days) {
  const end = DateTime.now().setZone(AMERICA_DENVER).startOf('day').plus({ days }).endOf('day');
  return end.toUTC().toISO();
}

/**
 * Interpret gym date fields as a calendar day in America/Denver (not the wall-clock from a UTC instant).
 * Postgres DATE is often UTC midnight — we use UTC Y/M/D or a leading YYYY-MM-DD string as the business date.
 */
function parseGymAnchorToDenverStart(anchorDate) {
  if (anchorDate == null || anchorDate === '') return null;
  if (typeof anchorDate === 'string') {
    const m = anchorDate.match(/^(\d{4})-(\d{2})-(\d{2})/);
    if (m) {
      const start = DateTime.fromObject(
        { year: +m[1], month: +m[2], day: +m[3] },
        { zone: AMERICA_DENVER }
      ).startOf('day');
      return start.isValid ? start : null;
    }
  }
  const d = new Date(anchorDate);
  if (Number.isNaN(d.getTime())) return null;
  // Postgres DATE serializes as UTC midnight — use that calendar day as the business date.
  // Full timestamps (e.g. created_at): use the calendar day in Mountain Time for that instant.
  const isUtcMidnight =
    d.getUTCHours() === 0 &&
    d.getUTCMinutes() === 0 &&
    d.getUTCSeconds() === 0 &&
    d.getUTCMilliseconds() === 0;
  if (isUtcMidnight) {
    const y = d.getUTCFullYear();
    const mo = d.getUTCMonth() + 1;
    const day = d.getUTCDate();
    const start = DateTime.fromObject({ year: y, month: mo, day }, { zone: AMERICA_DENVER }).startOf('day');
    return start.isValid ? start : null;
  }
  const dt = DateTime.fromJSDate(d).setZone(AMERICA_DENVER);
  const start = DateTime.fromObject(
    { year: dt.year, month: dt.month, day: dt.day },
    { zone: AMERICA_DENVER }
  ).startOf('day');
  return start.isValid ? start : null;
}

/**
 * Tier One app trial end: end of calendar day in Denver on (anchor + subscriptionDays) using normal calendar math.
 * Anchor is typically gym_memberships.contract_start_date (else start_date / created_at).
 * If anchor is missing, uses "today + days" (same as endOfDayDenverPlusCalendarDays).
 * If anchor+days is already in the past, falls back to "today + days" so late fixes still grant access.
 *
 * @param {Date|string|null|undefined} anchorDate
 * @param {number} subscriptionDays - e.g. 10 from tier-access-config
 * @returns {string} ISO UTC
 */
function tierOneEndIsoFromGymContractAnchor(anchorDate, subscriptionDays) {
  const days = Number(subscriptionDays);
  if (!Number.isFinite(days) || days < 0) {
    return endOfDayDenverPlusCalendarDays(10);
  }
  const start = parseGymAnchorToDenverStart(anchorDate);
  if (!start) {
    return endOfDayDenverPlusCalendarDays(days);
  }
  const end = start.plus({ days }).endOf('day');
  if (end.toMillis() <= Date.now()) {
    return endOfDayDenverPlusCalendarDays(days);
  }
  return end.toUTC().toISO();
}

/** YYYY-MM-DD in America/Denver for subscription end_date / DB values (string or Date). */
function subscriptionEndToYmdDenver(endValue) {
  const start = parseGymAnchorToDenverStart(endValue);
  if (!start) return null;
  return start.toFormat('yyyy-MM-dd');
}

/** Today's calendar date in America/Denver (for billing overdue checks on ECS UTC). */
function todayYmdDenver() {
  return DateTime.now().setZone(AMERICA_DENVER).toFormat('yyyy-MM-dd');
}

/** Add N calendar days to a YYYY-MM-DD interpreted in America/Denver (month lengths respected). */
function ymdPlusCalendarDaysDenver(ymd, days) {
  const m = String(ymd || '').trim().match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!m) return null;
  const n = Number(days);
  if (!Number.isFinite(n)) return null;
  const dt = DateTime.fromObject(
    { year: +m[1], month: +m[2], day: +m[3] },
    { zone: AMERICA_DENVER }
  ).plus({ days: n });
  return dt.isValid ? dt.toFormat('yyyy-MM-dd') : null;
}

module.exports = {
  AMERICA_DENVER,
  endOfDayDenverPlusCalendarDays,
  endOfDayDenverPlusDaysFromStartOfToday,
  parseGymAnchorToDenverStart,
  tierOneEndIsoFromGymContractAnchor,
  subscriptionEndToYmdDenver,
  todayYmdDenver,
  ymdPlusCalendarDaysDenver
};
