/**
 * Product Tracking System - FIXED VERSION
 * Google Apps Script
 *
 * Spreadsheet ID: 1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
 *
 * FIXED ISSUES:
 * 1. Supplier sheets: UPDATE existing products, never duplicate rows
 * 2. Filter out products with price = 0
 * 3. Proper data types (no dates in price columns)
 * 4. History tracking works even with manual edits
 * 5. Manual testing works correctly
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const PRODUCTS_SPREADSHEET_ID = '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ';
const PRICE_HISTORY_SHEET_NAME = 'היסטוריית שינויי מחירים';
const PRODUCT_DATA_START_ROW = 2;

// Price changes larger than this fraction are treated as suspicious AI misreads.
// The price will NOT be updated and no email will be sent — only logged in history.
// Example: 0.35 = any change > 35% is flagged.
const SUSPICIOUS_CHANGE_THRESHOLD = 0.35;

// Email Configuration
const EMAIL_CONFIG = {
  recipient: 'edenpatis@gmail.com',
  sender: 'dolev.boch@gmail.com',
  subjectIncrease: 'זוזה פטיסרי מחירי ספקים: הייתה עליית מחיר למוצר',
  subjectDecrease: 'זוזה פטיסרי מחירי ספקים: הייתה ירידה מחיר למוצר',
};

// ============================================================================
// MAIN ENTRY POINT
// ============================================================================

function doPost(e) {
  try {
    Logger.log('📨 Received POST request');

    if (!e.postData || !e.postData.contents) {
      return ContentService.createTextOutput(
        JSON.stringify({ success: false, error: 'No post data' })
      ).setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(e.postData.contents);
    Logger.log('Supplier: ' + data.supplier_name);
    Logger.log('Products: ' + (data.products ? data.products.length : 0));

    if (data.products && data.products.length > 0) {
      processProducts(data);
      return ContentService.createTextOutput(JSON.stringify({ success: true })).setMimeType(
        ContentService.MimeType.JSON
      );
    }

    return ContentService.createTextOutput(
      JSON.stringify({ success: true, message: 'No products' })
    ).setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    Logger.log('❌ ERROR: ' + error.toString());
    return ContentService.createTextOutput(
      JSON.stringify({ success: false, error: error.toString() })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService.createTextOutput(
    JSON.stringify({ message: 'Product Tracking API - Use POST' })
  ).setMimeType(ContentService.MimeType.JSON);
}

/**
 * ✅ FIXED: Test function with proper data
 */
function testProcessProducts() {
  Logger.log('🧪 Starting test...');

  const testData = {
    supplier_name: 'מר קייק',
    document_date: '31/12/2024',
    products: [
      {
        name: 'קמח לבן',
        quantity: 10,
        unit: 'ק״ג',
        unit_price_before_vat: 3.5,
        total_before_vat: 35.0,
      },
      {
        name: 'שוקולד מריר',
        quantity: 5,
        unit: 'ק״ג',
        unit_price_before_vat: 45.0,
        total_before_vat: 225.0,
      },
    ],
  };

  processProducts(testData);
  Logger.log('✅ Test completed - check the sheets!');
}

function testEmailNotification() {
  sendPriceChangeEmail('מר קייק', 'קמח לבן', 3.5, 3.8, +8.57);
}

// ============================================================================
// PRODUCT PROCESSING
// ============================================================================

/**
 * ✅ FIXED: Process products with proper validation
 */
