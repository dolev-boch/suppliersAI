/**
 * Google Apps Script for Invoice Scanner - COMPLETE VERSION WITH CREDIT INVOICE SUPPORT
 *
 * Sheet ID: 1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM
 *
 * FEATURES:
 * - Date sorting (oldest to newest)
 * - Credit invoice support (חשבונית זיכוי) with negative amounts
 * - Duplicate invoice detection
 * - Priority suppliers and special categories (fuel, supermarket, nursery, other)
 * - Proper Israeli date parsing (DD/MM/YYYY)
 * - Amount parsing with comma support (1,760.50)
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
  other: 'שונות', // "Other" category suppliers go to שונות sheet
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

    // ⭐ NEW: Check for duplicate invoices (only for invoices and credit invoices)
    const isInvoice = data.document_type === 'invoice' || data.document_type === 'credit_invoice';

    if (isInvoice && data.document_number) {
      const duplicate = checkDuplicateInvoice(
        sheetInfo.sheet,
        data.document_number,
        sheetInfo.useSpecialColumns
      );

      if (duplicate) {
        const errorMsg = `חשבונית ${data.document_number} כבר קיימת במערכת (שורה ${duplicate.row}, תאריך ${duplicate.date})`;
        Logger.log('⚠️ Duplicate found: ' + errorMsg);
        return createResponse(false, errorMsg);
      }
    }

    // Add data to sheet
    const success = addDataToSheet(sheetInfo, data);

    if (success) {
      const docType = getDocumentTypeHebrew(data.document_type);
      return createResponse(true, `${docType} ${data.document_number} נוספה בהצלחה ל${sheetInfo.sheet.getName()}`);
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
 * ⭐ NEW: Check if invoice number already exists in sheet
 */
