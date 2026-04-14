/**
 * Normalize gym_memberships.discount_name for API/UI. Some legacy rows use labels like
 * "Family Percentage Discount (10%)" for the same meaning as loyalty / list-vs-actual pricing.
 */
function normalizeGymDiscountDisplayName(raw) {
  if (raw == null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  if (/family\s*percentage\s*discount/i.test(s)) return 'Loyalty (original price)';
  if (/^loyalty\s*discount\s*\(\s*original\s*price\s*\)\s*$/i.test(s)) return 'Loyalty (original price)';
  return s;
}

module.exports = { normalizeGymDiscountDisplayName };