function processProducts(data) {
  const supplierName = data.supplier_name;
  const documentDate = data.document_date;
  const products = data.products || [];

  if (!supplierName) {
    Logger.log('⚠️ No supplier name');
    return;
  }

  if (products.length === 0) {
    Logger.log('⚠️ No products');
    return;
  }

  Logger.log(`\n${'='.repeat(60)}`);
  Logger.log(`Processing ${products.length} products for: ${supplierName}`);
  Logger.log(`${'='.repeat(60)}\n`);

  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
  const supplierSheet = getOrCreateSupplierSheet(ss, supplierName);
  const historySheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);

  if (!historySheet) {
    Logger.log('❌ History sheet not found!');
    return;
  }

  // Get existing products
  const existingProducts = getExistingProducts(supplierSheet);
  Logger.log(`Found ${existingProducts.length} existing products in ${supplierName} sheet`);

  // Process each product
  let processedCount = 0;
  let skippedCount = 0;

  products.forEach((product, index) => {
    Logger.log(`\n--- Product ${index + 1}/${products.length} ---`);

    const result = processProduct(
      supplierSheet,
      historySheet,
      existingProducts,
      product,
      supplierName,
      documentDate
    );

    if (result) {
      processedCount++;
    } else {
      skippedCount++;
    }
  });

  Logger.log(`\n${'='.repeat(60)}`);
  Logger.log(`✅ Completed: ${processedCount} processed, ${skippedCount} skipped`);
  Logger.log(`${'='.repeat(60)}\n`);
}

/**
 * ✅ FIXED: Process single product with proper validation and logic
 */
function processProduct(
  supplierSheet,
  historySheet,
  existingProducts,
  product,
  supplierName,
  documentDate
) {
  const productName = product.name;
  const newPrice = parseFloat(product.unit_price_before_vat);

  // ✅ FIX 1: Validate product name
  if (!productName || productName.toString().trim() === '') {
    Logger.log(`⚠️ Skipping: Empty product name`);
    return false;
  }

  // ✅ FIX 2: Validate price (must be > 0)
  if (isNaN(newPrice) || newPrice <= 0) {
    Logger.log(`⚠️ Skipping: "${productName}" - Invalid price (${product.unit_price_before_vat})`);
    return false;
  }

  Logger.log(`Product: ${productName}`);
  Logger.log(`New price: ₪${newPrice.toFixed(2)}`);

  // Find existing product
  const existingProduct = findProduct(existingProducts, productName);

  if (existingProduct) {
    // Product exists - check if price changed
    const oldPrice = parseFloat(existingProduct.price);

    Logger.log(`Found existing: ₪${oldPrice.toFixed(2)} at row ${existingProduct.rowIndex}`);

    if (Math.abs(newPrice - oldPrice) > 0.01) {
      const changeAmount  = newPrice - oldPrice;
      const changePercent = (changeAmount / oldPrice) * 100;
      const changeFraction = Math.abs(changeAmount) / oldPrice;

      Logger.log(`💰 PRICE CHANGE: ₪${oldPrice.toFixed(2)} → ₪${newPrice.toFixed(2)}`);
      Logger.log(
        `   Change: ${changeAmount >= 0 ? '+' : ''}₪${changeAmount.toFixed(2)} (${changePercent.toFixed(1)}%)`
      );

      // Sanity gate: changes above SUSPICIOUS_CHANGE_THRESHOLD are likely AI
      // misreads (wrong digit, missed discount, OCR error). Log to history for
      // manual review but do NOT update the stored price or send an email.
      if (changeFraction > SUSPICIOUS_CHANGE_THRESHOLD) {
        Logger.log(
          `⚠️ SUSPICIOUS: ${Math.abs(changePercent).toFixed(1)}% change exceeds ${(SUSPICIOUS_CHANGE_THRESHOLD * 100).toFixed(0)}% threshold — skipping update`
        );
        addToPriceHistory(
          historySheet, supplierName, productName, oldPrice, newPrice, documentDate,
          '⚠️ חשוד - לא עודכן (שינוי של ' + Math.abs(changePercent).toFixed(0) + '% — בדוק ידנית)'
        );
        return false;
      }

      // Legitimate change — update price, log, and notify
      updateProductPrice(supplierSheet, existingProduct.rowIndex, newPrice);
      addToPriceHistory(historySheet, supplierName, productName, oldPrice, newPrice, documentDate, '');
      sendPriceChangeEmail(supplierName, productName, oldPrice, newPrice, changePercent);

      return true;
    } else {
      Logger.log(`✓ No change (same price: ₪${newPrice.toFixed(2)})`);
      return true;
    }
  } else {
    // New product
    Logger.log(`✚ NEW PRODUCT: Adding at ₪${newPrice.toFixed(2)}`);

    // Add to supplier sheet
    addNewProduct(supplierSheet, productName, newPrice);

    // Add to price history (first entry)
    addToPriceHistory(historySheet, supplierName, productName, null, newPrice, documentDate);

    return true;
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
    Logger.log(`Creating new sheet: ${supplierName}`);
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

    sheet.setColumnWidth(1, 300);
    sheet.setColumnWidth(2, 150);
    sheet.setFrozenRows(1);
  }

  return sheet;
}