function checkDuplicateInvoice(sheet, invoiceNumber, useSpecialColumns) {
  try {
    const columns = useSpecialColumns ? SPECIAL_COLUMNS : REGULAR_COLUMNS;
    const lastRow = sheet.getLastRow();

    // Search from DATA_START_ROW to last row
    for (let row = DATA_START_ROW; row <= lastRow; row++) {
      const existingInvoiceNum = sheet.getRange(row, columns.INVOICE_NUM).getValue();

      // Check if invoice number matches (convert to string for comparison)
      if (existingInvoiceNum && String(existingInvoiceNum) === String(invoiceNumber)) {
        const existingDate = sheet.getRange(row, columns.DATE).getValue();
        const formattedDate = existingDate
          ? Utilities.formatDate(new Date(existingDate), Session.getScriptTimeZone(), 'dd/MM/yyyy')
          : 'לא ידוע';

        Logger.log(`📍 Duplicate found at row ${row}: Invoice ${invoiceNumber}, Date ${formattedDate}`);
        return {
          row: row,
          date: formattedDate,
        };
      }
    }

    // No duplicate found
    return null;
  } catch (error) {
    Logger.log('❌ Error checking for duplicates: ' + error.toString());
    // Don't block on error, return null to allow processing
    return null;
  }
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
    // Other - route to "שונות" sheet
    sheetName = SHEET_NAMES.other;
    useSpecialColumns = true;
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
 * WITHOUT inserting rows (to preserve static מספר סידורי in column A)
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
    let targetRow = -1;
    let needsShift = false;

    for (let row = DATA_START_ROW; row <= sheet.getMaxRows(); row++) {
      const existingDateValue = sheet.getRange(row, columns.DATE).getValue();

      // If we hit an empty row, this is the end - just write here
      if (!existingDateValue || existingDateValue === '') {
        targetRow = row;
        needsShift = false;
        Logger.log('📍 Found empty row at: ' + row + ' - appending here');
        break;
      }

      // Compare dates
      const existingDate = new Date(existingDateValue);

      // If new date is older than existing date, insert before this row
      if (newDate < existingDate) {
        targetRow = row;
        needsShift = true;
        Logger.log(
          '📍 Found insertion point before row: ' +
            row +
            ' (new date ' +
            data.document_date +
            ' is older than existing ' +
            existingDate.toLocaleDateString('he-IL') +
            ')'
        );
        break;
      }
    }

    // If we didn't find any position, append to the very end
    if (targetRow === -1) {
      targetRow = DATA_START_ROW;
      for (let row = DATA_START_ROW; row <= sheet.getMaxRows(); row++) {
        const cellValue = sheet.getRange(row, columns.DATE).getValue();
        if (!cellValue || cellValue === '') {
          targetRow = row;
          break;
        }
      }
      needsShift = false;
      Logger.log('📍 No insertion point found, appending to end at row: ' + targetRow);
    }

    // If we need to insert in the middle, shift existing data down
    if (needsShift) {
      shiftDataDown(sheet, targetRow, columns, useSpecialColumns);
    }

    Logger.log(
      'Writing to sheet: ' +
        sheet.getName() +
        ', row: ' +
        targetRow +
        ' (date: ' +
        data.document_date +
        ')'
    );

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
 * Shift existing data down by one row (without inserting rows)
 * This preserves the static מספר סידורי in column A
 * IMPORTANT: Shifts from BOTTOM to TOP to avoid overwriting data
 */
function shiftDataDown(sheet, startRow, columns, useSpecialColumns) {
  try {
    Logger.log('📋 Shifting data down from row ' + startRow);

    // Find the last row with data
    let lastRow = startRow;
    for (let row = startRow; row <= sheet.getMaxRows(); row++) {
      const cellValue = sheet.getRange(row, columns.DATE).getValue();
      if (!cellValue || cellValue === '') {
        lastRow = row - 1;
        break;
      }
    }

    if (lastRow < startRow) {
      Logger.log('No data to shift');
      return;
    }

    Logger.log('Last row with data: ' + lastRow);

    // Determine the range of columns to shift (B to G or B to H)
    const startCol = 2; // Column B (skip column A with מספר סידורי)
    const endCol = useSpecialColumns ? 8 : 7; // H or G
    const numCols = endCol - startCol + 1;

    // CRITICAL FIX: Shift data from BOTTOM to TOP to avoid overwriting
    // Start from the last row and move backwards
    for (let row = lastRow; row >= startRow; row--) {
      // Read ALL data from this row (columns B to endCol)
      const sourceRange = sheet.getRange(row, startCol, 1, numCols);

      // Copy the entire range to one row down using copyTo
      // This preserves ALL data, formulas, formats, etc.
      const targetRange = sheet.getRange(row + 1, startCol, 1, numCols);
      sourceRange.copyTo(targetRange);

      Logger.log(
        'Shifted row ' +
          row +
          ' to row ' +
          (row + 1) +
          ' (columns ' +
          startCol +
          ' to ' +
          endCol +
          ')'
      );
    }

    Logger.log('✅ Data shifted down successfully (' + (lastRow - startRow + 1) + ' rows)');

    // Clear the original startRow (will be overwritten with new data)
    sheet.getRange(startRow, startCol, 1, numCols).clear();
  } catch (error) {
    Logger.log('❌ Error shifting data: ' + error.toString());
    throw error;
  }
}

/**
 * Helper function to write data to a specific row
 * ⭐ UPDATED: Added support for credit_invoice document type
 */
function writeRowData(sheet, targetRow, columns, data, useSpecialColumns) {
  // Prepare the data based on document type
  const isDeliveryNote = data.document_type === 'delivery_note';
  const isInvoice = data.document_type === 'invoice';
  const isCreditInvoice = data.document_type === 'credit_invoice';

  // ⭐ B - תאריך אספקה (Document Date)
  if (data.document_date) {
    const dateObj = parseIsraeliDate(data.document_date);
    if (dateObj) {
      sheet.getRange(targetRow, columns.DATE).setValue(dateObj);
      sheet.getRange(targetRow, columns.DATE).setNumberFormat('dd/mm/yyyy');
      Logger.log('✅ Date set successfully: ' + data.document_date + ' -> ' + dateObj.toString());
    } else {
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
    const amount = parseAmount(data.total_amount);
    sheet.getRange(targetRow, columns.DELIVERY_SUM).setValue(amount);
    Logger.log('✅ Delivery amount set: ' + data.total_amount + ' -> ' + amount);
  }

  // E - מס' חשבונית מס (Invoice Number) - handles both invoice and credit_invoice
  if ((isInvoice || isCreditInvoice) && data.document_number) {
    sheet.getRange(targetRow, columns.INVOICE_NUM).setValue(data.document_number);
  }

  // F - סכום חשבונית מס (Invoice Amount) - handles both invoice and credit_invoice
  if ((isInvoice || isCreditInvoice) && data.total_amount) {
    const amount = parseAmount(data.total_amount);

    // ⭐ CREDIT INVOICE: Ensure amount is negative
    if (isCreditInvoice && amount > 0) {
      Logger.log('💳 Credit invoice detected - converting to negative: ' + amount + ' -> -' + amount);
      sheet.getRange(targetRow, columns.INVOICE_SUM).setValue(-amount);
    } else {
      sheet.getRange(targetRow, columns.INVOICE_SUM).setValue(amount);
    }

    Logger.log('✅ Invoice amount set: ' + data.total_amount + ' -> ' + amount);
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

  // ⭐ CREDIT INVOICE: Ensure "חשבונית זיכוי" is in notes
  if (isCreditInvoice && !notes.includes('חשבונית זיכוי')) {
    notes = notes ? 'חשבונית זיכוי | ' + notes : 'חשבונית זיכוי';
  }

  if (notes) {
    sheet.getRange(targetRow, columns.NOTES).setValue(notes);
  }

  // H - מס' כרטיס אשראי 4 ספרות (Credit Card - only for special categories)
  if (useSpecialColumns && data.credit_card_last4) {
    sheet.getRange(targetRow, columns.CREDIT_CARD).setValue('****' + data.credit_card_last4);
  }

  // Apply formatting (highlight credit invoices in red)
  formatDataRow(sheet, targetRow, useSpecialColumns, isCreditInvoice);
}

/**
 * Parse Israeli date format DD/MM/YYYY to Date object
 */
function parseIsraeliDate(dateString) {
  if (!dateString) return null;

  try {
    const parts = dateString.trim().split('/');

    if (parts.length !== 3) {
      Logger.log('Invalid date format: ' + dateString);
      return null;
    }

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year)) {
      Logger.log('Date parsing failed - invalid numbers: ' + dateString);
      return null;
    }

    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000) {
      Logger.log('Date validation failed: ' + dateString);
      return null;
    }

    const dateObj = new Date(year, month - 1, day, 12, 0, 0);

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
 * ⭐ UPDATED: Parse amount (handles negative amounts for credit invoices)
 */
function parseAmount(amountString) {
  if (!amountString) return 0;

  try {
    let str = String(amountString).trim();

    // Remove currency symbols
    str = str.replace(/[₪$€£¥]/g, '');
    str = str.replace(/NIS|ILS/gi, '');
    str = str.trim();

    // Remove commas (thousands separator)
    str = str.replace(/,/g, '');

    // Parse the number (handles negative with minus sign)
    const amount = parseFloat(str);

    if (isNaN(amount)) {
      Logger.log('⚠️ Amount parsing failed for: ' + amountString + ', returning 0');
      return 0;
    }

    Logger.log('✅ Amount parsed: ' + amountString + ' -> ' + amount);
    return amount;
  } catch (error) {
    Logger.log('❌ Error parsing amount ' + amountString + ': ' + error.toString());
    return 0;
  }
}

/**
 * ⭐ UPDATED: Format the data row (highlight credit invoices)
 */
function formatDataRow(sheet, row, useSpecialColumns, isCreditInvoice) {
  try {
    const lastColumn = useSpecialColumns ? 8 : 7;
    const range = sheet.getRange(row, 2, 1, lastColumn - 1);

    // Set text alignment to right (Hebrew)
    range.setHorizontalAlignment('right');
    range.setVerticalAlignment('middle');

    // Set border
    range.setBorder(true, true, true, true, true, true);

    // ⭐ Highlight credit invoices in red
    if (isCreditInvoice) {
      const columns = useSpecialColumns ? SPECIAL_COLUMNS : REGULAR_COLUMNS;

      // Highlight invoice amount cell in red
      const amountCell = sheet.getRange(row, columns.INVOICE_SUM);
      amountCell.setFontColor('#c53929');
      amountCell.setFontWeight('bold');

      // Light red background for the entire row
      range.setBackground('#ffebee');

      Logger.log('💳 Applied credit invoice formatting to row ' + row);
    }
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
 * ⭐ NEW: Get Hebrew name for document type
 */
function getDocumentTypeHebrew(documentType) {
  switch (documentType) {
    case 'invoice':
      return 'חשבונית מס';
    case 'delivery_note':
      return 'תעודת משלוח';
    case 'credit_invoice':
      return 'חשבונית זיכוי';
    default:
      return 'מסמך';
  }
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
 * ⭐ UPDATED: Test functions including credit invoice test
 */
function testCreditInvoice() {
  Logger.log('🧪 Testing credit invoice...');

  const testData = {
    supplier_category: 'supermarket',
    supplier_name: 'שופרסל',
    document_number: 'CREDIT-TEST-123',
    document_type: 'credit_invoice',
    document_date: '04/01/2026',
    total_amount: '-256.50',
    credit_card_last4: '1234',
    notes: 'חשבונית זיכוי',
  };

  const sheetInfo = getSheetInfo(testData);
  if (sheetInfo.sheet) {
    Logger.log('✓ Sheet found: ' + sheetInfo.sheet.getName());
    const success = addDataToSheet(sheetInfo, testData);
    Logger.log(success ? '✓ Credit invoice added successfully' : '✗ Failed to add credit invoice');
  } else {
    Logger.log('✗ Sheet not found');
  }
}

function testDuplicateDetection() {
  Logger.log('🧪 Testing duplicate detection...');

  const testData = {
    supplier_category: 'priority',
    supplier_name: 'מקאנו',
    document_number: 'DUP-TEST-999',
    document_type: 'invoice',
    document_date: '04/01/2026',
    total_amount: '100',
  };

  // Add once
  Logger.log('Adding invoice first time...');
  const sheetInfo = getSheetInfo(testData);
  if (sheetInfo.sheet) {
    addDataToSheet(sheetInfo, testData);
  }

  // Try to add again (should fail)
  Logger.log('Trying to add same invoice again (should fail)...');
  const duplicate = checkDuplicateInvoice(sheetInfo.sheet, testData.document_number, false);
  if (duplicate) {
    Logger.log('✓ Duplicate correctly detected at row ' + duplicate.row + ', date ' + duplicate.date);
  } else {
    Logger.log('✗ Duplicate NOT detected (problem!)');
  }
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
