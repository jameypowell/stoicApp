# What is Request URI?

## Common Contexts

### 1. OAuth Redirect URI (Most Common)

If you're setting up OAuth credentials, you need **redirect URIs** (not "Request URI"):

**For OAuth Playground:**
```
https://developers.google.com/oauthplayground
```

**For Local Development:**
```
http://localhost:3000/auth/google/callback
```

**For Production:**
```
https://stoic-fit.com/auth/google/callback
```

### 2. API Request URI

If you're configuring an API endpoint, "Request URI" might refer to:
- The API endpoint URL
- Usually not needed for Google Cloud APIs
- Leave blank if unsure

### 3. OAuth Consent Screen - Application Homepage

If you're filling out the OAuth consent screen:
- **Application Homepage**: `https://stoic-fit.com`
- **Privacy Policy**: `https://stoic-fit.com/privacy` (or your privacy page)
- **Terms of Service**: `https://stoic-fit.com/terms` (or your terms page)

## Where Are You Seeing This?

**If you're in "APIs & Services" → "Credentials" → OAuth Client:**
- Look for "Authorized redirect URIs"
- Add: `https://developers.google.com/oauthplayground`
- Add: `http://localhost:3000/auth/google/callback`

**If you're in OAuth Consent Screen:**
- Request URI is usually not needed
- Fill in: Application Homepage, Privacy Policy, Terms of Service

**If you're configuring an API:**
- Request URI is usually not needed
- Leave blank or use the API endpoint URL

## Quick Answer

Most likely you need **Redirect URIs**:

1. `https://developers.google.com/oauthplayground` (for OAuth Playground)
2. `http://localhost:3000/auth/google/callback` (for local development)

If you can share which form/page you're on, I can give you the exact answer!

