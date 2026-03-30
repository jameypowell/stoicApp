# Strength Workouts Architecture

## Overview

The application uses **two different database structures** for strength workouts. This document explains both and how they're handled to prevent rendering issues.

## Database Structures

### 1. Legacy: `strength_workouts` Table
- **Used by**: Phase Two and Phase Three (currently)
- **Structure**: Simple text-based `content` field
- **Location**: Both PostgreSQL (prod) and SQLite (dev)
- **Fields**:
  - `id`, `workout_date`, `title`, `content` (text), `phase`, `primary_focus`, `secondary_focus`
  - No structured blocks/exercises

### 2. Normalized: `workout` Table
- **Used by**: Phase One (currently)
- **Structure**: Normalized with `blocks` and `exercises` tables
- **Location**: Both PostgreSQL (prod) and SQLite (dev)
- **Fields**:
  - `id`, `name`, `phase`, `primary_focus`, `secondary_focus`, `fmp`, `notes`
  - Related tables: `workout_blocks`, `block_exercises`, `exercises`
  - Structured data with sets, reps, tempo, etc.

## Rendering Logic

The `renderStrengthWorkout()` function in `public/app.js` must handle **both structures**:

```javascript
// CRITICAL: Check if blocks exist AND are not empty
const hasBlocks = workout.blocks && Array.isArray(workout.blocks) && workout.blocks.length > 0;

if (workout.content && !hasBlocks) {
    // Legacy format: Parse text content to match Phase One structure
    // Must format: Warm-Up → Phase Format → Primary Exercises
} else {
    // Normalized format: Use blocks/exercises structure
}
```

## Important Rules

1. **Never use `!workout.blocks` alone** - Empty arrays are truthy but falsy when negated
   - ❌ Wrong: `if (!workout.blocks)`
   - ✅ Correct: `if (!hasBlocks)` where `hasBlocks = workout.blocks && Array.isArray(workout.blocks) && workout.blocks.length > 0`

2. **Format consistency**: Both formats must render identically:
   - Warm-Up: 2 Sets of 10 Reps Each
   - Phase Format section (Phase One/Two/Three)
   - Primary Exercises section

3. **Database methods**: 
   - `getAllStrengthWorkouts()` - queries `strength_workouts` table
   - `getStrengthWorkoutById()` - queries `workout` table (normalized)
   - Route handler checks both tables as fallback

## Migration Path

Eventually, all phases should migrate to the normalized `workout` table structure. Until then:
- Phase One: Uses normalized structure ✅
- Phase Two: Uses legacy `strength_workouts` table ⚠️
- Phase Three: Uses legacy `strength_workouts` table ⚠️

## Testing Checklist

Before deploying changes to strength workout rendering:

- [ ] Phase One displays correctly (normalized structure)
- [ ] Phase Two displays correctly (legacy content field)
- [ ] Phase Three displays correctly (legacy content field)
- [ ] All phases show identical format structure
- [ ] Warm-Up section appears for all phases
- [ ] Phase Format section appears for all phases
- [ ] Primary exercises section appears for all phases

## Code Locations

- **Rendering**: `public/app.js` - `renderStrengthWorkout()` function (~line 9512)
- **Database queries**: `database.js` - `getAllStrengthWorkouts()`, `getStrengthWorkoutById()`
- **API routes**: `routes.js` - `/api/strength-workouts` endpoints (~line 2155)

## Development Guidelines

### Before Making Changes

1. **Read this document** - Understand the dual structure
2. **Test all phases** - Phase One, Two, and Three must all work
3. **Check rendering consistency** - All phases must look identical
4. **Verify condition checks** - Never use `!workout.blocks` alone

### Common Pitfalls

1. **Empty array check**: `[]` is truthy, but `![]` is `false`
   - Always check: `workout.blocks && Array.isArray(workout.blocks) && workout.blocks.length > 0`

2. **Assuming single structure**: Code must handle both legacy and normalized formats

3. **Format inconsistency**: Both formats must produce identical HTML structure

### Deployment Checklist

Before deploying any changes to strength workout rendering:

- [ ] All three phases (One, Two, Three) display correctly
- [ ] Warm-Up section appears for all phases
- [ ] Phase Format section appears for all phases  
- [ ] Primary exercises section appears for all phases
- [ ] Formatting matches between all phases
- [ ] No console errors in browser
- [ ] Tested in both dev (SQLite) and prod (PostgreSQL) environments
