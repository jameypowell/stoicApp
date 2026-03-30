# Production Users Summary

## Users and Subscriptions to be Created

| # | Email | Role | Subscription Tier | Expiration | Access Level |
|---|-------|------|-------------------|------------|--------------|
| 1 | jameypowell@gmail.com | **admin** | **monthly** | Never (2099-12-31) | ✅ All workouts (never expires) |
| 2 | kylieshot@gmail.com | tester | **weekly** | Never (2099-12-31) | ✅ Current week Mon-Sat workouts |
| 3 | brookley.pedersen@gmail.com | tester | **weekly** | Never (2099-12-31) | ✅ Current week Mon-Sat workouts |
| 4 | branda.cooper@gmail.com | tester | **weekly** | Never (2099-12-31) | ✅ Current week Mon-Sat workouts |
| 5 | davismirandafitness@gmail.com | tester | **monthly** | Never (2099-12-31) | ✅ All workouts (never expires) |
| 6 | jpowell@stoic-fit.com | tester | **daily** | Never (2099-12-31) | ✅ Today's workout only |

## Subscription Details

### Monthly Tier (2 users)
- **jameypowell@gmail.com** (admin)
- **davismirandafitness@gmail.com** (tester)
- **Access**: All workouts available (no 30-day limit due to never-expiring)
- **Expires**: Never (2099-12-31)

### Weekly Tier (3 users)
- **kylieshot@gmail.com** (tester)
- **brookley.pedersen@gmail.com** (tester)
- **branda.cooper@gmail.com** (tester)
- **Access**: Current week Monday-Saturday workouts only
- **Expires**: Never (2099-12-31)

### Daily Tier (1 user)
- **jpowell@stoic-fit.com** (tester)
- **Access**: Today's workout only
- **Expires**: Never (2099-12-31)

## Authentication

All users will sign in using **Google OAuth**:
- No password needed
- Just click "Sign in with Google"
- OAuth automatically links to existing user and subscription

## Summary Statistics

- **Total users**: 6
- **Admin users**: 1
- **Tester users**: 5
- **Monthly subscriptions**: 2
- **Weekly subscriptions**: 3
- **Daily subscriptions**: 1
- **Never-expiring subscriptions**: 6 (all)

## What Happens When Script Runs

1. ✅ Deletes all existing users (cascades to subscriptions/payments)
2. ✅ Adds `role` column to users table (if needed)
3. ✅ Creates 6 users with roles and subscriptions
4. ✅ Sets end_date to 2099-12-31 for all subscriptions (never expires)
5. ✅ Users can immediately sign in with Google OAuth