/**
 * ✅ FIXED: Get existing products with proper validation
 */
function getExistingProducts(sheet) {
  const lastRow = sheet.getLastRow();

  if (lastRow < PRODUCT_DATA_START_ROW) {
    return [];
  }

  const dataRange = sheet.getRange(
    PRODUCT_DATA_START_ROW,
    1,
    lastRow - PRODUCT_DATA_START_ROW + 1,
    2
  );
  const values = dataRange.getValues();

  const products = [];

  values.forEach((row, index) => {
    const name = row[0];
    const price = row[1];

    // ✅ FIX: Validate both name and price
    if (
      name &&
      name.toString().trim() !== '' &&
      !isNaN(parseFloat(price)) &&
      parseFloat(price) > 0
    ) {
      products.push({
        name: name.toString().trim(),
        price: parseFloat(price),
        rowIndex: PRODUCT_DATA_START_ROW + index,
      });
    }
  });

  return products;
}

/**
 * Find product using fuzzy matching
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
      Logger.log(
        `   Fuzzy match: "${productName}" ≈ "${existing.name}" (${(similarity * 100).toFixed(0)}%)`
      );
      return existing;
    }
  }

  return null;
}

function normalizeProductName(name) {
  return name
    .toLowerCase()
    .trim()
    .replace(/\s+/g, ' ')
    .replace(/[״׳'"]/g, '')
    .replace(/\./g, '')
    .replace(/,/g, '');
}

function calculateSimilarity(str1, str2) {
  if (str1 === str2) return 1.0;
  if (str1.includes(str2) || str2.includes(str1)) return 0.9;

  const longer = str1.length > str2.length ? str1 : str2;
  const shorter = str1.length > str2.length ? str2 : str1;

  if (longer.length === 0) return 1.0;

  const editDistance = levenshteinDistance(longer, shorter);
  return (longer.length - editDistance) / longer.length;
}

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
 * ✅ FIXED: Update existing product price (no duplicates)
 */
function updateProductPrice(sheet, rowIndex, newPrice) {
  // ✅ FIX: Set only column B (price), ensure it's a number
  sheet.getRange(rowIndex, 2).setValue(Number(newPrice));
  Logger.log(`   Updated row ${rowIndex}: ₪${newPrice.toFixed(2)}`);
}

/**
 * ✅ FIXED: Add new product to supplier sheet
 */
function addNewProduct(sheet, productName, price) {
  const lastRow = sheet.getLastRow();
  const newRow = Math.max(lastRow + 1, PRODUCT_DATA_START_ROW);

  // ✅ FIX: Set proper data types
  sheet.getRange(newRow, 1).setValue(String(productName));
  sheet.getRange(newRow, 2).setValue(Number(price));

  // Format price column
  sheet.getRange(newRow, 2).setNumberFormat('0.00');

  Logger.log(`   Added new row ${newRow}: ${productName} @ ₪${price.toFixed(2)}`);
}

/**
 * ✅ FIXED: Add entry to price history with proper data types
 * @param {string} note  Optional label (e.g. suspicious flag). Written to column H.
 */
