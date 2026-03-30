# Quick Start: Deploy to Production

## 🚀 3-Step Deployment Process

### Step 1: Prepare (2 minutes)

```bash
# Set your production database credentials
export DB_HOST=your-production-postgres-host
export DB_USER=your-production-db-user
export DB_PASSWORD=your-production-db-password
export DB_NAME=your-production-db-name

# Verify environment is ready
node scripts/prepare_production_deployment.js
```

**Expected**: ✅ Environment Ready for Migration!

### Step 2: Backup (1 minute)

```bash
# Create database backup
./scripts/create_backup.sh
```

**Expected**: ✅ Backup created successfully!

### Step 3: Deploy (5-10 minutes)

```bash
# Run the automated migration
./scripts/run_production_migration.sh
```

**This will:**
- Create all tables (Phase 1)
- Seed reference data (Phase 2)
- Seed workouts (Phase 3)
- Verify everything (Phase 4)

**Expected**: ✅ Migration Complete!

## ✅ Verify Success

### Quick Check
```bash
# Run verification
node scripts/verify_production_migration.js
```

### Manual Check
```sql
-- Connect to database and run:
SELECT phase, COUNT(*) FROM workout 
WHERE phase IN ('Phase One', 'Phase Two', 'Phase Three')
GROUP BY phase;
-- Should show: Phase One: 8, Phase Two: 7, Phase Three: 7
```

### UI Check
1. Go to Strength Workouts in your app
2. Check Phase One shows workouts numbered 1-1, 1-2, etc.
3. Check Phase Two shows workouts numbered 2-1, 2-2, etc.
4. Check Phase Three shows workouts numbered 3-1, 3-2, etc.

## 🆘 Need Help?

- **Detailed guide**: See `NEXT_STEPS_PRODUCTION.md`
- **Troubleshooting**: See `DEPLOYMENT_CHECKLIST.md`
- **Rollback**: See rollback section in `NEXT_STEPS_PRODUCTION.md`

---

**Ready?** Start with Step 1 above! 🚀




















