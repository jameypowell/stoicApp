# Frontend User Guide

## Overview

You now have a complete web interface for users to:
- Register and login
- View their subscription status
- Purchase subscription tiers (Daily, Weekly, Monthly)
- Browse available workouts based on their subscription
- View workout details

## Features

### 🎨 Modern UI
- Clean, responsive design
- Smooth animations and transitions
- Mobile-friendly layout
- Gradient background with card-based layout

### 🔐 Authentication
- User registration with email/password
- Secure login with JWT tokens
- Persistent sessions (stored in localStorage)
- Automatic token validation

### 💳 Payment Integration
- Stripe Elements for secure card input
- Three subscription tiers:
  - **Daily**: $2.99 - Today's workout only
  - **Weekly**: $9.99 - Last 7 days of workouts
  - **Monthly**: $29.99 - All workouts this month

### 💪 Workout Access
- Dynamic workout list based on subscription tier
- Click any workout to view full content
- Formatted date display
- Access control enforced by backend

## Starting the Application

1. **Make sure your server is running:**
   ```bash
   npm start
   # or
   npm run dev
   ```

2. **Open your browser:**
   ```
   http://localhost:3000
   ```

3. **Test the flow:**
   - Register a new account
   - Login
   - Purchase a subscription tier
   - Browse and view workouts

## File Structure

```
public/
├── index.html    # Main HTML page
├── styles.css    # All styling
└── app.js        # Frontend JavaScript logic
```

## API Endpoints Used

The frontend uses these endpoints:
- `GET /api/stripe-key` - Get Stripe publishable key
- `POST /api/auth/register` - Register new user
- `POST /api/auth/login` - Login
- `GET /api/auth/me` - Get current user info
- `GET /api/subscriptions/me` - Get user's subscription
- `GET /api/workouts` - List available workouts
- `GET /api/workouts/:date` - Get workout for specific date
- `POST /api/payments/create-intent` - Create payment intent

## Testing Payment Flow

For testing payments, use Stripe test cards:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **3D Secure**: `4000 0025 0000 3155`

Use any future expiry date, any CVC, and any ZIP code.

## Troubleshooting

### Stripe not loading
- Check that `STRIPE_PUBLISHABLE_KEY` is set in `.env`
- Check browser console for errors
- Verify the `/api/stripe-key` endpoint returns the key

### Workouts not loading
- Check that user has an active subscription
- Verify subscription tier matches workout access requirements
- Check browser console for API errors

### Payment not working
- Ensure Stripe test mode keys are being used
- Check browser console for Stripe errors
- Verify webhook endpoint is configured (for production)

## Next Steps

1. **Customize styling** - Edit `public/styles.css` to match your brand
2. **Add more features** - Workout favorites, workout history, etc.
3. **Deploy** - Use your existing Docker/Terraform setup for production
4. **Add analytics** - Track user engagement and subscription conversions

## Production Considerations

- Replace Stripe test keys with live keys
- Set up proper webhook handling for payment confirmations
- Add HTTPS/SSL certificates
- Configure CORS for your production domain
- Add error tracking (e.g., Sentry)
- Optimize images and assets
- Add loading states and error boundaries