function addToPriceHistory(sheet, supplierName, productName, oldPrice, newPrice, documentDate, note) {
  const lastRow = sheet.getLastRow();
  const newRow = Math.max(lastRow + 1, PRODUCT_DATA_START_ROW);

  // Parse date properly
  const dateParts = documentDate.split('/');
  let dateValue = new Date(); // Default to now

  if (dateParts.length === 3) {
    const day = parseInt(dateParts[0]);
    const month = parseInt(dateParts[1]) - 1;
    const year = parseInt(dateParts[2]);
    dateValue = new Date(year, month, day);
  }

  // Calculate change
  let changeAmount = '';
  let changePercent = '';
  let oldPriceDisplay = oldPrice ? Number(oldPrice) : '-';

  if (oldPrice && oldPrice > 0) {
    changeAmount = Number((newPrice - oldPrice).toFixed(2));
    changePercent = (((newPrice - oldPrice) / oldPrice) * 100).toFixed(1) + '%';
  }

  // ✅ FIX: Set proper data types for each column
  // Column A: Supplier (string)
  sheet.getRange(newRow, 1).setValue(String(supplierName));

  // Column B: Product (string)
  sheet.getRange(newRow, 2).setValue(String(productName));

  // Column C: Old Price (number or dash)
  if (oldPrice && oldPrice > 0) {
    sheet.getRange(newRow, 3).setValue(Number(oldPrice));
    sheet.getRange(newRow, 3).setNumberFormat('0.00');
  } else {
    sheet.getRange(newRow, 3).setValue('-');
  }

  // Column D: New Price (number)
  sheet.getRange(newRow, 4).setValue(Number(newPrice));
  sheet.getRange(newRow, 4).setNumberFormat('0.00');

  // Column E: Change Amount (number or empty)
  if (changeAmount !== '') {
    sheet.getRange(newRow, 5).setValue(Number(changeAmount));
    sheet.getRange(newRow, 5).setNumberFormat('0.00');
  } else {
    sheet.getRange(newRow, 5).setValue('');
  }

  // Column F: Change Percent (string)
  sheet.getRange(newRow, 6).setValue(changePercent);

  // Column G: Date (date object)
  sheet.getRange(newRow, 7).setValue(dateValue);
  sheet.getRange(newRow, 7).setNumberFormat('dd/mm/yyyy');

  // Color coding
  if (changeAmount !== '' && changeAmount !== 0) {
    const changeCell = sheet.getRange(newRow, 5);
    const percentCell = sheet.getRange(newRow, 6);

    if (changeAmount > 0) {
      changeCell.setFontColor('#c53929');
      percentCell.setFontColor('#c53929');
    } else {
      changeCell.setFontColor('#0f9d58');
      percentCell.setFontColor('#0f9d58');
    }
  }

  // Column H: optional note (e.g. suspicious flag)
  if (note) {
    sheet.getRange(newRow, 8).setValue(note);
    // Highlight entire suspicious row in orange so it stands out
    sheet.getRange(newRow, 1, 1, 8).setBackground('#fff3e0');
    sheet.getRange(newRow, 8).setFontColor('#e65100').setFontWeight('bold');
  }

  Logger.log(`   📝 History: ${supplierName} | ${productName} | ${oldPriceDisplay} → ${newPrice}${note ? ' [' + note + ']' : ''}`);
}

// ============================================================================
// EMAIL NOTIFICATION
// ============================================================================

