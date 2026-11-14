/**
 * Product Tracking System
 * Google Apps Script
 *
 * Spreadsheet ID: 1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
 *
 * Supplier sheet columns:
 *   A  שם מוצר
 *   B  מחיר נוכחי לפני מע״מ   (last price paid, after discount)
 *   C  הערות                    ("הנחה נרשמה עבור מוצר זה (10% הנחה)" when B is a discounted price)
 *   D  מחיר רגיל אחרון          (last price WITHOUT discount — used for real price-change alerts)
 *
 * Discount rules:
 *   regular → regular     : normal compare + email on change
 *   discount → discount   : normal compare + email on change (note updated)
 *   discount → regular    : B updated, note cleared. Email only if the new regular price
 *                           differs from the last known regular price (column D). Never an
 *                           "increase" alert just because the discount ended.
 *   regular → discount    : B updated + note. No email (a discount is not a price change).
 */

// ============================================================================
// CONFIGURATION
// ============================================================================

const PRODUCTS_SPREADSHEET_ID = '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ';
const PRICE_HISTORY_SHEET_NAME = 'היסטוריית שינויי מחירים';
const PRODUCT_DATA_START_ROW = 2;

const COL_NAME = 1;
const COL_PRICE = 2;
const COL_NOTES = 3;
const COL_REGULAR = 4;

const DISCOUNT_NOTE = 'הנחה נרשמה עבור מוצר זה';

// Minimum similarity for treating an invoice product name as an existing product
const PRODUCT_MATCH_THRESHOLD = 0.8;

// Price changes larger than this fraction are treated as suspicious AI misreads.
// The price will NOT be updated and no email will be sent — only logged in history.
const SUSPICIOUS_CHANGE_THRESHOLD = 0.35;

// Email Configuration
const EMAIL_CONFIG = {
  recipient: 'edenpatis@gmail.com',
  sender: 'dolev.boch@gmail.com',
  subjectIncrease: 'זוזה פטיסרי מחירי ספקים: הייתה עליית מחיר למוצר',
  subjectDecrease: 'זוזה פטיסרי מחירי ספקים: הייתה ירידה מחיר למוצר',
};

// ============================================================================
// ENTRY POINTS
// ============================================================================

function doPost(e) {
  try {
    if (!e.postData || !e.postData.contents) {
      return jsonOut({ success: false, error: 'No post data' });
    }

    const data = JSON.parse(e.postData.contents);
    Logger.log('Supplier: ' + data.supplier_name + ' | Products: ' + (data.products ? data.products.length : 0));

    if (data.products && data.products.length > 0) {
      const lock = LockService.getScriptLock();
      lock.waitLock(30000); // two invoices at once must not create duplicate rows
      try {
        processProducts(data);
      } finally {
        lock.releaseLock();
      }
      return jsonOut({ success: true });
    }

    return jsonOut({ success: true, message: 'No products' });
  } catch (error) {
    Logger.log('❌ ERROR: ' + error.toString());
    return jsonOut({ success: false, error: error.toString() });
  }
}

/**
 * GET ?action=catalog&supplier=NAME
 * Returns the supplier's existing products so the app can map invoice names to them.
 */
function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.action === 'catalog') {
    try {
      const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
      const sheet = findSupplierSheet(ss, params.supplier || '');
      if (!sheet) return jsonOut({ success: true, sheet_name: null, products: [] });
      const products = getExistingProducts(sheet).map(function (p) {
        return { name: p.name, price: p.price, note: p.note };
      });
      return jsonOut({ success: true, sheet_name: sheet.getName(), products: products });
    } catch (err) {
      return jsonOut({ success: false, error: err.toString() });
    }
  }
  return jsonOut({ message: 'Product Tracking API - Use POST' });
}

