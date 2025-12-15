/**
 * Google Apps Script for Invoice Scanner - UPDATED WITH DATE FIX
 *
 * Sheet ID: 1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM
 *
 * CHANGES IN THIS VERSION:
 * - Added parseIsraeliDate() function to convert DD/MM/YYYY to Date object
 * - Updated addDataToSheet() to use proper date conversion (line 228-237)
 * - Date now displays correctly in DD/MM/YYYY format in Google Sheets
 */

// Starting row for data entry (always row 5)
const DATA_START_ROW = 5;

// Column mapping for regular suppliers (ספקים רגילים)
const REGULAR_COLUMNS = {
  DATE: 2, // B - תאריך אספקה
  DELIVERY_NUM: 3, // C - מס' תעודת משלוח
  DELIVERY_SUM: 4, // D - סכום תעודת משלוח
  INVOICE_NUM: 5, // E - מס' חשבונית מס
  INVOICE_SUM: 6, // F - סכום חשבונית מס
  NOTES: 7, // G - הערות
};

// Column mapping for special categories (with credit card)
const SPECIAL_COLUMNS = {
  DATE: 2, // B - תאריך אספקה
  DELIVERY_NUM: 3, // C - מס' תעודת משלוח
  DELIVERY_SUM: 4, // D - סכום תעודת משלוח
  INVOICE_NUM: 5, // E - מס' חשבונית מס
  INVOICE_SUM: 6, // F - סכום חשבונית מס
  NOTES: 7, // G - הערות (כולל שם הספק)
  CREDIT_CARD: 8, // H - מס' כרטיס אשראי 4 ספרות
};

// Sheet names mapping
const SHEET_NAMES = {
  priority: null, // Priority suppliers use their exact name as sheet name
  fuel_station: 'תחנת דלק',
  supermarket: 'רשתות מזון',
  nursery: 'משתלות',
  other: 'צח', // Default fallback if supplier not found
};

// Priority suppliers list - each has its own sheet
const PRIORITY_SUPPLIERS = [
  'אלכס ברק',
  'אחים לוי',
  'אלמנדוס בע"מ',
  'אפי שיווק ביצים',
  'אקיופוז',
  'ארגל',
  'אריזים שפי פלסט',
  'בזק',
  'הפרסי פירות וירקות בע"מ',
  'דקל דברי נוי',
  'ח.ל.ק.ט קרח',
  'טויטו שחר מחלבות גד',
  'טכנאים',
  'מ. אש קפה',
  'מגבוני סיוון',
  'מיכל גינון',
  'מיכלי זהב',
  'מירב אוזן',
  'מקאנו',
  'מר קייק',
  'מרכז הירק',
  'משתלות',
  'נטפים',
  'פוליבה',
  'פיין וויין גבינות',
  'פנדרייה (אנשי הלחם)',
  'פפירוס',
  'פריניב',
  'צח',
  'קיבוץ כנרת',
  'רפת א.א.א.',
  'תבליני כהן',
];

/**
 * Handle POST requests from the web app
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    Logger.log('Received data: ' + JSON.stringify(data));

    // Validate required fields
    if (!data.supplier_name || !data.document_date) {
      return createResponse(false, 'Missing required fields');
    }

    // Get the appropriate sheet and determine if it needs credit card column
    const sheetInfo = getSheetInfo(data);
    if (!sheetInfo.sheet) {
      return createResponse(false, 'Sheet not found for supplier: ' + data.supplier_name);
    }

    // Add data to sheet
    const success = addDataToSheet(sheetInfo, data);

    if (success) {
      return createResponse(true, 'Data added successfully to ' + sheetInfo.sheet.getName());
    } else {
      return createResponse(false, 'Failed to add data');
    }
  } catch (error) {
    Logger.log('Error: ' + error.toString());
    return createResponse(false, error.toString());
  }
}

/**
 * Handle GET requests (for testing)
 */
function doGet(e) {
  return ContentService.createTextOutput(
    'Invoice Scanner Backend is running. Use POST to submit data.'
  ).setMimeType(ContentService.MimeType.TEXT);
}

/**
 * Get sheet information based on supplier category
 */
