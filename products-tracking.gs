/**
 * Product Tracking System - Google Apps Script
 *
 * Spreadsheet ID: 1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
 *
 * PURPOSE:
 * - Track products and prices from each supplier
 * - Maintain price history for all products
 * - Auto-update prices when they change
 * - One sheet per supplier for current products
 * - One central price history sheet
 *
 * SHEET STRUCTURE:
 * - Each supplier sheet: A2=Product Name, B2=Current Price (before VAT)
 * - היסטוריית שינויי מחירים: A2=Supplier, B2=Product, C2=Price, D2=Date
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const PRODUCTS_SPREADSHEET_ID = '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ';
const PRICE_HISTORY_SHEET_NAME = 'היסטוריית שינויי מחירים';

// Data starts at row 2 (row 1 is header)
const PRODUCT_DATA_START_ROW = 2;

// Supplier sheets - excluding שונות
const SUPPLIER_SHEETS = [
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
  'תחנת דלק',
  'רשתות מזון',
  'משתלות',
];

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

/**
 * Main function called from web app
 * Receives invoice data with products and processes them
 */
function doPost(e) {
  try {
    Logger.log('📨 Received POST request for product tracking');
    Logger.log('📦 Raw postData: ' + (e.postData ? e.postData.contents : 'NO POST DATA'));

    if (!e.postData || !e.postData.contents) {
      Logger.log('❌ No post data received!');
      return ContentService.createTextOutput(
        JSON.stringify({ success: false, error: 'No post data received' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(e.postData.contents);
    Logger.log('✅ Parsed data successfully');
    Logger.log('   Supplier: ' + (data.supplier_name || 'MISSING'));
    Logger.log('   Products count: ' + (data.products ? data.products.length : 0));

    // Process products
    if (data.products && data.products.length > 0) {
      Logger.log('🚀 Processing ' + data.products.length + ' products...');
      processProducts(data);
      Logger.log('✅ Products processed successfully!');
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, message: 'Products processed successfully' })
      ).setMimeType(ContentService.MimeType.JSON);
    } else {
      Logger.log('⚠️ No products in request');
      return ContentService.createTextOutput(
        JSON.stringify({ success: true, message: 'No products to process' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

  } catch (error) {
    Logger.log('❌ ERROR in doPost: ' + error.toString());
    Logger.log('   Stack: ' + error.stack);
    if (e && e.postData) {
      Logger.log('   Raw data: ' + e.postData.contents);
    }

    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

/**
 * Handle GET requests (for testing/verification)
 */
function doGet(e) {
  Logger.log('📭 Received GET request - this endpoint requires POST');
  return ContentService.createTextOutput(
    JSON.stringify({
      success: false,
      message: 'Product Tracking API - This endpoint requires POST requests with product data',
      note: 'If you see this, the deployment is working. Use POST to submit products.'
    })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * Test function for manual testing
 */
function testProcessProducts() {
  const testData = {
    supplier_name: 'מקאנו',
    document_date: '15/12/2024',
    products: [
      { name: 'חלב 3%', quantity: 10, unit: 'ליטר', unit_price_before_vat: 5.80, total_before_vat: 58.00 },
      { name: 'קמח לבן', quantity: 25, unit: 'ק״ג', unit_price_before_vat: 3.50, total_before_vat: 87.50 },
    ]
  };

  processProducts(testData);
}

// ============================================================================
// PRODUCT PROCESSING
// ============================================================================

/**
 * Process products from invoice
 * @param {Object} data - Invoice data containing supplier_name, document_date, and products array
 */
function processProducts(data) {
  const supplierName = data.supplier_name;
  const documentDate = data.document_date;
  const products = data.products || [];

  if (!supplierName) {
    Logger.log('⚠️ No supplier name provided');
    return;
  }

  if (products.length === 0) {
    Logger.log('⚠️ No products to process');
    return;
  }

  Logger.log(`Processing ${products.length} products for supplier: ${supplierName}`);

  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);

  // Get supplier sheet
  const supplierSheet = getOrCreateSupplierSheet(ss, supplierName);

  // Get price history sheet
  const historySheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);

  if (!historySheet) {
    Logger.log('❌ Price history sheet not found!');
    return;
  }

  // Get existing products from supplier sheet
  const existingProducts = getExistingProducts(supplierSheet);

  // Process each product
  products.forEach(product => {
    processProduct(supplierSheet, historySheet, existingProducts, product, supplierName, documentDate);
  });

  Logger.log(`✅ Processed ${products.length} products for ${supplierName}`);
}

/**
 * Process a single product
 */
function processProduct(supplierSheet, historySheet, existingProducts, product, supplierName, documentDate) {
  const productName = product.name;
  const newPrice = parseFloat(product.unit_price_before_vat);

  if (!productName || isNaN(newPrice)) {
    Logger.log(`⚠️ Skipping invalid product: ${JSON.stringify(product)}`);
    return;
  }

  // Find existing product
  const existingProduct = findProduct(existingProducts, productName);

  if (existingProduct) {
    // Product exists - check if price changed
    const oldPrice = parseFloat(existingProduct.price);

    if (Math.abs(newPrice - oldPrice) > 0.01) {
      // Price changed!
      Logger.log(`💰 Price change detected: ${productName}`);
      Logger.log(`   ${oldPrice} → ${newPrice} (${((newPrice - oldPrice) / oldPrice * 100).toFixed(2)}%)`);

      // Update supplier sheet
      updateProductPrice(supplierSheet, existingProduct.rowIndex, newPrice);

      // Add to price history
      addToPriceHistory(historySheet, supplierName, productName, newPrice, documentDate);
    } else {
      Logger.log(`✓ No price change: ${productName} (${newPrice})`);
    }
  } else {
    // New product - add to supplier sheet
    Logger.log(`✚ New product: ${productName} (${newPrice})`);
    addNewProduct(supplierSheet, productName, newPrice);

    // Add to price history (first entry)
    addToPriceHistory(historySheet, supplierName, productName, newPrice, documentDate);
  }
}

// ============================================================================
// SHEET OPERATIONS
// ============================================================================

/**
 * Get or create supplier sheet
 */
function getOrCreateSupplierSheet(ss, supplierName) {
  let sheet = ss.getSheetByName(supplierName);

  if (!sheet) {
    Logger.log(`Creating new supplier sheet: ${supplierName}`);
    sheet = ss.insertSheet(supplierName);

    // Add headers
    sheet.getRange('A1').setValue('שם מוצר');
    sheet.getRange('B1').setValue('מחיר נוכחי לפני מע״מ');

    // Format header
    const headerRange = sheet.getRange('A1:B1');
    headerRange.setFontWeight('bold');
    headerRange.setBackground('#4285f4');
    headerRange.setFontColor('#ffffff');
    headerRange.setHorizontalAlignment('center');

    // Set column widths
    sheet.setColumnWidth(1, 300); // Product name
    sheet.setColumnWidth(2, 150); // Price

    // Freeze header row
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * Get existing products from supplier sheet
 */
function getExistingProducts(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < PRODUCT_DATA_START_ROW) {
    return [];
  }

  const dataRange = sheet.getRange(PRODUCT_DATA_START_ROW, 1, lastRow - PRODUCT_DATA_START_ROW + 1, 2);
  const values = dataRange.getValues();

  const products = [];

  values.forEach((row, index) => {
    const name = row[0];
    const price = row[1];

    if (name && name.toString().trim() !== '') {
      products.push({
        name: name.toString().trim(),
        price: price,
        rowIndex: PRODUCT_DATA_START_ROW + index
      });
    }
  });

  return products;
}

/**
 * Find product in existing products list using fuzzy matching
 */
function findProduct(existingProducts, productName) {
  const normalized = normalizeProductName(productName);

  for (const existing of existingProducts) {
    const existingNormalized = normalizeProductName(existing.name);

    // Exact match
    if (normalized === existingNormalized) {
      return existing;
    }

    // Fuzzy match (85% similarity)
    const similarity = calculateSimilarity(normalized, existingNormalized);
    if (similarity > 0.85) {
      Logger.log(`   Fuzzy match: "${productName}" ≈ "${existing.name}" (${(similarity * 100).toFixed(0)}%)`);
      return existing;
    }
  }

  return null;
}

/**
 * Normalize product name for matching
 */
function normalizeProductName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')      // Multiple spaces → single space
    .replace(/[״׳'"]/g, '')    // Remove quotes
    .replace(/\./g, '')         // Remove dots
    .replace(/,/g, '');         // Remove commas
}

/**
 * Calculate similarity between two strings (0.0 to 1.0)
 * Uses Levenshtein distance algorithm
 */
function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (str1.includes(str2) || str2.includes(str1)) return 0.9;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

/**
 * Levenshtein distance algorithm
 */
function levenshteinDistance(str1, str2) {
  const matrix = [];

  for (let i = 0; i <= str2.length; i++) {
    matrix[i] = [i];
  }

  for (let j = 0; j <= str1.length; j++) {
    matrix[0][j] = j;
  }

  for (let i = 1; i <= str2.length; i++) {
    for (let j = 1; j <= str1.length; j++) {
      if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
        matrix[i][j] = matrix[i - 1][j - 1];
      } else {
        matrix[i][j] = Math.min(
          matrix[i - 1][j - 1] + 1,
          matrix[i][j - 1] + 1,
          matrix[i - 1][j] + 1
        );
      }
    }
  }

  return matrix[str2.length][str1.length];
}

/**
 * Update product price in supplier sheet
 */
function updateProductPrice(sheet, rowIndex, newPrice) {
  sheet.getRange(rowIndex, 2).setValue(newPrice);
}

/**
 * Add new product to supplier sheet
 */
function addNewProduct(sheet, productName, price) {
  const lastRow = sheet.getLastRow();
  const newRow = Math.max(lastRow + 1, PRODUCT_DATA_START_ROW);

  sheet.getRange(newRow, 1).setValue(productName);
  sheet.getRange(newRow, 2).setValue(price);
}

/**
 * Add entry to price history sheet
 */
function addToPriceHistory(sheet, supplierName, productName, price, documentDate) {
  const lastRow = sheet.getLastRow();
  const newRow = Math.max(lastRow + 1, PRODUCT_DATA_START_ROW);

  // Parse Israeli date (DD/MM/YYYY) to Google Sheets date
  const dateParts = documentDate.split('/');
  let dateValue = documentDate; // Default to string if parsing fails

  if (dateParts.length === 3) {
    const day = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1; // Month is 0-indexed
    const year = parseInt(dateParts[2]);
    dateValue = new Date(year, month, day);
  }

  // A2=Supplier, B2=Product, C2=Price, D2=Date
  sheet.getRange(newRow, 1).setValue(supplierName);
  sheet.getRange(newRow, 2).setValue(productName);
  sheet.getRange(newRow, 3).setValue(price);
  sheet.getRange(newRow, 4).setValue(dateValue);

  // Format date column
  sheet.getRange(newRow, 4).setNumberFormat('dd/mm/yyyy');

  Logger.log(`   📝 Added to price history: ${supplierName} | ${productName} | ${price} | ${documentDate}`);
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Initialize price history sheet with headers
 * Run this once to set up the sheet
 */
function initializePriceHistorySheet() {
  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PRICE_HISTORY_SHEET_NAME);
  }

  // Add headers
  sheet.getRange('A1').setValue('ספק');
  sheet.getRange('B1').setValue('מוצר');
  sheet.getRange('C1').setValue('מחיר לפני מע״מ');
  sheet.getRange('D1').setValue('תאריך');

  // Format header
  const headerRange = sheet.getRange('A1:D1');
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#34a853');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');

  // Set column widths
  sheet.setColumnWidth(1, 200); // Supplier
  sheet.setColumnWidth(2, 300); // Product
  sheet.setColumnWidth(3, 120); // Price
  sheet.setColumnWidth(4, 120); // Date

  // Freeze header row
  sheet.setFrozenRows(1);

  Logger.log('✅ Price history sheet initialized');
}
