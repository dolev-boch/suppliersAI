/**
 * Monthly Backup and Reset System for Invoice Scanner
 *
 * FEATURES:
 * - Automatic monthly backup on the 1st of each month at 3 AM Israel time
 * - Backs up ALL sheets to Google Drive with MM-YY naming format
 * - Organizes backups into year-based folders (2025, 2026, 2027, etc.)
 * - Automatically creates year folders if they don't exist
 * - Resets all data in sheets after successful backup (preserves structure)
 * - Manual test function for testing reset on a single sheet
 *
 * INSTALLATION INSTRUCTIONS:
 * 1. Open your Google Sheets file
 * 2. Go to Extensions → Apps Script
 * 3. Copy this entire file into the Apps Script editor
 * 4. Replace BACKUP_FOLDER_ID with your actual folder ID
 * 5. Save the script
 * 6. Run setupMonthlyBackupTrigger() once manually
 * 7. Test with testResetSingleSheet() on a test sheet
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

// Your Google Drive backup folder ID
// From URL: https://drive.google.com/drive/folders/1if-Tbg64dr6uFn_O6mLw6mW48gMQfbhw
const BACKUP_FOLDER_ID = '1if-Tbg64dr6uFn_O6mLw6mW48gMQfbhw';

// Current spreadsheet ID
const SPREADSHEET_ID = '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM';

// Data starts at row 5 (row 4 is header, rows 1-3 are title/spacing)
const DATA_START_ROW = 5;

// ============================================================================
// MAIN BACKUP AND RESET FUNCTION
// ============================================================================

/**
 * Main function that runs on the 1st of every month at 3 AM Israel time
 * 1. Creates backup of all sheets
 * 2. Saves to appropriate year folder in Google Drive
 * 3. Resets all data in all sheets (preserves structure)
 */
function monthlyBackupAndReset() {
  try {
    Logger.log('============================================');
    Logger.log('Starting monthly backup and reset process...');
    Logger.log('============================================');

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const now = new Date();

    // Get previous month for backup naming
    const backupDate = new Date(now.getFullYear(), now.getMonth() - 1, 1);
    const backupMonth = String(backupDate.getMonth() + 1).padStart(2, '0'); // 01-12
    const backupYear = String(backupDate.getFullYear()).slice(-2); // 25, 26, etc.
    const backupFileName = `${backupMonth}-${backupYear}`;
    const yearFolder = backupDate.getFullYear(); // 2025, 2026, etc.

    Logger.log(`Backup date: ${backupDate.toLocaleDateString('he-IL')}`);
    Logger.log(`Backup file name: ${backupFileName}`);
    Logger.log(`Target year folder: ${yearFolder}`);

    // Step 1: Create backup
    Logger.log('Step 1: Creating backup...');
    const backupFile = createBackup(ss, backupFileName, yearFolder);

    if (!backupFile) {
      throw new Error('Backup creation failed');
    }

    Logger.log(`✅ Backup created successfully: ${backupFile.getName()}`);
    Logger.log(`   URL: ${backupFile.getUrl()}`);

    // Step 2: Reset all sheets (only after successful backup)
    Logger.log('Step 2: Resetting all sheets...');
    const resetResults = resetAllSheets(ss);

    Logger.log('============================================');
    Logger.log('Monthly backup and reset completed!');
    Logger.log(`Sheets backed up: ${resetResults.total}`);
    Logger.log(`Sheets reset: ${resetResults.success}`);
    Logger.log(`Errors: ${resetResults.failed}`);
    Logger.log('============================================');

    // Send notification email (optional)
    sendNotificationEmail(backupFileName, resetResults, backupFile.getUrl());

  } catch (error) {
    Logger.log('❌ ERROR in monthlyBackupAndReset: ' + error.toString());

    // Send error notification
    const recipient = Session.getEffectiveUser().getEmail();
    MailApp.sendEmail({
      to: recipient,
      subject: '⚠️ Monthly Backup Failed - Invoice Scanner',
      body: `Error during monthly backup and reset:\n\n${error.toString()}\n\nPlease check the Apps Script logs.`
    });

    throw error;
  }
}

