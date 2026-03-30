#!/bin/bash

# Complete migration workflow: SQLite to PostgreSQL
# This script:
# 1. Makes RDS publicly accessible
# 2. Updates security group to allow your IP
# 3. Runs the migration
# 4. Optionally reverts RDS to private (use --keep-public to skip)

set -e

REGION=us-east-1
DB_INSTANCE=stoic-fitness-pg
DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com
DB_USER=stoicapp
DB_PASSWORD=StoicDBtrong
DB_NAME=postgres

KEEP_PUBLIC=false
if [ "$1" == "--keep-public" ]; then
  KEEP_PUBLIC=true
fi

echo "🚀 Starting database migration workflow"
echo "=========================================="
echo ""

# Step 1: Make RDS publicly accessible
echo "Step 1: Making RDS publicly accessible..."
./scripts/make_rds_public.sh
echo ""

# Wait for modification to complete
echo "⏳ Waiting for RDS modification to complete (this may take a few minutes)..."
aws rds wait db-instance-available \
  --db-instance-identifier $DB_INSTANCE \
  --region $REGION
echo "✓ RDS is now publicly accessible"
echo ""

# Step 2: Update security group
echo "Step 2: Updating security group..."
./scripts/update_security_group.sh
echo ""

# Step 3: Test connection
echo "Step 3: Testing PostgreSQL connection..."
export PGPASSWORD=$DB_PASSWORD
if psql -h $DB_HOST -U $DB_USER -d $DB_NAME -c "SELECT 1;" > /dev/null 2>&1; then
  echo "✓ Connection successful"
else
  echo "❌ Connection failed. Please check:"
  echo "   - RDS is publicly accessible"
  echo "   - Security group allows your IP"
  echo "   - Database credentials are correct"
  exit 1
fi
echo ""

# Step 4: Run migration
echo "Step 4: Running migration..."
export DB_HOST=$DB_HOST
export DB_USER=$DB_USER
export DB_PASSWORD=$DB_PASSWORD
export DB_NAME=$DB_NAME

if [ "$2" == "--drop" ]; then
  echo "⚠️  WARNING: Using --drop flag. This will delete all existing data!"
  read -p "Are you sure? (yes/no): " confirm
  if [ "$confirm" != "yes" ]; then
    echo "Migration cancelled"
    exit 0
  fi
  node scripts/migrate_to_postgres.js --drop
else
  node scripts/migrate_to_postgres.js
fi
echo ""

# Step 5: Verify migration
echo "Step 5: Verifying migration..."
WORKOUT_COUNT=$(psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM workouts;")
USER_COUNT=$(psql -h $DB_HOST -U $DB_USER -d $DB_NAME -t -c "SELECT COUNT(*) FROM users;")
echo "  Workouts: $WORKOUT_COUNT"
echo "  Users: $USER_COUNT"
echo ""

# Step 6: Revert RDS to private (unless --keep-public)
if [ "$KEEP_PUBLIC" == "false" ]; then
  echo "Step 6: Reverting RDS to private..."
  ./scripts/make_rds_public.sh --revert
  echo ""
  echo "⚠️  Don't forget to remove your IP from the security group:"
  echo "   ./scripts/update_security_group.sh --remove"
else
  echo "⚠️  RDS is still publicly accessible!"
  echo "   Run this when done: ./scripts/make_rds_public.sh --revert"
  echo "   And remove your IP: ./scripts/update_security_group.sh --remove"
fi

echo ""
echo "✅ Migration workflow completed!"

