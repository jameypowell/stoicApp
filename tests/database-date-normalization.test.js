/**
 * Tests for database date normalization
 * Ensures that dates are consistently returned as YYYY-MM-DD strings
 * regardless of whether using SQLite or PostgreSQL
 */

const { describe, it, before, after } = require('mocha');
const { expect } = require('chai');
const sqlite3 = require('sqlite3').verbose();
const { Client } = require('pg');
const path = require('path');
const fs = require('fs');

// Import the Database class
const { Database } = require('../database');

describe('Database Date Normalization', () => {
  let sqliteDb;
  let testDbPath;
  
  before(() => {
    // Create a test SQLite database
    testDbPath = path.join(__dirname, 'test-dates.db');
    sqliteDb = new sqlite3.Database(testDbPath);
    
    // Create test schema
    return new Promise((resolve, reject) => {
      sqliteDb.serialize(() => {
        sqliteDb.run(`
          CREATE TABLE IF NOT EXISTS test_workouts (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            workout_date DATE NOT NULL,
            title TEXT
          )
        `, (err) => {
          if (err) reject(err);
          else resolve();
        });
      });
    });
  });
  
  after(() => {
    return new Promise((resolve) => {
      if (sqliteDb) {
        sqliteDb.close((err) => {
          if (err) console.error('Error closing SQLite DB:', err);
          // Clean up test database file
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
  
  describe('SQLite Date Normalization', () => {
    it('should normalize date strings from SQLite to YYYY-MM-DD format', async () => {
      // Create a Database instance with isPostgres = false
      const db = new Database(sqliteDb);
      db.isPostgres = false; // Override for testing
      
      // Insert a test workout with a date
      await db.query(
        'INSERT INTO test_workouts (workout_date, title) VALUES (?, ?)',
        ['2025-11-15', 'Test Workout']
      );
      
      // Query it back
      const result = await db.queryOne(
        'SELECT * FROM test_workouts WHERE workout_date = ?',
        ['2025-11-15']
      );
      
      expect(result).to.not.be.null;
      expect(result.workout_date).to.be.a('string');
      expect(result.workout_date).to.equal('2025-11-15');
      expect(result.workout_date).to.match(/^\d{4}-\d{2}-\d{2}$/);
    });
    
    it('should handle multiple rows with date normalization', async () => {
      const db = new Database(sqliteDb);
      db.isPostgres = false; // Override for testing
      
      // Insert multiple workouts
      await db.query(
        'INSERT INTO test_workouts (workout_date, title) VALUES (?, ?)',
        ['2025-11-16', 'Workout 2']
      );
      await db.query(
        'INSERT INTO test_workouts (workout_date, title) VALUES (?, ?)',
        ['2025-11-17', 'Workout 3']
      );
      
      // Query all
      const result = await db.query(
        'SELECT * FROM test_workouts ORDER BY workout_date'
      );
      
      expect(result.rows).to.have.length.greaterThan(0);
      result.rows.forEach(row => {
        expect(row.workout_date).to.be.a('string');
        expect(row.workout_date).to.match(/^\d{4}-\d{2}-\d{2}$/);
      });
    });
  });
  
  describe('Date Field Normalization Logic', () => {
    it('should normalize Date objects to YYYY-MM-DD strings', () => {
      const db = new Database(sqliteDb);
      db.isPostgres = false; // Override for testing
      
      const testDate = new Date('2025-11-15T10:30:00Z');
      const row = {
        id: 1,
        workout_date: testDate,
        title: 'Test'
      };
      
      const normalized = db.normalizeDateFields(row);
      
      expect(normalized.workout_date).to.be.a('string');
      expect(normalized.workout_date).to.equal('2025-11-15');
      expect(normalized.workout_date).to.match(/^\d{4}-\d{2}-\d{2}$/);
    });
    
    it('should keep YYYY-MM-DD strings as-is', () => {
      const db = new Database(sqliteDb);
      db.isPostgres = false; // Override for testing
      
      const row = {
        id: 1,
        workout_date: '2025-11-15',
        title: 'Test'
      };
      
      const normalized = db.normalizeDateFields(row);
      
      expect(normalized.workout_date).to.equal('2025-11-15');
    });
    
    it('should handle date strings with time components', () => {
      const db = new Database(sqliteDb);
      db.isPostgres = false; // Override for testing
      
      const row = {
        id: 1,
        workout_date: '2025-11-15T10:30:00Z',
        title: 'Test'
      };
      
      const normalized = db.normalizeDateFields(row);
      
      expect(normalized.workout_date).to.equal('2025-11-15');
    });
    
    it('should normalize multiple date fields', () => {
      const db = new Database(sqliteDb);
      db.isPostgres = false; // Override for testing
      
      const row = {
        id: 1,
        workout_date: new Date('2025-11-15'),
        start_date: new Date('2025-11-01'),
        end_date: new Date('2025-11-30'),
        title: 'Test'
      };
      
      const normalized = db.normalizeDateFields(row);
      
      expect(normalized.workout_date).to.equal('2025-11-15');
      expect(normalized.start_date).to.equal('2025-11-01');
      expect(normalized.end_date).to.equal('2025-11-30');
    });
    
    it('should handle null date fields', () => {
      const db = new Database(sqliteDb);
      db.isPostgres = false; // Override for testing
      
      const row = {
        id: 1,
        workout_date: null,
        end_date: null,
        title: 'Test'
      };
      
      const normalized = db.normalizeDateFields(row);
      
      expect(normalized.workout_date).to.be.null;
      expect(normalized.end_date).to.be.null;
    });
  });
});

