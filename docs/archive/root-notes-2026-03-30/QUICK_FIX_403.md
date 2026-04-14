# Quick Fix: 403 Access Denied - Step by Step

## The Issue
You're getting `Error 403: access_denied` when trying to authorize in OAuth Playground.

## Most Common Cause: Test User Not Added

If your app is in **"Testing"** mode, ONLY users listed as "Test users" can authorize.

## Fix Steps (Do ALL of these):

### 1. Go to OAuth Consent Screen
Visit: https://console.cloud.google.com/apis/credentials/consent

### 2. Check Publishing Status
Look at the top - what does it say?
- ✅ "Testing" → Continue to step 3
- ✅ "In production" → Continue to step 3  
- ❌ "Not configured" → Click "CONFIGURE CONSENT SCREEN" and complete setup

### 3. Add Yourself as Test User (CRITICAL!)
1. Scroll down to **"Test users"** section
2. Click **"ADD USERS"** button
3. Type your **exact email address** (the one you'll use to sign in)
4. Click **"ADD"**
5. **IMPORTANT**: Click **"SAVE AND CONTINUE"** or **"BACK TO DASHBOARD"** to save!

### 4. Verify Scope is Added
1. Look at the **"Scopes"** section
2. Make sure you see: `https://www.googleapis.com/auth/drive.readonly`
3. If not:
   - Click "EDIT APP"
   - Go to "Scopes" tab
   - Click "ADD OR REMOVE SCOPES"
   - Search for: `drive.readonly`
   - Add it
   - Save

### 5. Wait 2-3 Minutes
Google needs time to update. Wait a few minutes after saving.

### 6. Try OAuth Playground Again
1. Go to: https://developers.google.com/oauthplayground/
2. Click gear icon → Use your own OAuth credentials
3. Enter Client ID and Secret
4. Select scope: `drive.readonly`
5. Click "Authorize APIs"
6. **Use the EXACT EMAIL you added as test user**
7. Click "Allow"

## Still Not Working?

Try these:
- Clear browser cache and cookies
- Try incognito/private browser mode
- Sign out of ALL Google accounts
- Sign in with ONLY the test user email
- Wait 5-10 minutes after making changes
- Double-check the email matches exactly (case-sensitive)

## Verify Your Setup

Run this checklist:
- [ ] OAuth consent screen configured
- [ ] Your email added as test user
- [ ] Test user saved (clicked SAVE button)
- [ ] Scope `drive.readonly` added
- [ ] Redirect URI `https://developers.google.com/oauthplayground` added
- [ ] Using exact test user email when signing in
- [ ] Waited 2-3 minutes after saving

If all checked, it should work!

