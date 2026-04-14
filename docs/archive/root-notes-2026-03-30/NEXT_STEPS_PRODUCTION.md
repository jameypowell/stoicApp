# Next Steps: Deploy to Production

Follow these steps in order to deploy the strength workouts migration to production.

## Step 1: Prepare Environment

### 1.1 Set Production Database Credentials

```bash
export DB_HOST=your-production-postgres-host
export DB_USER=your-production-db-user
export DB_PASSWORD=your-production-db-password
export DB_NAME=your-production-db-name  # Optional, defaults to 'postgres'
```

**⚠️ IMPORTANT**: 
- Double-check these are production credentials (NOT dev/staging)
- Don't commit these to version control
- Consider using a `.env.production` file if your app supports it

### 1.2 Verify Environment

```bash
node scripts/prepare_production_deployment.js
```

This will:
- ✅ Check all environment variables are set
- ✅ Test database connection
- ✅ Check existing tables
- ✅ Verify readiness

**Expected output**: "✅ Environment Ready for Migration!"

## Step 2: Create Database Backup

**⚠️ CRITICAL: Do not skip this step!**

```bash
# Option A: Use the backup script
./scripts/create_backup.sh

# Option B: Manual backup
BACKUP_FILE="backup_strength_migration_$(date +%Y%m%d_%H%M%S).sql"
pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME > $BACKUP_FILE
ls -lh $BACKUP_FILE  # Verify file was created and has size
```

**Verify backup**:
- File exists
- File has reasonable size (not 0 bytes)
- File location is documented

## Step 3: Run Migration

### Option A: Automated Runner (Recommended)

```bash
./scripts/run_production_migration.sh
```

This script will:
1. Check environment variables
2. Ask for backup confirmation
3. Run Phase 1 (Schema Migration)
4. Run Phase 2 (Reference Data Seeding)
5. Run Phase 3 (Workout Seeding)
6. Run Phase 4 (Verification)

**Follow the prompts** - it will pause between phases for you to verify.

### Option B: Manual Execution

If you prefer to run phases individually:

```bash
# Phase 1: Create tables
node migrations/migrate_strength_workouts_schema.js

# Verify Phase 1 completed successfully, then:
# Phase 2: Seed reference data
node scripts/seed_strength_reference_data_simple.js

# Verify Phase 2 completed successfully, then:
# Phase 3: Seed workouts
node scripts/seed_strength_workouts.js

# Phase 4: Verify everything
node scripts/verify_production_migration.js
```

## Step 4: Verify Migration

### 4.1 Database Verification

Connect to your production database and run:

```sql
-- Check tables exist
SELECT table_name 
FROM information_schema.tables 
WHERE table_schema = 'public' 
AND table_name IN ('workout', 'workout_blocks', 'block_exercises',
                   'exercises', 'equipment', 'workout_types',
                   'workout_formats', 'exercise_equipment')
ORDER BY table_name;
-- Should return 8 rows

-- Check workout counts
SELECT phase, COUNT(*) as count 
FROM workout 
WHERE phase IN ('Phase One', 'Phase Two', 'Phase Three')
GROUP BY phase;
-- Expected: Phase One: 8, Phase Two: 7, Phase Three: 7
```

### 4.2 API Verification

Test your API endpoints:

```bash
# Replace with your production URL and auth token
API_URL="https://your-production-url.com"
TOKEN="your-auth-token"

# Test Phase One
curl -H "Authorization: Bearer $TOKEN" \
  "$API_URL/api/strength-workouts?phase=Phase%20One" | \
  jq '.workouts[0] | {id, name, displayWorkoutNumber}'

# Should return something like:
# {
#   "id": 123,
#   "name": "Phase One – Day 1 (Quads / Chest-Shoulders)",
#   "displayWorkoutNumber": "1-1"
# }
```

### 4.3 UI Verification

