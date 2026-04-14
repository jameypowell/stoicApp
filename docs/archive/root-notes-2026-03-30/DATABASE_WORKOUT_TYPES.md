# Database Workout Types

## How Workouts are Distinguished

The database uses two fields to distinguish between workout types:

### 1. `workout_type` Field
- **'regular'**: Functional Fitness Workouts (default)
- **'core'**: Core Finisher Workouts

### 2. `google_drive_file_id` Field
- **Functional Fitness Workouts**: `1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4`
- **Core Finisher Workouts**: `1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4`

## Database Schema

```sql
CREATE TABLE workouts (
  id SERIAL PRIMARY KEY,
  workout_date DATE UNIQUE NOT NULL,
  google_drive_file_id TEXT NOT NULL,
  title TEXT,
  content TEXT,
  workout_type TEXT DEFAULT 'regular' CHECK(workout_type IN ('regular', 'core')),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
```

## Querying Workouts

### Get Functional Fitness Workouts
```sql
SELECT * FROM workouts 
WHERE workout_type = 'regular' 
   OR (workout_type IS NULL AND google_drive_file_id = '1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4');
```

### Get Core Finisher Workouts
```sql
SELECT * FROM workouts 
WHERE workout_type = 'core' 
   OR (workout_type IS NULL AND google_drive_file_id = '1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4');
```

## Important Notes

- **Date Uniqueness**: The `workout_date` field is UNIQUE, so only ONE workout can exist per date
- **Import Conflict**: When importing core finishers, they were assigned dates starting from today, which overwrote existing functional fitness workouts on those dates
- **Solution**: Core finishers should use dates that don't conflict with functional fitness workout dates, or use a separate date range

## Current Status

- **Functional Fitness Workouts**: Stored with `workout_type = 'regular'` and file ID `1pBH4goEPWJquNr5iIQnczKZDnyWYCoTjxjD9SD6mfH4`
- **Core Finisher Workouts**: Stored with `workout_type = 'core'` and file ID `1H1EGE1_t2tEHlSL0nhCcWf3HSvt8iHpKAnq6oBsxqI4`





