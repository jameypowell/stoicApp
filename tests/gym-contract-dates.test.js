'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  computeGymContractEndYmdFromStartYmd,
  advanceOneBillingPeriodDenver,
  nextGymContractEndYmdDenver,
  isEomAnchorDenver,
  gymContractStartYmdToPersistOnPayment,
  extractYmdFromDbValue,
  gymBillingAnchorYmdFromMembershipRow,
  nextAppSubscriptionEndIsoFromRow,
  addCalendarDaysYmdDenver,
  BILLING_CYCLE_DAYS
} = require('../lib/gym-contract-dates');

test('Jan 15 anchor → first end Feb 15', () => {
  assert.equal(computeGymContractEndYmdFromStartYmd('2025-01-15'), '2025-02-15');
});

test('Jan 31 is end-of-month anchor', () => {
  assert.equal(isEomAnchorDenver('2025-01-31'), true);
});

test('Jan 31 → Feb last day → Mar 31 chain', () => {
  assert.equal(computeGymContractEndYmdFromStartYmd('2025-01-31'), '2025-02-28');
  assert.equal(nextGymContractEndYmdDenver('2025-02-28', '2025-01-31'), '2025-03-31');
});

test('Jan 30 non-EOM → Feb 28 → Mar 30', () => {
  assert.equal(isEomAnchorDenver('2025-01-30'), false);
  assert.equal(computeGymContractEndYmdFromStartYmd('2025-01-30'), '2025-02-28');
  assert.equal(nextGymContractEndYmdDenver('2025-02-28', '2025-01-30'), '2025-03-30');
});

test('advance one period from arbitrary due date', () => {
  assert.equal(advanceOneBillingPeriodDenver('2025-04-15', '2025-01-15'), '2025-05-15');
});

test('gymContractStartYmdToPersistOnPayment keeps existing start', () => {
  assert.equal(
    gymContractStartYmdToPersistOnPayment({ contract_start_date: '2024-06-01' }, '2025-01-15'),
    '2024-06-01'
  );
});

test('gymContractStartYmdToPersistOnPayment fills from charge when start null', () => {
  assert.equal(
    gymContractStartYmdToPersistOnPayment({ contract_start_date: null, contract_end_date: '2025-03-15' }, '2025-02-10'),
    '2025-02-10'
  );
});

test('gymContractStartYmdToPersistOnPayment falls back to anchor when no charge ymd', () => {
  assert.equal(
    gymContractStartYmdToPersistOnPayment({ contract_start_date: null, contract_end_date: '2025-03-15' }, null),
    '2025-03-15'
  );
});

test('extractYmdFromDbValue handles JS Date (node-pg)', () => {
  const y = extractYmdFromDbValue(new Date('2026-04-13T06:00:00.000Z'));
  assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(y));
});

test('extractYmdFromDbValue handles plain YYYY-MM-DD', () => {
  assert.equal(extractYmdFromDbValue('2026-05-13'), '2026-05-13');
});

test('gymBillingAnchorYmdFromMembershipRow prefers start over end', () => {
  assert.equal(
    gymBillingAnchorYmdFromMembershipRow({
      contract_start_date: '2025-01-10',
      contract_end_date: '2025-02-10'
    }),
    '2025-01-10'
  );
  assert.equal(
    gymBillingAnchorYmdFromMembershipRow({
      contract_start_date: null,
      contract_end_date: '2025-02-10'
    }),
    '2025-02-10'
  );
});

test('leap year: Jan 31 anchor → Feb 29 (2024)', () => {
  assert.equal(computeGymContractEndYmdFromStartYmd('2024-01-31'), '2024-02-29');
  assert.equal(nextGymContractEndYmdDenver('2024-02-29', '2024-01-31'), '2024-03-31');
});

test('legacy +30 vs calendar next from same due (Jake-style drift)', () => {
  const end = '2026-05-02';
  const anchor = '2026-03-03';
  const calendarNext = nextGymContractEndYmdDenver(end, anchor);
  const legacyNext = addCalendarDaysYmdDenver(end, BILLING_CYCLE_DAYS);
  assert.equal(calendarNext, '2026-06-03');
  assert.equal(legacyNext, '2026-06-01');
  assert.notEqual(calendarNext, legacyNext);
});

test('nextAppSubscriptionEndIsoFromRow advances one Denver month from end_date', () => {
  const iso = nextAppSubscriptionEndIsoFromRow({
    end_date: '2026-04-15',
    start_date: '2026-01-15',
    created_at: '2026-01-01'
  });
  assert.ok(iso && iso.includes('T'), iso);
  // May 15 end-of-day Denver → UTC can read as May 15 or 16 depending on offset
  assert.ok(/2026-05-(15|16)/.test(iso), iso);
});
