# How to Share Your Google Drive Folder

## Step-by-Step Instructions

### Step 1: Open Your Google Drive Folder

1. Go to **Google Drive**: https://drive.google.com
2. Navigate to the folder containing your workout slides
3. **Click on the folder** to open it (or right-click if you want to share from the list view)

### Step 2: Open Share Settings

**Option A: From inside the folder**
- Click the **"Share"** button in the top right corner
- Or click the folder name at the top, then click "Share"

**Option B: From folder list**
- **Right-click** on the folder
- Select **"Share"** from the menu

### Step 3: Add Your Email Address

1. In the **"Share with people and groups"** dialog box:
   - You'll see a text field at the top
   - Type your **Google account email address** (the one you used in OAuth Playground)
   - Example: `youremail@gmail.com`

2. Choose permission level:
   - Click the dropdown next to your email (probably says "Viewer")
   - Select **"Viewer"** (read-only access is enough)
   - This allows the app to read/access files but not modify them

3. **Optional**: Add a note (like "For Stoic Shop API access")

4. Click **"Send"** or **"Share"**

### Step 4: Verify Access

1. Make sure the folder appears in your Google Drive
2. You should see the folder listed with the name you gave it
3. The folder should be accessible when you click on it

## Important Notes

- **Use the same email** that you used when authorizing in OAuth Playground
- **Viewer permission is sufficient** - the app only needs to read files
- **If the folder is already owned by your account**, you might already have access
- **If you're the owner**, you don't need to share it - you already have access!

## Quick Checklist

- [ ] Found your Google Drive folder with workout slides
- [ ] Clicked "Share" button
- [ ] Added your Google account email (same one used in OAuth)
- [ ] Set permission to "Viewer"
- [ ] Clicked "Share" or "Send"

## Troubleshooting

**"I can't find the Share button":**
- Make sure you're signed in to Google Drive
- Try right-clicking on the folder instead
- Or open the folder first, then look for Share button

**"The folder is already owned by me":**
- If you're the owner/creator of the folder, you already have access!
- No need to share it - you can skip this step
- The OAuth flow will work with your account's default permissions

**"I'm not sure which email to use":**
- Use the exact same email you used when authorizing in OAuth Playground
- Check your Google account email in your profile settings
- The email should match the one added as a test user in Google Cloud Console

## Visual Guide

```
1. Google Drive → Find folder
   ↓
2. Click folder → Click "Share" button
   ↓
3. Add your email address
   ↓
4. Set permission: "Viewer"
   ↓
5. Click "Share"
   ✅ Done!
```

## After Sharing

Once the folder is shared (or already accessible to your account):
- ✅ Your OAuth flow can access files in that folder
- ✅ The workout sync endpoint will be able to read slides
- ✅ You're ready to test syncing workouts!

