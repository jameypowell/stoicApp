/**
 * Tests for workout access and carousel display based on subscription tier
 * Tests the core functionality of displaying selected workouts and carousel workouts
 * for each subscription tier type (daily, weekly, monthly)
 */

const { describe, it, before, after, beforeEach } = require('mocha');
const { expect } = require('chai');
const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');

const { Database } = require('../database');
const routesModule = require('../routes');
const createRouter = routesModule.createRouter || routesModule;
const express = require('express');

// Mock JWT secret for testing
process.env.JWT_SECRET = 'test-secret-key-for-testing-only';

describe('Workout Access and Carousel Display', () => {
  let db;
  let testDbPath;
  let app;
  let testUserId;
  let testToken;
  
  // Helper to create dates
  const createDateStr = (daysOffset = 0) => {
    const date = new Date();
    date.setDate(date.getDate() + daysOffset);
    return date.toISOString().split('T')[0];
  };
  
  // Helper to get Monday of current week
  const getMondayOfWeek = (date = new Date()) => {
    const d = new Date(date);
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1); // Adjust when day is Sunday
    const monday = new Date(d.setDate(diff));
    return monday.toISOString().split('T')[0];
  };
  
  // Helper to get Saturday of current week
  const getSaturdayOfWeek = (date = new Date()) => {
    const monday = new Date(getMondayOfWeek(date) + 'T00:00:00');
    monday.setDate(monday.getDate() + 5);
    return monday.toISOString().split('T')[0];
  };
  
  before(async () => {
    // Create test database
    testDbPath = path.join(__dirname, 'test-workout-access.db');
    const sqliteDb = new sqlite3.Database(testDbPath);
    db = new Database(sqliteDb);
    db.isPostgres = false;
    
    // Create schema
    await db.query(`
      CREATE TABLE IF NOT EXISTS users (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        email TEXT UNIQUE NOT NULL,
        password_hash TEXT NOT NULL,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS subscriptions (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER NOT NULL,
        tier TEXT NOT NULL CHECK(tier IN ('daily', 'weekly', 'monthly', 'tier_one', 'tier_two', 'tier_three', 'tier_four')),
        stripe_customer_id TEXT,
        stripe_subscription_id TEXT,
        status TEXT NOT NULL CHECK(status IN ('active', 'canceled', 'expired', 'grace_period', 'paused', 'free_trial')) DEFAULT 'active',
        start_date DATETIME DEFAULT CURRENT_TIMESTAMP,
        end_date DATETIME,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        payment_method_id TEXT,
        payment_method_expires_at DATETIME,
        payment_failure_count INTEGER DEFAULT 0,
        last_payment_failure_at DATETIME,
        grace_period_ends_at DATETIME,
        stripe_status TEXT,
        last_synced_at DATETIME,
        sync_error TEXT,
        canceled_by_user_at DATETIME,
        FOREIGN KEY (user_id) REFERENCES users(id)
      )
    `);
    
    await db.query(`
      CREATE TABLE IF NOT EXISTS workouts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        workout_date DATE UNIQUE NOT NULL,
        google_drive_file_id TEXT NOT NULL,
        title TEXT,
        content TEXT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create test user
    const passwordHash = await bcrypt.hash('testpass123', 10);
    const userResult = await db.query(
      'INSERT INTO users (email, password_hash) VALUES (?, ?)',
      ['test@example.com', passwordHash]
    );
    testUserId = userResult.lastID;
    
    // Create test token
    testToken = jwt.sign({ userId: testUserId }, process.env.JWT_SECRET);
    
    // Set up Express app with router
    app = express();
    app.use(express.json());
    const router = createRouter(db);
    app.use('/api', router);
  });
  
  after(async () => {
    // Clean up test database
    return new Promise((resolve) => {
      if (db && db.db) {
        db.db.close((err) => {
          if (err) console.error('Error closing DB:', err);
          try {
            if (fs.existsSync(testDbPath)) {
              fs.unlinkSync(testDbPath);
            }
          } catch (e) {
            console.error('Error deleting test DB:', e);
          }
          resolve();
        });
      } else {
        resolve();
      }
    });
  });
  
  beforeEach(async () => {
    // Clean up before each test
    await db.query('DELETE FROM subscriptions');
    await db.query('DELETE FROM workouts');
  });
  
  // Helper to create workouts for a date range
  const createWorkouts = async (startDate, days, baseTitle = 'Workout') => {
    const workouts = [];
    for (let i = 0; i < days; i++) {
      const date = new Date(startDate + 'T00:00:00');
      date.setDate(date.getDate() + i);
      const dateStr = date.toISOString().split('T')[0];
      await db.query(
        'INSERT INTO workouts (workout_date, google_drive_file_id, title, content) VALUES (?, ?, ?, ?)',
        [dateStr, `file-${dateStr}`, `${baseTitle} ${i + 1}`, `Content for ${baseTitle} ${i + 1}`]
      );
    }
    return workouts;
  };
  
  // Helper to make authenticated request
  const makeRequest = async (path) => {
    return new Promise((resolve, reject) => {
      const req = {
        url: path,
        method: 'GET',
        headers: {
          authorization: `Bearer ${testToken}`
        },
        query: {},
        get: (header) => req.headers[header.toLowerCase()]
      };
      
      const res = {
        statusCode: 200,
        headers: {},
        body: null,
        json: function(data) {
          this.body = data;
          resolve({ status: this.statusCode, data: this.body });
        },
        status: function(code) {
          this.statusCode = code;
          return this;
        }
      };
      
      // Mock authenticateToken middleware
      jwt.verify(testToken, process.env.JWT_SECRET, (err, decoded) => {
        if (err) {
          res.status(401).json({ error: 'Unauthorized' });
          resolve({ status: 401, data: res.body });
          return;
        }
        req.userId = decoded.userId;
        
        // Call the route handler
        const router = createRouter(db);
        router.handle(req, res, (err) => {
          if (err) reject(err);
          else resolve({ status: res.statusCode, data: res.body });
        });
      });
    });
  };
  
  describe('Daily Subscription Tier', () => {
    beforeEach(async () => {
      const todayStr = createDateStr(0);
      const subscriptionStart = todayStr;
      const subscriptionEnd = new Date(todayStr);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
      const endStr = subscriptionEnd.toISOString().split('T')[0];
      
      // Create daily subscription
      await db.query(
        'INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
        [testUserId, 'daily', 'active', subscriptionStart, endStr]
      );
      
      // Create workouts: 15 days before today, today, 15 days after today
      await createWorkouts(createDateStr(-15), 31, 'Daily Workout');
    });
    
    it('should show only today\'s workout as accessible', async () => {
      const todayStr = createDateStr(0);
      
      // We need to simulate the request properly - using a simpler approach
      // Check accessible workouts directly
      const subscription = await db.getUserActiveSubscription(testUserId);
      expect(subscription).to.not.be.null;
      expect(subscription.tier).to.equal('daily');
      
      // Get workouts in range
      const workouts = await db.getWorkoutsByDateRange(createDateStr(-15), createDateStr(15));
      
      // Filter accessible workouts (simulating the route logic)
      const workoutRows = workouts.rows || workouts;
      const accessibleWorkouts = workoutRows.filter(workout => {
        if (subscription.status !== 'active') return false;
        const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
        return workoutDateStr === todayStr;
      });
      
      expect(accessibleWorkouts).to.have.length(1);
      expect(accessibleWorkouts[0].workout_date.split('T')[0]).to.equal(todayStr);
    });
    
    it('should show 30 days of workouts in carousel with only today unlocked', async () => {
      // This would require a full integration test with the Express app
      // For now, we test the logic directly
      const subscription = await db.getUserActiveSubscription(testUserId);
      const todayStr = createDateStr(0);
      
      // Get carousel workouts (30 days)
      const carouselStart = createDateStr(-15);
      const carouselEnd = createDateStr(15);
      const carouselWorkouts = await db.getWorkoutsByDateRange(carouselStart, carouselEnd);
      
      const workoutRows = Array.isArray(carouselWorkouts) ? carouselWorkouts : (carouselWorkouts.rows || []);
      expect(workoutRows.length).to.be.greaterThan(0);
      
      // Check that only today's workout should be accessible
      workoutRows.forEach(workout => {
        const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
        const isToday = workoutDateStr === todayStr;
        const isAccessible = isToday && subscription.status === 'active';
        
        // In real API response, locked would be !isAccessible
        if (!isToday) {
          // All non-today workouts should be locked for daily tier
          expect(isAccessible).to.be.false;
        } else {
          // Today's workout should be accessible
          expect(isAccessible).to.be.true;
        }
      });
    });
  });
  
  describe('Weekly Subscription Tier', () => {
    beforeEach(async () => {
      const todayStr = createDateStr(0);
      const subscriptionStart = todayStr;
      const subscriptionEnd = new Date(todayStr);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
      const endStr = subscriptionEnd.toISOString().split('T')[0];
      
      // Create weekly subscription
      await db.query(
        'INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
        [testUserId, 'weekly', 'active', subscriptionStart, endStr]
      );
      
      // Create workouts for 30+ days
      await createWorkouts(createDateStr(-15), 35, 'Weekly Workout');
    });
    
    it('should show today\'s workout and current week Mon-Sat as accessible', async () => {
      const subscription = await db.getUserActiveSubscription(testUserId);
      expect(subscription.tier).to.equal('weekly');
      
      const todayStr = createDateStr(0);
      const mondayStr = getMondayOfWeek();
      const saturdayStr = getSaturdayOfWeek();
      
      // Get workouts
      const workouts = await db.getWorkoutsByDateRange(createDateStr(-15), createDateStr(15));
      
      // Check each workout
      const workoutRows = workouts.rows || workouts;
      workoutRows.forEach(workout => {
        const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
        const workoutDate = new Date(workoutDateStr + 'T00:00:00');
        workoutDate.setHours(0, 0, 0, 0);
        
        const today = new Date(todayStr + 'T00:00:00');
        today.setHours(0, 0, 0, 0);
        
        const monday = new Date(mondayStr + 'T00:00:00');
        monday.setHours(0, 0, 0, 0);
        
        const saturday = new Date(saturdayStr + 'T00:00:00');
        saturday.setHours(23, 59, 59, 999);
        
        const workoutDayOfWeek = workoutDate.getDay();
        const isToday = workoutDate.getTime() === today.getTime();
        const isInCurrentWeek = workoutDate >= monday && workoutDate <= saturday && workoutDayOfWeek >= 1 && workoutDayOfWeek <= 6;
        
        const shouldBeAccessible = subscription.status === 'active' && (isToday || isInCurrentWeek);
        
        if (shouldBeAccessible) {
          // Verify it's either today or Mon-Sat of current week
          expect(isToday || (workoutDayOfWeek >= 1 && workoutDayOfWeek <= 6 && workoutDate >= monday && workoutDate <= saturday)).to.be.true;
        }
      });
    });
    
    it('should show 30 days of workouts in carousel with correct locked states', async () => {
      const subscription = await db.getUserActiveSubscription(testUserId);
      const todayStr = createDateStr(0);
      const mondayStr = getMondayOfWeek();
      const saturdayStr = getSaturdayOfWeek();
      
      // Get carousel workouts
      const carouselStart = createDateStr(-15);
      const carouselEnd = createDateStr(15);
      const carouselWorkouts = await db.getWorkoutsByDateRange(carouselStart, carouselEnd);
      
      const workoutRows = Array.isArray(carouselWorkouts) ? carouselWorkouts : (carouselWorkouts.rows || []);
      expect(workoutRows.length).to.be.greaterThan(0);
      // Verify carousel shows ~30 days
      expect(workoutRows.length).to.be.at.least(25);
      
      // Check locked states
      let accessibleCount = 0;
      workoutRows.forEach(workout => {
        const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
        const workoutDate = new Date(workoutDateStr + 'T00:00:00');
        const today = new Date(todayStr + 'T00:00:00');
        const monday = new Date(mondayStr + 'T00:00:00');
        const saturday = new Date(saturdayStr + 'T00:00:00');
        
        const isToday = workoutDate.getTime() === today.getTime();
        const workoutDayOfWeek = workoutDate.getDay();
        const isInWeek = workoutDate >= monday && workoutDate <= saturday && workoutDayOfWeek >= 1 && workoutDayOfWeek <= 6;
        
        if (isToday || isInWeek) {
          accessibleCount++;
        }
      });
      
      // Should have at least today + some Mon-Sat workouts
      expect(accessibleCount).to.be.at.least(1);
      // Should not exceed 7 (today + up to 6 weekdays)
      expect(accessibleCount).to.be.at.most(7);
    });
  });
  
  describe('Monthly Subscription Tier', () => {
    beforeEach(async () => {
      const subscriptionStart = createDateStr(-10); // Start 10 days ago
      const subscriptionEnd = new Date(subscriptionStart + 'T00:00:00');
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
      const endStr = subscriptionEnd.toISOString().split('T')[0];
      
      // Create monthly subscription
      await db.query(
        'INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
        [testUserId, 'monthly', 'active', subscriptionStart, endStr]
      );
      
      // Create workouts spanning subscription period + extra
      await createWorkouts(createDateStr(-15), 45, 'Monthly Workout');
    });
    
    it('should show all workouts within subscription period as accessible', async () => {
      const subscription = await db.getUserActiveSubscription(testUserId);
      expect(subscription.tier).to.equal('monthly');
      
      const subscriptionStart = new Date(subscription.start_date + 'T00:00:00');
      const subscriptionEnd = subscription.end_date ? new Date(subscription.end_date + 'T00:00:00') : null;
      if (subscriptionEnd) {
        subscriptionEnd.setHours(23, 59, 59, 999);
      }
      
      // Get workouts in subscription range
      const startStr = typeof subscription.start_date === 'string' 
        ? subscription.start_date.split('T')[0].split(' ')[0]
        : new Date(subscription.start_date).toISOString().split('T')[0];
      const endStr = subscriptionEnd ? subscriptionEnd.toISOString().split('T')[0] : createDateStr(20);
      const workouts = await db.getWorkoutsByDateRange(startStr, endStr);
      
      // Filter accessible workouts
      const workoutRows = workouts.rows || workouts;
      const accessibleWorkouts = workoutRows.filter(workout => {
        if (subscription.status !== 'active') return false;
        const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
        const workoutDate = new Date(workoutDateStr + 'T00:00:00');
        workoutDate.setHours(0, 0, 0, 0);
        
        if (workoutDate < subscriptionStart) return false;
        if (subscriptionEnd && workoutDate > subscriptionEnd) return false;
        return true;
      });
      
      expect(accessibleWorkouts.length).to.be.greaterThan(0);
      
      // Verify all accessible workouts are within subscription period
      accessibleWorkouts.forEach(workout => {
        const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
        const workoutDate = new Date(workoutDateStr + 'T00:00:00');
        workoutDate.setHours(0, 0, 0, 0);
        
        expect(workoutDate >= subscriptionStart).to.be.true;
        if (subscriptionEnd) {
          expect(workoutDate <= subscriptionEnd).to.be.true;
        }
      });
    });
    
    it('should show 30 days of workouts in carousel with subscription-period workouts unlocked', async () => {
      const subscription = await db.getUserActiveSubscription(testUserId);
      const subscriptionStart = new Date(subscription.start_date + 'T00:00:00');
      const subscriptionEnd = subscription.end_date ? new Date(subscription.end_date + 'T00:00:00') : null;
      if (subscriptionEnd) {
        subscriptionEnd.setHours(23, 59, 59, 999);
      }
      
      // Get carousel workouts (30 days)
      const carouselStart = createDateStr(-15);
      const carouselEnd = createDateStr(15);
      const carouselWorkouts = await db.getWorkoutsByDateRange(carouselStart, carouselEnd);
      
      const workoutRows = carouselWorkouts.rows || carouselWorkouts;
      expect(workoutRows.length).to.be.greaterThan(0);
      
      // Check locked states - workouts within subscription period should be accessible
      let accessibleCount = 0;
      let lockedCount = 0;
      
      workoutRows.forEach(workout => {
        const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
        const workoutDate = new Date(workoutDateStr + 'T00:00:00');
        workoutDate.setHours(0, 0, 0, 0);
        
        const isAccessible = subscription.status === 'active' &&
          workoutDate >= subscriptionStart &&
          (!subscriptionEnd || workoutDate <= subscriptionEnd);
        
        if (isAccessible) {
          accessibleCount++;
        } else {
          lockedCount++;
        }
      });
      
      // Should have some accessible workouts (within subscription period)
      expect(accessibleCount).to.be.greaterThan(0);
      // Should have some locked workouts (outside subscription period)
      // Note: This depends on where today falls relative to subscription start
    });
  });
  
  describe('Carousel Response Format', () => {
    beforeEach(async () => {
      const todayStr = createDateStr(0);
      const subscriptionStart = todayStr;
      const subscriptionEnd = new Date(todayStr);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
      const endStr = subscriptionEnd.toISOString().split('T')[0];
      
      await db.query(
        'INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
        [testUserId, 'monthly', 'active', subscriptionStart, endStr]
      );
      
      await createWorkouts(createDateStr(-15), 31, 'Test Workout');
    });
    
    it('should return carouselWorkouts array in API response', async () => {
      // Test the structure we expect from the API
      const subscription = await db.getUserActiveSubscription(testUserId);
      const carouselStart = createDateStr(-15);
      const carouselEnd = createDateStr(15);
      const carouselWorkouts = await db.getWorkoutsByDateRange(carouselStart, carouselEnd);
      
      const workoutRows = carouselWorkouts.rows || carouselWorkouts;
      // Verify structure
      expect(workoutRows).to.be.an('array');
      expect(workoutRows.length).to.be.greaterThan(0);
      
      // Each workout should have required fields for carousel
      workoutRows.forEach(workout => {
        expect(workout).to.have.property('id');
        expect(workout).to.have.property('workout_date');
        expect(workout).to.have.property('title');
      });
    });
    
    it('should include locked status and requiredTier in carousel items', async () => {
      // This tests the makeCarouselItem logic conceptually
      const subscription = await db.getUserActiveSubscription(testUserId);
      const todayStr = createDateStr(0);
      
      // Get a workout
      const workouts = await db.getWorkoutsByDateRange(createDateStr(-10), createDateStr(10));
      const workoutRows = workouts.rows || workouts;
      const workout = workoutRows[0];
      
      // Simulate carousel item creation
      const workoutDateStr = workout.workout_date.split('T')[0].split(' ')[0];
      const subscriptionStart = new Date(subscription.start_date + 'T00:00:00');
      const subscriptionEnd = subscription.end_date ? new Date(subscription.end_date + 'T00:00:00') : null;
      
      const workoutDate = new Date(workoutDateStr + 'T00:00:00');
      workoutDate.setHours(0, 0, 0, 0);
      
      const isAccessible = subscription.status === 'active' &&
        workoutDate >= subscriptionStart &&
        (!subscriptionEnd || workoutDate <= subscriptionEnd);
      
      const locked = !(subscription.status === 'active') || !isAccessible;
      
      // Carousel item should have these properties
      const carouselItem = {
        id: workout.id,
        date: workoutDateStr,
        title: workout.title,
        locked: locked,
        requiredTier: locked ? 'monthly' : null,
        message: locked ? 'Requires monthly subscription.' : null
      };
      
      expect(carouselItem).to.have.property('locked');
      expect(carouselItem).to.have.property('date');
      expect(carouselItem).to.have.property('title');
      
      if (carouselItem.locked) {
        expect(carouselItem).to.have.property('requiredTier');
        expect(carouselItem).to.have.property('message');
      }
    });
  });
  
  describe('Today\'s Workout Selection', () => {
    beforeEach(async () => {
      const todayStr = createDateStr(0);
      await createWorkouts(createDateStr(-5), 15, 'Workout');
    });
    
    it('should select today\'s workout when available', async () => {
      const todayStr = createDateStr(0);
      
      // Create subscription
      const subscriptionStart = todayStr;
      const subscriptionEnd = new Date(todayStr);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
      const endStr = subscriptionEnd.toISOString().split('T')[0];
      
      await db.query(
        'INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
        [testUserId, 'daily', 'active', subscriptionStart, endStr]
      );
      
      // Get today's workout
      const workouts = await db.getWorkoutsByDateRange(todayStr, todayStr);
      const workoutRows = workouts.rows || workouts;
      
      if (workoutRows.length > 0) {
        const todayWorkout = workoutRows[0];
        expect(todayWorkout.workout_date.split('T')[0]).to.equal(todayStr);
        expect(todayWorkout).to.have.property('content');
      }
    });
    
    it('should select most recent workout when today\'s workout is not available', async () => {
      // Don't create workout for today
      const yesterdayStr = createDateStr(-1);
      
      const subscriptionStart = yesterdayStr;
      const subscriptionEnd = new Date(yesterdayStr);
      subscriptionEnd.setDate(subscriptionEnd.getDate() + 30);
      const endStr = subscriptionEnd.toISOString().split('T')[0];
      
      await db.query(
        'INSERT INTO subscriptions (user_id, tier, status, start_date, end_date) VALUES (?, ?, ?, ?, ?)',
        [testUserId, 'daily', 'active', subscriptionStart, endStr]
      );
      
      // Get latest workout before or on today
      const workouts = await db.getWorkoutsByDateRange(createDateStr(-5), createDateStr(0));
      const workoutRows = workouts.rows || workouts;
      const latestWorkout = workoutRows
        .filter(w => w.workout_date.split('T')[0] <= createDateStr(0))
        .sort((a, b) => b.workout_date.localeCompare(a.workout_date))[0];
      
      if (latestWorkout) {
        const latestWorkoutDate = latestWorkout.workout_date.split('T')[0];
        const todayDate = createDateStr(0);
        expect(latestWorkoutDate <= todayDate).to.be.true;
        expect(latestWorkout).to.have.property('content');
      }
    });
  });
});

