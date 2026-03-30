// API routes for authentication, payments, and workouts
const express = require('express');
const { body, validationResult } = require('express-validator');
const { authenticateToken } = require('./auth');
const { Database, generateHouseholdId } = require('./database');
const { comparePassword, generateToken } = require('./auth');
const { 
  TIER_PRICING, 
  createCustomer, 
  createPaymentIntent,
  getPaymentIntent,
  createSubscription,
  getSubscription,
  calculateEndDate,
  hasAccessToDate,
  calculateUpgradePrice,
  calculateProratedPrice,
  getAvailableUpgrades,
  cancelSubscription,
  normalizeTier
} = require('./payments');
const { getFeatureLimit } = require('./tier-access-config');
const { subscriptionEndToYmdDenver, todayYmdDenver } = require('./lib/mountain-time');

// Helper function to get client IP address
function getClientIP(req) {
  return req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
         req.headers['x-real-ip'] ||
         req.connection?.remoteAddress ||
         req.socket?.remoteAddress ||
         req.ip ||
         'Unknown';
}

// Helper function to get location from IP (simplified - can be enhanced with GeoIP service)
async function getLocationFromIP(ip) {
  // Skip localhost/private IPs
  if (!ip || ip === 'Unknown' || ip.startsWith('127.') || ip.startsWith('192.168.') || ip.startsWith('10.') || ip === '::1') {
    return 'Local';
  }
  
  // For now, return IP-based location hint (can be enhanced with GeoIP service like MaxMind)
  // In production, you might want to use a service like:
  // - MaxMind GeoIP2
  // - ipapi.co
  // - ip-api.com
  // For now, return a simple format
  return ip;
}

// Get Price ID for a tier (for Stripe subscriptions). Supports both legacy (daily/weekly/monthly) and new (tier_two/tier_three/tier_four) names.
function getPriceIdForTier(tier) {
  const priceMap = {
    daily: process.env.STRIPE_PRICE_DAILY,
    weekly: process.env.STRIPE_PRICE_WEEKLY,
    monthly: process.env.STRIPE_PRICE_MONTHLY,
    tier_two: process.env.STRIPE_PRICE_TIER_TWO || process.env.STRIPE_PRICE_DAILY,
    tier_three: process.env.STRIPE_PRICE_TIER_THREE || process.env.STRIPE_PRICE_WEEKLY,
    tier_four: process.env.STRIPE_PRICE_TIER_FOUR || process.env.STRIPE_PRICE_MONTHLY
  };
  return priceMap[tier];
}
const { membershipTypeToDb } = require('./utils/membership-mappings');
const { syncWorkoutFromSlides, syncAllWorkoutsFromSlides } = require('./google-drive');
const { syncAllGymMemberships } = require('./gym-membership-sync');
const gymProfileSchema = require('./config/gym-member-profile-schema');
const membershipContractRules = require('./config/membership-contract-rules');
const { getContractStartEndYmdFromSucceededPaymentIntent } = require('./lib/gym-contract-dates');
const { reanchorGymContractForEmail } = require('./lib/reanchor-gym-contract');
const { google } = require('googleapis');
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);
const { buildSubscriptionClientPayload } = require('./subscription-client-payload');

/**
 * After a succeeded gym-related PaymentIntent, attach PM to customer, set defaults, and persist on gym_memberships
 * so nightly renewal and UI can charge the same card again.
 */
async function persistGymMembershipCardFromSucceededPayment(stripe, db, membership, pi) {
  if (!pi || pi.status !== 'succeeded' || !membership?.id) return;
  const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : pi.payment_method?.id;
  if (!pmId) return;
  const stripeCustomerId =
    membership.stripe_customer_id ||
    (typeof pi.customer === 'string' ? pi.customer : pi.customer?.id || null);
  if (!stripeCustomerId) return;

  try {
    let paymentMethod = await stripe.paymentMethods.retrieve(pmId);
    let paymentMethodExpiresAt = null;
    if (paymentMethod.card && paymentMethod.card.exp_year && paymentMethod.card.exp_month) {
      paymentMethodExpiresAt = new Date(
        paymentMethod.card.exp_year,
        paymentMethod.card.exp_month,
        0,
        23,
        59,
        59
      ).toISOString();
    }
    if (paymentMethod.customer !== stripeCustomerId) {
      await stripe.paymentMethods.attach(pmId, { customer: stripeCustomerId });
      paymentMethod = await stripe.paymentMethods.retrieve(pmId);
    }
    await stripe.customers.update(stripeCustomerId, {
      invoice_settings: { default_payment_method: pmId }
    });
    if (membership.stripe_subscription_id) {
      try {
        await stripe.subscriptions.update(membership.stripe_subscription_id, {
          default_payment_method: pmId
        });
      } catch (subErr) {
        console.warn('persistGymMembershipCard: subscription default PM:', subErr.message);
      }
    }
    await db.updateGymMembershipPaymentMethod(membership.id, pmId, paymentMethodExpiresAt);
    if (!membership.stripe_customer_id) {
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
          : 'UPDATE gym_memberships SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [stripeCustomerId, membership.id]
      );
    }
  } catch (err) {
    console.error('persistGymMembershipCardFromSucceededPayment:', err.message);
  }
}

/**
 * Include the group leader's gym_memberships row in the seed when they are not already listed with
 * discount_group_id, so household_id / family_group_id can be used to find immediate family.
 */
async function buildSeedRowsForDiscountGroupHouseholdExpand(db, directList, groupLeaderId) {
  const seed = [...directList];
  const inSeed = new Set(seed.map((r) => Number(r.user_id)).filter((n) => Number.isFinite(n)));
  const lid = groupLeaderId != null ? Number(groupLeaderId) : NaN;
  if (!Number.isFinite(lid) || lid <= 0 || inSeed.has(lid)) {
    return seed;
  }
  const row = await db.queryOne(
    db.isPostgres
      ? `SELECT u.id AS user_id, u.email, u.name, gm.household_id, gm.family_group_id, gm.status, gm.membership_type
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE u.id = $1
         ORDER BY gm.id DESC
         LIMIT 1`
      : `SELECT u.id AS user_id, u.email, u.name, gm.household_id, gm.family_group_id, gm.status, gm.membership_type
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE u.id = ?
         ORDER BY gm.id DESC
         LIMIT 1`,
    [lid]
  );
  if (row) seed.push(row);
  return seed;
}

function dedupeGymMemberRowsByUserId(rows) {
  const seen = new Set();
  const out = [];
  for (const row of rows) {
    const uid = Number(row.u_id ?? row.user_id);
    if (!Number.isFinite(uid) || uid <= 0 || seen.has(uid)) continue;
    seen.add(uid);
    out.push(row);
  }
  return out;
}

/**
 * Members who share household_id or family_group_id with someone on this discount group but may not
 * have discount_group_id on their own gym_memberships row (e.g. immediate family billed with primary).
 * Also includes gym members tied to family_groups where primary_user_id is anyone in the seed set.
 */
