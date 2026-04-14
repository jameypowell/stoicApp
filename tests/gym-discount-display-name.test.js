const { describe, it } = require('mocha');
const { expect } = require('chai');
const { normalizeGymDiscountDisplayName } = require('../lib/gym-discount-display-name');

describe('normalizeGymDiscountDisplayName', () => {
  it('maps legacy family percentage label to loyalty original price', () => {
    expect(normalizeGymDiscountDisplayName('Family Percentage Discount (10%)')).to.equal(
      'Loyalty (original price)'
    );
  });

  it('maps Loyalty Discount (original price) to short label', () => {
    expect(normalizeGymDiscountDisplayName('Loyalty Discount (original price)')).to.equal(
      'Loyalty (original price)'
    );
  });

  it('passes through other labels', () => {
    expect(normalizeGymDiscountDisplayName('Staff discount')).to.equal('Staff discount');
  });

  it('returns null for null/empty', () => {
    expect(normalizeGymDiscountDisplayName(null)).to.equal(null);
    expect(normalizeGymDiscountDisplayName('')).to.equal(null);
  });
});
