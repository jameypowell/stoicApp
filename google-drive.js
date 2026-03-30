// Google Drive and Slides API integration
const { google } = require('googleapis');
const fs = require('fs').promises;
const path = require('path');

// Initialize Google OAuth2 client
function getAuthClient() {
  const oauth2Client = new google.auth.OAuth2(
    process.env.GOOGLE_CLIENT_ID,
    process.env.GOOGLE_CLIENT_SECRET,
    process.env.GOOGLE_REDIRECT_URI || 'http://localhost:3000/auth/google/callback'
  );

  // If we have a refresh token, set it
  if (process.env.GOOGLE_REFRESH_TOKEN) {
    oauth2Client.setCredentials({
      refresh_token: process.env.GOOGLE_REFRESH_TOKEN
    });
  }

  return oauth2Client;
}

// Get Google Drive API instance
function getDriveAPI() {
  const auth = getAuthClient();
  return google.drive({ version: 'v3', auth });
}

// Get Google Slides API instance
function getSlidesAPI() {
  const auth = getAuthClient();
  return google.slides({ version: 'v1', auth });
}

// Extract text from a Google Slides presentation
async function extractTextFromSlides(presentationId) {
  try {
    const slides = getSlidesAPI();
    const presentation = await slides.presentations.get({
      presentationId: presentationId
    });

    const slidesData = presentation.data.slides || [];
    let fullText = '';
    const slidesText = [];

    slidesData.forEach((slide, index) => {
      let slideText = '';
      const pageElements = slide.pageElements || [];

      pageElements.forEach(element => {
        if (element.shape && element.shape.text) {
          const textElements = element.shape.text.textElements || [];
          textElements.forEach(textElement => {
            if (textElement.textRun && textElement.textRun.content) {
              slideText += textElement.textRun.content + ' ';
            }
          });
        }
      });

      slidesText.push({
        slideNumber: index + 1,
        text: slideText.trim()
      });

      fullText += slideText + '\n\n';
    });

    return {
      title: presentation.data.title || 'Untitled Presentation',
      fullText: fullText.trim(),
      slides: slidesText,
      slideCount: slidesData.length
    };
  } catch (error) {
    console.error('Error extracting text from slides:', error);
    throw new Error(`Failed to extract text from slides: ${error.message}`);
  }
}

// List files in Google Drive folder
async function listFilesInFolder(folderId) {
  try {
    const drive = getDriveAPI();
    const response = await drive.files.list({
      q: `'${folderId}' in parents and mimeType='application/vnd.google-apps.presentation'`,
      fields: 'files(id, name, modifiedTime, createdTime)',
      orderBy: 'modifiedTime desc'
    });

    return response.data.files || [];
  } catch (error) {
    console.error('Error listing files:', error);
    throw new Error(`Failed to list files: ${error.message}`);
  }
}

// Get file by name or ID
async function getFile(fileIdOrName) {
  try {
    const drive = getDriveAPI();
    
    // Try as file ID first
    try {
      const file = await drive.files.get({
        fileId: fileIdOrName,
        fields: 'id, name, mimeType, modifiedTime, createdTime'
      });
      return file.data;
    } catch (err) {
      // If that fails, try searching by name
      const response = await drive.files.list({
        q: `name='${fileIdOrName}' and mimeType='application/vnd.google-apps.presentation'`,
        fields: 'files(id, name, modifiedTime, createdTime)',
        pageSize: 1
      });

      if (response.data.files && response.data.files.length > 0) {
        return response.data.files[0];
      }
      throw new Error('File not found');
    }
  } catch (error) {
    console.error('Error getting file:', error);
    throw new Error(`Failed to get file: ${error.message}`);
  }
}

