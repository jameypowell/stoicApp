# How to Set Up Stripe and Google Credentials

## Part 1: Setting Up Stripe

### Step 1: Create a Stripe Account

1. Go to https://stripe.com
2. Click **"Sign up"** in the top right
3. Enter your email and create a password
4. Verify your email address

### Step 2: Get Your API Keys (Test Mode)

1. Once logged in, you'll see the Stripe Dashboard
2. Make sure you're in **Test mode** (toggle in the top right should say "Test mode")
3. Click on **"Developers"** in the left sidebar
4. Click **"API keys"** under Developers
5. You'll see two keys:
   - **Publishable key** (starts with `pk_test_...`)
   - **Secret key** (starts with `sk_test_...`) - Click "Reveal test key" to see it

### Step 3: Add Keys to Your .env File

Create or edit your `.env` file in the project root:

```env
STRIPE_SECRET_KEY=sk_test_your_secret_key_here
STRIPE_PUBLISHABLE_KEY=pk_test_your_publishable_key_here
```

**Important**: 
- Never commit your `.env` file to git (it's already in `.gitignore`)
- The `sk_test_` keys are for testing - use `sk_live_` keys for production
- Keep your secret key secure!

### Step 4: Set Up Stripe Webhook (for local testing)

#### Option A: Using Stripe CLI (Recommended for development)

1. **Install Stripe CLI**:
   - macOS: `brew install stripe/stripe-cli/stripe`
   - Or download from: https://stripe.com/docs/stripe-cli

2. **Login to Stripe CLI**:
   ```bash
   stripe login
   ```
   This will open your browser to authorize.

3. **Forward webhooks to your local server**:
   ```bash
   stripe listen --forward-to localhost:3000/api/webhooks/stripe
   ```
   
4. **Copy the webhook signing secret**:
   You'll see output like:
   ```
   > Ready! Your webhook signing secret is YOUR_STRIPE_WEBHOOK_SECRET
   ```
   
5. **Add to .env**:
   ```env
   STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET
   ```

#### Option B: Using Stripe Dashboard (for production)

1. In Stripe Dashboard, go to **Developers** → **Webhooks**
2. Click **"Add endpoint"**
3. Enter your production URL: `https://your-domain.com/api/webhooks/stripe`
4. Select events to listen for:
   - `payment_intent.succeeded`
   - `payment_intent.payment_failed`
5. Copy the **"Signing secret"** (starts with `whsec_...`)
6. Add to your production `.env` file

### Step 5: Test Your Stripe Setup

Test cards you can use:
- **Success**: `4242 4242 4242 4242`
- **Decline**: `4000 0000 0000 0002`
- **Requires auth**: `4000 0025 0000 3155`

Use any:
- Expiry: Future date (e.g., `12/34`)
- CVC: Any 3 digits (e.g., `123`)
- ZIP: Any 5 digits (e.g., `12345`)

---

## Part 2: Setting Up Google Drive API

### Step 1: Create a Google Cloud Project

1. Go to https://console.cloud.google.com
2. Sign in with your Google account (the one that has access to your workout slides)
3. Click the project dropdown at the top
4. Click **"New Project"**
5. Enter project name: `Stoic Fit Shop` (or any name)
6. Click **"Create"**

### Step 2: Enable Required APIs

1. In your project, go to **"APIs & Services"** → **"Library"**
2. Search for **"Google Drive API"** and click it
3. Click **"Enable"**
4. Go back to Library
5. Search for **"Google Slides API"** and click it
6. Click **"Enable"**

### Step 3: Create OAuth 2.0 Credentials

1. Go to **"APIs & Services"** → **"Credentials"**
2. Click **"+ CREATE CREDENTIALS"** at the top
3. Select **"OAuth client ID"**
4. If prompted, configure the OAuth consent screen first:
   - Choose **"External"** (unless you have a Google Workspace)
   - Click **"Create"**
   - Fill in:
     - App name: `Stoic Fit Shop`
     - User support email: Your email
     - Developer contact: Your email
   - Click **"Save and Continue"** through the steps
   - Click **"Back to Dashboard"**

5. **Create OAuth Client ID**:
   - Application type: **"Web application"**
   - Name: `Stoic Shop Backend`
   - Authorized redirect URIs: 
     - `http://localhost:3000/auth/google/callback` (for testing)
     - `https://your-domain.com/auth/google/callback` (for production)
   - Click **"Create"**

6. **Copy your credentials**:
   - You'll see a popup with:
     - **Client ID** (ends with `.apps.googleusercontent.com`)
     - **Client secret** (a long string)
   - Copy both of these!

### Step 4: Get Refresh Token

You need to authenticate once to get a refresh token. Here's the easiest method:

#### Method 1: Using OAuth Playground (Easiest)

1. Go to https://developers.google.com/oauthplayground/

2. **Configure OAuth Playground**:
   - Click the gear icon (⚙️) in the top right
   - Check **"Use your own OAuth credentials"**
   - Paste your **Client ID** and **Client Secret**
   - Click **"Close"**

3. **Select scopes**:
   - In the left panel, scroll down to **"Drive API v3"**
   - Expand it and check:
     - `https://www.googleapis.com/auth/drive.readonly`
   - Click **"Authorize APIs"**

4. **Authorize**:
   - Sign in with the Google account that has access to your workout slides
   - Click **"Allow"** to grant permissions

5. **Exchange for tokens**:
   - The authorization code will appear in the left panel
   - Click **"Exchange authorization code for tokens"** button
   - In the right panel, you'll see tokens including:
     - **Refresh token** (starts with `1//...` or similar)
   - Copy this refresh token!

#### Method 2: Using Node.js Script (Alternative)

Create a file `get-google-token.js`:

```javascript
const { google } = require('googleapis');
const readline = require('readline');

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'http://localhost:3000/auth/google/callback'
);

const scopes = ['https://www.googleapis.com/auth/drive.readonly'];

const url = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  scope: scopes
});

console.log('Visit this URL to authorize:');
console.log(url);
console.log('\n');

const rl = readline.createInterface({
  input: process.stdin,
  output: process.stdout
});

rl.question('Enter the code from the callback URL: ', (code) => {
  oauth2Client.getToken(code, (err, tokens) => {
    if (err) {
      console.error('Error:', err);
      rl.close();
      return;
    }
    console.log('\nRefresh token:', tokens.refresh_token);
    console.log('\nAdd this to your .env file as GOOGLE_REFRESH_TOKEN');
    rl.close();
  });
});
```

Run it:
```bash
# Make sure GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET are in .env
node get-google-token.js
```

### Step 5: Add Google Credentials to .env

Add these to your `.env` file:

```env
GOOGLE_CLIENT_ID=your_client_id.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=your_client_secret_here
GOOGLE_REFRESH_TOKEN=your_refresh_token_here
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback
```

### Step 6: Share Your Google Drive Folder (Important!)

Your Google Service Account needs access to the workout slides:

1. Open the Google Drive folder containing your workout slides
2. Click the **"Share"** button
3. Add this email address: `your-client-id@your-project.iam.gserviceaccount.com`
   - Actually, wait - for OAuth, you use your personal Google account, so:
4. Make sure the Google account you used to authorize has access to the folder
5. Share the folder with that account if needed

**Better approach**: Share the folder with the Google account you used to authorize the OAuth flow.

---

## Complete .env File Example

Here's what your complete `.env` file should look like:

```env
# Server Configuration
PORT=3000
NODE_ENV=development

# JWT Secret (CHANGE THIS!)
JWT_SECRET=your-super-secret-jwt-key-change-this-in-production
JWT_EXPIRES_IN=7d

# Stripe Configuration
STRIPE_SECRET_KEY=sk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz1234567890
STRIPE_PUBLISHABLE_KEY=pk_test_51AbCdEfGhIjKlMnOpQrStUvWxYz1234567890
STRIPE_WEBHOOK_SECRET=YOUR_STRIPE_WEBHOOK_SECRET

# Google Drive API Configuration
GOOGLE_CLIENT_ID=123456789-abcdefghijklmnop.apps.googleusercontent.com
GOOGLE_CLIENT_SECRET=GOCSPX-abcdefghijklmnopqrstuvwxyz
GOOGLE_REFRESH_TOKEN=1//0abcdefghijklmnopqrstuvwxyz-abcdefghijklmnopqrstuvwxyz
GOOGLE_REDIRECT_URI=http://localhost:3000/auth/google/callback

# Database
DB_PATH=data/stoic-shop.db
```

---

## Testing Your Setup

### Test Stripe Connection

I
---

## Troubleshooting

### Stripe Issues

**"Invalid API Key"**:
- Make sure you copied the entire key (they're long!)
- Check you're using test keys (`sk_test_`, `pk_test_`) for development
- Ensure no extra spaces or quotes

**Webhook not working**:
- Make sure Stripe CLI is running: `stripe listen --forward-to localhost:3000/api/webhooks/stripe`
- Check webhook secret matches what's in `.env`
- Verify webhook endpoint is accessible

### Google Drive Issues

**"Invalid credentials"**:
- Double-check Client ID and Client Secret are correct
- Ensure refresh token is complete (they're very long)

**"Access denied"** or **"File not found"**:
- Make sure your Google account has access to the Google Drive folder
- Verify the file ID is correct
- Check that Drive API and Slides API are enabled in Google Cloud Console

**"Refresh token expired"**:
- OAuth refresh tokens can expire
- Re-run the OAuth flow to get a new refresh token
- Consider implementing token refresh logic for production

**"Insufficient permissions"**:
- Make sure you selected the correct scope: `https://www.googleapis.com/auth/drive.readonly`
- Re-authorize if needed

---

## Security Notes

1. **Never commit `.env` file** - It's in `.gitignore` for a reason!
2. **Use test keys for development** - Switch to live keys only in production
3. **Rotate keys periodically** - Especially if they're exposed
4. **Use environment variables** - In production, use AWS Secrets Manager or similar
5. **Limit API permissions** - Only grant the minimum permissions needed

---

## Next Steps

Once both are configured:
1. Restart your server: `npm run dev`
2. Test the endpoints (see Testing section above)
3. Sync your first workout from Google Drive
4. Test the payment flow with Stripe test cards

Need help? Check the error messages in your server logs - they'll usually tell you what's wrong!