// ============================================================================
// BACKUP FUNCTIONS
// ============================================================================

/**
 * Create a backup copy of the entire spreadsheet
 * @param {Spreadsheet} ss - The spreadsheet to backup
 * @param {string} fileName - The backup file name (MM-YY format)
 * @param {number} year - The year for folder organization (2025, 2026, etc.)
 * @returns {File} The backup file
 */
function createBackup(ss, fileName, year) {
  try {
    // Get or create the main backup folder
    const backupFolder = DriveApp.getFolderById(BACKUP_FOLDER_ID);

    // Get or create the year subfolder
    const yearFolder = getOrCreateYearFolder(backupFolder, year);

    // Create a copy of the spreadsheet
    const backupFile = DriveApp.getFileById(ss.getId()).makeCopy(fileName, yearFolder);

    Logger.log(`✅ Backup created: ${fileName} in folder ${year}`);

    return backupFile;

  } catch (error) {
    Logger.log('❌ Error creating backup: ' + error.toString());
    throw error;
  }
}

/**
 * Get or create a year folder (2025, 2026, etc.)
 * @param {Folder} parentFolder - The parent backup folder
 * @param {number} year - The year (2025, 2026, etc.)
 * @returns {Folder} The year folder
 */
function getOrCreateYearFolder(parentFolder, year) {
  const yearString = String(year);

  // Search for existing year folder
  const folders = parentFolder.getFoldersByName(yearString);

  if (folders.hasNext()) {
    const folder = folders.next();
    Logger.log(`Found existing year folder: ${yearString}`);
    return folder;
  }

  // Create new year folder if it doesn't exist
  const newFolder = parentFolder.createFolder(yearString);
  Logger.log(`Created new year folder: ${yearString}`);
  return newFolder;
}

// ============================================================================
// RESET FUNCTIONS
// ============================================================================

/**
 * Reset all sheets in the spreadsheet
 * Clears all data starting from row 5, preserving structure
 * @param {Spreadsheet} ss - The spreadsheet
 * @returns {Object} Results summary
 */
function resetAllSheets(ss) {
  const sheets = ss.getSheets();
  const results = {
    total: sheets.length,
    success: 0,
    failed: 0,
    errors: []
  };

  for (const sheet of sheets) {
    try {
      Logger.log(`Resetting sheet: ${sheet.getName()}`);
      resetSheet(sheet);
      results.success++;
      Logger.log(`✅ Sheet reset successfully: ${sheet.getName()}`);
    } catch (error) {
      results.failed++;
      results.errors.push({
        sheet: sheet.getName(),
        error: error.toString()
      });
      Logger.log(`❌ Error resetting sheet ${sheet.getName()}: ${error.toString()}`);
    }
  }

  return results;
}

/**
 * Reset a single sheet
 * Clears specific cell ranges based on sheet name
 * @param {Sheet} sheet - The sheet to reset
 */