function jsonOut(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ============================================================================
// TESTS (run manually from the editor)
// ============================================================================

function testProcessProducts() {
  processProducts({
    supplier_name: 'מר קייק',
    document_date: '31/12/2025',
    products: [
      { name: 'קמח לבן', quantity: 10, unit: 'ק״ג', unit_price_before_vat: 3.5, total_before_vat: 35.0 },
      {
        name: 'שוקולד מריר', quantity: 5, unit: 'ק״ג', unit_price_before_vat: 40.5, total_before_vat: 202.5,
        discount_applied: true, discount_percent: 10, price_before_discount: 45,
      },
    ],
  });
}

function testProductMatching() {
  const cases = [
    ['שמנת 38% 1 ליטר', 'שמנת 38% 1ל'],
    ['גבינה צפתית 5%', 'גב צפתית 5%'],
    ['חלב 3%', 'חלב 1%'],
    ['שמנת ק"ג טבעי', 'שמנת טבעי ק״ג'],
    ['חמאה', 'חמאה מלוחה'],
    ['קופסה 500', 'קופסה 750'],
  ];
  cases.forEach(function (c) {
    Logger.log(c[0] + '  vs  ' + c[1] + '  →  ' + productNameScore(c[0], c[1]).toFixed(2));
  });
}

function testEmailNotification() {
  sendPriceChangeEmail('מר קייק', 'קמח לבן', 3.5, 3.8, +8.57, '');
}

// ============================================================================
// PRODUCT PROCESSING
// ============================================================================

function processProducts(data) {
  const supplierName = data.supplier_name;
  const documentDate = data.document_date || '';
  const products = data.products || [];

  if (!supplierName || products.length === 0) {
    Logger.log('⚠️ Missing supplier or products');
    return;
  }

  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
  const supplierSheet = getOrCreateSupplierSheet(ss, supplierName);
  const sheetSupplierName = supplierSheet.getName();
  const historySheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);

  if (!historySheet) {
    Logger.log('❌ History sheet not found!');
    return;
  }

  ensureSupplierHeaders(supplierSheet);
  ensureHistoryHeaders(historySheet);

  const existingProducts = getExistingProducts(supplierSheet);
  Logger.log('Found ' + existingProducts.length + ' existing products in ' + sheetSupplierName);

  let processed = 0;
  products.forEach(function (product) {
    if (processProduct(supplierSheet, historySheet, existingProducts, product, sheetSupplierName, documentDate)) {
      processed++;
    }
  });
  Logger.log('✅ Completed: ' + processed + '/' + products.length + ' processed');
}

function buildDiscountNote(product) {
  const pct = parseFloat(product.discount_percent);
  return !isNaN(pct) && pct > 0 ? DISCOUNT_NOTE + ' (' + formatPct(pct) + '% הנחה)' : DISCOUNT_NOTE;
}

function formatPct(p) {
  return Math.round(p * 10) / 10;
}

/**
 * Process one product line
 */
