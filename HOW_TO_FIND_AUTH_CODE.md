# How to Find the Authorization Code from Callback URL

## Step-by-Step Process

### Step 1: Run the Script
```bash
node get-google-token.js
```

The script will output something like:
```
Visit this URL to authorize:
https://accounts.google.com/o/oauth2/auth?access_type=offline&client_id=...
```

### Step 2: Visit the Authorization URL

1. **Copy the entire URL** that the script outputs
2. **Paste it into your web browser**
3. **Sign in** with your Google account (the one you added as a test user)
4. **Click "Allow"** to grant permissions

### Step 3: Google Redirects You

After you click "Allow", Google will redirect you to a callback URL. This URL will look like:

```
http://localhost:3000/auth/google/callback?code=4/0AeanS...VERY_LONG_CODE...&scope=https://www.googleapis.com/auth/drive.readonly
```

### Step 4: Find the Code Parameter

The authorization code is in the URL after `code=`. It's the long string between `code=` and `&scope=`.

**Example:**
- Full URL: `http://localhost:3000/auth/google/callback?code=4/0AeanS1234567890abcdefghijklmnopqrstuvwxyz&scope=...`
- **Code to copy**: `4/0AeanS1234567890abcdefghijklmnopqrstuvwxyz`

### Step 5: Copy the Code

You can:
1. **Copy from the address bar** - Select everything after `code=` up to (but not including) `&scope=`
2. **Or copy the entire URL** and extract the code manually

### Step 6: Paste into the Script

The script will be waiting at the prompt:
```
Enter the code from the callback URL: 
```

Paste the code (or the full URL) and press Enter.

## Visual Guide

```
1. Script outputs: https://accounts.google.com/o/oauth2/auth?...
   ↓
2. You visit URL in browser
   ↓
3. Google redirects to: http://localhost:3000/auth/google/callback?code=4/0AeanS...&scope=...
   ↓
4. Copy the code part: 4/0AeanS...
   ↓
5. Paste into script prompt
```

## Important Notes

- **The code expires quickly** - usually within a few minutes
- **If you see "invalid_grant"** - the code expired, run the script again
- **The callback URL might show an error** - that's okay! The code is still in the URL
- **You can copy the entire URL** - the script will extract just the code part

## Troubleshooting

**"Page not found" or "Cannot connect" error:**
- This is normal! The callback URL is just for getting the code
- The code is still in the URL even if the page doesn't load
- Copy the entire URL from the address bar

**Code not working:**
- Codes expire quickly (usually 1-5 minutes)
- Run the script again to get a new authorization URL
- Make sure you're copying the entire code (it's usually quite long)

## Alternative: Use OAuth Playground

If the script method is confusing, you can also use OAuth Playground (which you already successfully did):
- https://developers.google.com/oauthplayground/
- This method is easier and doesn't require copying codes manually