function getSheetInfo(data) {
  const ss = SpreadsheetApp.openById('1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM');
  let sheetName;
  let useSpecialColumns = false;

  // Determine which sheet to use
  if (data.supplier_category === 'priority') {
    // Priority suppliers - use supplier name as sheet name
    sheetName = data.supplier_name;
    useSpecialColumns = false;
  } else if (data.supplier_category === 'fuel_station') {
    // Fuel stations
    sheetName = SHEET_NAMES.fuel_station;
    useSpecialColumns = true;
  } else if (data.supplier_category === 'supermarket') {
    // Supermarkets
    sheetName = SHEET_NAMES.supermarket;
    useSpecialColumns = true;
  } else if (data.supplier_category === 'nursery') {
    // Nurseries
    sheetName = SHEET_NAMES.nursery;
    useSpecialColumns = true;
  } else {
    // Other - default to "צח" or create new sheet
    sheetName = data.supplier_name;
    useSpecialColumns = false;
  }

  let sheet = ss.getSheetByName(sheetName);

  // If sheet doesn't exist for priority supplier, try to find similar name
  if (!sheet && data.supplier_category === 'priority') {
    // Try to find sheet with similar name
    const allSheets = ss.getSheets();
    for (const s of allSheets) {
      if (normalizeText(s.getName()) === normalizeText(sheetName)) {
        sheet = s;
        break;
      }
    }
  }

  // If still no sheet found, log error
  if (!sheet) {
    Logger.log('Sheet not found: ' + sheetName);
    Logger.log(
      'Available sheets: ' +
        ss
          .getSheets()
          .map((s) => s.getName())
          .join(', ')
    );
  }

  return {
    sheet: sheet,
    useSpecialColumns: useSpecialColumns,
  };
}

/**
 * Add data to the appropriate sheet - WITH DATE SORTING (oldest to newest)
 */
function addDataToSheet(sheetInfo, data) {
  try {
    const sheet = sheetInfo.sheet;
    const useSpecialColumns = sheetInfo.useSpecialColumns;
    const columns = useSpecialColumns ? SPECIAL_COLUMNS : REGULAR_COLUMNS;

    // Parse the incoming date
    const newDate = parseIsraeliDate(data.document_date);

    if (!newDate) {
      Logger.log('⚠️ Could not parse date, appending to end');
      // If date cannot be parsed, append to the end
      let targetRow = DATA_START_ROW;
      for (let row = DATA_START_ROW; row <= sheet.getMaxRows(); row++) {
        const cellValue = sheet.getRange(row, columns.DATE).getValue();
        if (!cellValue || cellValue === '') {
          targetRow = row;
          break;
        }
      }
      Logger.log('Writing to sheet: ' + sheet.getName() + ', row: ' + targetRow);
      writeRowData(sheet, targetRow, columns, data, useSpecialColumns);
      return true;
    }

    // Find the correct position to insert (sorted by date, oldest to newest)
    let targetRow = DATA_START_ROW;
    let insertPosition = -1;

    for (let row = DATA_START_ROW; row <= sheet.getMaxRows(); row++) {
      const existingDateValue = sheet.getRange(row, columns.DATE).getValue();

      // If we hit an empty row, insert here
      if (!existingDateValue || existingDateValue === '') {
        targetRow = row;
        insertPosition = row;
        Logger.log('📍 Found empty row at: ' + row);
        break;
      }

      // Compare dates
      const existingDate = new Date(existingDateValue);

      // If new date is older than existing date, insert before this row
      if (newDate < existingDate) {
        targetRow = row;
        insertPosition = row;
        Logger.log('📍 Found insertion point before row: ' + row + ' (new date is older)');
        break;
      }
    }

    // If we need to insert in the middle (not at the end), insert a new row
    if (insertPosition > DATA_START_ROW && insertPosition < sheet.getMaxRows()) {
      const nextRowValue = sheet.getRange(insertPosition, columns.DATE).getValue();
      if (nextRowValue && nextRowValue !== '') {
        // There's data at this position, insert a new row
        sheet.insertRowBefore(insertPosition);
        Logger.log('✅ Inserted new row at position: ' + insertPosition);
      }
    }

    Logger.log('Writing to sheet: ' + sheet.getName() + ', row: ' + targetRow + ' (date: ' + data.document_date + ')');

    // Write the data to the target row
    writeRowData(sheet, targetRow, columns, data, useSpecialColumns);

    Logger.log('✅ Data written successfully to row ' + targetRow);
    return true;
  } catch (error) {
    Logger.log('❌ Error adding data: ' + error.toString());
    return false;
  }
}