function processProduct(supplierSheet, historySheet, existingProducts, product, supplierName, documentDate) {
  const productName = product.name ? String(product.name).trim() : '';
  const newPrice = parseFloat(product.unit_price_before_vat);
  const isDiscount = product.discount_applied === true || product.discount_applied === 'true';

  if (!productName) return false;
  if (isNaN(newPrice) || newPrice <= 0) {
    Logger.log('⚠️ Skipping "' + productName + '" - invalid price');
    return false;
  }

  const existing = findProduct(existingProducts, productName, product.catalog_name);

  // ---------------------------------------------------------------- new product
  if (!existing) {
    const note = isDiscount ? buildDiscountNote(product) : '';
    const regular = isDiscount ? '' : newPrice;
    const row = addNewProduct(supplierSheet, productName, newPrice, note, regular);
    existingProducts.push({
      name: productName, price: newPrice, note: note, regularPrice: regular === '' ? null : regular,
      isDiscount: isDiscount, rowIndex: row,
    });
    addToPriceHistory(historySheet, supplierName, productName, null, newPrice, documentDate,
      isDiscount ? note : '');
    return true;
  }

  // ----------------------------------------------------------- existing product
  const oldPrice = existing.price;
  const wasDiscount = existing.isDiscount;
  const name = existing.name; // keep the catalog's name everywhere
  Logger.log('"' + productName + '" → "' + name + '" ₪' + oldPrice + ' → ₪' + newPrice +
             (wasDiscount ? ' [was discount]' : '') + (isDiscount ? ' [discount]' : ''));

  // regular → discount: record the discounted price, no alert
  if (!wasDiscount && isDiscount) {
    const note = buildDiscountNote(product);
    updateProductRow(supplierSheet, existing, newPrice, note, oldPrice);
    addToPriceHistory(historySheet, supplierName, name, oldPrice, newPrice, documentDate, note);
    return true;
  }

  // discount → regular: discount ended. Compare against the last REGULAR price only.
  if (wasDiscount && !isDiscount) {
    const lastRegular = existing.regularPrice;
    if (lastRegular && Math.abs(newPrice - lastRegular) > 0.01) {
      return notifyIfLegit(historySheet, supplierSheet, existing, supplierName, name,
        lastRegular, newPrice, documentDate, 'מחיר רגיל לעומת המחיר הרגיל הקודם (לפני ההנחה)', false);
    }
    updateProductRow(supplierSheet, existing, newPrice, '', newPrice);
    addToPriceHistory(historySheet, supplierName, name, oldPrice, newPrice, documentDate,
      'מחיר רגיל — ההנחה הקודמת הסתיימה (לא עליית מחיר)');
    return true;
  }

  // regular → regular  OR  discount → discount
  if (Math.abs(newPrice - oldPrice) <= 0.01) {
    if (isDiscount) {
      const note = buildDiscountNote(product);
      if (note !== existing.note) {
        supplierSheet.getRange(existing.rowIndex, COL_NOTES).setValue(note);
        existing.note = note;
      }
    }
    return true;
  }

  return notifyIfLegit(historySheet, supplierSheet, existing, supplierName, name, oldPrice, newPrice,
    documentDate, isDiscount ? buildDiscountNote(product) : '', isDiscount);
}

/**
 * Real price change: apply the sanity gate, then update + history + email.
 */
function notifyIfLegit(historySheet, supplierSheet, existing, supplierName, name, oldPrice, newPrice,
                       documentDate, note, isDiscount) {
  const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

  if (Math.abs(newPrice - oldPrice) / oldPrice > SUSPICIOUS_CHANGE_THRESHOLD) {
    addToPriceHistory(historySheet, supplierName, name, oldPrice, newPrice, documentDate,
      '⚠️ חשוד - לא עודכן (שינוי של ' + Math.abs(changePercent).toFixed(0) + '% — בדוק ידנית)', true);
    return false;
  }

  if (isDiscount) {
    updateProductRow(supplierSheet, existing, newPrice, note, null);
  } else {
    updateProductRow(supplierSheet, existing, newPrice, '', newPrice);
  }
  addToPriceHistory(historySheet, supplierName, name, oldPrice, newPrice, documentDate, note);
  sendPriceChangeEmail(supplierName, name, oldPrice, newPrice, changePercent, isDiscount ? note : '');
  return true;
}

// ============================================================================
// SHEET OPERATIONS
// ============================================================================

/**
 * Existing sheet whose name is (with high probability) this supplier — typo tolerant.
 */
function findSupplierSheet(ss, supplierName) {
  if (!supplierName) return null;
  const exact = ss.getSheetByName(supplierName);
  if (exact) return exact;
  const names = ss.getSheets()
    .map(function (s) { return s.getName(); })
    .filter(function (n) { return n !== PRICE_HISTORY_SHEET_NAME; });
  const match = findBestSupplierMatch_(supplierName, names, 0.82);
  if (match) {
    Logger.log('🔗 Supplier "' + supplierName + '" → existing sheet "' + match.name + '" (' + match.score.toFixed(2) + ')');
    return ss.getSheetByName(match.name);
  }
  return null;
}