1. Navigate to your production application
2. Go to Strength Workouts section
3. **Phase One Tab**:
   - Should show 8 workouts
   - Numbered: Workout: 1-1, Workout: 1-2, ..., Workout: 1-8
   - Info pills show: Workout number, Phase, Focus, FMP
   - Warm-Up shows "Warm-Up: 2 Sets of 10 Reps Each"
   - Format section shows Phase One bullets
4. **Phase Two Tab**:
   - Should show 7 workouts
   - Numbered: Workout: 2-1, Workout: 2-2, ..., Workout: 2-7
5. **Phase Three Tab**:
   - Should show 7 workouts
   - Numbered: Workout: 3-1, Workout: 3-2, ..., Workout: 3-7
6. **Test carousel**: Click through different workouts
7. **Test phase switching**: Switch between tabs

## Step 5: Monitor & Validate

### 5.1 Check Application Logs

Monitor your application logs for any errors:
- Database connection errors
- API endpoint errors
- Frontend JavaScript errors

### 5.2 Test User Workflows

- User can access Strength Workouts
- User can switch between phases
- User can view workout details
- Workout numbering is consistent
- No duplicate exercises in workouts

### 5.3 Performance Check

- API response times are acceptable
- Database queries are performing well
- No significant slowdown in application

## Troubleshooting

### Migration Fails

**If any phase fails:**
1. Check the error message in the script output
2. Review database logs
3. Verify environment variables
4. Check database permissions
5. Review the specific phase documentation

**Common issues:**
- **Connection errors**: Check DB_HOST, DB_USER, DB_PASSWORD
- **Permission errors**: User needs CREATE TABLE, INSERT permissions
- **Constraint errors**: Tables might already exist (this is okay)
- **Foreign key errors**: Reference data might be missing

### Verification Fails

**If verification shows issues:**
1. Review the verification output
2. Re-run the specific phase that failed
3. Check database directly with SQL queries
4. Verify seed files are complete

### API Returns Empty

**If API returns no workouts:**
1. Verify workouts exist: `SELECT COUNT(*) FROM workout WHERE phase = 'Phase One';`
2. Check `is_active = true` on workouts
3. Verify `workout_type_id` references STRENGTH type
4. Check API endpoint is using new `workout` table (not old `strength_workouts`)

### UI Shows Errors

**If UI has issues:**
1. Check browser console for JavaScript errors
2. Verify API endpoints return data (use curl or browser dev tools)
3. Check network tab for failed requests
4. Verify authentication token is valid
5. Check CORS settings if needed

## Rollback (If Needed)

If you need to rollback:

```bash
# 1. Stop application (if needed)

# 2. Drop new tables
psql -h $DB_HOST -U $DB_USER -d $DB_NAME << EOF
DROP TABLE IF EXISTS block_exercises CASCADE;
DROP TABLE IF EXISTS workout_blocks CASCADE;
DROP TABLE IF EXISTS workout CASCADE;
DROP TABLE IF EXISTS workout_formats CASCADE;
DROP TABLE IF EXISTS workout_types CASCADE;
DROP TABLE IF EXISTS exercise_equipment CASCADE;
DROP TABLE IF EXISTS equipment CASCADE;
DROP TABLE IF EXISTS exercises CASCADE;
EOF

# 3. Restore from backup
psql -h $DB_HOST -U $DB_USER -d $DB_NAME < backups/backup_strength_migration_YYYYMMDD_HHMMSS.sql
```

## Success Criteria

✅ All 8 tables exist in database  
✅ Reference data seeded (equipment, exercises, formats)  
✅ 22 workouts exist (8 Phase One, 7 Phase Two, 7 Phase Three)  
✅ API returns workouts with `displayWorkoutNumber`  
✅ UI displays all phases correctly  
✅ Workout numbering is correct (1-1, 1-2, 2-1, etc.)  
✅ No duplicate exercises within workouts  
✅ All formatting matches dev environment  

## Support

If you encounter issues:
1. Check script output for specific errors
2. Review database logs
3. Verify environment variables
4. Check the verification script output
5. Review `DEPLOYMENT_CHECKLIST.md` for detailed checks

---

**Ready to start?** Begin with Step 1 above. Good luck! 🚀




















