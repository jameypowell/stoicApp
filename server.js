const express = require('express');
const cors = require('cors');
const path = require('path');
require('dotenv').config({ override: true });

const { initDatabase, Database } = require('./database');
const createRouter = require('./routes');
const createWebhookRouter = require('./webhooks');

const app = express();
const PORT = process.env.PORT || 3000;

// Redirect legacy frontend host to the new app domain
app.use((req, res, next) => {
  const host = (req.headers.host || '').toLowerCase();
  if (host === 'workouts.stoic-fit.com' || host === 'www.workouts.stoic-fit.com') {
    const target = 'https://app.stoic-fit.com' + req.originalUrl;
    return res.redirect(301, target);
  }
  next();
});

// Middleware
// CORS configuration: allow localhost (dev) and production origins via env + hardcoded app domains
const defaultOrigins = [
  'http://localhost:3000',
  'http://127.0.0.1:3000',
  'http://localhost:5173',
  'http://127.0.0.1:5173'
];
const envOrigins = (process.env.CORS_ORIGINS || '').split(',').map(o => o.trim()).filter(Boolean);
// Always allow our production domains regardless of env configuration to avoid accidental lockouts
const hardcodedProdOrigins = [
  'https://app.stoic-fit.com',
  'https://stoic-fit.com',
  'https://www.stoic-fit.com'
];
const allowedOrigins = [...new Set([...defaultOrigins, ...hardcodedProdOrigins, ...envOrigins])];

// In production, if no CORS_ORIGINS is set, allow all origins (less secure but functional)
// In development, be more restrictive
const isProduction = process.env.NODE_ENV === 'production';
const allowAllOrigins = isProduction && envOrigins.length === 0;

app.use(cors({
  origin: function(origin, callback) {
    // Allow requests with no origin (like mobile apps or curl requests)
    if (!origin) return callback(null, true);
    
    // In production without CORS_ORIGINS set, allow all (for now - should be configured properly)
    if (allowAllOrigins) {
      return callback(null, true);
    }
    
    // Check if origin is in allowed list
    if (allowedOrigins.includes(origin)) {
      return callback(null, true);
    }
    
    // Log the rejected origin for debugging
    console.warn('CORS: Origin not allowed:', origin);
    console.warn('Allowed origins:', allowedOrigins);
    console.warn('NODE_ENV:', process.env.NODE_ENV);
    console.warn('CORS_ORIGINS:', process.env.CORS_ORIGINS);
    
    return callback(new Error('Not allowed by CORS'));
  },
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
  credentials: false
}));
app.use(express.urlencoded({ extended: true }));

// JSON parser for most routes (webhooks handle raw body themselves)
app.use((req, res, next) => {
  if (req.path.startsWith('/api/webhooks')) {
    return next(); // Skip JSON parser for webhooks
  }
  // Increase limit for bulk workout syncs (50MB)
  express.json({ limit: '50mb' })(req, res, next);
});

// Health check endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', service: 'stoic-shop' });
});