function sendPriceChangeEmail(supplierName, productName, oldPrice, newPrice, changePercent) {
  try {
    const isIncrease = newPrice > oldPrice;
    const changeAmount = Math.abs(newPrice - oldPrice).toFixed(2);
    const changeSign = isIncrease ? '+' : '-';
    const changeDirection = isIncrease ? 'עלייה' : 'ירידה';
    const changeIcon = isIncrease ? '📈' : '📉';

    const subject = isIncrease ? EMAIL_CONFIG.subjectIncrease : EMAIL_CONFIG.subjectDecrease;

    const htmlBody = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head>
        <meta charset="UTF-8">
        <style>
          body {
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif;
            direction: rtl;
            text-align: right;
            background-color: #f5f5f5;
            margin: 0;
            padding: 20px;
          }
          .container {
            max-width: 600px;
            margin: 0 auto;
            background-color: white;
            border-radius: 8px;
            box-shadow: 0 2px 4px rgba(0,0,0,0.1);
            overflow: hidden;
          }
          .header {
            background-color: ${isIncrease ? '#c53929' : '#0f9d58'};
            color: white;
            padding: 20px;
            text-align: center;
          }
          .content {
            padding: 30px;
          }
          .info-box {
            background-color: #f9f9f9;
            border-right: 4px solid ${isIncrease ? '#c53929' : '#0f9d58'};
            padding: 15px;
            margin: 20px 0;
          }
          .price-change {
            text-align: center;
            margin: 30px 0;
            padding: 20px;
            background-color: ${isIncrease ? '#ffebee' : '#e8f5e9'};
            border-radius: 4px;
          }
          .price-old {
            font-size: 18px;
            color: #888;
            text-decoration: line-through;
          }
          .price-new {
            font-size: 28px;
            font-weight: bold;
            color: ${isIncrease ? '#c53929' : '#0f9d58'};
          }
          .change-amount {
            font-size: 20px;
            font-weight: bold;
            color: ${isIncrease ? '#c53929' : '#0f9d58'};
            margin-top: 10px;
          }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <h1>${changeIcon} ${changeDirection} במחיר מוצר</h1>
          </div>
          <div class="content">
            <p>שלום,</p>
            <p>זוהה שינוי מחיר במוצר מהספק <strong>${supplierName}</strong>.</p>
            <div class="info-box">
              <p><strong>ספק:</strong> ${supplierName}</p>
              <p><strong>מוצר:</strong> ${productName}</p>
              <p><strong>תאריך:</strong> ${Utilities.formatDate(
                new Date(),
                Session.getScriptTimeZone(),
                'dd/MM/yyyy HH:mm'
              )}</p>
            </div>
            <div class="price-change">
              <div class="price-old">₪${oldPrice.toFixed(2)}</div>
              <div style="font-size: 24px; margin: 10px 0;">↓</div>
              <div class="price-new">₪${newPrice.toFixed(2)}</div>
              <div class="change-amount">
                ${changeSign}₪${changeAmount} (${changeSign}${Math.abs(changePercent).toFixed(1)}%)
              </div>
            </div>
            <p style="color: #666;">
              ${isIncrease ? '⚠️ מחיר המוצר עלה.' : '✅ מחיר המוצר ירד.'}
            </p>
          </div>
        </div>
      </body>
      </html>
    `;

    const plainBody = `
זוזה פטיסרי - ${changeDirection} במחיר מוצר

ספק: ${supplierName}
מוצר: ${productName}

מחיר קודם: ₪${oldPrice.toFixed(2)}
מחיר חדש: ₪${newPrice.toFixed(2)}
שינוי: ${changeSign}₪${changeAmount} (${changeSign}${Math.abs(changePercent).toFixed(1)}%)
    `;

    MailApp.sendEmail({
      to: EMAIL_CONFIG.recipient,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody,
      name: 'זוזה פטיסרי - מעקב מחירים',
    });

    Logger.log(`📧 Email sent: ${changeDirection} - ${productName}`);
  } catch (error) {
    Logger.log(`❌ Email failed: ${error.toString()}`);
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function initializePriceHistorySheet() {
  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(PRICE_HISTORY_SHEET_NAME);
  }

  sheet.getRange('A1').setValue('ספק');
  sheet.getRange('B1').setValue('מוצר');
  sheet.getRange('C1').setValue('מחיר קודם');
  sheet.getRange('D1').setValue('מחיר חדש');
  sheet.getRange('E1').setValue('שינוי (₪)');
  sheet.getRange('F1').setValue('שינוי (%)');
  sheet.getRange('G1').setValue('תאריך');

  const headerRange = sheet.getRange('A1:G1');
  headerRange.setFontWeight('bold');
  headerRange.setBackground('#34a853');
  headerRange.setFontColor('#ffffff');
  headerRange.setHorizontalAlignment('center');

  sheet.setColumnWidth(1, 150);
  sheet.setColumnWidth(2, 250);
  sheet.setColumnWidth(3, 100);
  sheet.setColumnWidth(4, 100);
  sheet.setColumnWidth(5, 100);
  sheet.setColumnWidth(6, 100);
  sheet.setColumnWidth(7, 120);

  sheet.setFrozenRows(1);

  Logger.log('✅ History sheet initialized');
}
