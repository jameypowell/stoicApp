#!/usr/bin/env node
/**
 * Test script to create test users for each tier and test access scenarios
 */

const { Database, initDatabase } = require('./database');
const bcrypt = require('bcryptjs');

const API_BASE = 'http://localhost:3000/api';

// Test configuration
// Note: Database schema may have been updated to accept tier_one, tier_two, etc.
// But legacy schema uses 'daily', 'weekly', 'monthly'
// Try new names first, fall back to legacy if needed
const TEST_USERS = [
  { email: 'tier1@test.com', password: 'test123', tier: null, tierName: 'tier_one' }, // No subscription for tier_one
  { email: 'tier2@test.com', password: 'test123', tier: 'tier_two', tierName: 'tier_two', legacyTier: 'daily' },
  { email: 'tier3@test.com', password: 'test123', tier: 'tier_three', tierName: 'tier_three', legacyTier: 'weekly' },
  { email: 'tier4@test.com', password: 'test123', tier: 'tier_four', tierName: 'tier_four', legacyTier: 'monthly' }
];

const TIER_LIMITS = {
  tier_one: {
    bodyComposition: 2,
    prLogs: 3,
    mealPlanCalculations: 1,
    coreFinishers: 1,
    strengthWorkouts: 1
  },
  tier_two: {
    bodyComposition: 5,
    prLogs: 5,
    mealPlanCalculations: 2,
    coreFinishers: 5,
    strengthWorkouts: Infinity
  },
  tier_three: {
    bodyComposition: 8,
    prLogs: 10,
    mealPlanCalculations: 3,
    coreFinishers: 10,
    strengthWorkouts: Infinity
  },
  tier_four: {
    bodyComposition: Infinity,
    prLogs: 15,
    mealPlanCalculations: Infinity,
    coreFinishers: Infinity,
    strengthWorkouts: Infinity
  }
};

async function clearTestData(db, userId) {
  // Clear existing test data for this user
  try {
    if (db.isPostgres) {
      await db.query('DELETE FROM body_composition_measurements WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM pr_logs WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM meal_plan_calculations WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM core_finishers_viewed WHERE user_id = $1', [userId]);
      await db.query('DELETE FROM strength_workouts_viewed WHERE user_id = $1', [userId]);
    } else {
      await db.query('DELETE FROM body_composition_measurements WHERE user_id = ?', [userId]);
      await db.query('DELETE FROM pr_logs WHERE user_id = ?', [userId]);
      await db.query('DELETE FROM meal_plan_calculations WHERE user_id = ?', [userId]);
      await db.query('DELETE FROM core_finishers_viewed WHERE user_id = ?', [userId]);
      await db.query('DELETE FROM strength_workouts_viewed WHERE user_id = ?', [userId]);
    }
  } catch (error) {
    console.log(`⚠ Warning: Could not clear test data for user ${userId}: ${error.message}`);
  }
}

