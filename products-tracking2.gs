/**
 * Product Tracking System
 * Google Apps Script
 *
 * Spreadsheet ID: 1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
 *
 * Supplier sheet columns:
 *   A  שם מוצר
 *   B  מחיר לפני מע״מ           (the list price exactly as printed on the invoice, before any discount)
 *   C  הערות                    ("הנחה נרשמה עבור מוצר זה (20% הנחה)" when the last purchase had a discount)
 *   D  מחיר ששולם בפועל         (price actually paid per unit after the discount, for reference)
 *   E  יחידה                    (ק״ג / יח׳ / ליטר … — weighed goods are always per ק״ג)
 *
 * Price-change logic compares LIST prices only (column B):
 *   - Same list price, discount appears/disappears → note updated, no alert.
 *   - List price changed (with or without discount) → alert (note included if discounted).
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
const COL_UNIT = 5;
const NUM_COLS = 5;

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
        return { name: p.name, price: p.price, note: p.note, unit: p.unit };
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
  const supplierSheet = getOrCreateSupplierSheet(ss, supplierName, products);
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

  // Keep the product list in Hebrew alphabetical order (א-ב).
  // Done last, because sorting moves rows and the row indexes above would go stale.
  sortProductsSheet(supplierSheet);

  // Keep the supplier tabs in א-ב order too
  arrangeSheetsAlphabetically(ss);

  Logger.log('✅ Completed: ' + processed + '/' + products.length + ' processed');
}

/**
 * Sort a supplier sheet's products (row 2 down, columns A-D) by product name א-ב.
 */
function sortProductsSheet(sheet) {
  const lastRow = sheet.getLastRow();
  if (lastRow <= PRODUCT_DATA_START_ROW) return;
  sheet.getRange(PRODUCT_DATA_START_ROW, 1, lastRow - PRODUCT_DATA_START_ROW + 1, NUM_COLS)
    .sort({ column: COL_NAME, ascending: true });
}

/**
 * Order the tabs: price-history tab first, then all supplier tabs א-ב.
 * Only tabs that are out of place are moved.
 */
function arrangeSheetsAlphabetically(ss) {
  const sheets = ss.getSheets();
  const history = sheets.filter(function (s) { return s.getName() === PRICE_HISTORY_SHEET_NAME; });
  const suppliers = sheets
    .filter(function (s) { return s.getName() !== PRICE_HISTORY_SHEET_NAME; })
    .sort(function (a, b) { return a.getName().localeCompare(b.getName(), 'he'); });
  const desired = history.concat(suppliers);

  const active = ss.getActiveSheet();
  desired.forEach(function (sheet, i) {
    if (ss.getSheets()[i].getSheetId() !== sheet.getSheetId()) {
      ss.setActiveSheet(sheet);
      ss.moveActiveSheet(i + 1); // 1-based position
    }
  });
  if (active) ss.setActiveSheet(active);
}

/**
 * One-time / manual (run from the editor): sort every supplier's products א-ב
 * and arrange all tabs א-ב.
 */
function sortAllSupplierSheets() {
  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
  ss.getSheets().forEach(function (s) {
    if (s.getName() === PRICE_HISTORY_SHEET_NAME) return;
    sortProductsSheet(s);
    Logger.log('Sorted products: ' + s.getName());
  });
  arrangeSheetsAlphabetically(ss);
  Logger.log('✅ Tabs arranged א-ב');
}

/**
 * One-time cleanup (run from the editor): remove discount notes that were really
 * rounding adjustments — "(0% הנחה)" / "(0.1% הנחה)" — and fill in the regular price.
 */
function cleanupTrivialDiscountNotes() {
  const ss = SpreadsheetApp.openById(PRODUCTS_SPREADSHEET_ID);
  let fixed = 0;
  ss.getSheets().forEach(function (s) {
    if (s.getName() === PRICE_HISTORY_SHEET_NAME) return;
    getExistingProducts(s).forEach(function (p) {
      const m = p.note.match(/\(([\d.]+)% הנחה\)/);
      if (p.isDiscount && m && parseFloat(m[1]) < 1) {
        s.getRange(p.rowIndex, COL_NOTES).setValue('');
        s.getRange(p.rowIndex, COL_REGULAR).setValue(p.price).setNumberFormat('0.00');
        fixed++;
        Logger.log('Fixed: ' + s.getName() + ' / ' + p.name);
      }
    });
  });
  Logger.log('✅ Removed ' + fixed + ' rounding "discount" notes');
}