// Extract date from slide text
function extractDateFromSlideText(slideText) {
  // Common date patterns to look for
  const datePatterns = [
    // "November 3rd, 2025" or "November 3, 2025"
    /(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/gi,
    // "Feb. 28th, 2025" or "Feb 28th, 2025" or "Jan. 31st, 2025" (abbreviated months)
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/gi,
    // "11/3/2025" or "11-3-2025"
    /\d{1,2}\/\d{1,2}\/\d{4}/g,
    /\d{1,2}-\d{1,2}-\d{4}/g,
    // "2025-11-03"
    /\d{4}-\d{2}-\d{2}/g,
    // "Nov 3, 2025" (already covered above but keeping for clarity)
    /(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+\d{1,2},?\s+\d{4}/gi
  ];

  for (const pattern of datePatterns) {
    const matches = slideText.match(pattern);
    if (matches && matches.length > 0) {
      try {
        // Parse the date
        const dateStr = matches[0];
        
        // Parse date manually to avoid timezone issues
        let year, month, day;
        
        // Handle "November 6th, 2025" format
        const fullMonthMatch = dateStr.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
        if (fullMonthMatch) {
          const monthNames = ['january', 'february', 'march', 'april', 'may', 'june', 
                             'july', 'august', 'september', 'october', 'november', 'december'];
          const monthName = fullMonthMatch[0].match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)/i)[0].toLowerCase();
          month = monthNames.indexOf(monthName);
          day = parseInt(fullMonthMatch[1]);
          year = parseInt(fullMonthMatch[2]);
        } 
        // Handle "Nov 6, 2025" format
        else {
          const abbrevMonthMatch = dateStr.match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})/i);
          if (abbrevMonthMatch) {
            const abbrevMonths = ['jan', 'feb', 'mar', 'apr', 'may', 'jun', 
                                 'jul', 'aug', 'sep', 'oct', 'nov', 'dec'];
            const monthName = abbrevMonthMatch[0].match(/(?:Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)/i)[0].toLowerCase();
            month = abbrevMonths.indexOf(monthName);
            day = parseInt(abbrevMonthMatch[1]);
            year = parseInt(abbrevMonthMatch[2]);
          }
          // Handle "11/6/2025" or "11-6-2025" format
          else {
            const slashMatch = dateStr.match(/(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})/);
            if (slashMatch) {
              month = parseInt(slashMatch[1]) - 1; // Month is 0-indexed
              day = parseInt(slashMatch[2]);
              year = parseInt(slashMatch[3]);
            }
            // Handle "2025-11-06" format
            else {
              const isoMatch = dateStr.match(/(\d{4})-(\d{2})-(\d{2})/);
              if (isoMatch) {
                year = parseInt(isoMatch[1]);
                month = parseInt(isoMatch[2]) - 1; // Month is 0-indexed
                day = parseInt(isoMatch[3]);
              } else {
                // Fallback to Date parsing
                let date = new Date(dateStr);
                if (isNaN(date.getTime())) {
                  const cleaned = dateStr.replace(/(\d+)(st|nd|rd|th)/, '$1');
                  date = new Date(cleaned);
                }
                if (!isNaN(date.getTime())) {
                  year = date.getFullYear();
                  month = date.getMonth();
                  day = date.getDate();
                } else {
                  continue;
                }
              }
            }
          }
        }
        
        // Create date string in YYYY-MM-DD format (no timezone conversion)
        if (year && month !== undefined && day) {
          const monthStr = String(month + 1).padStart(2, '0');
          const dayStr = String(day).padStart(2, '0');
          return `${year}-${monthStr}-${dayStr}`;
        }
      } catch (e) {
        // Continue to next pattern
        continue;
      }
    }
  }
  
  return null;
}

// Parse slides individually and extract dates/workouts
async function parseSlidesIndividually(presentationId) {
  try {
    const slides = getSlidesAPI();
    const presentation = await slides.presentations.get({
      presentationId: presentationId
    });

    const slidesData = presentation.data.slides || [];
    const workouts = [];

    slidesData.forEach((slide, index) => {
      let slideText = '';
      const pageElements = slide.pageElements || [];

      // Extract text from all elements on the slide
      pageElements.forEach(element => {
        if (element.shape && element.shape.text) {
          const textElements = element.shape.text.textElements || [];
          textElements.forEach(textElement => {
            if (textElement.textRun && textElement.textRun.content) {
              slideText += textElement.textRun.content + ' ';
            }
          });
        }
      });

      const cleanedText = slideText.trim();
      
      if (cleanedText.length > 0) {
        // Try to extract date from slide text
        const workoutDate = extractDateFromSlideText(cleanedText);
        
        workouts.push({
          slideNumber: index + 1,
          date: workoutDate,
          content: cleanedText,
          rawDate: extractDateFromSlideText(cleanedText) ? 
            cleanedText.match(/(?:January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2}(?:st|nd|rd|th)?,?\s+\d{4}/gi)?.[0] || 
            cleanedText.match(/\d{1,2}\/\d{1,2}\/\d{4}/g)?.[0] ||
            cleanedText.match(/\d{4}-\d{2}-\d{2}/g)?.[0] : null
        });
      }
    });

    return {
      title: presentation.data.title || 'Untitled Presentation',
      workouts: workouts,
      totalSlides: slidesData.length
    };
  } catch (error) {
    console.error('Error parsing slides:', error);
    throw new Error(`Failed to parse slides: ${error.message}`);
  }
}

// Sync all workouts from a Google Slides presentation
async function syncAllWorkoutsFromSlides(fileIdOrName) {
  try {
    const file = await getFile(fileIdOrName);
    const parsed = await parseSlidesIndividually(file.id);

    return {
      fileId: file.id,
      fileName: file.name,
      title: parsed.title,
      workouts: parsed.workouts,
      totalSlides: parsed.totalSlides
    };
  } catch (error) {
    console.error('Error syncing all workouts:', error);
    throw error;
  }
}

// Sync workout from Google Drive file (single workout with provided date)
async function syncWorkoutFromSlides(fileIdOrName, workoutDate) {
  try {
    const file = await getFile(fileIdOrName);
    const extractedText = await extractTextFromSlides(file.id);

    return {
      fileId: file.id,
      fileName: file.name,
      workoutDate: workoutDate,
      title: extractedText.title,
      content: extractedText.fullText,
      slideCount: extractedText.slideCount
    };
  } catch (error) {
    console.error('Error syncing workout:', error);
    throw error;
  }
}

module.exports = {
  getAuthClient,
  getDriveAPI,
  getSlidesAPI,
  extractTextFromSlides,
  parseSlidesIndividually,
  syncAllWorkoutsFromSlides,
  extractDateFromSlideText,
  listFilesInFolder,
  getFile,
  syncWorkoutFromSlides
};

