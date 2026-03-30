# Test Suite

## Overview

This test suite validates the core functionality of the Stoic Shop application, particularly focusing on workout access control and date normalization across different subscription tiers.

## Test Files

### `database-date-normalization.test.js`
Tests the database date normalization logic to ensure dates are consistently returned as YYYY-MM-DD strings regardless of whether using SQLite or PostgreSQL.

**Coverage:**
- ✅ SQLite date strings are normalized to YYYY-MM-DD format
- ✅ Multiple rows with dates are normalized correctly
- ✅ Date objects are converted to YYYY-MM-DD strings
- ✅ Already-normalized strings remain unchanged
- ✅ Date strings with time components are stripped to date-only
- ✅ Multiple date fields in a single row are normalized
- ✅ Null date fields are handled gracefully

### `workout-access.test.js`
**Core functionality tests** for displaying selected workouts and carousel workouts based on subscription tier. These tests validate the main product features:

**Daily Subscription Tier:**
- ✅ Only today's workout is accessible
- ✅ All other workouts in the 30-day carousel are locked
- ✅ Today's workout selection logic

**Weekly Subscription Tier:**
- ✅ Today's workout and current week's Mon-Sat workouts are accessible
- ✅ Workouts outside the current week are locked
- ✅ 30-day carousel shows correct locked states

**Monthly Subscription Tier:**
- ✅ All workouts within the 30-day subscription period are accessible
- ✅ Workouts outside the subscription period are locked
- ✅ Carousel displays correct locked states based on subscription period

**Carousel Response Format:**
- ✅ Carousel workouts array structure
- ✅ Locked status and requiredTier properties
- ✅ Date formatting consistency

**Today's Workout Selection:**
- ✅ Today's workout is selected when available
- ✅ Most recent workout is selected as fallback when today's workout is unavailable

## Running Tests

Run all tests:
```bash
npm test
```

Run tests in watch mode:
```bash
npm run test:watch
```

## Pre-Deployment Checklist

Before pushing to production, ensure:
- ✅ All tests pass: `npm test`
- ✅ Daily tier tests pass (shows only today's workout)
- ✅ Weekly tier tests pass (shows current week Mon-Sat)
- ✅ Monthly tier tests pass (shows subscription period workouts)
- ✅ Carousel format tests pass (correct structure and locked states)
- ✅ Today's workout selection tests pass

These tests are **critical for production deployments** as they verify the core business logic that determines workout access based on subscription tier. Any failures indicate that users may see incorrect workout access, which directly impacts revenue and user experience.
