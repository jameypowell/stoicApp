/**
 * Utility functions for workout processing
 */

/**
 * Normalize exercise name by removing equipment info and normalizing case
 * @param {string} label - Exercise name with optional equipment, e.g. "Back Squat (Barbell)"
 * @returns {string} - Normalized name, e.g. "back squat"
 */
function normalizeExerciseName(label) {
  if (!label) return '';
  // Remove anything in parentheses and trim
  return label.split('(')[0].trim().toLowerCase();
}

/**
 * Normalize exercise base name (alias for normalizeExerciseName for consistency)
 * @param {string} label - Exercise name with optional equipment, e.g. "Back Squat (Barbell)"
 * @returns {string} - Normalized base name, e.g. "back squat"
 */
function normalizeExerciseBaseName(label) {
  return normalizeExerciseName(label);
}

/**
 * Deduplicate exercises by base name across all blocks in a workout
 * Maintains a single Set of base names for the entire workout
 * @param {Array} blocks - Array of workout blocks with exercises
 * @returns {Array} - Blocks with deduplicated exercises
 */
function dedupeExercisesByBaseName(blocks) {
  if (!blocks || !Array.isArray(blocks)) {
    return blocks;
  }

  // Maintain a single Set of base names for the entire workout
  const seenBaseNames = new Set();

  // Process each block
  const dedupedBlocks = blocks.map(block => {
    if (!block.exercises || !Array.isArray(block.exercises)) {
      return block;
    }

    // Filter exercises, keeping only the first occurrence of each base name
    const dedupedExercises = block.exercises.filter(exercise => {
      const exerciseName = exercise.exercise || '';
      const baseName = normalizeExerciseBaseName(exerciseName);

      // If base name already seen in this workout, skip this exercise
      if (seenBaseNames.has(baseName)) {
        return false;
      }

      // Add base name to set and keep this exercise
      seenBaseNames.add(baseName);
      return true;
    });

    // Return block with deduplicated exercises
    return {
      ...block,
      exercises: dedupedExercises
    };
  });

  return dedupedBlocks;
}

module.exports = {
  normalizeExerciseName,
  normalizeExerciseBaseName,
  dedupeExercisesByBaseName
};