/**
 * Helper function to write data to a specific row
 */
function writeRowData(sheet, targetRow, columns, data, useSpecialColumns) {
  // Prepare the data based on document type
  const isDeliveryNote = data.document_type === 'delivery_note';
  const isInvoice = data.document_type === 'invoice';

  // ⭐ B - תאריך אספקה (Document Date) - FIXED DATE HANDLING
  if (data.document_date) {
    // Convert DD/MM/YYYY string to proper Date object
    const dateObj = parseIsraeliDate(data.document_date);
    if (dateObj) {
      sheet.getRange(targetRow, columns.DATE).setValue(dateObj);
      // Set number format to DD/MM/YYYY
      sheet.getRange(targetRow, columns.DATE).setNumberFormat('dd/mm/yyyy');
      Logger.log('✅ Date set successfully: ' + data.document_date + ' -> ' + dateObj.toString());
    } else {
      // Fallback: write as string if parsing fails
      sheet.getRange(targetRow, columns.DATE).setValue(data.document_date);
      Logger.log('⚠️ Date parsing failed, using string: ' + data.document_date);
    }
  }

  // C - מס' תעודת משלוח (Delivery Note Number)
  if (isDeliveryNote && data.document_number) {
    sheet.getRange(targetRow, columns.DELIVERY_NUM).setValue(data.document_number);
  }

  // D - סכום תעודת משלוח (Delivery Note Amount)
  if (isDeliveryNote && data.total_amount) {
    sheet.getRange(targetRow, columns.DELIVERY_SUM).setValue(parseFloat(data.total_amount));
  }

  // E - מס' חשבונית מס (Invoice Number)
  if (isInvoice && data.document_number) {
    sheet.getRange(targetRow, columns.INVOICE_NUM).setValue(data.document_number);
  }

  // F - סכום חשבונית מס (Invoice Amount)
  if (isInvoice && data.total_amount) {
    sheet.getRange(targetRow, columns.INVOICE_SUM).setValue(parseFloat(data.total_amount));
  }

  // G - הערות (Notes)
  let notes = '';
  if (useSpecialColumns) {
    // For special categories, add supplier name to notes
    notes = data.supplier_name || '';
    if (data.notes) {
      notes += (notes ? ' | ' : '') + data.notes;
    }
  } else {
    // For regular suppliers, just add notes if any
    notes = data.notes || '';
  }
  if (notes) {
    sheet.getRange(targetRow, columns.NOTES).setValue(notes);
  }

  // H - מס' כרטיס אשראי 4 ספרות (Credit Card - only for special categories)
  if (useSpecialColumns && data.credit_card_last4) {
    sheet.getRange(targetRow, columns.CREDIT_CARD).setValue('****' + data.credit_card_last4);
  }

  // Apply formatting
  formatDataRow(sheet, targetRow, useSpecialColumns);
}

/**
 * ⭐ Parse Israeli date format DD/MM/YYYY to Date object
 * This is the KEY FIX for the date format issue
 */
function parseIsraeliDate(dateString) {
  if (!dateString) return null;

  try {
    // Expected format: DD/MM/YYYY
    const parts = dateString.trim().split('/');

    if (parts.length !== 3) {
      Logger.log('Invalid date format: ' + dateString);
      return null;
    }

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    // Validate
    if (isNaN(day) || isNaN(month) || isNaN(year)) {
      Logger.log('Date parsing failed - invalid numbers: ' + dateString);
      return null;
    }

    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000) {
      Logger.log('Date validation failed: ' + dateString);
      return null;
    }

    // Create Date object (month is 0-indexed in JavaScript)
    // Set time to noon to avoid timezone issues
    const dateObj = new Date(year, month - 1, day, 12, 0, 0);

    // Verify the date is valid
    if (dateObj.getDate() !== day || dateObj.getMonth() !== month - 1) {
      Logger.log('Invalid date created: ' + dateString);
      return null;
    }

    Logger.log(
      '✅ Date parsed successfully: ' + dateString + ' -> ' + dateObj.toLocaleDateString('he-IL')
    );
    return dateObj;
  } catch (error) {
    Logger.log('❌ Error parsing date ' + dateString + ': ' + error.toString());
    return null;
  }
}

