#!/bin/bash
# Script to update December 5th workout in PRODUCTION
# Usage: ./update_december_5_production.sh

set -e

echo "════════════════════════════════════════════════"
echo "🔄 Update December 5th Workout in PRODUCTION"
echo "════════════════════════════════════════════════"
echo ""

# Check if production credentials are set
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "📋 Production database credentials needed:"
    echo ""
    
    # Default values
    DEFAULT_HOST="stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com"
    DEFAULT_USER="stoicapp"
    DEFAULT_DB="stoicapp"
    
    read -p "DB_HOST [$DEFAULT_HOST]: " DB_HOST
    export DB_HOST="${DB_HOST:-$DEFAULT_HOST}"
    
    read -p "DB_USER [$DEFAULT_USER]: " DB_USER
    export DB_USER="${DB_USER:-$DEFAULT_USER}"
    
    read -sp "DB_PASSWORD: " DB_PASSWORD
    echo ""
    export DB_PASSWORD="$DB_PASSWORD"
    
    read -p "DB_NAME [$DEFAULT_DB]: " DB_NAME
    export DB_NAME="${DB_NAME:-$DEFAULT_DB}"
    
    export DB_PORT="${DB_PORT:-5432}"
    export DB_SSL="${DB_SSL:-true}"
else
    echo "✅ Using existing production credentials"
    echo "   DB_HOST: $DB_HOST"
    echo "   DB_USER: $DB_USER"
    echo "   DB_NAME: ${DB_NAME:-postgres}"
    echo ""
fi

echo ""
echo "🚀 Running update script..."
echo ""

# Run the update script with production credentials
DB_HOST="$DB_HOST" \
DB_USER="$DB_USER" \
DB_PASSWORD="$DB_PASSWORD" \
DB_NAME="${DB_NAME:-stoicapp}" \
DB_PORT="${DB_PORT:-5432}" \
DB_SSL="${DB_SSL:-true}" \
node scripts/update_december_5_workout_production.js

echo ""
echo "✅ Done!"















