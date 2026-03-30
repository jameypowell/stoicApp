#!/usr/bin/env node

require('dotenv').config();

// Set production database credentials BEFORE requiring database module
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

const { Client } = require('pg');

async function checkStatus() {
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
    console.log('Connected to PostgreSQL\n');

    // Check app subscriptions
    const subResult = await client.query(`
      SELECT 
        COUNT(*) as total_active,
        COUNT(CASE WHEN payment_method_id IS NOT NULL AND payment_method_id != '' THEN 1 END) as with_payment_method,
        COUNT(CASE WHEN payment_method_id IS NULL OR payment_method_id = '' THEN 1 END) as without_payment_method
      FROM subscriptions 
      WHERE stripe_subscription_id IS NOT NULL 
      AND status = 'active'
    `);

    const subStats = subResult.rows[0];
    console.log('Active App Subscriptions:');
    console.log(`  Total active: ${subStats.total_active}`);
    console.log(`  With payment method: ${subStats.with_payment_method}`);
    console.log(`  Still need backfill: ${subStats.without_payment_method}`);
    if (subStats.total_active > 0) {
      const progress = Math.round((subStats.with_payment_method / subStats.total_active) * 100);
      console.log(`  Progress: ${progress}%`);
    }

    // Check gym memberships
    const gymResult = await client.query(`
      SELECT 
        COUNT(*) as total_active,
        COUNT(CASE WHEN payment_method_id IS NOT NULL AND payment_method_id != '' THEN 1 END) as with_payment_method,
        COUNT(CASE WHEN payment_method_id IS NULL OR payment_method_id = '' THEN 1 END) as without_payment_method
      FROM gym_memberships 
      WHERE stripe_subscription_id IS NOT NULL 
      AND status = 'active'
    `);

    const gymStats = gymResult.rows[0];
    console.log('\nActive Gym Memberships:');
    console.log(`  Total active: ${gymStats.total_active}`);
    console.log(`  With payment method: ${gymStats.with_payment_method}`);
    console.log(`  Still need backfill: ${gymStats.without_payment_method}`);
    if (gymStats.total_active > 0) {
      const progress = Math.round((gymStats.with_payment_method / gymStats.total_active) * 100);
      console.log(`  Progress: ${progress}%`);
    }

    console.log(`\nTotal remaining: ${parseInt(subStats.without_payment_method) + parseInt(gymStats.without_payment_method)} subscriptions/memberships`);

  } catch (error) {
    console.error('Error:', error.message);
    process.exit(1);
  } finally {
    await client.end();
  }
}

checkStatus();