async function createTestUsers(db) {
  console.log('\n=== Creating Test Users ===\n');
  const users = [];
  
  for (const testUser of TEST_USERS) {
    try {
      // Check if user already exists
      let user = await db.getUserByEmail(testUser.email);
      
      if (!user) {
        // Create user
        const result = await db.createUser(testUser.email, testUser.password);
        user = await db.getUserById(result.id);
        console.log(`✓ Created user: ${testUser.email} (ID: ${result.id})`);
      } else {
        console.log(`✓ User already exists: ${testUser.email} (ID: ${user.id})`);
      }
      
      // Create or update subscription
      // tier_one needs a free subscription created via API
      if (testUser.tierName === 'tier_one') {
        // Create free tier subscription via API
        try {
          const loginToken = await loginUser(testUser.email, testUser.password);
          const createFreeResponse = await fetch(`${API_BASE}/subscriptions/create-free`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${loginToken}`,
              'Content-Type': 'application/json'
            }
          });
          if (createFreeResponse.ok) {
            console.log(`✓ Created free tier subscription for ${testUser.email}`);
          } else {
            const error = await createFreeResponse.json();
            console.log(`⚠ Could not create free subscription (may already exist): ${error.error || 'Unknown error'}`);
          }
        } catch (error) {
          console.log(`⚠ Error creating free subscription: ${error.message}`);
        }
      } else if (testUser.tier) {
        const endDate = new Date();
        endDate.setMonth(endDate.getMonth() + 1); // 1 month for paid tiers
        // Format as ISO string for database
        const endDateISO = endDate.toISOString();
        
        // Cancel any existing subscriptions
        if (db.isPostgres) {
          await db.query(
            'UPDATE subscriptions SET status = \'canceled\' WHERE user_id = $1 AND status = \'active\'',
            [user.id]
          );
        } else {
          await db.query(
            'UPDATE subscriptions SET status = \'canceled\' WHERE user_id = ? AND status = \'active\'',
            [user.id]
          );
        }
        
        // Try new tier name first, fall back to legacy if it fails
        let subscriptionTier = testUser.tier;
        try {
          await db.createSubscription(
            user.id,
            subscriptionTier,
            null, // no stripe customer for test
            null, // no stripe subscription for test
            endDateISO
          );
          console.log(`✓ Created subscription: ${subscriptionTier} for ${testUser.email}`);
        } catch (error) {
          // If new tier name fails, try legacy name
          if (testUser.legacyTier && error.message.includes('CHECK constraint')) {
            subscriptionTier = testUser.legacyTier;
            await db.createSubscription(
              user.id,
              subscriptionTier,
              null,
              null,
              endDateISO
            );
            console.log(`✓ Created subscription: ${subscriptionTier} (legacy) for ${testUser.email}`);
          } else {
            throw error;
          }
        }
      } else {
        console.log(`✓ No subscription needed for ${testUser.email} (tier_one - free tier)`);
      }
      
      users.push({ ...user, tier: testUser.tierName, password: testUser.password });
      
      // Clear existing test data for this user
      await clearTestData(db, user.id);
    } catch (error) {
      console.error(`✗ Error creating user ${testUser.email}:`, error.message);
    }
  }
  
  return users;
}

async function loginUser(email, password) {
  const response = await fetch(`${API_BASE}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password })
  });
  
  if (!response.ok) {
    const error = await response.json();
    throw new Error(error.error || 'Login failed');
  }
  
  const data = await response.json();
  return data.token;
}

async function testFeatureAccess(token, feature, action, expectedSuccess, description) {
  try {
    const response = await action(token);
    const success = response.ok || response.status === 200;
    
    if (success === expectedSuccess) {
      console.log(`  ✓ ${description}`);
      return { success: true, response: await response.json().catch(() => ({})) };
    } else {
      const error = await response.json().catch(() => ({ error: 'Unknown error' }));
      console.log(`  ✗ ${description} - Expected ${expectedSuccess ? 'success' : 'failure'}, got ${success ? 'success' : 'failure'}`);
      console.log(`    Error: ${error.error || JSON.stringify(error)}`);
      return { success: false, error };
    }
  } catch (error) {
    console.log(`  ✗ ${description} - Exception: ${error.message}`);
    return { success: false, error: error.message };
  }
}

async function testTierAccess(users, db) {
  console.log('\n=== Testing Tier Access ===\n');
  
  const results = {
    tier_one: { passed: 0, failed: 0, tests: [] },
    tier_two: { passed: 0, failed: 0, tests: [] },
    tier_three: { passed: 0, failed: 0, tests: [] },
    tier_four: { passed: 0, failed: 0, tests: [] }
  };
  
  for (const user of users) {
    console.log(`\n--- Testing ${user.tier.toUpperCase()} (${user.email}) ---\n`);
    const tierResults = results[user.tier];
    const limits = TIER_LIMITS[user.tier];
    
    try {
      // Login
      const token = await loginUser(user.email, user.password);
      console.log(`✓ Logged in as ${user.email}`);
      
      // Test Body Composition
      console.log('\nTesting Body Composition:');
      for (let i = 0; i < (limits.bodyComposition === Infinity ? 3 : limits.bodyComposition + 1); i++) {
        const shouldSucceed = i < limits.bodyComposition;
        const result = await testFeatureAccess(
          token,
          'bodyComposition',
          async (t) => fetch(`${API_BASE}/body-composition`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${t}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              measurement: 'Weight',
              value: (150 + i).toString(),
              goalDirection: 'down',
              date: new Date().toISOString()
            })
          }),
          shouldSucceed,
          `Add measurement ${i + 1} (limit: ${limits.bodyComposition})`
        );
        tierResults.tests.push(result);
        if (result.success) tierResults.passed++;
        else tierResults.failed++;
      }
      
      // Test PR Logs
      console.log('\nTesting PR Logs (1RM Lifts):');
      for (let i = 0; i < (limits.prLogs === Infinity ? 5 : limits.prLogs + 1); i++) {
        const shouldSucceed = i < limits.prLogs;
        const result = await testFeatureAccess(
          token,
          'prLogs',
          async (t) => fetch(`${API_BASE}/pr-logs`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${t}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              exercise: `Test Exercise ${i + 1}`,
              weight: 100 + i,
              reps: 5,
              oneRM: 120 + i,
              confidence: 'high',
              date: new Date().toISOString()
            })
          }),
          shouldSucceed,
          `Add PR log ${i + 1} (limit: ${limits.prLogs})`
        );
        tierResults.tests.push(result);
        if (result.success) tierResults.passed++;
        else tierResults.failed++;
      }
      
      // Test Meal Plan Calculations
      console.log('\nTesting Meal Plan Calculations:');
      for (let i = 0; i < (limits.mealPlanCalculations === Infinity ? 4 : limits.mealPlanCalculations + 1); i++) {
        const shouldSucceed = i < limits.mealPlanCalculations;
        const result = await testFeatureAccess(
          token,
          'mealPlanCalculations',
          async (t) => fetch(`${API_BASE}/meal-plan/calculate`, {
            method: 'POST',
            headers: {
              'Authorization': `Bearer ${t}`,
              'Content-Type': 'application/json'
            },
            body: JSON.stringify({
              calories: 2000,
              protein: 150,
              fat: 65,
              carbs: 200,
              meals: 3
            })
          }),
          shouldSucceed,
          `Calculate meal plan ${i + 1} (limit: ${limits.mealPlanCalculations})`
        );
        tierResults.tests.push(result);
        if (result.success) tierResults.passed++;
        else tierResults.failed++;
      }
      
      // Test Core Finishers (check count endpoint)
      console.log('\nTesting Core Finishers:');
      const coreResponse = await fetch(`${API_BASE}/workouts/core`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (coreResponse.ok) {
        const coreData = await coreResponse.json();
        const viewedCount = await db.getCoreFinishersViewedCount(user.id);
        const limit = limits.coreFinishers;
        const accessibleCount = coreData.workouts ? coreData.workouts.filter(w => !w.locked).length : 0;
        const shouldHaveAccess = accessibleCount <= limit || limit === Infinity;
        
        console.log(`  ${shouldHaveAccess ? '✓' : '✗'} Core Finishers access - Viewed: ${viewedCount}, Accessible: ${accessibleCount}, Limit: ${limit}`);
        tierResults.tests.push({ success: shouldHaveAccess });
        if (shouldHaveAccess) tierResults.passed++;
        else tierResults.failed++;
      }
      
      // Test Strength Workouts (check count endpoint)
      console.log('\nTesting Strength Workouts:');
      const strengthResponse = await fetch(`${API_BASE}/strength-workouts`, {
        headers: { 'Authorization': `Bearer ${token}` }
      });
      if (strengthResponse.ok) {
        const strengthData = await strengthResponse.json();
        const viewedCount = await db.getStrengthWorkoutsViewedCount(user.id);
        const limit = limits.strengthWorkouts;
        const accessibleCount = strengthData.workouts ? strengthData.workouts.filter(w => !w.locked).length : 0;
        const shouldHaveAccess = accessibleCount <= limit || limit === Infinity;
        
        console.log(`  ${shouldHaveAccess ? '✓' : '✗'} Strength Workouts access - Viewed: ${viewedCount}, Accessible: ${accessibleCount}, Limit: ${limit}`);
        tierResults.tests.push({ success: shouldHaveAccess });
        if (shouldHaveAccess) tierResults.passed++;
        else tierResults.failed++;
      }
      
    } catch (error) {
      console.error(`✗ Error testing ${user.tier}:`, error.message);
      tierResults.failed++;
    }
  }
  
  return results;
}

