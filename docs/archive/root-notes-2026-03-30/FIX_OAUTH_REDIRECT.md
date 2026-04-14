# Fix: redirect_uri_mismatch Error in OAuth Playground

## Problem
You're getting "Error 400: redirect_uri_mismatch" because OAuth Playground needs to be added as an authorized redirect URI in your Google Cloud project.

## Solution: Add OAuth Playground Redirect URI

### Step 1: Go to Google Cloud Console

1. Visit: https://console.cloud.google.com
2. Make sure you're in the correct project (the one where you created the OAuth credentials)

### Step 2: Edit OAuth Client

1. Go to **APIs & Services** → **Credentials**
2. Find your OAuth 2.0 Client ID (the one ending in `.apps.googleusercontent.com`)
3. Click on it to edit

### Step 3: Add Authorized Redirect URIs

1. Scroll down to **"Authorized redirect URIs"**
2. Click **"+ ADD URI"**
3. Add this exact URI:
   ```
   https://developers.google.com/oauthplayground
   ```
4. Click **"SAVE"**

### Step 4: Try OAuth Playground Again

1. Go back to: https://developers.google.com/oauthplayground/
2. Click the gear icon → Use your own OAuth credentials
3. Enter your Client ID and Client Secret
4. Select scope: `https://www.googleapis.com/auth/drive.readonly`
5. Click "Authorize APIs" - it should work now!

## Alternative: Add Both Redirect URIs

While you're at it, add both redirect URIs:

1. `https://developers.google.com/oauthplayground` (for OAuth Playground)
2. `http://localhost:3000/auth/google/callback` (for your app)

This way both will work.

## What Your Credentials Screen Should Look Like

**Authorized redirect URIs:**
- `https://developers.google.com/oauthplayground`
- `http://localhost:3000/auth/google/callback`

**Authorized JavaScript origins:**
- `http://localhost:3000` (if needed)

Save and try again!

