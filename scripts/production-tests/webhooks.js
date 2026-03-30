/**
 * Production webhook tests
 * Verifies the Stripe webhook endpoint is reachable and rejects invalid payloads.
 * Cannot send real Stripe events without webhook secret + valid signature.
 * Use Stripe CLI for full E2E: stripe trigger invoice.payment_succeeded
 * Add new tests here as you add webhook handlers.
 */

const config = require('./config');
const { fetch } = require('./fetch');

function webhookTests() {
  const base = config.prodUrl.replace(/\/$/, '');
  const webhookUrl = `${base}/api/webhooks/stripe`;
  const timeout = config.timeoutMs;

  return [
    {
      name: 'Webhook: Endpoint reachable (POST returns 400 for invalid sig)',
      fn: async () => {
        // Webhook without valid Stripe signature returns 400
        const res = await fetch(webhookUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ type: 'invoice.payment_succeeded' }),
          timeout
        });
        // 400 = signature verification failed (expected for fake payload)
        // 404 = endpoint not found
        if (res.status === 404) {
          throw new Error('Webhook endpoint not found (404)');
        }
        if (res.status >= 500) {
          const text = await res.text();
          throw new Error(`Webhook returned ${res.status}: ${text.slice(0, 150)}`);
        }
        // 400 is expected for invalid/missing signature
        if (res.status !== 400) {
          throw new Error(`Expected 400 for invalid signature, got ${res.status}`);
        }
      }
    },
    {
      name: 'Webhook: Rejects GET (405 or 404)',
      fn: async () => {
        const res = await fetch(webhookUrl, { method: 'GET', timeout });
        // GET should not be accepted; 404 or 405 is fine
        if (res.status === 200) {
          throw new Error('Webhook should not accept GET with 200');
        }
      }
    }
  ];
}

module.exports = { webhookTests };