// Initialize database and start server
async function startServer() {
  try {
    // Initialize database
    const dbConnection = await initDatabase();
    const db = new Database(dbConnection);

    // Mount OAuth routes at root level FIRST (before static files) because Google redirect URI doesn't include /api
    const { google } = require('googleapis');
    const { generateToken } = require('./auth');
    
    app.get('/auth/google', (req, res) => {
      const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
      const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
      // Use the app domain callback unconditionally so it matches Google console config
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

    app.get('/auth/google/callback', async (req, res) => {
      try {
        const { code } = req.query;
        
        if (!code) {
          return res.redirect('/?error=oauth_failed');
        }

        const clientId = process.env.GOOGLE_OAUTH_CLIENT_ID || process.env.GOOGLE_CLIENT_ID;
        const clientSecret = process.env.GOOGLE_OAUTH_CLIENT_SECRET || process.env.GOOGLE_CLIENT_SECRET;
        // Must exactly match the redirect URI registered in Google Cloud Console
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

        const clearDropInOnlyIfSet = async (u) => {
          if (!u || !(u.drop_in_only_account === true || u.drop_in_only_account === 1)) return;
          try {
            if (db.isPostgres) {
              await db.query(
                'UPDATE users SET drop_in_only_account = FALSE, updated_at = CURRENT_TIMESTAMP WHERE id = $1',
                [u.id]
              );
            } else {
              await db.query(
                "UPDATE users SET drop_in_only_account = 0, updated_at = datetime('now') WHERE id = ?",
                [u.id]
              );
            }
          } catch (e) {
            console.warn('OAuth: could not clear drop_in_only_account:', e && e.message);
          }
        };

        if (!user) {
          // Create new user with placeholder password (OAuth users can't use password login)
          // Use a random hash that will never match
          const placeholderPassword = 'OAUTH_USER_' + Date.now() + Math.random().toString(36);
          // Try to create with name, but it will work without name column too
          try {
            user = await db.createUser(email, placeholderPassword, name);
          } catch (error) {
            // If name column doesn't exist, create without it
            user = await db.createUser(email, placeholderPassword);
          }
        } else if (name) {
          // Try to update name if available, but don't fail if column doesn't exist
          try {
            // Update name if it's missing or different (handle both null and undefined)
            if (!user.name || user.name !== name) {
              await db.updateUserName(user.id, name);
              user.name = name;
              console.log(`Updated name for user ${user.id} (${email}): ${name}`);
            }
          } catch (error) {
            // Name column doesn't exist, that's okay - continue without it
            console.log('Name column not available, skipping name update:', error.message);
          }
        }

        await clearDropInOnlyIfSet(user);

        // Update last_login timestamp, IP, and location (same as email/password login)
        const clientIP = req.headers['x-forwarded-for']?.split(',')[0]?.trim() ||
          req.headers['x-real-ip'] ||
          req.connection?.remoteAddress ||
          req.socket?.remoteAddress ||
          req.ip ||
          'Unknown';
        const location = (!clientIP || clientIP === 'Unknown' || /^(127\.|192\.168\.|10\.|::1)/.test(clientIP))
          ? 'Local' : clientIP;
        try {
          if (db.isPostgres) {
            await db.query(
              'UPDATE users SET last_login = CURRENT_TIMESTAMP, last_login_ip = $1, last_login_location = $2 WHERE id = $3',
              [clientIP, location, user.id]
            );
          } else {
            await db.query(
              "UPDATE users SET last_login = datetime('now'), last_login_ip = ?, last_login_location = ? WHERE id = ?",
              [clientIP, location, user.id]
            );
          }
        } catch (err) {
          console.warn('OAuth: could not update last_login:', err?.message);
        }

        // Generate JWT token
        const token = generateToken(user.id);

        // Redirect to frontend with token and name (if available).
        // Always send users to the app dashboard domain (app.stoic-fit.com),
        // regardless of where the OAuth callback was initiated from.
        const frontendUrl = process.env.APP_BASE_URL || 'https://app.stoic-fit.com';
        const redirectParams = new URLSearchParams({
          token: token,
          email: email
        });
        // Include name in redirect if we have it (from Google or from database)
        const nameToUse = user.name || name;
        if (nameToUse) {
          redirectParams.set('name', nameToUse);
          console.log(`OAuth redirect - including name: ${nameToUse}`);
        } else {
          console.log('OAuth redirect - no name available');
        }
        res.redirect(`${frontendUrl}/?${redirectParams.toString()}`);
      } catch (error) {
        console.error('Google OAuth callback error:', error);
        res.redirect('/?error=oauth_error');
      }
    });
    
    // Mount API routes
    app.use('/api', createRouter(db));
    
    // Mount webhook routes (must be after other routes)
    app.use('/api', createWebhookRouter(db));
    
    // Serve static files AFTER all API/OAuth routes (to avoid conflicts)
    app.use(express.static('public', {
      setHeaders: (res, path) => {
        if (path.endsWith('.html') || path.endsWith('.js') || path.endsWith('.css')) {
          res.setHeader('Cache-Control', 'no-cache, no-store, must-revalidate');
          res.setHeader('Pragma', 'no-cache');
          res.setHeader('Expires', '0');
        }
      }
    }));

    // Root endpoint - serve frontend (after static files middleware)
    app.get('/', (req, res) => {
      // Prevent caching so users always get latest HTML after deploys
      res.setHeader('Cache-Control', 'no-store, no-cache, must-revalidate');
      res.setHeader('Pragma', 'no-cache');
      res.setHeader('Expires', '0');
      res.sendFile(path.join(__dirname, 'public', 'index.html'));
    });

    // 404 handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found' });
    });

    // Error handler
    app.use((err, req, res, next) => {
      console.error('Error:', err.message);
      if (err.stack) {
        console.error('Stack:', err.stack);
      }
      
      // Handle CORS errors specifically
      if (err.message === 'Not allowed by CORS') {
        return res.status(403).json({ 
          error: 'CORS error: Origin not allowed',
          message: 'Please check CORS_ORIGINS environment variable'
        });
      }
      
      res.status(500).json({ error: 'Something went wrong!' });
    });

    // Legacy invoice-based app renewal (nightly-renewal-job.js) is disabled: it overlapped in purpose with
    // scripts/nightly-renewal-job.js and could double-charge users who also have Stripe-managed subscriptions.
    // All manual off-session renewals run only from scripts/nightly-renewal-job.js (see cron below).
    if (process.env.ENABLE_LEGACY_INVOICE_RENEWAL_JOB === 'true') {
      const { startScheduledJob } = require('./nightly-renewal-job');
      startScheduledJob();
      console.log('⚠️  Legacy invoice renewal job ENABLED (ENABLE_LEGACY_INVOICE_RENEWAL_JOB=true) — not recommended in production.');
    }

    // Gym + app renewals: charge saved payment methods for memberships due or overdue (runs daily at 2am Mountain Time)
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_NIGHTLY_JOB === 'true') {
      const cron = require('node-cron');
      const { main: runGymRenewalJob } = require('./scripts/nightly-renewal-job');
      cron.schedule('0 2 * * *', async () => {
        console.log('[RENEWAL JOB] Starting gym/app renewal (due or overdue)...');
        try {
          await runGymRenewalJob();
          console.log('[RENEWAL JOB] Completed');
        } catch (error) {
          console.error('[RENEWAL JOB] Failed:', error);
        }
      }, { timezone: 'America/Denver' });
      console.log('✅ Gym/app renewal job scheduled (daily at 2am Mountain Time)');
    }

    // Start subscription sync job (runs daily at 1am Mountain Time)
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_SYNC_JOB === 'true') {
      const cron = require('node-cron');
      const { syncAllSubscriptions } = require('./subscription-sync');
      
      // Schedule sync at 1am Mountain Time (America/Denver timezone)
      // This handles both MST (UTC-7) and MDT (UTC-6) automatically
      cron.schedule('0 1 * * *', async () => {
        console.log('[SYNC JOB] Starting scheduled subscription sync...');
        try {
          const result = await syncAllSubscriptions(db);
          console.log('[SYNC JOB] Scheduled sync completed:', result);
        } catch (error) {
          console.error('[SYNC JOB] Scheduled sync failed:', error);
        }
      }, {
        timezone: 'America/Denver'
      });
      console.log('✅ Subscription sync job scheduled (daily at 1am Mountain Time)');
    } else {
      console.log('ℹ️  Subscription sync job disabled (set ENABLE_SYNC_JOB=true to enable in development)');
    }

    // Start gym membership sync job (runs daily at 1am Mountain Time)
    if (process.env.NODE_ENV === 'production' || process.env.ENABLE_SYNC_JOB === 'true') {
      const cron = require('node-cron');
      const { syncAllGymMemberships } = require('./gym-membership-sync');

      const runGymSync = async () => {
        console.log('[SYNC JOB] Starting scheduled gym membership sync...');
        try {
          const result = await syncAllGymMemberships(db);
          console.log('[SYNC JOB] Scheduled gym membership sync completed:', result);
        } catch (error) {
          console.error('[SYNC JOB] Scheduled gym membership sync failed:', error);
        }
      };

      // One-time run at 8:15pm Mountain Time (unschedules itself after running)
      const onceAt815 = cron.schedule('15 20 * * *', async () => {
        console.log('[SYNC JOB] Running one-time gym membership sync (8:15pm MT)...');
        await runGymSync();
        onceAt815.stop();
        console.log('[SYNC JOB] One-time 8:15pm sync complete. Future syncs will run at 1am MT only.');
      }, { timezone: 'America/Denver' });
      console.log('✅ Gym membership sync: one-time run scheduled at 8:15pm Mountain Time');

      // Daily run at 1am Mountain Time
      cron.schedule('0 1 * * *', runGymSync, { timezone: 'America/Denver' });
      console.log('✅ Gym membership sync: daily run scheduled at 1am Mountain Time');
    } else {
      console.log('ℹ️  Gym membership sync job disabled (set ENABLE_SYNC_JOB=true to enable in development)');
    }

    // Dev-only: verify Stripe keys are configured
    if (process.env.NODE_ENV === 'development') {
      const hasStripe = process.env.STRIPE_SECRET_KEY && process.env.STRIPE_PUBLISHABLE_KEY;
      if (hasStripe) {
        console.log('✅ Stripe keys configured for development');
      } else {
        console.warn('⚠️  Stripe keys missing. Set STRIPE_SECRET_KEY and STRIPE_PUBLISHABLE_KEY in .env for payment features.');
      }
    }

    // Start server
    app.listen(process.env.PORT || 3000, '0.0.0.0', () => console.log('up'));
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();

