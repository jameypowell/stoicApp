# Fix: Error 403 access_denied in OAuth Playground

## Problem
Getting "Error 403: access_denied" when trying to authorize in OAuth Playground.

## Common Causes

1. **OAuth consent screen not configured**
2. **App is in testing mode and your email isn't added as a test user**
3. **Consent screen needs to be published**

## Solution: Configure OAuth Consent Screen

### Step 1: Configure OAuth Consent Screen

1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Select **"External"** (unless you have Google Workspace)
3. Click **"CREATE"**

### Step 2: Fill in Required Information

**App Information:**
- **App name**: `Stoic Fit Shop` (or any name)
- **User support email**: Your email address
- **Developer contact information**: Your email address

**App Domain** (optional):
- Leave blank for now

**Authorized domains** (optional):
- Leave blank for now

**Application Homepage** (optional):
- Leave blank or add your website

4. Click **"SAVE AND CONTINUE"**

### Step 3: Scopes (Important!)

1. Click **"ADD OR REMOVE SCOPES"**
2. Search for and add:
   - `https://www.googleapis.com/auth/drive.readonly`
3. Click **"UPDATE"**
4. Click **"SAVE AND CONTINUE"**

### Step 4: Test Users (CRITICAL!)

If your app is in **Testing** mode:

1. Under **"Test users"**, click **"ADD USERS"**
2. Add your **email address** (the one you'll use to sign in)
3. Click **"ADD"**
4. Click **"SAVE AND CONTINUE"**

### Step 5: Summary

Review everything and click **"BACK TO DASHBOARD"**

### Step 6: Try OAuth Playground Again

1. Go back to: https://developers.google.com/oauthplayground/
2. Click gear icon → Use your own OAuth credentials
3. Enter Client ID and Secret
4. Select scope: `https://www.googleapis.com/auth/drive.readonly`
5. Click "Authorize APIs"
6. **Use the same email** that you added as a test user
7. Click "Allow" when prompted

## Alternative: Publish App (Not Recommended for Development)

If you don't want to add test users, you can publish the app, but this requires:
- App verification (can take days/weeks)
- Privacy policy URL
- Terms of service URL

**Recommendation:** Keep it in Testing mode and add yourself as a test user.

## Quick Checklist

- [ ] OAuth consent screen configured
- [ ] User support email set
- [ ] Scope added: `https://www.googleapis.com/auth/drive.readonly`
- [ ] Your email added as test user (if in Testing mode)
- [ ] Using same email when signing in to OAuth Playground

## Still Having Issues?

1. **Check app status**: Make sure it's not in "Publishing" state
2. **Check email**: Use the exact email you added as test user
3. **Clear browser cache**: Sometimes cached OAuth data causes issues
4. **Try incognito mode**: To bypass any cached authentication

