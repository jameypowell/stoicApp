#!/bin/bash

# Temporarily make RDS instance publicly accessible for migration
# Usage: ./scripts/make_rds_public.sh [--revert]

REGION=us-east-1
DB_INSTANCE=stoic-fitness-pg

if [ "$1" == "--revert" ]; then
  echo "🔒 Making RDS instance private again..."
  aws rds modify-db-instance \
    --db-instance-identifier $DB_INSTANCE \
    --publicly-accessible \
    --no-publicly-accessible \
    --apply-immediately \
    --region $REGION
  
  echo "✓ RDS instance is now private"
  echo "⚠️  Remember to remove your IP from the security group!"
  exit 0
fi

echo "🌐 Making RDS instance publicly accessible..."
aws rds modify-db-instance \
  --db-instance-identifier $DB_INSTANCE \
  --publicly-accessible \
  --apply-immediately \
  --region $REGION

echo "✓ RDS instance is now publicly accessible"
echo "⚠️  Remember to revert this after migration with: ./scripts/make_rds_public.sh --revert"

