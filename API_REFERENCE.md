# Workout Subscription Service - Quick Reference

## What's Been Built

✅ **Complete backend API** for workout subscription service:
- User authentication (register/login)
- Payment processing with Stripe
- Subscription management (daily/weekly/monthly tiers)
- Google Drive/Slides integration
- Workout extraction and storage
- Access control based on subscription tier

## Key Files

- `server.js` - Main server file
- `database.js` - SQLite database setup and models
- `auth.js` - JWT authentication utilities
- `payments.js` - Stripe payment integration
- `google-drive.js` - Google Drive/Slides API integration
- `routes.js` - API route handlers
- `webhooks.js` - Stripe webhook handler

## API Endpoints Summary

### Public
- `GET /health` - Health check
- `GET /` - API documentation

### Auth
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login and get JWT token
- `GET /api/auth/me` - Get current user info

### Payments
- `POST /api/payments/create-intent` - Create Stripe payment intent
- `POST /api/payments/confirm` - Confirm payment (or use webhook)
- `POST /api/webhooks/stripe` - Stripe webhook endpoint

### Subscriptions
- `GET /api/subscriptions/me` - Get user's active subscription

### Workouts
- `GET /api/workouts` - List available workouts (based on subscription)
- `GET /api/workouts/:date` - Get workout for specific date (YYYY-MM-DD)

### Admin
- `POST /api/admin/workouts/sync` - Sync workout from Google Drive

## Subscription Tiers

| Tier | Price | Access |
|------|-------|--------|
| Daily | $2.99 | Today's workout only |
| Weekly | $9.99 | Last 7 days of workouts |
| Monthly | $29.99 | All workouts in current month |

## Setup Checklist

- [ ] Install dependencies: `npm install`
- [ ] Create `.env` file with required variables
- [ ] Set up Stripe account and get API keys
- [ ] Set up Google Cloud project and get OAuth credentials
- [ ] Get Google refresh token via OAuth Playground
- [ ] Configure Stripe webhook (for production)
- [ ] Start server: `npm run dev`

## Environment Variables Needed

```env
PORT=3000
JWT_SECRET=your-secret-key
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
GOOGLE_CLIENT_ID=...
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

## Testing Workflow

1. **Register a user**
   ```bash
   curl -X POST http://localhost:3000/api/auth/register \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123"}'
   ```

2. **Login and save token**
   ```bash
   TOKEN=$(curl -X POST http://localhost:3000/api/auth/login \
     -H "Content-Type: application/json" \
     -d '{"email":"test@example.com","password":"test123"}' \
     | jq -r '.token')
   ```

3. **Create payment intent**
   ```bash
   curl -X POST http://localhost:3000/api/payments/create-intent \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"tier":"daily"}'
   ```

4. **Sync a workout (admin)**
   ```bash
   curl -X POST http://localhost:3000/api/admin/workouts/sync \
     -H "Authorization: Bearer $TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"fileId":"google_drive_file_id","workoutDate":"2024-11-05"}'
   ```

5. **Get workout**
   ```bash
   curl http://localhost:3000/api/workouts/2024-11-05 \
     -H "Authorization: Bearer $TOKEN"
   ```

## Next Steps

1. Build frontend to consume these APIs
2. Set up automated daily sync from Google Drive
3. Add admin dashboard
4. Add email notifications
5. Deploy to AWS

## Notes

- Database is SQLite (file: `data/stoic-shop.db`)
- All prices are in cents (299 = $2.99)
- Stripe test cards: `4242 4242 4242 4242` (success)
- Google Drive file ID can be found in URL: `https://docs.google.com/presentation/d/FILE_ID/edit`

