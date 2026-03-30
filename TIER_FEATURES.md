# Tier Features & Access Control - Complete Reference

This document confirms all tier access features are correctly configured for all users and future users.

## Tier Pricing
- **Tier One**: FREE ($0/month)
- **Tier Two**: $7.00/month
- **Tier Three**: $12.00/month
- **Tier Four**: $18.00/month

## Feature Access by Tier

### 1. Functional Fitness Workouts (Daily Workouts)
- **Tier One**: Today's workout only
- **Tier Two**: Today's workout only
- **Tier Three**: 5-day window (2 days before, today, 2 days after)
- **Tier Four**: ✅ **Unlimited access** - All workouts (no date restrictions)

**Implementation**: 
- `hasAccessToDate()` in `payments.js` - Updated to give tier_four unlimited access
- `/workouts/:date` endpoint - Updated to allow tier_four unlimited access
- `/workouts` endpoint - Updated to show all workouts for tier_four
- Carousel `isDateAccessible()` function - Updated to use Stripe status and unlimited tier_four access

### 2. Core Finishers
- **Tier One**: 1 workout
- **Tier Two**: 5 workouts
- **Tier Three**: 10 workouts
- **Tier Four**: ✅ **Unlimited** (Infinity)

**Implementation**: `getTierLimit()` function in `routes.js` line 249-253

### 3. Strength Workouts
- **Tier One**: 1 workout (first Phase One workout only)
- **Tier Two**: ✅ **Unlimited** (Phase One only)
- **Tier Three**: ✅ **Unlimited** (Phase One only)
- **Tier Four**: ✅ **Unlimited** (All phases)

**Implementation**: `getTierLimit()` function in `routes.js` line 255-259

### 4. Strength Workout Phases
- **Phase One**: 
  - Tier One: First workout only
  - Tier Two: ✅ Full access
  - Tier Three: ✅ Full access
  - Tier Four: ✅ Full access

- **Phase Two**: 
  - Tier One: ❌ No access
  - Tier Two: ❌ No access
  - Tier Three: ❌ No access
  - Tier Four: ✅ Full access

- **Phase Three**: 
  - Tier One: ❌ No access
  - Tier Two: ❌ No access
  - Tier Three: ❌ No access
  - Tier Four: ✅ Full access

**Implementation**: 
- Backend: `/strength-workouts/:id` endpoint (lines 5171-5188)
- Frontend: `hasAccessToStrengthPhase()` function in `public/app.js` (lines 28-44)

### 5. PR Logs (1RM Tracking)
- **Tier One**: 3 entries
- **Tier Two**: 5 entries
- **Tier Three**: 10 entries
- **Tier Four**: 15 entries

**Implementation**: `getTierLimit()` function in `routes.js` line 237-241

### 6. Body Composition Measurements
- **Tier One**: 2 measurements
- **Tier Two**: 5 measurements
- **Tier Three**: 8 measurements
- **Tier Four**: ✅ **Unlimited** (Infinity)

**Implementation**: `getTierLimit()` function in `routes.js` line 231-235

### 7. Meal Plan Calculations
- **Tier One**: 1 calculation
- **Tier Two**: 2 calculations
- **Tier Three**: 3 calculations
- **Tier Four**: ✅ **Unlimited** (Infinity)

**Implementation**: `getTierLimit()` function in `routes.js` line 243-247

## Access Control Implementation

### Status Checking Priority
All access control checks prioritize **Stripe status** over database status:
1. Check `subscription.stripe_status` if available
2. Fall back to `subscription.status` if `stripe_status` not available
3. Deny access if status is not `'active'` or `'trialing'`

**Key Functions**:
- `getSubscriptionWithStripeStatus()` - Fetches subscription and syncs with Stripe
- All endpoints use this function for access control
- Frontend checks `currentSubscription.status === 'active'`

### Tier Normalization
Legacy tier names are automatically normalized:
- `daily` → `tier_two`
- `weekly` → `tier_three`
- `monthly` → `tier_four`

**Implementation**: `normalizeTier()` function in `payments.js` (lines 21-29)

## Verification Checklist

✅ **Functional Fitness Workouts**: Tier Four has unlimited access (fixed)
✅ **Core Finishers**: Limits correctly set for all tiers
✅ **Strength Workouts**: Limits correctly set, Phase access correctly restricted
✅ **PR Logs**: Limits correctly set for all tiers
✅ **Body Composition**: Limits correctly set, Tier Four unlimited
✅ **Meal Plan Calculations**: Limits correctly set, Tier Four unlimited
✅ **Status Checking**: Stripe status prioritized over database status
✅ **Tier Normalization**: Legacy names properly handled

## Notes

- All tier limits are enforced server-side in `routes.js`
- Frontend access checks are for UI display only
- Stripe is the source of truth for subscription status
- All endpoints use `getSubscriptionWithStripeStatus()` for consistent access control
- Tier Four users have unlimited access to:
  - Functional Fitness Workouts (all dates)
  - Core Finishers
  - Strength Workouts (all phases)
  - Body Composition Measurements
  - Meal Plan Calculations

## Future Users

All new users will automatically receive the correct tier access based on:
1. Their subscription tier in Stripe
2. The tier limits defined in `getTierLimit()` function
3. The access control logic in each endpoint

No changes needed for future users - the system is configured correctly.


