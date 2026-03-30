#!/bin/bash
# Helper script to set production database environment variables
# Usage: source ./scripts/set_production_env.sh

echo "════════════════════════════════════════════════"
echo "🔐 Setting Production Database Credentials"
echo "════════════════════════════════════════════════"
echo ""

# Check if credentials are already set
if [ -n "$DB_HOST" ] && [ -n "$DB_USER" ] && [ -n "$DB_PASSWORD" ]; then
    echo "✅ Production credentials are already set"
    echo "   DB_HOST: $DB_HOST"
    echo "   DB_USER: $DB_USER"
    echo "   DB_NAME: ${DB_NAME:-postgres}"
    echo ""
    read -p "Do you want to update them? (yes/no): " update
    if [ "$update" != "yes" ]; then
        return 0
    fi
fi

# Default values from env.example
DEFAULT_HOST="stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com"
DEFAULT_USER="stoicapp"
DEFAULT_DB="postgres"
DEFAULT_PORT="5432"

echo "Enter your production database credentials:"
echo "(Press Enter to use defaults shown in brackets)"
echo ""

read -p "DB_HOST [${DEFAULT_HOST}]: " input_host
export DB_HOST="${input_host:-$DEFAULT_HOST}"

read -p "DB_USER [${DEFAULT_USER}]: " input_user
export DB_USER="${input_user:-$DEFAULT_USER}"

read -sp "DB_PASSWORD: " input_password
echo ""
export DB_PASSWORD="$input_password"

read -p "DB_NAME [${DEFAULT_DB}]: " input_db
export DB_NAME="${input_db:-$DEFAULT_DB}"

read -p "DB_PORT [${DEFAULT_PORT}]: " input_port
export DB_PORT="${input_port:-$DEFAULT_PORT}"

read -p "DB_SSL [true]: " input_ssl
export DB_SSL="${input_ssl:-true}"

echo ""
echo "✅ Environment variables set:"
echo "   DB_HOST: $DB_HOST"
echo "   DB_USER: $DB_USER"
echo "   DB_NAME: $DB_NAME"
echo "   DB_PORT: $DB_PORT"
echo "   DB_SSL: $DB_SSL"
echo ""
echo "⚠️  Note: These are set in the current shell session only."
echo "   To persist, add them to your .env file or export them manually."
echo ""




















