#!/usr/bin/env node

/**
 * List accounts that need payment method backfill (DB only, no Stripe calls).
 */

require('dotenv').config();

if (!process.env.DB_HOST) {
  process.env.DB_HOST = 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
}
if (!process.env.DB_USER) {
  process.env.DB_USER = 'stoicapp';
}
if (!process.env.DB_NAME) {
  process.env.DB_NAME = 'postgres';
}
if (!process.env.DB_PORT) {
  process.env.DB_PORT = '5432';
}

// Try to get password from AWS if not set (Secrets Manager first, then Parameter Store, then RDS auth)
if (!process.env.DB_PASSWORD || typeof process.env.DB_PASSWORD !== 'string') {
  const { execSync } = require('child_process');
  try {
    const secretName = process.env.DB_SECRET_NAME || 'stoic-fitness-db-password';
    const secret = execSync(`aws secretsmanager get-secret-value --secret-id ${secretName} --region us-east-1 --query SecretString --output text 2>/dev/null`, { encoding: 'utf-8' });
    if (secret && secret.trim() && !secret.includes('error')) {
      try {
        const parsed = JSON.parse(secret);
        process.env.DB_PASSWORD = typeof parsed.password === 'string' ? parsed.password : (typeof parsed.DB_PASSWORD === 'string' ? parsed.DB_PASSWORD : secret.trim());
      } catch {
        process.env.DB_PASSWORD = secret.trim();
      }
    }
  } catch (e) {}
  if (!process.env.DB_PASSWORD || typeof process.env.DB_PASSWORD !== 'string') {
    for (const name of ['/stoic-fitness/db/password', '/stoic-fitness/db-password']) {
      try {
        const param = execSync(`aws ssm get-parameter --name ${name} --region us-east-1 --with-decryption --query Parameter.Value --output text 2>/dev/null`, { encoding: 'utf-8' });
        if (param && param.trim()) {
          process.env.DB_PASSWORD = param.trim();
          break;
        }
      } catch (e2) {}
    }
  }
  if (!process.env.DB_PASSWORD || typeof process.env.DB_PASSWORD !== 'string') {
    try {
      const authToken = execSync(
        `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT} --region us-east-1 --username ${process.env.DB_USER} 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      if (authToken && authToken.trim() && !authToken.includes('error')) {
        process.env.DB_PASSWORD = authToken.trim();
      }
    } catch (e3) {}
  }
}

const { Client } = require('pg');

async function listAccounts() {
  const client = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME,
    port: process.env.DB_PORT,
    ssl: { rejectUnauthorized: false }
  });

  try {
    await client.connect();

    const appRows = await client.query(`
      SELECT s.id, s.user_id, s.stripe_subscription_id, s.tier,
             u.email, u.name
      FROM subscriptions s
      JOIN users u ON u.id = s.user_id
      WHERE s.stripe_subscription_id IS NOT NULL
        AND s.status = 'active'
        AND (s.payment_method_id IS NULL OR s.payment_method_id = '')
      ORDER BY s.id
    `);

    const gymRows = await client.query(`
      SELECT g.id, g.user_id, g.stripe_subscription_id,
             u.email, u.name
      FROM gym_memberships g
      JOIN users u ON u.id = g.user_id
      WHERE g.stripe_subscription_id IS NOT NULL
        AND g.status = 'active'
        AND (g.payment_method_id IS NULL OR g.payment_method_id = '')
      ORDER BY g.id
    `);

    console.log('Accounts that need payment info backfill (DB has no payment_method_id):\n');
    console.log('--- App subscriptions ---');
    if (appRows.rows.length === 0) {
      console.log('  (none)');
    } else {
      appRows.rows.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.email}  (${r.name || '—'})  sub_id=${r.id}  stripe=${r.stripe_subscription_id}`);
      });
    }
    console.log('\n--- Gym memberships ---');
    if (gymRows.rows.length === 0) {
      console.log('  (none)');
    } else {
      gymRows.rows.forEach((r, i) => {
        console.log(`  ${i + 1}. ${r.email}  (${r.name || '—'})  membership_id=${r.id}  stripe=${r.stripe_subscription_id}`);
      });
    }
    console.log('\nTotal: ' + appRows.rows.length + ' app subscription(s), ' + gymRows.rows.length + ' gym membership(s)');
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

listAccounts();