function resetSheet(sheet) {
  const sheetName = sheet.getName();

  // Special case: סה"כ הוצאות sheet
  if (sheetName === 'סה"כ הוצאות') {
    Logger.log(`Special reset for sheet: ${sheetName}`);
    Logger.log(`  Clearing C5:C38`);

    // Clear C5 to C38 (34 rows)
    const range = sheet.getRange('C5:C38');
    range.clearContent();
    range.clearDataValidations();
    range.clearNote();

    Logger.log(`✅ Cleared 34 cells in sheet: ${sheetName}`);
    return;
  }

  // Standard reset for all other sheets
  Logger.log(`Standard reset for sheet: ${sheetName}`);

  // Define the specific ranges to clear
  const rangesToClear = [
    'B5:B20',  // 16 rows
    'C5:C19',  // 15 rows
    'D5:D19',  // 15 rows
    'E5:E19',  // 15 rows
    'F5:F19',  // 15 rows
    'G5:G20',  // 16 rows
    'H5:H20',  // 16 rows
  ];

  Logger.log(`  Clearing ranges: ${rangesToClear.join(', ')}`);

  // Clear each range
  rangesToClear.forEach(rangeAddress => {
    try {
      const range = sheet.getRange(rangeAddress);
      const numRows = range.getNumRows();
      const numCols = range.getNumColumns();

      Logger.log(`    Attempting to clear ${rangeAddress} (${numRows} rows × ${numCols} columns)`);

      // Check if range has any values before clearing
      const valuesBefore = range.getValues();
      const hasData = valuesBefore.some(row => row.some(cell => cell !== ''));
      Logger.log(`    Range has data: ${hasData}`);

      // Clear both content and formulas (but preserve formatting)
      range.clearContent();
      range.clearDataValidations();
      range.clearNote();

      // Verify after clearing
      const valuesAfter = range.getValues();
      const stillHasData = valuesAfter.some(row => row.some(cell => cell !== ''));

      if (stillHasData) {
        Logger.log(`    ⚠️ WARNING: ${rangeAddress} still has data after clearing!`);
      } else {
        Logger.log(`    ✓ Cleared ${rangeAddress}`);
      }
    } catch (error) {
      // If column doesn't exist (e.g., sheet doesn't have column H), skip it
      Logger.log(`    ⚠️ Skipped ${rangeAddress} (column may not exist): ${error.toString()}`);
    }
  });

  Logger.log(`✅ Reset completed for sheet: ${sheetName}`);
}

// ============================================================================
// TEST FUNCTIONS
// ============================================================================

/**
 * TEST FUNCTION: Reset a single sheet for testing
 * Run this manually to test the reset functionality
 *
 * INSTRUCTIONS:
 * 1. Replace 'אלמנדוס בע"מ' with your test sheet name
 * 2. Run this function from Apps Script editor
 * 3. Check the sheet to verify data is cleared but structure is preserved
 * 4. Check column A (מספר סידורי) is untouched
 */
function testResetSingleSheet() {
  try {
    Logger.log('============================================');
    Logger.log('Testing reset on single sheet...');
    Logger.log('============================================');

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const testSheetName = 'אלמנדוס בע"מ'; // Change this to your test sheet name

    const sheet = ss.getSheetByName(testSheetName);

    if (!sheet) {
      throw new Error(`Sheet not found: ${testSheetName}`);
    }

    Logger.log(`Found sheet: ${sheet.getName()}`);

    // Reset the sheet
    resetSheet(sheet);

    Logger.log('============================================');
    Logger.log('✅ Test reset completed successfully!');
    Logger.log('Check the sheet to verify:');
    Logger.log('  - Data in rows 5+ is cleared');
    Logger.log('  - Column A (מספר סידורי) is preserved');
    Logger.log('  - Headers (row 4) are preserved');
    Logger.log('  - Formatting is preserved');
    Logger.log('============================================');

  } catch (error) {
    Logger.log('❌ Test failed: ' + error.toString());
    throw error;
  }
}

/**
 * TEST FUNCTION: Test backup creation without reset
 * Run this manually to test backup functionality
 */
function testBackupOnly() {
  try {
    Logger.log('============================================');
    Logger.log('Testing backup creation...');
    Logger.log('============================================');

    const ss = SpreadsheetApp.openById(SPREADSHEET_ID);
    const testFileName = 'TEST-BACKUP-' + new Date().getTime();
    const currentYear = new Date().getFullYear();

    Logger.log(`Creating test backup: ${testFileName}`);

    const backupFile = createBackup(ss, testFileName, currentYear);

    Logger.log('============================================');
    Logger.log('✅ Test backup completed successfully!');
    Logger.log(`Backup file: ${backupFile.getName()}`);
    Logger.log(`URL: ${backupFile.getUrl()}`);
    Logger.log('Check your Google Drive to verify the backup.');
    Logger.log('============================================');

    // Clean up test backup after 5 seconds (optional)
    // Utilities.sleep(5000);
    // backupFile.setTrashed(true);
    // Logger.log('Test backup file moved to trash.');

  } catch (error) {
    Logger.log('❌ Test failed: ' + error.toString());
    throw error;
  }
}

