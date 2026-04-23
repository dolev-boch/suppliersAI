/**
 * Google Drive Upload Script
 * Receives invoice images and saves them under:
 * Root (1PvQ55jTptFyI1u_VNf_-FPMiZEpfSRLZ) → Year → Supplier → Month → file
 */

const DRIVE_ROOT_FOLDER_ID = '1PvQ55jTptFyI1u_VNf_-FPMiZEpfSRLZ';

function doPost(e) {
  try {
    const data = JSON.parse(e.postData.contents);

    const imageBase64 = data.image_base64;
    const mimeType    = data.mime_type || 'image/jpeg';
    const supplier    = data.supplier_name;
    const docType     = data.document_type; // 'invoice' | 'delivery_note' | 'credit_invoice'
    const docDate     = data.document_date; // DD/MM/YYYY

    if (!imageBase64 || !supplier || !docDate) {
      return respond(false, 'Missing required fields');
    }

    // Parse date → year + zero-padded month
    const parts = docDate.split('/');
    if (parts.length !== 3) return respond(false, 'Invalid date: ' + docDate);
    const month = parts[1]; // already zero-padded from AI (e.g. "04")
    const year  = parts[2]; // e.g. "2026"

    // Folder structure: root → year → supplier → month
    const root          = DriveApp.getFolderById(DRIVE_ROOT_FOLDER_ID);
    const yearFolder     = getOrCreate(root, year);
    const supplierFolder = getOrCreate(yearFolder, supplier);
    const monthFolder    = getOrCreate(supplierFolder, month);

    // File name based on document type
    let fileName;
    if (docType === 'delivery_note') {
      fileName = 'תעודת משלוח';
    } else if (docType === 'credit_invoice') {
      fileName = 'חשבונית זיכוי';
    } else {
      fileName = 'חשבונית מס';
    }

    // Decode and save
    const blob = Utilities.newBlob(Utilities.base64Decode(imageBase64), mimeType, fileName);
    const file = monthFolder.createFile(blob);

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

// Manual test — run this once from the script editor to verify folder creation
function testUpload() {
  const fakeEvent = {
    postData: {
      contents: JSON.stringify({
        image_base64: Utilities.base64Encode('test'),
        mime_type: 'image/jpeg',
        supplier_name: 'TEST_SUPPLIER',
        document_type: 'invoice',
        document_date: '23/04/2026',
      })
    }
  };
  Logger.log(doPost(fakeEvent).getContent());
}
