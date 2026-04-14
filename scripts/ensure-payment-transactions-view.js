#!/usr/bin/env node
/**
 * Ensures the `transactions` view exists (payments INNER JOIN users).
 * Run against production from the app image or locally with the same DB env as the server:
 *   node scripts/ensure-payment-transactions-view.js
 *   docker compose run --rm app node scripts/ensure-payment-transactions-view.js
 */
require('dotenv').config();
const path = require('path');
const { initDatabase, Database } = require(path.join(__dirname, '..', 'database'));

async function main() {
  const conn = await initDatabase();
  const db = new Database(conn);
  await db.ensurePaymentTransactionsView();
  console.log('Ensured `transactions` view (payments + users).');
  if (process.env.DB_HOST) {
    await conn.end();
  } else {
    await new Promise((resolve, reject) => {
      conn.close((err) => (err ? reject(err) : resolve()));
    });
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
