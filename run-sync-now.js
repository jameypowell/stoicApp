/**
 * Run subscription sync immediately
 * This script connects to the database and runs the full subscription sync
 * 
 * For production, it will automatically connect to production database if DB_HOST is set
 */

require('dotenv').config();

// Set production database defaults if DB_HOST is not set but we're in production
if (!process.env.DB_HOST && process.env.NODE_ENV === 'production') {
  process.env.DB_HOST = process.env.DB_HOST || 'stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com';
  process.env.DB_USER = process.env.DB_USER || 'stoicapp';
  process.env.DB_NAME = process.env.DB_NAME || 'postgres';
  process.env.DB_PORT = process.env.DB_PORT || '5432';
  process.env.DB_SSL = process.env.DB_SSL !== 'false' ? 'true' : 'false';
  process.env.USE_POSTGRES = 'true';
  // Unset DB_PATH to force PostgreSQL
  delete process.env.DB_PATH;
}

// Try to get password from AWS if not set and we're connecting to production
if (!process.env.DB_PASSWORD && process.env.DB_HOST) {
  const { execSync } = require('child_process');
  console.log('🔐 Attempting to retrieve database password from AWS...');
  try {
    // Try RDS auth token first
    try {
      const authToken = execSync(
        `aws rds generate-db-auth-token --hostname ${process.env.DB_HOST} --port ${process.env.DB_PORT || '5432'} --region us-east-1 --username ${process.env.DB_USER || 'stoicapp'} 2>/dev/null`,
        { encoding: 'utf-8' }
      );
      if (authToken && authToken.trim() && !authToken.includes('error')) {
        process.env.DB_PASSWORD = authToken.trim();
        console.log('✅ Retrieved password from RDS auth token');
      }
    } catch (e) {
      // Try Secrets Manager
      try {
        const secretName = process.env.DB_SECRET_NAME || 'stoic-fitness-db-password';
        const secret = execSync(`aws secretsmanager get-secret-value --secret-id ${secretName} --region us-east-1 --query SecretString --output text 2>/dev/null`, { encoding: 'utf-8' });
        if (secret && secret.trim() && !secret.includes('error')) {
          try {
            const parsed = JSON.parse(secret);
            process.env.DB_PASSWORD = parsed.password || parsed.DB_PASSWORD || secret.trim();
            console.log('✅ Retrieved password from Secrets Manager');
          } catch (parseError) {
            process.env.DB_PASSWORD = secret.trim();
            console.log('✅ Retrieved password from Secrets Manager (raw)');
          }
        }
      } catch (secretsError) {
        // Try Parameter Store
        try {
          const param = execSync(`aws ssm get-parameter --name /stoic-fitness/db/password --with-decryption --region us-east-1 --query Parameter.Value --output text 2>/dev/null`, { encoding: 'utf-8' });
          if (param && param.trim() && !param.includes('error')) {
            process.env.DB_PASSWORD = param.trim();
            console.log('✅ Retrieved password from Parameter Store');
          }
        } catch (paramError) {
          console.log('⚠️  Could not retrieve password from AWS. Will try connection without it.');
        }
      }
    }
  } catch (error) {
    console.log('⚠️  Could not retrieve password from AWS:', error.message);
  }
}

const { initDatabase, Database } = require('./database');
const { syncAllSubscriptions } = require('./subscription-sync');

async function runSync() {
  console.log('🔄 Starting immediate subscription sync...');
  console.log('Environment:', process.env.NODE_ENV || 'development');
  console.log('Database:', process.env.DB_HOST ? 'PostgreSQL' : 'SQLite');
  
  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);
    
    console.log('✅ Database connected');
    
    // Run sync
    const result = await syncAllSubscriptions(db);
    
    console.log('\n📊 Sync Results:');
    console.log('  Success:', result.success);
    console.log('  Processed:', result.processed);
    console.log('  Created:', result.created);
    console.log('  Updated:', result.updated);
    console.log('  Skipped:', result.skipped);
    console.log('  Errors:', result.errors);
    console.log('  Duration:', result.duration, 'ms');
    
    if (result.error) {
      console.error('❌ Sync error:', result.error);
      process.exit(1);
    }
    
    console.log('\n✅ Sync completed successfully!');
    process.exit(0);
  } catch (error) {
    console.error('❌ Fatal error:', error);
    process.exit(1);
  }
}

runSync();

