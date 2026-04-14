# Database Migration Guide: SQLite to PostgreSQL

This guide walks you through migrating your local SQLite database to AWS RDS PostgreSQL.

## Prerequisites

- AWS CLI configured with appropriate permissions
- PostgreSQL client (`psql`) installed locally
- Node.js dependencies installed (`npm install`)
- Local SQLite database at `data/stoic-shop.db`

## Current Database Status

Your local SQLite database contains:
- **247 workouts**
- **12 users**
- Subscriptions and payments data

## Migration Steps

### Option 1: Automated Migration (Recommended)

Run the complete migration workflow:

```bash
# Standard migration (keeps existing data, updates on conflicts)
./scripts/run_migration.sh

# Or, to drop existing tables and start fresh
./scripts/run_migration.sh --drop
```

This script will:
1. Make RDS publicly accessible temporarily
2. Update security group to allow your IP
3. Test the connection
4. Run the migration
5. Verify the data
6. Optionally revert RDS to private

### Option 2: Manual Step-by-Step

If you prefer to run each step manually:

#### Step 1: Make RDS Publicly Accessible

```bash
./scripts/make_rds_public.sh
```

Wait for the modification to complete (check AWS console or use `aws rds wait db-instance-available`).

#### Step 2: Update Security Group

Add your IP to the RDS security group:

```bash
./scripts/update_security_group.sh
```

#### Step 3: Test Connection

```bash
export PGPASSWORD=StoicDBtrong
psql -h stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com \
     -U stoicapp \
     -d postgres \
     -c "SELECT 1;"
```

#### Step 4: Run Migration

```bash
export DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com
export DB_USER=stoicapp
export DB_PASSWORD=StoicDBtrong
export DB_NAME=postgres

# Standard migration (updates existing records)
node scripts/migrate_to_postgres.js

# Or, to drop and recreate all tables
node scripts/migrate_to_postgres.js --drop
```

#### Step 5: Verify Migration

```bash
psql -h stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com \
     -U stoicapp \
     -d postgres \
     -c "SELECT COUNT(*) FROM workouts;"
```

#### Step 6: Secure RDS Again

```bash
# Make RDS private again
./scripts/make_rds_public.sh --revert

# Remove your IP from security group
./scripts/update_security_group.sh --remove
```

## What Gets Migrated

The migration script transfers:

1. **Users** - All user accounts with password hashes
2. **Subscriptions** - All subscription records
3. **Workouts** - All workout data (247 workouts)
4. **Payments** - All payment history

## Conflict Resolution

- **Users**: Updates existing records by ID
- **Subscriptions**: Updates existing records by ID
- **Workouts**: Updates existing records by workout_date (unique constraint)
- **Payments**: Updates existing records by stripe_payment_intent_id (unique constraint)

## Troubleshooting

### Connection Timeout

If you get a connection timeout:
1. Verify RDS is publicly accessible: `aws rds describe-db-instances --db-instance-identifier stoic-fitness-pg`
2. Check security group allows your IP
3. Wait a few minutes after making RDS public (DNS propagation)

### Migration Errors

If migration fails:
- Check the error message for specific table/column issues
- Verify your local SQLite database is not corrupted
- Ensure PostgreSQL schema matches (the script creates it automatically)

### Sequence Issues

The script automatically resets PostgreSQL sequences after migration to ensure new records get correct IDs.

## After Migration

1. **Update your application** to use PostgreSQL instead of SQLite
2. **Update environment variables** in production:
   ```
   DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com
   DB_PORT=5432
   DB_NAME=postgres
   DB_USER=stoicapp
   DB_PASSWORD=StoicDBtrong
   ```
3. **Test the application** to ensure everything works
4. **Keep RDS private** for security (only allow connections from ECS tasks)

## Security Notes

⚠️ **Important**: After migration, make sure to:
- Revert RDS to private access
- Remove your IP from the security group
- Only allow connections from your ECS tasks (via security group rules)

