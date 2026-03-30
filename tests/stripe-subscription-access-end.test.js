const { describe, it } = require('mocha');
const { expect } = require('chai');

const { stripeSubscriptionAccessEndIso } = require('../subscription-sync');

describe('stripeSubscriptionAccessEndIso', () => {
  it('uses trial_end for trialing subscriptions', () => {
    const trialEnd = 1800000000;
    const iso = stripeSubscriptionAccessEndIso({
      status: 'trialing',
      trial_end: trialEnd,
      current_period_end: trialEnd + 86400
    });
    expect(iso).to.equal(new Date(trialEnd * 1000).toISOString());
  });

  it('uses trial_end for incomplete checkout while trial is in the future', () => {
    const now = Math.floor(Date.now() / 1000);
    const trialEnd = now + 3 * 86400;
    const iso = stripeSubscriptionAccessEndIso({
      status: 'incomplete',
      trial_end: trialEnd,
      current_period_end: now + 7 * 86400
    });
    expect(iso).to.equal(new Date(trialEnd * 1000).toISOString());
  });

  it('uses current_period_end for active paid after trial', () => {
    const periodEnd = 1800000000;
    const iso = stripeSubscriptionAccessEndIso({
      status: 'active',
      trial_end: null,
      current_period_end: periodEnd
    });
    expect(iso).to.equal(new Date(periodEnd * 1000).toISOString());
  });
});
