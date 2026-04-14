# OAuth Consent Screen Configuration Guide

## App Domain

**Enter your domain (without http/https):**
```
stoic-fit.com
```

**Why:** This is your actual domain. Google uses this to verify the app is legitimate.

## Application Home Page

**Enter a valid URL (no spaces!):**
```
https://stoic-fit.com
```

**Note:** 
- Must be a valid URL starting with `http://` or `https://`
- No spaces allowed
- Can be your main website URL

## Application Privacy Policy Link

**Option 1: Use your Squarespace privacy policy (if you have one)**
```
https://stoic-fit.com/privacy-policy
```
or
```
https://stoic-fit.com/privacy
```

**Option 2: Create a simple privacy policy page**
- Create a page on your Squarespace site with your privacy policy
- Use that URL

**Option 3: For testing, you can use a placeholder** (Google may require verification later)
```
https://stoic-fit.com/privacy
```

**Note:** Privacy policy is required for production apps, but for testing you can use a placeholder URL that exists on your domain.

## Application Terms of Service Link

**Option 1: Use your Squarespace terms page (if you have one)**
```
https://stoic-fit.com/terms
```
or
```
https://stoic-fit.com/terms-of-service
```

**Option 2: Create a simple terms page**
- Create a page on your Squarespace site with terms of service
- Use that URL

**Option 3: For testing, you can use a placeholder**
```
https://stoic-fit.com/terms
```

**Note:** Terms of service is optional for testing but recommended.

## Complete Example

**App domain:**
```
stoic-fit.com
```

**Application home page:**
```
https://stoic-fit.com
```

**Privacy policy link:**
```
https://stoic-fit.com/privacy
```

**Terms of service link:**
```
https://stoic-fit.com/terms
```

## For Testing/Development

If you don't have these pages yet, you can:

1. **Create simple placeholder pages on Squarespace:**
   - Go to Pages → Add Page
   - Create "Privacy Policy" page
   - Create "Terms of Service" page
   - Note the URLs

2. **Or use your main domain** (Google may show warnings but will allow testing):
   - Privacy: `https://stoic-fit.com`
   - Terms: `https://stoic-fit.com`

## Important Notes

- **App domain** must be a real domain you own
- **Home page** must be a valid URL (no spaces!)
- **Privacy policy** is required for production apps
- **Terms** are optional but recommended
- For testing mode, Google is more lenient about these requirements

## After Filling Out

1. Click "SAVE AND CONTINUE"
2. Add scopes (drive.readonly)
3. Add test users (your email)
4. Save everything