// ============================================================================
// TRIGGER SETUP
// ============================================================================

/**
 * Set up the monthly trigger
 * Run this function ONCE to install the monthly backup trigger
 *
 * INSTRUCTIONS:
 * 1. Run this function from Apps Script editor
 * 2. Authorize the script when prompted
 * 3. The trigger will run automatically on the 1st of every month at 3 AM Israel time
 */
function setupMonthlyBackupTrigger() {
  // Delete any existing triggers for this function
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'monthlyBackupAndReset') {
      ScriptApp.deleteTrigger(trigger);
    }
  }

  // Create new monthly trigger
  // Runs on the 1st day of every month at 3 AM Israel time
  ScriptApp.newTrigger('monthlyBackupAndReset')
    .timeBased()
    .onMonthDay(1)
    .atHour(3)
    .inTimezone('Asia/Jerusalem') // Israel time (automatically adjusts for DST)
    .create();

  Logger.log('✅ Monthly backup trigger installed successfully!');
  Logger.log('Trigger will run on the 1st of every month at 3 AM Israel time.');
  Logger.log('To view/manage triggers: Apps Script editor → Triggers (clock icon on left)');
}

/**
 * Remove the monthly trigger
 * Run this if you want to disable the automatic backups
 */
function removeMonthlyBackupTrigger() {
  const triggers = ScriptApp.getProjectTriggers();
  for (const trigger of triggers) {
    if (trigger.getHandlerFunction() === 'monthlyBackupAndReset') {
      ScriptApp.deleteTrigger(trigger);
      Logger.log('✅ Monthly backup trigger removed.');
    }
  }
}

// ============================================================================
// NOTIFICATION FUNCTIONS
// ============================================================================

/**
 * Send notification email after backup and reset
 * @param {string} backupFileName - Name of the backup file
 * @param {Object} resetResults - Results from reset operation
 * @param {string} backupUrl - URL to the backup file
 */
function sendNotificationEmail(backupFileName, resetResults, backupUrl) {
  try {
    const recipient = Session.getEffectiveUser().getEmail();
    const subject = `✅ Monthly Backup Completed - ${backupFileName}`;

    let body = `Monthly backup and reset completed successfully!\n\n`;
    body += `Backup Details:\n`;
    body += `- File Name: ${backupFileName}\n`;
    body += `- Backup URL: ${backupUrl}\n\n`;
    body += `Reset Results:\n`;
    body += `- Total sheets: ${resetResults.total}\n`;
    body += `- Successfully reset: ${resetResults.success}\n`;
    body += `- Failed: ${resetResults.failed}\n\n`;

    if (resetResults.errors.length > 0) {
      body += `Errors:\n`;
      resetResults.errors.forEach(error => {
        body += `- ${error.sheet}: ${error.error}\n`;
      });
    }

    MailApp.sendEmail({
      to: recipient,
      subject: subject,
      body: body
    });

    Logger.log('✅ Notification email sent to: ' + recipient);

  } catch (error) {
    Logger.log('⚠️ Failed to send notification email: ' + error.toString());
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * List all triggers (useful for debugging)
 */
function listAllTriggers() {
  const triggers = ScriptApp.getProjectTriggers();
  Logger.log('============================================');
  Logger.log('Installed Triggers:');
  Logger.log('============================================');

  if (triggers.length === 0) {
    Logger.log('No triggers installed.');
  } else {
    triggers.forEach((trigger, index) => {
      Logger.log(`${index + 1}. Function: ${trigger.getHandlerFunction()}`);
      Logger.log(`   Event Type: ${trigger.getEventType()}`);
      Logger.log(`   Trigger Source: ${trigger.getTriggerSource()}`);
    });
  }

  Logger.log('============================================');
}
