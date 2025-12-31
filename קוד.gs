// ============================================================================
// Zuza Patisserie - Invoice Scanner Backend
// Main spreadsheet processing script WITH PRODUCT TRACKING
// ============================================================================

// Spreadsheet configuration
const DATA_START_ROW = 5;

// Column mappings for regular suppliers
const REGULAR_COLUMNS = {
  supplierName: 1,    // A
  documentDate: 2,     // B
  documentNumber: 3,   // C
  totalAmount: 4       // D
};

// Column mappings for credit card suppliers (includes credit card column)
const SPECIAL_COLUMNS = {
  supplierName: 1,    // A
  documentDate: 2,     // B
  documentNumber: 3,   // C
  creditCard: 4,       // D (credit card number)
  totalAmount: 5       // E
};

// Sheet names
const SHEET_NAMES = {
  other: 'שונות',
  gasStation: 'תחנת דלק',
  foodChains: 'רשתות מזון',
  nurseries: 'משתלות'
};

// ⚠️ CRITICAL: PASTE YOUR PRODUCTS TRACKING WEB APP URL HERE
// Get it from: Products spreadsheet → Deploy → Manage deployments → Copy Web App URL
const PRODUCTS_SCRIPT_URL = 'PASTE_YOUR_PRODUCTS_TRACKING_URL_HERE';

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
    const isOtherCategory = (sheetName === SHEET_NAMES.other);

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

    if (!PRODUCTS_SCRIPT_URL || PRODUCTS_SCRIPT_URL === '' || PRODUCTS_SCRIPT_URL === 'PASTE_YOUR_PRODUCTS_TRACKING_URL_HERE') {
      Logger.log('⚠️ Products script URL not configured. Skipping product tracking.');
      return;
    }

    const payload = {
      supplier_name: data.supplier_name,
      document_date: data.document_date,
      products: data.products || []
    };

    Logger.log('📤 Sending to: ' + PRODUCTS_SCRIPT_URL);
    Logger.log('   Payload: ' + JSON.stringify(payload));

    const options = {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify(payload),
      muteHttpExceptions: true
    };

    const response = UrlFetchApp.fetch(PRODUCTS_SCRIPT_URL, options);
    const responseCode = response.getResponseCode();
    const responseText = response.getContentText();

    Logger.log('📥 Response code: ' + responseCode);
    Logger.log('   Response: ' + responseText);

    if (responseCode === 200) {
      Logger.log('✅ Products sent successfully to tracking spreadsheet');
    } else {
      Logger.log('⚠️ Products tracking response: ' + responseCode + ' - ' + responseText);
    }
  } catch (error) {
    Logger.log('❌ Error sending products to tracking: ' + error.toString());
    Logger.log('   This is non-blocking - invoice data was still saved');
  }
}

/**
 * Get sheet info based on supplier data
 */
function getSheetInfo(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = null;
  let useSpecialColumns = false;

  // Priority suppliers - match by name
  const prioritySuppliers = [
    'אלכס ברק', 'אחים לוי', 'אלמנדוס בע"מ', 'אפי שיווק ביצים', 'אקיופוז', 'ארגל',
    'אריזים שפי פלסט', 'בזק', 'הפרסי פירות וירקות בע"מ', 'דקל דברי נוי',
    'ח.ל.ק.ט קרח', 'טויטו שחר מחלבות גד', 'טכנאים', 'מ. אש קפה', 'מגבוני סיוון',
    'מיכל גינון', 'מיכלי זהב', 'מירב אוזן', 'מקאנו', 'מר קייק', 'מרכז הירק',
    'משתלות', 'נטפים', 'פוליבה', 'פיין וויין גבינות', 'פנדרייה (אנשי הלחם)',
    'פפירוס', 'פריניב', 'צח', 'קיבוץ כנרת', 'רפת א.א.א.', 'תבליני כהן'
  ];

  const supplierName = data.supplier_name;
  const normalizedSupplier = normalizeText(supplierName);

  // Check priority suppliers first
  for (const prioritySupplier of prioritySuppliers) {
    const normalized = normalizeText(prioritySupplier);
    if (normalized === normalizedSupplier || normalizedSupplier.includes(normalized) || normalized.includes(normalizedSupplier)) {
      sheet = ss.getSheetByName(prioritySupplier);
      if (sheet) {
        Logger.log(`✅ Priority supplier matched: "${supplierName}" → "${prioritySupplier}" (exact)`);
        data.supplier_category = 'priority';
        data.supplier_name = prioritySupplier;
        useSpecialColumns = false;
        return { sheet, useSpecialColumns };
      }
    }
  }

  // Check special categories
  if (data.supplier_category === 'gas_station' || normalizedSupplier.includes('דלק') || normalizedSupplier.includes('סונול') || normalizedSupplier.includes('פז')) {
    sheet = ss.getSheetByName(SHEET_NAMES.gasStation);
    useSpecialColumns = true;
    Logger.log(`✅ Gas station category: "${supplierName}"`);
  } else if (data.supplier_category === 'food_chain' || ['שופרסל', 'רמי לוי', 'ויקטורי', 'יינות ביתן'].some(chain => normalizedSupplier.includes(normalizeText(chain)))) {
    sheet = ss.getSheetByName(SHEET_NAMES.foodChains);
    useSpecialColumns = true;
    Logger.log(`✅ Food chain category: "${supplierName}"`);
  } else if (data.supplier_category === 'nursery' || normalizedSupplier.includes('משתל')) {
    sheet = ss.getSheetByName(SHEET_NAMES.nurseries);
    useSpecialColumns = false;
    Logger.log(`✅ Nursery category: "${supplierName}"`);
  } else {
    sheet = ss.getSheetByName(SHEET_NAMES.other);
    useSpecialColumns = false;
    Logger.log(`✅ Other category: "${supplierName}"`);
  }

  return { sheet, useSpecialColumns };
}

