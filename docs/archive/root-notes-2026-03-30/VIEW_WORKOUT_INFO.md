# How to View Workout Information

## Quick Method: Use the View Script

I've created a script that shows you exactly what's being extracted:

```bash
node view-workout.js <FILE_ID> [WORKOUT_DATE]
```

### Example:
```bash
# Extract and view workout
node view-workout.js 1abc123def456 2024-11-05

# Or use today's date (default)
node view-workout.js 1abc123def456
```

### What You'll See:
- File information (ID, name, date)
- Slide count
- Full extracted text content
- Content statistics (character count, word count, etc.)
- Ready-to-use sync command

## Method 2: Sync and View via API

### Step 1: Sync the workout
```bash
# Get a token first
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"test123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Sync workout
curl -X POST http://localhost:3000/api/admin/workouts/sync \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileId":"YOUR_FILE_ID","workoutDate":"2024-11-05"}' \
  | python3 -m json.tool
```

### Step 2: View the stored workout
```bash
# After subscribing, view the workout
curl http://localhost:3000/api/workouts/2024-11-05 \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -m json.tool
```

## Finding Your File ID

1. Open your Google Slides file
2. Look at the URL in your browser:
   ```
   https://docs.google.com/presentation/d/FILE_ID_HERE/edit
   ```
3. Copy the `FILE_ID_HERE` part (between `/d/` and `/edit`)

## What Information is Extracted

- **Title**: Presentation title
- **Content**: All text from all slides combined
- **Slide Count**: Number of slides processed
- **Date**: Workout date you specify

The script extracts text from:
- Text boxes
- Shapes with text
- All slide elements containing text

## Tips

- The view script shows the raw extracted text before it's stored
- The API sync stores it in the database for user access
- You can preview what will be shown to users before syncing

