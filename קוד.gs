/**
 * Google Apps Script for Invoice Scanner - WITH PRODUCT TRACKING
 *
 * Sheet ID: 1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM
 * Products Sheet ID: 1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
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

// Product tracking script URL - PASTE YOUR DEPLOYMENT URL HERE
const PRODUCTS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbwjLT8M5roreoTPk32Wn3a48RUZLK6x4skKOBjlvVVv8UswpfPteB-2KGKkDW6mE5RB/exec';

/**
 * Handle POST requests from the web app
 */
function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);
    Logger.log('📨 Received data: ' + JSON.stringify(data));

    // Validate required fields
    if (!data.supplier_name || !data.document_date) {
      return createResponse(false, 'Missing required fields');
    }

    // Get the appropriate sheet and determine if it needs credit card column
    const sheetInfo = getSheetInfo(data);
    if (!sheetInfo.sheet) {
      return createResponse(false, 'Sheet not found for supplier: ' + data.supplier_name);
    }

    const sheetName = sheetInfo.sheet.getName();
    Logger.log(`📋 Target sheet: ${sheetName}`);

    // Check if this is שונות sheet
    const isOtherCategory = sheetName === SHEET_NAMES.other;

    // Add data to sheet
    const success = addDataToSheet(sheetInfo, data);

    // Send products to product tracking spreadsheet
    // Exclude only if sheet is actually שונות (other)
    if (data.products && data.products.length > 0) {
      Logger.log(`📦 Found ${data.products.length} products`);

      if (isOtherCategory) {
        Logger.log('⚠️ Sheet is שונות - skipping product tracking');
      } else {
        Logger.log('✅ Sending products to tracking spreadsheet');
        sendProductsToTracking(data);
      }
    } else {
      Logger.log('⚠️ No products in request');
    }

    if (success) {
      return createResponse(true, 'Data added successfully to ' + sheetName);
    } else {
      return createResponse(false, 'Failed to add data');
    }
  } catch (error) {
    Logger.log('❌ Error: ' + error.toString());
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
 * Send products to product tracking spreadsheet
 */
function sendProductsToTracking(data) {
  try {
    Logger.log('📦 sendProductsToTracking called');
    Logger.log(`   Supplier: ${data.supplier_name}`);
    Logger.log(`   Products count: ${data.products ? data.products.length : 0}`);

    if (
      !PRODUCTS_SCRIPT_URL ||
      PRODUCTS_SCRIPT_URL === '' ||
      PRODUCTS_SCRIPT_URL === 'PASTE_YOUR_URL_HERE'
    ) {
      Logger.log('⚠️ Products script URL not configured. Skipping product tracking.');
      return;
    }

    const payload = {
      supplier_name: data.supplier_name,
      document_date: data.document_date,
      products: data.products || [],
    };

    Logger.log(`📤 Sending to: ${PRODUCTS_SCRIPT_URL}`);
    Logger.log(`   Payload: ${JSON.stringify(payload)}`);

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true,
    };

    const response = UrlFetchApp.fetch(PRODUCTS_SCRIPT_URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log(`📥 Response code: ${responseCode}`);
    Logger.log(`   Response: ${responseText}`);

    if (responseCode === 200) {
      Logger.log('✅ Products sent successfully to tracking spreadsheet');
    } else {
      Logger.log(`⚠️ Products tracking response: ${responseCode} - ${responseText}`);
    }
  } catch (error) {
    Logger.log('❌ Error sending products to tracking: ' + error.toString());
    Logger.log('   Stack: ' + error.stack);
    // Don't fail the main invoice processing if product tracking fails
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

      if (!existingDateValue || existingDateValue === '') {
        targetRow = row;
        needsShift = false;
        Logger.log('📍 Found empty row at: ' + row);
        break;
      }

      const existingDate = new Date(existingDateValue);

      if (newDate < existingDate) {
        targetRow = row;
        needsShift = true;
        Logger.log('📍 Found insertion point before row: ' + row);
        break;
      }
    }

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
      Logger.log('📍 Appending to end at row: ' + targetRow);
    }

    if (needsShift) {
      shiftDataDown(sheet, targetRow, columns, useSpecialColumns);
    }

    Logger.log('Writing to row: ' + targetRow);
    writeRowData(sheet, targetRow, columns, data, useSpecialColumns);

    Logger.log('✅ Data written successfully');
    return true;
  } catch (error) {
    Logger.log('❌ Error adding data: ' + error.toString());
    return false;
  }
}

