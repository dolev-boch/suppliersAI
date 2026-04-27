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
    const supplierFolder = getOrCreate(yearFolder, supplier);
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
