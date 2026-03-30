// Script to parse the strength slide with detailed structure analysis
const { getSlidesAPI } = require('./google-drive');
require('dotenv').config();

async function parseStrengthSlideDetailed() {
  try {
    const slides = getSlidesAPI();
    const presentationId = '1DFnwUrLniJyGmJcZLhqBfiMAqdi7hyUpmI1Fukbr4vw';
    
    const presentation = await slides.presentations.get({
      presentationId: presentationId
    });

    const firstSlide = presentation.data.slides[0];
    console.log('Detailed slide analysis...\n');
    
    const pageElements = firstSlide.pageElements || [];
    
    // Extract all text with more context
    const allText = [];
    pageElements.forEach((element, elemIdx) => {
      if (element.shape && element.shape.text) {
        const textElements = element.shape.text.textElements || [];
        let shapeText = '';
        textElements.forEach(textElement => {
          if (textElement.textRun && textElement.textRun.content) {
            shapeText += textElement.textRun.content;
          }
        });
        if (shapeText.trim().length > 0) {
          allText.push({
            elementIndex: elemIdx,
            text: shapeText.trim(),
            // Get transform to see position
            transform: element.transform
          });
        }
      }
    });
    
    console.log('All text blocks (by element):');
    console.log('================================\n');
    allText.forEach((block, i) => {
      console.log(`Block ${i + 1} (Element ${block.elementIndex}):`);
      console.log(block.text);
      console.log('---');
    });
    
    // Search for all phase mentions
    console.log('\n\nSearching for all phase mentions:');
    console.log('================================\n');
    allText.forEach((block, i) => {
      const phaseMatches = block.text.match(/Phase\s+(One|Two|Three|1|2|3):?\s*(Beginner|Intermediate|Advanced)/gi);
      if (phaseMatches) {
        console.log(`Found in Block ${i + 1}: ${phaseMatches.join(', ')}`);
        console.log(`Full block text: ${block.text.substring(0, 200)}...`);
        console.log('---');
      }
    });
    
    // Also search for just "Beginner", "Intermediate", "Advanced" near workout sections
    console.log('\n\nSearching for difficulty levels:');
    console.log('================================\n');
    allText.forEach((block, i) => {
      if (/Beginner|Intermediate|Advanced/i.test(block.text)) {
        console.log(`Block ${i + 1} contains difficulty level:`);
        console.log(block.text);
        console.log('---');
      }
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

parseStrengthSlideDetailed();



