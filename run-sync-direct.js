#!/usr/bin/env node

/**
 * Run subscription sync directly (bypasses API)
 * This can be run locally or on the server
 */

require('dotenv').config();
const { initDatabase, Database } = require('./database');
const { syncAllSubscriptions } = require('./subscription-sync');

// Set production database if DB_HOST is set
if (process.env.DB_HOST) {
  delete process.env.DB_PATH;
}

async function main() {
  try {
    console.log('🔄 Starting direct subscription sync...\n');
    
    // Get database password from AWS if needed
    if (!process.env.DB_PASSWORD && process.env.DB_HOST) {
      const { execSync } = require('child_process');
      try {
        const authToken = execSync(
          `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT || '5432'} --region us-east-1 --username ${process.env.DB_USER || 'stoicapp'} 2>/dev/null`,
          { encoding: 'utf-8' }
        );
        if (authToken && authToken.trim() && !authToken.includes('error')) {
          process.env.DB_PASSWORD = authToken.trim();
          console.log('✅ Retrieved database password from RDS auth token\n');
        }
      } catch (e) {
        console.warn('⚠️  Could not retrieve database password from AWS');
      }
    }
    
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    console.log(`✅ Connected to ${db.isPostgres ? 'PostgreSQL' : 'SQLite'} database\n`);
    
    // Run sync
    const result = await syncAllSubscriptions(db);
    
    if (result.success) {
      console.log('\n✅ Sync completed successfully!');
      process.exit(0);
    } else {
      console.log('\n❌ Sync completed with errors');
      process.exit(1);
    }
  } catch (error) {
    console.error('\n❌ Fatal error:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main();


