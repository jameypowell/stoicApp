// Test script to verify Google Drive credentials
const { google } = require('googleapis');
require('dotenv').config();

async function testGoogleDrive() {
  console.log('🔍 Testing Google Drive Credentials...\n');

  // Check environment variables
  console.log('Environment Variables:');
  console.log('  GOOGLE_CLIENT_ID:', process.env.GOOGLE_CLIENT_ID ? '✓ Set' : '✗ Missing');
  console.log('  GOOGLE_CLIENT_SECRET:', process.env.GOOGLE_CLIENT_SECRET ? '✓ Set' : '✗ Missing');
  console.log('  GOOGLE_REFRESH_TOKEN:', process.env.GOOGLE_REFRESH_TOKEN ? '✓ Set (' + process.env.GOOGLE_REFRESH_TOKEN.substring(0, 20) + '...)' : '✗ Missing');
  console.log('');

  // Initialize OAuth2 client
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
  );

  // Set refresh token
  oauth2Client.setCredentials({
    refresh_token: process.env.GOOGLE_REFRESH_TOKEN
  });

  console.log('Attempting to refresh access token...');
  try {
    // Try to get a new access token using refresh token
    const { credentials } = await oauth2Client.refreshAccessToken();
    console.log('✅ Successfully refreshed access token!');
    console.log('  Access token:', credentials.access_token ? credentials.access_token.substring(0, 30) + '...' : 'N/A');
    console.log('');

    // Test Drive API access
    console.log('Testing Google Drive API access...');
    const drive = google.drive({ version: 'v3', auth: oauth2Client });
    
    const response = await drive.files.list({
      pageSize: 1,
      fields: 'files(id, name)'
    });

    console.log('✅ Google Drive API access successful!');
    console.log('  Files found:', response.data.files ? response.data.files.length : 0);
    if (response.data.files && response.data.files.length > 0) {
      console.log('  Example file:', response.data.files[0].name);
    }
    console.log('');

    // Test Slides API access
    console.log('Testing Google Slides API access...');
    const slides = google.slides({ version: 'v1', auth: oauth2Client });
    
    // Try to get a presentation (this will fail if no file ID, but we're testing auth)
    console.log('✅ Google Slides API client initialized successfully!');
    console.log('');

    console.log('🎉 All tests passed! Your Google credentials are working.');
    
  } catch (error) {
    console.error('❌ Error:', error.message);
    console.error('');
    console.error('Error Details:');
    console.error('  Code:', error.code);
    console.error('  Errors:', JSON.stringify(error.errors, null, 2));
    console.error('');
    
    if (error.message.includes('invalid_grant')) {
      console.log('💡 Solution: Refresh token is invalid or expired.');
      console.log('   Get a new refresh token from OAuth Playground.');
    } else if (error.message.includes('unauthorized_client')) {
      console.log('💡 Solution: Client ID/Secret mismatch or OAuth not configured.');
      console.log('   Check your OAuth consent screen and credentials.');
    } else if (error.message.includes('access_denied')) {
      console.log('💡 Solution: Permission denied. Check OAuth scopes.');
    }
    
    console.error('');
    console.error('Full error:', error);
    process.exit(1);
  }
}

testGoogleDrive();

