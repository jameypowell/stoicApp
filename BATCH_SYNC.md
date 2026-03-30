# Batch Sync Multiple Google Slides Presentations

## Quick Command to Sync All

```bash
# Sync multiple presentations
node sync-all-workouts.js FILE_ID_1
node sync-all-workouts.js FILE_ID_2
node sync-all-workouts.js FILE_ID_3
node sync-all-workouts.js FILE_ID_4
```

## What Happens

1. Each presentation is parsed slide by slide
2. Dates are extracted from each slide
3. Only slides with valid dates are stored
4. All workouts are added to the same database
5. Duplicate dates are updated (replaced)

## File IDs Extracted

From your URLs:
- `1uTw7oMZzy1FCbW8aoCDMYFbcHS_RudaKaoDdJc6mJcQ` - September 15th - Oct. 31st
- `17uNg3-IutAl01a8x4iZ3Rv0rhzgbbxV4Gtiv72S3C30`
- `18N_aPbzRSZFxV6cPUe_5k22gY5n9P4HCP-pSGDc5ADQ`
- `15zRf9laf5Rgv1Pm5WubuSfPzQNIOFPOGk87ZlJepw7o`

## View Results

After syncing, check what's stored:

```bash
# View all stored workouts
node view-stored-workouts.js

# View specific workout
node view-workout-db.js 2025-09-15
```

## Notes

- **Duplicate dates**: If multiple slides have the same date, the last one synced will overwrite
- **No dates**: Slides without dates will be skipped
- **All stored in same database**: All workouts from all presentations go into one database