async function fetchExtraHouseholdFamilyMembersForDiscountGroup(db, directRows) {
  const directUserIds = [
    ...new Set(
      directRows
        .map((r) => Number(r.user_id))
        .filter((n) => Number.isFinite(n) && n > 0)
    )
  ];
  if (directUserIds.length === 0) return [];

  const hhIds = [...new Set(directRows.map((r) => r.household_id).filter((h) => h != null && String(h).trim() !== ''))];

  const batches = [];

  // Shared household_id (e.g. HH-… on primary row)
  if (hhIds.length > 0) {
    if (db.isPostgres) {
      const r = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.household_id = ANY($1::text[])
           AND NOT (u.id = ANY($2::int[]))`,
        [hhIds, directUserIds]
      );
      batches.push(...(r.rows || []));
    } else {
      const r = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.household_id IN (${hhIds.map(() => '?').join(',')})
           AND u.id NOT IN (${directUserIds.map(() => '?').join(',')})`,
        [...hhIds, ...directUserIds]
      );
      batches.push(...(r.rows || []));
    }
  }

  // Immediate family: all members sharing a family_groups row with anyone in the seed (discount_group
  // members + leader seed). Links: fg.id = gm.family_group_id OR fg.primary_user_id = seed user.
  try {
    if (db.isPostgres) {
      const rf = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.family_group_id IN (
           SELECT DISTINCT fg.id
           FROM family_groups fg
           INNER JOIN gym_memberships gm2 ON gm2.user_id = ANY($1::int[])
           WHERE fg.id = gm2.family_group_id OR fg.primary_user_id = gm2.user_id
         )
         AND NOT (u.id = ANY($1::int[]))`,
        [directUserIds]
      );
      batches.push(...(rf.rows || []));
    } else {
      const ph = directUserIds.map(() => '?').join(',');
      const rf = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.family_group_id IN (
           SELECT DISTINCT fg.id
           FROM family_groups fg
           INNER JOIN gym_memberships gm2 ON gm2.user_id IN (${ph})
           WHERE fg.id = gm2.family_group_id OR fg.primary_user_id = gm2.user_id
         )
         AND u.id NOT IN (${ph})`,
        [...directUserIds, ...directUserIds]
      );
      batches.push(...(rf.rows || []));
    }
  } catch (famErr) {
    console.warn('fetchExtraHouseholdFamilyMembers family_group expansion:', famErr.message);
  }

  // Primary account rows sometimes have NULL family_group_id while dependents point at fg.id.
  // Include the primary_user_id for every family_groups row tied to the seed so the owner appears in group lists.
  try {
    if (db.isPostgres) {
      const rp = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.user_id IN (
           SELECT fg.primary_user_id
           FROM family_groups fg
           WHERE fg.id IN (
             SELECT DISTINCT fg2.id
             FROM family_groups fg2
             INNER JOIN gym_memberships gm2 ON gm2.user_id = ANY($1::int[])
             WHERE fg2.id = gm2.family_group_id OR fg2.primary_user_id = gm2.user_id
           )
         )
         AND NOT (u.id = ANY($1::int[]))`,
        [directUserIds]
      );
      batches.push(...(rp.rows || []));
    } else {
      const ph = directUserIds.map(() => '?').join(',');
      const rp = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.user_id IN (
           SELECT fg.primary_user_id
           FROM family_groups fg
           WHERE fg.id IN (
             SELECT DISTINCT fg2.id
             FROM family_groups fg2
             INNER JOIN gym_memberships gm2 ON gm2.user_id IN (${ph})
             WHERE fg2.id = gm2.family_group_id OR fg2.primary_user_id = gm2.user_id
           )
         )
         AND u.id NOT IN (${ph})`,
        [...directUserIds, ...directUserIds]
      );
      batches.push(...(rp.rows || []));
    }
  } catch (primErr) {
    console.warn('fetchExtraHouseholdFamilyMembers family primary_user_id expansion:', primErr.message);
  }

  // gym_memberships.household_id is UNIQUE in schema — only one row can hold a given HH-… id, so
  // household_id expansion above rarely adds co-tenants. Family members often share Stripe billing:
  // same subscription (multi-item / family add-ons) or same customer on users / gym_memberships.
  try {
    if (db.isPostgres) {
      const rs = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.stripe_subscription_id IS NOT NULL
           AND TRIM(gm.stripe_subscription_id::text) <> ''
           AND gm.stripe_subscription_id IN (
             SELECT gm2.stripe_subscription_id FROM gym_memberships gm2
             WHERE gm2.user_id = ANY($1::int[])
               AND gm2.stripe_subscription_id IS NOT NULL
               AND TRIM(gm2.stripe_subscription_id::text) <> ''
           )
           AND NOT (u.id = ANY($1::int[]))`,
        [directUserIds]
      );
      batches.push(...(rs.rows || []));
      const rc = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE NOT (u.id = ANY($1::int[]))
           AND gm.membership_type IN ('immediate_family_member', 'expecting_or_recovering_mother')
           AND (
             (gm.stripe_customer_id IS NOT NULL AND TRIM(gm.stripe_customer_id::text) <> ''
               AND gm.stripe_customer_id IN (
                 SELECT gm2.stripe_customer_id FROM gym_memberships gm2
                 WHERE gm2.user_id = ANY($1::int[])
                   AND gm2.stripe_customer_id IS NOT NULL AND TRIM(gm2.stripe_customer_id::text) <> ''
               ))
             OR (u.stripe_customer_id IS NOT NULL AND TRIM(u.stripe_customer_id::text) <> ''
               AND (
                 u.stripe_customer_id IN (
                   SELECT u2.stripe_customer_id FROM users u2
                   WHERE u2.id = ANY($1::int[]) AND u2.stripe_customer_id IS NOT NULL AND TRIM(u2.stripe_customer_id::text) <> ''
                 )
                 OR u.stripe_customer_id IN (
                   SELECT gm2.stripe_customer_id FROM gym_memberships gm2
                   WHERE gm2.user_id = ANY($1::int[])
                     AND gm2.stripe_customer_id IS NOT NULL AND TRIM(gm2.stripe_customer_id::text) <> ''
                 )
               ))
           )`,
        [directUserIds]
      );
      batches.push(...(rc.rows || []));
    } else {
      const ph = directUserIds.map(() => '?').join(',');
      const rs = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE gm.stripe_subscription_id IS NOT NULL AND TRIM(gm.stripe_subscription_id) <> ''
           AND gm.stripe_subscription_id IN (
             SELECT gm2.stripe_subscription_id FROM gym_memberships gm2
             WHERE gm2.user_id IN (${ph})
               AND gm2.stripe_subscription_id IS NOT NULL AND TRIM(gm2.stripe_subscription_id) <> ''
           )
           AND u.id NOT IN (${ph})`,
        [...directUserIds, ...directUserIds]
      );
      batches.push(...(rs.rows || []));
      const rc = await db.query(
        `SELECT gm.user_id, gm.status, gm.membership_type, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name
         FROM gym_memberships gm
         JOIN users u ON u.id = gm.user_id
         WHERE u.id NOT IN (${ph})
           AND gm.membership_type IN ('immediate_family_member', 'expecting_or_recovering_mother')
           AND (
             (gm.stripe_customer_id IS NOT NULL AND TRIM(gm.stripe_customer_id) <> ''
               AND gm.stripe_customer_id IN (
                 SELECT gm2.stripe_customer_id FROM gym_memberships gm2
                 WHERE gm2.user_id IN (${ph})
                   AND gm2.stripe_customer_id IS NOT NULL AND TRIM(gm2.stripe_customer_id) <> ''
               ))
             OR (u.stripe_customer_id IS NOT NULL AND TRIM(u.stripe_customer_id) <> ''
               AND (
                 u.stripe_customer_id IN (
                   SELECT u2.stripe_customer_id FROM users u2
                   WHERE u2.id IN (${ph}) AND u2.stripe_customer_id IS NOT NULL AND TRIM(u2.stripe_customer_id) <> ''
                 )
                 OR u.stripe_customer_id IN (
                   SELECT gm2.stripe_customer_id FROM gym_memberships gm2
                   WHERE gm2.user_id IN (${ph})
                     AND gm2.stripe_customer_id IS NOT NULL AND TRIM(gm2.stripe_customer_id) <> ''
                 )
               ))
           )`,
        [...directUserIds, ...directUserIds, ...directUserIds, ...directUserIds]
      );
      batches.push(...(rc.rows || []));
    }
  } catch (stripeErr) {
    console.warn('fetchExtraHouseholdFamilyMembers Stripe expansion:', stripeErr.message);
  }

  return dedupeGymMemberRowsByUserId(batches);
}

function createRouter(db) {
  const router = express.Router();

  /** DB subscription rows that grant normal app access (aligned with getUserActiveSubscription). */
  function subscriptionRowGrantsAccess(sub) {
    if (!sub) return false;
    const st = sub.status;
    return st === 'active' || st === 'grace_period' || st === 'free_trial';
  }

  // ========== Public Routes ==========

  // Get Stripe publishable key
  router.get('/stripe-key', (req, res) => {
    res.json({
      publishableKey: process.env.STRIPE_PUBLISHABLE_KEY || ''
    });
  });

  // ========== Auth Routes ==========

  // Register new user
  router.post('/auth/register', 
    [
      body('email').isEmail().normalizeEmail(),
      body('password').isLength({ min: 6 })
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Check if user already exists
        const existingUser = await db.getUserByEmail(email);
        if (existingUser) {
          return res.status(400).json({ error: 'User already exists' });
        }

        // Create user
        const user = await db.createUser(email, password);
        const token = generateToken(user.id);

        res.status(201).json({
          message: 'User created successfully',
          user: { id: user.id, email: user.email },
          token
        });
      } catch (error) {
        console.error('Registration error:', error);
        res.status(500).json({ error: 'Registration failed' });
      }
    }
  );

  // Login
  router.post('/auth/login',
    [
      body('email').isEmail().normalizeEmail(),
      body('password').notEmpty()
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { email, password } = req.body;

        // Find user (getUserByEmail is case-insensitive)
        const user = await db.getUserByEmail(email);
        if (!user) {
          return res.status(401).json({ error: 'Invalid credentials' });
        }
        if (!user.password_hash || String(user.password_hash).startsWith('OAUTH_USER_')) {
          return res.status(401).json({ error: 'This account uses Google sign-in. Please use "Sign in with Google".' });
        }

        // Verify password (trim to match reset-password behavior)
        const trimmedPassword = typeof password === 'string' ? password.trim() : password;
        const isValid = await comparePassword(trimmedPassword, user.password_hash);
        if (!isValid) {
          const isTempCodeValid = await db.verifyLoginCode(user.id, trimmedPassword);
          if (!isTempCodeValid) {
            return res.status(401).json({ error: 'Invalid credentials' });
          }
          return res.json({
            message: 'Temporary code accepted. Please set a new password.',
            requiresPasswordChange: true,
            email: user.email
          });
        }

        // Get IP and location
        const clientIP = getClientIP(req);
        const location = await getLocationFromIP(clientIP);

        // Update last_login timestamp, IP, and location
        if (db.isPostgres) {
          await db.query(
            'UPDATE users SET last_login = CURRENT_TIMESTAMP, last_login_ip = $1, last_login_location = $2 WHERE id = $3',
            [clientIP, location, user.id]
          );
        } else {
          await db.query(
            'UPDATE users SET last_login = datetime(\'now\'), last_login_ip = ?, last_login_location = ? WHERE id = ?',
            [clientIP, location, user.id]
          );
        }

        // Generate token
        const token = generateToken(user.id);

        res.json({
          message: 'Login successful',
          user: { id: user.id, email: user.email },
          token
        });
      } catch (error) {
        console.error('Login error:', error);
        res.status(500).json({ error: 'Login failed' });
      }
    }
  );

  // Complete admin-issued temporary code login by setting a new password.
  router.post('/auth/complete-temp-login',
    [
      body('email').isEmail().normalizeEmail(),
      body('tempCode').matches(/^\d{6}$/),
      body('newPassword').isLength({ min: 6 })
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { email, tempCode, newPassword } = req.body;
        const user = await db.getUserByEmail(email);
        if (!user) {
          return res.status(401).json({ error: 'Invalid code or email' });
        }
        if (!user.password_hash || String(user.password_hash).startsWith('OAUTH_USER_')) {
          return res.status(400).json({ error: 'This account uses Google sign-in. Please use "Sign in with Google".' });
        }

        const codeOk = await db.consumeLoginCode(user.id, tempCode);
        if (!codeOk) {
          return res.status(401).json({ error: 'Invalid or expired temporary code' });
        }

        const trimmedPassword = typeof newPassword === 'string' ? newPassword.trim() : newPassword;
        if (!trimmedPassword || trimmedPassword.length < 6) {
          return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash(trimmedPassword, 10);
        await db.updateUserPassword(user.id, passwordHash);

        const token = generateToken(user.id);
        res.json({
          message: 'Password updated successfully',
          user: { id: user.id, email: user.email },
          token
        });
      } catch (error) {
        console.error('Complete temp login error:', error);
        res.status(500).json({ error: 'Failed to set new password' });
      }
    }
  );

  // Request password reset
  router.post('/auth/forgot-password',
    [
      body('email').isEmail().normalizeEmail()
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { email } = req.body;

        // Find user
        const user = await db.getUserByEmail(email);
        if (!user) {
          // Don't reveal if user exists - return success anyway for security
          return res.json({ 
            message: 'If an account with that email exists, a password reset link has been sent.' 
          });
        }

        // Check if user is OAuth-only (has placeholder password)
        if (user.password_hash && user.password_hash.startsWith('OAUTH_USER_')) {
          return res.status(400).json({ 
            error: 'This account was created with Google sign-in. Please use "Sign in with Google" instead.' 
          });
        }

        // Generate secure reset token
        const crypto = require('crypto');
        const resetToken = crypto.randomBytes(32).toString('hex');
        const expiresAt = new Date();
        expiresAt.setHours(expiresAt.getHours() + 1); // Token expires in 1 hour

        // Store reset token
        await db.createPasswordResetToken(user.id, resetToken, expiresAt.toISOString());

        // TODO: Send email with reset link
        // For now, return token in response (for testing)
        // In production, send email and don't return token
        const frontendUrl = process.env.FRONTEND_URL || 
          `${req.protocol}://${req.get('host')}`;
        const resetUrl = `${frontendUrl}/reset-password?token=${resetToken}`;

        // In production, send email here instead of returning token
        // For now, return the reset URL (remove this in production)
        res.json({ 
          message: 'If an account with that email exists, a password reset link has been sent.',
          // Remove this in production - only for testing
          resetUrl: process.env.NODE_ENV === 'development' ? resetUrl : undefined
        });
      } catch (error) {
        console.error('Password reset request error:', error);
        res.status(500).json({ error: 'Failed to process password reset request' });
      }
    }
  );

  // Reset password with token
  router.post('/auth/reset-password',
    [
      body('token').notEmpty(),
      body('password').isLength({ min: 6 })
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { token, password } = req.body;

        // Find valid reset token
        const resetToken = await db.getPasswordResetToken(token);
        if (!resetToken) {
          return res.status(400).json({ 
            error: 'Invalid or expired reset token. Please request a new password reset.' 
          });
        }

        // Trim password to avoid mismatch when user logs in (e.g. trailing space)
        const trimmedPassword = typeof password === 'string' ? password.trim() : password;
        if (!trimmedPassword || trimmedPassword.length < 6) {
          return res.status(400).json({ error: 'Password must be at least 6 characters' });
        }

        // Update user password
        const bcrypt = require('bcryptjs');
        const passwordHash = await bcrypt.hash(trimmedPassword, 10);
        await db.updateUserPassword(resetToken.user_id, passwordHash);

        // Mark token as used
        await db.markPasswordResetTokenUsed(token);

        res.json({ 
          message: 'Password reset successful. You can now login with your new password.' 
        });
      } catch (error) {
        console.error('Password reset error:', error);
        res.status(500).json({ error: 'Failed to reset password' });
      }
    }
  );

  // Google OAuth - Initiate login (legacy path; primary handler lives in server.js)
  router.get('/auth/google', (req, res) => {
    const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
    const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
    // Keep redirect URI consistent with server.js and Google console
    const redirectUri = 'https://app.stoic-fit.com/auth/google/callback';

    if (!clientId || !clientSecret) {
      return res.status(500).json({ error: 'Google OAuth not configured' });
    }

    const oauth2Client = new google.auth.OAuth2(
      clientId,
      clientSecret,
      redirectUri
    );

    const scopes = [
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile'
    ];

    const authUrl = oauth2Client.generateAuthUrl({
      access_type: 'offline',
      scope: scopes,
      prompt: 'consent'
    });

    res.redirect(authUrl);
  });

  // Google OAuth - Callback handler
  router.get('/auth/google/callback', async (req, res) => {
    try {
      const { code } = req.query;
      
      if (!code) {
        return res.redirect('/?error=oauth_failed');
      }

      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
      const redirectUri = 'https://app.stoic-fit.com/auth/google/callback';

      if (!clientId || !clientSecret) {
        return res.redirect('/?error=oauth_not_configured');
      }

      const oauth2Client = new google.auth.OAuth2(
        clientId,
        clientSecret,
        redirectUri
      );

      // Exchange code for tokens
      const { tokens } = await oauth2Client.getToken(code);
      oauth2Client.setCredentials(tokens);

      // Get user info from Google
      const oauth2 = google.oauth2({ version: 'v2', auth: oauth2Client });
      const { data } = await oauth2.userinfo.get();

      const { email, name, picture } = data;

      if (!email) {
        return res.redirect('/?error=no_email');
      }

      // Check if user exists
      let user = await db.getUserByEmail(email);

      if (!user) {
        // Create new user with placeholder password (OAuth users can't use password login)
        // Use a random hash that will never match
        const placeholderPassword = 'OAUTH_USER_' + Date.now() + Math.random().toString(36);
        user = await db.createUser(email, placeholderPassword, name);
      } else {
        // Update name if it's different or null
        if (name && user.name !== name) {
          await db.updateUserName(user.id, name);
          // Refresh user object to get updated name
          user = await db.getUserById(user.id);
        }
      }

      // Generate JWT token
      const token = generateToken(user.id);

      // Redirect to frontend with token.
      // Prefer the current request host (e.g. app.stoic-fit.com) so users land back on the app,
      // but allow FRONTEND_URL to override when it matches the same host.
      const host = req.get('host');
      const defaultFrontend = `${req.protocol}://${host}`;
      let frontendUrl = process.env.FRONTEND_URL || defaultFrontend;
      // If we're on an app subdomain and FRONTEND_URL points elsewhere (e.g. marketing site),
      // force redirect back to the current app host instead of the marketing homepage.
      if (host && host.startsWith('app.') && process.env.FRONTEND_URL && !process.env.FRONTEND_URL.includes(host)) {
        frontendUrl = defaultFrontend;
      }
      res.redirect(`${frontendUrl}/?token=${token}&email=${encodeURIComponent(email)}`);
    } catch (error) {
      console.error('Google OAuth callback error:', error);
      res.redirect('/?error=oauth_error');
    }
  });

  // Get current user
  router.get('/auth/me', authenticateToken, async (req, res) => {
    try {
      console.log('GET /auth/me - userId:', req.userId);
      const user = await db.getUserById(req.userId);
      console.log('GET /auth/me - user from database:', user);
      console.log('GET /auth/me - user.name:', user ? user.name : 'N/A');
      
      if (!user) {
        console.error('GET /auth/me - User not found for userId:', req.userId);
        return res.status(404).json({ error: 'User not found' });
      }

      const isStaff = user && (user.role === 'admin' || user.role === 'tester');
      if (!isStaff) {
        await db.ensureGymMemberTierOneIfNoValidAppSubscription(req.userId);
      }
      let subscription = isStaff
        ? await db.getOrExtendStaffSubscription(req.userId, user)
        : await db.getUserActiveSubscription(req.userId);
      if (!subscription && !isStaff) {
        subscription = await db.getUserLatestSubscription(req.userId);
      }
      console.log('GET /auth/me - subscription row:', subscription ? subscription.id : null);

      const responseData = {
        user: {
          id: user.id,
          email: user.email,
          name: (user.name !== undefined && user.name !== null) ? user.name : null,
          role: user.role || 'user',
          created_at: user.created_at
        },
        subscription: subscription
          ? await buildSubscriptionClientPayload(stripe, db, subscription, user)
          : null
      };
      
      console.log('GET /auth/me - response data:', JSON.stringify(responseData, null, 2));
      res.json(responseData);
    } catch (error) {
      console.error('Get user error:', error);
      console.error('Get user error stack:', error.stack);
      res.status(500).json({ error: 'Failed to get user' });
    }
  });

  // ========== Admin Routes ==========

  // Get all users (admin only)
  router.get('/admin/users', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      // Get all users with their subscriptions and gym memberships
      // Show all users, not just those with subscriptions
      let query;
      if (db.isPostgres) {
        query = `
          SELECT 
            u.id,
            u.email,
            u.name,
            u.role,
            u.created_at,
            u.last_login,
            u.last_login_ip,
            u.last_login_location,
            s.id as subscription_id,
            s.tier as subscription_tier,
            s.status as subscription_status,
            s.start_date as subscription_start,
            s.end_date as subscription_end,
            s.stripe_subscription_id as subscription_stripe_id,
            s.stripe_customer_id as subscription_stripe_customer_id,
            gm.id as gym_membership_id,
            gm.membership_type as gym_membership_type,
            gm.status as gym_membership_status,
            gm.stripe_subscription_id as gym_membership_stripe_id,
            gm.stripe_customer_id as gym_membership_stripe_customer_id,
            gm.contract_start_date as gym_membership_start,
            gm.contract_end_date as gym_membership_end
          FROM users u
          LEFT JOIN LATERAL (
            SELECT *
            FROM subscriptions s
            WHERE s.user_id = u.id
            ORDER BY
              CASE WHEN (
                s.status IN ('active', 'grace_period', 'free_trial')
                AND (s.end_date IS NULL OR s.end_date > CURRENT_TIMESTAMP)
                AND (
                  s.status != 'grace_period'
                  OR s.grace_period_ends_at IS NULL
                  OR s.grace_period_ends_at > CURRENT_TIMESTAMP
                )
              ) THEN 0 ELSE 1 END,
              CASE WHEN s.stripe_subscription_id IS NOT NULL AND TRIM(s.stripe_subscription_id::text) != ''
                THEN 1 ELSE 0 END DESC,
              s.created_at DESC
            LIMIT 1
          ) s ON true
          LEFT JOIN gym_memberships gm ON u.id = gm.user_id
          WHERE u.email NOT ILIKE 'prod-test%@example.com'
          ORDER BY COALESCE(u.last_login, u.created_at) DESC NULLS LAST
        `;
      } else {
        // SQLite version
        query = `
          SELECT 
            u.id,
            u.email,
            u.name,
            u.role,
            u.created_at,
            u.last_login,
            u.last_login_ip,
            u.last_login_location,
            s.id as subscription_id,
            s.tier as subscription_tier,
            s.status as subscription_status,
            s.start_date as subscription_start,
            s.end_date as subscription_end,
            s.stripe_subscription_id as subscription_stripe_id,
            s.stripe_customer_id as subscription_stripe_customer_id,
            gm.id as gym_membership_id,
            gm.membership_type as gym_membership_type,
            gm.status as gym_membership_status,
            gm.stripe_subscription_id as gym_membership_stripe_id,
            gm.stripe_customer_id as gym_membership_stripe_customer_id,
            gm.contract_start_date as gym_membership_start,
            gm.contract_end_date as gym_membership_end
          FROM users u
          LEFT JOIN subscriptions s ON s.id = (
            SELECT s2.id FROM subscriptions s2
            WHERE s2.user_id = u.id
            ORDER BY
              CASE WHEN (
                s2.status IN ('active', 'grace_period', 'free_trial')
                AND (s2.end_date IS NULL OR datetime(s2.end_date) > datetime('now'))
                AND (
                  s2.status != 'grace_period'
                  OR s2.grace_period_ends_at IS NULL
                  OR datetime(s2.grace_period_ends_at) > datetime('now')
                )
              ) THEN 0 ELSE 1 END,
              CASE WHEN s2.stripe_subscription_id IS NOT NULL AND TRIM(s2.stripe_subscription_id) != ''
                THEN 1 ELSE 0 END DESC,
              s2.created_at DESC
            LIMIT 1
          )
          LEFT JOIN gym_memberships gm ON u.id = gm.user_id
          WHERE LOWER(u.email) NOT LIKE 'prod-test%@example.com'
          ORDER BY COALESCE(u.last_login, u.created_at) DESC
        `;
      }
      
      const result = await db.query(query, []);
      const users = result.rows || [];
      
      res.json({ users });
    } catch (error) {
      console.error('Get all users error:', error);
      res.status(500).json({ error: 'Failed to get users' });
    }
  });

  // List discount groups with leaders and members (admin only)
  router.get('/admin/discount-groups', authenticateToken, async (req, res) => {
    try {
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const groupsQuery = db.isPostgres
        ? `SELECT dg.id, dg.group_id, dg.group_name, dg.group_leader_id,
                  lu.id AS leader_user_id, lu.email AS leader_email, lu.name AS leader_name
           FROM discount_groups dg
           JOIN users lu ON lu.id = dg.group_leader_id
           ORDER BY LOWER(COALESCE(dg.group_name, '')), dg.group_id`
        : `SELECT dg.id, dg.group_id, dg.group_name, dg.group_leader_id,
                  lu.id AS leader_user_id, lu.email AS leader_email, lu.name AS leader_name
           FROM discount_groups dg
           JOIN users lu ON lu.id = dg.group_leader_id
           ORDER BY LOWER(COALESCE(dg.group_name, '')), dg.group_id`;

      const groupsResult = await db.query(groupsQuery, []);
      const groupRows = groupsResult.rows || [];
      const groupRowById = new Map(groupRows.map((gr) => [gr.id, gr]));
      const ids = groupRows.map((g) => g.id);
      if (ids.length === 0) {
        return res.json({ groups: [] });
      }

      let gymMembersRows = [];
      if (db.isPostgres) {
        const r = await db.query(
          `SELECT gm.discount_group_id, u.id AS user_id, u.email, u.name, gm.status, gm.membership_type,
                  gm.household_id, gm.family_group_id
           FROM gym_memberships gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.discount_group_id = ANY($1::int[])`,
          [ids]
        );
        gymMembersRows = r.rows || [];
      } else {
        const placeholders = ids.map(() => '?').join(',');
        const r = await db.query(
          `SELECT gm.discount_group_id, u.id AS user_id, u.email, u.name, gm.status, gm.membership_type,
                  gm.household_id, gm.family_group_id
           FROM gym_memberships gm
           JOIN users u ON u.id = gm.user_id
           WHERE gm.discount_group_id IN (${placeholders})`,
          ids
        );
        gymMembersRows = r.rows || [];
      }

      let pendingRows = [];
      try {
        if (db.isPostgres) {
          const r = await db.query(
            `SELECT discount_group_id, primary_email, primary_first_name, primary_last_name
             FROM admin_added_members
             WHERE status = 'pending_confirmation' AND discount_group_id = ANY($1::int[])`,
            [ids]
          );
          pendingRows = r.rows || [];
        } else {
          const placeholders = ids.map(() => '?').join(',');
          const r = await db.query(
            `SELECT discount_group_id, primary_email, primary_first_name, primary_last_name
             FROM admin_added_members
             WHERE status = 'pending_confirmation' AND discount_group_id IN (${placeholders})`,
            ids
          );
          pendingRows = r.rows || [];
        }
      } catch (pendErr) {
        console.warn('admin discount-groups pending members:', pendErr.message);
      }

      const gymByGid = new Map();
      const directByGid = new Map();
      for (const row of gymMembersRows) {
        const gid = row.discount_group_id;
        if (!directByGid.has(gid)) directByGid.set(gid, []);
        directByGid.get(gid).push(row);
      }
      for (const gid of ids) {
        const directList = directByGid.get(gid) || [];
        const gr = groupRowById.get(gid);
        let seedForExpand = directList;
        try {
          seedForExpand = await buildSeedRowsForDiscountGroupHouseholdExpand(db, directList, gr && gr.group_leader_id);
        } catch (seedErr) {
          console.warn('admin discount-groups leader seed:', seedErr.message);
        }
        let extraRows = [];
        try {
          extraRows = await fetchExtraHouseholdFamilyMembersForDiscountGroup(db, seedForExpand);
        } catch (exErr) {
          console.warn('admin discount-groups household/family expand:', exErr.message);
        }
        const mergedByUser = new Map();
        for (const row of directList) {
          const uid = Number(row.user_id);
          if (!Number.isFinite(uid) || uid <= 0) continue;
          mergedByUser.set(uid, {
            user_id: uid,
            email: row.email || '',
            name: row.name || row.email || 'Member',
            status: row.status || '',
            membership_type: row.membership_type || '',
            source: 'gym_membership'
          });
        }
        for (const row of extraRows) {
          const uid = Number(row.u_id ?? row.user_id);
          if (!Number.isFinite(uid) || uid <= 0) continue;
          if (mergedByUser.has(uid)) continue;
          mergedByUser.set(uid, {
            user_id: uid,
            email: row.email || '',
            name: row.name || row.email || 'Member',
            status: row.status || '',
            membership_type: row.membership_type || '',
            source: 'household_family'
          });
        }
        if (gr && gr.group_leader_id != null && !mergedByUser.has(Number(gr.group_leader_id))) {
          let st = '';
          let mt = '';
          try {
            const lgm = await db.queryOne(
              db.isPostgres
                ? 'SELECT status, membership_type FROM gym_memberships WHERE user_id = $1 ORDER BY id DESC LIMIT 1'
                : 'SELECT status, membership_type FROM gym_memberships WHERE user_id = ? ORDER BY id DESC LIMIT 1',
              [gr.group_leader_id]
            );
            if (lgm) {
              st = lgm.status || '';
              mt = lgm.membership_type || '';
            }
          } catch (e) {
            /* ignore */
          }
          mergedByUser.set(Number(gr.group_leader_id), {
            user_id: Number(gr.group_leader_id),
            email: gr.leader_email || '',
            name: gr.leader_name || gr.leader_email || 'Owner',
            status: st,
            membership_type: mt,
            source: 'group_owner'
          });
        }
        gymByGid.set(gid, [...mergedByUser.values()]);
      }

      const pendingByGid = new Map();
      for (const row of pendingRows) {
        const gid = row.discount_group_id;
        if (gid == null) continue;
        if (!pendingByGid.has(gid)) pendingByGid.set(gid, []);
        const name =
          [row.primary_first_name, row.primary_last_name].filter(Boolean).join(' ').trim() ||
          row.primary_email ||
          'Member';
        pendingByGid.get(gid).push({
          email: row.primary_email,
          name,
          source: 'pending_signup'
        });
      }

      const groups = groupRows.map((g) => {
        const gymList = gymByGid.get(g.id) || [];
        const pendingList = pendingByGid.get(g.id) || [];
        const seenEmails = new Set(
          gymList.map((m) => String(m.email || '').trim().toLowerCase()).filter(Boolean)
        );
        const members = [...gymList];
        for (const p of pendingList) {
          const em = String(p.email || '').trim().toLowerCase();
          if (!em || seenEmails.has(em)) continue;
          seenEmails.add(em);
          members.push({
            user_id: null,
            email: p.email,
            name: p.name,
            status: 'pending_signup',
            membership_type: '',
            source: p.source
          });
        }
        members.sort((a, b) =>
          String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), undefined, { sensitivity: 'base' })
        );
        return {
          id: g.id,
          group_id: g.group_id,
          group_name: g.group_name || null,
          leader: {
            id: g.leader_user_id,
            email: g.leader_email || '',
            name: g.leader_name || g.leader_email || 'Owner'
          },
          member_count: members.length,
          members
        };
      });

      res.json({ groups });
    } catch (error) {
      console.error('Get admin discount-groups error:', error);
      res.status(500).json({ error: 'Failed to get discount groups' });
    }
  });

  // Delete a discount group (admin only). Unlinks gym memberships and pending admin-added rows; does not delete users.
  router.delete('/admin/discount-groups/:id', authenticateToken, async (req, res) => {
    try {
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const id = parseInt(req.params.id, 10);
      if (!Number.isFinite(id) || id < 1) {
        return res.status(400).json({ error: 'Invalid group id' });
      }
      const existing = await db.queryOne(
        db.isPostgres
          ? 'SELECT id FROM discount_groups WHERE id = $1'
          : 'SELECT id FROM discount_groups WHERE id = ?',
        [id]
      );
      if (!existing) {
        return res.status(404).json({ error: 'Group not found' });
      }
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET discount_group_id = NULL WHERE discount_group_id = $1'
          : 'UPDATE gym_memberships SET discount_group_id = NULL WHERE discount_group_id = ?',
        [id]
      );
      await db.query(
        db.isPostgres
          ? 'UPDATE admin_added_members SET discount_group_id = NULL WHERE discount_group_id = $1'
          : 'UPDATE admin_added_members SET discount_group_id = NULL WHERE discount_group_id = ?',
        [id]
      );
      await db.query(
        db.isPostgres
          ? 'DELETE FROM discount_groups WHERE id = $1'
          : 'DELETE FROM discount_groups WHERE id = ?',
        [id]
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Delete discount group error:', error);
      res.status(500).json({ error: 'Failed to delete discount group' });
    }
  });

  // Get drop-in payments (admin only). Query: ?filter=drop_in|buddy_pass for filter
  router.get('/admin/drop-ins', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const filter = req.query.filter === 'drop_in' || req.query.filter === 'buddy_pass' ? req.query.filter : null;
      const payments = await db.getDropInPayments(filter);
      res.json({ payments });
    } catch (error) {
      console.error('Get drop-ins error:', error);
      res.status(500).json({ error: 'Failed to get drop-in payments' });
    }
  });

  // Get free trials list (admin only)
  router.get('/admin/free-trials', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const trials = await db.listFreeTrialsForAdmin();
      res.json({ trials });
    } catch (error) {
      console.error('Get free trials error:', error);
      res.status(500).json({ error: 'Failed to get free trials' });
    }
  });

  // Get gym membership payments (admin only)
  router.get('/admin/gym-payments', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const payments = await db.getGymMembershipPaymentsAdmin();
      res.json({ payments });
    } catch (error) {
      console.error('Get gym payments error:', error);
      res.status(500).json({ error: 'Failed to get gym membership payments' });
    }
  });

  // Get gym memberships list for admin (name, email, phone, type, last charge, next charge)
  router.get('/admin/gym-memberships', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const memberships = await db.getGymMembershipsAdmin();
      res.json({ memberships });
    } catch (error) {
      console.error('Get gym memberships admin error:', error);
      res.status(500).json({ error: 'Failed to load gym memberships' });
    }
  });

  // Gym members list for admin: gym_memberships + gym-only payment dates (never app subscription).
  router.get('/admin/members', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const members = await db.getMembersAdmin();
      // next_charge_date = gym contract_end_date only (do not pull Stripe Subscription period —
      // could theoretically be wrong ID; app subs live on users/subscriptions, not this list).
      // Mark overdue using contract_end_date (DB "paid through" date). We only advance this when
      // a payment succeeds, so if it's in the past the last payment did not go through. Do not
      // use Stripe current_period_end here—Stripe can show a future period even when payment failed.
      const todayStr = new Date().toISOString().split('T')[0];
      const membersWithOverdue = members.map((m) => {
        const dueRaw = m.contract_end_date;
        const dueStr = dueRaw && typeof dueRaw === 'string' ? dueRaw.trim().split('T')[0].split(' ')[0] : null;
        const isOverdue = !!(
          dueStr &&
          /^\d{4}-\d{2}-\d{2}$/.test(dueStr) &&
          dueStr < todayStr &&
          m.status !== 'cancelled' &&
          m.status !== 'paused'
        );
        return { ...m, is_overdue: isOverdue };
      });
      // Admin-added members not yet confirmed (pending only); confirmed appear in gym list above
      const adminAdded = await db.getAdminAddedMembersForAdminList({ pending_only: true, limit: 500 });
      res.json({ members: membersWithOverdue, admin_added_members: adminAdded });
    } catch (error) {
      console.error('Get members admin error:', error);
      res.status(500).json({ error: 'Failed to load members' });
    }
  });

  // App subscriptions list for admin (tier_one–four): one row per user, last/next charge, no gym data.
  router.get('/admin/app-subscriptions', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const rows = await db.getAppSubscriptionsAdmin();
      const todayStr = todayYmdDenver();
      const subscriptions = rows.map((m) => {
        const dueStr = subscriptionEndToYmdDenver(m.end_date);
        const isOverdue = !!(
          dueStr &&
          dueStr < todayStr &&
          m.status !== 'canceled' &&
          m.status !== 'paused' &&
          m.status !== 'expired'
        );
        return { ...m, is_overdue: isOverdue, next_charge_date: m.end_date };
      });
      res.json({ subscriptions });
    } catch (error) {
      console.error('Get app subscriptions admin error:', error);
      res.status(500).json({ error: 'Failed to load app subscriptions' });
    }
  });

  // Upcoming paid transactions for admin: gym + app subscriptions (excludes free trials / tier_one).
  router.get('/admin/upcoming-transactions', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const daysAheadRaw = parseInt(req.query.daysAhead, 10);
      const daysAhead = Number.isFinite(daysAheadRaw) && daysAheadRaw >= 0 && daysAheadRaw <= 120 ? daysAheadRaw : 60;
      const todayStr = todayYmdDenver();

      const gymRows = await db.getUpcomingGymTransactionsAdmin(daysAhead);
      const appRows = await db.getUpcomingAppSubscriptionTransactionsAdmin(daysAhead);

      const tierAppLabel = (tier) => {
        const t = String(tier || '');
        const map = { tier_two: 'Tier Two', tier_three: 'Tier Three', tier_four: 'Tier Four', daily: 'Daily', weekly: 'Weekly', monthly: 'Monthly' };
        return map[t] || t.replace(/^tier_/, '').replace(/_/g, ' ') || 'App';
      };

      const gymItems = gymRows.map((m) => {
        const dueStr = subscriptionEndToYmdDenver(m.due_date_source || m.contract_end_date);
        let daysUntilDue = dueStr
          ? Math.floor((new Date(`${dueStr}T12:00:00`) - new Date(`${todayStr}T12:00:00`)) / 86400000)
          : null;
        const paidStr = subscriptionEndToYmdDenver(m.last_success_gym_payment_at);
        // Prevent false "overdue" when payment was recorded but contract_end_date rollover has not yet advanced.
        // If a successful gym payment exists on/after the due date, treat this cycle as not overdue.
        if (daysUntilDue != null && daysUntilDue < 0 && dueStr && paidStr && paidStr >= dueStr) {
          daysUntilDue = 0;
        }
        return {
          kind: 'gym',
          user_id: m.user_id,
          name: m.name,
          email: m.email,
          due_date: dueStr,
          days_until_due: daysUntilDue,
          is_overdue: daysUntilDue != null ? daysUntilDue < 0 : false,
          amount_due_cents: m.amount_due_cents ?? m.monthly_amount_cents,
          has_payment_method: !!m.payment_method_id,
          has_stripe_customer: !!m.stripe_customer_id,
          label: `Gym · ${String(m.membership_type || '').replace(/_/g, ' ') || 'membership'}`
        };
      });

      const appItems = appRows.map((s) => {
        const dueStr = subscriptionEndToYmdDenver(s.end_date);
        const daysUntilDue = dueStr
          ? Math.floor((new Date(`${dueStr}T12:00:00`) - new Date(`${todayStr}T12:00:00`)) / 86400000)
          : null;
        return {
          kind: 'app',
          subscription_id: s.id,
          user_id: s.user_id,
          name: s.name,
          email: s.email,
          due_date: dueStr,
          days_until_due: daysUntilDue,
          is_overdue: daysUntilDue != null ? daysUntilDue < 0 : false,
          amount_due_cents: s.amount_due_cents,
          has_payment_method: !!s.payment_method_id,
          has_stripe_customer: !!s.stripe_customer_id,
          tier: s.tier,
          label: `App · ${tierAppLabel(s.tier)}`
        };
      });

      const items = [...gymItems, ...appItems].sort((a, b) => {
        const da = a.due_date || '';
        const db_ = b.due_date || '';
        if (da !== db_) return da.localeCompare(db_);
        const ea = String(a.email || '');
        const eb = String(b.email || '');
        if (ea !== eb) return ea.localeCompare(eb);
        return String(a.kind).localeCompare(String(b.kind));
      });

      const grouped = [];
      const byDate = new Map();
      for (const it of items) {
        const d = it.due_date || '—';
        if (!byDate.has(d)) byDate.set(d, new Map());
        const um = byDate.get(d);
        const uid = it.user_id;
        if (!um.has(uid)) um.set(uid, { user_id: uid, name: it.name, email: it.email, items: [] });
        um.get(uid).items.push(it);
      }
      const dates = [...byDate.keys()].filter((x) => x !== '—').sort();
      if (byDate.has('—')) dates.push('—');
      for (const d of dates) {
        const um = byDate.get(d);
        grouped.push({
          due_date: d,
          users: [...um.values()].sort((a, b) => String(a.email || '').localeCompare(String(b.email || '')))
        });
      }

      res.json({ days_ahead: daysAhead, items, grouped });
    } catch (error) {
      console.error('Get upcoming transactions error:', error);
      res.status(500).json({ error: 'Failed to load upcoming transactions' });
    }
  });

  router.get('/admin/past-transactions', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const limitRaw = parseInt(req.query.limit, 10);
      const limit = Number.isFinite(limitRaw) && limitRaw > 0 && limitRaw <= 5000 ? limitRaw : 2000;
      const rows = await db.getPastTransactionsAdmin(limit);
      res.json({ limit, payments: rows });
    } catch (error) {
      console.error('Get past transactions error:', error);
      res.status(500).json({ error: 'Failed to load past transactions' });
    }
  });

  // Delete an admin-added member (only if still pending_confirmation)
  router.delete('/admin/added-members/:id', authenticateToken, async (req, res) => {
    try {
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const id = parseInt(req.params.id, 10);
      if (!id || Number.isNaN(id)) {
        return res.status(400).json({ error: 'Invalid member id' });
      }
      const deletedCount = await db.deleteAdminAddedMemberIfPending(id);
      if (!deletedCount) {
        return res.status(400).json({ error: 'Member not found or not pending_confirmation' });
      }
      return res.json({ success: true, deleted: deletedCount });
    } catch (error) {
      console.error('Delete admin-added member error:', error);
      res.status(500).json({ error: 'Failed to delete member' });
    }
  });

  // Get app subscription payments (admin only)
  router.get('/admin/subscription-payments', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const payments = await db.getAppSubscriptionPaymentsAdmin();
      res.json({ payments });
    } catch (error) {
      console.error('Get subscription payments error:', error);
      res.status(500).json({ error: 'Failed to get app subscription payments' });
    }
  });

  // Get banner settings (public - used by home page and app)
  router.get('/banner', async (req, res) => {
    try {
      const settings = await db.getBannerSettings();
      const defaults = {
        message: 'Your gym membership will be managed here soon.',
        bg_key: 'yellow',
        text_color: 'black'
      };
      res.json(settings || defaults);
    } catch (error) {
      console.error('Get banner settings error:', error);
      res.json({
        message: 'Your gym membership will be managed here soon.',
        bg_key: 'yellow',
        text_color: 'black'
      });
    }
  });

  // Admin: test Stripe connection (uses STRIPE_SECRET_KEY from env)
  router.get('/admin/test-stripe', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const key = process.env.STRIPE_SECRET_KEY;
      if (!key || !key.trim()) {
        return res.status(500).json({ ok: false, error: 'STRIPE_SECRET_KEY is not set' });
      }
      const stripeLib = require('stripe')(key);
      const balance = await stripeLib.balance.retrieve();
      res.json({
        ok: true,
        message: 'Stripe connection OK',
        balance: {
          available: (balance.available || []).map(b => ({ amount: b.amount / 100, currency: b.currency })),
          pending: (balance.pending || []).map(b => ({ amount: b.amount / 100, currency: b.currency }))
        }
      });
    } catch (err) {
      console.error('Admin test-stripe error:', err);
      res.status(500).json({
        ok: false,
        error: err.message || 'Stripe request failed',
        type: err.type || null
      });
    }
  });

  // Admin: health checks (database, Stripe, API, env summary)
  router.get('/admin/health', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const checks = { api: { ok: true, message: 'API responding' } };
      const stripeKey = process.env.STRIPE_SECRET_KEY;

      // Database
      try {
        if (db.isPostgres) {
          await db.query('SELECT 1 as ok');
        } else {
          await db.query('SELECT 1 as ok');
        }
        checks.database = { ok: true, message: 'Database connected', type: db.isPostgres ? 'PostgreSQL' : 'SQLite' };
      } catch (dbErr) {
        checks.database = { ok: false, message: dbErr.message || 'Database check failed' };
      }

      // Stripe
      if (!stripeKey || !stripeKey.trim()) {
        checks.stripe = { ok: false, message: 'STRIPE_SECRET_KEY is not set' };
      } else {
        try {
          const stripeLib = require('stripe')(stripeKey);
          const balance = await stripeLib.balance.retrieve();
          checks.stripe = {
            ok: true,
            message: 'Stripe connection OK',
            balance: {
              available: (balance.available || []).map(b => ({ amount: b.amount / 100, currency: b.currency })),
              pending: (balance.pending || []).map(b => ({ amount: b.amount / 100, currency: b.currency }))
            }
          };
        } catch (stripeErr) {
          checks.stripe = { ok: false, message: stripeErr.message || 'Stripe request failed', type: stripeErr.type || null };
        }
      }

      // Env summary (safe for admin only)
      checks.env = {
        nodeEnv: process.env.NODE_ENV || 'undefined',
        databaseType: db.isPostgres ? 'PostgreSQL' : 'SQLite',
        stripeConfigured: !!(stripeKey && stripeKey.trim()),
        uptimeSeconds: Math.floor(process.uptime())
      };

      res.json({ ok: true, checks });
    } catch (err) {
      console.error('Admin health error:', err);
      res.status(500).json({ ok: false, error: err.message || 'Health check failed' });
    }
  });

  // Admin: read-only app vs gym subscription consistency audit (Postgres only in prod)
  router.get('/admin/audit/app-gym', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { runAppGymAuditDb } = require('./lib/app-gym-audit');
      const result = await runAppGymAuditDb(db);
      res.json(result);
    } catch (err) {
      console.error('Admin app-gym audit error:', err);
      res.status(500).json({ ok: false, error: err.message || 'Audit failed' });
    }
  });

  // Admin: align app access expires for gym free trial (tier_one, term start + subscriptionDays)
  router.post('/admin/audit/app-gym/reconcile', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { reconcileGymMemberAppAccess } = require('./lib/app-gym-audit');
      const result = await reconcileGymMemberAppAccess(db, stripe);
      if (result.ok === false) {
        return res.status(500).json(result);
      }
      res.json(result);
    } catch (err) {
      console.error('Admin app-gym reconcile error:', err);
      res.status(500).json({ ok: false, error: err.message || 'Reconcile failed' });
    }
  });

  // Payment/subscription error logs (admin only)
  router.get('/admin/error-logs', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const limit = Number(req.query.limit || 200);
      const logs = await db.getAppPaymentErrorLogs(limit);
      res.json({ logs });
    } catch (error) {
      console.error('Get admin error logs failed:', error);
      res.status(500).json({ error: 'Failed to load error logs' });
    }
  });

  // Admin: get current banner settings
  router.get('/admin/banner', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      const isAdmin =
        !!user &&
        (user.role === 'admin' ||
          (user.email &&
            ['jameypowell@gmail.com', 'jpowell@stoic-fit.com'].includes(
              user.email.toLowerCase()
            )));
      if (!isAdmin) {
        console.warn('Forbidden /admin/banner GET for user', {
          id: user && user.id,
          email: user && user.email,
          role: user && user.role
        });
        return res.status(403).json({
          error: 'Admin access required',
          email: user ? user.email : null,
          role: user ? user.role : null
        });
      }
      const settings = await db.getBannerSettings();
      const defaults = {
        message: 'Your gym membership will be managed here soon.',
        bg_key: 'yellow',
        text_color: 'black'
      };
      res.json(settings || defaults);
    } catch (error) {
      console.error('Admin get banner settings error:', error);
      res.status(500).json({ error: 'Failed to get banner settings' });
    }
  });

  // Admin: update banner settings
  router.post('/admin/banner', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      const isAdmin =
        !!user &&
        (user.role === 'admin' ||
          (user.email &&
            ['jameypowell@gmail.com', 'jpowell@stoic-fit.com'].includes(
              user.email.toLowerCase()
            )));
      if (!isAdmin) {
        console.warn('Forbidden /admin/banner POST for user', {
          id: user && user.id,
          email: user && user.email,
          role: user && user.role
        });
        return res.status(403).json({
          error: 'Admin access required',
          email: user ? user.email : null,
          role: user ? user.role : null
        });
      }
      const { message, bg_key, text_color } = req.body || {};
      const msg = (message || '').toString().trim();
      const bgKey = (bg_key || '').toString().toLowerCase();
      const textColor = (text_color || '').toString().toLowerCase();

      const allowedBg = ['yellow', 'red', 'blue', 'white'];
      const allowedText = ['black', 'white'];

      if (!msg) {
        return res.status(400).json({ error: 'Message is required' });
      }
      if (!allowedBg.includes(bgKey)) {
        return res.status(400).json({ error: 'Invalid background color' });
      }
      if (!allowedText.includes(textColor)) {
        return res.status(400).json({ error: 'Invalid font color' });
      }

      await db.setBannerSettings(msg, bgKey, textColor);
      res.json({ message: msg, bg_key: bgKey, text_color: textColor });
    } catch (error) {
      console.error('Admin update banner settings error:', error);
      res.status(500).json({ error: 'Failed to update banner settings' });
    }
  });

  // Update user role (admin only)
  router.put('/admin/users/:userId/role', authenticateToken, [
    body('role').isIn(['user', 'admin', 'tester'])
  ], async (req, res) => {
    try {
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { userId } = req.params;
      const { role } = req.body;
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      if (db.isPostgres) {
        await db.query('UPDATE users SET role = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2', [role, userId]);
      } else {
        await db.query('UPDATE users SET role = ?, updated_at = datetime(\'now\') WHERE id = ?', [role, userId]);
      }
      res.json({ success: true, message: 'User role updated' });
    } catch (error) {
      console.error('Update user role error:', error);
      res.status(500).json({ error: 'Failed to update user role' });
    }
  });

  // Update user name (admin only)
  router.put('/admin/users/:userId/name', authenticateToken, [
    body('name').notEmpty().trim()
  ], async (req, res) => {
    try {
      // Check if user is admin
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { userId } = req.params;
      const { name } = req.body;

      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      // Check if target user exists
      const targetUser = await db.getUserById(userId);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Update user name
      const updated = await db.updateUserName(userId, name);
      if (updated) {
        res.json({ message: 'User name updated successfully', name });
      } else {
        res.status(500).json({ error: 'Failed to update user name' });
      }
    } catch (error) {
      console.error('Update user name error:', error);
      res.status(500).json({ error: 'Failed to update user name' });
    }
  });

  // Admin: generate 6-digit temporary login code (for members without Google-compatible email login).
  router.post('/admin/users/temp-login-code', authenticateToken, [
    body('email').isEmail().normalizeEmail()
  ], async (req, res) => {
    try {
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }
      const email = req.body.email;
      const user = await db.getUserByEmail(email);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (user.password_hash && String(user.password_hash).startsWith('OAUTH_USER_')) {
        return res.status(400).json({ error: 'This account uses Google sign-in. Ask them to use "Sign in with Google".' });
      }

      const code = String(Math.floor(100000 + Math.random() * 900000));
      const expiresAt = new Date();
      expiresAt.setHours(expiresAt.getHours() + 24);
      await db.createLoginCode(user.id, code, expiresAt.toISOString(), req.userId);
      res.json({
        message: 'Temporary login code generated. User should log in with email + this 6-digit code, then create a new password.',
        code,
        expiresAt: expiresAt.toISOString()
      });
    } catch (error) {
      console.error('Admin temp-login-code error:', error);
      res.status(500).json({ error: error.message || 'Failed to generate login code' });
    }
  });

  // Update subscription (admin only)
  router.put('/admin/users/:userId/subscription', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { userId } = req.params;
      let { tier, status, end_date } = req.body;

      // Validate and clean up the input
      // Only validate if values are provided and not empty/null
      if (tier !== undefined && tier !== null && tier !== '') {
        if (!['daily', 'weekly', 'monthly'].includes(tier)) {
          return res.status(400).json({ error: 'Invalid tier. Must be daily, weekly, or monthly' });
        }
      } else {
        tier = undefined; // Don't update if empty/null
      }

      if (status !== undefined && status !== null && status !== '') {
        if (!['active', 'canceled', 'expired'].includes(status)) {
          return res.status(400).json({ error: 'Invalid status. Must be active, canceled, or expired' });
        }
      } else {
        status = undefined; // Don't update if empty/null
      }

      if (end_date !== undefined && end_date !== null && end_date !== '') {
        // Validate date format
        const date = new Date(end_date);
        if (isNaN(date.getTime())) {
          return res.status(400).json({ error: 'Invalid date format' });
        }
      } else {
        end_date = undefined; // Don't update if empty/null
      }

      // Get user's most recent subscription (not just active)
      const subscription = await db.getUserLatestSubscription(userId);
      
      if (subscription) {
        // Update existing subscription
        const updates = {};
        if (tier !== undefined && tier !== null && tier !== '') {
          updates.tier = tier;
        }
        if (status !== undefined && status !== null && status !== '') {
          updates.status = status;
        }
        if (end_date !== undefined && end_date !== null && end_date !== '') {
          updates.end_date = end_date;
        }

        if (Object.keys(updates).length > 0) {
          await db.updateSubscription(subscription.id, updates);
        }
      } else if (tier && tier !== 'none') {
        // Create new subscription if tier is provided and valid
        const endDate = end_date || calculateEndDate(tier);
        await db.createSubscription(userId, tier, null, null, endDate);
      }

      res.json({ success: true, message: 'Subscription updated' });
    } catch (error) {
      console.error('Update subscription error:', error);
      console.error('Update subscription error stack:', error.stack);
      res.status(500).json({ error: 'Failed to update subscription' });
    }
  });

  // Delete user (admin only)
  router.delete('/admin/users/:userId', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { userId } = req.params;
      const targetUserId = parseInt(userId);

      // Prevent admin from deleting themselves
      if (targetUserId === adminUser.id) {
        return res.status(400).json({ error: 'Cannot delete your own account' });
      }

      // Check if user exists
      const targetUser = await db.getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Delete user's subscriptions first (cascade delete)
      if (db.isPostgres) {
        await db.query('DELETE FROM subscriptions WHERE user_id = $1', [targetUserId]);
        await db.query('DELETE FROM payments WHERE user_id = $1', [targetUserId]);
        await db.query('DELETE FROM password_reset_tokens WHERE user_id = $1', [targetUserId]);
        await db.query('DELETE FROM users WHERE id = $1', [targetUserId]);
      } else {
        await db.query('DELETE FROM subscriptions WHERE user_id = ?', [targetUserId]);
        await db.query('DELETE FROM payments WHERE user_id = ?', [targetUserId]);
        await db.query('DELETE FROM password_reset_tokens WHERE user_id = ?', [targetUserId]);
        await db.query('DELETE FROM users WHERE id = ?', [targetUserId]);
      }

      res.json({ success: true, message: 'User deleted successfully' });
    } catch (error) {
      console.error('Delete user error:', error);
      console.error('Delete user error stack:', error.stack);
      res.status(500).json({ error: 'Failed to delete user' });
    }
  });

  // ========== Macro Plan Routes ==========

  // Save macro plan
  router.post('/macro-plan', authenticateToken, async (req, res) => {
    try {
      const { planData } = req.body;
      
      if (!planData) {
        return res.status(400).json({ error: 'Plan data is required' });
      }

      await db.saveMacroPlan(req.userId, planData);
      res.json({ success: true, message: 'Macro plan saved successfully' });
    } catch (error) {
      console.error('Save macro plan error:', error);
      console.error('Save macro plan error stack:', error.stack);
      // If table doesn't exist, provide helpful error
      if (error.message && error.message.includes('no such table')) {
        return res.status(500).json({ error: 'Macro plans table not initialized. Please restart the server.' });
      }
      res.status(500).json({ error: 'Failed to save macro plan' });
    }
  });

  // Get macro plan
  router.get('/macro-plan', authenticateToken, async (req, res) => {
    try {
      const plan = await db.getMacroPlan(req.userId);
      if (!plan) {
        return res.status(404).json({ error: 'No macro plan found' });
      }
      res.json({ plan });
    } catch (error) {
      console.error('Get macro plan error:', error);
      console.error('Get macro plan error stack:', error.stack);
      // If table doesn't exist, return 404 instead of 500
      if (error.message && error.message.includes('no such table')) {
        return res.status(404).json({ error: 'No macro plan found' });
      }
      res.status(500).json({ error: 'Failed to get macro plan' });
    }
  });

  // ========== Payment Routes ==========

  // Create payment intent or subscription
  router.post('/payments/create-intent',
    authenticateToken,
    [
      body('tier').isIn(['daily', 'weekly', 'monthly', 'tier_two', 'tier_three', 'tier_four']),
      body('isUpgrade').optional().isBoolean()
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { tier, isUpgrade } = req.body;
        const userId = req.userId;
        const billingMode = process.env.BILLING_MODE || 'one_time';

        // Get user
        const user = await db.getUserById(userId);
        if (!user) {
          return res.status(404).json({ error: 'User not found' });
        }

        // Get or create Stripe customer
        let stripeCustomerId = null;
        let currentSubscription = null;
        try {
          currentSubscription = await db.getUserActiveSubscription(userId);
          if (currentSubscription && currentSubscription.stripe_customer_id) {
            stripeCustomerId = currentSubscription.stripe_customer_id;
          } else {
            const customer = await createCustomer(user.email);
            stripeCustomerId = customer.id;
          }
        } catch (error) {
          console.error('Stripe customer creation error:', error);
          return res.status(500).json({ error: 'Failed to create payment' });
        }

        // If using Stripe subscriptions, create subscription instead of payment intent
        if (billingMode === 'stripe_subscriptions') {
          const priceId = getPriceIdForTier(tier);
            if (!priceId) {
              return res.status(500).json({ error: `Price ID not configured for ${tier} tier` });
          }

          // Create Stripe subscription with incomplete payment
          // This allows us to collect payment method via Payment Element
          const subscription = await createSubscription(
            stripeCustomerId,
            priceId,
            { 
              userId: userId.toString(), 
              tier,
              isUpgrade: isUpgrade ? 'true' : 'false',
              currentTier: currentSubscription?.tier || ''
            },
            'default_incomplete' // Create incomplete subscription that requires payment
          );

          // Get client secret from payment intent for Payment Element
          const clientSecret = subscription.latest_invoice?.payment_intent?.client_secret;
          
          if (!clientSecret && subscription.status === 'incomplete') {
            await db.createAppPaymentErrorLog({
              userId,
              userEmail: user.email,
              stripeCustomerId,
              stripeSubscriptionId: subscription.id,
              tier,
              eventType: 'app_subscription_missing_client_secret',
              severity: 'error',
              message: 'Subscription created in incomplete state but no client secret was returned.',
              details: { stripeStatus: subscription.status }
            });
            // If no payment intent, subscription needs payment method
            // This should not happen with default_incomplete, but handle it gracefully
            return res.status(500).json({ 
              error: 'Subscription created but payment intent not available. Please try again.' 
            });
          }

          // IMPORTANT: Do not create/cancel DB subscription rows yet.
          // We only activate/switch tiers after Stripe confirms success via webhook.

          if (subscription.status === 'incomplete' || subscription.status === 'incomplete_expired') {
            await db.createAppPaymentErrorLog({
              userId,
              userEmail: user.email,
              stripeCustomerId,
              stripeSubscriptionId: subscription.id,
              stripePaymentIntentId: subscription.latest_invoice?.payment_intent?.id || null,
              tier,
              eventType: 'app_subscription_incomplete_created',
              severity: 'warning',
              message: 'Subscription requires payment confirmation before activation.',
              details: { stripeStatus: subscription.status }
            });
          }

          // Return subscription info with client secret for Payment Element
          res.json({
            subscriptionId: subscription.id,
            clientSecret: clientSecret,
            status: subscription.status,
            tier: tier,
            isUpgrade: isUpgrade || false,
            requiresPayment: subscription.status === 'incomplete' || subscription.status === 'incomplete_expired' || !clientSecret
          });
        } else {
          // One-time payment mode (existing behavior)
          // Calculate amount - if upgrade, use pro-rated upgrade price, otherwise full price
          let amount;
          if (isUpgrade && currentSubscription) {
            // Use pro-rated upgrade price calculation
            amount = calculateUpgradePrice(currentSubscription, tier);
          } else {
            amount = TIER_PRICING[tier];
          }
          
          // Create payment intent
          const paymentIntent = await createPaymentIntent(
            amount,
            'usd',
            stripeCustomerId,
            { 
              userId: userId.toString(), 
              tier,
              isUpgrade: isUpgrade ? 'true' : 'false',
              currentTier: currentSubscription?.tier || ''
            }
          );

          // Store payment intent in database
          await db.createPayment(
            userId,
            paymentIntent.id,
            amount,
            'usd',
            tier,
            paymentIntent.status
          );

          res.json({
            clientSecret: paymentIntent.client_secret,
            paymentIntentId: paymentIntent.id,
            amount: amount,
            tier: tier,
            isUpgrade: isUpgrade || false
          });
        }
      } catch (error) {
        console.error('Payment creation error:', error);
        res.status(500).json({ error: 'Failed to create payment' });
      }
    }
  );

  // Confirm payment and activate subscription
  router.post('/payments/confirm',
    authenticateToken,
    [
      body('paymentIntentId').notEmpty(),
      body('tier').isIn(['daily', 'weekly', 'monthly']),
      body('isUpgrade').optional().isBoolean()
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { paymentIntentId, tier, isUpgrade } = req.body;
        const userId = req.userId;

        // Retrieve and verify payment intent from Stripe
        let paymentIntent;
        try {
          paymentIntent = await getPaymentIntent(paymentIntentId);
          
          // Verify payment was successful
          if (paymentIntent.status !== 'succeeded') {
            const user = await db.getUserById(userId);
            await db.createAppPaymentErrorLog({
              userId,
              userEmail: user?.email || null,
              stripePaymentIntentId: paymentIntentId,
              tier,
              eventType: 'app_payment_confirm_not_succeeded',
              severity: 'error',
              message: 'Payment confirmation attempted but payment intent was not succeeded.',
              details: { paymentIntentStatus: paymentIntent.status }
            });
            return res.status(400).json({ 
              error: 'Payment not completed', 
              status: paymentIntent.status 
            });
          }
        } catch (error) {
          console.error('Error retrieving payment intent:', error);
          return res.status(500).json({ error: 'Failed to verify payment' });
        }

        // Get user's Stripe customer ID
        const user = await db.getUserById(userId);
        const existingSubscription = await db.getUserActiveSubscription(userId);
        let stripeCustomerId = existingSubscription?.stripe_customer_id;

        if (!stripeCustomerId) {
          const customer = await createCustomer(user.email);
          stripeCustomerId = customer.id;
        }

        // Save payment method for hybrid system (if payment method is attached)
        let paymentMethodId = null;
        let paymentMethodExpiresAt = null;
        if (paymentIntent.payment_method) {
          paymentMethodId = typeof paymentIntent.payment_method === 'string' 
            ? paymentIntent.payment_method 
            : paymentIntent.payment_method.id;
          
          // Get payment method details to extract expiry date
          try {
            const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
            if (pm.card && pm.card.exp_year && pm.card.exp_month) {
              // Set expiry date to last day of expiry month
              paymentMethodExpiresAt = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59, 59).toISOString();
            }
          } catch (pmError) {
            console.warn('Could not retrieve payment method details:', pmError.message);
            // Continue without expiry date
          }
        }

        // Handle upgrade vs new subscription
        let endDate;
        let subscriptionId = null;
        if (isUpgrade && existingSubscription && subscriptionRowGrantsAccess(existingSubscription)) {
          // For upgrades: extend the subscription to the original end_date (don't start fresh)
          // This way user keeps their remaining time
          if (existingSubscription.end_date) {
            // Keep the original end_date, just upgrade the tier
            let expirationDate;
            if (existingSubscription.end_date instanceof Date) {
              expirationDate = new Date(existingSubscription.end_date);
            } else if (typeof existingSubscription.end_date === 'string') {
              const dateStr = existingSubscription.end_date.split('T')[0].split(' ')[0];
              expirationDate = new Date(dateStr + 'T00:00:00');
            } else {
              expirationDate = new Date(existingSubscription.end_date);
            }
            expirationDate.setHours(23, 59, 59, 999); // End of day
            endDate = expirationDate.toISOString();
            
            // Update existing subscription instead of creating new one
            await db.updateSubscription(existingSubscription.id, {
              tier: tier,
              status: 'active'
            });
            subscriptionId = existingSubscription.id;
            
            // Save payment method to subscription (hybrid system)
            if (paymentMethodId) {
              await db.updateSubscriptionPaymentMethod(subscriptionId, paymentMethodId, paymentMethodExpiresAt);
            }
            
            // Update payment status (payment was already created when intent was created)
            await db.updatePayment(paymentIntentId, 'succeeded');

            return res.json({
              message: 'Subscription upgraded',
              tier: tier,
              endDate: endDate,
              proratedUpgrade: true
            });
          } else {
            // Fallback: if no end_date, calculate new 30-day period
            endDate = calculateEndDate(tier);
            await db.updateSubscriptionStatus(existingSubscription.id, 'canceled');
          }
        } else {
          // New subscription: calculate end date (30 days from now)
          endDate = calculateEndDate(tier);
          
          // Cancel existing subscription if upgrading from inactive one
          if (isUpgrade && existingSubscription) {
            await db.updateSubscriptionStatus(existingSubscription.id, 'canceled');
          }
        }
        
        // Create new subscription (only if not updated above)
        // createSubscription will automatically cancel any existing active subscriptions
        if (!(isUpgrade && existingSubscription && subscriptionRowGrantsAccess(existingSubscription) && existingSubscription.end_date)) {
          const newSubscription = await db.createSubscription(
            userId,
            tier,
            stripeCustomerId,
            null, // No Stripe subscription for one-time payments
            endDate
          );
          subscriptionId = newSubscription.id;
          
          // Save payment method to subscription (hybrid system)
          if (paymentMethodId && subscriptionId) {
            await db.updateSubscriptionPaymentMethod(subscriptionId, paymentMethodId, paymentMethodExpiresAt);
          }

          // Update payment status (payment was already created when intent was created)
          await db.updatePayment(paymentIntentId, 'succeeded');
        }

        // Mark payment record as succeeded immediately so it appears in user payment history/admin views
        try {
          await db.updatePayment(paymentIntentId, 'succeeded');
        } catch (updateErr) {
          console.warn('Failed to update payment status to succeeded for', paymentIntentId, updateErr);
        }

        res.json({
          message: isUpgrade ? 'Subscription upgraded' : 'Subscription activated',
          tier: tier,
          endDate: endDate,
          proratedUpgrade: isUpgrade && existingSubscription && subscriptionRowGrantsAccess(existingSubscription) && existingSubscription.end_date
        });
      } catch (error) {
        console.error('Payment confirmation error:', error);
        res.status(500).json({ error: 'Failed to confirm payment' });
      }
    }
  );

  // Get user's subscription
  router.get('/subscriptions/me', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      const isStaff = user && (user.role === 'admin' || user.role === 'tester');
      if (!isStaff) {
        await db.ensureGymMemberTierOneIfNoValidAppSubscription(req.userId);
      }
      // Staff: get or extend subscription so they have an expiration date that auto-renews
      // Prefer active subscription with Stripe/tier ordering (getUserActiveSubscription); then latest row for expired-only users
      let subscription = isStaff
        ? await db.getOrExtendStaffSubscription(req.userId, user)
        : await db.getUserActiveSubscription(req.userId);
      if (!subscription && !isStaff) {
        subscription = await db.getUserLatestSubscription(req.userId);
      }
      // First-time users (no subscription): auto-enroll in free tier
      if (!subscription && !isStaff) {
        const tierConfig = require('./tier-access-config.json');
        const tierOneConfig = tierConfig.tiers?.tier_one;
        const subscriptionDays = tierOneConfig?.subscriptionDays ?? 10;
        const { tierOneEndIsoFromGymContractAnchor } = require('./lib/mountain-time');
        const gmRow = await db.queryOne(
          `SELECT contract_start_date, start_date, created_at, membership_type FROM gym_memberships WHERE user_id = $1 AND status = 'active'`,
          [req.userId]
        );
        const anchor = gmRow && (gmRow.contract_start_date || gmRow.start_date || gmRow.created_at);
        const endDateIso = tierOneEndIsoFromGymContractAnchor(anchor || null, subscriptionDays);
        const tierOneStatus = gmRow && gmRow.membership_type === 'free_trial' ? 'free_trial' : 'active';
        await db.createSubscription(req.userId, 'tier_one', null, null, endDateIso, tierOneStatus);
        subscription = await db.getUserLatestSubscription(req.userId);
      }
      if (!subscription) {
        return res.json({ subscription: null });
      }

      const clientPayload = await buildSubscriptionClientPayload(stripe, db, subscription, user);
      res.json({ subscription: clientPayload });
    } catch (error) {
      console.error('Get subscription error:', error);
      res.status(500).json({ error: 'Failed to get subscription' });
    }
  });
  
  // Get subscription payment method (hybrid system)
  router.get('/subscriptions/payment-method', authenticateToken, async (req, res) => {
    try {
      const subscription = await db.getUserActiveSubscription(req.userId);
      
      if (!subscription) {
        return res.status(404).json({ error: 'No active subscription found' });
      }
      
      if (!subscription.payment_method_id) {
        return res.json({ payment_method: null });
      }
      
      // Retrieve payment method details from Stripe
      try {
        const paymentMethod = await stripe.paymentMethods.retrieve(subscription.payment_method_id);
        res.json({
          payment_method: {
            id: paymentMethod.id,
            type: paymentMethod.type,
            card: paymentMethod.card ? {
              brand: paymentMethod.card.brand,
              last4: paymentMethod.card.last4,
              exp_month: paymentMethod.card.exp_month,
              exp_year: paymentMethod.card.exp_year
            } : null,
            expires_at: subscription.payment_method_expires_at
          }
        });
      } catch (stripeError) {
        console.error('Error retrieving payment method from Stripe:', stripeError.message);
        res.status(500).json({ error: 'Failed to retrieve payment method details' });
      }
    } catch (error) {
      console.error('Get payment method error:', error);
      res.status(500).json({ error: 'Failed to get payment method' });
    }
  });
  
  // Add/update subscription payment method (hybrid system) - same handler for both URLs
  router.post(['/subscriptions/add-payment-method', '/subscriptions/update-payment-method'], authenticateToken, async (req, res) => {
    try {
      const subscription = await db.getUserActiveSubscription(req.userId);
      
      if (!subscription) {
        return res.status(404).json({ error: 'No active subscription found' });
      }
      
      const stripeCustomerId = subscription.stripe_customer_id;
      if (!stripeCustomerId) {
        return res.status(400).json({ error: 'No Stripe customer ID found' });
      }
      
      // Create setup intent for collecting new payment method
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        metadata: {
          userId: req.userId.toString(),
          subscriptionId: subscription.id.toString(),
          type: 'app_subscription'
        }
      });
      
      res.json({
        setupIntentId: setupIntent.id,
        clientSecret: setupIntent.client_secret
      });
    } catch (error) {
      console.error('Create setup intent error:', error);
      res.status(500).json({ error: 'Failed to create setup intent' });
    }
  });
  
  // Confirm payment method update (hybrid system)
  router.post('/subscriptions/confirm-payment-method', authenticateToken, async (req, res) => {
    try {
      const { setupIntentId } = req.body;
      
      if (!setupIntentId) {
        return res.status(400).json({ error: 'Setup intent ID is required' });
      }
      
      const subscription = await db.getUserActiveSubscription(req.userId);
      if (!subscription) {
        return res.status(404).json({ error: 'No active subscription found' });
      }
      
      // Retrieve setup intent
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      
      if (setupIntent.status !== 'succeeded') {
        return res.status(400).json({ error: 'Setup intent not succeeded' });
      }
      
      if (!setupIntent.payment_method) {
        return res.status(400).json({ error: 'No payment method in setup intent' });
      }
      
      const paymentMethodId = setupIntent.payment_method;
      
      // Get payment method details for expiry date
      let paymentMethodExpiresAt = null;
      try {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        if (pm.card && pm.card.exp_year && pm.card.exp_month) {
          paymentMethodExpiresAt = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59, 59).toISOString();
        }
      } catch (pmError) {
        console.warn('Could not retrieve payment method expiry:', pmError.message);
      }
      
      // Save to database
      await db.updateSubscriptionPaymentMethod(subscription.id, paymentMethodId, paymentMethodExpiresAt);
      
      // Set as default on customer and subscription
      const stripeCustomerId = subscription.stripe_customer_id;
      if (stripeCustomerId) {
        await stripe.customers.update(stripeCustomerId, {
          invoice_settings: {
            default_payment_method: paymentMethodId
          }
        });
        
        if (subscription.stripe_subscription_id) {
          await stripe.subscriptions.update(subscription.stripe_subscription_id, {
            default_payment_method: paymentMethodId
          });
        }
      }
      
      // If subscription is in grace period, try to retry payment
      if (subscription.status === 'grace_period' && subscription.payment_failure_count > 0) {
        // The nightly job will handle the retry, but we can log that payment method was updated
        console.log(`Payment method updated for subscription ${subscription.id} in grace period. Next renewal job will retry payment.`);
      }
      
      res.json({
        success: true,
        message: 'Payment method updated successfully'
      });
    } catch (error) {
      console.error('Confirm payment method error:', error);
      res.status(500).json({ error: 'Failed to confirm payment method' });
    }
  });

  // Cancel user's subscription
  router.post('/subscriptions/cancel',
    authenticateToken,
    async (req, res) => {
      try {
        const userId = req.userId;
        
        // Get user's active subscription
        const subscription = await db.getUserActiveSubscription(userId);
        
        if (!subscription) {
          return res.status(404).json({ error: 'No active subscription found' });
        }

        if (subscription.status !== 'active' && subscription.status !== 'free_trial') {
          return res.status(400).json({ error: 'Subscription is not active' });
        }

        // Cancel the subscription (but keep it active until end_date)
        await db.updateSubscriptionStatus(subscription.id, 'canceled');
        await db.setSubscriptionCanceledByUser(subscription.id);
        
        // If subscription has a Stripe subscription ID, cancel it in Stripe too
        if (subscription.stripe_subscription_id) {
          try {
            await cancelSubscription(subscription.stripe_subscription_id);
          } catch (stripeError) {
            console.error('Error canceling Stripe subscription:', stripeError);
            // Continue even if Stripe cancellation fails
          }
        }

        res.json({ 
          message: 'Subscription canceled successfully',
          subscription: {
            ...subscription,
            status: 'canceled'
          }
        });
      } catch (error) {
        console.error('Failed to cancel subscription:', error);
        res.status(500).json({ error: 'Failed to cancel subscription' });
      }
    }
  );

  // ========== Workout Routes ==========

  // Get workout for a specific date
  // Get all workouts for Core Finishers (no subscription restrictions)
  router.get('/workouts/core', authenticateToken, async (req, res) => {
    try {
      // Get only core finisher workouts (workout_type = 'core')
      const allWorkouts = await db.getAllWorkouts();
      const coreWorkouts = allWorkouts.filter(w => {
        // Check workout_type field (may not exist in old databases)
        return w.workout_type === 'core' || 
               (w.workout_type === null && w.google_drive_file_id === '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4');
      });
      
      // Format workouts for frontend (include content for core finishers)
      const formattedWorkouts = coreWorkouts.map(workout => {
        const workoutDate = typeof workout.workout_date === 'string' 
          ? workout.workout_date.split('T')[0].split(' ')[0]
          : new Date(workout.workout_date).toISOString().split('T')[0];
        
        return {
          id: workout.id,
          date: workoutDate,
          title: workout.title || 'Core Finisher',
          content: workout.content, // Include content for core finishers
          created_at: workout.created_at
        };
      });
      
      res.json({ workouts: formattedWorkouts });
    } catch (error) {
      console.error('Get Core Finishers error:', error);
      res.status(500).json({ error: 'Failed to load Core Finishers' });
    }
  });

  router.get('/workouts/:date', authenticateToken, async (req, res) => {
    try {
      const { date } = req.params;
      const userId = req.userId;

      // Validate date format (YYYY-MM-DD)
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
        return res.status(400).json({ error: 'Invalid date format. Use YYYY-MM-DD' });
      }

      // Get user and subscription
      const user = await db.getUserById(userId);
      let subscription = await db.getUserActiveSubscription(userId);
      const isStaff = user && (user.role === 'admin' || user.role === 'tester');
      if (isStaff) {
        subscription = await db.getOrExtendStaffSubscription(userId, user) ||
          { tier: 'tier_four', status: 'active', start_date: user.created_at, end_date: null };
      }
      
      // Parse date to date-only (no time)
      const parseDateOnly = (dateValue) => {
        if (!dateValue) return null;
        if (dateValue instanceof Date) {
          const d = new Date(dateValue);
          d.setHours(0, 0, 0, 0);
          return d;
        }
        if (typeof dateValue === 'string') {
          const [datePart] = dateValue.split(' ');
          const [year, month, day] = datePart.split('-').map(Number);
          const d = new Date(year, (month || 1) - 1, day || 1);
          d.setHours(0, 0, 0, 0);
          return d;
        }
        return null;
      };
      
      const userCreatedAt = user ? parseDateOnly(user.created_at) : null;
      const workoutDate = new Date(date + 'T00:00:00');
      workoutDate.setHours(0, 0, 0, 0);
      
      // Check access - use user's local date if provided, otherwise use server date
      // Staff always has full Tier Four access for a single-date fetch (matches GET /workouts list).
      let hasAccess = false;
      if (isStaff) {
        hasAccess = true;
      } else if (subscription && subscriptionRowGrantsAccess(subscription)) {
        if (subscription.tier === 'weekly') {
          // For weekly, check if date is in current week (Mon-Sat)
          // Use user's local date from query param if provided
          let todayLocal;
          if (req.query.userDate && /^\d{4}-\d{2}-\d{2}$/.test(req.query.userDate)) {
            const [year, month, day] = req.query.userDate.split('-').map(Number);
            todayLocal = new Date(year, month - 1, day);
            todayLocal.setHours(0, 0, 0, 0);
          } else {
            const today = new Date();
            const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
            const [year, month, day] = todayStr.split('-').map(Number);
            todayLocal = new Date(year, month - 1, day);
            todayLocal.setHours(0, 0, 0, 0);
          }
          
          // Calculate Monday-Saturday of current week
          const dayOfWeek = todayLocal.getDay();
          const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          const mondayLocal = new Date(todayLocal);
          mondayLocal.setDate(todayLocal.getDate() - daysFromMonday);
          mondayLocal.setHours(0, 0, 0, 0);
          const saturdayLocal = new Date(mondayLocal);
          saturdayLocal.setDate(mondayLocal.getDate() + 5);
          saturdayLocal.setHours(23, 59, 59, 999);
          
          // Check if requested date is in this week
          const workoutDayOfWeek = workoutDate.getDay();
          
          // Check subscription end date
          const subscriptionEnd = subscription.end_date ? new Date(subscription.end_date) : null;
          if (subscriptionEnd && workoutDate > subscriptionEnd) {
            hasAccess = false;
          } else {
            // Check if workout is Mon-Sat and within current week
            hasAccess = workoutDate >= mondayLocal && 
                       workoutDate <= saturdayLocal && 
                       workoutDayOfWeek >= 1 && 
                       workoutDayOfWeek <= 6;
          }
        } else if (subscription.tier === 'monthly') {
          // For monthly, check if workout is >= user created_at date (or subscription start, whichever is earlier)
          const subscriptionStart = parseDateOnly(subscription.start_date);
          const minAccessDate = userCreatedAt && subscriptionStart 
            ? (userCreatedAt < subscriptionStart ? userCreatedAt : subscriptionStart)
            : (userCreatedAt || subscriptionStart);
          
          if (minAccessDate && workoutDate < minAccessDate) {
            hasAccess = false;
          } else {
            // Check subscription end date
            const subscriptionEnd = subscription.end_date ? new Date(subscription.end_date) : null;
            if (subscriptionEnd && workoutDate > subscriptionEnd) {
              hasAccess = false;
            } else {
              // Check 30-day limit if subscription has a real end date
              if (subscriptionEnd) {
                const farFutureDate = new Date('2090-01-01');
                if (subscriptionEnd <= farFutureDate) {
                  // Regular subscription - 30 days from start
                  const daysSinceStart = Math.floor((workoutDate - minAccessDate) / (1000 * 60 * 60 * 24));
                  hasAccess = daysSinceStart >= 0 && daysSinceStart <= 30;
                } else {
                  // Never-expiring subscription
                  hasAccess = workoutDate >= minAccessDate;
                }
              } else {
                // No end date - 30 days from start
                const daysSinceStart = Math.floor((workoutDate - minAccessDate) / (1000 * 60 * 60 * 24));
                hasAccess = daysSinceStart >= 0 && daysSinceStart <= 30;
              }
            }
          }
        } else {
          // For other tiers (daily), use the standard access check
          hasAccess = hasAccessToDate(subscription, date);
        }
      }
      
      if (!hasAccess) {
        return res.status(403).json({ 
          error: 'No active subscription or subscription does not cover this date',
          requiredTier: getRequiredTier(date)
        });
      }

      // Get workout
      const workout = await db.getWorkoutByDate(date);
      
      if (!workout) {
        return res.status(404).json({ error: 'Workout not found for this date' });
      }
      
      // Filter out strength workouts - only show regular (functional fitness) and core workouts
      const workoutType = workout.workout_type || workout.workoutType || 'regular';
      if (workoutType === 'strength') {
        return res.status(404).json({ error: 'Workout not found for this date' });
      }

      res.json({
        workout: {
          id: workout.id,
          date: workout.workout_date,
          title: extractWorkoutTitle(workout.content) || workout.title || 'Daily Workout',
          content: workout.content,
          created_at: workout.created_at,
          focus_areas: workout.focus_areas || null
        }
      });
    } catch (error) {
      console.error('Get workout error:', error);
      res.status(500).json({ error: 'Failed to get workout' });
    }
  });

  // Get available workouts (based on subscription tier)
  router.get('/workouts', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;

      // Get user and subscription
      const user = await db.getUserById(userId);
      let subscription = await db.getUserActiveSubscription(userId);
      // Admins and testers always get full workout access (tier_four), with or without an active subscription
      const isStaff = user && (user.role === 'admin' || user.role === 'tester');
      if (!subscription && !isStaff) {
        return res.status(403).json({ error: 'No active subscription' });
      }
      if (isStaff) {
        subscription = await db.getOrExtendStaffSubscription(userId, user) ||
          { tier: 'tier_four', status: 'active', start_date: user.created_at, end_date: null };
      }

      // Normalize workout_date to string format for comparison (handle both Date objects and strings)
      // This is needed because PostgreSQL returns Date objects while SQLite returns strings
      const normalizeWorkoutDate = (date) => {
        if (!date) return null;
        return typeof date === 'string' 
          ? date.split('T')[0].split(' ')[0]
          : new Date(date).toISOString().split('T')[0];
      };

      // Determine date range based on tier
      // Use user's local date from query param if provided, otherwise use server date
      let todayLocal;
      let year, month, day;
      
      if (req.query.userDate && /^\d{4}-\d{2}-\d{2}$/.test(req.query.userDate)) {
        // User provided their local date - use it to avoid timezone issues
        [year, month, day] = req.query.userDate.split('-').map(Number);
        todayLocal = new Date(year, month - 1, day);
        todayLocal.setHours(0, 0, 0, 0);
        console.log(`[DEBUG] Using user's local date: ${req.query.userDate} -> ${year}-${month}-${day}`);
      } else {
        // Fallback to server's local date
        const today = new Date();
        const todayStr = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
        [year, month, day] = todayStr.split('-').map(Number);
        todayLocal = new Date(year, month - 1, day);
        todayLocal.setHours(0, 0, 0, 0);
        console.log(`[DEBUG] Using server's local date: ${todayStr} -> ${year}-${month}-${day}`);
      }
      
      console.log(`[DEBUG] todayLocal: ${todayLocal.toISOString()}, day of week: ${todayLocal.getDay()}`);
      
      // For ALL tiers, show 30 days worth of workouts in the carousel
      // Calculate 30 days range from today (15 days before, 15 days after, or adjust based on available workouts)
      const carouselStartDate = new Date(todayLocal);
      carouselStartDate.setDate(todayLocal.getDate() - 15); // 15 days before today
      carouselStartDate.setHours(0, 0, 0, 0);
      
      const carouselEndDate = new Date(todayLocal);
      carouselEndDate.setDate(todayLocal.getDate() + 15); // 15 days after today
      carouselEndDate.setHours(23, 59, 59, 999);
      
      // For accessible workouts, we still need to calculate based on subscription tier
      // Normalize tier first to handle both legacy (daily/weekly/monthly) and new (tier_one/tier_two/tier_three/tier_four) names
      let normalizedTier;
      try {
        normalizedTier = normalizeTier(subscription.tier);
      } catch (error) {
        console.error('Error normalizing tier:', error);
        // Fallback to original tier if normalization fails
        normalizedTier = subscription.tier;
      }
      
      // Ensure normalizedTier is always defined
      if (!normalizedTier) {
        normalizedTier = subscription.tier;
      }
      
      // Helper function to parse dates (used in multiple places)
      const parseDateOnly = (dateValue) => {
        if (!dateValue) return null;
        if (dateValue instanceof Date) {
          const d = new Date(dateValue);
          d.setHours(0, 0, 0, 0);
          return d;
        }
        if (typeof dateValue === 'string') {
          const [datePart] = dateValue.split(' ');
          const [year, month, day] = datePart.split('-').map(Number);
          const d = new Date(year, (month || 1) - 1, day || 1);
          d.setHours(0, 0, 0, 0);
          return d;
        }
        return null;
      };
      
      let startDate = new Date(todayLocal);
      let endDate = new Date(todayLocal);
      let filterWeekdays = false;

      switch (normalizedTier) {
        case 'tier_one':
        case 'tier_two':
        case 'daily':
          // For accessible workouts, only today
          startDate = new Date(todayLocal);
          startDate.setHours(0, 0, 0, 0);
          endDate = new Date(todayLocal);
          endDate.setHours(23, 59, 59, 999);
          break;
        case 'tier_three':
        case 'weekly':
          // For accessible workouts, current week Monday-Saturday
          const dayOfWeek = todayLocal.getDay();
          const daysFromMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
          
          console.log(`[DEBUG] Weekly subscription - today: ${year}-${month}-${day}, dayOfWeek: ${dayOfWeek}, daysFromMonday: ${daysFromMonday}`);
          
          const mondayLocal = new Date(todayLocal);
          mondayLocal.setDate(todayLocal.getDate() - daysFromMonday);
          mondayLocal.setHours(0, 0, 0, 0);
          
          const saturdayLocal = new Date(mondayLocal);
          saturdayLocal.setDate(mondayLocal.getDate() + 5);
          saturdayLocal.setHours(23, 59, 59, 999);
          
          startDate = mondayLocal;
          endDate = saturdayLocal;
          filterWeekdays = true;
          break;
        case 'tier_four':
        case 'monthly':
          // For accessible workouts, from user created_at (or subscription start, whichever is earlier) to end_date (or 30 days for regular subscriptions)
          // parseDateOnly is now defined above, outside the switch
          const subscriptionStart = parseDateOnly(subscription.start_date);
          const userCreatedAt = user ? parseDateOnly(user.created_at) : null;
          const minAccessDate = userCreatedAt && subscriptionStart 
            ? (userCreatedAt < subscriptionStart ? userCreatedAt : subscriptionStart)
            : (userCreatedAt || subscriptionStart);
          startDate = minAccessDate;

          // Check if subscription never expires (end_date far in future)
          const subscriptionEnd = subscription.end_date ? new Date(subscription.end_date) : null;
          const farFutureDate = new Date('2090-01-01');
          const todayForRange = todayLocal ? new Date(todayLocal.getTime()) : new Date();
          todayForRange.setHours(23, 59, 59, 999);

          let endDateForQuery;
          if (subscriptionEnd && subscriptionEnd > farFutureDate) {
            // Never-expiring subscription - use last workout date or far future
            endDateForQuery = null; // No limit
          } else if (subscriptionEnd && subscriptionEnd >= todayForRange) {
            // Subscription has an end_date in the future (or today) - use it so access includes today (fixes staff and any tier_four with end_date)
            endDateForQuery = subscriptionEnd;
          } else {
            // No end_date or expired - fallback to 30 days from minAccessDate
            const thirtyDaysLater = new Date(minAccessDate.getTime());
            thirtyDaysLater.setDate(minAccessDate.getDate() + 30);
            thirtyDaysLater.setHours(23, 59, 59, 999);
            endDateForQuery = thirtyDaysLater;
          }
          
          if (endDateForQuery === null) {
            // Never-expiring subscription - use last workout date or far future
            const allWorkouts = await db.getAllWorkouts();
            // Filter out strength workouts
            const filteredAllWorkouts = allWorkouts.filter(w => {
              const workoutType = w.workout_type || w.workoutType || 'regular';
              return workoutType !== 'strength';
            });
            let lastWorkoutDate = null;
            if (filteredAllWorkouts && filteredAllWorkouts.length > 0) {
              const lastWorkout = filteredAllWorkouts[0];
              if (lastWorkout && lastWorkout.workout_date) {
                const normalizedLastDate = normalizeWorkoutDate(lastWorkout.workout_date);
                if (normalizedLastDate) {
                  lastWorkoutDate = new Date(normalizedLastDate + 'T00:00:00');
                  lastWorkoutDate.setHours(23, 59, 59, 999);
                }
              }
            }
            // Use last workout date or subscription end date (far future)
            endDate = lastWorkoutDate || subscriptionEnd || new Date('2099-12-31T23:59:59.999Z');
          } else {
            // Regular subscription - check if last workout is before 30 days
            const allWorkouts = await db.getAllWorkouts();
            // Filter out strength workouts
            const filteredAllWorkouts = allWorkouts.filter(w => {
              const workoutType = w.workout_type || w.workoutType || 'regular';
              return workoutType !== 'strength';
            });
            let lastWorkoutDate = null;
            if (filteredAllWorkouts && filteredAllWorkouts.length > 0) {
              const lastWorkout = filteredAllWorkouts[0];
              if (lastWorkout && lastWorkout.workout_date) {
                const normalizedLastDate = normalizeWorkoutDate(lastWorkout.workout_date);
                if (normalizedLastDate) {
                  lastWorkoutDate = new Date(normalizedLastDate + 'T00:00:00');
                  lastWorkoutDate.setHours(23, 59, 59, 999);
                }
              }
            }
            endDate = (lastWorkoutDate && lastWorkoutDate < endDateForQuery) ? lastWorkoutDate : endDateForQuery;
          }
          break;
      }

      // Get workouts for accessible workouts (based on subscription tier)
      // Use normalizedTier for consistency
      let queryStartStr, queryEndStr;
      if ((normalizedTier === 'tier_three' || subscription.tier === 'weekly') && filterWeekdays) {
        queryStartStr = `${startDate.getFullYear()}-${String(startDate.getMonth() + 1).padStart(2, '0')}-${String(startDate.getDate()).padStart(2, '0')}`;
        queryEndStr = `${endDate.getFullYear()}-${String(endDate.getMonth() + 1).padStart(2, '0')}-${String(endDate.getDate()).padStart(2, '0')}`;
      } else if (normalizedTier === 'tier_one' || normalizedTier === 'tier_two' || subscription.tier === 'daily') {
        queryStartStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        queryEndStr = queryStartStr;
      } else {
        queryStartStr = formatDateOnly(startDate);
        queryEndStr = formatDateOnly(endDate);
      }
      
      const workouts = await db.getWorkoutsByDateRange(
        queryStartStr,
        queryEndStr
      );
      
      // Filter out strength workouts - only show regular (functional fitness) and core workouts
      const filteredWorkouts = workouts.filter(w => {
        const workoutType = w.workout_type || w.workoutType || 'regular';
        return workoutType !== 'strength';
      });
      
      // Get ALL workouts for carousel (30 days worth)
      const carouselStartStr = formatDateOnly(carouselStartDate);
      const carouselEndStr = formatDateOnly(carouselEndDate);
      const carouselWorkoutsRaw = await db.getWorkoutsByDateRange(
        carouselStartStr,
        carouselEndStr
      );
      
      // Filter out strength workouts from carousel
      const filteredCarouselWorkoutsRaw = carouselWorkoutsRaw.filter(w => {
        const workoutType = w.workout_type || w.workoutType || 'regular';
        return workoutType !== 'strength';
      });
      
      console.log(`[DEBUG] Carousel: Fetched ${carouselWorkoutsRaw.length} workouts from ${carouselStartStr} to ${carouselEndStr} for 30-day display`);

      console.log(`[DEBUG] Query date range: ${queryStartStr} to ${queryEndStr}`);
      console.log(`[DEBUG] Found ${workouts.length} workouts in query range`);
      console.log(`[DEBUG] Subscription: tier=${subscription.tier}, normalizedTier=${normalizedTier}, status=${subscription.status}, start=${subscription.start_date}, end=${subscription.end_date}`);
      if (normalizedTier === 'tier_four' || subscription.tier === 'monthly') {
        console.log(`[DEBUG] Monthly subscription - Start date: ${queryStartStr}, End date: ${queryEndStr}, Total days: ${Math.ceil((new Date(queryEndStr) - new Date(queryStartStr)) / (1000 * 60 * 60 * 24))}`);
      }

      // Filter workouts based on subscription tier
      // Use normalizedTier to handle both legacy and new tier names
      let accessibleWorkouts;
      if (normalizedTier === 'tier_one' || normalizedTier === 'tier_two' || subscription.tier === 'daily') {
        // For daily subscriptions, show only today's workout
        // Use user's local date to match exactly
        const todayDateStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
        accessibleWorkouts = filteredWorkouts.filter(workout => {
          // Check subscription is active
          if (!subscriptionRowGrantsAccess(subscription)) {
            return false;
          }
          
          // Check if workout date matches today exactly
          // Convert workout_date to string format (YYYY-MM-DD) - handle both Date objects and strings
          const workoutDateStr = typeof workout.workout_date === 'string' 
            ? workout.workout_date.split('T')[0].split(' ')[0]
            : new Date(workout.workout_date).toISOString().split('T')[0];
          if (workoutDateStr !== todayDateStr) {
            console.log(`[DEBUG] Daily subscription - Workout ${workoutDateStr}: Excluded - not today (${todayDateStr})`);
            return false;
          }
          
          // Check subscription end date (30 days from start)
          const subscriptionEndStr = subscription.end_date 
            ? (typeof subscription.end_date === 'string' 
                ? subscription.end_date.split('T')[0].split(' ')[0] 
                : new Date(subscription.end_date).toISOString().split('T')[0])
            : null;
          if (subscriptionEndStr && workoutDateStr > subscriptionEndStr) {
            console.log(`[DEBUG] Daily subscription - Workout ${workoutDateStr}: Excluded - after subscription end ${subscriptionEndStr}`);
            return false;
          }
          
          return true;
        });
      } else if ((normalizedTier === 'tier_three' || subscription.tier === 'weekly') && filterWeekdays) {
        // For weekly, check subscription is active and within 30-day period
        // But show current week's workouts (not limited by subscription start date for the week)
        accessibleWorkouts = filteredWorkouts.filter(workout => {
          // Check subscription is active
          if (!subscriptionRowGrantsAccess(subscription)) {
            return false;
          }
          
          // For weekly subscriptions, show current week's workouts regardless of subscription start date
          // The subscription is valid for 30 days, but they see current week regardless
          // Convert workout_date to string format (YYYY-MM-DD) - handle both Date objects and strings
          const workoutDateStr = typeof workout.workout_date === 'string' 
            ? workout.workout_date.split('T')[0].split(' ')[0]
            : new Date(workout.workout_date).toISOString().split('T')[0];
          const subscriptionEndStr = subscription.end_date 
            ? (typeof subscription.end_date === 'string' 
                ? subscription.end_date.split('T')[0].split(' ')[0] 
                : new Date(subscription.end_date).toISOString().split('T')[0])
            : null;
          
          // Only check if workout is after subscription end (30 days from start)
          if (subscriptionEndStr && workoutDateStr > subscriptionEndStr) {
            console.log(`[DEBUG] Workout ${workoutDateStr}: Excluded - after subscription end ${subscriptionEndStr}`);
            return false;
          }
          
          // Check if workout date is within our Monday-Saturday range (using string comparison)
          if (workoutDateStr < queryStartStr || workoutDateStr > queryEndStr) {
            console.log(`[DEBUG] Workout ${workoutDateStr}: Excluded - outside week range (${queryStartStr} to ${queryEndStr})`);
            return false;
          }
          
          // Filter to only Mon-Sat - use date string to get day of week without timezone issues
          // Parse date string to get day of week
          const [wYear, wMonth, wDay] = workoutDateStr.split('-').map(Number);
          const workoutDateLocal = new Date(wYear, wMonth - 1, wDay);
          const dayOfWeek = workoutDateLocal.getDay();
          
          // Explicitly exclude Sunday (0)
          if (dayOfWeek === 0) {
            console.log(`[DEBUG] Workout ${workoutDateStr}: Excluded - day ${dayOfWeek} (Sunday)`);
            return false;
          }
          
          // Must be Monday-Saturday (day 1-6)
          return dayOfWeek >= 1 && dayOfWeek <= 6;
        });
      } else if (normalizedTier === 'tier_four' || subscription.tier === 'monthly') {
        // For monthly subscriptions, show all workouts from user created_at (or subscription start, whichever is earlier) to end date
        const parseDateOnlyForFilter = (dateValue) => {
          if (!dateValue) return null;
          if (dateValue instanceof Date) {
            const d = new Date(dateValue);
            d.setHours(0, 0, 0, 0);
            return d;
          }
          if (typeof dateValue === 'string') {
            const [datePart] = dateValue.split(' ');
            const [year, month, day] = datePart.split('-').map(Number);
            const d = new Date(year, (month || 1) - 1, day || 1);
            d.setHours(0, 0, 0, 0);
            return d;
          }
          return null;
        };
        const subscriptionStart = parseDateOnlyForFilter(subscription.start_date);
        const userCreatedAt = user ? parseDateOnlyForFilter(user.created_at) : null;
        const minAccessDate = userCreatedAt && subscriptionStart 
          ? (userCreatedAt < subscriptionStart ? userCreatedAt : subscriptionStart)
          : (userCreatedAt || subscriptionStart);
        const minAccessDateStr = minAccessDate 
          ? `${minAccessDate.getFullYear()}-${String(minAccessDate.getMonth() + 1).padStart(2, '0')}-${String(minAccessDate.getDate()).padStart(2, '0')}`
          : null;
        
        accessibleWorkouts = filteredWorkouts.filter(workout => {
          // Check subscription is active
          if (!subscriptionRowGrantsAccess(subscription)) {
            return false;
          }
          
          // Convert workout_date to string format (YYYY-MM-DD) - handle both Date objects and strings
          const workoutDateStr = typeof workout.workout_date === 'string' 
            ? workout.workout_date.split('T')[0].split(' ')[0]
            : new Date(workout.workout_date).toISOString().split('T')[0];
          
          // Check subscription end date (30 days from start)
          const subscriptionEndStr = subscription.end_date 
            ? (typeof subscription.end_date === 'string' 
                ? subscription.end_date.split('T')[0].split(' ')[0] 
                : new Date(subscription.end_date).toISOString().split('T')[0])
            : null;
          if (subscriptionEndStr && workoutDateStr > subscriptionEndStr) {
            console.log(`[DEBUG] Monthly subscription - Workout ${workoutDateStr}: Excluded - after subscription end ${subscriptionEndStr}`);
            return false;
          }
          
          // Check if workout is on or after minAccessDate (user created_at or subscription start, whichever is earlier)
          if (minAccessDateStr && workoutDateStr < minAccessDateStr) {
            console.log(`[DEBUG] Monthly subscription - Workout ${workoutDateStr}: Excluded - before min access date ${minAccessDateStr}`);
            return false;
          }
          
          return true;
        });
      } else {
        // For other tiers, use the normal access check
        accessibleWorkouts = filteredWorkouts.filter(workout => 
          hasAccessToDate(subscription, workout.workout_date)
        );
      }

      // Sort by date ascending (Monday first) - use string comparison to avoid timezone issues
      // Normalize dates before sorting
      accessibleWorkouts.forEach(w => {
        if (!w.workout_date || typeof w.workout_date !== 'string') {
          w.workout_date = normalizeWorkoutDate(w.workout_date) || normalizeWorkoutDate(w.date);
        }
      });
      accessibleWorkouts.sort((a, b) => {
        const dateA = normalizeWorkoutDate(a.workout_date) || normalizeWorkoutDate(a.date) || '';
        const dateB = normalizeWorkoutDate(b.workout_date) || normalizeWorkoutDate(b.date) || '';
        return dateA.localeCompare(dateB);
      });

      // Log what we're returning for debugging
      console.log(`[DEBUG] Returning ${accessibleWorkouts.length} workouts:`);
      accessibleWorkouts.forEach(w => {
        const title = extractWorkoutTitle(w.content) || w.title || 'Daily Workout';
        console.log(`  ${w.workout_date}: ${title.substring(0, 40)}`);
      });

      // Get available upgrade options with pro-rated pricing
      // Only returns the next tier up (daily -> weekly, weekly -> monthly)
      const availableUpgrades = getAvailableUpgrades(subscription.tier);
      const today = new Date();
      today.setHours(0, 0, 0, 0);
      
      // Calculate remaining days for pro-rating
      // Cap at 30 days maximum for upgrade pricing (subscriptions are 30-day periods)
      let remainingDays = 30; // Default if no end_date
      if (subscription.end_date) {
        let expirationDate;
        if (subscription.end_date instanceof Date) {
          expirationDate = new Date(subscription.end_date);
        } else if (typeof subscription.end_date === 'string') {
          const dateStr = subscription.end_date.split('T')[0].split(' ')[0];
          expirationDate = new Date(dateStr + 'T00:00:00');
        } else {
          expirationDate = new Date(subscription.end_date);
        }
        expirationDate.setHours(0, 0, 0, 0);
        const timeDiff = expirationDate - today;
        const calculatedDays = Math.max(0, Math.ceil(timeDiff / (1000 * 60 * 60 * 24)));
        // Cap remaining days at 30 for upgrade pricing (to prevent inflated prices for never-expiring subscriptions)
        remainingDays = Math.min(calculatedDays, 30);
      }
      
      const upgradeOptions = availableUpgrades.map(upgradeTier => {
        // Create a subscription object with capped remaining days for upgrade price calculation
        const cappedSubscription = {
          ...subscription,
          end_date: new Date(today.getTime() + remainingDays * 24 * 60 * 60 * 1000).toISOString()
        };
        
        // Use pro-rated upgrade price calculation with capped subscription
        const upgradePrice = calculateUpgradePrice(cappedSubscription, upgradeTier);
        const fullPrice = TIER_PRICING[upgradeTier];
        const currentFullPrice = TIER_PRICING[subscription.tier];
        
        // Calculate what they'd pay for remaining time at new tier (for display)
        const { calculateProratedPrice } = require('./payments');
        const newTierRemainingPrice = remainingDays > 0 ? calculateProratedPrice(upgradeTier, remainingDays) : 0;
        const currentTierRemainingPrice = remainingDays > 0 ? calculateProratedPrice(subscription.tier, remainingDays) : 0;
        
        return {
          tier: upgradeTier,
          upgradePrice: upgradePrice, // Pro-rated price to pay
          fullPrice: fullPrice, // Full price of the tier
          currentTier: subscription.tier,
          remainingDays: remainingDays,
          currentTierRemainingPrice: currentTierRemainingPrice, // Value of remaining time on current tier
          newTierRemainingPrice: newTierRemainingPrice // Cost of remaining time at new tier
        };
      });

      const todayStr = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
      const accessibleDateSet = new Set(accessibleWorkouts.map(w => normalizeWorkoutDate(w.workout_date) || normalizeWorkoutDate(w.date)));

      let todayWorkoutRow = null;
 
      if (subscription && subscriptionRowGrantsAccess(subscription)) {
        todayWorkoutRow = accessibleWorkouts.find(workout => {
          const workoutDate = normalizeWorkoutDate(workout.workout_date) || normalizeWorkoutDate(workout.date);
          return workoutDate === todayStr;
        }) || null;
 
        if (!todayWorkoutRow) {
          const fallbackWorkout = await db.getLatestWorkoutBeforeOrOn(todayStr);
          if (fallbackWorkout) {
            // Only use fallback if it's not a strength workout
            const workoutType = fallbackWorkout.workout_type || fallbackWorkout.workoutType || 'regular';
            if (workoutType !== 'strength') {
              todayWorkoutRow = fallbackWorkout;
            }
          }
        }
        if (!todayWorkoutRow) {
          // Today not in accessible set and DB fallback was null or strength-only.
          // Use today from carousel (30-day range) so we return it as locked and show upgrade message.
          const todayFromCarousel = filteredCarouselWorkoutsRaw.find(w => {
            const d = normalizeWorkoutDate(w.workout_date) || normalizeWorkoutDate(w.date);
            return d === todayStr;
          });
          if (todayFromCarousel) {
            todayWorkoutRow = todayFromCarousel;
          }
        }
      }
 
      let todayWorkoutResponse = null;
      if (todayWorkoutRow) {
        // Normalize workout_date to string for response
        const normalizedDate = normalizeWorkoutDate(todayWorkoutRow.workout_date) || normalizeWorkoutDate(todayWorkoutRow.date);
        // Check if today's workout is accessible based on tier
        const isAccessible = subscription && subscriptionRowGrantsAccess(subscription) && accessibleDateSet.has(normalizedDate);
        const todayLocked = !isAccessible;
        todayWorkoutResponse = {
          id: todayWorkoutRow.id,
          date: normalizedDate,
          title: extractWorkoutTitle(todayWorkoutRow.content) || todayWorkoutRow.title || 'Daily Workout',
          content: todayWorkoutRow.content,
          created_at: todayWorkoutRow.created_at,
          locked: todayLocked
        };
        if (todayLocked) {
          todayWorkoutResponse.message = 'This workout is not included in your current subscription.';
          todayWorkoutResponse.requiredTier = getRequiredTier(normalizedDate);
        }

        const existsInCarousel = accessibleWorkouts.some(workout => {
          const workoutDate = normalizeWorkoutDate(workout.workout_date) || normalizeWorkoutDate(workout.date);
          return workoutDate === normalizedDate;
        });
        if (!existsInCarousel) {
          accessibleWorkouts.unshift({
            id: todayWorkoutRow.id,
            workout_date: normalizedDate,
            date: normalizedDate,
            title: extractWorkoutTitle(todayWorkoutRow.content) || todayWorkoutRow.title || 'Daily Workout',
            created_at: todayWorkoutRow.created_at,
            locked: false,
            requiredTier: null,
            message: null
          });
        } else {
          accessibleWorkouts = accessibleWorkouts.map(workout => {
            const workoutDate = normalizeWorkoutDate(workout.workout_date) || normalizeWorkoutDate(workout.date);
            if (workoutDate === normalizedDate) {
              return { ...workout, locked: false, requiredTier: null, message: null, workout_date: normalizedDate, date: normalizedDate };
            }
            return workout;
          });
        }
      }
 
      // For ALL tiers, build carousel from 30 days worth of workouts
      // Normalize and prepare all carousel workouts (excluding strength workouts)
      const allCarouselWorkoutRows = filteredCarouselWorkoutsRaw.map(w => {
        const normalizedDate = normalizeWorkoutDate(w.workout_date);
        return {
          id: w.id,
          workout_date: normalizedDate,
          content: w.content,
          title: w.title,
          created_at: w.created_at,
          focus_areas: w.focus_areas || null
        };
      });
      
      // Sort by date
      allCarouselWorkoutRows.sort((a, b) => a.workout_date.localeCompare(b.workout_date));
      
      // Store for carousel building
      req.allCarouselWorkoutRows = allCarouselWorkoutRows;
      
      // For timeline building, split into before/after today
      let beforeRowsRaw, afterRowsRaw;
      beforeRowsRaw = allCarouselWorkoutRows.filter(w => w.workout_date < todayStr);
      afterRowsRaw = allCarouselWorkoutRows.filter(w => w.workout_date > todayStr);
      
      // For monthly/tier_four subscribers, also store their specific range
      if (subscription && (normalizedTier === 'tier_four' || subscription.tier === 'monthly')) {
        // For monthly subscribers, we need ALL workouts from subscription start to end date
        const subscriptionStart = parseDateOnly(subscription.start_date);
        const subscriptionStartStr = formatDateOnly(subscriptionStart);
        const subscriptionEndStr = formatDateOnly(endDate);
        
        // Get ALL workouts from database within the subscription date range
        const allWorkoutsInRange = await db.getWorkoutsByDateRange(subscriptionStartStr, subscriptionEndStr);
        
        // Filter out strength workouts
        const filteredAllWorkoutsInRange = allWorkoutsInRange.filter(w => {
          const workoutType = w.workout_type || w.workoutType || 'regular';
          return workoutType !== 'strength';
        });
        
        console.log(`[DEBUG] Monthly subscription - Fetched ${filteredAllWorkoutsInRange.length} workouts from ${subscriptionStartStr} to ${subscriptionEndStr} (excluding strength)`);
        
        // Normalize dates and map to the format we need
        const allWorkoutRows = filteredAllWorkoutsInRange.map(w => {
          const normalizedDate = normalizeWorkoutDate(w.workout_date);
          return {
            id: w.id,
            workout_date: normalizedDate,
            content: w.content,
            title: w.title,
            created_at: w.created_at
          };
        });
        
        // Sort by date ascending (from subscription start to end)
        allWorkoutRows.sort((a, b) => a.workout_date.localeCompare(b.workout_date));
        
        // Store allWorkoutRows for use in carousel building later
        // For now, split into before and after today for timeline structure
        beforeRowsRaw = allWorkoutRows.filter(w => w.workout_date < todayStr);
        afterRowsRaw = allWorkoutRows.filter(w => w.workout_date > todayStr);
        
        // Store allWorkoutRows in a way we can access it later
        // We'll use this when building the carousel
        req.monthlyAllWorkoutRows = allWorkoutRows;
        
        console.log(`[DEBUG] Monthly subscription - Before today: ${beforeRowsRaw.length}, After today: ${afterRowsRaw.length}, Total: ${allWorkoutRows.length}, Today: ${todayStr}`);
      } else if (subscription && (normalizedTier === 'tier_three' || subscription.tier === 'weekly') && filterWeekdays) {
        // Get all workouts from accessibleWorkouts that are before and after today
        const accessibleWorkoutRows = accessibleWorkouts.map(aw => {
          const normalizedDate = normalizeWorkoutDate(aw.workout_date) || normalizeWorkoutDate(aw.date);
          return {
            id: aw.id,
            workout_date: normalizedDate,
            content: aw.content,
            title: aw.title,
            created_at: aw.created_at
          };
        });
        beforeRowsRaw = accessibleWorkoutRows.filter(w => w.workout_date < todayStr).sort((a, b) => a.workout_date.localeCompare(b.workout_date));
        afterRowsRaw = accessibleWorkoutRows.filter(w => w.workout_date > todayStr).sort((a, b) => a.workout_date.localeCompare(b.workout_date));
        
        // Also get workouts from database that might not be in accessibleWorkouts (for locked workouts)
        const dbBefore = await db.getWorkoutsBefore(todayStr, 10);
        const dbAfter = await db.getWorkoutsAfter(todayStr, 10);
        
        // Filter out strength workouts
        const filteredDbBefore = dbBefore.filter(w => {
          const workoutType = w.workout_type || w.workoutType || 'regular';
          return workoutType !== 'strength';
        });
        const filteredDbAfter = dbAfter.filter(w => {
          const workoutType = w.workout_type || w.workoutType || 'regular';
          return workoutType !== 'strength';
        });
        
        // Merge and deduplicate - normalize dates from database
        const beforeSet = new Set(beforeRowsRaw.map(w => w.workout_date));
        const afterSet = new Set(afterRowsRaw.map(w => w.workout_date));
        
        filteredDbBefore.forEach(w => {
          const normalizedDate = normalizeWorkoutDate(w.workout_date);
          if (normalizedDate && !beforeSet.has(normalizedDate)) {
            beforeRowsRaw.push({ ...w, workout_date: normalizedDate });
            beforeSet.add(normalizedDate);
          }
        });
        
        filteredDbAfter.forEach(w => {
          const normalizedDate = normalizeWorkoutDate(w.workout_date);
          if (normalizedDate && !afterSet.has(normalizedDate)) {
            afterRowsRaw.push({ ...w, workout_date: normalizedDate });
            afterSet.add(normalizedDate);
          }
        });
        
        beforeRowsRaw.sort((a, b) => a.workout_date.localeCompare(b.workout_date));
        afterRowsRaw.sort((a, b) => a.workout_date.localeCompare(b.workout_date));
      } else {
        beforeRowsRaw = await db.getWorkoutsBefore(todayStr, 5);
        afterRowsRaw = await db.getWorkoutsAfter(todayStr, 5);
        // Filter out strength workouts and normalize dates from database
        beforeRowsRaw = beforeRowsRaw
          .filter(w => {
            const workoutType = w.workout_type || w.workoutType || 'regular';
            return workoutType !== 'strength';
          })
          .map(w => ({
            ...w,
            workout_date: normalizeWorkoutDate(w.workout_date) || w.workout_date
          }));
        afterRowsRaw = afterRowsRaw
          .filter(w => {
            const workoutType = w.workout_type || w.workoutType || 'regular';
            return workoutType !== 'strength';
          })
          .map(w => ({
            ...w,
            workout_date: normalizeWorkoutDate(w.workout_date) || w.workout_date
          }));
      }

      // Helper function to check if a date is accessible based on tier
      // Now uses hasAccessToDate from payments.js which uses tier-access-config.json
      const isDateAccessible = (dateStr, tier) => {
        if (!subscription || !subscriptionRowGrantsAccess(subscription)) {
          return false;
        }
        
        // Use hasAccessToDate which uses the centralized config and handles all tier names (including tier_four)
        // This ensures tier_four gets "unlimited" access as defined in tier-access-config.json
        return hasAccessToDate(subscription, dateStr);
      };

      const makeCarouselItem = (row) => {
        // Normalize workout_date to string format
        const dateStr = normalizeWorkoutDate(row.workout_date) || row.workout_date;
        // Use normalized tier for access check to handle both legacy and new tier names
        const accessible = subscription && subscriptionRowGrantsAccess(subscription) && isDateAccessible(dateStr, normalizedTier || subscription.tier);
        const locked = !(subscription && subscriptionRowGrantsAccess(subscription)) || !accessible;
        let requiredTier = null;
        let message = null;

        if (locked) {
          requiredTier = getRequiredTier(dateStr);
          
          // SIMPLE LOGIC: Check if subscription has expired FIRST
          // If expired, always show upgrade message regardless of tier
          let isSubscriptionExpired = !subscription || !subscriptionRowGrantsAccess(subscription);
          
          // Check if subscription has expired by date (even if status is still 'active')
          if (subscription && subscription.end_date) {
            // Handle both Date objects and strings for end_date
            let expirationDateStr;
            if (typeof subscription.end_date === 'string') {
              expirationDateStr = subscription.end_date.split('T')[0].split(' ')[0];
            } else if (subscription.end_date instanceof Date) {
              expirationDateStr = subscription.end_date.toISOString().split('T')[0];
            } else {
              expirationDateStr = String(subscription.end_date).split('T')[0].split(' ')[0];
            }
            
            const expirationDate = new Date(expirationDateStr + 'T00:00:00');
            expirationDate.setHours(0, 0, 0, 0);
            
            // Use todayLocal (from the route handler) which is the user's local date
            const todayCheck = todayLocal ? new Date(todayLocal.getTime()) : new Date();
            todayCheck.setHours(0, 0, 0, 0);
            
            // If today is after or equal to expiration date, subscription has expired
            // Use >= because if expires on Nov 19, Nov 20 and later should be expired
            if (todayCheck >= expirationDate) {
              isSubscriptionExpired = true;
              console.log(`[DEBUG makeCarouselItem] Workout ${dateStr}: Subscription EXPIRED - today ${todayCheck.toISOString()} >= expiration ${expirationDate.toISOString()}, end_date was: ${subscription.end_date}`);
            }
          }
          
          // ALL locked workouts show upgrade message
          message = 'Requires a subscription upgrade.';
        }

        return {
          id: row.id,
          date: dateStr,
          title: extractWorkoutTitle(row.content) || row.title || 'Daily Workout',
          created_at: row.created_at,
          locked,
          requiredTier,
          message,
          focus: row.focus_areas || extractFocus(row.content)
        };
      };

      const beforeItems = beforeRowsRaw
        .map(makeCarouselItem)
        .sort((a, b) => a.date.localeCompare(b.date));

      const afterItems = afterRowsRaw
        .map(makeCarouselItem)
        .sort((a, b) => a.date.localeCompare(b.date));

      let centerItem = null;
      if (todayWorkoutRow) {
        centerItem = makeCarouselItem(todayWorkoutRow);
        centerItem.locked = false;
        centerItem.requiredTier = null;
        centerItem.message = null;
      }

      const timeline = [];
      const addItem = (item) => {
        if (!item) return;
        const existingIndex = timeline.findIndex(existing => existing.date === item.date);
        if (existingIndex === -1) {
          timeline.push(item);
        } else if (timeline[existingIndex].locked && !item.locked) {
          timeline[existingIndex] = item;
        }
      };

      beforeItems.forEach(addItem);
      addItem(centerItem);
      if (!centerItem) {
        addItem({
          id: null,
          date: todayStr,
          title: 'No Workout Scheduled',
          created_at: null,
          locked: true,
          requiredTier: getRequiredTier(todayStr),
          message: 'No workout scheduled for this day.'
        });
      }
      afterItems.forEach(addItem);

      timeline.sort((a, b) => a.date.localeCompare(b.date));

      const referenceDate = centerItem ? centerItem.date : todayStr;
      let centerIndex = timeline.findIndex(item => item.date === referenceDate);
      if (centerIndex === -1) {
        centerIndex = timeline.findIndex(item => item.date >= todayStr);
        if (centerIndex === -1) {
          centerIndex = Math.max(0, timeline.length - 1);
        }
      }

      // For ALL tiers, show 30 days worth of workouts in the carousel
      // Use the allCarouselWorkoutRows we prepared earlier
      const carouselWorkoutRows = req.allCarouselWorkoutRows || [];
      
      // Build carousel items from all 30 days of workouts
      const allCarouselItems = carouselWorkoutRows.map(row => makeCarouselItem(row));
      
      // Remove duplicates and sort by date
      const uniqueCarouselItems = [];
      const seenDates = new Set();
      allCarouselItems.forEach(item => {
        if (!seenDates.has(item.date)) {
          seenDates.add(item.date);
          uniqueCarouselItems.push(item);
        }
      });
      
      uniqueCarouselItems.sort((a, b) => a.date.localeCompare(b.date));
      
      console.log(`[DEBUG] Carousel for ${subscription.tier} tier: Showing ${uniqueCarouselItems.length} workouts (30-day range)`);
      console.log(`[DEBUG] Today workout response:`, todayWorkoutResponse ? { id: todayWorkoutResponse.id, date: todayWorkoutResponse.date, hasContent: !!todayWorkoutResponse.content } : 'null');
      console.log(`[DEBUG] Carousel workouts sample (first 3):`, uniqueCarouselItems.slice(0, 3).map(w => ({ date: w.date, locked: w.locked, hasFocus: !!w.focus })));
      
      // Use all carousel items (30 days worth) for ALL tiers
      const carouselWorkouts = uniqueCarouselItems;
 
      res.json({
        workouts: accessibleWorkouts.map(w => {
          const normalizedDate = normalizeWorkoutDate(w.workout_date) || normalizeWorkoutDate(w.date);
          return {
            id: w.id,
            date: normalizedDate, // Keep as YYYY-MM-DD string
            title: extractWorkoutTitle(w.content) || w.title || 'Daily Workout',
            created_at: w.created_at
          };
        }),
        upgradeOptions: upgradeOptions,
        todayWorkout: todayWorkoutResponse,
        carouselWorkouts
      });
    } catch (error) {
      console.error('Get workouts error:', error);
      console.error('Error stack:', error.stack);
      res.status(500).json({ error: `Failed to get workouts: ${error.message}` });
    }
  });

  // ========== Strength Workout Routes ==========

  // Get all strength workouts
  router.get('/strength-workouts', authenticateToken, async (req, res) => {
    try {
      // Get phase filter from query parameter
      const phaseFilter = req.query.phase || null;
      console.log('[GET /strength-workouts] Phase filter:', phaseFilter);
      
      // Get all strength workouts from strength_workouts table
      let strengthWorkouts = await db.getAllStrengthWorkouts();
      console.log('[GET /strength-workouts] Total workouts found:', strengthWorkouts.length);
      
      // Log unique phase values to help debug
      if (strengthWorkouts.length > 0) {
        const uniquePhases = [...new Set(strengthWorkouts.map(w => w.phase || '(null)'))];
        console.log('[GET /strength-workouts] Unique phase values in database:', JSON.stringify(uniquePhases));
        // Log a few sample workouts with their phase values
        const sampleWorkouts = strengthWorkouts.slice(0, 5).map(w => ({ 
          id: w.id, 
          phase: w.phase || '(null)', 
          title: w.title ? w.title.substring(0, 50) : '(no title)'
        }));
        console.log('[GET /strength-workouts] Sample workouts:', JSON.stringify(sampleWorkouts, null, 2));
        // Count workouts per phase
        const phaseCounts = {};
        strengthWorkouts.forEach(w => {
          const phase = w.phase || '(null)';
          phaseCounts[phase] = (phaseCounts[phase] || 0) + 1;
        });
        console.log('[GET /strength-workouts] Workout counts by phase:', JSON.stringify(phaseCounts, null, 2));
      } else {
        console.log('[GET /strength-workouts] No strength workouts found in database!');
      }
      
      // Filter by phase if provided
      if (phaseFilter) {
        const beforeFilter = strengthWorkouts.length;
        // Try exact match first
        let filtered = strengthWorkouts.filter(workout => {
          const workoutPhase = workout.phase || '';
          return workoutPhase === phaseFilter;
        });
        
        // If no exact match, try case-insensitive and partial matches
        if (filtered.length === 0) {
          console.log('[GET /strength-workouts] No exact match for phase filter, trying case-insensitive...');
          filtered = strengthWorkouts.filter(workout => {
            const workoutPhase = (workout.phase || '').toLowerCase().trim();
            const filterLower = phaseFilter.toLowerCase().trim();
            
            // Try various matching strategies
            if (workoutPhase === filterLower) return true;
            if (workoutPhase.includes(filterLower)) return true;
            if (filterLower.includes(workoutPhase)) return true;
            
            // Handle phase with difficulty level: "Phase One: Beginner" should match "Phase One"
            // Database has: "Phase One: Beginner", "Phase Two: Intermediate", "Phase Three: Advanced"
            // Frontend sends: "Phase One", "Phase Two", "Phase Three"
            if (workoutPhase.startsWith(filterLower + ':') || workoutPhase.startsWith(filterLower + ' ')) {
              return true;
            }
            
            // Try number matching: "Phase One" vs "Phase 1" vs "1"
            const phaseOneMatch = (filterLower === 'phase one' && (workoutPhase === 'phase 1' || workoutPhase === '1' || workoutPhase.startsWith('phase 1')));
            const phaseTwoMatch = (filterLower === 'phase two' && (workoutPhase === 'phase 2' || workoutPhase === '2' || workoutPhase.startsWith('phase 2')));
            const phaseThreeMatch = (filterLower === 'phase three' && (workoutPhase === 'phase 3' || workoutPhase === '3' || workoutPhase.startsWith('phase 3')));
            
            return phaseOneMatch || phaseTwoMatch || phaseThreeMatch;
          });
        }
        
        console.log('[GET /strength-workouts] After phase filter:', filtered.length, 'workouts (was', beforeFilter, ')');
        
        // If still no matches, log a warning
        if (filtered.length === 0 && beforeFilter > 0) {
          console.warn('[GET /strength-workouts] WARNING: Phase filter "' + phaseFilter + '" matched 0 workouts out of ' + beforeFilter + '. Check phase values in database.');
        }
        
        strengthWorkouts = filtered;
      }
      
      // Format workouts for frontend
      const formattedWorkouts = strengthWorkouts.map(workout => {
        const workoutDate = typeof workout.workout_date === 'string' 
          ? workout.workout_date.split('T')[0].split(' ')[0]
          : new Date(workout.workout_date).toISOString().split('T')[0];
        
        return {
          id: workout.id,
          workout_date: workoutDate,
          date: workoutDate,
          title: workout.title || 'Strength Workout',
          phase: workout.phase || '',
          primary_focus: workout.primary_focus || '',
          secondary_focus: workout.secondary_focus || '',
          slide_number: workout.slide_number || null,
          workout_index: workout.workout_index || null,
          workout_number: workout.workout_number || null,
          created_at: workout.created_at
        };
      });

      console.log('[GET /strength-workouts] Returning', formattedWorkouts.length, 'formatted workouts');
      res.json({ workouts: formattedWorkouts });
    } catch (error) {
      console.error('Get strength workouts error:', error);
      res.status(500).json({ error: 'Failed to get strength workouts' });
    }
  });

  // Get strength workout for a specific date or ID
  router.get('/strength-workouts/:identifier', authenticateToken, async (req, res) => {
    try {
      const { identifier } = req.params;
      let workout;

      // CRITICAL: Handle dual database structure
      // - Normalized workout table (Phase One) - has blocks/exercises
      // - Legacy strength_workouts table (Phase Two/Three) - has content field
      // Must check both tables as fallback. See STRENGTH_WORKOUTS_ARCHITECTURE.md
      
      // Check if identifier is numeric (ID) or date format (YYYY-MM-DD)
      if (/^\d+$/.test(identifier)) {
        // It's an ID - try the normalized workout table first
        const id = parseInt(identifier, 10);
        console.log('[GET /strength-workouts/:identifier] Looking up workout ID:', id);
        
        try {
          workout = await db.getStrengthWorkoutById(id);
          console.log('[GET /strength-workouts/:identifier] Result from normalized workout table:', workout ? 'Found' : 'Not found');
        } catch (error) {
          console.error('[GET /strength-workouts/:identifier] Error querying normalized workout table:', error);
          workout = null;
        }
        
        if (!workout) {
          // If not found in workout table, try strength_workouts table
          console.log('[GET /strength-workouts/:identifier] Trying strength_workouts table for ID:', id);
          try {
            if (db.isPostgres) {
              workout = await db.queryOne('SELECT * FROM strength_workouts WHERE id = $1', [id]);
            } else {
              workout = await db.queryOne('SELECT * FROM strength_workouts WHERE id = ?', [id]);
            }
            console.log('[GET /strength-workouts/:identifier] Result from strength_workouts table:', workout ? 'Found' : 'Not found');
          } catch (error) {
            console.error('[GET /strength-workouts/:identifier] Error querying strength_workouts table:', error);
            workout = null;
          }
        }
        
        if (!workout) {
          console.log('[GET /strength-workouts/:identifier] Workout not found in either table for ID:', id);
          return res.status(404).json({ error: 'Strength workout not found for this ID' });
        }
        
        console.log('[GET /strength-workouts/:identifier] Retrieved workout by ID:', id, 'Fields:', Object.keys(workout));
        
        // If workout has blocks (from normalized table), format it differently
        if (workout.blocks) {
          // This is from the normalized workout table
          const workoutDate = workout.created_at 
            ? new Date(workout.created_at).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0];
          
          return res.json({
            workout: {
              id: workout.id,
              workout_date: workoutDate,
              date: workoutDate,
              title: workout.name || 'Strength Workout',
              content: workout.notes || '',
              phase: workout.phase || '',
              primary_focus: workout.primary_focus || '',
              secondary_focus: workout.secondary_focus || '',
              blocks: workout.blocks || [],
              workout_format_name: workout.workout_format_name || null,
              workout_format_json: workout.workout_format_json || null,
              created_at: workout.created_at
            }
          });
        }
      } else if (/^\d{4}-\d{2}-\d{2}$/.test(identifier)) {
        // It's a date
        workout = await db.getStrengthWorkoutByDate(identifier);
        if (!workout) {
          return res.status(404).json({ error: 'Strength workout not found for this date' });
        }
      } else {
        return res.status(400).json({ error: 'Invalid identifier. Use workout ID (number) or date format (YYYY-MM-DD)' });
      }

      // Format workout from strength_workouts table
      const workoutDate = workout.workout_date 
        ? (typeof workout.workout_date === 'string' 
            ? workout.workout_date.split('T')[0].split(' ')[0]
            : new Date(workout.workout_date).toISOString().split('T')[0])
        : (workout.created_at 
            ? new Date(workout.created_at).toISOString().split('T')[0]
            : new Date().toISOString().split('T')[0]);

      res.json({
        workout: {
          id: workout.id,
          workout_date: workoutDate,
          date: workoutDate,
          title: workout.title || workout.name || 'Strength Workout',
          content: workout.content || '',
          phase: workout.phase || '',
          primary_focus: workout.primary_focus || '',
          secondary_focus: workout.secondary_focus || '',
          slide_number: workout.slide_number || null,
          workout_index: workout.workout_index || null,
          workout_number: workout.workout_number || null,
          created_at: workout.created_at
        }
      });
    } catch (error) {
      console.error('Get strength workout error:', error);
      res.status(500).json({ error: 'Failed to get strength workout' });
    }
  });

  // Admin route: Sync workout from Google Drive
  router.post('/admin/workouts/sync',
    authenticateToken,
    [
      body('fileId').notEmpty(),
      body('workoutDate').matches(/^\d{4}-\d{2}-\d{2}$/)
    ],
    async (req, res) => {
      try {
        // TODO: Add admin check
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { fileId, workoutDate } = req.body;

        // Sync workout from Google Slides
        const workoutData = await syncWorkoutFromSlides(fileId, workoutDate);

        // Store in database
        await db.createWorkout(
          workoutDate,
          workoutData.fileId,
          workoutData.title,
          workoutData.content
        );

        res.json({
          message: 'Workout synced successfully',
          workout: {
            date: workoutDate,
            title: workoutData.title,
            slideCount: workoutData.slideCount,
            fileId: workoutData.fileId,
            fileName: workoutData.fileName,
            content: workoutData.content,
            contentLength: workoutData.content.length,
            wordCount: workoutData.content.split(/\s+/).filter(w => w.length > 0).length,
            preview: workoutData.content.substring(0, 500) + (workoutData.content.length > 500 ? '...' : '')
          }
        });
      } catch (error) {
        console.error('Sync workout error:', error);
        res.status(500).json({ error: `Failed to sync workout: ${error.message}` });
      }
    }
  );

  // Admin route: Add/update a single functional fitness workout (date, carousel focus, title, sections)
  const FUNCTIONAL_FITNESS_FILE_ID = '1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4';
  router.get('/admin/workouts/functional-fitness/:date',
    authenticateToken,
    async (req, res) => {
      try {
        const user = await db.getUserById(req.userId);
        if (!user || user.role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required' });
        }
        const date = String(req.params.date || '').trim();
        if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
          return res.status(400).json({ error: 'Date must be YYYY-MM-DD' });
        }
        const workout = await db.getWorkoutByDate(date);
        if (!workout || workout.workout_type !== 'functional_fitness') {
          return res.status(404).json({ error: 'No functional fitness workout found for this date' });
        }
        let parsed = null;
        try { parsed = JSON.parse(String(workout.content || '{}')); } catch (_) {}
        const firstSection = parsed?.subHeaders?.[0] || {};
        const splitPills = String(workout.focus_areas || '')
          .split(/•|\|/)
          .map(s => s.trim())
          .filter(Boolean)
          .slice(0, 3);
        return res.json({
          date,
          workout_title: parsed?.header || workout.title || '',
          carousel_pills: splitPills,
          workout_html: firstSection.body_html || (firstSection.body ? String(firstSection.body).replace(/\n/g, '<br>') : '')
        });
      } catch (error) {
        console.error('Get functional fitness workout by date error:', error);
        return res.status(500).json({ error: 'Failed to load workout' });
      }
    }
  );

  router.post('/admin/workouts/functional-fitness',
    authenticateToken,
    [
      body('date').matches(/^\d{4}-\d{2}-\d{2}$/).withMessage('Date must be YYYY-MM-DD'),
      body('workout_title').notEmpty().withMessage('Workout title is required'),
      body('carousel_pills').optional().isArray().withMessage('Carousel pills must be an array'),
      body('workout_html').optional().isString(),
      body('sections').optional().isArray().withMessage('Sections must be an array')
    ],
    async (req, res) => {
      try {
        const user = await db.getUserById(req.userId);
        if (!user || user.role !== 'admin') {
          return res.status(403).json({ error: 'Admin access required' });
        }
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }
        const { date, workout_title } = req.body;
        const workoutHtml = String(req.body.workout_html || '').trim();
        const sectionsInput = Array.isArray(req.body.sections) ? req.body.sections : null;
        const carouselPills = (Array.isArray(req.body.carousel_pills) ? req.body.carousel_pills : [])
          .map(s => String(s || '').trim())
          .filter(Boolean)
          .slice(0, 3);

        if (!sectionsInput && !workoutHtml) {
          return res.status(400).json({ error: 'Workout content is required' });
        }

        const subHeaders = sectionsInput
          ? sectionsInput.map((s) => {
              const subHeader = String(s.subheader || s.subHeader || '').trim();
              const bodyStr = String(s.body || '').trim();
              const bodyHtml = String(s.body_html || '').trim();
              const exercises = bodyStr
                .split('\n')
                .map(line => line.trim())
                .filter(line => line.length > 0)
                .map(name => ({ name }));
              return {
                subHeader,
                body: bodyStr,
                body_html: bodyHtml || undefined,
                exercises
              };
            }).filter(s => (s.body && s.body.trim().length > 0) || (s.exercises && s.exercises.length > 0) || (s.body_html && s.body_html.trim().length > 0))
          : [{
              subHeader: 'Workout',
              body: workoutHtml.replace(/<[^>]*>/g, '').replace(/\u00a0/g, ' ').trim(),
              body_html: workoutHtml,
              exercises: []
            }];

        if (!Array.isArray(subHeaders) || subHeaders.length === 0) {
          return res.status(400).json({ error: 'At least one workout section is required' });
        }

        const content = JSON.stringify({
          header: String(workout_title).trim(),
          subHeaders
        });
        const existingWorkout = await db.getWorkoutByDate(date);
        await db.createWorkout(
          date,
          FUNCTIONAL_FITNESS_FILE_ID,
          workout_title || 'Functional Fitness',
          content,
          'functional_fitness'
        );
        await db.setWorkoutFocusAreas(date, carouselPills.join(' • '));
        res.json({
          message: existingWorkout ? 'Functional fitness workout updated' : 'Functional fitness workout saved',
          updated: !!existingWorkout,
          date,
          carousel_pills: carouselPills
        });
      } catch (error) {
        console.error('Add functional fitness workout error:', error);
        res.status(500).json({ error: error.message || 'Failed to save workout' });
      }
    }
  );

  // Admin route: Get all workouts (for syncing)
  router.get('/admin/workouts/all',
    authenticateToken,
    async (req, res) => {
      try {
        // TODO: Add admin check
        const startDate = req.query.startDate || null;
        const endDate = req.query.endDate || null;

        let workouts;
        if (startDate && endDate) {
          workouts = await db.getWorkoutsByDateRange(startDate, endDate);
        } else {
          // Get all workouts
          workouts = await db.getAllWorkouts();
        }

        res.json({
          workouts: workouts.map(w => ({
            id: w.id,
            workout_date: w.workout_date,
            date: typeof w.workout_date === 'string' 
              ? w.workout_date.split('T')[0].split(' ')[0]
              : new Date(w.workout_date).toISOString().split('T')[0],
            file_id: w.file_id,
            title: w.title,
            content: w.content,
            created_at: w.created_at
          })),
          count: workouts.length
        });
      } catch (error) {
        console.error('Get all workouts error:', error);
        res.status(500).json({ error: 'Failed to get workouts' });
      }
    }
  );

  // Admin route: Bulk create/update workouts (for syncing from localhost)
  router.post('/admin/workouts/bulk',
    authenticateToken,
    [
      body('workouts').isArray().notEmpty(),
      body('workouts.*.date').matches(/^\d{4}-\d{2}-\d{2}$/),
      body('workouts.*.content').notEmpty()
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { workouts } = req.body;

        // Prepare workouts for database
        const workoutsToStore = workouts.map(w => ({
          date: w.date,
          fileId: w.fileId || w.file_id || 'synced-from-localhost',
          title: w.title || 'Workout',
          content: w.content,
          workoutType: w.workoutType || w.workout_type || 'regular' // Support workout_type field
        }));

        // Store all workouts in database (will update if they exist)
        const dbResult = await db.createWorkouts(workoutsToStore);

        res.json({
          message: 'Workouts synced successfully',
          summary: {
            total: dbResult.total,
            successful: dbResult.successful,
            failed: dbResult.failed,
            errors: dbResult.errors
          }
        });
      } catch (error) {
        console.error('Bulk sync workouts error:', error);
        res.status(500).json({ error: `Failed to sync workouts: ${error.message}` });
      }
    }
  );

  // Admin route: Sync ALL workouts from Google Slides (parse each slide)
  router.post('/admin/workouts/sync-all',
    authenticateToken,
    [
      body('fileId').notEmpty()
    ],
    async (req, res) => {
      try {
        const errors = validationResult(req);
        if (!errors.isEmpty()) {
          return res.status(400).json({ errors: errors.array() });
        }

        const { fileId } = req.body;

        // Sync all workouts from Google Slides
        const result = await syncAllWorkoutsFromSlides(fileId);

        // Prepare workouts for database (extract dates and filter out nulls)
        const workoutsToStore = result.workouts
          .filter(w => w.date !== null) // Only workouts with valid dates
          .map(w => ({
            date: w.date,
            fileId: result.fileId,
            title: result.title,
            content: w.content
          }));

        if (workoutsToStore.length === 0) {
          return res.status(400).json({
            error: 'No workouts with valid dates found',
            parsed: result.workouts.map(w => ({
              slideNumber: w.slideNumber,
              hasDate: w.date !== null,
              rawDate: w.rawDate,
              preview: w.content.substring(0, 100) + '...'
            }))
          });
        }

        // Store all workouts in database
        const dbResult = await db.createWorkouts(workoutsToStore);

        res.json({
          message: 'Workouts synced successfully',
          summary: {
            fileName: result.fileName,
            totalSlides: result.totalSlides,
            workoutsFound: result.workouts.length,
            workoutsWithDates: workoutsToStore.length,
            workoutsWithoutDates: result.workouts.length - workoutsToStore.length,
            databaseResult: dbResult
          },
          workouts: workoutsToStore.map(w => ({
            date: w.date,
            contentLength: w.content.length,
            preview: w.content.substring(0, 200) + (w.content.length > 200 ? '...' : '')
          }))
        });
      } catch (error) {
        console.error('Sync all workouts error:', error);
        res.status(500).json({ error: `Failed to sync workouts: ${error.message}` });
      }
    }
  );

  // Admin endpoint: Get equipment list
  router.get('/admin/equipment', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      // Return empty equipment list for now (can be extended later)
      res.json({ equipment: [] });
    } catch (error) {
      console.error('Get equipment error:', error);
      res.status(500).json({ error: 'Failed to get equipment list' });
    }
  });

  // Admin endpoint: Create/update equipment
  router.post('/admin/equipment', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      
      const { name } = req.body;
      if (!name) {
        return res.status(400).json({ error: 'Equipment name is required' });
      }
      
      // For now, return a mock equipment object with an ID
      // This can be extended later to store equipment in the database
      const equipment = {
        id: Date.now(), // Temporary ID
        name: name,
        created_at: new Date().toISOString()
      };
      
      res.json({ success: true, equipment });
    } catch (error) {
      console.error('Save equipment error:', error);
      res.status(500).json({ error: 'Failed to save equipment' });
    }
  });

  // Admin endpoint: Switch user (view as another user)
  router.post('/admin/switch-user', authenticateToken, async (req, res) => {
    try {
      // Check if user is admin
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const { targetUserId } = req.body;
      if (!targetUserId) {
        return res.status(400).json({ error: 'targetUserId is required' });
      }

      // Get target user
      const targetUser = await db.getUserById(targetUserId);
      if (!targetUser) {
        return res.status(404).json({ error: 'Target user not found' });
      }

      // Generate token for target user
      const { generateToken } = require('./auth');
      const targetToken = generateToken(targetUser.id);

      res.json({
        token: targetToken,
        user: {
          id: targetUser.id,
          email: targetUser.email,
          name: targetUser.name,
          role: targetUser.role
        },
        originalAdmin: {
          id: adminUser.id,
          email: adminUser.email,
          name: adminUser.name
        }
      });
    } catch (error) {
      console.error('Switch user error:', error);
      res.status(500).json({ error: 'Failed to switch user' });
    }
  });

  // Get payment history (app subscription only - exclude drop-in and gym; gym/drop-in appear in gym Payment History tab and admin)
  router.get('/payments/history', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;

      // Get payments from database (amount is stored in cents); exclude drop-in and gym membership
      const allPayments = await db.getPaymentsByUserId(userId);
      const payments = allPayments.filter((p) => {
        const tier = (p.tier || '').toLowerCase();
        return tier !== 'drop_in' && tier !== 'gym_membership' && tier !== 'gym_membership_late_fee';
      });

      // Enhance with Stripe refund information and normalize for client
      const enhancedPayments = await Promise.all(payments.map(async (payment) => {
        const paymentData = { ...payment };

        // Normalize amount: DB stores cents; API returns dollars for display
        const amountCents = Number(payment.amount) || 0;
        paymentData.amount = amountCents / 100;
        if (paymentData.refunded_amount != null) {
          paymentData.refunded_amount = Number(paymentData.refunded_amount) / 100;
        }
        // Frontend expects date and description
        paymentData.date = payment.created_at;
        paymentData.description = payment.tier ? String(payment.tier).replace(/_/g, ' ') : 'Subscription';

        // If payment has Stripe payment intent, check for refunds
        if (payment.stripe_payment_intent_id) {
          try {
            const paymentIntent = await stripe.paymentIntents.retrieve(
              payment.stripe_payment_intent_id,
              { expand: ['charges.data.refunds'] }
            );

            // Check if there are any refunds
            if (paymentIntent.charges && paymentIntent.charges.data.length > 0) {
              const charge = paymentIntent.charges.data[0];
              if (charge.refunds && charge.refunds.data.length > 0) {
                const refunds = charge.refunds.data;
                const totalRefundedCents = refunds.reduce((sum, refund) => sum + refund.amount, 0);
                paymentData.refunded = true;
                paymentData.refunded_amount = totalRefundedCents / 100;
                paymentData.refunded_date = new Date(refunds[0].created * 1000).toISOString();
              }
            }
          } catch (stripeError) {
            // If Stripe call fails, just return payment without refund info
            console.error('Error fetching refund info:', stripeError.message);
          }
        }

        return paymentData;
      }));

      res.json({ payments: enhancedPayments });
    } catch (error) {
      console.error('Get payment history error:', error);
      res.status(500).json({ error: 'Failed to get payment history' });
    }
  });

  // Admin endpoint: Run gym membership sync from Stripe to database
  router.post('/admin/gym-memberships/sync', authenticateToken, async (req, res) => {
    try {
      if (!req.userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const result = await syncAllGymMemberships(db);
      res.json({ success: true, ...result });
    } catch (error) {
      console.error('Admin gym membership sync error:', error);
      res.status(500).json({ error: 'Sync failed: ' + error.message });
    }
  });

  // Admin: Add member (migration from old system)
  router.post('/admin/add-member', authenticateToken, async (req, res) => {
    try {
      if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

      const rules = require('./membership-rules.json');
      const b = req.body;
      const primaryEmail = (b.primary_email || b.primary?.email || '').trim().toLowerCase();
      if (!primaryEmail) return res.status(400).json({ error: 'Primary email is required' });

      const membershipTypeRaw = b.membership_type || b.primary?.membership_type;
      const membershipType = membershipTypeRaw ? membershipTypeToDb(membershipTypeRaw) || membershipTypeRaw : null;
      if (!membershipType) return res.status(400).json({ error: 'Membership type is required' });

      const jsonType = membershipTypeRaw && membershipTypeRaw.toUpperCase().replace(/ /g, '_');
      const typeKey = Object.keys(rules.membershipTypes || {}).find(k => membershipTypeToDb(k) === membershipType) || jsonType || 'STANDARD';
      const basePriceCents = ((rules.membershipTypes || {})[typeKey]?.basePrice ?? 65) * 100;

      const d1 = Math.abs(parseInt(b.discount_1_cents, 10) || 0);
      const d2 = Math.abs(parseInt(b.discount_2_cents, 10) || 0);
      const d3 = Math.abs(parseInt(b.discount_3_cents, 10) || 0);
      const monthlyAmountCents = Math.max(0, basePriceCents - d1 - d2 - d3);

      const membershipStartDate = b.membership_start_date || b.start_date;
      if (!membershipStartDate) return res.status(400).json({ error: 'Membership start date is required' });

      let primaryUser = await db.getUserByEmail(primaryEmail);
      if (!primaryUser) {
        const crypto = require('crypto');
        const randomPassword = crypto.randomBytes(16).toString('hex');
        primaryUser = await db.createUser(primaryEmail, randomPassword, [b.primary_first_name, b.primary_last_name].filter(Boolean).join(' ') || null);
      }

      let discountGroupId = null;
      let groupId = null;
      let groupName = null;
      if (b.create_new_group && (b.group_name || '').trim()) {
        const group = await db.createDiscountGroup(primaryUser.id, (b.group_name || '').trim());
        discountGroupId = group.id;
        groupId = group.group_id;
        groupName = group.group_name || (b.group_name || '').trim();
      } else if ((b.existing_group_id || b.group_id || '').trim()) {
        const gid = (b.existing_group_id || b.group_id || '').trim();
        const group = await db.getDiscountGroupByGroupId(gid);
        if (group) discountGroupId = group.id;
        groupId = gid;
      }

      // Ensure every household email has a users row (immediate family uses billed_with_primary: true
      // from the form; they were previously skipped and never appeared in /admin/users or migration confirm).
      const householdList = Array.isArray(b.household_members) ? b.household_members : [];
      const crypto = require('crypto');
      for (const h of householdList) {
        const email = (h.email || '').trim().toLowerCase();
        if (!email || email === primaryEmail) continue;
        if (!(await db.getUserByEmail(email))) {
          await db.createUser(email, crypto.randomBytes(16).toString('hex'), (h.name || '').trim() || null);
        }
      }

      const existingPending = await db.getPendingMigrationByEmail(primaryEmail);
      if (existingPending) return res.status(400).json({ error: 'A pending migration already exists for this email. Confirm or remove it first.' });

      const migrationId = await db.insertAdminAddedMember({
        primary_email: primaryEmail,
        primary_first_name: (b.primary_first_name || b.primary?.first_name || '').trim() || null,
        primary_last_name: (b.primary_last_name || b.primary?.last_name || '').trim() || null,
        primary_phone: (b.primary_phone || b.primary?.phone || '').trim() || null,
        address_street: (b.address_street || b.address?.street || '').trim() || null,
        address_city: (b.address_city || b.address?.city || '').trim() || null,
        address_state: (b.address_state || b.address?.state || '').trim() || null,
        address_zip: (b.address_zip || b.address?.zip || '').trim() || null,
        membership_type: membershipType,
        membership_start_date: membershipStartDate,
        discount_1_cents: d1 || null,
        discount_2_cents: d2 || null,
        discount_3_cents: d3 || null,
        discount_1_name: (b.discount_1_name || '').trim() || null,
        discount_2_name: (b.discount_2_name || '').trim() || null,
        discount_3_name: (b.discount_3_name || '').trim() || null,
        monthly_amount_cents: monthlyAmountCents,
        group_id: groupId,
        group_name: groupName,
        discount_group_id: discountGroupId,
        household_members: householdList,
        created_by_admin_id: adminUser.id
      });

      res.status(201).json({
        success: true,
        migration_id: migrationId,
        message: 'Member added. They can log in with this email (Google or register) to confirm and add payment.',
        group_id: groupId || undefined,
        group_access_code: (b.create_new_group && groupId) ? (await db.getDiscountGroupByGroupId(groupId))?.group_access_code : undefined
      });
    } catch (error) {
      console.error('Admin add-member error:', error);
      res.status(500).json({ error: error.message || 'Failed to add member' });
    }
  });

  // Admin: List added members (e.g. to look up emails by name)
  router.get('/admin/added-members', authenticateToken, async (req, res) => {
    try {
      if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });
      const first = (req.query.first_name || req.query.first || '').trim();
      const last = (req.query.last_name || req.query.last || '').trim();
      const limit = Math.min(parseInt(req.query.limit, 10) || 50, 200);
      const list = await db.listAdminAddedMembers({ first_name: first || undefined, last_name: last || undefined, limit });
      res.json({ added_members: list });
    } catch (error) {
      console.error('Admin added-members list error:', error);
      res.status(500).json({ error: error.message || 'Failed to list added members' });
    }
  });

  // Admin: set discount_name (and optional monthly amount) for a gym membership by user email (uses DB credentials in container)
  router.post('/admin/gym-memberships/set-discount-name', authenticateToken, async (req, res) => {
    try {
      if (!req.userId) return res.status(401).json({ error: 'Authentication required' });
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') return res.status(403).json({ error: 'Admin access required' });

      const email = (req.body.email || '').trim().toLowerCase();
      const discountName = (req.body.discount_name || '').trim();
      const amountDollars = req.body.monthly_amount_dollars != null ? parseFloat(req.body.monthly_amount_dollars, 10) : null;
      if (!email || !discountName) {
        return res.status(400).json({ error: 'email and discount_name are required' });
      }
      const amountCents = (amountDollars != null && !isNaN(amountDollars) && amountDollars >= 0)
        ? Math.round(amountDollars * 100) : null;

      const user = await db.getUserByEmail(email);
      if (!user) return res.status(404).json({ error: 'User not found for that email' });

      if (db.isPostgres) {
        const updates = amountCents != null
          ? ['discount_name = $1', 'monthly_amount_cents = $3']
          : ['discount_name = $1'];
        const values = amountCents != null
          ? [discountName, user.id, amountCents]
          : [discountName, user.id];
        const result = await db.query(
          `UPDATE gym_memberships SET ${updates.join(', ')}
           WHERE user_id = $2 AND id = (
             SELECT id FROM gym_memberships WHERE user_id = $2 ORDER BY created_at DESC LIMIT 1
           )
           RETURNING id, user_id, discount_name, monthly_amount_cents`,
          values
        );
        if (!result.rows || result.rows.length === 0) {
          return res.status(404).json({ error: 'No gym membership found for that user' });
        }
        const row = result.rows[0];
        return res.json({
          success: true,
          email,
          discount_name: discountName,
          ...(amountCents != null && { monthly_amount_cents: row.monthly_amount_cents })
        });
      } else {
        const result = await db.query(
          amountCents != null
            ? `UPDATE gym_memberships SET discount_name = ?, monthly_amount_cents = ?
               WHERE user_id = ? AND id = (SELECT id FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1)`
            : `UPDATE gym_memberships SET discount_name = ?
               WHERE user_id = ? AND id = (SELECT id FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1)`,
          amountCents != null ? [discountName, amountCents, user.id, user.id] : [discountName, user.id, user.id]
        );
        if (result.changes === 0) {
          return res.status(404).json({ error: 'No gym membership found for that user' });
        }
        return res.json({
          success: true,
          email,
          discount_name: discountName,
          ...(amountCents != null && { monthly_amount_cents: amountCents })
        });
      }
    } catch (err) {
      console.error('Set discount name error:', err);
      return res.status(500).json({ error: err.message || 'Failed to set discount name' });
    }
  });

  // Admin endpoint: Fix Jake Fotu's contract dates
  // Updates contract_start_date and contract_end_date to correct values
  router.post('/admin/gym-memberships/fix-jake-contract-dates', authenticateToken, async (req, res) => {
    try {
      // Check if user is authenticated (authenticateToken sets req.userId)
      if (!req.userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      // Check if user is admin
      const user = await db.getUserById(req.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const CUSTOMER_ID = 'cus_Tn4vCyVuETJUTe';
      
      console.log('🔧 Fixing Jake Fotu\'s contract dates via admin endpoint...');
      
      // Find user in database
      const dbUser = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM users WHERE stripe_customer_id = $1'
          : 'SELECT * FROM users WHERE stripe_customer_id = ?',
        [CUSTOMER_ID]
      );
      
      if (!dbUser) {
        return res.status(404).json({ error: 'User not found in database with this Stripe customer ID' });
      }
      
      // Get gym membership record
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ?',
        [dbUser.id]
      );
      
      if (!membership) {
        return res.status(404).json({ error: 'Gym membership record not found' });
      }
      
      console.log('Current dates:', {
        contract_start_date: membership.contract_start_date,
        contract_end_date: membership.contract_end_date
      });
      
      // Set correct dates
      // Payment was on Jan 14, 2026
      // Billing period is 30 days (monthly)
      const contractStartDate = '2026-01-14';
      const contractEndDate = '2026-02-13'; // 30 days later
      
      // Update membership with correct dates
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET contract_start_date = $1, contract_end_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3'
          : 'UPDATE gym_memberships SET contract_start_date = ?, contract_end_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [contractStartDate, contractEndDate, membership.id]
      );
      
      console.log('✅ Contract dates updated successfully');
      
      // Verify update
      const updatedMembership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE id = $1'
          : 'SELECT * FROM gym_memberships WHERE id = ?',
        [membership.id]
      );
      
      res.json({
        success: true,
        message: 'Jake Fotu\'s contract dates have been fixed',
        membershipId: membership.id,
        oldDates: {
          contract_start_date: membership.contract_start_date,
          contract_end_date: membership.contract_end_date
        },
        newDates: {
          contract_start_date: updatedMembership.contract_start_date,
          contract_end_date: updatedMembership.contract_end_date
        }
      });
    } catch (error) {
      console.error('Error fixing Jake contract dates:', error);
      res.status(500).json({ 
        error: 'Failed to fix contract dates: ' + error.message,
        details: error.stack
      });
    }
  });

  /**
   * Admin: re-anchor gym contract_start_date / contract_end_date from the earliest succeeded
   * Stripe PaymentIntent (metadata.type=gym_membership), or from optional startDate (YYYY-MM-DD).
   * Use for members whose dates were set before the signup-date fix (e.g. first-attempt vs first-paid).
   *
   * Body: { email, startDate?: "YYYY-MM-DD", dryRun?: boolean }
   */
  router.post('/admin/gym-memberships/reanchor-contract-from-stripe', authenticateToken, async (req, res) => {
    try {
      const admin = await db.getUserById(req.userId);
      if (!admin || admin.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { email, startDate, dryRun } = req.body || {};
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'email is required' });
      }
      const manualStartYmd =
        startDate && /^\d{4}-\d{2}-\d{2}$/.test(String(startDate).trim()) ? String(startDate).trim() : null;
      const result = await reanchorGymContractForEmail(stripe, db, email.trim(), {
        manualStartYmd,
        dryRun: !!dryRun
      });
      const status = result.ok ? 200 : 400;
      return res.status(status).json(result);
    } catch (error) {
      console.error('reanchor-contract-from-stripe:', error);
      return res.status(500).json({ error: error.message || 'Failed to re-anchor contract' });
    }
  });

  // Admin endpoint: Fix Jake Fotu's gym membership
  // Creates subscription for customer who was charged but subscription wasn't created
  router.post('/admin/gym-memberships/fix-jake-fotu', authenticateToken, async (req, res) => {
    try {
      // Check if user is authenticated (authenticateToken sets req.userId)
      if (!req.userId) {
        return res.status(401).json({ error: 'Authentication required' });
      }
      
      // Check if user is admin
      const user = await db.getUserById(req.userId);
      if (!user) {
        return res.status(404).json({ error: 'User not found' });
      }
      if (user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }

      const CUSTOMER_ID = 'cus_Tn4vCyVuETJUTe';
      
      console.log('🔧 Fixing Jake Fotu\'s gym membership via admin endpoint...');
      
      // Step 1: Get customer from Stripe
      const customer = await stripe.customers.retrieve(CUSTOMER_ID);
      console.log(`✅ Customer found: ${customer.email || 'No email'}`);
      
      // Step 2: Find user in database
      const dbUser = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM users WHERE stripe_customer_id = $1'
          : 'SELECT * FROM users WHERE stripe_customer_id = ?',
        [CUSTOMER_ID]
      );
      
      if (!dbUser) {
        return res.status(404).json({ error: 'User not found in database with this Stripe customer ID' });
      }
      
      // Step 3: Get gym membership record
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ?',
        [dbUser.id]
      );
      
      if (!membership) {
        return res.status(404).json({ error: 'Gym membership record not found' });
      }
      
      // Step 4: Check if subscription already exists
      if (membership.stripe_subscription_id) {
        try {
          const existingSub = await stripe.subscriptions.retrieve(membership.stripe_subscription_id);
          return res.json({
            success: true,
            message: 'Subscription already exists',
            subscriptionId: existingSub.id,
            status: existingSub.status
          });
        } catch (error) {
          if (error.code !== 'resource_missing') {
            throw error;
          }
        }
      }
      
      // Step 5: Get payment methods
      const paymentMethods = await stripe.paymentMethods.list({
        customer: CUSTOMER_ID,
        type: 'card'
      });
      
      if (paymentMethods.data.length === 0) {
        return res.status(400).json({ error: 'No payment methods found for customer' });
      }
      
      const defaultPaymentMethod = paymentMethods.data.find(pm => pm.id === customer.invoice_settings?.default_payment_method) 
        || paymentMethods.data[0];
      
      // Step 6: Determine price
      const membershipTypeToPrice = {
        'standard': 6500,
        'immediate_family_member': 5000,
        'expecting_or_recovering_mother': 3000,
        'entire_family': 18500
      };
      
      const amount = membershipTypeToPrice[membership.membership_type] || 6500;
      
      // Step 7: Find or create price
      let priceId = null;
      const prices = await stripe.prices.list({
        active: true,
        limit: 100
      });
      
      const existingPrice = prices.data.find(p => 
        p.metadata.membership_type === membership.membership_type && 
        p.unit_amount === amount &&
        p.recurring?.interval === 'month'
      );
      
      if (existingPrice) {
        priceId = existingPrice.id;
      } else {
        const productName = {
          'standard': 'Standard Gym Membership',
          'immediate_family_member': 'Immediate Family Gym Membership',
          'expecting_or_recovering_mother': 'Expecting/Recovering Mother Gym Membership',
          'entire_family': 'Full Family Gym Membership'
        }[membership.membership_type] || 'Gym Membership';
        
        const price = await stripe.prices.create({
          unit_amount: amount,
          currency: 'usd',
          recurring: {
            interval: 'month'
          },
          product_data: {
            name: productName
          },
          metadata: {
            membership_type: membership.membership_type,
            type: 'gym_membership'
          }
        });
        priceId = price.id;
      }
      
      // Step 8: Calculate billing cycle anchor (30 days from today)
      const today = new Date();
      const billingCycleAnchor = new Date(today);
      billingCycleAnchor.setDate(billingCycleAnchor.getDate() + 30);
      billingCycleAnchor.setHours(0, 0, 0, 0);
      const billingCycleAnchorUnix = Math.floor(billingCycleAnchor.getTime() / 1000);
      
      // Step 9: Create subscription
      const subscription = await stripe.subscriptions.create({
        customer: CUSTOMER_ID,
        items: [{ price: priceId }],
        default_payment_method: defaultPaymentMethod.id,
        billing_cycle_anchor: billingCycleAnchorUnix,
        proration_behavior: 'none',
        metadata: {
          userId: dbUser.id.toString(),
          membershipId: membership.id.toString(),
          membershipType: membership.membership_type,
          type: 'gym_membership',
          created_manually: 'true',
          reason: 'fix_missing_subscription'
        },
        expand: ['latest_invoice.payment_intent']
      });
      
      // Step 10: Update database
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET stripe_subscription_id = $1, stripe_subscription_item_id = $2, billing_period = $3, updated_at = CURRENT_TIMESTAMP WHERE id = $4'
          : 'UPDATE gym_memberships SET stripe_subscription_id = ?, stripe_subscription_item_id = ?, billing_period = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [
          subscription.id,
          subscription.items.data[0].id,
          'monthly',
          membership.id
        ]
      );
      
      console.log(`✅ Subscription created: ${subscription.id}`);
      
      res.json({
        success: true,
        message: 'Jake Fotu\'s gym membership has been fixed',
        subscriptionId: subscription.id,
        customerId: CUSTOMER_ID,
        nextBillingDate: billingCycleAnchor.toISOString().split('T')[0],
        membershipType: membership.membership_type,
        monthlyPrice: amount / 100
      });
    } catch (error) {
      console.error('Error fixing Jake Fotu membership:', error);
      res.status(500).json({ 
        error: 'Failed to fix membership: ' + error.message,
        details: error.stack
      });
    }
  });

  // Admin: charge a gym member's saved payment method (e.g. after Stripe API outage)
  // Body: { email: "user@example.com" } or { membershipId: 123 }
  router.post('/admin/gym-memberships/charge-now', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { email, membershipId } = req.body || {};
      let membership;
      if (membershipId) {
        membership = await db.queryOne(
          db.isPostgres ? 'SELECT * FROM gym_memberships WHERE id = $1' : 'SELECT * FROM gym_memberships WHERE id = ?',
          [membershipId]
        );
      } else if (email && String(email).trim()) {
        const targetUser = await db.getUserByEmail(String(email).trim());
        if (!targetUser) {
          return res.status(404).json({ error: 'User not found with that email' });
        }
        membership = await db.queryOne(
          db.isPostgres
            ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
            : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [targetUser.id]
        );
      } else {
        return res.status(400).json({ error: 'Provide email or membershipId in request body' });
      }
      if (!membership) {
        return res.status(404).json({ error: 'No gym membership found' });
      }
      const paymentMethodId = membership.payment_method_id;
      const stripeCustomerId = membership.stripe_customer_id;
      if (!paymentMethodId) {
        return res.status(400).json({
          error: 'No payment method saved for this membership. The member can add a card in the app and use Pay Now, or update default in Stripe.'
        });
      }
      if (!stripeCustomerId) {
        return res.status(400).json({ error: 'No Stripe customer ID on membership' });
      }
      const GYM_PRICING = { standard: 6500, immediate_family_member: 5000, expecting_or_recovering_mother: 3000, entire_family: 18500 };
      const amountCents = (membership.monthly_amount_cents != null && membership.monthly_amount_cents > 0)
        ? membership.monthly_amount_cents
        : (GYM_PRICING[membership.membership_type] || 6500);

      const paymentIntent = await stripe.paymentIntents.create({
        amount: amountCents,
        currency: 'usd',
        customer: stripeCustomerId,
        payment_method: paymentMethodId,
        off_session: true,
        confirm: true,
        metadata: {
          membership_id: membership.id.toString(),
          user_id: membership.user_id.toString(),
          membership_type: membership.membership_type || 'standard',
          type: 'gym_membership_renewal',
          renewal_date: new Date().toISOString(),
          admin_charge: 'true'
        }
      });

      if (paymentIntent.status !== 'succeeded') {
        return res.status(502).json({
          error: 'Charge did not succeed',
          status: paymentIntent.status
        });
      }

      const currentEndStr = membership.contract_end_date ? String(membership.contract_end_date).trim().split('T')[0] : null;
      const currentEndDate = currentEndStr && /^\d{4}-\d{2}-\d{2}$/.test(currentEndStr) ? new Date(currentEndStr + 'T00:00:00Z') : new Date();
      const newEndDate = new Date(currentEndDate);
      newEndDate.setUTCMonth(newEndDate.getUTCMonth() + 1);
      const newEndStr = newEndDate.toISOString().split('T')[0];

      if (membership.family_group_id && membership.is_primary_member) {
        await db.query(
          db.isPostgres
            ? 'UPDATE gym_memberships SET contract_end_date = $1, status = \'active\', updated_at = CURRENT_TIMESTAMP WHERE family_group_id = $2'
            : 'UPDATE gym_memberships SET contract_end_date = ?, status = \'active\', updated_at = datetime(\'now\') WHERE family_group_id = ?',
          [newEndStr, membership.family_group_id]
        );
      } else {
        await db.query(
          db.isPostgres
            ? 'UPDATE gym_memberships SET contract_end_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
            : 'UPDATE gym_memberships SET contract_end_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [newEndStr, membership.id]
        );
      }
      await db.resetGymMembershipPaymentFailures(membership.id);

      const memberUser = await db.getUserById(membership.user_id);
      const userEmail = memberUser?.email || null;
      await db.createPayment(membership.user_id, paymentIntent.id, amountCents, 'usd', 'gym_membership', 'succeeded', userEmail);

      return res.json({
        success: true,
        message: 'Charge successful',
        paymentIntentId: paymentIntent.id,
        amount: amountCents / 100,
        currency: 'usd',
        newContractEndDate: newEndStr
      });
    } catch (err) {
      console.error('Admin charge-now error:', err);
      const message = err.type === 'StripeCardError' ? (err.message || 'Card declined') : (err.message || 'Charge failed');
      res.status(500).json({ error: message });
    }
  });

  // Admin: reset migration view and latest app subscription for a user (e.g. first login today)
  router.post('/admin/migration/reset-member', authenticateToken, async (req, res) => {
    try {
      const adminUser = await db.getUserById(req.userId);
      if (!adminUser || adminUser.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { email } = req.body || {};
      if (!email || typeof email !== 'string') {
        return res.status(400).json({ error: 'email is required' });
      }
      const normalized = email.trim().toLowerCase();
      const targetUser = await db.getUserByEmail(normalized);
      if (!targetUser) {
        return res.status(404).json({ error: 'User not found' });
      }

      // Reset admin_added_members status so /pending-migration shows the card again
      const aamAny = await db.getAdminAddedMemberByEmailAnyStatus(normalized);
      if (aamAny && aamAny.id) {
        await db.setAdminAddedMemberPending(aamAny.id);
      }

      // Remove gym_memberships for this user that came from migration so we can recreate cleanly
      await db.query(
        db.isPostgres
          ? 'DELETE FROM gym_memberships WHERE user_id = $1'
          : 'DELETE FROM gym_memberships WHERE user_id = ?',
        [targetUser.id]
      );

      // Reset latest app subscription to active for a fresh start (so it doesn't show expired on first login)
      const subChanges = await db.resetLatestSubscriptionToActiveForUser(targetUser.id, 30);

      res.json({
        success: true,
        message: 'Member migration view and latest subscription have been reset',
        userId: targetUser.id,
        subscriptionUpdated: !!subChanges
      });
    } catch (err) {
      console.error('Admin migration reset-member error:', err);
      res.status(500).json({ error: err.message || 'Reset failed' });
    }
  });

  // Admin: recover payment method from last successful subscription invoice (e.g. after webhook failed)
  // Body: { email: "user@example.com" } or { membershipId: 123 }
  router.post('/admin/gym-memberships/recover-payment-method', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || user.role !== 'admin') {
        return res.status(403).json({ error: 'Admin access required' });
      }
      const { email, membershipId } = req.body || {};
      let membership;
      if (membershipId) {
        membership = await db.queryOne(
          db.isPostgres ? 'SELECT * FROM gym_memberships WHERE id = $1' : 'SELECT * FROM gym_memberships WHERE id = ?',
          [membershipId]
        );
      } else if (email && String(email).trim()) {
        const targetUser = await db.getUserByEmail(String(email).trim());
        if (!targetUser) {
          return res.status(404).json({ error: 'User not found with that email' });
        }
        membership = await db.queryOne(
          db.isPostgres
            ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
            : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [targetUser.id]
        );
      } else {
        return res.status(400).json({ error: 'Provide email or membershipId in request body' });
      }
      if (!membership) {
        return res.status(404).json({ error: 'No gym membership found' });
      }
      const stripeCustomerId = membership.stripe_customer_id;
      const subscriptionId = membership.stripe_subscription_id;
      if (!stripeCustomerId) {
        return res.status(400).json({ error: 'Membership has no Stripe customer ID' });
      }
      // Get last paid invoice (subscription or customer)
      let invoices;
      if (subscriptionId) {
        invoices = await stripe.invoices.list({
          subscription: subscriptionId,
          status: 'paid',
          limit: 1
        });
      }
      if (!invoices || invoices.data.length === 0) {
        invoices = await stripe.invoices.list({
          customer: stripeCustomerId,
          status: 'paid',
          limit: 5
        });
      }
      if (!invoices || invoices.data.length === 0) {
        return res.status(404).json({ error: 'No paid invoices found for this customer' });
      }
      const lastInvoice = invoices.data[0];
      const piId = lastInvoice.payment_intent;
      if (!piId) {
        return res.status(400).json({ error: 'Last paid invoice has no payment_intent' });
      }
      const paymentIntent = await stripe.paymentIntents.retrieve(typeof piId === 'string' ? piId : piId.id);
      const paymentMethodId = paymentIntent.payment_method;
      if (!paymentMethodId) {
        return res.status(400).json({ error: 'PaymentIntent has no payment_method (cannot recover)' });
      }
      const pmId = typeof paymentMethodId === 'string' ? paymentMethodId : paymentMethodId.id;
      // Attach and set default (idempotent: attach may already be attached)
      try {
        await stripe.paymentMethods.attach(pmId, { customer: stripeCustomerId });
      } catch (attachErr) {
        if (attachErr.code !== 'resource_already_exists' && attachErr.code !== 'payment_method_already_attached') {
          return res.status(502).json({ error: 'Failed to attach payment method: ' + attachErr.message });
        }
      }
      await stripe.customers.update(stripeCustomerId, {
        invoice_settings: { default_payment_method: pmId }
      });
      if (subscriptionId) {
        try {
          await stripe.subscriptions.update(subscriptionId, { default_payment_method: pmId });
        } catch (e) {
          console.warn('Could not set subscription default_payment_method:', e.message);
        }
      }
      let paymentMethodExpiresAt = null;
      try {
        const pm = await stripe.paymentMethods.retrieve(pmId);
        if (pm.card && pm.card.exp_year && pm.card.exp_month) {
          paymentMethodExpiresAt = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59, 59).toISOString();
        }
      } catch (e) {}
      await db.updateGymMembershipPaymentMethod(membership.id, pmId, paymentMethodExpiresAt);
      return res.json({
        success: true,
        message: 'Payment method recovered from last paid invoice and set as default',
        paymentMethodId: pmId,
        invoiceId: lastInvoice.id
      });
    } catch (err) {
      console.error('Admin recover-payment-method error:', err);
      res.status(500).json({ error: err.message || 'Recovery failed' });
    }
  });

  // Helper function to extract workout title from content
  function extractWorkoutTitle(content) {
    if (!content) return null;
    
    // Split by newlines and get first few lines
    const lines = content.split('\n').filter(line => line.trim().length > 0);
    
    // Look for common workout title patterns
    // Usually the workout name is on one of the first few lines after the date
    for (let i = 0; i < Math.min(5, lines.length); i++) {
      const line = lines[i].trim();
      
      // Skip date lines
      if (line.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/gi)) {
        continue;
      }
      if (line.match(/\d{1,2}\/\d{1,2}\/\d{4}/g)) {
        continue;
      }
      if (line.match(/\d{4}-\d{2}-\d{2}/g)) {
        continue;
      }
      
      // Look for workout type patterns (e.g., "Lower Body Hypertrophy", "Upper Body", etc.)
      if (line.length > 5 && line.length < 100 && 
          (line.includes('Body') || line.includes('Day') || line.includes('Workout') || 
           line.includes('Hypertrophy') || line.includes('Strength') || line.includes('Conditioning') ||
           line.includes('Mobility') || line.includes('Cardio'))) {
        return line;
      }
      
      // If first non-date line is short and looks like a title, use it
      if (line.length > 0 && line.length < 80 && i < 3) {
        return line;
      }
    }
    
    return null;
  }

  // Helper function to determine required tier for a date
  function getRequiredTier(date) {
    const workoutDate = new Date(date);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    workoutDate.setHours(0, 0, 0, 0);

    if (workoutDate.getTime() === today.getTime()) {
      return 'daily';
    }

    const daysDiff = Math.floor((today - workoutDate) / (1000 * 60 * 60 * 24));
    if (daysDiff <= 7) {
      return 'weekly';
    }

    return 'monthly';
  }

  // ========== Gym Membership Routes ==========

  // Free trial signup (public; no auth)
  router.post('/free-trial/signup', async (req, res) => {
    try {
      const { firstName, lastName, email, phone, howHeard, question, waiverAccepted } = req.body || {};
      const f = (s) => (s != null && typeof s === 'string') ? s.trim() : '';
      const first = f(firstName);
      const last = f(lastName);
      const em = f(email);
      if (!first || !last || !em) {
        return res.status(400).json({ error: 'First name, last name, and email are required.' });
      }
      if (!waiverAccepted) {
        return res.status(400).json({ error: 'You must accept the waiver to sign up for the free trial.' });
      }
      const existing = await db.getFreeTrialByEmailOrPhone(em, phone ? f(phone) : null);
      if (existing) {
        const toYmd = (v) => {
          if (v == null) return null;
          if (typeof v === 'string') return v.trim().split('T')[0].split(' ')[0];
          if (v instanceof Date) return v.toISOString().slice(0, 10);
          return String(v).slice(0, 10);
        };
        const startDate = toYmd(existing.start_date);
        const endDate = toYmd(existing.end_date);
        return res.status(400).json({
          code: 'free_trial_duplicate',
          error:
            'A free trial has already been submitted for this email or phone number. You can only sign up once.',
          existingTrial: startDate && endDate ? { startDate, endDate } : null
        });
      }
      const created = await db.createFreeTrial(
        first,
        last,
        em,
        phone ? f(phone) : null,
        howHeard ? f(howHeard) : null,
        question ? f(question) : null
      );
      if (!created) {
        return res.status(500).json({ error: 'Failed to create free trial.' });
      }
      res.status(200).json({
        startDate: created.start_date,
        endDate: created.end_date
      });
    } catch (error) {
      console.error('Free trial signup error:', error);
      res.status(500).json({ error: 'Failed to sign up for free trial.' });
    }
  });

  // Get pending migration for current user (by email) - for confirm-and-pay flow
  router.get('/gym-memberships/pending-migration', authenticateToken, async (req, res) => {
    try {
      const user = await db.getUserById(req.userId);
      if (!user || !user.email) return res.status(200).json({ pending: null });
      const pending = await db.getPendingMigrationByEmail(user.email);
      if (!pending) return res.status(200).json({ pending: null });
      res.json({ pending });
    } catch (error) {
      console.error('Pending migration fetch error:', error);
      res.status(500).json({ error: 'Failed to check pending migration' });
    }
  });

  // Request pause of gym membership (takes effect at next billing cycle)
  router.post('/gym-memberships/request-pause', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (!membership) return res.status(404).json({ error: 'No gym membership found' });
      if (membership.status !== 'active') {
        return res.status(400).json({ error: 'Membership must be active to request a pause' });
      }
      const pausesUsed = membership.pauses_used_this_contract ?? 0;
      if (pausesUsed >= 1) {
        return res.status(400).json({ error: 'You have already used your one pause for this 12-month period' });
      }
      if (membership.pause_resume_scheduled) {
        return res.status(400).json({ error: 'You have already requested a pause for your next billing cycle' });
      }
      // Store intent: pause_resume_scheduled = true means "pause requested for next billing cycle"
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET pause_resume_scheduled = true, updated_at = CURRENT_TIMESTAMP WHERE id = $1'
          : 'UPDATE gym_memberships SET pause_resume_scheduled = 1, updated_at = datetime(\'now\') WHERE id = ?',
        [membership.id]
      );
      res.json({
        success: true,
        message: 'Your pause has been scheduled. It will take effect at your next billing date. You will not be charged for the skipped cycle.'
      });
    } catch (error) {
      console.error('Request pause error:', error);
      res.status(500).json({ error: error.message || 'Failed to request pause' });
    }
  });

  // Request switch from expecting/recovering mother membership to standard on next billing cycle
  router.post('/gym-memberships/request-standard-membership-switch', authenticateToken, async (req, res) => {
    try {
      const toYmd = (v) => {
        if (!v) return null;
        if (typeof v === 'string') {
          const s = v.trim().split('T')[0].split(' ')[0];
          if (/^\d{4}-\d{2}-\d{2}$/.test(s)) return s;
        }
        const d = new Date(v);
        if (isNaN(d.getTime())) return null;
        return d.toISOString().slice(0, 10);
      };
      const userId = req.userId;
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (!membership) return res.status(404).json({ error: 'No gym membership found' });
      if (String(membership.membership_type || '').toLowerCase() !== 'expecting_or_recovering_mother') {
        return res.status(400).json({ error: 'This option is only available for expecting/recovering mother memberships' });
      }
      if (String(membership.status || '').toLowerCase() !== 'active') {
        return res.status(400).json({ error: 'Membership must be active to request this change' });
      }

      const effectiveOn = toYmd(membership.contract_end_date) || toYmd(new Date(Date.now() + 30 * 24 * 60 * 60 * 1000));
      if (!effectiveOn) {
        return res.status(400).json({ error: 'Could not determine next billing date for this change' });
      }

      if (db.isPostgres) {
        await db.query(
          `INSERT INTO membership_change_requests (user_id, requested_membership_type, effective_on, status, updated_at)
           VALUES ($1, 'standard', $2, 'pending', CURRENT_TIMESTAMP)
           ON CONFLICT (user_id)
           DO UPDATE SET requested_membership_type = EXCLUDED.requested_membership_type,
                         effective_on = EXCLUDED.effective_on,
                         status = 'pending',
                         updated_at = CURRENT_TIMESTAMP`,
          [userId, effectiveOn]
        );
      } else {
        await db.query(
          `INSERT INTO membership_change_requests (user_id, requested_membership_type, effective_on, status, updated_at)
           VALUES (?, 'standard', ?, 'pending', datetime('now'))
           ON CONFLICT(user_id)
           DO UPDATE SET requested_membership_type = excluded.requested_membership_type,
                         effective_on = excluded.effective_on,
                         status = 'pending',
                         updated_at = datetime('now')`,
          [userId, effectiveOn]
        );
      }

      res.json({
        success: true,
        message: 'Your request has been submitted. The change to standard membership will be applied at your next billing cycle.',
        effective_on: effectiveOn
      });
    } catch (error) {
      console.error('Request standard membership switch error:', error);
      res.status(500).json({ error: error.message || 'Failed to request membership change' });
    }
  });

  // Confirm migration and create gym membership(s) from admin-added data
  router.post('/gym-memberships/confirm-migration', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const user = await db.getUserById(userId);
      if (!user || !user.email) return res.status(401).json({ error: 'User not found' });
      const pending = await db.getPendingMigrationByEmail(user.email);
      if (!pending) return res.status(404).json({ error: 'No pending migration found for your email' });
      const b = req.body || {};
      const contractAck =
        b.contract_terms_acknowledged === true ||
        b.contract_terms_acknowledged === 'true' ||
        b.contract_terms_acknowledged === 1;
      if (!contractAck) {
        return res.status(400).json({
          error: 'You must read and acknowledge the membership contract before continuing.'
        });
      }
      const profileIn = b.profile || {};
      const addressIn = b.address || {};
      const emergencyIn = b.emergencyContact || {};
      const pendingType = String(pending.membership_type || '').toLowerCase();
      const isImmediateFamilyDependent = pendingType === 'immediate_family_member';
      if (isImmediateFamilyDependent) {
        const normalizedPhone = gymProfileSchema.normalizePhone(profileIn.phone || pending.primary_phone || '');
        if (!normalizedPhone) {
          return res.status(400).json({
            error: 'Invalid profile fields',
            invalidFields: ['Phone must be a valid 10-digit US phone']
          });
        }
        await db.upsertCustomerProfile(
          userId,
          {
            firstName: profileIn.firstName || pending.primary_first_name || '',
            lastName: profileIn.lastName || pending.primary_last_name || '',
            phone: normalizedPhone,
            gender: profileIn.gender || null,
            dateOfBirth: profileIn.dateOfBirth || null
          },
          {
            street: addressIn.street ?? pending.address_street ?? '',
            city: addressIn.city ?? pending.address_city ?? '',
            state: addressIn.state ?? pending.address_state ?? '',
            zip: addressIn.zip ?? pending.address_zip ?? ''
          },
          {
            name: emergencyIn.name ?? pending.emergency_contact_name ?? '',
            phone: emergencyIn.phone ?? pending.emergency_contact_phone ?? ''
          }
        );
      } else {
        const mergedPayload = {
          profile: {
            firstName: profileIn.firstName || pending.primary_first_name,
            lastName: profileIn.lastName || pending.primary_last_name,
            phone: profileIn.phone || pending.primary_phone,
            gender: profileIn.gender,
            dateOfBirth: profileIn.dateOfBirth
          },
          address: {
            street: addressIn.street ?? pending.address_street,
            city: addressIn.city ?? pending.address_city,
            state: addressIn.state ?? pending.address_state,
            zip: addressIn.zip ?? pending.address_zip
          },
          emergencyContact: {
            name: emergencyIn.name ?? pending.emergency_contact_name,
            phone: emergencyIn.phone ?? pending.emergency_contact_phone
          }
        };
        const pv = gymProfileSchema.validateGymMembershipProfilePayload(mergedPayload);
        if (!pv.ok) {
          if (pv.missing && pv.missing.length) {
            return res.status(400).json({ error: 'Missing required profile fields', missingFields: pv.missing });
          }
          return res.status(400).json({ error: 'Invalid profile fields', invalidFields: pv.invalid });
        }
        await db.upsertCustomerProfile(
          userId,
          pv.normalized.profile,
          pv.normalized.address,
          pv.normalized.emergencyContact
        );
      }
      // Parse membership_start_date safely; avoid "Invalid time value" from toISOString() on invalid dates
      let startDate = null;
      const raw = pending.membership_start_date;
      if (raw instanceof Date && !isNaN(raw.getTime())) {
        startDate = raw.toISOString().split('T')[0];
      } else if (raw != null && typeof raw === 'string') {
        const s = raw.trim().split('T')[0].split(/\s/)[0];
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) startDate = s;
      } else if (raw != null) {
        const s = String(raw).trim().split('T')[0].split(/\s/)[0];
        if (s && /^\d{4}-\d{2}-\d{2}$/.test(s)) startDate = s;
      }
      if (!startDate) {
        console.error('Confirm migration: missing or invalid membership_start_date', { email: user.email, raw: pending.membership_start_date });
        return res.status(400).json({ error: 'Membership start date is missing or invalid. Please contact support.' });
      }
      const start = new Date(startDate + 'T00:00:00Z');
      if (isNaN(start.getTime())) {
        console.error('Confirm migration: unparseable start date', { email: user.email, startDate });
        return res.status(400).json({ error: 'Membership start date is invalid. Please contact support.' });
      }
      const formatYmd = (d) => d.toISOString().split('T')[0];
      // Migration import: admin-supplied scheduled start (not the same as self-serve signup flow).
      // Self-serve gym_memberships rows use NULL contract dates until first successful charge (see /gym-memberships/create).
      const contractEndDate = formatYmd(start);
      const householdId = !pending.household_members || pending.household_members.length === 0 ? null : (() => {
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let id = 'HH-';
        for (let i = 0; i < 6; i++) id += chars.charAt(Math.floor(Math.random() * chars.length));
        return id;
      })();
      // Get or create Stripe customer so "add payment method" works and nightly job can charge
      let stripeCustomerId = user.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await createCustomer(user.email);
        stripeCustomerId = customer.id;
        await db.query(
          db.isPostgres
            ? 'UPDATE users SET stripe_customer_id = $1 WHERE id = $2'
            : 'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
          [stripeCustomerId, userId]
        );
      }
      const monthlyAmountCents = pending.monthly_amount_cents != null ? Math.max(0, parseInt(pending.monthly_amount_cents, 10)) : null;
      const discountNames = [
        (pending.discount_1_name || '').trim(),
        (pending.discount_2_name || '').trim(),
        (pending.discount_3_name || '').trim()
      ].filter(Boolean);
      const discountName = discountNames.length > 0 ? discountNames.join(' & ') : null;
      let familyGroupId = null;
      if (householdId) {
        if (db.isPostgres) {
          const r = await db.query('INSERT INTO family_groups (primary_user_id) VALUES ($1) RETURNING id', [userId]);
          familyGroupId = r.rows?.[0]?.id;
        } else {
          await db.query('INSERT INTO family_groups (primary_user_id) VALUES (?)', [userId]);
          const row = await db.queryOne('SELECT id FROM family_groups WHERE primary_user_id = ? ORDER BY id DESC LIMIT 1', [userId]);
          familyGroupId = row?.id;
        }
      }
      if (db.isPostgres) {
        await db.query(
          `INSERT INTO gym_memberships (user_id, membership_type, household_id, family_group_id, is_primary_member, discount_group_id, status, contract_start_date, contract_end_date, contract_months, stripe_customer_id, monthly_amount_cents, discount_name, created_at)
           VALUES ($1, $2, $3, $4, true, $5, 'active', $6, $7, 12, $8, $9, $10, CURRENT_TIMESTAMP)`,
          [userId, pending.membership_type, householdId, familyGroupId, pending.discount_group_id || null, formatYmd(start), contractEndDate, stripeCustomerId, monthlyAmountCents, discountName]
        );
      } else {
        await db.query(
          `INSERT INTO gym_memberships (user_id, membership_type, household_id, family_group_id, is_primary_member, discount_group_id, status, contract_start_date, contract_end_date, contract_months, stripe_customer_id, monthly_amount_cents, discount_name, created_at)
           VALUES (?, ?, ?, ?, 1, ?, 'active', ?, ?, 12, ?, ?, ?, datetime('now'))`,
          [userId, pending.membership_type, householdId, familyGroupId, pending.discount_group_id || null, formatYmd(start), contractEndDate, stripeCustomerId, monthlyAmountCents, discountName]
        );
      }
      const members = pending.household_members || [];
      const cryptoConfirm = require('crypto');
      for (const m of members) {
        const email = (m.email || '').trim().toLowerCase();
        if (!email) continue;
        let memberUser = await db.getUserByEmail(email);
        if (!memberUser) {
          memberUser = await db.createUser(
            email,
            cryptoConfirm.randomBytes(16).toString('hex'),
            (m.name || '').trim() || null
          );
        }
        // Only the primary row may store household_id — the column is UNIQUE; sharing one HH-… across
        // multiple gym_memberships rows would violate the constraint. Everyone in this household still
        // shares family_group_id when the primary has a family_groups row so admin / APIs can resolve the unit.
        const fgId = familyGroupId != null ? familyGroupId : null;
        const hhId = null;
        const memType = m.membership_type || 'immediate_family_member';
        const baseCents = memType === 'immediate_family_member' ? 5000 : (memType === 'expecting_or_recovering_mother' ? 3000 : (memType === 'standard' ? 6500 : 18500));
        const md1 = Math.abs(parseInt(m.discount_1_cents, 10) || 0);
        const md2 = Math.abs(parseInt(m.discount_2_cents, 10) || 0);
        const md3 = Math.abs(parseInt(m.discount_3_cents, 10) || 0);
        const memberMonthlyCents = Math.max(0, baseCents - md1 - md2 - md3);
        const memberDiscountNames = [(m.discount_1_name || '').trim(), (m.discount_2_name || '').trim(), (m.discount_3_name || '').trim()].filter(Boolean);
        const memberDiscountName = memberDiscountNames.length > 0 ? memberDiscountNames.join(' & ') : null;
        if (db.isPostgres) {
          await db.query(
            `INSERT INTO gym_memberships (user_id, membership_type, household_id, family_group_id, is_primary_member, discount_group_id, status, contract_start_date, contract_end_date, contract_months, monthly_amount_cents, discount_name, created_at)
             VALUES ($1, $2, $3, $4, false, $5, 'active', $6, $7, 12, $8, $9, CURRENT_TIMESTAMP)`,
            [memberUser.id, memType, hhId, fgId, pending.discount_group_id || null, formatYmd(start), contractEndDate, memberMonthlyCents || null, memberDiscountName]
          );
        } else {
          await db.query(
            `INSERT INTO gym_memberships (user_id, membership_type, household_id, family_group_id, is_primary_member, discount_group_id, status, contract_start_date, contract_end_date, contract_months, monthly_amount_cents, discount_name, created_at)
             VALUES (?, ?, ?, ?, 0, ?, 'active', ?, ?, 12, ?, ?, datetime('now'))`,
            [memberUser.id, memType, hhId, fgId, pending.discount_group_id || null, formatYmd(start), contractEndDate, memberMonthlyCents || null, memberDiscountName]
          );
        }
      }
      await db.setAdminAddedMemberConfirmed(pending.id);
      if (isImmediateFamilyDependent) {
        res.json({
          success: true,
          message: 'Membership confirmed. Phone number saved.',
          membership_start_date: startDate
        });
      } else {
        res.json({ success: true, message: 'Membership confirmed. Add a payment method below. You will not be charged until ' + startDate + '.', membership_start_date: startDate });
      }
    } catch (error) {
      console.error('Confirm migration error:', error);
      res.status(500).json({ error: error.message || 'Failed to confirm migration' });
    }
  });

  // Get current user's gym membership
  router.get('/gym-memberships/me', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      
      // Get gym membership for user
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      
      if (!membership) {
        // If there is a pending admin-added migration for this email, surface that first
        const user = await db.getUserById(userId);
        if (user && user.email) {
          const pending = await db.getPendingMigrationByEmail(user.email);
          if (pending) {
            return res.status(404).json({ error: 'No gym membership found yet (pending migration)' });
          }
        }
        // No gym membership and no pending migration: check for active free trial (by user_id or email)
        const userRecord = await db.getUserById(userId);
        if (!userRecord) {
          return res.status(404).json({ error: 'No gym membership found' });
        }
        await db.linkFreeTrialToUserByEmail(userRecord.email, userId);
        const trial = await db.getActiveFreeTrialByUserOrEmail(userId, userRecord.email);
        if (trial) {
          const formatDateForResponse = (dateValue) => {
            if (!dateValue) return null;
            if (typeof dateValue === 'string') {
              const dateStr = dateValue.trim().split('T')[0].split(' ')[0];
              if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return dateStr;
            }
            const d = new Date(dateValue);
            if (!isNaN(d.getTime())) return d.toISOString().slice(0, 10);
            return null;
          };
          const membershipPricing = {
            'standard': 65,
            'immediate_family_member': 50,
            'expecting_or_recovering_mother': 30,
            'entire_family': 185
          };
          let paymentRules = membershipContractRules.getDefaultPaymentRules();
          try {
            const rules = require('./membership-rules.json');
            if (rules.paymentRules) {
              paymentRules = {
                gracePeriodDays: typeof rules.paymentRules.gracePeriodDays === 'number' ? rules.paymentRules.gracePeriodDays : paymentRules.gracePeriodDays,
                lateFee: typeof rules.paymentRules.lateFee === 'number' ? rules.paymentRules.lateFee : paymentRules.lateFee
              };
            }
          } catch (e) {}
          return res.json({
            membership: {
              id: trial.id,
              membership_type: 'free_trial',
              status: 'active',
              household_id: null,
              is_primary_member: true,
              contract_start_date: formatDateForResponse(trial.start_date),
              contract_end_date: formatDateForResponse(trial.end_date),
              contract_months: null,
              billing_period: null,
              stripe_customer_id: null,
              stripe_subscription_id: null,
              created_at: trial.created_at,
              price: 0
            },
            user: { id: user.id, email: user.email, name: user.name },
            pricing: membershipPricing,
            payment_rules: paymentRules,
            contract: null,
            stripe: { has_payment_method: false, payment_method: null }
          });
        }
        return res.status(404).json({ error: 'No gym membership found' });
      }
      
      // Membership change request: expecting/recovering mother -> standard on next billing cycle
      let pendingStandardSwitch = null;
      try {
        pendingStandardSwitch = await db.queryOne(
          db.isPostgres
            ? `SELECT user_id, requested_membership_type, effective_on, status
               FROM membership_change_requests
               WHERE user_id = $1 AND status = 'pending'
               ORDER BY id DESC LIMIT 1`
            : `SELECT user_id, requested_membership_type, effective_on, status
               FROM membership_change_requests
               WHERE user_id = ? AND status = 'pending'
               ORDER BY id DESC LIMIT 1`,
          [userId]
        );
      } catch (switchReadErr) {
        // If table is not present yet in an environment, fail open and continue.
        console.warn('Read membership_change_requests:', switchReadErr.message);
      }

      // Auto-apply when the effective date arrives; once applied, this section disappears in UI.
      if (
        pendingStandardSwitch &&
        String(pendingStandardSwitch.requested_membership_type || '').toLowerCase() === 'standard' &&
        String(membership.membership_type || '').toLowerCase() === 'expecting_or_recovering_mother'
      ) {
        const effectiveOn = formatDateForResponse(pendingStandardSwitch.effective_on);
        const todayYmd = formatDateForResponse(new Date());
        if (effectiveOn && todayYmd && effectiveOn <= todayYmd) {
          try {
            await db.query(
              db.isPostgres
                ? `UPDATE gym_memberships
                   SET membership_type = 'standard',
                       monthly_amount_cents = NULL,
                       discount_name = NULL,
                       updated_at = CURRENT_TIMESTAMP
                   WHERE id = $1`
                : `UPDATE gym_memberships
                   SET membership_type = 'standard',
                       monthly_amount_cents = NULL,
                       discount_name = NULL,
                       updated_at = datetime('now')
                   WHERE id = ?`,
              [membership.id]
            );
            await db.query(
              db.isPostgres
                ? `UPDATE membership_change_requests
                   SET status = 'applied', processed_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
                   WHERE user_id = $1 AND status = 'pending'`
                : `UPDATE membership_change_requests
                   SET status = 'applied', processed_at = datetime('now'), updated_at = datetime('now')
                   WHERE user_id = ? AND status = 'pending'`,
              [userId]
            );
            membership.membership_type = 'standard';
            membership.monthly_amount_cents = null;
            membership.discount_name = null;
            pendingStandardSwitch = null;
          } catch (switchApplyErr) {
            console.warn('Apply membership_change_requests:', switchApplyErr.message);
          }
        }
      }

      // Get user info
      const user = await db.getUserById(userId);
      const userStripeRow = await db.queryOne(
        db.isPostgres
          ? 'SELECT stripe_customer_id FROM users WHERE id = $1'
          : 'SELECT stripe_customer_id FROM users WHERE id = ?',
        [userId]
      );
      const appStripeCustomerId =
        userStripeRow && userStripeRow.stripe_customer_id
          ? String(userStripeRow.stripe_customer_id).trim()
          : null;

      // One-time backfill: ensure sharla.barber@nebo.edu has discount data so invoice footer shows correctly
      const emailLower = (user && user.email || '').trim().toLowerCase();
      if (emailLower === 'sharla.barber@nebo.edu' && membership.membership_type === 'standard' &&
          (membership.monthly_amount_cents == null || membership.discount_name == null)) {
        try {
          await db.query(
            db.isPostgres
              ? `UPDATE gym_memberships SET monthly_amount_cents = 5000, discount_name = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
              : `UPDATE gym_memberships SET monthly_amount_cents = 5000, discount_name = ?, updated_at = datetime('now') WHERE id = ?`,
            ['Loyalty Discount (original price)', membership.id]
          );
          membership.monthly_amount_cents = 5000;
          membership.discount_name = 'Loyalty Discount (original price)';
        } catch (e) {
          console.warn('Backfill Sharla discount:', e && e.message);
        }
      }

      // Lazy backfill: ensure primary standard/entire_family members have a household_id so they can share it on the Household tab
      const primaryTypes = ['standard', 'entire_family'];
      const needsHouseholdId = membership.is_primary_member &&
        primaryTypes.includes(String(membership.membership_type || '').toLowerCase()) &&
        !(membership.household_id && String(membership.household_id).trim());
      if (needsHouseholdId) {
        let householdId;
        let attempts = 0;
        const maxAttempts = 10;
        do {
          householdId = generateHouseholdId();
          attempts++;
          const existing = await db.queryOne(
            db.isPostgres ? 'SELECT id FROM gym_memberships WHERE household_id = $1' : 'SELECT id FROM gym_memberships WHERE household_id = ?',
            [householdId]
          );
          if (!existing) break;
          if (attempts >= maxAttempts) {
            householdId = null;
            break;
          }
        } while (true);
        if (householdId) {
          try {
            await db.query(
              db.isPostgres ? 'UPDATE gym_memberships SET household_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2' : 'UPDATE gym_memberships SET household_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
              [householdId, membership.id]
            );
            membership.household_id = householdId;
          } catch (e) {
            console.warn('Backfill household_id:', e && e.message);
          }
        }
      }
      
      // Get Stripe subscription info if available
      let stripeSubscription = null;
      // Hybrid system: consider DB first, then Stripe
      let hasPaymentMethod = !!(membership.payment_method_id && String(membership.payment_method_id).trim() !== '');
      let paymentMethodInfo = null;
      if (membership.stripe_subscription_id) {
        try {
          stripeSubscription = await stripe.subscriptions.retrieve(membership.stripe_subscription_id, {
            expand: ['default_payment_method', 'latest_invoice.payment_intent']
          });
          
          // Check if subscription has a default payment method (if not already set from DB)
          if (!hasPaymentMethod && stripeSubscription.default_payment_method) {
            hasPaymentMethod = true;
            const pm = typeof stripeSubscription.default_payment_method === 'string'
              ? await stripe.paymentMethods.retrieve(stripeSubscription.default_payment_method)
              : stripeSubscription.default_payment_method;
            
            if (pm && pm.card) {
              paymentMethodInfo = {
                id: pm.id,
                last4: pm.card.last4,
                brand: pm.card.brand,
                exp_month: pm.card.exp_month,
                exp_year: pm.card.exp_year
              };
            }
          }
          if (!hasPaymentMethod) {
            // Check customer default payment method as fallback
            const customer = await stripe.customers.retrieve(membership.stripe_customer_id || stripeSubscription.customer);
            if (customer.invoice_settings?.default_payment_method) {
              const pm = await stripe.paymentMethods.retrieve(customer.invoice_settings.default_payment_method);
              if (pm && pm.card) {
                hasPaymentMethod = true;
                paymentMethodInfo = {
                  id: pm.id,
                  last4: pm.card.last4,
                  brand: pm.card.brand,
                  exp_month: pm.card.exp_month,
                  exp_year: pm.card.exp_year
                };
              }
            }
          }
          // Fallback: if latest invoice was paid via PaymentIntent (e.g. pay-overdue flow), payment method is on file
          if (!hasPaymentMethod && stripeSubscription.latest_invoice) {
            const inv = typeof stripeSubscription.latest_invoice === 'string'
              ? await stripe.invoices.retrieve(stripeSubscription.latest_invoice, { expand: ['payment_intent'] })
              : stripeSubscription.latest_invoice;
            if (inv.status === 'paid' && inv.payment_intent) {
              const pi = typeof inv.payment_intent === 'string'
                ? await stripe.paymentIntents.retrieve(inv.payment_intent)
                : inv.payment_intent;
              const pmId = typeof pi.payment_method === 'string' ? pi.payment_method : (pi.payment_method?.id || null);
              if (pmId) {
                hasPaymentMethod = true;
                try {
                  const pm = await stripe.paymentMethods.retrieve(pmId);
                  if (pm && pm.card) {
                    paymentMethodInfo = {
                      id: pm.id,
                      last4: pm.card.last4,
                      brand: pm.card.brand,
                      exp_month: pm.card.exp_month,
                      exp_year: pm.card.exp_year
                    };
                  }
                } catch (pmErr) {
                  console.warn('Could not retrieve payment method from paid invoice:', pmErr.message);
                }
              }
            }
          }
          // Fallback: any card attached to the gym membership Stripe customer (subscription default may be unset)
          if (!hasPaymentMethod) {
            const custIdGym =
              membership.stripe_customer_id ||
              (stripeSubscription.customer &&
                (typeof stripeSubscription.customer === 'string'
                  ? stripeSubscription.customer
                  : stripeSubscription.customer.id));
            if (custIdGym) {
              try {
                const pmList = await stripe.paymentMethods.list({
                  customer: custIdGym,
                  type: 'card',
                  limit: 10
                });
                if (pmList.data && pmList.data.length > 0) {
                  const pm = pmList.data[0];
                  hasPaymentMethod = true;
                  if (pm.card) {
                    paymentMethodInfo = {
                      id: pm.id,
                      last4: pm.card.last4,
                      brand: pm.card.brand,
                      exp_month: pm.card.exp_month,
                      exp_year: pm.card.exp_year
                    };
                  }
                }
              } catch (listErr) {
                console.warn('Gym membership: paymentMethods.list (gym customer) failed:', listErr.message);
              }
            }
          }
          // App vs gym Stripe customer mismatch: card may only exist on users.stripe_customer_id (getUserById omits it)
          if (!hasPaymentMethod && appStripeCustomerId) {
            const gymCust =
              membership.stripe_customer_id ||
              (stripeSubscription.customer &&
                (typeof stripeSubscription.customer === 'string'
                  ? stripeSubscription.customer
                  : stripeSubscription.customer.id));
            if (appStripeCustomerId !== String(gymCust || '').trim()) {
              try {
                const pmListUser = await stripe.paymentMethods.list({
                  customer: appStripeCustomerId,
                  type: 'card',
                  limit: 10
                });
                if (pmListUser.data && pmListUser.data.length > 0) {
                  const pm = pmListUser.data[0];
                  hasPaymentMethod = true;
                  if (pm.card) {
                    paymentMethodInfo = {
                      id: pm.id,
                      last4: pm.card.last4,
                      brand: pm.card.brand,
                      exp_month: pm.card.exp_month,
                      exp_year: pm.card.exp_year
                    };
                  }
                }
              } catch (listErr2) {
                console.warn('Gym membership: paymentMethods.list (user customer) failed:', listErr2.message);
              }
            }
          }
        } catch (stripeError) {
          console.error('Error retrieving Stripe subscription:', stripeError.message);
          // Continue without Stripe info
        }
      }

      // If DB has payment_method_id but we never loaded card details (common on subscription path), fill for UI
      if (
        membership.stripe_subscription_id &&
        hasPaymentMethod &&
        !paymentMethodInfo &&
        membership.payment_method_id &&
        String(membership.payment_method_id).trim()
      ) {
        try {
          const pm = await stripe.paymentMethods.retrieve(membership.payment_method_id);
          if (pm && pm.card) {
            paymentMethodInfo = {
              id: pm.id,
              last4: pm.card.last4,
              brand: pm.card.brand,
              exp_month: pm.card.exp_month,
              exp_year: pm.card.exp_year
            };
          }
        } catch (e) {
          console.warn('Could not retrieve membership.payment_method_id for display:', e.message);
        }
      }

      // Card exists in Stripe but DB row never got payment_method_id (renewal job reads DB) — persist now
      if (
        membership.stripe_customer_id &&
        hasPaymentMethod &&
        paymentMethodInfo &&
        paymentMethodInfo.id &&
        (!membership.payment_method_id || !String(membership.payment_method_id).trim())
      ) {
        try {
          let paymentMethodExpiresAt = null;
          if (paymentMethodInfo.exp_year && paymentMethodInfo.exp_month) {
            paymentMethodExpiresAt = new Date(
              paymentMethodInfo.exp_year,
              paymentMethodInfo.exp_month,
              0,
              23,
              59,
              59
            ).toISOString();
          }
          await db.updateGymMembershipPaymentMethod(membership.id, paymentMethodInfo.id, paymentMethodExpiresAt);
          membership.payment_method_id = paymentMethodInfo.id;
          if (membership.stripe_subscription_id) {
            try {
              await stripe.subscriptions.update(membership.stripe_subscription_id, {
                default_payment_method: paymentMethodInfo.id
              });
            } catch (subPmErr) {
              console.warn('Sync PM to subscription default failed (non-fatal):', subPmErr.message);
            }
          }
        } catch (syncErr) {
          console.warn('Sync payment_method_id from Stripe to DB failed:', syncErr.message);
        }
      }
      
      // Membership pricing (in dollars, aligned with membership-rules.json) - base prices by type
      const membershipPricing = {
        'standard': 65,                          // STANDARD: $65
        'immediate_family_member': 50,           // IMMEDIATE_FAMILY: $50
        'expecting_or_recovering_mother': 30,    // EXPECTING_RECOVERING: $30
        'entire_family': 185                      // FULL_FAMILY: $185
      };
      
      // Use stored monthly amount when set (e.g. admin-added member with discounts), otherwise type-based price
      const basePrice = membershipPricing[membership.membership_type] || 0;
      const membershipPrice = (membership.monthly_amount_cents != null && membership.monthly_amount_cents >= 0)
        ? (membership.monthly_amount_cents / 100)
        : basePrice;
      const hasCustomPrice = (membership.monthly_amount_cents != null && membership.monthly_amount_cents >= 0);
      
      // If membership has custom price but no discount_name (e.g. confirmed before we stored it), recover from admin_added_members
      let discountNameForResponse = membership.discount_name || null;
      if (hasCustomPrice && !discountNameForResponse && user.email) {
        const adminRecord = await db.getAdminAddedMemberByEmailAnyStatus(user.email);
        if (adminRecord) {
          const names = [
            (adminRecord.discount_1_name || '').trim(),
            (adminRecord.discount_2_name || '').trim(),
            (adminRecord.discount_3_name || '').trim()
          ].filter(Boolean);
          discountNameForResponse = names.length > 0 ? names.join(' & ') : null;
        }
      }
      
      // Format response - ensure dates are in YYYY-MM-DD format
      // Handles TIMESTAMP columns which may include time components
      const formatDateForResponse = (dateValue) => {
        if (!dateValue) {
          return null;
        }
        
        try {
          // If it's already a string, extract the date part
          if (typeof dateValue === 'string') {
            // Remove any timezone info and time components
            // Handle formats like: "2026-01-14T00:00:00.000Z", "2026-01-14 00:00:00", "2026-01-14"
            let dateStr = dateValue.trim();
            
            // Extract date part before 'T' (ISO format)
            if (dateStr.includes('T')) {
              dateStr = dateStr.split('T')[0];
            }
            // Extract date part before space (SQL format)
            else if (dateStr.includes(' ')) {
              dateStr = dateStr.split(' ')[0];
            }
            
            // Validate it's in YYYY-MM-DD format
            if (/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) {
              return dateStr;
            }
          }
          
          // If it's a Date object, format it
          if (dateValue instanceof Date && !isNaN(dateValue.getTime())) {
            const year = dateValue.getFullYear();
            const month = String(dateValue.getMonth() + 1).padStart(2, '0');
            const day = String(dateValue.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
          
          // Try to parse as Date if it's a number (timestamp) or other format
          const parsedDate = new Date(dateValue);
          if (!isNaN(parsedDate.getTime())) {
            const year = parsedDate.getFullYear();
            const month = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const day = String(parsedDate.getDate()).padStart(2, '0');
            return `${year}-${month}-${day}`;
          }
        } catch (error) {
          console.error('[API] Error formatting date:', error, dateValue);
        }
        
        return null;
      };
      
      // Payment rules for late fee / grace period (from membership-rules.json)
      let paymentRules = membershipContractRules.getDefaultPaymentRules();
      try {
        const rules = require('./membership-rules.json');
        if (rules.paymentRules) {
          paymentRules = {
            gracePeriodDays: typeof rules.paymentRules.gracePeriodDays === 'number' ? rules.paymentRules.gracePeriodDays : paymentRules.gracePeriodDays,
            lateFee: typeof rules.paymentRules.lateFee === 'number' ? rules.paymentRules.lateFee : paymentRules.lateFee
          };
        }
      } catch (e) {
        // use defaults
      }

      const termMonths =
        membership.contract_months && membership.contract_months > 0
          ? membership.contract_months
          : membershipContractRules.getContractRules().defaultContractMonths;
      const termStart = formatDateForResponse(membership.contract_start_date);
      const termEnd = membershipContractRules.computeContractTermEndYmd(termStart, termMonths);
      const monthlyCentsForFee =
        membership.monthly_amount_cents != null && membership.monthly_amount_cents >= 0
          ? membership.monthly_amount_cents
          : Math.round(basePrice * 100);
      const earlyFeeCents = membershipContractRules.computeEarlyCancellationFeeCents(monthlyCentsForFee);
      const earlyCopy = membershipContractRules.buildEarlyCancellationCopy(monthlyCentsForFee, earlyFeeCents, termMonths);

      const contractPayload = {
        term_months: termMonths,
        term_start_date: termStart,
        term_end_date: termEnd,
        next_payment_due_date: formatDateForResponse(membership.contract_end_date),
        monthly_amount_cents: monthlyCentsForFee,
        early_cancellation_fee_cents: earlyFeeCents,
        early_cancellation_fee_display: earlyCopy.early_cancellation_fee_display,
        early_cancellation_summary: earlyCopy.early_cancellation_summary
      };

      // Format response
      const response = {
        membership: {
          id: membership.id,
          membership_type: membership.membership_type,
          status: membership.status,
          household_id: membership.household_id,
          is_primary_member: membership.is_primary_member,
          contract_start_date: formatDateForResponse(membership.contract_start_date),
          contract_end_date: formatDateForResponse(membership.contract_end_date),
          contract_months: membership.contract_months,
          billing_period: membership.billing_period,
          stripe_customer_id: membership.stripe_customer_id,
          stripe_subscription_id: membership.stripe_subscription_id,
          created_at: membership.created_at,
          price: membershipPrice,  // Effective monthly price (from monthly_amount_cents when set)
          base_price: basePrice,   // Type-based price before any discounts
          has_custom_price: hasCustomPrice,  // True when admin-set amount (e.g. after discounts)
          discount_name: discountNameForResponse,  // Label for gym-applied discount (from membership or admin_added_members)
          // So clients know a card is saved (Stripe + DB); includes PM id resolved from Stripe when DB was stale
          payment_method_id:
            (membership.payment_method_id && String(membership.payment_method_id).trim()) ||
            (paymentMethodInfo && paymentMethodInfo.id) ||
            null,
          pauses_used_this_contract: membership.pauses_used_this_contract ?? 0,
          pause_resume_scheduled: !!(membership.pause_resume_scheduled),
          standard_switch_request: pendingStandardSwitch
            ? {
                requested_membership_type: pendingStandardSwitch.requested_membership_type || 'standard',
                effective_on: formatDateForResponse(pendingStandardSwitch.effective_on),
                status: pendingStandardSwitch.status || 'pending'
              }
            : null
        },
        user: {
          id: user.id,
          email: user.email,
          name: user.name
        },
        pricing: membershipPricing,  // Add pricing object for frontend
        payment_rules: paymentRules,
        contract: contractPayload
      };

      // Profile completeness for migrated/admin-added members.
      const customerProfile = await db.queryOne(
        db.isPostgres
          ? `SELECT first_name, last_name, date_of_birth, gender, phone, street, city, state, zip,
                    emergency_contact_name, emergency_contact_phone
             FROM customer_profiles
             WHERE user_id = $1`
          : `SELECT first_name, last_name, date_of_birth, gender, phone, street, city, state, zip,
                    emergency_contact_name, emergency_contact_phone
             FROM customer_profiles
             WHERE user_id = ?`,
        [userId]
      );
      const isImmediateFamilyDependent =
        String(membership.membership_type || '').toLowerCase() === 'immediate_family_member' &&
        !membership.is_primary_member;
      const missingProfileFields = isImmediateFamilyDependent
        ? ((customerProfile && String(customerProfile.phone || '').trim()) ? [] : ['Phone'])
        : gymProfileSchema.getMissingRequiredLabelsFromCustomerProfileRow(customerProfile);
      response.customerProfile = customerProfile || null;
      response.profileCompletion = {
        complete: missingProfileFields.length === 0,
        missingFields: missingProfileFields,
        requiredMode: isImmediateFamilyDependent ? 'phone_only' : 'full'
      };

      // Household/family members for Household tab totals (primary + immediate family)
      response.familyMembers = [];
      response.primaryMember = null;
      if (membership.family_group_id != null) {
        const familyRowsResult = db.isPostgres
          ? await db.query(
              `SELECT gm.user_id, gm.membership_type, gm.is_primary_member, gm.status, gm.monthly_amount_cents, gm.discount_name,
                      u.name, u.email
               FROM gym_memberships gm
               JOIN users u ON u.id = gm.user_id
               WHERE gm.family_group_id = $1
               ORDER BY gm.is_primary_member DESC, gm.created_at ASC`,
              [membership.family_group_id]
            )
          : await db.query(
              `SELECT gm.user_id, gm.membership_type, gm.is_primary_member, gm.status, gm.monthly_amount_cents, gm.discount_name,
                      u.name, u.email
               FROM gym_memberships gm
               JOIN users u ON u.id = gm.user_id
               WHERE gm.family_group_id = ?
               ORDER BY gm.is_primary_member DESC, gm.created_at ASC`,
              [membership.family_group_id]
            );

        const familyRows = (familyRowsResult && familyRowsResult.rows) ? familyRowsResult.rows : [];
        const resolveMemberPrice = (r) => {
          if (r.monthly_amount_cents != null && !Number.isNaN(Number(r.monthly_amount_cents))) {
            return Number(r.monthly_amount_cents) / 100;
          }
          const fallbackPricing = {
            standard: 65,
            immediate_family_member: 50,
            expecting_or_recovering_mother: 30,
            entire_family: 185,
            free_trial: 0
          };
          return fallbackPricing[r.membership_type] || 0;
        };

        const mappedMembers = familyRows.map((r) => ({
          id: r.user_id,
          email: r.email || '',
          name: r.name || r.email || 'Member',
          membership_type: r.membership_type || 'standard',
          is_primary_member: !!r.is_primary_member,
          status: r.status || 'active',
          price: resolveMemberPrice(r),
          base_price: ({
            standard: 65,
            immediate_family_member: 50,
            expecting_or_recovering_mother: 30,
            entire_family: 185,
            free_trial: 0
          })[r.membership_type] ?? 0,
          discount_name: r.discount_name || null
        }));

        response.primaryMember = mappedMembers.find((m) => m.is_primary_member) || null;
        response.familyMembers = mappedMembers.filter((m) => !m.is_primary_member);
      }

      // Discount group: if member is in a group, load group info and members for "My Group" tab
      response.groupMembers = [];
      response.groupInfo = null;
      response.groupDiscount = {};
      if (membership.discount_group_id != null) {
        const dgId = membership.discount_group_id;
        const group = db.isPostgres
          ? await db.queryOne('SELECT id, group_id, group_access_code, group_leader_id, group_name FROM discount_groups WHERE id = $1', [dgId])
          : await db.queryOne('SELECT id, group_id, group_access_code, group_leader_id, group_name FROM discount_groups WHERE id = ?', [dgId]);
        if (group) {
          const membersRows = db.isPostgres
            ? await db.query(
                `SELECT gm.user_id, gm.status, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name,
                        gm.household_id, gm.family_group_id
                 FROM gym_memberships gm
                 JOIN users u ON u.id = gm.user_id
                 WHERE gm.discount_group_id = $1`,
                [dgId]
              )
            : await db.query(
                `SELECT gm.user_id, gm.status, gm.stripe_subscription_id, u.id AS u_id, u.email, u.name,
                        gm.household_id, gm.family_group_id
                 FROM gym_memberships gm
                 JOIN users u ON u.id = gm.user_id
                 WHERE gm.discount_group_id = ?`,
                [dgId]
              );
          const rows = (membersRows && membersRows.rows) ? membersRows.rows : [];
          let seedForExpand = rows;
          try {
            seedForExpand = await buildSeedRowsForDiscountGroupHouseholdExpand(db, rows, group.group_leader_id);
          } catch (seedErr) {
            console.warn('Group members leader seed:', seedErr.message);
          }
          let extraHouseholdRows = [];
          try {
            extraHouseholdRows = await fetchExtraHouseholdFamilyMembersForDiscountGroup(db, seedForExpand);
          } catch (exErr) {
            console.warn('Group members household/family expand:', exErr.message);
          }
          // Merge direct + expanded household/family rows and dedupe by user id so
          // discount qualification counts each person once.
          let allGymRows = dedupeGymMemberRowsByUserId(rows.concat(extraHouseholdRows));
          const leaderId = Number(group.group_leader_id);
          const presentIds = new Set(allGymRows.map((r) => Number(r.u_id ?? r.user_id)));
          if (Number.isFinite(leaderId) && leaderId > 0 && !presentIds.has(leaderId)) {
            try {
              const lu = await db.queryOne(
                db.isPostgres
                  ? 'SELECT id, email, name FROM users WHERE id = $1'
                  : 'SELECT id, email, name FROM users WHERE id = ?',
                [leaderId]
              );
              if (lu) {
                const lgm = await db.queryOne(
                  db.isPostgres
                    ? 'SELECT status, membership_type FROM gym_memberships WHERE user_id = $1 ORDER BY id DESC LIMIT 1'
                    : 'SELECT status, membership_type FROM gym_memberships WHERE user_id = ? ORDER BY id DESC LIMIT 1',
                  [leaderId]
                );
                allGymRows = allGymRows.concat([
                  {
                    user_id: lu.id,
                    u_id: lu.id,
                    email: lu.email,
                    name: lu.name,
                    status: lgm ? lgm.status : '',
                    membership_type: lgm ? lgm.membership_type : '',
                    household_id: null,
                    family_group_id: null
                  }
                ]);
              }
            } catch (leadErr) {
              console.warn('Group members: include group leader:', leadErr.message);
            }
          }
          const isLeader = Number(group.group_leader_id) === Number(userId);
          response.groupMembers = allGymRows.map((r) => {
            const status = r.status || '';
            const payment_status = (status === 'past_due' || status === 'grace_period') ? 'overdue' : 'current';
            return {
              id: r.u_id ?? r.user_id,
              email: r.email || '',
              name: r.name || r.email || 'Member',
              payment_status,
              is_current_user: Number(r.u_id ?? r.user_id) === Number(userId)
            };
          });
          // Admin-added members who have not finished signup yet: no gym_memberships row, but discount_group_id is set on admin_added_members
          try {
            const pendingRes = db.isPostgres
              ? await db.query(
                  `SELECT primary_email, primary_first_name, primary_last_name FROM admin_added_members
                   WHERE discount_group_id = $1 AND status = 'pending_confirmation'`,
                  [dgId]
                )
              : await db.query(
                  `SELECT primary_email, primary_first_name, primary_last_name FROM admin_added_members
                   WHERE discount_group_id = ? AND status = 'pending_confirmation'`,
                  [dgId]
                );
            const pendingList = (pendingRes && pendingRes.rows) ? pendingRes.rows : [];
            const seenEmails = new Set(
              response.groupMembers.map((m) => String(m.email || '').trim().toLowerCase()).filter(Boolean)
            );
            for (const p of pendingList) {
              const em = String(p.primary_email || '').trim().toLowerCase();
              if (!em || seenEmails.has(em)) continue;
              seenEmails.add(em);
              const name =
                [p.primary_first_name, p.primary_last_name].filter(Boolean).join(' ').trim() ||
                p.primary_email ||
                'Member';
              response.groupMembers.push({
                id: null,
                email: p.primary_email,
                name,
                payment_status: 'pending_signup',
                is_current_user: false
              });
            }
            response.groupMembers.sort((a, b) =>
              String(a.name || a.email || '').localeCompare(String(b.name || b.email || ''), undefined, { sensitivity: 'base' })
            );
          } catch (pendErr) {
            console.warn('Group members: pending admin_added merge:', pendErr.message);
          }
          response.groupInfo = {
            groupId: group.group_id,
            groupName: group.group_name || null,
            isGroupLeader: isLeader,
            groupAccessCode: isLeader ? (group.group_access_code || null) : undefined
          };
          let groupRules = { minMembersForDiscount: 5, discountPercent: 15 };
          try {
            const rules = require('./membership-rules.json');
            if (rules.groupRules) {
              groupRules = {
                minMembersForDiscount: rules.groupRules.minMembersForDiscount ?? 5,
                discountPercent: rules.groupRules.discountPercent ?? 15
              };
            }
          } catch (e) { /* use defaults */ }
          // Source of truth for group-size qualification is the same member list used by
          // Console -> Groups (response.groupMembers), so 5+ checks stay consistent.
          const sourceOfTruthMemberCount = response.groupMembers.length;
          const activeCount = allGymRows.filter((r) => {
            const s = String(r.status || '').toLowerCase();
            return s === 'active' || s === 'grace_period';
          }).length;
          response.groupDiscount = {
            hasDiscount: sourceOfTruthMemberCount >= groupRules.minMembersForDiscount,
            discountPercent: groupRules.discountPercent,
            requiredCount: groupRules.minMembersForDiscount,
            totalMembers: sourceOfTruthMemberCount,
            currentMembers: activeCount
          };
        }
      }
      
      // Add Stripe subscription details if available
      if (stripeSubscription) {
        let periodStart = stripeSubscription.current_period_start;
        let periodEnd = stripeSubscription.current_period_end;
        // When latest invoice is paid and its period has ended, use next 30-day period (user just paid)
        if (stripeSubscription.latest_invoice && stripeSubscription.status === 'active') {
          const inv = typeof stripeSubscription.latest_invoice === 'string'
            ? await stripe.invoices.retrieve(stripeSubscription.latest_invoice)
            : stripeSubscription.latest_invoice;
          if (inv.status === 'paid' && inv.period_end) {
            const periodEndSec = typeof inv.period_end === 'number' ? inv.period_end : inv.period_end;
            const periodEndDate = new Date(periodEndSec * 1000);
            const now = new Date();
            if (periodEndDate < now) {
              // Period has ended, next period: period_end -> period_end + 30 days
              periodStart = periodEndSec;
              const nextEnd = new Date(periodEndDate);
              nextEnd.setDate(nextEnd.getDate() + 30);
              periodEnd = Math.floor(nextEnd.getTime() / 1000);
            }
          }
        }
        response.stripe = {
          subscription_id: stripeSubscription.id,
          status: stripeSubscription.status,
          current_period_start: new Date(periodStart * 1000).toISOString(),
          current_period_end: new Date(periodEnd * 1000).toISOString(),
          cancel_at_period_end: stripeSubscription.cancel_at_period_end,
          has_payment_method: hasPaymentMethod,
          payment_method: paymentMethodInfo
        };
        // For past_due: use invoice due_date for late fee grace period end (matches webhook logic)
        const stripeStatus = stripeSubscription.status;
        const dbStatus = membership.status;
        if ((stripeStatus === 'past_due' || dbStatus === 'grace_period') && stripeSubscription.latest_invoice) {
          const invoice = typeof stripeSubscription.latest_invoice === 'string'
            ? await stripe.invoices.retrieve(stripeSubscription.latest_invoice)
            : stripeSubscription.latest_invoice;
          const invoiceDueTimestamp = invoice.due_date || invoice.period_end || invoice.created;
          if (invoiceDueTimestamp) {
            response.stripe.invoice_due_date = new Date(invoiceDueTimestamp * 1000).toISOString();
          }
        }
      }

      // Next payment due: if first charge (term start) is still in the future, show that scheduled date,
      // not Stripe current_period_end (end of first billing window — often ~30 days after term start).
      if (response.contract) {
        const termStart = response.contract.term_start_date;
        let firstChargeStillFuture = false;
        if (termStart && /^\d{4}-\d{2}-\d{2}$/.test(String(termStart).trim())) {
          const ts = String(termStart).trim();
          const todayStr = new Date().toISOString().split('T')[0];
          firstChargeStillFuture = ts > todayStr;
        }
        if (firstChargeStillFuture) {
          response.contract.next_payment_due_date = String(termStart).trim();
        } else if (response.stripe && response.stripe.current_period_end) {
          const d = new Date(response.stripe.current_period_end);
          if (!isNaN(d.getTime())) {
            response.contract.next_payment_due_date = formatDateForResponse(d);
          }
        }
      }

      if (!stripeSubscription) {
        // No Stripe subscription (app-controlled billing): use payment method stored on membership
        if (membership.payment_method_id) {
          try {
            const pm = await stripe.paymentMethods.retrieve(membership.payment_method_id);
            if (pm && pm.card) {
              response.stripe = {
                has_payment_method: true,
                payment_method: {
                  id: pm.id,
                  last4: pm.card.last4,
                  brand: pm.card.brand,
                  exp_month: pm.card.exp_month,
                  exp_year: pm.card.exp_year
                }
              };
            } else {
              response.stripe = { has_payment_method: true, payment_method: null };
            }
          } catch (e) {
            response.stripe = { has_payment_method: false, payment_method: null };
          }
        } else {
          response.stripe = {
            has_payment_method: false,
            payment_method: null
          };
        }
      }
      
      res.json(response);
    } catch (error) {
      console.error('Get gym membership error:', error);
      res.status(500).json({ error: 'Failed to get gym membership: ' + error.message });
    }
  });

  // Primary member can replace placeholder household member email with real email.
  router.post('/gym-memberships/household/update-member-email', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const memberUserId = Number(req.body.memberUserId);
      const newEmail = String(req.body.email || '').trim().toLowerCase();

      if (!memberUserId || !newEmail) {
        return res.status(400).json({ error: 'memberUserId and email are required' });
      }
      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(newEmail)) {
        return res.status(400).json({ error: 'Please enter a valid email address' });
      }

      const primaryMembership = await db.queryOne(
        db.isPostgres
          ? `SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1`
          : `SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1`,
        [userId]
      );
      if (!primaryMembership) {
        return res.status(404).json({ error: 'Gym membership not found' });
      }
      if (!primaryMembership.is_primary_member || !primaryMembership.family_group_id) {
        return res.status(403).json({ error: 'Only primary household members can update family emails' });
      }

      const target = await db.queryOne(
        db.isPostgres
          ? `SELECT u.id, u.email, u.name, gm.is_primary_member
             FROM users u
             JOIN gym_memberships gm ON gm.user_id = u.id
             WHERE gm.family_group_id = $1 AND u.id = $2
             ORDER BY gm.created_at DESC
             LIMIT 1`
          : `SELECT u.id, u.email, u.name, gm.is_primary_member
             FROM users u
             JOIN gym_memberships gm ON gm.user_id = u.id
             WHERE gm.family_group_id = ? AND u.id = ?
             ORDER BY gm.created_at DESC
             LIMIT 1`,
        [primaryMembership.family_group_id, memberUserId]
      );
      if (!target) {
        return res.status(404).json({ error: 'Household member not found' });
      }
      if (target.is_primary_member || Number(target.id) === Number(userId)) {
        return res.status(400).json({ error: 'Please select a non-primary household member' });
      }

      const existing = await db.getUserByEmail(newEmail);
      if (existing && Number(existing.id) !== Number(target.id)) {
        return res.status(409).json({ error: 'That email is already in use' });
      }

      await db.query(
        db.isPostgres
          ? `UPDATE users SET email = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2`
          : `UPDATE users SET email = ?, updated_at = datetime('now') WHERE id = ?`,
        [newEmail, target.id]
      );

      res.json({
        success: true,
        member: {
          id: target.id,
          name: target.name || 'Member',
          email: newEmail
        }
      });
    } catch (error) {
      console.error('Update household member email error:', error);
      res.status(500).json({ error: 'Failed to update household member email: ' + error.message });
    }
  });

  // Get gym membership payment history (gym + drop-in, succeeded only; for Payment History tab when logged in)
  router.get('/gym-memberships/payment-history', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const payments = await db.getGymAndDropInPaymentsSucceededByUserId(userId);
      const formatted = await Promise.all(payments.map(async (p) => {
        const description = p.tier === 'drop_in'
          ? 'Drop-in'
          : p.tier === 'gym_membership_late_fee'
            ? 'Gym membership (late fee)'
            : 'Gym membership';

        let paymentMethodLast4 = null;
        if (p.stripe_payment_intent_id) {
          try {
            const pi = await stripe.paymentIntents.retrieve(p.stripe_payment_intent_id, {
              expand: ['payment_method', 'latest_charge']
            });

            // Preferred source: attached payment_method.card.last4
            if (pi.payment_method && typeof pi.payment_method !== 'string' && pi.payment_method.card?.last4) {
              paymentMethodLast4 = pi.payment_method.card.last4;
            }

            // Fallback: charge payment_method_details.card.last4
            if (!paymentMethodLast4 && pi.latest_charge && typeof pi.latest_charge !== 'string') {
              paymentMethodLast4 = pi.latest_charge.payment_method_details?.card?.last4 || null;
            }
          } catch (stripeErr) {
            // Don't fail history rendering if Stripe lookup fails for an old payment.
            console.warn('Payment history: could not fetch card last4 for PI', p.stripe_payment_intent_id, stripeErr.message);
          }
        }

        return {
          id: p.id,
          date: p.created_at,
          amount: (p.amount || 0) / 100,
          currency: p.currency || 'usd',
          status: p.status || 'succeeded',
          description,
          stripePaymentIntentId: p.stripe_payment_intent_id,
          paymentMethodLast4
        };
      }));
      res.json({ payments: formatted });
    } catch (error) {
      console.error('Get gym payment history error:', error);
      res.status(500).json({ error: 'Failed to get payment history' });
    }
  });

  // Get payment intent for overdue gym invoice (Pay Now flow)
  // Handles both: (1) Stripe subscription with open invoice, (2) membership with no subscription (one-off payment)
  router.post('/gym-memberships/pay-overdue', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (!membership) {
        return res.status(404).json({ error: 'No gym membership found' });
      }

      // Case 1: Has Stripe subscription — use open invoice PaymentIntent
      if (membership.stripe_subscription_id) {
        const subscription = await stripe.subscriptions.retrieve(membership.stripe_subscription_id, {
          expand: ['latest_invoice.payment_intent']
        });
        if (subscription.status !== 'past_due' && subscription.status !== 'active') {
          return res.status(400).json({ error: 'Subscription is not past due' });
        }
        const invoice = subscription.latest_invoice;
        if (!invoice || typeof invoice === 'string') {
          return res.status(400).json({ error: 'No open invoice found' });
        }
        const invoiceObj = typeof invoice === 'string' ? await stripe.invoices.retrieve(invoice, { expand: ['payment_intent'] }) : invoice;
        if (invoiceObj.status !== 'open' && invoiceObj.status !== 'draft') {
          return res.status(400).json({ error: 'No unpaid invoice; subscription may already be paid' });
        }
        let paymentIntent = invoiceObj.payment_intent;
        if (typeof paymentIntent === 'string') {
          paymentIntent = await stripe.paymentIntents.retrieve(paymentIntent);
        }
        if (!paymentIntent?.client_secret) {
          return res.status(400).json({ error: 'Invoice is not ready to pay yet' });
        }
        return res.json({
          clientSecret: paymentIntent.client_secret,
          amount: invoiceObj.amount_due ? invoiceObj.amount_due / 100 : 0,
          currency: invoiceObj.currency || 'usd',
          invoiceId: invoiceObj.id
        });
      }

      // Case 2: No Stripe subscription — create one-off PaymentIntent for membership amount
      // Use monthly_amount_cents (total monthly charge after discounts); never charge standard rate when discount is set.
      const GYM_PRICING_CENTS = {
        standard: 6500,
        immediate_family_member: 5000,
        expecting_or_recovering_mother: 3000,
        entire_family: 18500
      };
      let amountCents = (membership.monthly_amount_cents != null && membership.monthly_amount_cents > 0)
        ? membership.monthly_amount_cents
        : (GYM_PRICING_CENTS[membership.membership_type] || 6500);

      // Safeguard: if member has a discount but monthly_amount_cents was never set, backfill before charging (e.g. Sharla)
      const userForBackfill = await db.getUserById(userId);
      const emailLower = (userForBackfill?.email || '').trim().toLowerCase();
      if (emailLower === 'sharla.barber@nebo.edu' && membership.membership_type === 'standard' &&
          (membership.monthly_amount_cents == null || membership.monthly_amount_cents === 0)) {
        try {
          await db.query(
            db.isPostgres
              ? `UPDATE gym_memberships SET monthly_amount_cents = 5000, discount_name = COALESCE(discount_name, $1), updated_at = CURRENT_TIMESTAMP WHERE id = $2`
              : `UPDATE gym_memberships SET monthly_amount_cents = 5000, discount_name = COALESCE(discount_name, ?), updated_at = datetime('now') WHERE id = ?`,
            ['Loyalty Discount (original price)', membership.id]
          );
          amountCents = 5000;
        } catch (e) {
          console.warn('Pay-overdue backfill monthly_amount_cents:', e?.message);
        }
      }

      // Payment rules (grace period, late fee) from membership-rules.json — add late fee when past grace
      let paymentRulesOneOff = { gracePeriodDays: 10, lateFee: 15 };
      try {
        const rules = require('./membership-rules.json');
        if (rules.paymentRules) {
          paymentRulesOneOff = {
            gracePeriodDays: typeof rules.paymentRules.gracePeriodDays === 'number' ? rules.paymentRules.gracePeriodDays : 10,
            lateFee: typeof rules.paymentRules.lateFee === 'number' ? rules.paymentRules.lateFee : 15
          };
        }
      } catch (e) { /* use defaults */ }
      const dueDateRaw = membership.contract_end_date; // period end = due date for this payment
      if (dueDateRaw) {
        const dueStr = typeof dueDateRaw === 'string' ? dueDateRaw.split('T')[0] : (dueDateRaw.toISOString ? dueDateRaw.toISOString().split('T')[0] : null);
        if (dueStr) {
          const graceEnd = new Date(dueStr);
          graceEnd.setDate(graceEnd.getDate() + paymentRulesOneOff.gracePeriodDays);
          const today = new Date();
          today.setHours(0, 0, 0, 0);
          graceEnd.setHours(0, 0, 0, 0);
          if (today > graceEnd) {
            const lateFeeCents = paymentRulesOneOff.lateFee * 100;
            amountCents += lateFeeCents;
          }
        }
      }

      let stripeCustomerId = membership.stripe_customer_id;
      if (!stripeCustomerId) {
        const user = await db.getUserById(userId);
        if (!user?.email) {
          return res.status(400).json({ error: 'User email not found' });
        }
        stripeCustomerId = user.stripe_customer_id;
        if (!stripeCustomerId) {
          // Prevent duplicate Stripe customers for the same email across retries/races.
          const existingCustomers = await stripe.customers.list({ email: user.email, limit: 1 });
          if (existingCustomers.data && existingCustomers.data.length > 0) {
            stripeCustomerId = existingCustomers.data[0].id;
          } else {
            const customer = await createCustomer(user.email);
            stripeCustomerId = customer.id;
          }
          await db.query(
            db.isPostgres
              ? 'UPDATE users SET stripe_customer_id = $1 WHERE id = $2'
              : 'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
            [stripeCustomerId, userId]
          );
        }
        await db.query(
          db.isPostgres
            ? 'UPDATE gym_memberships SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
            : 'UPDATE gym_memberships SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [stripeCustomerId, membership.id]
        );
      }

      // Reuse an open overdue PaymentIntent to avoid creating duplicates on retries.
      let paymentIntent = null;
      try {
        const existingIntents = await stripe.paymentIntents.list({
          customer: stripeCustomerId,
          limit: 10
        });
        paymentIntent = (existingIntents.data || []).find((pi) => {
          const sameType = pi.metadata?.type === 'gym_membership_one_off';
          const sameUser = pi.metadata?.user_id === userId.toString();
          const sameMembership = pi.metadata?.membership_id === membership.id.toString();
          const openStatus = pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation' || pi.status === 'requires_action' || pi.status === 'processing';
          return sameType && sameUser && sameMembership && openStatus;
        }) || null;
      } catch (listErr) {
        console.warn('Pay-overdue: failed to list existing intents, creating new one:', listErr.message);
      }

      if (!paymentIntent) {
        const cycleAnchor = (membership.contract_end_date || '').toString().split('T')[0].split(' ')[0] || 'no_cycle';
        const idempotencyKey = `gym_overdue_${userId}_${membership.id}_${stripeCustomerId}_${cycleAnchor}_${amountCents}`;
        paymentIntent = await stripe.paymentIntents.create({
          amount: amountCents,
          currency: 'usd',
          customer: stripeCustomerId,
          automatic_payment_methods: { enabled: true },
          setup_future_usage: 'off_session', // Save card on customer for future app-managed renewals
          metadata: {
            user_id: userId.toString(),
            membership_id: membership.id.toString(),
            membership_type: membership.membership_type || 'standard',
            type: 'gym_membership_one_off'
          }
        }, {
          idempotencyKey
        });
      }

      return res.json({
        clientSecret: paymentIntent.client_secret,
        amount: amountCents / 100,
        currency: 'usd'
      });
    } catch (error) {
      console.error('Pay overdue gym invoice error:', error);
      res.status(500).json({ error: error.message || 'Failed to get payment details' });
    }
  });

  // Sync latest gym payment from Stripe to DB (e.g. when user returns from 3DS redirect with gym_paid=1)
  router.post('/gym-memberships/sync-latest-payment', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const membership = await db.queryOne(
        db.isPostgres ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1' : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (!membership?.stripe_subscription_id) {
        return res.json({ success: true, synced: false });
      }
      const sub = await stripe.subscriptions.retrieve(membership.stripe_subscription_id, { expand: ['latest_invoice'] });
      const inv = sub.latest_invoice;
      if (!inv || typeof inv === 'string') return res.json({ success: true, synced: false });
      const invoice = typeof inv === 'string' ? await stripe.invoices.retrieve(inv) : inv;
      if (invoice.status !== 'paid' || !invoice.payment_intent) return res.json({ success: true, synced: false });
      const piId = typeof invoice.payment_intent === 'string' ? invoice.payment_intent : invoice.payment_intent.id;
      const amountCents = invoice.amount_paid || 0;
      const currency = invoice.currency || 'usd';
      let userEmail = null;
      try {
        const u = await db.getUserById(userId);
        userEmail = u?.email || null;
      } catch (e) { /* ignore */ }
      try {
        await db.createPayment(userId, piId, amountCents, currency, 'gym_membership', 'succeeded', userEmail);
        return res.json({ success: true, synced: true });
      } catch (e) {
        if (e.code === '23505' || e.code === 'SQLITE_CONSTRAINT' || (e.message && /unique|duplicate/i.test(e.message))) {
          return res.json({ success: true, synced: false });
        }
        throw e;
      }
    } catch (error) {
      console.error('Sync latest gym payment error:', error);
      res.status(500).json({ error: error.message || 'Failed to sync' });
    }
  });

  // Record overdue payment in DB (called by frontend after successful pay-overdue; webhook may not fire in time)
  // Handles both: (1) invoice-based (Stripe subscription), (2) one-off gym payment (no subscription)
  router.post('/gym-memberships/record-overdue-payment', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const { paymentIntentId } = req.body;
      if (!paymentIntentId) {
        return res.status(400).json({ error: 'paymentIntentId is required' });
      }
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (!membership) {
        return res.status(404).json({ error: 'No gym membership found' });
      }
      const pi = await stripe.paymentIntents.retrieve(paymentIntentId);
      if (pi.status !== 'succeeded') {
        return res.status(400).json({ error: 'Payment intent not succeeded' });
      }
      const amountCents = pi.amount_received || pi.amount || 0;
      const currency = pi.currency || 'usd';
      let userEmail = null;
      try {
        const user = await db.getUserById(userId);
        userEmail = user?.email || null;
      } catch (e) { /* ignore */ }

      // One-off gym payment (no Stripe subscription / no invoice)
      if (pi.metadata?.type === 'gym_membership_one_off') {
        if (pi.metadata.user_id !== userId.toString()) {
          return res.status(403).json({ error: 'Payment does not match your membership' });
        }
        try {
          await db.createPayment(userId, paymentIntentId, amountCents, currency, 'gym_membership', 'succeeded', userEmail);
        } catch (payErr) {
          if (payErr.code === '23505' || payErr.code === 'SQLITE_CONSTRAINT' || (payErr.message && /unique|duplicate/i.test(payErr.message))) {
            await db.query(
              db.isPostgres
                ? `UPDATE gym_memberships SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`
                : `UPDATE gym_memberships SET status = 'active', updated_at = datetime('now') WHERE id = ?`,
              [membership.id]
            );
            return res.json({ success: true, message: 'Payment already recorded' });
          }
          throw payErr;
        }
        // Extend contract_end_date by one month
        const contractEndStr = membership.contract_end_date ? String(membership.contract_end_date).trim().split('T')[0].split(' ')[0] : null;
        if (contractEndStr && /^\d{4}-\d{2}-\d{2}$/.test(contractEndStr)) {
          const endDate = new Date(contractEndStr + 'T00:00:00Z');
          endDate.setUTCMonth(endDate.getUTCMonth() + 1);
          const newEndStr = endDate.toISOString().split('T')[0];
          if (membership.family_group_id && membership.is_primary_member) {
            await db.query(
              db.isPostgres
                ? 'UPDATE gym_memberships SET contract_end_date = $1, status = \'active\', updated_at = CURRENT_TIMESTAMP WHERE family_group_id = $2'
                : 'UPDATE gym_memberships SET contract_end_date = ?, status = \'active\', updated_at = datetime(\'now\') WHERE family_group_id = ?',
              [newEndStr, membership.family_group_id]
            );
          } else {
            await db.query(
              db.isPostgres
                ? 'UPDATE gym_memberships SET contract_end_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
                : 'UPDATE gym_memberships SET contract_end_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
              [newEndStr, membership.id]
            );
          }
        }
        // Clear overdue state immediately after a confirmed payment (don't wait for webhook).
        await db.query(
          db.isPostgres
            ? `UPDATE gym_memberships
               SET status = 'active',
                   updated_at = CURRENT_TIMESTAMP
               WHERE id = $1`
            : `UPDATE gym_memberships
               SET status = 'active',
                   updated_at = datetime('now')
               WHERE id = ?`,
          [membership.id]
        );
        await persistGymMembershipCardFromSucceededPayment(stripe, db, membership, pi);
        return res.json({ success: true, message: 'Payment recorded' });
      }

      // Invoice-based (Stripe subscription)
      if (!membership.stripe_subscription_id) {
        return res.status(400).json({ error: 'Payment intent has no invoice' });
      }
      if (!pi.invoice) {
        return res.status(400).json({ error: 'Payment intent has no invoice' });
      }
      const invoice = await stripe.invoices.retrieve(pi.invoice);
      if (String(invoice.subscription) !== String(membership.stripe_subscription_id)) {
        return res.status(403).json({ error: 'Payment does not match your membership' });
      }
      try {
        await db.createPayment(userId, paymentIntentId, amountCents, currency, 'gym_membership', 'succeeded', userEmail);
      } catch (payErr) {
        if (payErr.code === '23505' || payErr.code === 'SQLITE_CONSTRAINT' || (payErr.message && /unique|duplicate/i.test(payErr.message))) {
          await db.query(
            db.isPostgres
              ? `UPDATE gym_memberships SET status = 'active', updated_at = CURRENT_TIMESTAMP WHERE id = $1`
              : `UPDATE gym_memberships SET status = 'active', updated_at = datetime('now') WHERE id = ?`,
            [membership.id]
          );
          return res.json({ success: true, message: 'Payment already recorded' });
        }
        throw payErr;
      }
      // Clear overdue state immediately after a confirmed invoice payment.
      await db.query(
        db.isPostgres
          ? `UPDATE gym_memberships
             SET status = 'active',
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = $1`
          : `UPDATE gym_memberships
             SET status = 'active',
                 updated_at = datetime('now')
             WHERE id = ?`,
        [membership.id]
      );
      await persistGymMembershipCardFromSucceededPayment(stripe, db, membership, pi);
      res.json({ success: true, message: 'Payment recorded' });
    } catch (error) {
      console.error('Record overdue payment error:', error);
      res.status(500).json({ error: error.message || 'Failed to record payment' });
    }
  });

  // Validate household ID
  router.get('/gym-memberships/validate-household/:householdId', authenticateToken, async (req, res) => {
    try {
      const { householdId } = req.params;
      const userId = req.userId;

      // Validate household ID format (should be like "HH-XXXXXX")
      if (!householdId || !householdId.match(/^HH-[A-Z0-9]{6}$/)) {
        return res.status(400).json({ error: 'Invalid household ID format' });
      }

      // Find primary member with this household ID
      const primaryMember = await db.queryOne(
        db.isPostgres
          ? 'SELECT u.id, u.email, u.name, gm.household_id FROM users u JOIN gym_memberships gm ON u.id = gm.user_id WHERE gm.household_id = $1 AND gm.is_primary_member = true AND gm.status = $2 LIMIT 1'
          : 'SELECT u.id, u.email, u.name, gm.household_id FROM users u JOIN gym_memberships gm ON u.id = gm.user_id WHERE gm.household_id = ? AND gm.is_primary_member = true AND gm.status = ? LIMIT 1',
        [householdId, 'active']
      );

      if (!primaryMember) {
        return res.status(404).json({ error: 'Household ID not found or no active primary member' });
      }

      // Check if there's already a standard membership for this household
      const existingStandard = await db.queryOne(
        db.isPostgres
          ? 'SELECT id FROM gym_memberships WHERE household_id = $1 AND membership_type = $2 AND status = $3 LIMIT 1'
          : 'SELECT id FROM gym_memberships WHERE household_id = ? AND membership_type = ? AND status = ? LIMIT 1',
        [householdId, 'standard', 'active']
      );

      if (existingStandard) {
        return res.status(400).json({ error: 'This household already has an active standard membership' });
      }

      // Get primary member's address from Stripe customer metadata if available
      let primaryMemberAddress = null;
      try {
        const user = await db.getUserById(primaryMember.id);
        if (user && user.stripe_customer_id) {
          const customer = await stripe.customers.retrieve(user.stripe_customer_id);
          if (customer.metadata && customer.metadata.address) {
            try {
              primaryMemberAddress = JSON.parse(customer.metadata.address);
            } catch (e) {
              // If JSON parse fails, try individual fields
              primaryMemberAddress = {
                street: customer.metadata.address_street || '',
                city: customer.metadata.address_city || '',
                state: customer.metadata.address_state || '',
                zip: customer.metadata.address_zip || ''
              };
            }
          } else if (customer.metadata) {
            primaryMemberAddress = {
              street: customer.metadata.address_street || '',
              city: customer.metadata.address_city || '',
              state: customer.metadata.address_state || '',
              zip: customer.metadata.address_zip || ''
            };
          }
        }
      } catch (stripeError) {
        console.error('Error fetching primary member address from Stripe:', stripeError.message);
        // Continue without address - not critical
      }

      res.json({
        valid: true,
        primaryMember: {
          name: primaryMember.name || 'Primary Member',
          email: primaryMember.email
        },
        primaryMemberAddress: primaryMemberAddress
      });
    } catch (error) {
      console.error('Validate household error:', error);
      res.status(500).json({ error: 'Failed to validate household ID: ' + error.message });
    }
  });

  // Create gym membership
  router.post('/gym-memberships/create', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const b = req.body;
      // Accept both flat and nested payload (membership-signup.js sends nested)
      const profile = b.profile;
      const address = b.address;
      const membershipTypeRaw = b.membershipType ?? b.membership?.membershipType;
      const membershipType = membershipTypeRaw ? (membershipTypeToDb(membershipTypeRaw) || membershipTypeRaw) : null;
      const householdId = b.householdId ?? b.household?.householdId ?? null;
      const isPrimaryMember = b.isPrimaryMember ?? (b.household?.householdRole === 'PRIMARY' || b.household?.householdRole === 'INDEPENDENT');
      const billingMode = b.billingMode ?? b.household?.billingMode ?? null;
      const groupCode = b.groupCode ?? b.group?.groupCode ?? null;
      const emergencyContact = b.emergencyContact;
      const contractMonths = b.contractMonths ?? b.contract?.contractLengthMonths ?? 12;

      // Validate required fields
      if (!profile || !membershipType) {
        return res.status(400).json({ error: 'Profile and membership type are required' });
      }

      const pv = gymProfileSchema.validateCreateMembershipProfilePayload(profile, address, emergencyContact);
      if (!pv.ok) {
        if (pv.missing && pv.missing.length) {
          return res.status(400).json({ error: 'Missing required profile fields', missingFields: pv.missing });
        }
        return res.status(400).json({ error: 'Invalid profile fields', invalidFields: pv.invalid });
      }

      const ack = b.acknowledgements || {};
      if (!ack.membershipContractTermsAcceptedAt) {
        return res.status(400).json({
          error: 'Membership contract terms must be acknowledged (contract dates, cancellation fee, and pause policy) before completing signup.'
        });
      }

      try {
        await db.upsertCustomerProfile(
          userId,
          pv.normalized.profile,
          pv.normalized.address,
          pv.normalized.emergencyContact
        );
      } catch (profileError) {
        console.error('Error saving customer profile:', profileError.message);
        return res.status(400).json({ error: 'Could not save profile: ' + profileError.message });
      }

      // Check for existing active membership
      const existing = await db.queryOne(
        db.isPostgres
          ? 'SELECT id FROM gym_memberships WHERE user_id = $1 AND status = $2'
          : 'SELECT id FROM gym_memberships WHERE user_id = ? AND status = ?',
        [userId, 'active']
      );

      if (existing) {
        return res.status(400).json({ error: 'User already has an active membership' });
      }

      // Generate household ID if primary member
      let finalHouseholdId = householdId;
      if (isPrimaryMember && !finalHouseholdId) {
        // Generate unique household ID: HH-XXXXXX (6 alphanumeric characters)
        const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
        let generated = 'HH-';
        for (let i = 0; i < 6; i++) {
          generated += chars.charAt(Math.floor(Math.random() * chars.length));
        }
        finalHouseholdId = generated;
      }

      // Validate group code if provided
      let discountGroupId = null;
      if (groupCode) {
        const group = await db.queryOne(
          db.isPostgres
            ? 'SELECT id FROM discount_groups WHERE code = $1 AND active = true'
            : 'SELECT id FROM discount_groups WHERE code = ? AND active = 1',
          [groupCode.toUpperCase()]
        );
        if (!group) {
          return res.status(400).json({ error: 'Invalid group code' });
        }
        discountGroupId = group.id;
      }

      // Contract billing dates are set ONLY when the first payment succeeds (confirm-payment
      // or payment_intent.succeeded webhook) — never at signup, so failed attempts don't anchor the term.
      // Insert membership record (contract_start_date / contract_end_date NULL until paid)
      const membershipId = await db.query(
        db.isPostgres
          ? `INSERT INTO gym_memberships (user_id, membership_type, household_id, is_primary_member, status, contract_start_date, contract_end_date, contract_months, discount_group_id, created_at)
             VALUES ($1, $2, $3, $4, $5, NULL, NULL, $6, $7, CURRENT_TIMESTAMP) RETURNING id`
          : `INSERT INTO gym_memberships (user_id, membership_type, household_id, is_primary_member, status, contract_start_date, contract_end_date, contract_months, discount_group_id, created_at)
             VALUES (?, ?, ?, ?, ?, NULL, NULL, ?, ?, datetime('now'))`,
        [
          userId,
          membershipType,
          finalHouseholdId,
          isPrimaryMember ? 1 : 0,
          'active',
          contractMonths,
          discountGroupId
        ]
      );

      const newMembershipId = membershipId.rows?.[0]?.id ?? membershipId.lastID ?? null;
      if (newMembershipId == null) {
        console.error('Create gym membership: INSERT did not return id. Result:', membershipId);
        return res.status(500).json({ error: 'Failed to create membership record' });
      }

      // Update user's name if provided
      if (profile.firstName && profile.lastName) {
        const fullName = `${profile.firstName} ${profile.lastName}`.trim();
        try {
          await db.updateUserName(userId, fullName);
        } catch (nameError) {
          console.error('Error updating user name:', nameError.message);
          // Don't fail the request if name update fails
        }
      }

      res.json({
        success: true,
        membershipId: newMembershipId,
        householdId: finalHouseholdId
      });
    } catch (error) {
      console.error('Create gym membership error:', error);
      res.status(500).json({ error: 'Failed to create membership: ' + error.message });
    }
  });

  // Same required/optional rules as config/gym-member-profile-schema.js (also GET .../profile-schema)
  router.get('/gym-memberships/profile-schema', (req, res) => {
    res.json({
      required: gymProfileSchema.REQUIRED_FIELDS.map((f) => ({ key: f.dbKey, label: f.label })),
      optional: gymProfileSchema.OPTIONAL_FIELDS.map((f) => ({ key: f.dbKey, label: f.label }))
    });
  });

  // Save required member profile fields for migrated/admin-added users.
  router.post('/gym-memberships/profile', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT membership_type, is_primary_member FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT membership_type, is_primary_member FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      const isImmediateFamilyDependent =
        membership &&
        String(membership.membership_type || '').toLowerCase() === 'immediate_family_member' &&
        !membership.is_primary_member;
      if (isImmediateFamilyDependent) {
        const phoneRaw = req.body?.profile?.phone;
        const normalizedPhone = gymProfileSchema.normalizePhone(phoneRaw || '');
        if (!normalizedPhone) {
          return res.status(400).json({
            error: 'Invalid profile fields',
            invalidFields: ['Phone must be a valid 10-digit US phone']
          });
        }
        const existingProfile = await db.queryOne(
          db.isPostgres
            ? `SELECT first_name, last_name, date_of_birth, gender, street, city, state, zip,
                      emergency_contact_name, emergency_contact_phone
               FROM customer_profiles WHERE user_id = $1`
            : `SELECT first_name, last_name, date_of_birth, gender, street, city, state, zip,
                      emergency_contact_name, emergency_contact_phone
               FROM customer_profiles WHERE user_id = ?`,
          [userId]
        );
        await db.upsertCustomerProfile(
          userId,
          {
            firstName: existingProfile?.first_name || '',
            lastName: existingProfile?.last_name || '',
            dateOfBirth: existingProfile?.date_of_birth || null,
            gender: existingProfile?.gender || null,
            phone: normalizedPhone
          },
          {
            street: existingProfile?.street || '',
            city: existingProfile?.city || '',
            state: existingProfile?.state || '',
            zip: existingProfile?.zip || ''
          },
          {
            name: existingProfile?.emergency_contact_name || '',
            phone: existingProfile?.emergency_contact_phone || ''
          }
        );
        return res.json({ success: true, mode: 'phone_only' });
      }
      const v = gymProfileSchema.validateGymMembershipProfilePayload(req.body || {});
      if (!v.ok) {
        if (v.missing && v.missing.length) {
          return res.status(400).json({ error: 'Missing required profile fields', missingFields: v.missing });
        }
        return res.status(400).json({ error: 'Invalid profile fields', invalidFields: v.invalid });
      }
      await db.upsertCustomerProfile(
        userId,
        v.normalized.profile,
        v.normalized.address,
        v.normalized.emergencyContact
      );
      res.json({ success: true });
    } catch (error) {
      console.error('Save gym profile error:', error);
      res.status(500).json({ error: 'Failed to save profile: ' + error.message });
    }
  });

  // Create payment intent for gym membership
  router.post('/gym-memberships/create-payment-intent', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const { membershipType } = req.body;

      if (!membershipType) {
        return res.status(400).json({ error: 'Membership type is required' });
      }

      // Get or create Stripe customer
      const user = await db.getUserById(userId);
      let stripeCustomerId = user.stripe_customer_id;

      if (!stripeCustomerId) {
        // Prevent duplicate Stripe customers for the same email across retries/races.
        const existingCustomers = await stripe.customers.list({ email: user.email, limit: 1 });
        if (existingCustomers.data && existingCustomers.data.length > 0) {
          stripeCustomerId = existingCustomers.data[0].id;
        } else {
          const customer = await createCustomer(user.email);
          stripeCustomerId = customer.id;
        }
        await db.query(
          db.isPostgres
            ? 'UPDATE users SET stripe_customer_id = $1 WHERE id = $2'
            : 'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
          [stripeCustomerId, userId]
        );
      }

      // Normalize membership type (frontend sends EXPECTING_RECOVERING; DB uses expecting_or_recovering_mother)
      const normalizedType = membershipTypeToDb(membershipType) || membershipType.toLowerCase().replace(/[_ ]/g, '_');
      // Calculate amount based on membership type
      const membershipTypeToPrice = {
        'standard': 6500,              // $65.00/month
        'immediate_family_member': 5000,      // $50.00/month
        'expecting_or_recovering_mother': 3000,  // $30.00/month
        'entire_family': 18500           // $185.00/month
      };

      const amount = membershipTypeToPrice[normalizedType] || 6500;

      // Reuse an existing open PaymentIntent for this user/type to prevent duplicate charges
      // if the user retries/reloads during signup.
      let paymentIntent = null;
      try {
        const existingIntents = await stripe.paymentIntents.list({
          customer: stripeCustomerId,
          limit: 10
        });
        paymentIntent = (existingIntents.data || []).find((pi) => {
          const sameType = pi.metadata?.type === 'gym_membership';
          const sameUser = pi.metadata?.userId === userId.toString();
          const sameMembershipType = pi.metadata?.membershipType === normalizedType;
          const openStatus = pi.status === 'requires_payment_method' || pi.status === 'requires_confirmation' || pi.status === 'requires_action' || pi.status === 'processing';
          return sameType && sameUser && sameMembershipType && openStatus;
        }) || null;
      } catch (listErr) {
        console.warn('Create payment intent: failed to list existing intents, creating new one:', listErr.message);
      }

      // Create payment intent with setup_future_usage to automatically save payment method
      // This ensures the payment method is attached to the customer when payment succeeds
      // and prevents the "previously used" error
      if (!paymentIntent) {
        const idempotencyKey = `gym_signup_${userId}_${stripeCustomerId}_${normalizedType}_${amount}`;
        paymentIntent = await stripe.paymentIntents.create({
          amount: amount,
          currency: 'usd',
          customer: stripeCustomerId,
          metadata: {
            userId: userId.toString(),
            membershipType: normalizedType,
            type: 'gym_membership'
          },
          automatic_payment_methods: {
            enabled: true
          },
          setup_future_usage: 'off_session' // Automatically save payment method for future use (subscriptions)
        }, {
          idempotencyKey
        });
      }

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (error) {
      console.error('Create payment intent error:', error);
      res.status(500).json({ error: 'Failed to create payment intent: ' + error.message });
    }
  });

  // Create payment intent for gym drop-in
  // NOTE: Intentionally unauthenticated so visitors can pay a drop-in fee without signing in.
  router.post('/gym-memberships/drop-in/create-payment-intent', async (req, res) => {
    try {
      const { email, waiverSignature } = req.body || {};

      if (!email || !waiverSignature) {
        return res.status(400).json({ error: 'Email and waiver signature are required' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      let user = await db.getUserByEmail(normalizedEmail);
      if (!user) {
        // Create a lightweight user record so the payment can be associated to an account for future visits
        const placeholderPassword = 'DROPIN_USER_' + Date.now() + Math.random().toString(36);
        user = await db.createUser(normalizedEmail, placeholderPassword);
      }
      const userId = user.id;

      let stripeCustomerId = user.stripe_customer_id;
      if (!stripeCustomerId) {
        const customer = await createCustomer(user.email || normalizedEmail);
        stripeCustomerId = customer.id;
        await db.query(
          db.isPostgres
            ? 'UPDATE users SET stripe_customer_id = $1 WHERE id = $2'
            : 'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
          [stripeCustomerId, userId]
        );
      }

      const amount = 500; // $5.00
      const paymentIntent = await stripe.paymentIntents.create({
        amount,
        currency: 'usd',
        customer: stripeCustomerId,
        metadata: {
          userId: userId.toString(),
          type: 'drop_in',
          email: String(email).slice(0, 500),
          waiverSignature: String(waiverSignature).slice(0, 500)
        },
        automatic_payment_methods: { enabled: true }
      });

      // Do NOT create a payment row here - it would be status 'requires_payment_method' and
      // pollute the DB with incomplete attempts. Row is created only on success via
      // confirm-from-client or payment_intent.succeeded webhook.

      res.json({
        clientSecret: paymentIntent.client_secret,
        paymentIntentId: paymentIntent.id
      });
    } catch (error) {
      console.error('Drop-in create payment intent error:', error);
      res.status(500).json({ error: 'Failed to create drop-in payment intent: ' + error.message });
    }
  });

  // Confirm drop-in payment from client (UI) by marking the payment record as succeeded
  // This supplements the Stripe webhook so that admin drop-ins can update immediately after a successful payment
  // If no row exists yet (we only create on success), creates the row from Stripe PaymentIntent.
  router.post('/gym-memberships/drop-in/confirm-from-client', async (req, res) => {
    try {
      const { paymentIntentId } = req.body || {};
      if (!paymentIntentId) {
        return res.status(400).json({ error: 'paymentIntentId is required' });
      }

      const updated = await db.updatePayment(paymentIntentId, 'succeeded');
      if (updated) {
        return res.json({ ok: true });
      }

      // No row exists (we don't create until success). Create it from Stripe.
      let paymentIntent;
      try {
        paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId);
      } catch (stripeErr) {
        console.error('Drop-in confirm: failed to retrieve PaymentIntent:', stripeErr.message);
        return res.status(502).json({ error: 'Could not verify payment with Stripe' });
      }
      if (paymentIntent.status !== 'succeeded') {
        return res.status(400).json({ error: 'Payment has not succeeded', status: paymentIntent.status });
      }
      if (paymentIntent.metadata?.type !== 'drop_in') {
        return res.status(400).json({ error: 'Not a drop-in payment' });
      }
      const userId = parseInt(paymentIntent.metadata.userId, 10);
      const email = paymentIntent.metadata.email || '';
      if (!userId) {
        return res.status(400).json({ error: 'Invalid payment metadata' });
      }
      await db.createPayment(
        userId,
        paymentIntent.id,
        paymentIntent.amount,
        paymentIntent.currency,
        'drop_in',
        'succeeded',
        email
      );
      res.json({ ok: true });
    } catch (error) {
      console.error('Drop-in client confirm error:', error);
      res.status(500).json({ error: 'Failed to confirm drop-in payment' });
    }
  });

  // Buddy pass: class options by weekday (0=Sun, 1=Mon, ..., 6=Sat). No Sunday.
  const BUDDY_PASS_CLASSES = {
    1: [{ time: '5:00AM', name: 'Functional Fitness' }, { time: '6:00AM', name: 'Functional Fitness' }, { time: '7:00AM', name: 'Functional Fitness' }, { time: '8:00AM', name: 'Open Gym' }, { time: '9:00AM', name: 'Functional Fitness' }],
    2: [{ time: '5:00AM', name: 'Functional Fitness' }, { time: '6:00AM', name: 'Functional Fitness' }, { time: '7:00AM', name: 'Functional Fitness' }, { time: '8:00AM', name: 'Open Gym' }, { time: '9:00AM', name: 'Functional Fitness' }],
    3: [{ time: '5:00AM', name: 'Functional Fitness' }, { time: '6:00AM', name: 'Functional Fitness' }, { time: '7:00AM', name: 'Functional Fitness' }, { time: '8:00AM', name: 'Open Gym' }, { time: '9:00AM', name: 'Functional Fitness' }],
    4: [{ time: '5:00AM', name: 'Functional Fitness' }, { time: '6:00AM', name: 'Functional Fitness' }, { time: '7:00AM', name: 'Functional Fitness' }, { time: '8:00AM', name: 'Open Gym' }, { time: '9:00AM', name: 'Functional Fitness' }],
    5: [{ time: '5:00AM', name: 'Functional Fitness' }, { time: '6:00AM', name: 'Functional Fitness' }, { time: '7:00AM', name: 'Functional Fitness' }, { time: '8:00AM', name: 'Open Gym' }, { time: '9:00AM', name: 'Functional Fitness' }],
    6: [{ time: '7:00AM', name: 'Functional Fitness' }]
  };

  function getMondayOfWeek(dateStr) {
    const d = new Date(dateStr + 'T12:00:00');
    const day = d.getDay();
    const diff = d.getDate() - day + (day === 0 ? -6 : 1);
    const monday = new Date(d);
    monday.setDate(diff);
    return monday.toISOString().slice(0, 10);
  }

  function isBeforeDeadline(visitDateStr) {
    const now = new Date();
    const mtOffset = -7 * 60 * 60 * 1000;
    const mtNow = new Date(now.getTime() + mtOffset);
    const today = mtNow.toISOString().slice(0, 10);
    const deadline = new Date(visitDateStr + 'T00:00:00');
    deadline.setDate(deadline.getDate() - 1);
    const deadlineStr = deadline.toISOString().slice(0, 10);
    return today <= deadlineStr;
  }

  function generatePin() {
    return String(Math.floor(100000 + Math.random() * 900000));
  }

  // Get buddy pass class options (public, for dropdown)
  router.get('/buddy-passes/classes', (req, res) => {
    res.json({ classes: BUDDY_PASS_CLASSES });
  });

  // Create buddy pass (auth)
  router.post('/buddy-passes', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const { buddy_name, buddy_phone, buddy_email, visit_date, class_time, class_name } = req.body || {};

      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      if (!membership || membership.status !== 'active') {
        return res.status(403).json({ error: 'Active gym membership required. Buddy pass is not available when membership is paused or inactive.' });
      }

      if (!buddy_name || !buddy_phone || !buddy_email || !visit_date || !class_time || !class_name) {
        return res.status(400).json({ error: 'buddy_name, buddy_phone, buddy_email, visit_date, class_time, and class_name are required' });
      }

      const phoneDigits = buddy_phone.replace(/\D/g, '');
      if (phoneDigits.length !== 10) {
        return res.status(400).json({ error: 'Phone must be 10 digits (US only)' });
      }

      const visitDate = new Date(visit_date + 'T12:00:00');
      const dayOfWeek = visitDate.getDay();
      if (dayOfWeek === 0) {
        return res.status(400).json({ error: 'No Sunday visits. Gym is closed.' });
      }
      const options = BUDDY_PASS_CLASSES[dayOfWeek];
      if (!options || !options.some(o => o.time === class_time && o.name === class_name)) {
        return res.status(400).json({ error: 'Invalid class for this day' });
      }

      if (!isBeforeDeadline(visit_date)) {
        return res.status(400).json({ error: 'Buddy pass must be added by the day before the visit (before midnight MT)' });
      }

      const weekStart = getMondayOfWeek(visit_date);
      const existing = await db.getBuddyPassForWeek(userId, weekStart);
      if (existing) {
        return res.status(400).json({ error: 'One buddy pass per week (Mon–Sun). You already have one for this week.' });
      }

      const pin = generatePin();
      const pass = await db.createBuddyPass(userId, buddy_name.trim(), phoneDigits, buddy_email.trim().toLowerCase(), visit_date, class_time, class_name, pin);
      res.status(201).json({ buddy_pass: pass });
    } catch (error) {
      console.error('Create buddy pass error:', error);
      res.status(500).json({ error: 'Failed to create buddy pass: ' + error.message });
    }
  });

  // Get my buddy passes (auth)
  router.get('/buddy-passes/me', authenticateToken, async (req, res) => {
    try {
      const passes = await db.getBuddyPassesByMember(req.userId);
      res.json({ buddy_passes: passes });
    } catch (error) {
      console.error('List buddy passes error:', error);
      res.status(500).json({ error: 'Failed to list buddy passes' });
    }
  });

  // Update or cancel buddy pass (auth)
  router.patch('/buddy-passes/:id', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const passId = parseInt(req.params.id, 10);
      const pass = await db.getBuddyPassById(passId);
      if (!pass || pass.member_user_id !== userId) {
        return res.status(404).json({ error: 'Buddy pass not found' });
      }
      if (pass.status !== 'pending') {
        return res.status(400).json({ error: 'Cannot modify a confirmed or cancelled pass' });
      }
      if (!isBeforeDeadline(pass.visit_date)) {
        return res.status(400).json({ error: 'Cannot modify after the deadline (day before visit)' });
      }

      const { buddy_name, buddy_phone, buddy_email, visit_date, class_time, class_name, cancel } = req.body || {};
      if (cancel === true) {
        await db.updateBuddyPass(passId, { status: 'cancelled', cancelled_at: new Date().toISOString() });
        return res.json({ buddy_pass: await db.getBuddyPassById(passId) });
      }

      const updates = {};
      if (buddy_name !== undefined) updates.buddy_name = buddy_name.trim();
      if (buddy_phone !== undefined) {
        const phoneDigits = buddy_phone.replace(/\D/g, '');
        if (phoneDigits.length !== 10) return res.status(400).json({ error: 'Phone must be 10 digits (US only)' });
        updates.buddy_phone = phoneDigits;
      }
      if (buddy_email !== undefined) updates.buddy_email = buddy_email.trim().toLowerCase();
      if (visit_date !== undefined) {
        const d = new Date(visit_date + 'T12:00:00');
        if (d.getDay() === 0) return res.status(400).json({ error: 'No Sunday visits' });
        const options = BUDDY_PASS_CLASSES[d.getDay()];
        if (!options) return res.status(400).json({ error: 'Invalid visit date' });
        updates.visit_date = visit_date;
      }
      if (class_time !== undefined && class_name !== undefined) {
        const d = new Date((visit_date || pass.visit_date) + 'T12:00:00');
        const options = BUDDY_PASS_CLASSES[d.getDay()];
        if (!options || !options.some(o => o.time === class_time && o.name === class_name)) {
          return res.status(400).json({ error: 'Invalid class for this day' });
        }
        updates.class_time = class_time;
        updates.class_name = class_name;
      }
      if (Object.keys(updates).length === 0) {
        return res.json({ buddy_pass: pass });
      }
      const updated = await db.updateBuddyPass(passId, updates);
      res.json({ buddy_pass: updated });
    } catch (error) {
      console.error('Update buddy pass error:', error);
      res.status(500).json({ error: 'Failed to update buddy pass: ' + error.message });
    }
  });

  // Verify buddy pass (public) - email + PIN must match
  router.get('/buddy-passes/verify', async (req, res) => {
    try {
      const { email, pin } = req.query || {};
      if (!email || !pin) {
        return res.status(400).json({ error: 'email and pin are required' });
      }
      const pass = await db.getBuddyPassByEmailAndPin(email, pin);
      if (!pass) {
        return res.status(404).json({ error: 'No matching buddy pass found. Check your email and PIN.' });
      }
      res.json({ buddy_pass: { visit_date: pass.visit_date, class_time: pass.class_time, class_name: pass.class_name, buddy_name: pass.buddy_name } });
    } catch (error) {
      console.error('Verify buddy pass error:', error);
      res.status(500).json({ error: 'Failed to verify buddy pass' });
    }
  });

  // Confirm buddy pass waiver (public) - no charge
  router.post('/buddy-passes/confirm', async (req, res) => {
    try {
      const { email, pin, waiverSignature } = req.body || {};
      if (!email || !pin || !waiverSignature) {
        return res.status(400).json({ error: 'email, pin, and waiverSignature are required' });
      }
      const pass = await db.getBuddyPassByEmailAndPin(email, pin);
      if (!pass) {
        return res.status(404).json({ error: 'No matching buddy pass found. Check your email and PIN.' });
      }

      const normalizedEmail = String(email).trim().toLowerCase();
      let user = await db.getUserByEmail(normalizedEmail);
      if (!user) {
        const placeholderPassword = 'BUDDY_PASS_' + Date.now() + Math.random().toString(36);
        user = await db.createUser(normalizedEmail, placeholderPassword, pass.buddy_name);
      }

      const stripeIntentId = 'buddy_pass_' + pass.id;
      const { id: paymentId } = await db.createPayment(user.id, stripeIntentId, 0, 'usd', 'buddy_pass', 'succeeded', normalizedEmail);

      await db.updateBuddyPass(pass.id, {
        status: 'confirmed',
        buddy_user_id: user.id,
        payment_id: paymentId,
        confirmed_at: new Date().toISOString()
      });

      res.json({ ok: true, message: 'Buddy pass confirmed. You\'re all set for your visit!' });
    } catch (error) {
      console.error('Confirm buddy pass error:', error);
      res.status(500).json({ error: 'Failed to confirm buddy pass: ' + error.message });
    }
  });

  // Add payment method to existing gym membership subscription
  router.post('/gym-memberships/add-payment-method', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      
      // Get user's gym membership
      const membership = await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
          : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
        [userId]
      );
      
      if (!membership) {
        return res.status(404).json({ error: 'Gym membership not found' });
      }
      
      // If membership has no Stripe customer (e.g. migrated member), get or create one
      let stripeCustomerId = membership.stripe_customer_id;
      if (!stripeCustomerId) {
        const user = await db.getUserById(userId);
        if (!user || !user.email) {
          return res.status(400).json({ error: 'User email not found' });
        }
        stripeCustomerId = user.stripe_customer_id;
        if (!stripeCustomerId) {
          const customer = await createCustomer(user.email);
          stripeCustomerId = customer.id;
          await db.query(
            db.isPostgres
              ? 'UPDATE users SET stripe_customer_id = $1 WHERE id = $2'
              : 'UPDATE users SET stripe_customer_id = ? WHERE id = ?',
            [stripeCustomerId, userId]
          );
        }
        await db.query(
          db.isPostgres
            ? 'UPDATE gym_memberships SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
            : 'UPDATE gym_memberships SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ?',
          [stripeCustomerId, membership.id]
        );
      }
      
      // Create setup intent to save payment method
      const setupIntent = await stripe.setupIntents.create({
        customer: stripeCustomerId,
        payment_method_types: ['card'],
        usage: 'off_session',
        metadata: {
          userId: userId.toString(),
          membershipId: membership.id.toString(),
          type: 'gym_membership'
        }
      });
      
      res.json({
        setupIntentId: setupIntent.id,
        clientSecret: setupIntent.client_secret
      });
    } catch (error) {
      console.error('Add payment method error:', error);
      res.status(500).json({ error: 'Failed to create setup intent: ' + error.message });
    }
  });

  // Confirm payment method and set as default on subscription (or customer only when no subscription)
  router.post('/gym-memberships/confirm-payment-method', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const { setupIntentId, subscriptionId } = req.body;

      if (!setupIntentId) {
        return res.status(400).json({ error: 'Setup intent ID is required' });
      }

      // Get user's gym membership (by user_id; if subscriptionId provided, also match it for subscription flow)
      let membership;
      if (subscriptionId) {
        membership = await db.queryOne(
          db.isPostgres
            ? 'SELECT * FROM gym_memberships WHERE user_id = $1 AND stripe_subscription_id = $2'
            : 'SELECT * FROM gym_memberships WHERE user_id = ? AND stripe_subscription_id = ?',
          [userId, subscriptionId]
        );
      } else {
        membership = await db.queryOne(
          db.isPostgres
            ? 'SELECT * FROM gym_memberships WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1'
            : 'SELECT * FROM gym_memberships WHERE user_id = ? ORDER BY created_at DESC LIMIT 1',
          [userId]
        );
      }

      if (!membership) {
        return res.status(404).json({ error: 'Gym membership not found' });
      }
      
      // Ensure Stripe customer exists (e.g. migrated member from before we set it in confirm-migration)
      if (!membership.stripe_customer_id) {
        const user = await db.getUserById(userId);
        if (!user || !user.email) {
          return res.status(400).json({ error: 'User email not found' });
        }
        let stripeCustomerId = user.stripe_customer_id;
        if (!stripeCustomerId) {
          const customer = await createCustomer(user.email);
          stripeCustomerId = customer.id;
          await db.query(db.isPostgres ? 'UPDATE users SET stripe_customer_id = $1 WHERE id = $2' : 'UPDATE users SET stripe_customer_id = ? WHERE id = ?', [stripeCustomerId, userId]);
        }
        await db.query(db.isPostgres ? 'UPDATE gym_memberships SET stripe_customer_id = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2' : 'UPDATE gym_memberships SET stripe_customer_id = ?, updated_at = datetime(\'now\') WHERE id = ?', [stripeCustomerId, membership.id]);
        membership.stripe_customer_id = stripeCustomerId;
      }
      
      // Retrieve setup intent
      const setupIntent = await stripe.setupIntents.retrieve(setupIntentId);
      
      if (setupIntent.status !== 'succeeded') {
        return res.status(400).json({ error: 'Setup intent not succeeded' });
      }
      
      if (!setupIntent.payment_method) {
        return res.status(400).json({ error: 'No payment method in setup intent' });
      }
      
      const paymentMethodId = setupIntent.payment_method;
      
      // Verify payment method is attached to customer
      const paymentMethod = await stripe.paymentMethods.retrieve(paymentMethodId);
      if (paymentMethod.customer !== membership.stripe_customer_id) {
        // Attach if not attached
        await stripe.paymentMethods.attach(paymentMethodId, {
          customer: membership.stripe_customer_id
        });
      }
      
      // Set as default payment method for customer
      await stripe.customers.update(membership.stripe_customer_id, {
        invoice_settings: {
          default_payment_method: paymentMethodId
        }
      });

      // If membership has a Stripe subscription, set default on subscription too
      if (membership.stripe_subscription_id) {
        await stripe.subscriptions.update(membership.stripe_subscription_id, {
          default_payment_method: paymentMethodId
        });
      }
      
      // Save payment method to database (hybrid system)
      let paymentMethodExpiresAt = null;
      try {
        const pm = await stripe.paymentMethods.retrieve(paymentMethodId);
        if (pm.card && pm.card.exp_year && pm.card.exp_month) {
          paymentMethodExpiresAt = new Date(pm.card.exp_year, pm.card.exp_month, 0, 23, 59, 59).toISOString();
        }
      } catch (pmError) {
        console.warn('Could not retrieve payment method expiry:', pmError.message);
      }
      
      await db.updateGymMembershipPaymentMethod(membership.id, paymentMethodId, paymentMethodExpiresAt);

      console.log(`Payment method ${paymentMethodId} set as default for gym membership ${membership.id}${membership.stripe_subscription_id ? ' (subscription ' + membership.stripe_subscription_id + ')' : ' (app-controlled billing)'}`);
      
      // If first charge is due today or in the past, charge now (migrated members with start date today)
      const GYM_MEMBERSHIP_PRICING = {
        'standard': 6500,
        'immediate_family_member': 5000,
        'expecting_or_recovering_mother': 3000,
        'entire_family': 18500
      };
      const contractEndStr = membership.contract_end_date ? String(membership.contract_end_date).trim().split('T')[0].split(' ')[0] : '';
      const contractEndDate = contractEndStr && /^\d{4}-\d{2}-\d{2}$/.test(contractEndStr) ? new Date(contractEndStr + 'T00:00:00Z') : null;
      const today = new Date();
      today.setUTCHours(0, 0, 0, 0);
      const isDueNow = contractEndDate && (contractEndDate.getTime() <= today.getTime() + 24 * 60 * 60 * 1000);
      if (isDueNow && membership.stripe_customer_id) {
        const amountCents = (membership.monthly_amount_cents != null && membership.monthly_amount_cents > 0)
          ? membership.monthly_amount_cents
          : (GYM_MEMBERSHIP_PRICING[membership.membership_type] || 6500);
        try {
          const paymentIntent = await stripe.paymentIntents.create({
            amount: amountCents,
            currency: 'usd',
            customer: membership.stripe_customer_id,
            payment_method: paymentMethodId,
            off_session: true,
            confirm: true,
            metadata: {
              user_id: userId.toString(),
              membership_id: membership.id.toString(),
              membership_type: membership.membership_type,
              type: 'gym_membership',
              first_charge: 'true'
            }
          });
          if (paymentIntent.status === 'succeeded') {
            const user = await db.getUserById(userId);
            await db.createPayment(userId, paymentIntent.id, amountCents, 'usd', 'gym_membership', 'succeeded', user?.email || null);
            const currentEnd = contractEndDate;
            const newEnd = new Date(currentEnd);
            newEnd.setUTCMonth(newEnd.getUTCMonth() + 1);
            const newEndStr = newEnd.toISOString().split('T')[0];
            await db.query(
              db.isPostgres
                ? 'UPDATE gym_memberships SET contract_end_date = $1, updated_at = CURRENT_TIMESTAMP WHERE id = $2'
                : 'UPDATE gym_memberships SET contract_end_date = ?, updated_at = datetime(\'now\') WHERE id = ?',
              [newEndStr, membership.id]
            );
            return res.json({
              success: true,
              message: 'Payment method added and first month charged.',
              first_charge: true,
              amount_charged_cents: amountCents
            });
          }
        } catch (chargeErr) {
          console.error('First charge on confirm-payment-method failed:', chargeErr.message);
          return res.status(502).json({
            error: 'Payment method saved but first charge failed. You will not be charged until your start date. Please try again or contact support.',
            details: chargeErr.message
          });
        }
      }
      
      res.json({ 
        success: true,
        message: 'Payment method added and set as default'
      });
    } catch (error) {
      console.error('Confirm payment method error:', error);
      res.status(500).json({ error: 'Failed to confirm payment method: ' + error.message });
    }
  });

  // Confirm payment and create subscription
  router.post('/gym-memberships/confirm-payment', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const { paymentIntentId, membershipId: bodyMembershipId, profile, address, emergencyContact } = req.body;

      if (!paymentIntentId) {
        return res.status(400).json({ error: 'Payment intent ID is required' });
      }

      // Verify payment intent belongs to user (expand latest_charge so contract dates use money-captured time, not PI open time)
      const paymentIntent = await stripe.paymentIntents.retrieve(paymentIntentId, {
        expand: ['latest_charge']
      });

      if (paymentIntent.metadata.userId !== userId.toString()) {
        return res.status(403).json({ error: 'Payment intent does not belong to user' });
      }

      if (paymentIntent.status !== 'succeeded') {
        return res.status(400).json({ error: 'Payment intent is not succeeded' });
      }

      const contractDatesFromPayment = await getContractStartEndYmdFromSucceededPaymentIntent(stripe, paymentIntent);

      // Get membership (by id if provided, or we may create below)
      let membership = bodyMembershipId ? await db.queryOne(
        db.isPostgres
          ? 'SELECT * FROM gym_memberships WHERE id = $1 AND user_id = $2'
          : 'SELECT * FROM gym_memberships WHERE id = ? AND user_id = ?',
        [bodyMembershipId, userId]
      ) : null;

      // Fallback: if no membership row (create failed or never called), create one from payment intent metadata
      if (!membership) {
        const existing = await db.queryOne(
          db.isPostgres
            ? 'SELECT id FROM gym_memberships WHERE user_id = $1 AND status = $2'
            : 'SELECT id FROM gym_memberships WHERE user_id = ? AND status = ?',
          [userId, 'active']
        );
        if (existing) {
          membership = await db.queryOne(
            db.isPostgres
              ? 'SELECT * FROM gym_memberships WHERE id = $1'
              : 'SELECT * FROM gym_memberships WHERE id = ?',
            [existing.id]
          );
        } else {
          const membershipTypeFromPi = paymentIntent.metadata.membershipType || 'standard';
          if (!contractDatesFromPayment.contractStartYmd || !contractDatesFromPayment.contractEndYmd) {
            return res.status(500).json({ error: 'Could not derive membership dates from successful payment' });
          }
          const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
          let householdId = 'HH-';
          for (let i = 0; i < 6; i++) householdId += chars.charAt(Math.floor(Math.random() * chars.length));
          const insertResult = await db.query(
            db.isPostgres
              ? `INSERT INTO gym_memberships (user_id, membership_type, household_id, is_primary_member, status, contract_start_date, contract_end_date, contract_months, created_at)
                 VALUES ($1, $2, $3, true, 'active', $4, $5, 12, CURRENT_TIMESTAMP) RETURNING id`
              : `INSERT INTO gym_memberships (user_id, membership_type, household_id, is_primary_member, status, contract_start_date, contract_end_date, contract_months, created_at)
                 VALUES (?, ?, ?, 1, 'active', ?, ?, 12, datetime('now'))`,
            db.isPostgres
              ? [userId, membershipTypeFromPi, householdId, contractDatesFromPayment.contractStartYmd, contractDatesFromPayment.contractEndYmd]
              : [userId, membershipTypeFromPi, householdId, contractDatesFromPayment.contractStartYmd, contractDatesFromPayment.contractEndYmd]
          );
          const newId = insertResult.rows?.[0]?.id ?? insertResult.lastID;
          if (!newId) {
            console.error('Confirm-payment fallback: INSERT gym_memberships did not return id');
            return res.status(500).json({ error: 'Failed to create membership record' });
          }
          membership = await db.queryOne(
            db.isPostgres ? 'SELECT * FROM gym_memberships WHERE id = $1' : 'SELECT * FROM gym_memberships WHERE id = ?',
            [newId]
          );
          console.log('Confirm-payment: created missing gym_memberships row from payment intent metadata, id=', newId);
        }
      }

      if (!membership) {
        return res.status(404).json({ error: 'Membership not found' });
      }

      const membershipId = membership.id;

      // App-managed gym billing (no Stripe subscription): anchor dates to this successful charge only
      if (!membership.stripe_subscription_id && contractDatesFromPayment.contractStartYmd && contractDatesFromPayment.contractEndYmd) {
        await db.query(
          db.isPostgres
            ? `UPDATE gym_memberships SET contract_start_date = $1, contract_end_date = $2, updated_at = CURRENT_TIMESTAMP WHERE id = $3`
            : `UPDATE gym_memberships SET contract_start_date = ?, contract_end_date = ?, updated_at = datetime('now') WHERE id = ?`,
          [contractDatesFromPayment.contractStartYmd, contractDatesFromPayment.contractEndYmd, membershipId]
        );
      }

      // Persist customer profile if provided (fallback if create didn't save it, e.g. table missing at signup)
      if (profile && (profile.firstName || profile.lastName || profile.phone || profile.dateOfBirth)) {
        try {
          await db.upsertCustomerProfile(userId, profile, address || {}, emergencyContact || {});
        } catch (profileErr) {
          console.error('Confirm-payment: could not save customer profile:', profileErr.message);
        }
      }

      // Get or create Stripe customer
      let stripeCustomerId = paymentIntent.customer;
      let customer;
      if (!stripeCustomerId) {
        const user = await db.getUserById(userId);
        customer = await createCustomer(user.email);
        stripeCustomerId = customer.id;
      } else {
        customer = await stripe.customers.retrieve(stripeCustomerId);
      }
      
      // Update customer with name and address metadata
      const metadata = { ...customer.metadata };
      if (profile) {
        if (profile.firstName) metadata.firstName = profile.firstName;
        if (profile.lastName) metadata.lastName = profile.lastName;
        if (profile.firstName && profile.lastName) {
          metadata.name = `${profile.firstName} ${profile.lastName}`.trim();
        }
      }
      if (address) {
        metadata.address = JSON.stringify({
          street: address.street || '',
          city: address.city || '',
          state: address.state || '',
          zip: address.zip || ''
        });
        if (address.street) metadata.address_street = address.street;
        if (address.city) metadata.address_city = address.city;
        if (address.state) metadata.address_state = address.state;
        if (address.zip) metadata.address_zip = address.zip;
      }
      
      // Update customer with metadata
      await stripe.customers.update(stripeCustomerId, {
        metadata: metadata,
        name: metadata.name || customer.name || null,
        address: address ? {
          line1: address.street || null,
          city: address.city || null,
          state: address.state || null,
          postal_code: address.zip || null,
          country: 'US'
        } : undefined
      });

      // Retrieve and verify payment method
      // With setup_future_usage: 'off_session', Stripe automatically attaches the payment method
      // to the customer when the payment succeeds, so we just need to verify it's attached
      let attachedPaymentMethod = null;
      let paymentMethodExpiresAt = null;
      if (paymentIntent.payment_method) {
        try {
          // Retrieve the payment method to verify it's attached to our customer
          const paymentMethod = await stripe.paymentMethods.retrieve(paymentIntent.payment_method);
          
          // Extract expiry date if available
          if (paymentMethod.card && paymentMethod.card.exp_year && paymentMethod.card.exp_month) {
            paymentMethodExpiresAt = new Date(paymentMethod.card.exp_year, paymentMethod.card.exp_month, 0, 23, 59, 59).toISOString();
          }
          
          // Verify payment method is attached to our customer
          if (paymentMethod.customer === stripeCustomerId) {
            attachedPaymentMethod = paymentIntent.payment_method;
            console.log('Payment method verified and attached to customer');
          } else {
            // Payment method exists but isn't attached to our customer
            // This shouldn't happen with setup_future_usage, but handle it gracefully
            console.warn('Payment method not attached to customer, attempting to attach...');
            try {
              await stripe.paymentMethods.attach(paymentIntent.payment_method, {
                customer: stripeCustomerId
              });
              attachedPaymentMethod = paymentIntent.payment_method;
              console.log('Payment method attached successfully');
            } catch (attachError) {
              if (attachError.code === 'resource_already_exists') {
                // Already attached (race condition), that's okay
                attachedPaymentMethod = paymentIntent.payment_method;
                console.log('Payment method already attached (race condition)');
              } else {
                console.error('Error attaching payment method:', attachError.message);
                throw new Error('Failed to attach payment method: ' + attachError.message);
              }
            }
          }

          // Set as default payment method for the customer
          if (attachedPaymentMethod) {
            try {
              await stripe.customers.update(stripeCustomerId, {
                invoice_settings: {
                  default_payment_method: attachedPaymentMethod
                }
              });
              console.log('Payment method set as default for customer');
            } catch (updateError) {
              console.error('Error setting default payment method:', updateError.message);
              // Don't fail - subscription can still be created
            }
          }
        } catch (pmError) {
          // If we can't verify/attach the payment method, we cannot create a subscription
          console.error('Critical error: Cannot verify payment method for subscription:', pmError.message);
          return res.status(400).json({ 
            error: 'Failed to set up recurring billing. Payment method could not be verified. Please contact support or try again.',
            details: pmError.message
          });
        }
      } else {
        // No payment method in payment intent - this shouldn't happen for confirmed payments
        console.error('No payment method found in payment intent');
        return res.status(400).json({ 
          error: 'Payment method not found. Please contact support.'
        });
      }

      // Get membership type and calculate price
      const membershipType = membership.membership_type;
      const membershipTypeToPrice = {
        'standard': 6500,              // $65.00/month
        'immediate_family_member': 5000,      // $50.00/month
        'expecting_or_recovering_mother': 3000,  // $30.00/month
        'entire_family': 18500           // $185.00/month
      };

      const amount = membershipTypeToPrice[membershipType] || 6500;

      // No Stripe Subscription: we control billing in the app. Next charge runs at 1am MT via
      // scripts/nightly-renewal-job.js using contract_end_date; charge is done via PaymentIntent.
      // Update membership with Stripe customer and payment method only.
      await db.query(
        db.isPostgres
          ? 'UPDATE gym_memberships SET stripe_customer_id = $1, payment_method_id = $2, payment_method_expires_at = $3, billing_period = $4, updated_at = CURRENT_TIMESTAMP WHERE id = $5'
          : 'UPDATE gym_memberships SET stripe_customer_id = ?, payment_method_id = ?, payment_method_expires_at = ?, billing_period = ?, updated_at = datetime(\'now\') WHERE id = ?',
        [
          stripeCustomerId,
          attachedPaymentMethod,
          paymentMethodExpiresAt,
          'monthly',
          membershipId
        ]
      );

      // Record initial payment in DB so Members "Last Charge" is populated (don't rely only on webhooks)
      try {
        const amountCents = paymentIntent.amount_received || paymentIntent.amount || 0;
        const currency = paymentIntent.currency || 'usd';
        let userEmail = null;
        try {
          const u = await db.getUserById(userId);
          userEmail = u?.email || null;
        } catch (e) { /* ignore */ }
        await db.createPayment(userId, paymentIntentId, amountCents, currency, 'gym_membership', 'succeeded', userEmail);
      } catch (payErr) {
        if (payErr.code !== '23505' && payErr.code !== 'SQLITE_CONSTRAINT' && !/unique|duplicate/i.test(payErr.message || '')) {
          console.error('Confirm-payment: could not record initial payment:', payErr.message);
        }
      }

      res.json({
        success: true,
        customerId: stripeCustomerId,
        message: 'Payment confirmed. Recurring billing is managed by the app (next charge on your billing date at 1am MT).'
      });
    } catch (error) {
      console.error('Confirm gym membership payment error:', error);
      res.status(500).json({ error: 'Failed to confirm payment: ' + error.message });
    }
  });

  // ========== PR Logs Routes ==========

  // Get all PR logs for the authenticated user
  router.get('/pr-logs', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const logs = await db.getPRLogs(userId);
      res.json({ logs: logs || [] });
    } catch (error) {
      console.error('Get PR logs error:', error);
      res.status(500).json({ error: 'Failed to get PR logs' });
    }
  });

  // Create a single PR log
  router.post('/pr-logs', authenticateToken, [
    body('exercise').notEmpty().trim(),
    body('weight').isFloat({ min: 0 }),
    body('reps').isInt({ min: 1 }),
    body('oneRM').isFloat({ min: 0 }),
    body('confidence').optional().isIn(['high', 'medium', 'low']).withMessage('Confidence must be high, medium, or low'),
    body('date').optional().isString()
  ], async (req, res) => {
    try {
      const errors = validationResult(req);
      if (!errors.isEmpty()) {
        return res.status(400).json({ errors: errors.array() });
      }

      const userId = req.userId;
      const { exercise, weight, reps, oneRM, confidence, date } = req.body;
      const logDate = date || new Date().toISOString().split('T')[0];
      
      // Ensure confidence is provided (default to 'medium' if missing, since DB requires NOT NULL)
      const confidenceValue = confidence || 'medium';

      // Check tier limit before creating PR log
      const subscription = await db.getUserActiveSubscription(userId);
      if (!subscription || !subscriptionRowGrantsAccess(subscription)) {
        return res.status(403).json({ error: 'Active subscription required to log PRs' });
      }

      // Get current PR log count
      const currentLogs = await db.getPRLogs(userId);
      const currentCount = currentLogs.length;

      // Get tier limit from config
      const tierLimit = getFeatureLimit(subscription.tier, 'one_rm_lifts');
      
      // Check if limit is reached (null means unlimited)
      if (tierLimit !== null && currentCount >= tierLimit) {
        return res.status(403).json({ 
          error: `You have reached your tier limit of ${tierLimit} PR logs. Upgrade your subscription to log more PRs.` 
        });
      }

      const result = await db.createPRLog(userId, exercise, weight, reps, oneRM, confidenceValue, logDate);
      res.status(201).json({ id: result.id, message: 'PR log created successfully' });
    } catch (error) {
      console.error('Create PR log error:', error);
      res.status(500).json({ error: 'Failed to create PR log' });
    }
  });

  // Bulk create PR logs (for migration)
  router.post('/pr-logs/bulk', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const { logs } = req.body;

      if (!Array.isArray(logs) || logs.length === 0) {
        return res.status(400).json({ error: 'Logs array is required and must not be empty' });
      }

      // Validate each log entry
      for (const log of logs) {
        if (!log.exercise || typeof log.weight !== 'number' || typeof log.reps !== 'number' || typeof log.oneRM !== 'number') {
          return res.status(400).json({ error: 'Each log must have exercise, weight, reps, and oneRM' });
        }
      }

      const results = await db.bulkCreatePRLogs(userId, logs);
      res.status(201).json({ 
        message: `Created ${results.length} PR logs successfully`,
        ids: results.map(r => r.id)
      });
    } catch (error) {
      console.error('Bulk create PR logs error:', error);
      res.status(500).json({ error: 'Failed to bulk create PR logs' });
    }
  });

  // Delete a PR log
  router.delete('/pr-logs/:id', authenticateToken, async (req, res) => {
    try {
      const userId = req.userId;
      const logId = parseInt(req.params.id, 10);

      if (isNaN(logId)) {
        return res.status(400).json({ error: 'Invalid log ID' });
      }

      const deleted = await db.deletePRLog(userId, logId);
      if (deleted) {
        res.json({ message: 'PR log deleted successfully' });
      } else {
        res.status(404).json({ error: 'PR log not found' });
      }
    } catch (error) {
      console.error('Delete PR log error:', error);
      res.status(500).json({ error: 'Failed to delete PR log' });
    }
  });

  return router;
}

module.exports = createRouter;

function parseDateOnly(dateString) {
  if (!dateString) {
    return new Date();
  }

  const [datePart] = dateString.split(' ');
  const [year, month, day] = datePart.split('-').map(Number);
  const parsed = new Date(year, (month || 1) - 1, day || 1);
  parsed.setHours(0, 0, 0, 0);
  return parsed;
}

function formatDateOnly(dateObj) {
  const year = dateObj.getFullYear();
  const month = String(dateObj.getMonth() + 1).padStart(2, '0');
  const day = String(dateObj.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function extractFocus(content) {
  if (!content) return null;
  const lines = content
    .split('\n')
    .map(line => line.replace(/\u000b/g, ' ').trim())
    .filter(line => line.length > 0);

  const monthRegex = /(January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/i;
  const durationRegex = /(\d+\s*(?:Min|Minute|Minutes|Hour|Hours).*?)(?:\s{2,}|$)/i;

  // Abbreviation mapping
  const abbreviationMap = {
    'SAQ': 'Speed and Agility',
    'SAG': 'Sagittal',
    'TRANS': 'Transverse',
    'FRONT': 'Frontal'
  };

  let pendingLine = null;
  let foundDate = false;

  // First, try to find focus before the date (highest priority)
  for (const line of lines) {
    if (line.length > 80) {
      continue;
    }
    
    // Skip duration lines in this pass
    if (durationRegex.test(line)) {
      continue;
    }
    
    const monthMatch = line.match(monthRegex);
    if (monthMatch) {
      foundDate = true;
      const prefix = line.slice(0, monthMatch.index).trim();
      if (prefix.length > 0 && prefix.length < 80) {
        // Expand abbreviation if needed
        const expanded = abbreviationMap[prefix.toUpperCase()] || prefix;
        return expanded;
      }
      // If we found a date and have a pending line, return it
      if (pendingLine && pendingLine.length < 80) {
        // Expand abbreviation if needed
        const expanded = abbreviationMap[pendingLine.toUpperCase()] || pendingLine;
        return expanded;
      }
      pendingLine = null;
      continue;
    }
    
    // Before we find the date, collect the first non-empty line as potential focus
    if (!foundDate) {
      if (!pendingLine) {
        pendingLine = line;
      } else {
        // If we already have a pending line, return it (focus is usually first line before date)
        const expanded = abbreviationMap[pendingLine.toUpperCase()] || pendingLine;
        return expanded;
      }
    }
  }

  // If we found a pending line but no date, return it
  if (pendingLine && pendingLine.length < 80) {
    const expanded = abbreviationMap[pendingLine.toUpperCase()] || pendingLine;
    return expanded;
  }

  // Fallback: check duration lines for focus in parentheses (only if no focus found before date)
  // This handles cases like "45 Min Field Day (Speed and Agility)"
  for (const line of lines) {
    if (durationRegex.test(line)) {
      // Look for text in parentheses like "45 Min Field Day (Speed and Agility)"
      const parenMatch = line.match(/\(([^)]+)\)/);
      if (parenMatch) {
        const focusInParens = parenMatch[1].trim();
        // Skip common duration phrases that aren't focus areas
        const durationPhrases = ['as many rounds as possible', 'amrap', 'rounds', 'minutes', 'min', 'hours', 'hour'];
        const lowerFocus = focusInParens.toLowerCase();
        if (!durationPhrases.some(phrase => lowerFocus.includes(phrase))) {
          // Expand abbreviation if needed
          return abbreviationMap[focusInParens.toUpperCase()] || focusInParens;
        }
      }
    }
  }

  return null;
}

