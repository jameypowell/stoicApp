# Google API Credentials Reference

## Client ID
YOUR_GOOGLE_OAUTH_CLIENT_ID.apps.googleusercontent.com

## Client Secret
YOUR_GOOGLE_OAUTH_CLIENT_SECRET

## Status
✅ Client ID: Added to .env
✅ Client Secret: Added to .env
✅ Refresh Token: Added to .env

## Refresh Token
YOUR_GOOGLE_REFRESH_TOKEN

## Next Steps

1. Get refresh token using OAuth Playground:
   - Go to: https://developers.google.com/oauthplayground/
   - Click gear icon → Use your own OAuth credentials
   - Enter Client ID and Client Secret above
   - Select scope: `https://www.googleapis.com/auth/drive.readonly`
   - Authorize → Exchange code → Copy refresh token

2. Add refresh token to .env:
   ```
   GOOGLE_REFRESH_TOKEN=your_refresh_token_here
   ```

3. Test Google Drive connection:
   ```bash
   # Sync a workout from Google Drive
   curl -X POST http://localhost:3000/api/admin/workouts/sync \
     -H "Authorization: Bearer YOUR_TOKEN" \
     -H "Content-Type: application/json" \
     -d '{"fileId":"YOUR_GOOGLE_DRIVE_FILE_ID","workoutDate":"2024-11-05"}'
   ```

## Security Note

⚠️ These credentials are sensitive. Never commit this file to git!
The .env file is already in .gitignore for protection.

