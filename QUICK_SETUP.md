# Quick Reference: Credentials Setup

## Stripe Setup (5 minutes)

1. **Sign up**: https://stripe.com
2. **Get keys**: Dashboard → Developers → API keys
   - Copy `pk_test_...` (Publishable key)
   - Copy `sk_test_...` (Secret key)
3. **Get webhook secret**:
   ```bash
   # Install Stripe CLI
   brew install stripe/stripe-cli/stripe
   
   # Login
   stripe login
   
   # Forward webhooks
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   # Copy the whsec_... secret
   ```
4. **Add to `.env`**:
   ```env
   STRIPE_SECRET_KEY=sk_test_...
   STRIPE_PUBLISHABLE_KEY=pk_test_...
   STRIPE_WEBHOOK_SECRET=whsec_...
   ```

## Google Drive Setup (10 minutes)

1. **Create project**: https://console.cloud.google.com
2. **Enable APIs**: 
   - Google Drive API
   - Google Slides API
3. **Create credentials**:
   - APIs & Services → Credentials → Create OAuth Client ID
   - Type: Web application
   - Redirect URI: `http://localhost:3000/auth/google/callback`
   - Copy Client ID and Client Secret
4. **Get refresh token**:
   - Go to: https://developers.google.com/oauthplayground/
   - Click gear → Use your own OAuth credentials
   - Paste Client ID and Secret
   - Select scope: `https://www.googleapis.com/auth/drive.readonly`
   - Authorize → Exchange code → Copy refresh token
5. **Add to `.env`**:
   ```env
   GOOGLE_CLIENT_ID=...apps.googleusercontent.com
   GOOGLE_CLIENT_SECRET=...
   GOOGLE_REFRESH_TOKEN=...
   ```

## Test Cards (Stripe)

- ✅ Success: `4242 4242 4242 4242`
- ❌ Decline: `4000 0000 0000 0002`

## Find Google Drive File ID

URL: `https://docs.google.com/presentation/d/FILE_ID_HERE/edit`
Copy the `FILE_ID_HERE` part.

## Complete Example .env

```env
PORT=3000
JWT_SECRET=your-secret-key-here
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=whsec_...
GOOGLE_CLIENT_ID=...apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=...
GOOGLE_REFRESH_TOKEN=...
```

See `CREDENTIALS_SETUP.md` for detailed instructions!

