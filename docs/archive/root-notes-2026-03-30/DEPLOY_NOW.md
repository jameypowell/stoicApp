# Deploy to Production - Step by Step

This guide walks you through deploying the strength workouts migration to production.

## ⚠️ CRITICAL: Read First

1. **Take a database backup** - This is non-negotiable
2. **Test in staging first** - If you have a staging environment
3. **Have rollback plan ready** - Know how to restore from backup
4. **Schedule maintenance window** - If needed for your application

## Quick Start (5 Steps)

### Step 1: Set Environment Variables

```bash
export DB_HOST=your-production-postgres-host
export DB_USER=your-production-db-user
export DB_PASSWORD=your-production-db-password
export DB_NAME=your-production-db-name
```

**Verify they're set:**
```bash
echo "Host: $DB_HOST"
echo "User: $DB_USER"
echo "Database: $DB_NAME"
# Don't echo password for security
```

### Step 2: Create Backup

```bash
# Create timestamped backup
BACKUP_FILE="backup_strength_migration_$(date +%Y%m%d_%H%M%S).sql"
pg_dump -h $DB_HOST -U $DB_USER -d $DB_NAME > $BACKUP_FILE

# Verify backup was created
ls -lh $BACKUP_FILE
echo "Backup saved to: $BACKUP_FILE"
```

**Verify backup size is reasonable** (not 0 bytes or suspiciously small)

### Step 3: Test Database Connection

```bash
# Quick connection test
node -e "
const { Client } = require('pg');
const client = new Client({
  host: process.env.DB_HOST,
  port: process.env.DB_PORT || 5432,
  database: process.env.DB_NAME || 'postgres',
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  ssl: process.env.DB_SSL !== 'false' ? { rejectUnauthorized: false } : false
});
client.connect()
  .then(() => {
    console.log('✅ Connection successful');
    return client.query('SELECT version()');
  })
  .then(res => {
    console.log('PostgreSQL:', res.rows[0].version);
    client.end();
  })
  .catch(err => {
    console.error('❌ Connection failed:', err.message);
    process.exit(1);
  });
"
```

### Step 4: Run Migration

**Option A: Use the automated runner (recommended)**
```bash
./scripts/run_production_migration.sh
```

This will:
1. Check environment variables
2. Ask for backup confirmation
3. Run Phase 1 (Schema)
4. Run Phase 2 (Reference Data)
5. Run Phase 3 (Workouts)
6. Run Phase 4 (Verification)

**Option B: Run phases manually**
```bash
# Phase 1: Schema
node migrations/migrate_strength_workouts_schema.js

# Phase 2: Reference Data
node scripts/seed_strength_reference_data_simple.js

# Phase 3: Workouts
node scripts/seed_strength_workouts.js

# Phase 4: Verification
node scripts/verify_production_migration.js
```

### Step 5: Verify Everything Works

**A. Database Verification**
```sql
-- Connect to your production database and run:
SELECT phase, COUNT(*) FROM workout 
WHERE phase IN ('Phase One', 'Phase Two', 'Phase Three')
GROUP BY phase;
-- Should show: Phase One: 8, Phase Two: 7, Phase Three: 7
```

**B. API Verification**
```bash
# Test API endpoint (replace with your production URL and token)
curl -H "Authorization: Bearer YOUR_TOKEN" \
  "https://your-production-url/api/strength-workouts?phase=Phase%20One" | \
  jq '.workouts[0] | {id, name, displayWorkoutNumber}'

# Should return something like:
# {
#   "id": 123,
#   "name": "Phase One – Day 1 (Quads / Chest-Shoulders)",
#   "displayWorkoutNumber": "1-1"
# }
```

**C. UI Verification**
1. Navigate to your production app
2. Go to Strength Workouts section
3. Check Phase One tab - should show workouts numbered 1-1, 1-2, etc.
4. Check Phase Two tab - should show workouts numbered 2-1, 2-2, etc.
5. Check Phase Three tab - should show workouts numbered 3-1, 3-2, etc.
6. Verify info pills show: Workout number, Phase, Focus, FMP
7. Verify warm-up section shows "Warm-Up: 2 Sets of 10 Reps Each"
8. Verify format sections show correct bullets
9. Test carousel navigation

## Troubleshooting

### Migration Fails

**If Phase 1 (Schema) fails:**
- Check database permissions
- Verify connection string
- Check if tables already exist (might be okay if they're empty)

**If Phase 2 (Reference Data) fails:**
- Check if equipment/exercises already exist
- Verify seed files are accessible
- Check for SQL syntax errors in logs

**If Phase 3 (Workouts) fails:**
- Check if workouts already exist (might be okay)
- Verify exercise IDs exist in database
- Check foreign key constraints

### Verification Fails

**If verification shows missing data:**
- Re-run the specific phase that failed
- Check database logs for errors
- Verify seed files are complete

**If workouts are missing:**
- Re-run Phase 3: `node scripts/seed_strength_workouts.js`
- Check for foreign key constraint errors
- Verify exercise IDs exist

### API Returns Empty

**If API returns no workouts:**
- Verify workouts exist in database (see Step 5A)
- Check API endpoint is using new `workout` table
- Verify `workout_type_id` is set correctly (should reference STRENGTH type)
- Check `is_active = true` on workouts

### UI Shows Errors

**If UI shows errors:**
- Check browser console for JavaScript errors
- Verify API endpoints are returning data
- Check network tab for failed requests
- Verify authentication token is valid

## Rollback

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
psql -h $DB_HOST -U $DB_USER -d $DB_NAME < backup_strength_migration_YYYYMMDD_HHMMSS.sql
```

## Success Indicators

You'll know the migration is successful when:

✅ All 8 tables exist in database
✅ Equipment, exercises, and formats are seeded
✅ 22 workouts exist (8 Phase One, 7 Phase Two, 7 Phase Three)
✅ API returns workouts with `displayWorkoutNumber` (1-1, 1-2, etc.)
✅ UI displays all three phases correctly
✅ Workout numbering is correct
✅ No duplicate exercises within workouts
✅ All formatting matches dev environment

## Support

If you encounter issues:
1. Check the migration script output for specific errors
2. Review database logs
3. Verify environment variables are correct
4. Check the verification script output
5. Review `DEPLOYMENT_CHECKLIST.md` for detailed checks

---

**Ready?** Start with Step 1 above. Good luck! 🚀




















