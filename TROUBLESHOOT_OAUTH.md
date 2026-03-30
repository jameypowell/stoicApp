# Troubleshooting OAuth 403 Error - Step by Step Checklist

## Your Current Setup ✅
- **Redirect URIs**: Correctly configured (including OAuth Playground)
- **Client ID**: YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com
- **Client Secret**: Configured

## Common Causes of 403 Error

### 1. OAuth Consent Screen Not Configured ⚠️

**Check:**
1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Look at the **"Publishing status"** section
3. What does it say?

**If it says "Not configured" or "Test" mode:**
- You need to configure the consent screen
- See steps below

### 2. Test Users Not Added ⚠️

**If your app is in "Testing" mode:**
- Only users listed as "Test users" can authorize
- You MUST add your email as a test user

**Steps:**
1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Scroll to **"Test users"** section
3. Click **"ADD USERS"**
4. Add **your exact email address** (the one you'll use to sign in)
5. Click **"ADD"**
6. **IMPORTANT**: Save the consent screen configuration

### 3. Scope Not Added to Consent Screen ⚠️

**Check:**
1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Look at the **"Scopes"** section
3. Make sure `https://www.googleapis.com/auth/drive.readonly` is listed

**If not:**
1. Click **"EDIT APP"** or go to the scopes tab
2. Click **"ADD OR REMOVE SCOPES"**
3. Search for: `https://www.googleapis.com/auth/drive.readonly`
4. Add it and save

### 4. Using Wrong Email Address ⚠️

**Critical**: When signing in to OAuth Playground, use the **EXACT SAME EMAIL** that you added as a test user.

## Complete Fix Checklist

Go through these steps in order:

### Step 1: Verify Consent Screen Configuration
- [ ] Go to: https://console.cloud.google.com/apis/credentials/consent
- [ ] Check "Publishing status" - should show "Testing" or "In production"
- [ ] If "Not configured", click "CONFIGURE CONSENT SCREEN"

### Step 2: Configure Basic Info
- [ ] App name: Enter something (e.g., "Stoic Fit Shop")
- [ ] User support email: Your email
- [ ] Developer contact: Your email
- [ ] Click "SAVE AND CONTINUE"

### Step 3: Add Scopes
- [ ] Click "ADD OR REMOVE SCOPES"
- [ ] Search for: `drive.readonly`
- [ ] Select: `https://www.googleapis.com/auth/drive.readonly`
- [ ] Click "UPDATE"
- [ ] Click "SAVE AND CONTINUE"

### Step 4: Add Test Users (CRITICAL!)
- [ ] Scroll to "Test users" section
- [ ] Click "ADD USERS"
- [ ] Add your email address (the one you'll use to sign in)
- [ ] Click "ADD"
- [ ] Make sure to click "SAVE AND CONTINUE" or "BACK TO DASHBOARD"

### Step 5: Verify Redirect URI
- [ ] Go to: https://console.cloud.google.com/apis/credentials
- [ ] Click on your OAuth Client ID
- [ ] Verify `https://developers.google.com/oauthplayground` is in "Authorized redirect URIs"
- [ ] If not, add it and save

### Step 6: Try OAuth Playground Again
- [ ] Go to: https://developers.google.com/oauthplayground/
- [ ] Click gear icon → Use your own OAuth credentials
- [ ] Enter **the exact Client ID** from above
- [ ] Enter **the exact Client Secret**
- [ ] Select scope: `https://www.googleapis.com/auth/drive.readonly`
- [ ] Click "Authorize APIs"
- [ ] **Use the EXACT EMAIL you added as test user**
- [ ] Click "Allow" when prompted

## Alternative: Use Service Account Instead

If OAuth Playground continues to be problematic, we can set up a Service Account instead, which doesn't require user consent.

## Still Not Working?

1. **Check the exact error message** - sometimes Google gives more specific errors
2. **Try incognito mode** - clears cached OAuth data
3. **Wait a few minutes** - Google changes can take time to propagate
4. **Check email** - Make sure you're using the exact email added as test user
5. **Check consent screen status** - Sometimes needs to be saved/republished

## Quick Test

After configuring everything, try this:
1. Sign out of all Google accounts
2. Sign in with ONLY the test user email
3. Try OAuth Playground again

