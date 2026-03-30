# Sync All Workouts from Google Slides

## Overview

This feature allows you to parse a Google Slides presentation and extract **each slide individually** as a separate workout entry. Each slide is parsed to extract its date, and stored as a separate workout in the database.

## How It Works

1. **Extracts each slide individually** from the presentation
2. **Parses dates** from slide text (looks for patterns like "November 3rd, 2025")
3. **Stores each workout** in the database with its extracted date
4. **Works for production** - uses SQLite database that persists

## Usage

### Method 1: Using the Script (Recommended)

```bash
node sync-all-workouts.js <FILE_ID>
```

**Example:**
```bash
node sync-all-workouts.js 1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4
```

**What it does:**
- Parses all slides from the presentation
- Extracts dates from each slide
- Shows you what was found
- Stores workouts with valid dates in database
- Reports any slides without dates

### Method 2: Using the API Endpoint

```bash
# Get a token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@example.com","password":"admin123"}' \
  | grep -o '"token":"[^"]*' | cut -d'"' -f4)

# Sync all workouts
curl -X POST http://localhost:3000/api/admin/workouts/sync-all \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"fileId":"1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4"}' \
  | python3 -m json.tool
```

## Date Parsing

The system automatically detects dates in these formats:

- **"November 3rd, 2025"** or **"November 3, 2025"**
- **"11/3/2025"** or **"11-3-2025"**
- **"2025-11-03"**
- **"Nov 3, 2025"**

If a slide doesn't contain a recognizable date, it will be skipped (won't be stored).

## Database Storage

- **Each workout** is stored as a separate row in the `workouts` table
- **Date field** is used as the unique identifier (YYYY-MM-DD format)
- **Content** includes all text from that specific slide
- **Persists** - stored in SQLite database file (`data/stoic-shop.db`)

## Production Ready

✅ **SQLite database** - Works for production
- Lightweight and fast
- Single file database
- Easy to backup
- Can migrate to PostgreSQL later if needed

✅ **Database file location**: `data/stoic-shop.db`
- Include in your deployment
- Backup regularly
- Can be migrated to cloud database later

## Example Output

```
✅ Slides Parsed Successfully!

📄 File Information:
  File ID: 1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4
  File Name: Stoic November 3rd-December 3rd 6 Week Programing
  Title: Stoic November 3rd-December 3rd 6 Week Programing
  Total Slides: 32

📋 Parsed Workouts:

✅ Workouts with dates: 6
  1. Slide 2: 2025-11-03
     Preview: Program Overview This 6 Week Phase of programing...
  2. Slide 3: 2025-11-04
     Preview: Upper Body Hypertrophy November 4th, 2025 Tuesday...
  ...

💾 Storing workouts in database...

✅ COMPLETE!
Database Results:
  Total processed: 6
  Successfully stored: 6
  Failed: 0
```

## Troubleshooting

**"No workouts with valid dates found":**
- Check that slides contain dates in recognized formats
- Look at the preview output to see what text was extracted
- Manually add dates to slides if needed

**"Some slides skipped":**
- Slides without dates won't be stored
- This is expected behavior
- Only slides with valid dates become workouts

**"Database errors":**
- Check file permissions on `data/` directory
- Ensure database file is writable
- Check disk space

## Viewing Stored Workouts

After syncing, you can view stored workouts:

```bash
# List all workouts (via API)
curl http://localhost:3000/api/workouts \
  -H "Authorization: Bearer YOUR_TOKEN" \
  | python3 -m json.tool
```

## Adding More Workouts

To add workouts from other presentations:

1. **Sync each presentation separately:**
   ```bash
   node sync-all-workouts.js FILE_ID_1
   node sync-all-workouts.js FILE_ID_2
   ```

2. **Or use the API** for each file

3. **All workouts** will be stored in the same database

## Database Backup

For production, backup your database:

```bash
# Backup database
cp data/stoic-shop.db backups/stoic-shop-$(date +%Y%m%d).db
```

## Next Steps

After syncing workouts:
1. Test accessing workouts via API
2. Verify date-based access control works
3. Test subscription tiers
4. Deploy to production (database persists)

