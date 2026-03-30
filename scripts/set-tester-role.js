#!/usr/bin/env node

/**
 * Set role = 'tester' for specified production accounts (full access, no payment backfill needed).
 * Excludes: streetkylee@gmail.com, fotujacob@gmail.com (those stay as paying users).
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

const EMAILS_TO_SET_TESTER = [
  'miranda@stoic-fit.com',
  'r.eric.folk@gmail.com',
  'kylieshot@gmail.com',
  'tom@patriots.com',
  'jpowell@stoic-fit.com',
  'admin@stoic-fit.com',
  'jameypowell@gmail.com',
  'branda.cooper@gmail.com'
];

async function main() {
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

    const result = await client.query(
      `UPDATE users SET role = 'tester', updated_at = CURRENT_TIMESTAMP
       WHERE email = ANY($1::text[])
       RETURNING id, email, name, role`,
      [EMAILS_TO_SET_TESTER]
    );

    console.log(`Updated ${result.rowCount} user(s) to role = 'tester':`);
    result.rows.forEach(r => console.log(`  ${r.email} (${r.name || '—'})`));
  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

main();
