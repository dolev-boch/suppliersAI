/**
 * Google Drive Upload Script
 * Structure: Root → Year → Supplier → Month (MM-HebrewName) → [Day] → file
 */

const DRIVE_ROOT_FOLDER_ID = '1PvQ55jTptFyI1u_VNf_-FPMiZEpfSRLZ';

const HEBREW_MONTHS = {
  '01': 'ינואר', '02': 'פברואר', '03': 'מרץ',   '04': 'אפריל',
  '05': 'מאי',   '06': 'יוני',   '07': 'יולי',  '08': 'אוגוסט',
  '09': 'ספטמבר','10': 'אוקטובר','11': 'נובמבר','12': 'דצמבר'
};

// Returns "04-אפריל", "05-מאי", etc.
function monthFolderName(zeroPaddedMonth) {
  var he = HEBREW_MONTHS[zeroPaddedMonth] || zeroPaddedMonth;
  return he + '-' + zeroPaddedMonth;
}

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const imageBase64      = data.image_base64;
    const mimeType         = data.mime_type        || 'image/jpeg';
    const fileExt          = data.file_ext         || '';
    const supplier         = data.supplier_name;
    const docType          = data.document_type;
    const docDate          = data.document_date;   // DD/MM/YYYY
    const dateConfidence   = parseFloat(data.date_confidence) || 0;

    if (!imageBase64 || !supplier || !docDate) {
      return respond(false, 'Missing required fields');
    }

    const parts = docDate.split('/');
    if (parts.length !== 3) return respond(false, 'Invalid date: ' + docDate);

    const day         = parts[0].padStart(2, '0'); // e.g. "01"
    const monthNum    = parts[1].padStart(2, '0'); // e.g. "04"
    const currentYear = String(new Date().getFullYear());

    Logger.log('Year: ' + currentYear + ' | Month: ' + monthNum +
               ' | Day: ' + day + ' | Date confidence: ' + dateConfidence + '%');

    // Folder structure: root → year → supplier → month (no day subfolder)
    const root           = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
    const yearFolder     = getOrCreate(root, currentYear);
    const supplierFolder = getOrCreateSupplierFolder(root, yearFolder, supplier);
    const targetFolder   = getOrCreate(supplierFolder, monthFolderName(monthNum));

    // File name — append date (DD.MM.YY) when confidence ≥ 95%
    let baseName;
    if (docType === 'delivery_note')       baseName = 'תעודת משלוח';
    else if (docType === 'credit_invoice') baseName = 'חשבונית זיכוי';
    else                                   baseName = 'חשבונית מס';

    const shortYear = String(new Date().getFullYear()).slice(-2); // "26"
    const dateSuffix = dateConfidence >= 95
      ? '_' + day + '.' + monthNum + '.' + shortYear
      : '';

    Logger.log('Date confidence ' + dateConfidence + '% → suffix: "' + dateSuffix + '"');

    const fileName    = baseName + dateSuffix + fileExt;
    // Strip any whitespace/newlines that corrupt base64 decoding
    const cleanBase64 = imageBase64.replace(/[\s\r\n]/g, '');
    Logger.log('Base64 length: ' + cleanBase64.length + ' bytes | File: ' + fileName);

    const blob = Utilities.newBlob(Utilities.base64Decode(cleanBase64), mimeType, fileName);
    const file = targetFolder.createFile(blob);

    Logger.log('✅ Uploaded: ' + file.getName() + ' → ' + file.getId());
    return respond(true, 'Uploaded ' + file.getName());

  } catch (err) {
    Logger.log('❌ ' + err.toString());
    return respond(false, err.toString());
  }
}

/**
 * Find the supplier folder that this name most probably belongs to, instead of
 * creating a new folder for every mis-read / typo of the same supplier.
 *  1. Near match among this year's supplier folders → use it.
 *  2. Near match among previous years' supplier folders → create this year's
 *     folder with that canonical spelling.
 *  3. Otherwise create a new folder with the given name.
 */
function getOrCreateSupplierFolder(root, yearFolder, supplier) {
  const thisYear = listSubfolderNames(yearFolder);
  const exact = yearFolder.getFoldersByName(supplier);
  if (exact.hasNext()) return exact.next();

  let match = findBestSupplierMatch_(supplier, thisYear, 0.82);
  if (match) {
    Logger.log('🔗 Folder "' + supplier + '" → existing "' + match.name + '" (' + match.score.toFixed(2) + ')');
    return yearFolder.getFoldersByName(match.name).next();
  }

  const otherYears = [];
  const years = root.getFolders();
  while (years.hasNext()) {
    const y = years.next();
    if (y.getId() === yearFolder.getId()) continue;
    listSubfolderNames(y).forEach(function (n) { otherYears.push(n); });
  }
  match = findBestSupplierMatch_(supplier, otherYears, 0.82);
  if (match) {
    Logger.log('🔗 Folder "' + supplier + '" → canonical name from earlier year "' + match.name + '"');
    return yearFolder.createFolder(match.name);
  }

  return yearFolder.createFolder(supplier);
}

function listSubfolderNames(folder) {
  const names = [];
  const it = folder.getFolders();
  while (it.hasNext()) names.push(it.next().getName());
  return names;
}

function getOrCreate(parentFolder, name) {
  const iter = parentFolder.getFoldersByName(name);
  return iter.hasNext() ? iter.next() : parentFolder.createFolder(name);
}

function respond(success, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ success: success, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}

function testUpload() {
  const cases = [
    { label: 'high confidence → date in name',  date: '06/04/2026', confidence: 97 },
    { label: 'low confidence → no date in name', date: '09/04/2026', confidence: 80 },
    { label: 'exact threshold (95)',             date: '15/04/2026', confidence: 95 },
  ];
  cases.forEach(function(c) {
    const ev = { postData: { contents: JSON.stringify({
      image_base64: Utilities.base64Encode('test'), mime_type: 'image/jpeg', file_ext: '.pdf',
      supplier_name: 'TEST_SUPPLIER', document_type: 'invoice',
      document_date: c.date, date_confidence: c.confidence,
    })}};
    Logger.log('Test [' + c.label + ']: ' + doPost(ev).getContent());
  });
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
