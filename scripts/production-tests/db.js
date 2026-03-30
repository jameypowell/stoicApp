/**
 * Production database tests
 * Requires DB_HOST, DB_USER, DB_PASSWORD. Skips if not set.
 * Add new tests here as you add DB-dependent features.
 */

const config = require('./config');

function dbTests() {
  if (!config.db) {
    return [
      {
        name: 'DB: Skipped (no DB_HOST)',
        fn: async () => {}
      }
    ];
  }

  const { Client } = require('pg');

  return [
    {
      name: 'DB: Connect to PostgreSQL',
      fn: async () => {
        const client = new Client(config.db);
        await client.connect();
        await client.end();
      }
    },
    {
      name: 'DB: users table exists',
      fn: async () => {
        const client = new Client(config.db);
        await client.connect();
        const res = await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'users' LIMIT 1"
        );
        await client.end();
        if (res.rowCount === 0) throw new Error('users table not found');
      }
    },
    {
      name: 'DB: subscriptions table exists',
      fn: async () => {
        const client = new Client(config.db);
        await client.connect();
        const res = await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'subscriptions' LIMIT 1"
        );
        await client.end();
        if (res.rowCount === 0) throw new Error('subscriptions table not found');
      }
    },
    {
      name: 'DB: workouts table exists',
      fn: async () => {
        const client = new Client(config.db);
        await client.connect();
        const res = await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'workouts' LIMIT 1"
        );
        await client.end();
        if (res.rowCount === 0) throw new Error('workouts table not found');
      }
    },
    {
      name: 'DB: webhook_events table exists',
      fn: async () => {
        const client = new Client(config.db);
        await client.connect();
        const res = await client.query(
          "SELECT 1 FROM information_schema.tables WHERE table_name = 'webhook_events' LIMIT 1"
        );
        await client.end();
        if (res.rowCount === 0) throw new Error('webhook_events table not found');
      }
    },
    {
      name: 'DB: Can read users count',
      fn: async () => {
        const client = new Client(config.db);
        await client.connect();
        const res = await client.query('SELECT COUNT(*)::int AS c FROM users');
        await client.end();
        if (res.rows[0].c < 0) throw new Error('Invalid users count');
      }
    }
  ];
}

module.exports = { dbTests };
