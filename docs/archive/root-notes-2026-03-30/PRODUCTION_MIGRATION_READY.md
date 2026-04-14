# Production Migration - Ready for Execution

All migration scripts and documentation are complete and ready for production deployment.

## ✅ Completed Components

### 1. Schema Migration
**File**: `migrations/migrate_strength_workouts_schema.js`
- Creates all 8 new tables for strength workouts
- Adds UNIQUE constraint on `workout.name` for idempotent inserts
- Creates all necessary indexes
- Non-destructive (only creates if missing)

### 2. Reference Data Seeding
**File**: `scripts/seed_strength_reference_data_simple.js`
- Seeds `workout_types` (STRENGTH entry)
- Seeds `equipment` (30+ items)
- Seeds `workout_formats` (Phase One, Two, Three)
- Seeds `exercise` table (400+ exercises)
- Updates exercise names (Romanian Deadlift, Alternating Single Arm Swing)

### 3. Strength Workouts Seeding
**File**: `scripts/seed_strength_workouts.js`
- Seeds Phase One workouts (8 total)
- Seeds Phase Two workouts (7 total)
- Seeds Phase Three workouts (7 total)
- Handles SQLite to Postgres syntax conversion
- Idempotent (safe to run multiple times)

### 4. Migration Runner
**File**: `scripts/run_production_migration.sh`
- Runs all phases in order
- Includes safety checks
- Requires backup confirmation

### 5. Documentation
**File**: `PRODUCTION_STRENGTH_WORKOUTS_MIGRATION.md`
- Complete step-by-step guide
- Verification queries
- Rollback instructions

## 🚀 Quick Start

### Prerequisites
1. **Backup production database** (CRITICAL)
2. Set production database environment variables:
   ```bash
   export DB_HOST=your-production-host
   export DB_USER=your-db-user
   export DB_PASSWORD=your-db-password
   export DB_NAME=your-db-name
   ```

### Run Migration

**Option 1: Use the migration runner (recommended)**
```bash
./scripts/run_production_migration.sh
```

**Option 2: Run phases individually**
```bash
# Phase 1: Schema
node migrations/migrate_strength_workouts_schema.js

# Phase 2: Reference Data
node scripts/seed_strength_reference_data_simple.js

# Phase 3: Workouts
node scripts/seed_strength_workouts.js
```

## ✅ Backend & UI Status

### Backend (Phase 4)
**Status**: ✅ Should already work

The backend code in `routes.js` and `database.js` already handles both SQLite and Postgres:
- `Database` class abstracts database differences
- `getAllStrengthWorkoutsFromWorkoutTable()` works with both
- `getStrengthWorkoutById()` works with both
- `displayWorkoutNumber` calculation works for both

**No code changes needed** - just verify API endpoints return correct data after seeding.

### Frontend (Phase 5)
**Status**: ✅ Should already work

The frontend code in `public/app.js` is database-agnostic:
- Fetches data from API endpoints
- Renders workouts based on API response
- Phase-based numbering (1-1, 1-2, etc.) is calculated in backend

**No code changes needed** - just verify UI renders correctly after backend is seeded.

## 📋 Post-Migration Checklist

After running migrations, verify:

- [ ] **Schema**: All tables exist in Postgres
  ```sql
  SELECT table_name FROM information_schema.tables 
  WHERE table_schema = 'public' 
  AND table_name IN ('exercises', 'equipment', 'workout_types', 
                     'workout_formats', 'workout', 'workout_blocks', 
                     'block_exercises');
  ```

- [ ] **Reference Data**: Equipment, exercises, formats seeded
  ```sql
  SELECT COUNT(*) FROM equipment; -- ~30
  SELECT COUNT(*) FROM exercise; -- ~400
  SELECT name FROM workout_formats; -- Phase One, Two, Three
  ```

- [ ] **Workouts**: All phases seeded
  ```sql
  SELECT phase, COUNT(*) FROM workout 
  WHERE phase IN ('Phase One', 'Phase Two', 'Phase Three')
  GROUP BY phase;
  -- Should show: Phase One: 8, Phase Two: 7, Phase Three: 7
  ```

- [ ] **API Endpoints**: Return correct data
  ```bash
  # Test Phase One
  curl -H "Authorization: Bearer TOKEN" \
    "https://your-api/api/strength-workouts?phase=Phase%20One"
  
  # Should return JSON with workouts array, each with displayWorkoutNumber
  ```

- [ ] **UI Rendering**: 
  - Phase One, Two, Three tabs work
  - Workouts display with correct numbering (Workout: 1-1, Workout: 2-3, etc.)
  - Info pills show correctly (Workout number, Phase, Focus, FMP)
  - Warm-Up section shows "Warm-Up: 2 Sets of 10 Reps Each"
  - Format sections show correct bullets
  - Carousel displays workouts correctly

## 🔄 Rollback Plan

If something goes wrong:

1. **Drop new tables** (if needed):
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

2. **Restore from backup**

3. **Old system still works**: The existing `strength_workouts` table remains untouched and can be used as fallback.

## 📝 Notes

- All migrations are **idempotent** - safe to run multiple times
- The old `strength_workouts` table is **NOT removed** - remains for backward compatibility
- The new `workout` table (singular) is separate from existing `workouts` table (plural)
- The `exercise` table (singular) is used by seed files; `exercises` table (plural) is the new normalized table
- Code uses `COALESCE` to handle both exercise table names

## 🎯 Next Steps

1. **Test in staging first** (if available)
2. **Run migration in production** using the runner script
3. **Verify all phases** work correctly
4. **Monitor for any issues**
5. **Clean up old code** (only after confirming everything works)

---

**Ready to proceed!** All scripts are tested and documented. Follow the migration guide for step-by-step execution.




















