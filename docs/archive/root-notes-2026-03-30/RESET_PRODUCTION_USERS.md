# Reset Production Users

This guide explains how to reset production users and create admin/test users with never-expiring subscriptions.

## 🎯 What This Does

1. **Deletes all existing users** from the production database (cascades to subscriptions and payments)
2. **Adds a `role` column** to the users table if it doesn't exist (admin, tester, user)
3. **Creates new admin and test users** with never-expiring subscriptions

## 👥 Users Created

| Email | Role | Tier | Expires |
|-------|------|------|---------|
| jameypowell@gmail.com | admin | monthly | Never |
| kylieshot@gmail.com | tester | weekly | Never |
| brookley.pedersen@gmail.com | tester | weekly | Never |
| branda.cooper@gmail.com | tester | weekly | Never |
| davismirandafitness@gmail.com | tester | monthly | Never |

## 📋 Prerequisites

1. **Production database credentials** (RDS PostgreSQL endpoint)
2. **Environment variables set** (or `.env` file):

```bash
DB_HOST=<production-rds-endpoint>
DB_USER=<database-user>
DB_PASSWORD=<database-password>
DB_NAME=postgres  # or your database name
```

Example:
```bash
DB_HOST=stoic-fitness-pg.c7c9btnoxixy.us-east-1.rds.amazonaws.com
DB_USER=stoicapp
DB_PASSWORD=your-password
DB_NAME=postgres
```

## 🚀 Running the Script

### Option 1: With .env file

```bash
# Create .env file with database credentials
cat > .env <<EOF
DB_HOST=your-rds-endpoint
DB_USER=your-db-user
DB_PASSWORD=your-db-password
DB_NAME=postgres
EOF

# Run the script
node scripts/reset_production_users.js
```

### Option 2: With environment variables

```bash
DB_HOST=your-rds-endpoint \
DB_USER=your-db-user \
DB_PASSWORD=your-db-password \
DB_NAME=postgres \
node scripts/reset_production_users.js
```

## ✅ What Happens

1. **Schema Check**: Script checks if `role` column exists, adds it if needed
2. **Delete Users**: Deletes all existing users (cascades to subscriptions/payments)
3. **Create Users**: Creates 5 new users with:
   - Role (admin or tester)
   - Subscription tier (weekly or monthly)
   - Never-expiring subscription (end_date set to 2099-12-31)
   - Temporary password (users should use Google OAuth or reset password)

## 🔐 Authentication

**Good News**: Users can sign in immediately using **Google OAuth**!

- **No password reset needed** - Users are created with placeholder passwords
- **Just use Google OAuth** - Click "Sign in with Google" and use their Google account
- **OAuth automatically links** to their existing subscription in the database

The OAuth flow will:
1. Check if user exists by email (they do - we just created them)
2. Link the Google OAuth account to the existing user
3. Sign them in with their never-expiring subscription

**Note**: Users cannot use email/password login with these accounts (password was randomly generated for security). They must use Google OAuth.

## 🎯 Never-Expiring Subscriptions

Subscriptions with end_date set to 2099-12-31 are treated as "never expiring":

- **Monthly tier**: Can access ALL workouts (no 30-day limit)
- **Weekly tier**: Can access all current week workouts
- **Daily tier**: Can access today's workout only

## ⚠️ Warnings

- **This DELETES all existing users** - make sure you have backups if needed
- **This is irreversible** - once users are deleted, they cannot be recovered
- **Run this BEFORE deploying new code** to production

## 📊 Verification

After running, verify users were created:

```bash
# Connect to production database
psql -h <DB_HOST> -U <DB_USER> -d postgres

# Check users
SELECT id, email, role, created_at FROM users;

# Check subscriptions
SELECT u.email, s.tier, s.status, s.end_date 
FROM subscriptions s 
JOIN users u ON s.user_id = u.id;
```

## 🔄 Next Steps

After resetting users:

1. **Deploy new code** to production (if not already deployed)
2. **Update environment variables** in ECS (if needed)
3. **Test login** with Google OAuth
4. **Verify subscriptions** are showing correctly

