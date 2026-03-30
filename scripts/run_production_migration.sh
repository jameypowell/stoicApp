#!/bin/bash
# Run gym_memberships migration on production database
# Usage: ./scripts/run_production_migration.sh

set -e

echo "════════════════════════════════════════════════"
echo "🔄 Production Database Migration"
echo "════════════════════════════════════════════════"
echo ""
echo "This script will migrate the gym_memberships table"
echo "in the production PostgreSQL database."
echo ""
echo "⚠️  Make sure you have production DB credentials set:"
echo "   - DB_HOST"
echo "   - DB_PORT (default: 5432)"
echo "   - DB_NAME"
echo "   - DB_USER"
echo "   - DB_PASSWORD"
echo ""

# Check if DB_HOST is set
if [ -z "$DB_HOST" ]; then
  echo "❌ Error: DB_HOST environment variable is not set"
  echo ""
  echo "Please set production database credentials:"
  echo "  export DB_HOST=your-production-db-host"
  echo "  export DB_PORT=5432"
  echo "  export DB_NAME=your-db-name"
  echo "  export DB_USER=your-db-user"
  echo "  export DB_PASSWORD=your-db-password"
  echo ""
  echo "Or run:"
  echo "  DB_HOST=... DB_NAME=... DB_USER=... DB_PASSWORD=... node scripts/migrate_gym_memberships_stripe.js"
  exit 1
fi

echo "✅ DB_HOST is set: $DB_HOST"
echo ""

# Confirm before proceeding
read -p "⚠️  Are you sure you want to run this migration on PRODUCTION? (yes/no): " confirm
if [ "$confirm" != "yes" ]; then
  echo "Migration cancelled."
  exit 0
fi

echo ""
echo "Running migration..."
echo ""

# Run the migration script
node scripts/migrate_gym_memberships_stripe.js

echo ""
echo "════════════════════════════════════════════════"
echo "✅ Migration completed!"
echo "════════════════════════════════════════════════"