/**
 * Shift existing data down by one row
 */
function shiftDataDown(sheet, startRow, columns, useSpecialColumns) {
  try {
    Logger.log('📋 Shifting data down from row ' + startRow);

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

    const startCol = 2;
    const endCol = useSpecialColumns ? 8 : 7;
    const numCols = endCol - startCol + 1;

    for (let row = lastRow; row >= startRow; row--) {
      const sourceRange = sheet.getRange(row, startCol, 1, numCols);
      const targetRange = sheet.getRange(row + 1, startCol, 1, numCols);
      sourceRange.copyTo(targetRange);
    }

    sheet.getRange(startRow, startCol, 1, numCols).clear();
    Logger.log('✅ Data shifted');
  } catch (error) {
    Logger.log('❌ Error shifting data: ' + error.toString());
    throw error;
  }
}

/**
 * Write data to a specific row
 */
function writeRowData(sheet, targetRow, columns, data, useSpecialColumns) {
  const isDeliveryNote = data.document_type === 'delivery_note';
  const isInvoice = data.document_type === 'invoice';

  // Date
  if (data.document_date) {
    const dateObj = parseIsraeliDate(data.document_date);
    if (dateObj) {
      sheet.getRange(targetRow, columns.DATE).setValue(dateObj);
      sheet.getRange(targetRow, columns.DATE).setNumberFormat('dd/mm/yyyy');
    } else {
      sheet.getRange(targetRow, columns.DATE).setValue(data.document_date);
    }
  }

  // Delivery note
  if (isDeliveryNote && data.document_number) {
    sheet.getRange(targetRow, columns.DELIVERY_NUM).setValue(data.document_number);
  }
  if (isDeliveryNote && data.total_amount) {
    const amount = parseAmount(data.total_amount);
    sheet.getRange(targetRow, columns.DELIVERY_SUM).setValue(amount);
  }

  // Invoice
  if (isInvoice && data.document_number) {
    sheet.getRange(targetRow, columns.INVOICE_NUM).setValue(data.document_number);
  }
  if (isInvoice && data.total_amount) {
    const amount = parseAmount(data.total_amount);
    sheet.getRange(targetRow, columns.INVOICE_SUM).setValue(amount);
  }

  // Notes
  let notes = '';
  if (useSpecialColumns) {
    notes = data.supplier_name || '';
    if (data.notes) {
      notes += (notes ? ' | ' : '') + data.notes;
    }
  } else {
    notes = data.notes || '';
  }
  if (notes) {
    sheet.getRange(targetRow, columns.NOTES).setValue(notes);
  }

  // Credit card
  if (useSpecialColumns && data.credit_card_last4) {
    sheet.getRange(targetRow, columns.CREDIT_CARD).setValue('****' + data.credit_card_last4);
  }

  formatDataRow(sheet, targetRow, useSpecialColumns);
}

/**
 * Parse Israeli date format DD/MM/YYYY to Date object
 */
function parseIsraeliDate(dateString) {
  if (!dateString) return null;

  try {
    const parts = dateString.trim().split('/');
    if (parts.length !== 3) return null;

    const day = parseInt(parts[0], 10);
    const month = parseInt(parts[1], 10);
    const year = parseInt(parts[2], 10);

    if (isNaN(day) || isNaN(month) || isNaN(year)) return null;
    if (day < 1 || day > 31 || month < 1 || month > 12 || year < 2000) return null;

    const dateObj = new Date(year, month - 1, day, 12, 0, 0);

    if (dateObj.getDate() !== day || dateObj.getMonth() !== month - 1) return null;

    return dateObj;
  } catch (error) {
    Logger.log('❌ Error parsing date: ' + error.toString());
    return null;
  }
}

/**
 * Parse amount with comma separator
 */
function parseAmount(amountString) {
  if (!amountString) return 0;

  try {
    let str = String(amountString).trim();
    str = str.replace(/[₪$€£¥]/g, '');
    str = str.replace(/NIS|ILS/gi, '');
    str = str.trim();
    str = str.replace(/,/g, '');

    const amount = parseFloat(str);
    return isNaN(amount) ? 0 : amount;
  } catch (error) {
    return 0;
  }
}

/**
 * Format the data row
 */
function formatDataRow(sheet, row, useSpecialColumns) {
  try {
    const lastColumn = useSpecialColumns ? 8 : 7;
    const range = sheet.getRange(row, 2, 1, lastColumn - 1);
    range.setHorizontalAlignment('right');
    range.setVerticalAlignment('middle');
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