function getOrCreateSupplierSheet(ss, supplierName) {
  let sheet = findSupplierSheet(ss, supplierName);
  if (!sheet) {
    Logger.log('Creating new sheet: ' + supplierName);
    sheet = ss.insertSheet(supplierName);
    sheet.setColumnWidth(1, 300);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 260);
    sheet.setColumnWidth(4, 150);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSupplierHeaders(sheet) {
  const headers = ['שם מוצר', 'מחיר נוכחי לפני מע״מ', 'הערות', 'מחיר רגיל אחרון (ללא הנחה)'];
  const current = sheet.getRange(1, 1, 1, 4).getValues()[0];
  let changed = false;
  for (let i = 0; i < 4; i++) {
    if (!current[i]) { sheet.getRange(1, i + 1).setValue(headers[i]); changed = true; }
  }
  if (changed) {
    sheet.getRange(1, 1, 1, 4).setFontWeight('bold').setBackground('#4285f4')
      .setFontColor('#ffffff').setHorizontalAlignment('center');
  }
}

function ensureHistoryHeaders(sheet) {
  if (!sheet.getRange(1, 8).getValue()) {
    sheet.getRange(1, 8).setValue('הערות').setFontWeight('bold').setBackground('#34a853')
      .setFontColor('#ffffff').setHorizontalAlignment('center');
  }
}

function getExistingProducts(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow < PRODUCT_DATA_START_ROW) return [];

  const values = sheet.getRange(PRODUCT_DATA_START_ROW, 1, lastRow - PRODUCT_DATA_START_ROW + 1, 4).getValues();
  const products = [];
  values.forEach(function (row, index) {
    const name = row[0];
    const price = parseFloat(row[1]);
    if (!name || String(name).trim() === '' || isNaN(price) || price <= 0) return;
    const note = row[2] ? String(row[2]) : '';
    const isDiscount = note.indexOf(DISCOUNT_NOTE) !== -1;
    let regular = parseFloat(row[3]);
    if (isNaN(regular) || regular <= 0) regular = isDiscount ? null : price;
    products.push({
      name: String(name).trim(),
      price: price,
      note: note,
      isDiscount: isDiscount,
      regularPrice: regular,
      rowIndex: PRODUCT_DATA_START_ROW + index,
    });
  });
  return products;
}

/**
 * Find the existing product for an invoice line.
 *  1. catalog_name chosen by the AI matching step (if it exists in the sheet and
 *     doesn't conflict in sizes/percentages)
 *  2. Otherwise the BEST fuzzy match above PRODUCT_MATCH_THRESHOLD (not the first one)
 */
function findProduct(existingProducts, productName, catalogName) {
  if (catalogName) {
    const target = normalizeProductName(catalogName);
    for (let i = 0; i < existingProducts.length; i++) {
      const p = existingProducts[i];
      if (normalizeProductName(p.name) === target && !numbersConflict(productName, p.name)) {
        return p;
      }
    }
  }

  let best = null;
  let bestScore = 0;
  existingProducts.forEach(function (p) {
    const s = productNameScore(productName, p.name);
    if (s > bestScore) { bestScore = s; best = p; }
  });

  if (best && bestScore >= PRODUCT_MATCH_THRESHOLD) {
    if (bestScore < 1) Logger.log('   Fuzzy match: "' + productName + '" ≈ "' + best.name + '" (' + bestScore.toFixed(2) + ')');
    return best;
  }
  return null;
}

/**
 * Normalize a product name: final letters, punctuation, unit spellings, and
 * numbers separated from letters ("1ל" → "1 ליטר", "ק"ג" → "קג").
 */
