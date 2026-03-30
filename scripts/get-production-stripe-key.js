#!/usr/bin/env node
/**
 * Get Production Stripe API Key from ECS Task Definition
 * 
 * This script retrieves the production Stripe API key from the ECS task definition
 * to avoid hardcoding it or storing it in version control.
 */

const { execSync } = require('child_process');

async function getProductionStripeKey() {
  try {
    const keyOnly = process.argv.includes('--key-only');
    
    // Get the latest task definition revision from the running service
    if (!keyOnly) {
      console.log('📊 Fetching production Stripe API key from ECS...\n');
    }
    
    const serviceInfo = execSync(
      'aws ecs describe-services --cluster stoic-fitness-app --services stoic-fitness-service --region us-east-1 --query "services[0].taskDefinition" --output text',
      { encoding: 'utf-8', stdio: keyOnly ? 'pipe' : 'inherit' }
    ).trim();
    
    if (!serviceInfo) {
      throw new Error('Could not get service task definition');
    }
    
    const taskDefArn = serviceInfo;
    if (!keyOnly) {
      console.log(`Task Definition: ${taskDefArn}\n`);
    }
    
    // Extract task definition name and revision
    const taskDefMatch = taskDefArn.match(/task-definition\/(.+):(\d+)/);
    if (!taskDefMatch) {
      throw new Error('Could not parse task definition ARN');
    }
    
    const [, taskDefName, revision] = taskDefMatch;
    
    // Get the Stripe secret key from task definition
    // Use JMESPath query with proper escaping
    const stripeKey = execSync(
      `aws ecs describe-task-definition --task-definition ${taskDefName}:${revision} --region us-east-1 --query "taskDefinition.containerDefinitions[0].environment[?name=='STRIPE_SECRET_KEY'].value | [0]" --output text`,
      { encoding: 'utf-8', stdio: keyOnly ? 'pipe' : 'inherit' }
    ).trim();
    
    if (!stripeKey || stripeKey === 'None') {
      throw new Error('Stripe secret key not found in task definition');
    }
    
    // Verify it's a production key
    if (!keyOnly) {
      if (!stripeKey.startsWith('sk_live_')) {
        console.warn('⚠️  Warning: Key does not start with sk_live_ (might be test key)');
      }
      
      console.log('✅ Production Stripe API Key retrieved successfully\n');
      console.log(`Key: ${stripeKey.substring(0, 20)}...${stripeKey.substring(stripeKey.length - 4)}`);
      console.log(`Mode: ${stripeKey.startsWith('sk_live_') ? 'LIVE (PRODUCTION)' : 'TEST'}\n`);
    }
    
    return stripeKey;
    
  } catch (error) {
    console.error('❌ Error retrieving production Stripe key:', error.message);
    console.error('\nMake sure:');
    console.error('  1. AWS CLI is installed and configured');
    console.error('  2. You have permissions to query ECS task definitions');
    console.error('  3. The service is running in us-east-1 region');
    process.exit(1);
  }
}

// If run directly, output the key
if (require.main === module) {
  getProductionStripeKey()
    .then(key => {
      // Output just the key (useful for scripts)
      if (process.argv.includes('--key-only')) {
        // Write directly to stdout without any console.log formatting
        process.stdout.write(key);
        process.stdout.write('\n');
      } else {
        console.log('\nTo use this key in a script:');
        console.log(`  export STRIPE_SECRET_KEY_PROD="${key}"`);
      }
      process.exit(0);
    })
    .catch(error => {
      // For --key-only, only output errors to stderr
      if (process.argv.includes('--key-only')) {
        process.stderr.write(`Error: ${error.message}\n`);
      } else {
        console.error(error);
      }
      process.exit(1);
    });
}

module.exports = { getProductionStripeKey };
