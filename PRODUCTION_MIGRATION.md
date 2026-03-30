# Production Database Migration Guide

## Gym Memberships Table Migration

This guide will help you migrate the `gym_memberships` table in production to add Stripe integration and pause functionality fields.

## Database Information

- **RDS Instance**: `stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com`
- **Port**: `5432`
- **Database Name**: `stoicapp`
- **Username**: `stoicapp` (or check your RDS configuration)

## Migration Steps

### Option 1: Run Migration Script Locally (Recommended)

1. **Set production database credentials**:
   ```bash
   export DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com
   export DB_PORT=5432
   export DB_NAME=stoicapp
   export DB_USER=stoicapp
   export DB_PASSWORD=your-database-password
   ```

2. **Run the migration script**:
   ```bash
   node scripts/migrate_gym_memberships_stripe.js
   ```

   Or use the helper script:
   ```bash
   ./scripts/run_production_migration.sh
   ```

3. **Verify the migration**:
   The script will output:
   - ✅ All columns added successfully
   - ✅ membership_type constraint updated (for PostgreSQL)
   - List of all columns in the table

### Option 2: Run Migration via ECS Exec (If Session Manager is configured)

1. **Get a running task**:
   ```bash
   TASK_ARN=$(aws ecs list-tasks --cluster stoic-fitness-app --service-name stoic-fitness-service --region us-east-1 --query 'taskArns[0]' --output text)
   ```

2. **Run migration in container**:
   ```bash
   aws ecs execute-command \
     --cluster stoic-fitness-app \
     --task $TASK_ARN \
     --container stoic-fitness-app \
     --region us-east-1 \
     --interactive \
     --command "node scripts/migrate_gym_memberships_stripe.js"
   ```

## What the Migration Does

### New Columns Added:
1. `stripe_customer_id` (TEXT, nullable)
2. `stripe_subscription_id` (TEXT, nullable)
3. `stripe_subscription_item_id` (TEXT, nullable)
4. `billing_period` (TEXT, nullable, CHECK: 'monthly' or 'yearly')
5. `paused_at` (TIMESTAMP/DATETIME, nullable)
6. `paused_until` (TIMESTAMP/DATETIME, nullable)
7. `pauses_used_this_year` (INTEGER, default 0)
8. `pause_resume_scheduled` (BOOLEAN/INTEGER, default FALSE/0)

### Constraint Updates:
- `membership_type` CHECK constraint updated to include `'entire_family'`

## Safety Features

✅ **All new columns are nullable** - Existing data is safe  
✅ **No data loss** - Only adds columns, doesn't modify existing data  
✅ **Idempotent** - Can be run multiple times safely  
✅ **Backward compatible** - Existing code continues to work  

## Verification

After running the migration, verify it worked:

```sql
-- Check columns exist
SELECT column_name, data_type, is_nullable 
FROM information_schema.columns 
WHERE table_name = 'gym_memberships' 
AND column_name IN (
  'stripe_customer_id',
  'stripe_subscription_id', 
  'stripe_subscription_item_id',
  'billing_period',
  'paused_at',
  'paused_until',
  'pauses_used_this_year',
  'pause_resume_scheduled'
)
ORDER BY column_name;

-- Check constraint includes 'entire_family'
SELECT check_clause 
FROM information_schema.check_constraints 
WHERE constraint_name LIKE '%gym_memberships%membership_type%';
```

## Rollback (If Needed)

If you need to rollback, you can remove the columns:

```sql
ALTER TABLE gym_memberships 
DROP COLUMN IF EXISTS stripe_customer_id,
DROP COLUMN IF EXISTS stripe_subscription_id,
DROP COLUMN IF EXISTS stripe_subscription_item_id,
DROP COLUMN IF EXISTS billing_period,
DROP COLUMN IF EXISTS paused_at,
DROP COLUMN IF EXISTS paused_until,
DROP COLUMN IF EXISTS pauses_used_this_year,
DROP COLUMN IF EXISTS pause_resume_scheduled;
```

**Note**: Only rollback if no data has been written to these columns yet.

## Troubleshooting

### "Connection refused" or "Connection timeout"
- Check RDS security group allows connections from your IP
- Verify DB_HOST, DB_PORT are correct

### "Authentication failed"
- Verify DB_USER and DB_PASSWORD are correct
- Check RDS master username

### "Column already exists"
- This is OK - the script is idempotent and will skip existing columns

## Next Steps

After migration:
1. ✅ Verify existing gym membership routes still work
2. ✅ Test `/api/gym-memberships/me` endpoint
3. ✅ Ready to implement Stripe integration code
4. ✅ Ready to implement pause functionality
















