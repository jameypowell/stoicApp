/**
 * Production API tests
 * Verifies HTTP endpoints: health, auth, workouts, subscriptions, payments.
 * Add new tests here as you add API features.
 */

const config = require('./config');
const { fetch } = require('./fetch');

async function getAuthToken() {
  const email = config.testUserEmail || ('prod-test-' + Date.now() + '@example.com');
  const password = config.testUserPassword || ('TestPass' + Date.now() + '!');
  const base = config.prodUrl.replace(/\/$/, '');

  let res = await fetch(base + '/api/auth/register', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });

  if (res.status === 201) {
    const data = await res.json();
    return data.token;
  }

  res = await fetch(base + '/api/auth/login', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: config.testUserPassword || password })
  });

  if (res.status !== 200) {
    throw new Error('Auth failed: set PROD_TEST_EMAIL and PROD_TEST_PASSWORD for existing user');
  }

  const data = await res.json();
  return data.token;
}

function apiTests() {
  const base = config.prodUrl.replace(/\/$/, '');
  const t = config.timeoutMs;

  return [
    {
      name: 'API: /health returns 200',
      fn: async () => {
        const res = await fetch(base + '/health', { timeout: t });
        if (res.status !== 200) throw new Error('Expected 200, got ' + res.status);
      }
    },
    {
      name: 'API: Protected endpoints require auth (401)',
      fn: async () => {
        const res = await fetch(base + '/api/workouts', { timeout: t });
        if (res.status !== 401 && res.status !== 403) throw new Error('Expected 401/403, got ' + res.status);
      }
    },
    {
      name: 'API: /api/subscriptions/me requires auth',
      fn: async () => {
        const res = await fetch(base + '/api/subscriptions/me', { timeout: t });
        if (res.status !== 401 && res.status !== 403) throw new Error('Expected 401/403, got ' + res.status);
      }
    },
    {
      name: 'API: Auth flow (register or login)',
      fn: async () => {
        const token = await getAuthToken();
        if (!token) throw new Error('No token returned');
      }
    },
    {
      name: 'API: /api/auth/me with valid token',
      fn: async () => {
        const token = await getAuthToken();
        const res = await fetch(base + '/api/auth/me', {
          headers: { Authorization: 'Bearer ' + token },
          timeout: t
        });
        if (res.status !== 200) throw new Error('Expected 200, got ' + res.status);
        const data = await res.json();
        if (!data.user || !data.user.email) throw new Error('Missing user in response');
      }
    },
    {
      name: 'API: /api/workouts with valid token',
      fn: async () => {
        const token = await getAuthToken();
        const res = await fetch(base + '/api/workouts', {
          headers: { Authorization: 'Bearer ' + token },
          timeout: t
        });
        if (res.status !== 200 && res.status !== 403) throw new Error('Expected 200 or 403, got ' + res.status);
        if (res.status === 200) {
          const data = await res.json();
          if (!Array.isArray(data.carouselWorkouts)) throw new Error('Expected carouselWorkouts array');
        }
      }
    },
    {
      name: 'API: /api/subscriptions/me with valid token',
      fn: async () => {
        const token = await getAuthToken();
        const res = await fetch(base + '/api/subscriptions/me', {
          headers: { Authorization: 'Bearer ' + token },
          timeout: t
        });
        if (res.status !== 200) throw new Error('Expected 200, got ' + res.status);
      }
    },
    {
      name: 'API: /api/payments/create-intent with tier_two',
      fn: async () => {
        const token = await getAuthToken();
        const res = await fetch(base + '/api/payments/create-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({ tier: 'tier_two', isUpgrade: false }),
          timeout: t
        });
        if (res.status !== 200) {
          const body = await res.text();
          throw new Error('Expected 200, got ' + res.status + ': ' + body.slice(0, 150));
        }
        const data = await res.json();
        if (!data.clientSecret && !data.subscriptionId) throw new Error('Expected clientSecret or subscriptionId');
      }
    },
    {
      name: 'API: /api/gym-memberships/drop-in/create-payment-intent',
      fn: async () => {
        const token = await getAuthToken();
        const res = await fetch(base + '/api/gym-memberships/drop-in/create-payment-intent', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({
            email: config.testUserEmail || 'drop-in-test@example.com',
            waiverSignature: 'Test User'
          }),
          timeout: t
        });
        if (res.status !== 200) {
          const body = await res.text();
          throw new Error('Expected 200, got ' + res.status + ': ' + body.slice(0, 200));
        }
        const data = await res.json();
        if (!data.clientSecret) throw new Error('Expected clientSecret in response');
        if (!data.paymentIntentId) throw new Error('Expected paymentIntentId in response');
      }
    },
    {
      name: 'API: /api/gym-memberships/pay-overdue (Pay Now with late fee)',
      fn: async () => {
        if (!config.testUserEmail || !config.testUserPassword) {
          throw new Error('Skip: set PROD_TEST_EMAIL and PROD_TEST_PASSWORD to a user with past-due gym membership');
        }
        const token = await getAuthToken();
        const meRes = await fetch(base + '/api/gym-memberships/me', {
          headers: { Authorization: 'Bearer ' + token },
          timeout: t
        });
        if (meRes.status === 404) {
          throw new Error('Test user has no gym membership; use a user with past-due gym membership');
        }
        if (meRes.status !== 200) throw new Error('GET gym-memberships/me failed: ' + meRes.status);
        const meData = await meRes.json();
        const status = meData.stripe?.status || meData.membership?.status;
        if (status !== 'past_due' && status !== 'grace_period') {
          throw new Error('Test user gym membership is not past_due/grace_period (status: ' + status + '); use a past-due user');
        }
        const payRes = await fetch(base + '/api/gym-memberships/pay-overdue', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + token },
          body: JSON.stringify({}),
          timeout: t
        });
        const payData = await payRes.json().catch(() => ({}));
        if (payRes.status === 200) {
          if (!payData.clientSecret) throw new Error('Expected clientSecret in pay-overdue response');
          if (typeof payData.amount !== 'number') throw new Error('Expected amount in pay-overdue response');
          return; // Pay Now endpoint works; UI + Stripe confirm would complete payment (late fee in webhook)
        }
        if (payRes.status === 400 && (payData.error || '').toLowerCase().includes('no unpaid invoice')) {
          return; // User may have paid already; endpoint works
        }
        throw new Error('pay-overdue: ' + payRes.status + ' - ' + (payData.error || JSON.stringify(payData).slice(0, 150)));
      }
    }
  ];
}

module.exports = { apiTests };
