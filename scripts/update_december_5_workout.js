/**
 * Script to update December 5th workout in production
 * Changes Strength: lines from bold/underlined to regular bullet points
 */

require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });

const { initDatabase, Database } = require('../database');

async function updateWorkout() {
  console.log('\n🔄 Updating December 5th Workout in Production...\n');
  
  // Connect to database
  const dbConnection = await initDatabase();
  const db = new Database(dbConnection);
  
  // Try both 2024 and 2025
  const dates = ['2025-12-05', '2024-12-05'];
  let workoutDate = null;
  let currentWorkout = null;
  
  for (const date of dates) {
    const workout = await db.getWorkoutByDate(date);
    if (workout && workout.content && workout.content.includes('45 Min Field Day')) {
      workoutDate = date;
      currentWorkout = workout;
      break;
    }
  }
  
  if (!currentWorkout) {
    console.log(`❌ No workout found for December 5th (tried 2024 and 2025)`);
    console.log('   Please check the date or create the workout first.');
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    }
    process.exit(1);
  }
  
  console.log(`✅ Found workout for ${workoutDate}`);
  console.log('');
  
  try {
    console.log('📋 Current workout content:');
    console.log('─'.repeat(80));
    console.log(currentWorkout.content);
    console.log('─'.repeat(80));
    console.log('');
    
    // Update content: replace Strength: lines with bullet points
    // Keep everything else exactly the same
    let updatedContent = currentWorkout.content;
    
    // Split into lines and process each line
    const lines = updatedContent.split('\n');
    const updatedLines = lines.map(line => {
      const trimmed = line.trim();
      
      // If line contains "Strength:" and doesn't already start with a bullet
      if (trimmed.includes('Strength:') && !trimmed.startsWith('•')) {
        // Check if this line starts with "Strength:" (possibly with formatting)
        // We want to add a bullet point at the beginning
        
        // Remove any existing formatting characters first
        let cleanLine = trimmed
          .replace(/^\*\*/, '') // Remove markdown bold start
          .replace(/\*\*$/, '') // Remove markdown bold end
          .replace(/^<strong>/, '') // Remove HTML strong start
          .replace(/<\/strong>$/, '') // Remove HTML strong end
          .replace(/^<u>/, '') // Remove underline start
          .replace(/<\/u>$/, '') // Remove underline end
          .replace(/^<b>/, '') // Remove bold start
          .replace(/<\/b>$/, ''); // Remove bold end
        
        // Preserve leading whitespace from original line
        const leadingWhitespace = line.match(/^\s*/)[0];
        
        // Add bullet point
        return leadingWhitespace + '• ' + cleanLine;
      }
      
      return line;
    });
    
    updatedContent = updatedLines.join('\n');
    
    // Additional cleanup: ensure all Strength: lines have bullets
    // Handle cases where Strength: might appear mid-line or with different formatting
    updatedContent = updatedContent.replace(/(\n|^)(\s*)Strength: /g, '$1$2• Strength: ');
    
    // Remove duplicate bullets if somehow created
    updatedContent = updatedContent.replace(/• • Strength:/g, '• Strength:');
    
    // Update the workout in database
    console.log('💾 Updating workout in database...');
    await db.createWorkout(
      workoutDate,
      currentWorkout.google_drive_file_id,
      currentWorkout.title,
      updatedContent,
      currentWorkout.workout_type || 'regular'
    );
    
    console.log('✅ Workout updated successfully!');
    console.log('');
    console.log('📋 Updated content:');
    console.log('─'.repeat(80));
    console.log(updatedContent);
    console.log('─'.repeat(80));
    console.log('');
    console.log('✅ Changes applied:');
    console.log('   • Strength: lines changed to bullet points (• Strength:)');
    console.log('   • All other content kept exactly the same');
    console.log('');
    
  } catch (error) {
    console.error('❌ Error updating workout:', error);
    console.error('Stack:', error.stack);
    process.exit(1);
  } finally {
    if (dbConnection && typeof dbConnection.end === 'function') {
      await dbConnection.end();
    }
  }
}

updateWorkout();
