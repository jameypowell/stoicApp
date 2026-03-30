/**
 * Production API Integration Tests
 * These tests verify that the production API endpoints work correctly
 * for each subscription tier type.
 * 
 * Run with: PROD_URL=https://your-production-url.com npm test -- tests/production-api.test.js
 */

const { describe, it, before, beforeEach } = require('mocha');
const { expect } = require('chai');
const https = require('https');
const http = require('http');

const PROD_URL = process.env.PROD_URL || 'http://localhost:3000';

// Helper to fetch with SSL certificate validation disabled (for ALB DNS testing)
// Follows redirects automatically
function fetchWithSSLIgnore(url, options = {}, followRedirects = true, maxRedirects = 5) {
  return new Promise((resolve, reject) => {
    if (maxRedirects === 0) {
      reject(new Error('Too many redirects'));
      return;
    }
    
    const parsedUrl = new URL(url);
    const isHttps = parsedUrl.protocol === 'https:';
    const client = isHttps ? https : http;
    
    const requestOptions = {
      hostname: parsedUrl.hostname,
      port: parsedUrl.port || (isHttps ? 443 : 80),
      path: parsedUrl.pathname + parsedUrl.search,
      method: options.method || 'GET',
      headers: options.headers || {},
      // Disable SSL certificate validation for ALB DNS names (cert is for custom domain)
      ...(isHttps ? { rejectUnauthorized: false } : {})
    };
    
    const req = client.request(requestOptions, (res) => {
      // Handle redirects
      if (followRedirects && (res.statusCode === 301 || res.statusCode === 302 || res.statusCode === 307 || res.statusCode === 308)) {
        const location = res.headers.location;
        if (location) {
          const redirectUrl = location.startsWith('http') ? location : `${parsedUrl.protocol}//${parsedUrl.hostname}${location}`;
          return resolve(fetchWithSSLIgnore(redirectUrl, options, followRedirects, maxRedirects - 1));
        }
      }
      
      let data = '';
      res.on('data', (chunk) => { data += chunk; });
      res.on('end', () => {
        resolve({
          status: res.statusCode,
          statusText: res.statusMessage,
          headers: res.headers,
          ok: res.statusCode >= 200 && res.statusCode < 300,
          json: () => Promise.resolve(JSON.parse(data || '{}')),
          text: () => Promise.resolve(data)
        });
      });
    });
    
    req.on('error', reject);
    if (options.body) {
      req.write(options.body);
    }
    req.end();
  });
}

describe('Production API Integration Tests', () => {
  before(async function() {
    // Skip tests if no production URL is provided
    if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
      this.skip();
    }
  });

  describe('Health Check', () => {
    it('should return 200 from /health endpoint', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }
      
      const response = await fetchWithSSLIgnore(`${PROD_URL}/health`);
      expect(response.status).to.equal(200);
    });
  });

  describe('Authentication', () => {
    it('should require authentication for protected endpoints', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }
      
      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/workouts`);
      expect(response.status).to.equal(401);
    });
  });

  describe('Workout Access - Subscription Tiers', () => {
    // These tests would require:
    // 1. Test user accounts for each tier (daily, weekly, monthly)
    // 2. Authentication tokens for each test user
    // 3. Proper test data setup in production
    
    it('should return workouts endpoint structure', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }
      
      // This test verifies the endpoint exists and returns expected structure
      // Actual authentication would be needed for real testing
      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/workouts`, {
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      });
      
      // Should return 401 for invalid token, which confirms endpoint exists
      expect([401, 403]).to.include(response.status);
    });
  });

  describe('Subscription Endpoints', () => {
    it('should return subscription endpoint structure', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }
      
      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/subscriptions/me`, {
        headers: {
          'Authorization': 'Bearer invalid-token'
        }
      });
      
      // Should return 401 for invalid token, which confirms endpoint exists
      expect([401, 403]).to.include(response.status);
    });
  });

  describe('Password Management', () => {
    let testEmail;
    let testPassword;
    let authToken;
    let resetToken;

    beforeEach(function() {
      // Generate unique test email for each test run
      testEmail = `test-password-${Date.now()}@example.com`;
      testPassword = 'TestPassword123!';
    });

    it('should allow user to register with password', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }

      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword
        })
      });

      const data = await response.json();

      expect(response.status).to.equal(201);
      expect(data).to.have.property('token');
      expect(data).to.have.property('user');
      expect(data.user).to.have.property('email', testEmail);
      
      authToken = data.token;
    });

    it('should allow user to login with password', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }

      // First register the user
      const registerResponse = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword
        })
      });

      if (registerResponse.status !== 201) {
        // User might already exist, try login instead
        const loginResponse = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/login`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({
            email: testEmail,
            password: testPassword
          })
        });

        const loginData = await loginResponse.json();
        expect(loginResponse.status).to.equal(200);
        expect(loginData).to.have.property('token');
        authToken = loginData.token;
      } else {
        const registerData = await registerResponse.json();
        authToken = registerData.token;
      }

      // Now test login
      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword
        })
      });

      const data = await response.json();

      expect(response.status).to.equal(200);
      expect(data).to.have.property('token');
      expect(data).to.have.property('user');
      expect(data.user).to.have.property('email', testEmail);
    });

    it('should allow user to request password reset', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }

      // First register the user
      const registerResponse = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword
        })
      });

      // Request password reset
      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail
        })
      });

      const data = await response.json();

      expect(response.status).to.equal(200);
      expect(data).to.have.property('message');
      expect(data.message).to.include('password reset');
      
      // In development, resetUrl might be provided
      if (data.resetUrl) {
        resetToken = data.resetUrl.split('token=')[1];
      }
    });

    it('should allow user to reset password with valid token', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }

      // First register the user
      await fetchWithSSLIgnore(`${PROD_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail,
          password: testPassword
        })
      });

      // Request password reset
      const forgotResponse = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/forgot-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail
        })
      });

      const forgotData = await forgotResponse.json();
      
      // Skip if we don't have a reset token (production mode - email would be sent)
      if (!forgotData.resetUrl) {
        this.skip();
      }

      resetToken = forgotData.resetUrl.split('token=')[1];
      const newPassword = 'NewPassword123!';

      // Reset password
      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: resetToken,
          password: newPassword
        })
      });

      const data = await response.json();

      expect(response.status).to.equal(200);
      expect(data).to.have.property('message');
      expect(data.message).to.include('successful');

      // Verify we can login with new password
      const loginResponse = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/login`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: testEmail,
          password: newPassword
        })
      });

      const loginData = await loginResponse.json();
      expect(loginResponse.status).to.equal(200);
      expect(loginData).to.have.property('token');
    });

    it('should reject password reset with invalid token', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }

      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/reset-password`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          token: 'invalid-token-12345',
          password: 'NewPassword123!'
        })
      });

      const data = await response.json();

      expect(response.status).to.equal(400);
      expect(data).to.have.property('error');
      expect(data.error).to.include('Invalid or expired');
    });

    it('should reject registration with password less than 6 characters', async function() {
      if (!process.env.PROD_URL || process.env.PROD_URL === 'http://localhost:3000') {
        this.skip();
      }

      const response = await fetchWithSSLIgnore(`${PROD_URL}/api/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          email: `test-short-${Date.now()}@example.com`,
          password: '12345' // Too short
        })
      });

      expect(response.status).to.equal(400);
    });
  });
});

