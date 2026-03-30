const { describe, it } = require('mocha');
const { expect } = require('chai');

const {
  tierFromStripeSubscription,
  resolveStripeStatusForMemberUi
} = require('../stripe-subscription-resolve');

describe('Stripe Subscription Resolve', () => {
  it('prefers price-id tier over stale subscription metadata tier', () => {
    const sub = {
      metadata: { tier: 'tier_four' },
      items: {
        data: [
          {
            price: {
              id: 'price_1SUwEpF0CLysN1jANPvhIp7s' // tier_two
            }
          }
        ]
      }
    };
    expect(tierFromStripeSubscription(sub)).to.equal('tier_two');
  });

  it('maps incomplete + active trial to trialing for member UI', () => {
    const sub = {
      status: 'incomplete',
      trial_end: Math.floor(Date.now() / 1000) + 86400
    };
    const resolved = resolveStripeStatusForMemberUi(sub);
    expect(resolved.raw).to.equal('incomplete');
    expect(resolved.ui).to.equal('trialing');
  });

  it('maps incomplete + payment method on file to active when no trial', () => {
    const sub = {
      status: 'incomplete',
      trial_end: null,
      default_payment_method: null,
      latest_invoice: { status: 'open' }
    };
    const resolved = resolveStripeStatusForMemberUi(sub, { customerHasPaymentMethod: true });
    expect(resolved.ui).to.equal('active');
  });
});
