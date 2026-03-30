# Production Strength Workouts Migration Guide

This guide documents the step-by-step process to migrate the strength workouts feature from dev (SQLite) to production (Postgres).

## Overview

The strength workouts feature has been fully implemented in dev with:
- New normalized schema (workout, workout_blocks, block_exercises, exercises, equipment, workout_formats, workout_types)
- Phase One, Two, and Three strength workouts seeded
- Backend API endpoints using the new schema
- Frontend UI with phase-based numbering (1-1, 1-2, 2-1, etc.)

This migration brings production up to date by mirroring the dev implementation.

## Prerequisites

- Production Postgres database credentials (DB_HOST, DB_USER, DB_PASSWORD, DB_NAME)
- Backup of production database (CRITICAL - do not skip)
- Access to run migration scripts against production

## Migration Phases

### PHASE 0: Prep and Safety ✅

**Status**: Complete

- [x] Confirmed database connection logic (USE_POSTGRES = !!process.env.DB_HOST)
- [x] Created migration structure
- [x] Documented migration process

**Action Required**: 
- Take a backup of production Postgres database before proceeding
- Verify DB_HOST environment variable points to production Postgres

### PHASE 1: Schema Migrations ✅

**Status**: Complete - Migration script created

**Script**: `migrations/migrate_strength_workouts_schema.js`

**What it does**:
- Creates all new tables needed for strength workouts:
  - `exercises` (global exercise library)
  - `equipment` (master equipment list)
  - `exercise_equipment` (join table)
  - `workout_types` (categories: STRENGTH, CORE, etc.)
  - `workout_formats` (JSON-based format definitions for Phase 1-3)
  - `workout` (workout templates - singular to avoid conflict with existing `workouts` table)
  - `workout_blocks` (sections: Warm-Up, Primary, Secondary)
  - `block_exercises` (assign exercises to blocks)
- Creates all necessary indexes
- Non-destructive: Only creates tables if they don't exist

**To Run**:
```bash
# Set production database environment variables
export DB_HOST=your-production-host
export DB_USER=your-db-user
export DB_PASSWORD=your-db-password
export DB_NAME=your-db-name

# Run migration
node migrations/migrate_strength_workouts_schema.js
```

**Verification**:
```sql
-- Check that all tables exist
SELECT table_name FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('exercises', 'equipment', 'exercise_equipment', 'workout_types', 
                   'workout_formats', 'workout', 'workout_blocks', 'block_exercises');
```

### PHASE 2: Seed Reference Data 🚧

**Status**: In Progress - Seed script created

**Script**: `scripts/seed_strength_reference_data_simple.js`

**What it does**:
- Seeds `workout_types` with STRENGTH entry
- Seeds `equipment` table (30+ equipment items)
- Seeds `workout_formats` (Phase One, Two, Three format definitions)
- Seeds `exercise` table (400+ exercises from seed files)
- Updates exercise names (Romanian Deadlift, Alternating Single Arm Swing)

**To Run**:
```bash
# With production DB env vars set
node scripts/seed_strength_reference_data_simple.js
```

**Note**: The script executes SQL seed files directly, converting SQLite syntax (INSERT OR IGNORE) to Postgres syntax (INSERT ... ON CONFLICT DO NOTHING) where needed.

**Verification**:
```sql
-- Check equipment count
SELECT COUNT(*) FROM equipment; -- Should be ~30

-- Check workout_formats
SELECT name, phase FROM workout_formats; -- Should have Phase One, Two, Three

-- Check exercises
SELECT COUNT(*) FROM exercise; -- Should be 400+

-- Check workout_types
SELECT * FROM workout_types WHERE code = 'STRENGTH';
```

### PHASE 3: Seed Strength Workouts ✅

**Status**: Complete - Script created

**Script**: `scripts/seed_strength_workouts.js`

**What it does**:
- Seeds Phase One workouts (8 workouts: Glutes/Quads A + 7 Day workouts)
- Seeds Phase Two workouts (7 workouts)
- Seeds Phase Three workouts (7 workouts)
- Each workout includes:
  - Entry in `workout` table
  - Blocks in `workout_blocks` table (warmup, primary, secondary)
  - Exercises in `block_exercises` table
- Executes SQL seed files with Postgres syntax conversion
- Handles idempotent inserts (safe to run multiple times)

**To Run**:
```bash
# With production DB env vars set
node scripts/seed_strength_workouts.js
```

