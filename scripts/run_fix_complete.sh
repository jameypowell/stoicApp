#!/bin/bash

# Complete fix execution script that tries multiple methods

set -e

API_URL="https://stoic-fit.com/api"

echo "🔧 Exercise Fix - Complete Execution"
echo "====================================="
echo ""

# Method 1: Try with environment variables
if [ -n "$ADMIN_EMAIL" ] && [ -n "$ADMIN_PASSWORD" ]; then
    echo "✅ Using credentials from environment variables"
    ./scripts/execute_fix.sh
    exit 0
fi

# Method 2: Try with database credentials
if [ -n "$DB_HOST" ] && [ -n "$DB_USER" ] && [ -n "$DB_PASSWORD" ]; then
    echo "✅ Using database credentials from environment"
    node scripts/fix_production_exercises.js
    exit 0
fi

# Method 3: Prompt for credentials
echo "Credentials needed to run the fix."
echo ""
echo "Please choose an option:"
echo ""
echo "1. Provide admin email/password (API method)"
echo "2. Provide database credentials (Direct DB method)"
echo "3. Exit"
echo ""
read -p "Enter choice (1-3): " choice

case $choice in
    1)
        read -p "Admin Email: " ADMIN_EMAIL
        read -sp "Admin Password: " ADMIN_PASSWORD
        echo ""
        ADMIN_EMAIL="$ADMIN_EMAIL" ADMIN_PASSWORD="$ADMIN_PASSWORD" ./scripts/execute_fix.sh
        ;;
    2)
        read -p "DB_HOST: " DB_HOST
        read -p "DB_USER: " DB_USER
        read -sp "DB_PASSWORD: " DB_PASSWORD
        echo ""
        read -p "DB_NAME (default: postgres): " DB_NAME
        DB_NAME=${DB_NAME:-postgres}
        DB_HOST="$DB_HOST" DB_USER="$DB_USER" DB_PASSWORD="$DB_PASSWORD" DB_NAME="$DB_NAME" node scripts/fix_production_exercises.js
        ;;
    3)
        echo "Exiting..."
        exit 0
        ;;
    *)
        echo "Invalid choice"
        exit 1
        ;;
esac



















