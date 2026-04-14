# Phase One Strength Workout Deduplication

## Rule

**Phase One strength workouts must never contain the same exercise name twice, even if the equipment is different.**

For example, a workout cannot have both:
- "Deadlift (Barbell)"
- "Deadlift (Kettlebell)"

These are considered duplicates because they share the same base exercise name ("Deadlift").

## Normalization

Exercise names are normalized by:
1. Removing anything in parentheses (equipment info)
2. Trimming whitespace
3. Converting to lowercase

So "Back Squat (Barbell)" and "Back Squat (Weighted Bar)" both normalize to "back squat" and are considered duplicates.

## Tools

### Deduplication Script

To clean existing Phase One workouts that have duplicates:

```bash
npm run dedupe:phase1
```

This script:
- Finds all Phase One strength workouts
- Identifies duplicate exercises (same normalized name)
- Replaces duplicates with alternative exercises that match the functional movement pattern
- Preserves the workout structure (warmup, primary, secondary blocks)

### Validation Script

To validate that Phase One workouts don't have duplicates:

```bash
npm run validate:phase1
```

This script checks all Phase One workouts and reports any duplicates found.

## When Creating New Phase One Workouts

When writing seed scripts or creating Phase One workouts programmatically:

1. **Maintain a Set of used exercise names** (normalized)
2. **Before adding an exercise**, check if its normalized name is already in the Set
3. **If it's a duplicate**, choose a different exercise that:
   - Matches the functional movement pattern for that section
   - Is not already in the workout
   - Fits the equipment requirements

## Example

```sql
-- ❌ BAD: This would create duplicates
INSERT INTO block_exercises ... (exercise = 'Deadlift', equipment = 'Barbell');
INSERT INTO block_exercises ... (exercise = 'Deadlift', equipment = 'Kettlebell'); -- DUPLICATE!

-- ✅ GOOD: Use different exercises
INSERT INTO block_exercises ... (exercise = 'Deadlift', equipment = 'Barbell');
INSERT INTO block_exercises ... (exercise = 'RDL', equipment = 'Kettlebell'); -- Different exercise
```

## Utility Function

The normalization function is available in `utils/workoutUtils.js`:

```javascript
const { normalizeExerciseName } = require('./utils/workoutUtils');

const normalized = normalizeExerciseName('Back Squat (Barbell)');
// Returns: "back squat"
```

## Database Structure

Phase One workouts are stored in:
- `workout` table (workout metadata)
- `workout_blocks` table (warmup, primary, secondary blocks)
- `block_exercises` table (links exercises to blocks)
- `exercise` table (exercise definitions with equipment)

The deduplication script updates `block_exercises.exercise_id` to point to replacement exercises.




















