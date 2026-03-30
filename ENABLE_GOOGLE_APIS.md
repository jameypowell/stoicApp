# Enable Google Drive API

## Problem
The refresh token is working perfectly! ✅ But Google Drive API is not enabled in your project.

## Solution: Enable Google Drive API

### Step 1: Go to APIs Library
Visit: https://console.cloud.google.com/apis/library

**OR** use the direct link:
https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=217583573803

### Step 2: Enable Google Drive API
1. Search for **"Google Drive API"** in the search bar
2. Click on **"Google Drive API"**
3. Click the big blue **"ENABLE"** button

### Step 3: Also Enable Google Slides API
While you're there, also enable:
1. Search for **"Google Slides API"**
2. Click on **"Google Slides API"**
3. Click **"ENABLE"**

Both APIs are needed for your workout sync feature.

### Step 4: Wait a Few Minutes
After enabling, wait 2-3 minutes for the changes to propagate.

### Step 5: Test Again
Run the test script:
```bash
node test-google-drive.js
```

Or test via your API:
```bash
curl -X POST http://localhost:3000/api/admin/workouts/sync \
  -H "Authorization: Bearer YOUR_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileId":"YOUR_FILE_ID","workoutDate":"2024-11-05"}'
```

## Quick Links

- Google Drive API: https://console.developers.google.com/apis/api/drive.googleapis.com/overview?project=217583573803
- Google Slides API: https://console.developers.google.com/apis/api/slides.googleapis.com/overview?project=217583573803
- APIs Library: https://console.cloud.google.com/apis/library

## Status Check

After enabling, you should see:
- ✅ Google Drive API: Enabled
- ✅ Google Slides API: Enabled

Then your workout sync will work!

