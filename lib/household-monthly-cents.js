/**
 * Household billing: list prices, proportional discount split, and per-account monthly_amount_cents.
 * Primary's Stripe charge = SUM(monthly_amount_cents) for all rows sharing family_group_id.
 */
const membershipRules = require('../membership-rules.json');

function immediateFamilyLineCents(rules) {
  const r = rules || membershipRules;
  return ((r.membershipTypes || {}).IMMEDIATE_FAMILY?.basePrice ?? 50) * 100;
}

function basePriceCentsForPrimaryType(primaryMembershipTypeDb, rules) {
  const r = rules || membershipRules;
  const mt = String(primaryMembershipTypeDb || '').toLowerCase();
  if (mt === 'entire_family') return ((r.membershipTypes || {}).FULL_FAMILY?.basePrice ?? 185) * 100;
  if (mt === 'expecting_or_recovering_mother') {
    return ((r.membershipTypes || {}).EXPECTING_RECOVERING?.basePrice ?? 30) * 100;
  }
  return ((r.membershipTypes || {}).STANDARD?.basePrice ?? 65) * 100;
}

function basePriceCentsForMembershipType(membershipTypeDb, rules) {
  const r = rules || membershipRules;
  const mt = String(membershipTypeDb || '').toLowerCase();
  if (mt === 'immediate_family_member') return immediateFamilyLineCents(r);
  if (mt === 'expecting_or_recovering_mother') {
    return ((r.membershipTypes || {}).EXPECTING_RECOVERING?.basePrice ?? 30) * 100;
  }
  if (mt === 'entire_family') return ((r.membershipTypes || {}).FULL_FAMILY?.basePrice ?? 185) * 100;
  return ((r.membershipTypes || {}).STANDARD?.basePrice ?? 65) * 100;
}

function totalDiscountCents(discount1Cents, discount2Cents, discount3Cents) {
  return (
    Math.abs(parseInt(discount1Cents, 10) || 0) +
    Math.abs(parseInt(discount2Cents, 10) || 0) +
    Math.abs(parseInt(discount3Cents, 10) || 0)
  );
}

/**
 * Split (S − D) across lines in proportion to each line's list price. Integer cents; sum(result) = S − min(D,S).
 */
function allocateProportionalDiscountNets(baseCentsList, discountTotalCents) {
  const S = baseCentsList.reduce((a, b) => a + b, 0);
  if (S <= 0) return baseCentsList.map(() => 0);
  const D = Math.min(Math.max(0, discountTotalCents), S);
  const targetTotal = S - D;
  const exact = baseCentsList.map((b) => (b / S) * targetTotal);
  const nets = exact.map((x) => Math.floor(x));
  let rem = targetTotal - nets.reduce((a, b) => a + b, 0);
  const fracs = exact
    .map((x, i) => ({ i, frac: x - Math.floor(x) }))
    .sort((a, b) => b.frac - a.frac);
  for (let k = 0; k < rem; k++) {
    nets[fracs[k].i]++;
  }
  return nets;
}

function buildHouseholdBaseLines(primaryEmail, primaryMembershipTypeDb, householdMembers, rules) {
  const pe = String(primaryEmail || '').trim().toLowerCase();
  const r = rules || membershipRules;
  const lines = [
    {
      role: 'primary',
      email: pe,
      membership_type: primaryMembershipTypeDb,
      baseCents: basePriceCentsForPrimaryType(primaryMembershipTypeDb, r)
    }
  ];
  const list = Array.isArray(householdMembers) ? householdMembers : [];
  for (const h of list) {
    const em = String(h.email || '').trim().toLowerCase();
    if (!em || em === pe) continue;
    const mt = h.membership_type || 'immediate_family_member';
    lines.push({
      role: 'dependent',
      email: em,
      membership_type: mt,
      baseCents: basePriceCentsForMembershipType(mt, r)
    });
  }
  return lines;
}

/**
 * Per-line nets after proportional discount; invoiceTotalCents = sum of nets (what primary pays in one charge).
 */
function allocateHouseholdMonthlyLines({
  primaryEmail,
  primaryMembershipTypeDb,
  householdMembers,
  discount1Cents,
  discount2Cents,
  discount3Cents,
  rules
}) {
  const r = rules || membershipRules;
  const linesMeta = buildHouseholdBaseLines(primaryEmail, primaryMembershipTypeDb, householdMembers, r);
  const bases = linesMeta.map((l) => l.baseCents);
  const D = totalDiscountCents(discount1Cents, discount2Cents, discount3Cents);
  const nets = allocateProportionalDiscountNets(bases, D);
  const lines = linesMeta.map((l, i) => ({
    ...l,
    netCents: nets[i]
  }));
  const invoiceTotalCents = nets.reduce((a, b) => a + b, 0);
  return { lines, invoiceTotalCents };
}

/** Invoice total (same as sum of per-line nets) for admin add-member / pending record. */
function computeHouseholdMonthlyAmountCents({
  primaryEmail,
  primaryMembershipTypeDb,
  householdMembers,
  discount1Cents,
  discount2Cents,
  discount3Cents,
  rules
}) {
  const { invoiceTotalCents } = allocateHouseholdMonthlyLines({
    primaryEmail,
    primaryMembershipTypeDb,
    householdMembers,
    discount1Cents,
    discount2Cents,
    discount3Cents,
    rules
  });
  return invoiceTotalCents;
}

function sumListCentsForHouseholdMembershipRows(rows, rules) {
  const r = rules || membershipRules;
  let sum = 0;
  for (const row of rows || []) {
    sum += basePriceCentsForMembershipType(row.membership_type, r);
  }
  return sum;
}

module.exports = {
  membershipRules,
  immediateFamilyLineCents,
  basePriceCentsForPrimaryType,
  basePriceCentsForMembershipType,
  totalDiscountCents,
  allocateProportionalDiscountNets,
  allocateHouseholdMonthlyLines,
  computeHouseholdMonthlyAmountCents,
  sumListCentsForHouseholdMembershipRows
};
