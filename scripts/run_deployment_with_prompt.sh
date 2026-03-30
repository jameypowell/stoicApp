#!/bin/bash
# Deployment script that handles password prompting
set -e

export DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com
export DB_USER=stoicapp
export DB_NAME=postgres
export DB_PORT=5432
export DB_SSL=true

echo "════════════════════════════════════════════════"
echo "🚀 Production Deployment - Strength Workouts"
echo "════════════════════════════════════════════════"
echo ""
echo "Database Configuration:"
echo "  Host: $DB_HOST"
echo "  User: $DB_USER"
echo "  Database: $DB_NAME"
echo ""

if [ -z "$DB_PASSWORD" ]; then
    echo "⚠️  DB_PASSWORD not set in environment"
    read -sp "Enter production database password: " DB_PASSWORD
    echo ""
    export DB_PASSWORD
fi

echo ""
echo "Step 1: Verifying environment..."
node scripts/prepare_production_deployment.js
if [ $? -ne 0 ]; then
    echo "❌ Environment verification failed"
    exit 1
fi

echo ""
read -p "Press Enter to create backup..."

echo ""
echo "Step 2: Creating backup..."
./scripts/create_backup.sh
if [ $? -ne 0 ]; then
    echo "❌ Backup failed"
    exit 1
fi

echo ""
read -p "Press Enter to start migration..."

echo ""
echo "Step 3: Running migration..."
./scripts/run_production_migration.sh

echo ""
echo "════════════════════════════════════════════════"
echo "✅ Deployment process complete!"
echo "════════════════════════════════════════════════"




