function buildDiscountNote(product) {
  const pct = parseFloat(product.discount_percent);
  return !isNaN(pct) && pct > 0 ? DISCOUNT_NOTE + ' (' + formatPct(pct) + '% הנחה)' : DISCOUNT_NOTE;
}

function formatPct(p) {
  return Math.round(p * 10) / 10;
}

/** Rounding adjustment, not a real discount: under ₪0.50 and under 1% (or printed % under 1) */
function isTrivialDiscount(product) {
  const pct = parseFloat(product.discount_percent);
  if (!isNaN(pct) && pct >= 1) return false;
  let amount = parseFloat(product.discount_amount);
  const price = parseFloat(product.unit_price_before_vat);
  const qty = parseFloat(product.quantity) || 1;
  const before = parseFloat(product.price_before_discount);
  if (isNaN(amount) && !isNaN(before) && !isNaN(price)) amount = (before - price) * qty;
  if (isNaN(amount)) return !isNaN(pct) && pct < 1;
  const line = parseFloat(product.total_before_vat) || price * qty;
  return Math.abs(amount) < 0.5 && (!line || Math.abs(amount) / line < 0.01);
}

/** Canonical unit label for the sheet */
function normalizeUnit(u) {
  const t = String(u || '').replace(/["'״׳`.\s]/g, '').toLowerCase();
  if (!t) return '';
  if (['קג', 'קילו', 'kg'].indexOf(t) !== -1) return 'ק״ג';
  if (['ליטר', 'ל', 'lt', 'l'].indexOf(t) !== -1) return 'ליטר';
  if (['יח', 'יחידה', 'יחידות', 'unit', 'pcs'].indexOf(t) !== -1) return 'יח׳';
  if (['גרמ', 'גרם', 'גר', 'g'].indexOf(t) !== -1) return 'גרם';
  if (['מל', 'ml'].indexOf(t) !== -1) return 'מ״ל';
  return String(u).trim();
}

/**
 * Process one product line.
 * Column B always holds the invoice's printed price (before discount); the discount
 * only adds a note. So a discount coming or going never triggers an alert by itself.
 */
function processProduct(supplierSheet, historySheet, existingProducts, product, supplierName, documentDate) {
  const productName = product.name ? String(product.name).trim() : '';
  const paidPrice = parseFloat(product.unit_price_before_vat);
  const unit = normalizeUnit(product.unit);
  // A few agorot of rounding ("הנ: 0.01") is not a discount
  const isDiscount = (product.discount_applied === true || product.discount_applied === 'true') &&
    !isTrivialDiscount(product);

  // List price = price before the discount (as printed); without a discount it's the price paid
  const before = parseFloat(product.price_before_discount);
  const listPrice = isDiscount && before > 0 ? before : paidPrice;

  if (!productName) return false;
  if (isNaN(listPrice) || listPrice <= 0) {
    Logger.log('⚠️ Skipping "' + productName + '" - invalid price');
    return false;
  }

  const note = isDiscount ? buildDiscountNote(product) : '';
  const existing = findProduct(existingProducts, productName, product.catalog_name);

  // ---------------------------------------------------------------- new product
  if (!existing) {
    const row = addNewProduct(supplierSheet, productName, listPrice, note, paidPrice, unit);
    existingProducts.push({
      name: productName, price: listPrice, note: note, isDiscount: isDiscount, unit: unit, rowIndex: row,
    });
    addToPriceHistory(historySheet, supplierName, productName, null, listPrice, documentDate, note);
    return true;
  }

  // ----------------------------------------------------------- existing product
  // Self-correction: this name was read with verified certainty (two independent readings
  // agreed ≥90%) but the row holds a different name → the stored one was an old misread.
  maybeCorrectProductName(supplierSheet, historySheet, existingProducts, existing, product,
    productName, supplierName, documentDate);

  const oldPrice = existing.price;
  const name = existing.name; // keep the catalog's name everywhere
  Logger.log('"' + productName + '" → "' + name + '" list ₪' + oldPrice + ' → ₪' + listPrice +
             (isDiscount ? ' [discount, paid ₪' + paidPrice + ']' : ''));

  // Prices in different units (per ק״ג vs per יח׳) are not comparable — never alert on them
  if (unit && existing.unit && unit !== existing.unit) {
    addToPriceHistory(historySheet, supplierName, name, oldPrice, listPrice, documentDate,
      '⚠️ יחידה שונה (' + existing.unit + ' ← ' + unit + ') — לא עודכן, בדוק ידנית', true);
    return false;
  }
  if (unit && !existing.unit) {
    supplierSheet.getRange(existing.rowIndex, COL_UNIT).setValue(unit);
    existing.unit = unit;
  }

  // Same list price → only the discount note / paid price may change. No alert.
  if (Math.abs(listPrice - oldPrice) <= 0.01) {
    updateProductRow(supplierSheet, existing, listPrice, note, paidPrice);
    return true;
  }

  // List price changed → real price change
  return notifyIfLegit(historySheet, supplierSheet, existing, supplierName, name, oldPrice, listPrice,
    documentDate, note, paidPrice);
}

/**
 * Rename an existing row to the verified reading of the invoice, so old misread names
 * ("שמנת קרט טבעי") fix themselves on the next clear scan — no manual edits.
 * Only when: the app verified the name, the names really differ, sizes/percentages
 * don't conflict, and no other row already has that name.
 */
function maybeCorrectProductName(sheet, historySheet, existingProducts, existing, product, productName,
                                 supplierName, documentDate) {
  const verified = product.name_verified === true || product.name_verified === 'true';
  if (!verified) return;
  const target = normalizeProductName(productName);
  if (!target || target === normalizeProductName(existing.name)) return;
  if (numbersConflict(productName, existing.name)) return;
  const taken = existingProducts.some(function (p) {
    return p !== existing && normalizeProductName(p.name) === target;
  });
  if (taken) return;

  const oldName = existing.name;
  sheet.getRange(existing.rowIndex, COL_NAME).setValue(productName);
  existing.name = productName;
  addToPriceHistory(historySheet, supplierName, productName, null, existing.price, documentDate,
    '✏️ שם תוקן אוטומטית מ-"' + oldName + '" (קריאה מאומתת מהחשבונית)');
  Logger.log('✏️ Renamed "' + oldName + '" → "' + productName + '"');
}

/**
 * Real price change: apply the sanity gate, then update + history + email.
 */
function notifyIfLegit(historySheet, supplierSheet, existing, supplierName, name, oldPrice, newPrice,
                       documentDate, note, paidPrice) {
  const changePercent = ((newPrice - oldPrice) / oldPrice) * 100;

  if (Math.abs(newPrice - oldPrice) / oldPrice > SUSPICIOUS_CHANGE_THRESHOLD) {
    addToPriceHistory(historySheet, supplierName, name, oldPrice, newPrice, documentDate,
      '⚠️ חשוד - לא עודכן (שינוי של ' + Math.abs(changePercent).toFixed(0) + '% — בדוק ידנית)', true);
    return false;
  }

  updateProductRow(supplierSheet, existing, newPrice, note, paidPrice);
  addToPriceHistory(historySheet, supplierName, name, oldPrice, newPrice, documentDate, note);
  sendPriceChangeEmail(supplierName, name, oldPrice, newPrice, changePercent, note);
  return true;
}

// ============================================================================
// SHEET OPERATIONS
// ============================================================================

/**
 * Existing sheet that is, with the highest probability, this supplier.
 *  1. Exact sheet name.
 *  2. Name match ≥ 0.82 (typos, בע"מ, missing/extra word) → best-scoring sheet.
 *  3. Name only partly similar (≥ 0.6) → accepted only if the invoice's products
 *     confirm it: at least half of them (and at least 2) already exist in that sheet.
 * Returns null only when no existing sheet is a probable match.
 */
function findSupplierSheet(ss, supplierName, products) {
  if (!supplierName) return null;
  const exact = ss.getSheetByName(supplierName);
  if (exact) return exact;

  const scored = ss.getSheets()
    .filter(function (s) { return s.getName() !== PRICE_HISTORY_SHEET_NAME; })
    .map(function (s) { return { sheet: s, score: supplierNameScore_(supplierName, s.getName()) }; })
    .sort(function (a, b) { return b.score - a.score; });

  if (scored.length && scored[0].score >= 0.82) {
    Logger.log('🔗 Supplier "' + supplierName + '" → existing sheet "' + scored[0].sheet.getName() +
               '" (name ' + scored[0].score.toFixed(2) + ')');
    return scored[0].sheet;
  }

  // Borderline names: let the products decide
  const names = (products || []).map(function (p) { return p && p.name; }).filter(Boolean);
  if (names.length === 0) return null;

  let best = null;
  scored.filter(function (c) { return c.score >= 0.6; }).forEach(function (c) {
    const catalog = getExistingProducts(c.sheet);
    if (catalog.length === 0) return;
    const hits = names.filter(function (n) { return findProduct(catalog, n, null); }).length;
    const ratio = hits / names.length;
    if (hits >= 2 && ratio >= 0.5 && (!best || ratio > best.ratio)) {
      best = { sheet: c.sheet, ratio: ratio, hits: hits, score: c.score };
    }
  });

  if (best) {
    Logger.log('🔗 Supplier "' + supplierName + '" → existing sheet "' + best.sheet.getName() +
               '" (name ' + best.score.toFixed(2) + ', ' + best.hits + '/' + names.length + ' products already there)');
    return best.sheet;
  }
  return null;
}

function getOrCreateSupplierSheet(ss, supplierName, products) {
  let sheet = findSupplierSheet(ss, supplierName, products);
  if (!sheet) {
    Logger.log('Creating new sheet: ' + supplierName);
    sheet = ss.insertSheet(supplierName);
    sheet.setColumnWidth(1, 300);
    sheet.setColumnWidth(2, 150);
    sheet.setColumnWidth(3, 260);
    sheet.setColumnWidth(4, 150);
    sheet.setColumnWidth(5, 80);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function ensureSupplierHeaders(sheet) {
  const headers = ['שם מוצר', 'מחיר לפני מע״מ (כפי שמופיע בחשבונית)', 'הערות', 'מחיר ששולם בפועל (אחרי הנחה)', 'יחידה'];
  const current = sheet.getRange(1, 1, 1, NUM_COLS).getValues()[0];
  let changed = false;
  for (let i = 0; i < NUM_COLS; i++) {
    // Fill empty headers; replace the old column-D title (its meaning changed)
    if (!current[i] || (i === COL_REGULAR - 1 && current[i] === 'מחיר רגיל אחרון (ללא הנחה)')) {
      sheet.getRange(1, i + 1).setValue(headers[i]);
      changed = true;
    }
  }
  if (changed) {
    sheet.getRange(1, 1, 1, NUM_COLS).setFontWeight('bold').setBackground('#4285f4')
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

  const values = sheet.getRange(PRODUCT_DATA_START_ROW, 1, lastRow - PRODUCT_DATA_START_ROW + 1, NUM_COLS).getValues();
  const products = [];
  values.forEach(function (row, index) {
    const name = row[0];
    const price = parseFloat(row[1]);
    if (!name || String(name).trim() === '' || isNaN(price) || price <= 0) return;
    const note = row[2] ? String(row[2]) : '';
    const isDiscount = note.indexOf(DISCOUNT_NOTE) !== -1;
    products.push({
      name: String(name).trim(),
      price: price,
      note: note,
      isDiscount: isDiscount,
      unit: row[4] ? normalizeUnit(row[4]) : '',
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
 * Update list price (B), note (C) and price actually paid (D) of an existing row,
 * and the in-memory copy.
 */
function updateProductRow(sheet, existing, listPrice, note, paidPrice) {
  sheet.getRange(existing.rowIndex, COL_PRICE).setValue(Number(listPrice)).setNumberFormat('0.00');
  sheet.getRange(existing.rowIndex, COL_NOTES).setValue(note || '');
  if (paidPrice > 0) {
    sheet.getRange(existing.rowIndex, COL_REGULAR).setValue(Number(paidPrice)).setNumberFormat('0.00');
  }
  existing.price = Number(listPrice);
  existing.note = note || '';
  existing.isDiscount = !!note && note.indexOf(DISCOUNT_NOTE) !== -1;
}

function addNewProduct(sheet, productName, price, note, paidPrice, unit) {
  const newRow = Math.max(sheet.getLastRow() + 1, PRODUCT_DATA_START_ROW);
  sheet.getRange(newRow, COL_NAME).setValue(String(productName));
  sheet.getRange(newRow, COL_PRICE).setValue(Number(price)).setNumberFormat('0.00');
  if (note) sheet.getRange(newRow, COL_NOTES).setValue(note);
  if (paidPrice > 0) {
    sheet.getRange(newRow, COL_REGULAR).setValue(Number(paidPrice)).setNumberFormat('0.00');
  }
  if (unit) sheet.getRange(newRow, COL_UNIT).setValue(unit);
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
