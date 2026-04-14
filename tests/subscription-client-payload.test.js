const { describe, it } = require('mocha');
const { expect } = require('chai');

const { buildSubscriptionClientPayload } = require('../subscription-client-payload');

function makeStripeMock({ sub, customer, cards = [], bankAccounts = [] }) {
  return {
    subscriptions: {
      retrieve: async () => sub
    },
    customers: {
      retrieve: async () => customer || { invoice_settings: {} }
    },
    paymentMethods: {
      list: async ({ type }) => {
        if (type === 'card') return { data: cards };
        if (type === 'us_bank_account') return { data: bankAccounts };
        return { data: [] };
      }
    }
  };
}

describe('Subscription Client Payload', () => {
  it('does not show app payment banner for trialing users', async () => {
    const stripe = makeStripeMock({
      sub: {
        status: 'trialing',
        trial_end: Math.floor(Date.now() / 1000) + 86400,
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 14,
        customer: 'cus_123',
        items: { data: [{ price: { id: 'price_1SUwEpF0CLysN1jANPvhIp7s' } }] }
      },
      cards: []
    });
    const db = {
      updateSubscription: async () => ({ changes: 1 })
    };
    const subscription = {
      id: 1,
      tier: 'tier_four',
      status: 'active',
      end_date: new Date(Date.now() + 86400000).toISOString(),
      stripe_subscription_id: 'sub_123'
    };
    const user = { role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(payload.tier).to.equal('tier_two'); // from price id
    expect(payload.stripe_status).to.equal('trialing');
    expect(payload.app_payment_banner).to.equal(false);
    expect(payload.app_show_trial_message).to.equal(true);
    expect(payload.app_status_display).to.equal('Free Trial');
  });

  it('does not show app payment banner when gym membership has a saved payment_method_id (cross-context)', async () => {
    const stripe = makeStripeMock({
      sub: {
        status: 'active',
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        customer: 'cus_app_only',
        items: { data: [{ price: { id: 'price_1SUwH8F0CLysN1jAvy1aMz3E' } }] }
      },
      cards: []
    });
    const db = {
      updateSubscription: async () => ({ changes: 1 }),
      isPostgres: true,
      queryOne: async (sql) => {
        if (String(sql).includes('gym_memberships')) {
          return { payment_method_id: 'pm_gym_saved', stripe_customer_id: 'cus_gym' };
        }
        return null;
      }
    };
    const subscription = {
      id: 201,
      tier: 'tier_four',
      status: 'active',
      end_date: new Date(Date.now() + 86400000).toISOString(),
      stripe_subscription_id: 'sub_cross_ctx'
    };
    const user = { id: 42, role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(payload.has_payment_method).to.equal(true);
    expect(payload.app_payment_banner).to.equal(false);
  });

  it('shows app payment banner only for non-trial paid app subscription with no PM', async () => {
    const stripe = makeStripeMock({
      sub: {
        status: 'active',
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 30,
        customer: 'cus_456',
        items: { data: [{ price: { id: 'price_1SUwH8F0CLysN1jAvy1aMz3E' } }] }
      },
      cards: []
    });
    const db = {
      updateSubscription: async () => ({ changes: 1 })
    };
    const subscription = {
      id: 2,
      tier: 'tier_four',
      status: 'active',
      end_date: new Date(Date.now() + 86400000).toISOString(),
      stripe_subscription_id: 'sub_456'
    };
    const user = { role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(payload.stripe_status).to.equal('active');
    expect(payload.has_payment_method).to.equal(false);
    expect(payload.app_payment_banner).to.equal(true);
    expect(payload.app_show_trial_message).to.equal(false);
  });

  it('treats incomplete with future end date as trialing UI state and hides banner', async () => {
    const stripe = makeStripeMock({
      sub: {
        status: 'incomplete',
        trial_end: Math.floor(Date.now() / 1000) + 86400,
        current_period_end: Math.floor(Date.now() / 1000) + 86400 * 14,
        customer: 'cus_789',
        items: { data: [{ price: { id: 'price_1SUwG8F0CLysN1jA367NrtiT' } }] }
      },
      cards: []
    });
    const db = {
      updateSubscription: async () => ({ changes: 1 })
    };
    const subscription = {
      id: 3,
      tier: 'tier_three',
      status: 'active',
      end_date: new Date(Date.now() + 86400000).toISOString(),
      stripe_subscription_id: 'sub_789'
    };
    const user = { role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(payload.stripe_status).to.equal('trialing');
    expect(payload.app_show_trial_message).to.equal(true);
    expect(payload.app_status_display).to.equal('Free Trial');
    expect(payload.app_payment_banner).to.equal(false);
  });

  it('uses trial_end for end_date when DB row is earlier than Stripe trial (trial window)', async () => {
    const trialEndSec = Math.floor(Date.now() / 1000) + 86400 * 5;
    const stripe = makeStripeMock({
      sub: {
        status: 'trialing',
        trial_end: trialEndSec,
        current_period_end: trialEndSec,
        customer: 'cus_trial',
        items: { data: [{ price: { id: 'price_1SUwH8F0CLysN1jAvy1aMz3E' } }] }
      },
      cards: [{ id: 'pm_1' }]
    });
    let healed = null;
    const db = {
      updateSubscription: async (id, patch) => {
        healed = patch.end_date;
        return { changes: 1 };
      }
    };
    // DB was wrong: ends *before* Stripe trial (e.g. stale sync or bad row)
    const subscription = {
      id: 77,
      tier: 'tier_four',
      status: 'active',
      end_date: new Date((trialEndSec - 3 * 86400) * 1000).toISOString(),
      stripe_subscription_id: 'sub_trial'
    };
    const user = { role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(new Date(payload.end_date).getTime()).to.equal(new Date(trialEndSec * 1000).getTime());
    expect(healed).to.be.a('string');
  });

  it('uses Stripe current_period_end for end_date when DB row is stale', async () => {
    const periodEndSec = Math.floor(Date.now() / 1000) + 86400 * 5;
    const stripe = makeStripeMock({
      sub: {
        status: 'active',
        trial_end: null,
        current_period_end: periodEndSec,
        customer: 'cus_stale',
        items: { data: [{ price: { id: 'price_1SUwH8F0CLysN1jAvy1aMz3E' } }] }
      },
      cards: [{ id: 'pm_1' }]
    });
    let updatedEnd = null;
    const db = {
      updateSubscription: async (id, patch) => {
        updatedEnd = patch.end_date;
        return { changes: 1 };
      }
    };
    const subscription = {
      id: 42,
      tier: 'tier_three',
      status: 'active',
      // Legacy bug: +30 days from Stripe
      end_date: new Date((periodEndSec + 30 * 86400) * 1000).toISOString(),
      stripe_subscription_id: 'sub_stale'
    };
    const user = { role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(new Date(payload.end_date).getTime()).to.equal(new Date(periodEndSec * 1000).getTime());
    expect(updatedEnd).to.be.a('string');
  });

  it('treats Stripe canceled as active UI when DB subscription is active with future end_date', async () => {
    const stripe = makeStripeMock({
      sub: {
        status: 'canceled',
        trial_end: null,
        current_period_end: Math.floor(Date.now() / 1000) - 86400,
        customer: 'cus_x',
        items: { data: [{ price: { id: 'price_1SUwH8F0CLysN1jAvy1aMz3E' } }] }
      },
      cards: [{ id: 'pm_1' }]
    });
    const db = { updateSubscription: async () => ({ changes: 1 }) };
    const subscription = {
      id: 85,
      tier: 'tier_four',
      status: 'active',
      end_date: new Date(Date.now() + 86400000 * 30).toISOString(),
      stripe_subscription_id: 'sub_stale_canceled'
    };
    const user = { role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(payload.stripe_status).to.equal('active');
    expect(payload.stripe_status_raw).to.equal('canceled');
    expect(payload.app_status_display).to.equal('Active');
    expect(payload.tier).to.equal('tier_four');
  });

  it('treats database-only Tier One (no Stripe) as free trial for UI', async () => {
    const stripe = { subscriptions: { retrieve: async () => { throw new Error('no sub'); } } };
    const db = {};
    const subscription = {
      id: 99,
      tier: 'tier_one',
      status: 'active',
      end_date: new Date(Date.now() + 5 * 86400000).toISOString(),
      stripe_subscription_id: null
    };
    const user = { role: 'user' };

    const payload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
    expect(payload.app_show_trial_message).to.equal(true);
    expect(payload.trial_active).to.equal(true);
    expect(payload.app_status_display).to.equal('Free Trial');
  });
});