**Note**: The script reads the existing SQL seed files (`seed_phase_one_week_workouts.sql`, `seed_phase_one_glutes_quads_workout.sql`, `seed_phase_two_week_workouts.sql`, `seed_phase_three_workouts.sql`) and converts SQLite syntax to Postgres where needed.

**Verification**:
```sql
-- Check Phase One workouts
SELECT id, name, phase FROM workout WHERE phase = 'Phase One';
-- Should return 8 workouts

-- Check Phase Two workouts
SELECT id, name, phase FROM workout WHERE phase = 'Phase Two';
-- Should return 7 workouts

-- Check Phase Three workouts
SELECT id, name, phase FROM workout WHERE phase = 'Phase Three';
-- Should return 7 workouts

-- Verify blocks and exercises are linked
SELECT w.name, COUNT(DISTINCT wb.id) as block_count, COUNT(be.id) as exercise_count
FROM workout w
LEFT JOIN workout_blocks wb ON w.id = wb.workout_id
LEFT JOIN block_exercises be ON wb.id = be.block_id
WHERE w.phase = 'Phase One'
GROUP BY w.id, w.name;
```

### PHASE 4: Backend Logic ✅

**Status**: Should already work - Database class handles both SQLite and Postgres

**What to verify**:
- API endpoint `/api/strength-workouts` returns workouts from new `workout` table
- API endpoint `/api/strength-workouts/:id` returns workout with blocks and exercises
- `displayWorkoutNumber` is calculated correctly (1-1, 1-2, 2-1, etc.)

**Testing**:
```bash
# Test API endpoint (with auth token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-production-url/api/strength-workouts?phase=Phase%20One"

# Should return JSON with workouts array, each with displayWorkoutNumber
```

**Note**: The backend code in `routes.js` and `database.js` already handles both SQLite and Postgres. The `Database` class abstracts the differences. No code changes should be needed.

### PHASE 5: UI Wiring ✅

**Status**: Should already work - Frontend code is database-agnostic

**What to verify**:
- Phase One, Two, Three tabs work correctly
- Workouts display with correct numbering (Workout: 1-1, Workout: 2-3, etc.)
- Info pills show: Workout number, Phase, Primary/Secondary focus, FMP
- Warm-Up section shows "Warm-Up: 2 Sets of 10 Reps Each"
- Format sections show correct bullets for each phase
- Carousel displays workouts correctly

**Note**: The frontend code in `public/app.js` is already database-agnostic. It fetches data from the API and renders it. No code changes should be needed.

### PHASE 6: Final Validation ⏳

**Status**: Pending

**Checklist**:
- [ ] All Phase One workouts display correctly
- [ ] All Phase Two workouts display correctly
- [ ] All Phase Three workouts display correctly
- [ ] Workout numbering is correct (1-1 through 1-8, 2-1 through 2-7, 3-1 through 3-7)
- [ ] No duplicate exercises within the same workout
- [ ] Format sections show correct tempo and instructions
- [ ] Info pills wrap correctly on mobile
- [ ] Carousel navigation works
- [ ] Switching between phases works smoothly

## Rollback Plan

If something goes wrong:

1. **Schema Issues**: The migration is non-destructive. New tables can be dropped:
   ```sql
   DROP TABLE IF EXISTS block_exercises CASCADE;
   DROP TABLE IF EXISTS workout_blocks CASCADE;
   DROP TABLE IF EXISTS workout CASCADE;
   DROP TABLE IF EXISTS workout_formats CASCADE;
   DROP TABLE IF EXISTS workout_types CASCADE;
   DROP TABLE IF EXISTS exercise_equipment CASCADE;
   DROP TABLE IF EXISTS equipment CASCADE;
   DROP TABLE IF EXISTS exercises CASCADE;
   ```

2. **Data Issues**: Restore from backup

3. **Code Issues**: The backend code already handles both old and new schemas. The old `strength_workouts` table still exists and can be used as fallback if needed.

## Notes

- The old `strength_workouts` table is NOT removed. It remains for backward compatibility.
- The new `workout` table (singular) is separate from the existing `workouts` table (plural).
- The `exercise` table (singular) is the legacy table used by seed files. The `exercises` table (plural) is the new normalized table. The code uses COALESCE to handle both.
- All migrations and seeds are idempotent - safe to run multiple times.

## Next Steps

1. Complete Phase 2 seed script (fix Postgres syntax conversion)
2. Create Phase 3 seed script for workouts
3. Test in staging environment first
4. Run migrations in production
5. Validate all phases work correctly

