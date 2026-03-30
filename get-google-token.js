const { google } = require('googleapis');
const readline = require('readline');
require('dotenv').config();

const oauth2Client = new google.auth.OAuth2(
  process.env.GOOGLE_CLIENT_ID,
  process.env.GOOGLE_CLIENT_SECRET,
  'https://developers.google.com/oauthplayground' // Use OAuth Playground redirect URI
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

