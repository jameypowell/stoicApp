# Syncing Users from Local to Production

This guide explains how to sync users and their subscriptions from your local SQLite database to production PostgreSQL.

## Prerequisites

1. **Production Database Credentials**: You need the following environment variables:
   - `DB_HOST` - PostgreSQL host (RDS endpoint)
   - `DB_USER` - Database username
   - `DB_PASSWORD` - Database password
   - `DB_PORT` - Port (default: 5432)
   - `DB_NAME` - Database name (default: postgres)

2. **Local SQLite Database**: Should be at `data/stoic-shop.db` (or set `DB_PATH`)

## Getting Production Database Credentials

### Option 1: From AWS RDS Console
1. Go to AWS RDS Console
2. Find your database instance
3. Note the endpoint, port, and master username
4. The password should be stored securely (AWS Secrets Manager or your password manager)

### Option 2: From AWS CLI
```bash
# List RDS instances
aws rds describe-db-instances --region us-east-1 \
  --query 'DBInstances[*].{ID:DBInstanceIdentifier,Endpoint:Endpoint.Address,Port:Endpoint.Port}'

# Get master username
aws rds describe-db-instances --db-instance-identifier YOUR_DB_ID \
  --region us-east-1 --query 'DBInstances[0].MasterUsername'
```

## Running the Sync

### Step 1: Set Production Database Environment Variables

```bash
export DB_HOST=your-rds-endpoint.rds.amazonaws.com
export DB_USER=stoicapp
export DB_PASSWORD=your-password
export DB_PORT=5432
export DB_NAME=postgres
export DB_SSL=true
```

### Step 2: Dry Run (Recommended First)

Test the sync without making changes:

```bash
node scripts/sync_users_to_production.js --dry-run
```

This will show you:
- How many users will be synced
- Which users already exist
- What subscriptions will be synced

### Step 3: Sync Users (Skip Existing)

Sync users, skipping any that already exist in production:

```bash
node scripts/sync_users_to_production.js
```

### Step 4: Sync Users (Update Existing)

If you want to update existing users (e.g., update password hashes):

```bash
node scripts/sync_users_to_production.js --update
```

## What Gets Synced

- **Users**: Email, password hash, created_at, updated_at
- **Subscriptions**: All subscriptions for each user (tier, status, dates, Stripe IDs)

## Important Notes

1. **Password Hashes**: User passwords are synced as-is. Users can log in with the same passwords they use locally.

2. **Existing Users**: By default, existing users are skipped. Use `--update` to update them.

3. **Subscriptions**: All subscriptions for each user are synced. Existing subscriptions are matched by:
   - `stripe_subscription_id` (if present)
   - `user_id` + `created_at` (if no Stripe ID)

4. **Dry Run**: Always run with `--dry-run` first to see what will happen.

## Example Output

```
🔄 Syncing users from local SQLite to production PostgreSQL

ℹ️  SKIP MODE - Existing users will be skipped (use --update to change)

▶ Connecting to production PostgreSQL...
✅ Connected to production database

▶ Reading users from local SQLite database...
✅ Found 12 user(s) in local database

📧 Processing user: test@example.com
  ✓ Creating new user: test@example.com
  📋 Found 1 subscription(s)
    ✓ Creating subscription 1 (tier: daily)

==================================================
✅ Sync complete!
==================================================
Users synced: 10
Users updated: 0
Users skipped: 2
Subscriptions processed: 8
==================================================
```

## Updating Only Expiration Dates

If users are already synced but expiration dates don't match, you can update just the dates:

```bash
# Dry run to see what will change
node scripts/update_subscription_dates.js --dry-run

# Update all expiration dates to match local
node scripts/update_subscription_dates.js
```

This script:
- Compares end dates between local and production
- Updates production subscriptions to match local end dates
- Shows which dates match and which need updating

## Troubleshooting

### Connection Errors
- Verify RDS security group allows your IP
- Check that RDS is publicly accessible (if connecting from outside AWS)
- Verify credentials are correct

### SSL Errors
- Set `DB_SSL=false` if SSL is not configured
- For RDS, SSL is usually required

### User Already Exists
- This is normal if users were previously synced
- Use `--update` to update existing users
- Or manually delete users in production first

### Expiration Dates Don't Match
- Dates are normalized to YYYY-MM-DD format for comparison
- Use `scripts/update_subscription_dates.js` to update only the dates
- Or use `--update` flag with sync script to update everything

