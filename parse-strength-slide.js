// Script to parse the strength slide and identify phases
const { getSlidesAPI } = require('./google-drive');
require('dotenv').config();

async function parseStrengthSlide() {
  try {
    const slides = getSlidesAPI();
    const presentationId = '1DFnwUrLniJyGmJcZLhqBfiMAqdi7hyUpmI1Fukbr4vw';
    
    const presentation = await slides.presentations.get({
      presentationId: presentationId
    });

    const firstSlide = presentation.data.slides[0];
    console.log('Analyzing first slide structure...\n');
    
    // Extract all text elements with their positions
    const textElements = [];
    const pageElements = firstSlide.pageElements || [];
    
    pageElements.forEach((element, idx) => {
      if (element.shape && element.shape.text) {
        const textElements_in_shape = element.shape.text.textElements || [];
        textElements_in_shape.forEach(textElement => {
          if (textElement.textRun && textElement.textRun.content) {
            const text = textElement.textRun.content.trim();
            if (text.length > 0) {
              textElements.push({
                index: idx,
                text: text,
                // Try to get position info if available
                transform: element.transform
              });
            }
          }
        });
      }
    });
    
    console.log('All text elements found:');
    console.log('================================\n');
    textElements.forEach((elem, i) => {
      console.log(`${i + 1}. ${elem.text}`);
    });
    
    // Try to find phase information
    console.log('\n\nLooking for phase information...');
    const phasePatterns = [
      /Phase\s+One:?\s*Beginner/i,
      /Phase\s+Two:?\s*Intermediate/i,
      /Phase\s+Three:?\s*Advanced/i,
      /Phase\s+1:?\s*Beginner/i,
      /Phase\s+2:?\s*Intermediate/i,
      /Phase\s+3:?\s*Advanced/i
    ];
    
    textElements.forEach((elem, i) => {
      phasePatterns.forEach(pattern => {
        if (pattern.test(elem.text)) {
          console.log(`Found phase info at position ${i}: ${elem.text}`);
        }
      });
    });
    
  } catch (error) {
    console.error('Error:', error.message);
    console.error(error.stack);
  }
}

parseStrengthSlide();



