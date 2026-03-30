#!/bin/bash
# Create a database backup before migration
# Usage: ./scripts/create_backup.sh

set -e

echo "════════════════════════════════════════════════"
echo "💾 Creating Database Backup"
echo "════════════════════════════════════════════════"
echo ""

# Check for required environment variables
if [ -z "$DB_HOST" ] || [ -z "$DB_USER" ] || [ -z "$DB_PASSWORD" ]; then
    echo "❌ Error: Database environment variables not set"
    echo "   Set them with:"
    echo "   export DB_HOST=your-production-host"
    echo "   export DB_USER=your-db-user"
    echo "   export DB_PASSWORD=your-db-password"
    echo "   export DB_NAME=your-db-name"
    exit 1
fi

# Generate backup filename with timestamp
BACKUP_DIR="${BACKUP_DIR:-./backups}"
mkdir -p "$BACKUP_DIR"
BACKUP_FILE="$BACKUP_DIR/backup_strength_migration_$(date +%Y%m%d_%H%M%S).sql"

echo "Creating backup..."
echo "  Host: $DB_HOST"
echo "  Database: ${DB_NAME:-postgres}"
echo "  User: $DB_USER"
echo "  Backup file: $BACKUP_FILE"
echo ""

# Set PGPASSWORD for pg_dump
export PGPASSWORD="$DB_PASSWORD"

# Create backup
pg_dump -h "$DB_HOST" \
        -U "$DB_USER" \
        -d "${DB_NAME:-postgres}" \
        --no-owner \
        --no-acl \
        -F p \
        > "$BACKUP_FILE"

# Check if backup was successful
if [ $? -eq 0 ] && [ -f "$BACKUP_FILE" ]; then
    BACKUP_SIZE=$(du -h "$BACKUP_FILE" | cut -f1)
    echo "✅ Backup created successfully!"
    echo "   File: $BACKUP_FILE"
    echo "   Size: $BACKUP_SIZE"
    echo ""
    
    # Verify backup is not empty
    if [ ! -s "$BACKUP_FILE" ]; then
        echo "⚠️  WARNING: Backup file is empty!"
        echo "   Please check database connection and permissions"
        exit 1
    fi
    
    echo "✅ Backup verified (file is not empty)"
    echo ""
    echo "Backup is ready. You can proceed with migration."
    echo ""
else
    echo "❌ Backup failed!"
    echo "   Please check:"
    echo "   - Database connection"
    echo "   - User permissions"
    echo "   - Disk space"
    exit 1
fi




















