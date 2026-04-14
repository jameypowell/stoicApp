# Fix: Error 403 access_denied in OAuth Playground

## Quick Checklist

Go through these steps in order:

### Step 1: Verify OAuth Consent Screen is Configured

1. Go to: https://console.cloud.google.com/apis/credentials/consent
2. Check the **"Publishing status"** at the top
3. What does it say?
   - ✅ **"Testing"** = Good, continue to Step 2
   - ✅ **"In production"** = Good, continue to Step 2
   - ❌ **"Not configured"** = Click "CONFIGURE CONSENT SCREEN" and set it up

### Step 2: Check Test Users (CRITICAL if in Testing mode)

1. On the consent screen page, scroll to **"Test users"** section
2. Click **"ADD USERS"** if your email is not listed
3. Add your exact email address (the one you'll use to sign in)
4. Click **"ADD"**
5. **IMPORTANT**: Click "SAVE AND CONTINUE" or "BACK TO DASHBOARD" to save

### Step 3: Verify Scopes are Added

1. On the consent screen page, check the **"Scopes"** section
2. Make sure you see: `https://www.googleapis.com/auth/drive.readonly`
3. If not:
   - Click "EDIT APP" or go to scopes tab
   - Click "ADD OR REMOVE SCOPES"
   - Search for and add: `https://www.googleapis.com/auth/drive.readonly`
   - Save

### Step 4: Verify Redirect URI

1. Go to: https://console.cloud.google.com/apis/credentials
2. Click on your OAuth Client ID: `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com`
3. Check **"Authorized redirect URIs"**
4. Make sure `https://developers.google.com/oauthplayground` is listed
5. If not, add it and save

### Step 5: Try OAuth Playground Again

1. Go to: https://developers.google.com/oauthplayground/
2. Click gear icon → Use your own OAuth credentials
3. Enter:
   - Client ID: `YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com`
   - Client Secret: `YOUR_GOOGLE_OAUTH_CLIENT_SECRET`
4. Select scope: `https://www.googleapis.com/auth/drive.readonly`
5. Click "Authorize APIs"
6. **Use the EXACT EMAIL** you added as a test user
7. Click "Allow"

## Common Issues

### "I don't see Test users section"
- Your app might be in "Publishing" state
- Wait for it to finish, or check if it's stuck

### "I added myself as test user but still getting error"
- Make sure you clicked "SAVE" after adding test user
- Try signing out of all Google accounts
- Sign in with ONLY the test user email
- Try OAuth Playground again

### "Scope not showing up"
- Make sure you saved after adding the scope
- Sometimes it takes a few minutes to propagate
- Try refreshing the consent screen page

### "Still getting access_denied"
- Clear browser cache and cookies
- Try incognito/private mode
- Make sure you're using the exact email added as test user
- Wait 5-10 minutes after making changes (Google needs time to update)

## Alternative: Publish App (Advanced)

If you keep having issues, you can publish the app:
1. Go to OAuth consent screen
2. Click "PUBLISH APP"
3. Fill in required information (privacy policy, etc.)
4. This makes it available to all users (not just test users)

**Note**: Publishing requires app verification if you add sensitive scopes, which can take days/weeks.

**Recommendation**: Keep it in Testing mode and add yourself as a test user - it's simpler for development.

