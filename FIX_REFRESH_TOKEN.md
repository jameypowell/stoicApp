# Fix: unauthorized_client Error - Refresh Token Mismatch

## Problem

The error `unauthorized_client` means your refresh token doesn't match your current Client ID/Secret.

This happened because:
- You have refresh token from Client ID: `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com`
- But you're now using Client ID: `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com`

Refresh tokens are **tied to specific OAuth clients** - they can't be reused with different credentials.

## Solution: Get New Refresh Token

### Step 1: Go to OAuth Playground

1. Visit: https://developers.google.com/oauthplayground/

### Step 2: Configure with NEW Credentials

1. Click the **gear icon** (⚙️) in the top right
2. Check **"Use your own OAuth credentials"**
3. Enter your **CURRENT** credentials:
   - **Client ID**: `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com`
   - **Client Secret**: `YOUR_GOOGLE_OAUTH_CLIENT_SECRET`
4. Click **"Close"**

### Step 3: Authorize

1. In the left panel, find **"Drive API v3"**
2. Check: `https://www.googleapis.com/auth/drive.readonly`
3. Click **"Authorize APIs"**
4. Sign in with your Google account
5. Click **"Allow"**

### Step 4: Get Refresh Token

1. Click **"Exchange authorization code for tokens"**
2. In the right panel, find the **"Refresh token"**
3. Copy it (it starts with `1//...`)

### Step 5: Update .env

Replace the refresh token in your `.env` file:

```env
GOOGLE_REFRESH_TOKEN=your_new_refresh_token_here
```

### Step 6: Test Again

Run the test script:
```bash
node test-google-drive.js
```

Or test with your API:
```bash
curl -X POST http://localhost:3000/api/admin/workouts/sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileId":"YOUR_FILE_ID","workoutDate":"2024-11-05"}'
```

## Quick Checklist

- [ ] Using correct Client ID in OAuth Playground
- [ ] Using correct Client Secret in OAuth Playground
- [ ] Scope selected: `drive.readonly`
- [ ] New refresh token obtained
- [ ] Refresh token updated in `.env` file
- [ ] Tested connection

## Common Issues

**"Still getting unauthorized_client":**
- Make sure you're using the NEW Client ID (`217583573803-...`)
- Double-check Client Secret matches
- Clear browser cache and try again

**"Access denied":**
- Make sure your email is added as a test user in OAuth consent screen
- Use the same email you added as test user

**"Refresh token looks the same":**
- Even if it looks similar, refresh tokens are client-specific
- You MUST get a new one for the new client ID

