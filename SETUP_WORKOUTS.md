# Setup Guide - Workout Subscription Service

## Overview
This service allows users to subscribe to access daily workouts extracted from Google Slides.

## Features
- User registration and authentication (JWT)
- Payment processing via Stripe
- Subscription tiers: Daily ($2.99), Weekly ($9.99), Monthly ($29.99)
- Google Drive/Slides integration for workout extraction
- Access control based on subscription tier

## Initial Setup

### 1. Install Dependencies

```bash
npm install
```

### 2. Configure Environment Variables

Create a `.env` file:

```bash
# Copy the example and fill in your values
# See .env.example for all required variables
```

Required environment variables:

#### Server & Auth
- `PORT` - Server port (default: 3000)
- `NODE_ENV` - Environment (development/production)
- `JWT_SECRET` - Secret key for JWT tokens (CHANGE IN PRODUCTION!)
- `JWT_EXPIRES_IN` - Token expiration (default: 7d)

#### Stripe Configuration
1. Sign up at https://stripe.com
2. Get API keys from https://dashboard.stripe.com/apikeys
3. Set `STRIPE_SECRET_KEY` (starts with `sk_test_` for test mode)
4. Set `STRIPE_PUBLISHABLE_KEY` (starts with `pk_test_` for test mode)
5. For webhooks, set up endpoint and get `STRIPE_WEBHOOK_SECRET`

#### Google Drive API Configuration
1. Go to https://console.cloud.google.com
2. Create a new project or select existing
3. Enable Google Drive API and Google Slides API
4. Create OAuth 2.0 credentials:
   - Application type: Web application
   - Authorized redirect URIs: `http://localhost:3000/auth/google/callback`
5. Get `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`
6. Get refresh token (see below)

### 3. Get Google Refresh Token

Quick method using OAuth Playground:
1. Go to https://developers.google.com/oauthplayground/
2. Click gear icon, check "Use your own OAuth credentials"
3. Enter your Client ID and Client Secret
4. In left panel, find "Drive API v3"
5. Select `https://www.googleapis.com/auth/drive.readonly`
6. Click "Authorize APIs"
7. Click "Exchange authorization code for tokens"
8. Copy the "Refresh token" value to `.env`

### 4. Set Up Stripe Webhook (for production)

For local testing:
1. Install Stripe CLI: https://stripe.com/docs/stripe-cli
2. Login: `stripe login`
3. Forward webhooks: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
4. Copy the webhook signing secret to `.env`

### 5. Start the Server

```bash
npm run dev
# or
npm start
```

The server will automatically create the SQLite database and set up all tables.

## API Endpoints

### Authentication

#### Register
```bash
POST /api/auth/register
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Login
```bash
POST /api/auth/login
Content-Type: application/json

{
  "email": "user@example.com",
  "password": "password123"
}
```

#### Get Current User
```bash
GET /api/auth/me
Authorization: Bearer jwt_token_here
```

### Payments

#### Create Payment Intent
```bash
POST /api/payments/create-intent
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "tier": "daily" | "weekly" | "monthly"
}
```

### Workouts

#### Get Workout by Date
```bash
GET /api/workouts/2024-11-05
Authorization: Bearer jwt_token_here
```

#### List Available Workouts
```bash
GET /api/workouts
Authorization: Bearer jwt_token_here
```

### Admin

#### Sync Workout from Google Drive
```bash
POST /api/admin/workouts/sync
Authorization: Bearer jwt_token_here
Content-Type: application/json

{
  "fileId": "google_drive_file_id_or_name",
  "workoutDate": "2024-11-05"
}
```

## Subscription Tiers

- **Daily ($2.99)**: Access to today's workout only
- **Weekly ($9.99)**: Access to workouts from the last 7 days
- **Monthly ($29.99)**: Access to all workouts in the current month

## Next Steps

1. Set up frontend to consume these APIs
2. Implement admin dashboard for workout management
3. Add automated daily sync from Google Drive