/**
 * Format the data row
 */
function formatDataRow(sheet, row, useSpecialColumns) {
  try {
    const lastColumn = useSpecialColumns ? 8 : 7;
    const range = sheet.getRange(row, 2, 1, lastColumn - 1);

    // Set text alignment to right (Hebrew)
    range.setHorizontalAlignment('right');
    range.setVerticalAlignment('middle');

    // Set border
    range.setBorder(true, true, true, true, true, true);
  } catch (error) {
    Logger.log('Error formatting row: ' + error.toString());
  }
}

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
  if (!text) return '';
  return text
    .toLowerCase()
    .replace(/[\"'\(\)]/g, '')
    .replace(/בע\"מ|בע"מ|בעמ|בע מ/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/**
 * Create JSON response
 */
function createResponse(success, message) {
  return ContentService.createTextOutput(
    JSON.stringify({
      success: success,
      message: message,
      timestamp: new Date().toISOString(),
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test function to verify the setup
 */
function testSetup() {
  // Test data for a priority supplier
  const testData1 = {
    supplier_category: 'priority',
    supplier_name: 'אלכס ברק',
    document_number: '123456789',
    document_type: 'invoice',
    document_date: '15/01/2025',
    total_amount: '150.00',
    notes: 'בדיקה',
  };

  Logger.log('Test 1: Priority Supplier (אלכס ברק)');
  const sheetInfo1 = getSheetInfo(testData1);
  if (sheetInfo1.sheet) {
    Logger.log('✓ Sheet found: ' + sheetInfo1.sheet.getName());
    const success1 = addDataToSheet(sheetInfo1, testData1);
    Logger.log(success1 ? '✓ Data added successfully' : '✗ Failed to add data');
  } else {
    Logger.log('✗ Sheet not found');
  }

  Logger.log('---');

  // Test data for fuel station
  const testData2 = {
    supplier_category: 'fuel_station',
    supplier_name: 'פז',
    document_number: '987654321',
    document_type: 'invoice',
    document_date: '20/01/2025',
    total_amount: '250.00',
    credit_card_last4: '1234',
  };

  Logger.log('Test 2: Fuel Station (תחנת דלק)');
  const sheetInfo2 = getSheetInfo(testData2);
  if (sheetInfo2.sheet) {
    Logger.log('✓ Sheet found: ' + sheetInfo2.sheet.getName());
    const success2 = addDataToSheet(sheetInfo2, testData2);
    Logger.log(success2 ? '✓ Data added successfully' : '✗ Failed to add data');
  } else {
    Logger.log('✗ Sheet not found');
  }

  Logger.log('---');
  Logger.log('Test completed. Check your sheets for the test entries.');
  Logger.log('Dates should appear as DD/MM/YYYY format (15/01/2025 and 20/01/2025)');
}

/**
 * List all available sheets (helper function)
 */
function listAllSheets() {
  const ss = SpreadsheetApp.openById('1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM');
  const sheets = ss.getSheets();

  Logger.log('Available sheets in spreadsheet:');
  sheets.forEach((sheet, index) => {
    Logger.log(index + 1 + '. ' + sheet.getName());
  });
}

/**
 * Clear test data from row 5 of all sheets (helper function - use with caution!)
 */
function clearTestData() {
  const ss = SpreadsheetApp.openById('1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM');
  const sheets = ss.getSheets();

  sheets.forEach((sheet) => {
    try {
      sheet.getRange(5, 2, 1, 7).clearContent();
      Logger.log('Cleared row 5 in sheet: ' + sheet.getName());
    } catch (error) {
      Logger.log('Error clearing sheet ' + sheet.getName() + ': ' + error.toString());
    }
  });

  Logger.log('Test data cleared from all sheets');
}