/**
 * Add data to the specified sheet
 */
function addDataToSheet(sheetInfo, data) {
  try {
    const sheet = sheetInfo.sheet;
    const useSpecialColumns = sheetInfo.useSpecialColumns;
    const columns = useSpecialColumns ? SPECIAL_COLUMNS : REGULAR_COLUMNS;

    Logger.log(`Writing to sheet: ${sheet.getName()}, row: ${DATA_START_ROW}`);

    // Parse the document date
    const documentDate = parseIsraeliDate(data.document_date);

    // Find the correct row to insert (sorted by date, newest first)
    let targetRow = DATA_START_ROW;
    const lastRow = sheet.getLastRow();

    if (lastRow >= DATA_START_ROW) {
      const dateColumn = columns.documentDate;
      const existingDates = sheet.getRange(DATA_START_ROW, dateColumn, lastRow - DATA_START_ROW + 1, 1).getValues();

      for (let i = 0; i < existingDates.length; i++) {
        const existingDate = existingDates[i][0];
        if (existingDate instanceof Date && documentDate > existingDate) {
          targetRow = DATA_START_ROW + i;
          break;
        }
      }

      if (targetRow === DATA_START_ROW && lastRow >= DATA_START_ROW) {
        targetRow = lastRow + 1;
      }
    }

    // Shift existing data down if inserting in the middle
    if (targetRow <= lastRow) {
      shiftDataDown(sheet, targetRow, columns, useSpecialColumns);
    }

    // Write the data
    writeRowData(sheet, targetRow, columns, data, useSpecialColumns);

    // Format the row
    formatDataRow(sheet, targetRow, useSpecialColumns);

    Logger.log('✅ Data written successfully');
    return true;
  } catch (error) {
    Logger.log('❌ Error in addDataToSheet: ' + error.toString());
    return false;
  }
}

/**
 * Shift data down to make room for new row
 */
function shiftDataDown(sheet, startRow, columns, useSpecialColumns) {
  const lastRow = sheet.getLastRow();
  const numCols = useSpecialColumns ? 5 : 4;

  const dataRange = sheet.getRange(startRow, 1, lastRow - startRow + 1, numCols);
  const values = dataRange.getValues();
  const formats = dataRange.getNumberFormats();

  const targetRange = sheet.getRange(startRow + 1, 1, lastRow - startRow + 1, numCols);
  targetRange.setValues(values);
  targetRange.setNumberFormats(formats);
}

/**
 * Helper function to write data to a specific row
 */
function writeRowData(sheet, targetRow, columns, data, useSpecialColumns) {
  const documentDate = parseIsraeliDate(data.document_date);
  const totalAmount = parseAmount(data.total_amount);

  sheet.getRange(targetRow, columns.supplierName).setValue(data.supplier_name);
  sheet.getRange(targetRow, columns.documentDate).setValue(documentDate);
  sheet.getRange(targetRow, columns.documentNumber).setValue(data.document_number || '');

  if (useSpecialColumns && data.credit_card_last4) {
    sheet.getRange(targetRow, columns.creditCard).setValue(data.credit_card_last4);
    sheet.getRange(targetRow, columns.totalAmount).setValue(totalAmount);
  } else if (useSpecialColumns) {
    sheet.getRange(targetRow, columns.creditCard).setValue('');
    sheet.getRange(targetRow, columns.totalAmount).setValue(totalAmount);
  } else {
    sheet.getRange(targetRow, columns.totalAmount).setValue(totalAmount);
  }
}

/**
 * Parse Israeli date format (DD/MM/YYYY) to Date object
 */
function parseIsraeliDate(dateString) {
  if (!dateString) return new Date();

  const parts = dateString.split('/');
  if (parts.length === 3) {
    const day = parseInt(parts[0]);
    const month = parseInt(parts[1]) - 1;
    const year = parseInt(parts[2]);
    return new Date(year, month, day);
  }

  return new Date();
}

/**
 * Parse amount string to number
 */
function parseAmount(amountString) {
  if (typeof amountString === 'number') return amountString;
  if (!amountString) return 0;

  const cleaned = amountString.toString().replace(/[^\d.-]/g, '');
  return parseFloat(cleaned) || 0;
}

/**
 * Format data row
 */
function formatDataRow(sheet, row, useSpecialColumns) {
  const numCols = useSpecialColumns ? 5 : 4;
  const rowRange = sheet.getRange(row, 1, 1, numCols);
  rowRange.setHorizontalAlignment('right');

  const dateCol = useSpecialColumns ? 2 : 2;
  sheet.getRange(row, dateCol).setNumberFormat('dd/mm/yyyy');

  const amountCol = useSpecialColumns ? 5 : 4;
  sheet.getRange(row, amountCol).setNumberFormat('#,##0.00');
}

/**
 * Normalize text for comparison
 */
function normalizeText(text) {
  return text.toLowerCase().trim().replace(/\s+/g, ' ').replace(/[״׳'"]/g, '');
}

/**
 * Create response object
 */
function createResponse(success, message) {
  return ContentService.createTextOutput(
    JSON.stringify({ success: success, message: message })
  ).setMimeType(ContentService.MimeType.JSON);
}
