#!/bin/bash
# Interactive production deployment script
# Guides you through the deployment process step by step

set -e

echo "════════════════════════════════════════════════"
echo "🚀 Production Deployment - Strength Workouts"
echo "════════════════════════════════════════════════"
echo ""

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
NC='\033[0m' # No Color

# Step 1: Check environment variables
echo "Step 1: Checking environment variables..."
if [ -z "$DB_HOST" ]; then
    echo -e "${RED}❌ DB_HOST is not set${NC}"
    echo ""
    echo "Please set your production database credentials:"
    echo "  export DB_HOST=your-production-postgres-host"
    echo "  export DB_USER=your-production-db-user"
    echo "  export DB_PASSWORD=your-production-db-password"
    echo "  export DB_NAME=your-production-db-name"
    echo ""
    read -p "Would you like to set them now? (yes/no): " set_now
    if [ "$set_now" = "yes" ]; then
        read -p "DB_HOST: " DB_HOST
        read -p "DB_USER: " DB_USER
        read -sp "DB_PASSWORD: " DB_PASSWORD
        echo ""
        read -p "DB_NAME (default: postgres): " DB_NAME
        DB_NAME=${DB_NAME:-postgres}
        export DB_HOST DB_USER DB_PASSWORD DB_NAME
        echo ""
        echo -e "${GREEN}✅ Environment variables set${NC}"
    else
        echo "Please set environment variables and run this script again."
        exit 1
    fi
else
    echo -e "${GREEN}✅ Environment variables are set${NC}"
    echo "  DB_HOST: $DB_HOST"
    echo "  DB_USER: $DB_USER"
    echo "  DB_NAME: ${DB_NAME:-postgres}"
fi

echo ""
read -p "Press Enter to continue to environment verification..."

# Step 2: Verify environment
echo ""
echo "Step 2: Verifying environment..."
node scripts/prepare_production_deployment.js
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Environment verification failed${NC}"
    echo "Please fix the issues above and try again."
    exit 1
fi

echo ""
read -p "Press Enter to continue to backup creation..."

# Step 3: Create backup
echo ""
echo "Step 3: Creating database backup..."
echo -e "${YELLOW}⚠️  This is CRITICAL - do not skip!${NC}"
read -p "Have you already created a backup? (yes/no): " has_backup

if [ "$has_backup" != "yes" ]; then
    echo "Creating backup now..."
    ./scripts/create_backup.sh
    if [ $? -ne 0 ]; then
        echo -e "${RED}❌ Backup failed${NC}"
        echo "Please fix backup issues before proceeding."
        exit 1
    fi
    echo ""
    echo -e "${GREEN}✅ Backup created successfully${NC}"
else
    echo -e "${GREEN}✅ Using existing backup${NC}"
fi

echo ""
read -p "Press Enter to continue to migration..."

# Step 4: Run migration
echo ""
echo "Step 4: Running migration..."
echo -e "${YELLOW}⚠️  This will modify your production database${NC}"
read -p "Are you ready to proceed with the migration? (yes/no): " proceed

if [ "$proceed" != "yes" ]; then
    echo "Migration cancelled."
    exit 0
fi

echo ""
echo "Starting migration phases..."
echo ""

# Phase 1: Schema
echo "════════════════════════════════════════════════"
echo "PHASE 1: Schema Migration"
echo "════════════════════════════════════════════════"
node migrations/migrate_strength_workouts_schema.js
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Phase 1 failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Phase 1 complete${NC}"

echo ""
read -p "Press Enter to continue to Phase 2..."

# Phase 2: Reference Data
echo ""
echo "════════════════════════════════════════════════"
echo "PHASE 2: Seed Reference Data"
echo "════════════════════════════════════════════════"
node scripts/seed_strength_reference_data_simple.js
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Phase 2 failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Phase 2 complete${NC}"

echo ""
read -p "Press Enter to continue to Phase 3..."

# Phase 3: Workouts
echo ""
echo "════════════════════════════════════════════════"
echo "PHASE 3: Seed Strength Workouts"
echo "════════════════════════════════════════════════"
node scripts/seed_strength_workouts.js
if [ $? -ne 0 ]; then
    echo -e "${RED}❌ Phase 3 failed${NC}"
    exit 1
fi
echo -e "${GREEN}✅ Phase 3 complete${NC}"

# Phase 4: Verification
echo ""
echo "════════════════════════════════════════════════"
echo "PHASE 4: Verification"
echo "════════════════════════════════════════════════"
node scripts/verify_production_migration.js
if [ $? -ne 0 ]; then
    echo -e "${YELLOW}⚠️  Verification found some issues${NC}"
    echo "Please review the output above."
else
    echo -e "${GREEN}✅ Verification passed${NC}"
fi

# Summary
echo ""
echo "════════════════════════════════════════════════"
echo "🎉 Deployment Complete!"
echo "════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Test API endpoints"
echo "  2. Verify UI rendering"
echo "  3. Test phase switching"
echo "  4. Monitor application logs"
echo ""
echo "For detailed verification steps, see:"
echo "  - NEXT_STEPS_PRODUCTION.md"
echo "  - DEPLOYMENT_CHECKLIST.md"
echo ""




















