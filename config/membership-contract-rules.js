/**
 * Shared contract / payment rule helpers (single source aligned with membership-rules.json).
 * Used by routes.js for /gym-memberships/me and other API responses.
 */

function loadMembershipRules() {
  try {
    return require('../membership-rules.json');
  } catch (e) {
    return {};
  }
}

function getDefaultPaymentRules() {
  const r = loadMembershipRules();
  const pr = r.paymentRules || {};
  return {
    gracePeriodDays: typeof pr.gracePeriodDays === 'number' ? pr.gracePeriodDays : 10,
    lateFee: typeof pr.lateFee === 'number' ? pr.lateFee : 15
  };
}

function getContractRules() {
  const r = loadMembershipRules();
  const cr = r.contractRules || {};
  return {
    defaultContractMonths: typeof cr.defaultContractMonths === 'number' ? cr.defaultContractMonths : 12,
    earlyCancellationFeeMonths: typeof cr.earlyCancellationFeeMonths === 'number' ? cr.earlyCancellationFeeMonths : 2,
    earlyCancellationFeeMinimumDollars:
      typeof cr.earlyCancellationFeeMinimumDollars === 'number' ? cr.earlyCancellationFeeMinimumDollars : 100
  };
}

/**
 * YYYY-MM-DD + calendar months → YYYY-MM-DD (term obligation end; typically same day next year for 12 months).
 */
function computeContractTermEndYmd(contractStartYmd, contractMonths) {
  if (!contractStartYmd) return null;
  const raw = String(contractStartYmd).trim().split('T')[0].split(' ')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) return null;
  const [y, m, d] = raw.split('-').map(Number);
  const months = contractMonths && contractMonths > 0 ? contractMonths : 12;
  const dt = new Date(y, m - 1 + months, d);
  if (isNaN(dt.getTime())) return null;
  const yy = dt.getFullYear();
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${yy}-${mm}-${dd}`;
}

/**
 * Early cancellation fee = max(minimum, 2 × monthly amount in cents) by default.
 */
function computeEarlyCancellationFeeCents(monthlyAmountCents) {
  const { earlyCancellationFeeMonths, earlyCancellationFeeMinimumDollars } = getContractRules();
  const minCents = Math.round(earlyCancellationFeeMinimumDollars * 100);
  if (monthlyAmountCents == null || monthlyAmountCents < 0) return minCents;
  const mult = Math.round(earlyCancellationFeeMonths * monthlyAmountCents);
  return Math.max(minCents, mult);
}

function formatMoneyFromCents(cents) {
  const n = Math.round(Number(cents) || 0);
  return `$${(n / 100).toFixed(2)}`;
}

function buildEarlyCancellationCopy(monthlyAmountCents, earlyFeeCents, termMonths) {
  const cr = getContractRules();
  const { earlyCancellationFeeMonths, earlyCancellationFeeMinimumDollars } = cr;
  const months = termMonths && termMonths > 0 ? termMonths : cr.defaultContractMonths;
  const monthlyD = (monthlyAmountCents != null && monthlyAmountCents >= 0)
    ? (monthlyAmountCents / 100).toFixed(2)
    : null;
  const feeDisplay = formatMoneyFromCents(earlyFeeCents);
  const minStr = `$${Number(earlyCancellationFeeMinimumDollars).toFixed(2)}`;
  let summary = `If you cancel before your ${months}-month term ends, an early cancellation fee of ${feeDisplay} will be charged immediately.`;
  if (monthlyD != null) {
    // Shown after "Early cancellation:" in UI — describes formula + floor (actual charge is early_cancellation_fee_cents).
    summary = `Early cancellation fee: ${earlyCancellationFeeMonths}× your monthly rate, or a minimum of ${minStr}.`;
  }
  return {
    early_cancellation_fee_display: feeDisplay,
    early_cancellation_summary: summary
  };
}

module.exports = {
  loadMembershipRules,
  getDefaultPaymentRules,
  getContractRules,
  computeContractTermEndYmd,
  computeEarlyCancellationFeeCents,
  formatMoneyFromCents,
  buildEarlyCancellationCopy
};