function normalizeProductName(name) {
  return String(name || '')
    .toLowerCase()
    .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
    .replace(/["'״׳`]/g, '')
    .replace(/[,()\[\]\-_\/\\+*:]/g, ' ')
    .replace(/(\D)\.|\.(\D)/g, '$1 $2')
    .replace(/(\d)([^\d\s%.])/g, '$1 $2')
    .replace(/([^\d\s.])(\d)/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
    .split(' ')
    .map(function (t) {
      if (t === 'קילו' || t === 'קג' || t === 'kg') return 'קג';
      if (t === 'ל' || t === 'ליט' || t === 'ליטר' || t === 'lt' || t === 'l') return 'ליטר';
      if (t === 'גר' || t === 'גרמ' || t === 'g' || t === 'gr') return 'גרמ';
      if (t === 'מל' || t === 'ml') return 'מל';
      if (t === 'יח' || t === 'יחידות' || t === 'יחידה') return 'יח';
      return t;
    })
    .filter(String)
    .join(' ');
}

function extractNumbers(normalized) {
  return (normalized.match(/\d+(?:\.\d+)?/g) || []).map(function (n) { return String(parseFloat(n)); });
}

/** True when both names carry numbers and each has a number the other lacks (3% vs 1%, 500 vs 750) */
function numbersConflict(a, b) {
  const na = extractNumbers(normalizeProductName(a));
  const nb = extractNumbers(normalizeProductName(b));
  if (na.length === 0 || nb.length === 0) return false;
  const onlyA = na.some(function (n) { return nb.indexOf(n) === -1; });
  const onlyB = nb.some(function (n) { return na.indexOf(n) === -1; });
  return onlyA && onlyB;
}

/**
 * 0..1 similarity between two product names. Word-order insensitive, tolerant
 * to abbreviations/typos, but never matches different sizes or percentages.
 */
function productNameScore(a, b) {
  const na = normalizeProductName(a);
  const nb = normalizeProductName(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (numbersConflict(a, b)) return 0;

  // A bare unit word ("ריקוטה ק"ג") carries no identity — ignore it unless it follows a number
  const UNITS = ['קג', 'ליטר', 'גרמ', 'מל', 'יח'];
  function meaningful(tokens) {
    const out = tokens.filter(function (t, i) {
      return UNITS.indexOf(t) === -1 || (i > 0 && /^\d/.test(tokens[i - 1]));
    });
    return out.length ? out : tokens;
  }
  const ta = meaningful(na.split(' '));
  const tb = meaningful(nb.split(' '));
  if (ta.join(' ') === tb.join(' ')) return 0.97;

  // Same words, different order
  const sortedA = ta.slice().sort().join(' ');
  const sortedB = tb.slice().sort().join(' ');
  if (sortedA === sortedB) return 0.98;

  const whole = stringSimilarity_(sortedA, sortedB);

  // Fuzzy token Dice coefficient (abbreviation "גב" ≈ "גבינה" counts as a match)
  function tokenSim(t, u) {
    if (t === u) return 1;
    if (/^\d/.test(t) || /^\d/.test(u)) return 0;
    if (t.length >= 2 && u.length >= 3 && (u.indexOf(t) === 0 || t.indexOf(u) === 0)) return 0.85;
    return Math.min(t.length, u.length) >= 3 ? stringSimilarity_(t, u) : 0;
  }
  function matchedWeight(src, dst) {
    let sum = 0;
    src.forEach(function (t) {
      let best = 0;
      dst.forEach(function (u) { const s = tokenSim(t, u); if (s > best) best = s; });
      if (best >= 0.75) sum += best;
    });
    return sum;
  }
  const dice = (matchedWeight(ta, tb) + matchedWeight(tb, ta)) / (ta.length + tb.length);

  return Math.max(whole, dice);
}

/**
 * Update price / note / last regular price of an existing row (and the in-memory copy).
 * regularPrice === null → leave column D as is.
 */
function updateProductRow(sheet, existing, newPrice, note, regularPrice) {
  sheet.getRange(existing.rowIndex, COL_PRICE).setValue(Number(newPrice)).setNumberFormat('0.00');
  sheet.getRange(existing.rowIndex, COL_NOTES).setValue(note || '');
  if (regularPrice !== null && regularPrice !== undefined && regularPrice !== '') {
    sheet.getRange(existing.rowIndex, COL_REGULAR).setValue(Number(regularPrice)).setNumberFormat('0.00');
    existing.regularPrice = Number(regularPrice);
  }
  existing.price = Number(newPrice);
  existing.note = note || '';
  existing.isDiscount = !!note && note.indexOf(DISCOUNT_NOTE) !== -1;
}

function addNewProduct(sheet, productName, price, note, regularPrice) {
  const newRow = Math.max(sheet.getLastRow() + 1, PRODUCT_DATA_START_ROW);
  sheet.getRange(newRow, COL_NAME).setValue(String(productName));
  sheet.getRange(newRow, COL_PRICE).setValue(Number(price)).setNumberFormat('0.00');
  if (note) sheet.getRange(newRow, COL_NOTES).setValue(note);
  if (regularPrice !== '' && regularPrice !== null && regularPrice !== undefined) {
    sheet.getRange(newRow, COL_REGULAR).setValue(Number(regularPrice)).setNumberFormat('0.00');
  }
  Logger.log('   Added new row ' + newRow + ': ' + productName + ' @ ₪' + Number(price).toFixed(2) + (note ? ' [' + note + ']' : ''));
  return newRow;
}

/**
 * Add entry to price history
 * @param {string} note  Optional note → column H
 * @param {boolean} highlight  Orange highlight (suspicious rows)
 */
function addToPriceHistory(sheet, supplierName, productName, oldPrice, newPrice, documentDate, note, highlight) {
  const newRow = Math.max(sheet.getLastRow() + 1, PRODUCT_DATA_START_ROW);

  const dateParts = String(documentDate || '').split('/');
  let dateValue = new Date();
  if (dateParts.length === 3) {
    dateValue = new Date(parseInt(dateParts[2], 10), parseInt(dateParts[1], 10) - 1, parseInt(dateParts[0], 10));
  }

  let changeAmount = '';
  let changePercent = '';
  if (oldPrice && oldPrice > 0) {
    changeAmount = Number((newPrice - oldPrice).toFixed(2));
    changePercent = (((newPrice - oldPrice) / oldPrice) * 100).toFixed(1) + '%';
  }

  sheet.getRange(newRow, 1).setValue(String(supplierName));
  sheet.getRange(newRow, 2).setValue(String(productName));
  if (oldPrice && oldPrice > 0) {
    sheet.getRange(newRow, 3).setValue(Number(oldPrice)).setNumberFormat('0.00');
  } else {
    sheet.getRange(newRow, 3).setValue('-');
  }
  sheet.getRange(newRow, 4).setValue(Number(newPrice)).setNumberFormat('0.00');
  sheet.getRange(newRow, 5).setValue(changeAmount === '' ? '' : Number(changeAmount));
  if (changeAmount !== '') sheet.getRange(newRow, 5).setNumberFormat('0.00');
  sheet.getRange(newRow, 6).setValue(changePercent);
  sheet.getRange(newRow, 7).setValue(dateValue).setNumberFormat('dd/mm/yyyy');

  if (changeAmount !== '' && changeAmount !== 0) {
    const color = changeAmount > 0 ? '#c53929' : '#0f9d58';
    sheet.getRange(newRow, 5, 1, 2).setFontColor(color);
  }

  if (note) {
    sheet.getRange(newRow, 8).setValue(note);
    if (highlight) {
      sheet.getRange(newRow, 1, 1, 8).setBackground('#fff3e0');
      sheet.getRange(newRow, 8).setFontColor('#e65100').setFontWeight('bold');
    }
  }

  Logger.log('   📝 History: ' + supplierName + ' | ' + productName + ' | ' + (oldPrice || '-') + ' → ' + newPrice + (note ? ' [' + note + ']' : ''));
}

// ============================================================================
// EMAIL NOTIFICATION
// ============================================================================

function sendPriceChangeEmail(supplierName, productName, oldPrice, newPrice, changePercent, discountNote) {
  try {
    const isIncrease = newPrice > oldPrice;
    const changeAmount = Math.abs(newPrice - oldPrice).toFixed(2);
    const changeSign = isIncrease ? '+' : '-';
    const changeDirection = isIncrease ? 'עלייה' : 'ירידה';
    const changeIcon = isIncrease ? '📈' : '📉';
    const color = isIncrease ? '#c53929' : '#0f9d58';
    const subject = isIncrease ? EMAIL_CONFIG.subjectIncrease : EMAIL_CONFIG.subjectDecrease;
    const discountLine = discountNote ? '<p><strong>הערה:</strong> ' + discountNote + '</p>' : '';

    const htmlBody = `
      <!DOCTYPE html>
      <html dir="rtl" lang="he">
      <head><meta charset="UTF-8"></head>
      <body style="font-family: 'Segoe UI', Tahoma, sans-serif; direction: rtl; text-align: right; background:#f5f5f5; margin:0; padding:20px;">
        <div style="max-width:600px; margin:0 auto; background:#fff; border-radius:8px; overflow:hidden;">
          <div style="background:${color}; color:#fff; padding:20px; text-align:center;">
            <h1>${changeIcon} ${changeDirection} במחיר מוצר</h1>
          </div>
          <div style="padding:30px;">
            <p>שלום,</p>
            <p>זוהה שינוי מחיר במוצר מהספק <strong>${supplierName}</strong>.</p>
            <div style="background:#f9f9f9; border-right:4px solid ${color}; padding:15px; margin:20px 0;">
              <p><strong>ספק:</strong> ${supplierName}</p>
              <p><strong>מוצר:</strong> ${productName}</p>
              ${discountLine}
              <p><strong>תאריך:</strong> ${Utilities.formatDate(new Date(), Session.getScriptTimeZone(), 'dd/MM/yyyy HH:mm')}</p>
            </div>
            <div style="text-align:center; margin:30px 0; padding:20px; background:${isIncrease ? '#ffebee' : '#e8f5e9'}; border-radius:4px;">
              <div style="font-size:18px; color:#888; text-decoration:line-through;">₪${oldPrice.toFixed(2)}</div>
              <div style="font-size:24px; margin:10px 0;">↓</div>
              <div style="font-size:28px; font-weight:bold; color:${color};">₪${newPrice.toFixed(2)}</div>
              <div style="font-size:20px; font-weight:bold; color:${color}; margin-top:10px;">
                ${changeSign}₪${changeAmount} (${changeSign}${Math.abs(changePercent).toFixed(1)}%)
              </div>
            </div>
          </div>
        </div>
      </body>
      </html>`;

    const plainBody =
      'זוזה פטיסרי - ' + changeDirection + ' במחיר מוצר\n\n' +
      'ספק: ' + supplierName + '\nמוצר: ' + productName + '\n' +
      (discountNote ? 'הערה: ' + discountNote + '\n' : '') +
      '\nמחיר קודם: ₪' + oldPrice.toFixed(2) + '\nמחיר חדש: ₪' + newPrice.toFixed(2) +
      '\nשינוי: ' + changeSign + '₪' + changeAmount + ' (' + changeSign + Math.abs(changePercent).toFixed(1) + '%)';

    MailApp.sendEmail({
      to: EMAIL_CONFIG.recipient,
      subject: subject,
      body: plainBody,
      htmlBody: htmlBody,
      name: 'זוזה פטיסרי - מעקב מחירים',
    });

    Logger.log('📧 Email sent: ' + changeDirection + ' - ' + productName);
  } catch (error) {
    Logger.log('❌ Email failed: ' + error.toString());
  }
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

function initializePriceHistorySheet() {
  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PRICE_HISTORY_SHEET_NAME);
  if (!sheet) sheet = ss.insertSheet(PRICE_HISTORY_SHEET_NAME);

  const headers = ['ספק', 'מוצר', 'מחיר קודם', 'מחיר חדש', 'שינוי (₪)', 'שינוי (%)', 'תאריך', 'הערות'];
  sheet.getRange(1, 1, 1, headers.length).setValues([headers])
    .setFontWeight('bold').setBackground('#34a853').setFontColor('#ffffff').setHorizontalAlignment('center');
  [150, 250, 100, 100, 100, 100, 120, 300].forEach(function (w, i) { sheet.setColumnWidth(i + 1, w); });
  sheet.setFrozenRows(1);
  Logger.log('✅ History sheet initialized');
}

// ============================================================================
// SUPPLIER NAME MATCHING (shared logic — same copy in main-invoice-script.gs,
// drive-upload.gs and products-tracking2.gs; keep them in sync)
// ============================================================================

/** Normalize a supplier name: no בע"מ/ltd, no punctuation, no final-letter differences */
function normalizeSupplierName_(text) {
  if (!text) return '';
  return String(text)
    .toLowerCase()
    .replace(/בע["״׳'\s]*מ/g, ' ')
    .replace(/\b(ltd|inc|co)\b\.?/g, ' ')
    .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
    .replace(/["'״׳`\(\)\[\]\.,\-_\/\:;!?]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function levenshtein_(a, b) {
  const m = [];
  for (let i = 0; i <= b.length; i++) m[i] = [i];
  for (let j = 0; j <= a.length; j++) m[0][j] = j;
  for (let i = 1; i <= b.length; i++) {
    for (let j = 1; j <= a.length; j++) {
      m[i][j] = b.charAt(i - 1) === a.charAt(j - 1)
        ? m[i - 1][j - 1]
        : Math.min(m[i - 1][j - 1] + 1, m[i][j - 1] + 1, m[i - 1][j] + 1);
    }
  }
  return m[b.length][a.length];
}

function stringSimilarity_(a, b) {
  const longer = a.length >= b.length ? a : b;
  const shorter = a.length >= b.length ? b : a;
  if (longer.length === 0) return 1;
  return (longer.length - levenshtein_(longer, shorter)) / longer.length;
}

/**
 * 0..1 similarity between two supplier names. Tolerates typos, a missing/extra
 * word ("עמרוסי ניסים" vs "עמרוסי ניסים ויורם") and different word order.
 */
function supplierNameScore_(a, b) {
  const na = normalizeSupplierName_(a);
  const nb = normalizeSupplierName_(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  if (na.replace(/ /g, '') === nb.replace(/ /g, '')) return 0.98;

  const whole = stringSimilarity_(na, nb);

  const ta = na.split(' ').filter(String);
  const tb = nb.split(' ').filter(String);
  const shortT = ta.length <= tb.length ? ta : tb;
  const longT = ta.length <= tb.length ? tb : ta;
  let allMatched = true;
  shortT.forEach(function (t) {
    let best = 0;
    longT.forEach(function (u) {
      const s = t === u ? 1 : (Math.min(t.length, u.length) >= 4 ? stringSimilarity_(t, u) : 0);
      if (s > best) best = s;
    });
    if (best < 0.8) allMatched = false;
  });
  const shortLen = shortT.join('').length;
  const longLen = longT.join('').length;
  const tokenScore = allMatched && shortLen >= 2 ? 0.86 + 0.09 * (shortLen / longLen) : 0;

  return Math.max(whole, tokenScore);
}

/**
 * Best match for `name` among `candidates` (array of strings).
 * @return {{name: string, score: number}|null}
 */
function findBestSupplierMatch_(name, candidates, threshold) {
  let best = null;
  candidates.forEach(function (c) {
    const score = supplierNameScore_(name, c);
    if (!best || score > best.score) best = { name: c, score: score };
  });
  return best && best.score >= (threshold || 0.82) ? best : null;
}
