#!/usr/bin/env node
/**
 * Verify password for a user in PostgreSQL database
 */

require('dotenv').config();
const { Client } = require('pg');
const bcrypt = require('bcryptjs');

async function verifyPassword(email, password) {
  const client = new Client({
    host: process.env.DB_HOST,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    database: process.env.DB_NAME || 'postgres',
    port: process.env.DB_PORT || 5432,
    ssl: {
      rejectUnauthorized: false
    }
  });

  try {
    await client.connect();
    console.log('Connected to PostgreSQL');
    
    const result = await client.query('SELECT id, email, password_hash FROM users WHERE email = $1', [email]);
    
    if (result.rows.length === 0) {
      console.log(`❌ User ${email} not found in PostgreSQL`);
      return;
    }
    
    const user = result.rows[0];
    console.log(`Found user: ${user.email} (ID: ${user.id})`);
    console.log(`Password hash: ${user.password_hash.substring(0, 20)}...`);
    
    const isValid = await bcrypt.compare(password, user.password_hash);
    console.log(`Password "${password}" is ${isValid ? 'VALID' : 'INVALID'}`);
    
    if (!isValid) {
      console.log('\nResetting password...');
      const newHash = await bcrypt.hash(password, 10);
      await client.query('UPDATE users SET password_hash = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [newHash, user.id]);
      console.log('✅ Password updated');
      
      // Verify again
      const verifyResult = await client.query('SELECT password_hash FROM users WHERE id = $1', [user.id]);
      const verifyIsValid = await bcrypt.compare(password, verifyResult.rows[0].password_hash);
      console.log(`Verification: Password is now ${verifyIsValid ? 'VALID' : 'INVALID'}`);
    }
    
  } catch (error) {
    console.error('Error:', error.message);
  } finally {
    await client.end();
  }
}

const email = process.argv[2] || 'jameypowell@gmail.com';
const password = process.argv[3] || 'testtest';

verifyPassword(email, password);

