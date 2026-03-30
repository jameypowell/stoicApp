# Production Tests

Production test suite for Stoic Shop. Verifies API endpoints, database, Stripe, and webhooks. Add and update tests here as you add features.

## Quick Start

```bash
# Basic (API + Webhooks only - no credentials needed)
node scripts/production-tests/index.js

# With production URL
PROD_URL=https://app.stoic-fit.com node scripts/production-tests/index.js

# Full (API, DB, Stripe, Webhooks)
PROD_URL=https://app.stoic-fit.com \
DB_HOST=your-db-host DB_USER=user DB_PASSWORD=pass \
STRIPE_SECRET_KEY=YOUR_STRIPE_SECRET_KEY \
node scripts/production-tests/index.js
```

## Environment Variables

| Variable | Required | Description |
|----------|----------|-------------|
| `PROD_URL` | No | Production API base URL (default: `https://app.stoic-fit.com`) |
| `DB_HOST` | No | PostgreSQL host for DB tests; skips if not set |
| `DB_USER` | No | PostgreSQL user |
| `DB_PASSWORD` | No | PostgreSQL password |
| `DB_NAME` | No | PostgreSQL database (default: `postgres`) |
| `DB_PORT` | No | PostgreSQL port (default: `5432`) |
| `STRIPE_SECRET_KEY` | No | Stripe secret key for Stripe tests; skips if not set |
| `PROD_TEST_EMAIL` | No | Existing test user email (optional; script registers ephemeral user if not set) |
| `PROD_TEST_PASSWORD` | No | Existing test user password |
| `PROD_TEST_TIMEOUT_MS` | No | Request timeout (default: `15000`) |

## Test Modules

| Module | File | What it tests |
|--------|------|---------------|
| **API** | `api.js` | Health, auth, workouts, subscriptions, payments |
| **Database** | `db.js` | PostgreSQL connection, tables exist, read operations |
| **Stripe** | `stripe.js` | Stripe API connectivity, price IDs configured |
| **Webhooks** | `webhooks.js` | Webhook endpoint reachable, rejects invalid payloads |

## Adding New Tests

### API tests (`api.js`)

```javascript
{
  name: 'API: Your new endpoint',
  fn: async () => {
    const res = await fetch(base + '/api/your-endpoint', { timeout: t });
    if (res.status !== 200) throw new Error('Expected 200, got ' + res.status);
    const data = await res.json();
    // Assert...
  }
}
```

### Database tests (`db.js`)

```javascript
{
  name: 'DB: Your new table or query',
  fn: async () => {
    const client = new Client(config.db);
    await client.connect();
    const res = await client.query('SELECT 1 FROM your_table LIMIT 1');
    await client.end();
    if (res.rowCount === 0) throw new Error('your_table not found');
  }
}
```

### Stripe tests (`stripe.js`)

```javascript
{
  name: 'Stripe: Your new check',
  fn: async () => {
    const customer = await stripe.customers.retrieve('cus_xxx');
    if (!customer) throw new Error('Customer not found');
  }
}
```

### Webhook tests (`webhooks.js`)

For full E2E webhook tests, use Stripe CLI:

```bash
stripe listen --forward-to https://app.stoic-fit.com/api/webhooks/stripe
stripe trigger invoice.payment_succeeded
```

## Exit Code

- `0` if all tests pass
- `1` if any test fails or a fatal error occurs

## NPM Script (optional)

Add to `package.json`:

```json
"scripts": {
  "test:production": "node scripts/production-tests/index.js"
}
```

Run with: `npm run test:production`