async function printSummary(results) {
  console.log('\n\n=== TEST SUMMARY ===\n');
  
  for (const [tier, result] of Object.entries(results)) {
    console.log(`${tier.toUpperCase()}:`);
    console.log(`  Passed: ${result.passed}`);
    console.log(`  Failed: ${result.failed}`);
    console.log(`  Total: ${result.passed + result.failed}`);
    console.log(`  Success Rate: ${((result.passed / (result.passed + result.failed)) * 100).toFixed(1)}%`);
    console.log('');
  }
  
  const totalPassed = Object.values(results).reduce((sum, r) => sum + r.passed, 0);
  const totalFailed = Object.values(results).reduce((sum, r) => sum + r.failed, 0);
  const totalTests = totalPassed + totalFailed;
  
  console.log(`OVERALL:`);
  console.log(`  Total Passed: ${totalPassed}`);
  console.log(`  Total Failed: ${totalFailed}`);
  console.log(`  Total Tests: ${totalTests}`);
  console.log(`  Overall Success Rate: ${((totalPassed / totalTests) * 100).toFixed(1)}%`);
}

async function main() {
  console.log('Starting Tier Access Tests...\n');
  
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  try {
    // Create test users
    const users = await createTestUsers(db);
    
    if (users.length === 0) {
      console.error('No users created. Exiting.');
      process.exit(1);
    }
    
    // Wait a moment for subscriptions to be ready
    await new Promise(resolve => setTimeout(resolve, 1000));
    
    // Test access
    const results = await testTierAccess(users, db);
    
    // Print summary
    await printSummary(results);
    
  } catch (error) {
    console.error('Test failed with error:', error);
    process.exit(1);
  } finally {
    if (db.db && typeof db.db.close === 'function') {
      await db.db.close();
    }
  }
}

// Run tests
main().catch(console.error);

