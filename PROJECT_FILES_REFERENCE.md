# Project Files Reference - Complete Overview

**Last Updated**: December 20, 2024
**Project**: Zuza Patisserie Invoice Scanner with Product Tracking

---

## 📁 File Structure

```
suppliersAI/
├── Core Application Files
│   ├── index.html              - Main UI
│   ├── styles.css              - Styling
│   ├── config.js               - Configuration (updated with product sheet ID)
│   ├── gemini.js               - AI extraction logic (updated with products)
│   └── script.js               - Main application logic
│
├── Google Apps Script Files
│   ├── קוד-COMPLETE-FIXED.gs   - Main invoice processing script (FINAL VERSION)
│   └── products-tracking.gs    - Product tracking script (NEW)
│
├── Documentation
│   ├── PRODUCT_TRACKING_INSTALLATION.md    - Detailed installation guide
│   ├── PRODUCT_TRACKING_QUICKSTART.md      - 10-minute quick start
│   ├── PRODUCT_TRACKING_SUMMARY.md         - Technical summary
│   ├── DEPLOYMENT_CHECKLIST.md             - Deployment steps
│   ├── FINAL_STATUS_REPORT.md              - Complete status report
│   └── PROJECT_FILES_REFERENCE.md          - This file
│
└── API/Configuration
    └── api/config.js           - Vercel serverless function for API key
```

---

## 📄 Detailed File Descriptions

### **1. Core Application Files**

#### [index.html](index.html)
**Purpose**: Web application user interface
**Key Features**:
- File upload with drag-and-drop
- Supplier selection dropdown
- Document type selection (delivery note/invoice)
- Camera integration for mobile scanning
- Success/error message display

**Important Sections**:
- Lines 1-50: HTML structure and metadata
- Lines 51-100: Form inputs and dropdowns
- Lines 101-150: File upload area
- Lines 151-200: Result display area

**Do NOT modify**: UI is stable and working

---

#### [styles.css](styles.css)
**Purpose**: Application styling and responsive design
**Key Features**:
- Modern, clean interface
- Mobile-responsive layout
- Hebrew RTL support
- Loading animations
- Success/error styling

**Do NOT modify**: Styling is complete

---

#### [config.js](config.js) ⚠️ **UPDATED**
**Purpose**: Application configuration and API key loading

**Key Configuration**:
```javascript
GEMINI_MODEL: 'gemini-2.0-flash-lite'
GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models'

SHEETS_CONFIG: {
  scriptUrl: 'https://script.google.com/macros/s/AKfycbwKgjIkrnQ-9XTNe3Uj82DMYJUx3GK1NAMGN8nt2xPZBmjDVK0nIWrkAiLj2kS9se72zg/exec',
  sheetId: '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM',
  productsSheetId: '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ'  // ← ADDED
}
```

**What Changed**: Added `productsSheetId` for product tracking spreadsheet

**Load API Key Function**: Lines 40-49 - Fetches API key from Vercel serverless function

---

#### [gemini.js](gemini.js) ⚠️ **UPDATED**
**Purpose**: Gemini AI integration for OCR and data extraction

**Key Functions**:
- `processInvoiceWithGemini()` - Main AI processing function
- `uploadToGemini()` - Upload image to Gemini API
- `extractJSONFromResponse()` - Parse AI response

**What Changed**:

1. **Line 67**: Fixed JSON regex
   ```javascript
   // OLD: const jsonMatch = text.match(/\{[\s\S]*?\}/);
   // NEW:
   const jsonMatch = text.match(/\{[\s\S]*\}/);
   ```

2. **Lines 147-188**: Added product extraction to AI prompt
   ```javascript
   ## מוצרים (PRODUCTS):
   **חובה לחלץ את כל שורות המוצרים מהחשבונית!**

   עבור כל מוצר בטבלה, חלץ:
   - שם המוצר (בדיוק כפי שכתוב)
   - כמות
   - יחידה
   - מחיר ליחידה לפני מע״מ
   - סה״כ לפני מע״מ
   ```

3. **Lines 226-231**: Added JSON formatting rules
   ```javascript
   **חשוב! תבנית JSON:**
   - החזר רק JSON תקין
   - כל מוצר במערך products חייב להיות אובייקט תקין
   - ודא שיש פסיק אחרי כל אובייקט מוצר
   ```

**Critical**: This file enables product extraction

---

#### [script.js](script.js)
**Purpose**: Main application logic and event handling

**Key Functions**:
- File upload handling
- Supplier dropdown population
- Form validation
- Image processing
- Result display

**Do NOT modify**: Application logic is stable

---

### **2. Google Apps Script Files**

#### [קוד-COMPLETE-FIXED.gs](קוד-COMPLETE-FIXED.gs) ⚠️ **CRITICAL - DEPLOY THIS**
**Purpose**: Main invoice processing script for Google Sheets
**Lines**: 484
**Spreadsheet**: `1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM`

**Key Sections**:

1. **Configuration** (Lines 1-43):
   ```javascript
   const DATA_START_ROW = 5;
   const REGULAR_COLUMNS = { ... };
   const SPECIAL_COLUMNS = { ... };
   const SHEET_NAMES = { ... };
   const PRODUCTS_SCRIPT_URL = 'YOUR_URL_HERE';  // ← CONFIGURE THIS
   ```

2. **Main Entry Point** (Lines 47-96):
   - `doPost(e)` - Receives data from web app
   - Validates required fields
   - Routes to appropriate sheet
   - Sends products to tracking spreadsheet

3. **Critical Fix** (Lines 100-114):
   ```javascript
   // Get sheet info
   const sheetInfo = getSheetInfo(data);
   const sheetName = sheetInfo.sheet.getName();

   // Check actual sheet name (NOT AI category!)
   const isOtherCategory = (sheetName === SHEET_NAMES.other);

   // Send products only if NOT שונות
   if (data.products && data.products.length > 0) {
     if (isOtherCategory) {
       Logger.log('⚠️ Sheet is שונות - skipping product tracking');
     } else {
       Logger.log('✅ Sending products to tracking spreadsheet');
       sendProductsToTracking(data);
     }
   }
   ```

4. **Product Tracking Integration** (Lines 110-155):
   - `sendProductsToTracking()` - Sends products to tracking spreadsheet
   - Enhanced logging
   - Error handling (non-blocking)

5. **Helper Functions**:
   - `getSheetInfo()` - Determines target sheet and column layout
   - `addDataToSheet()` - Writes invoice data with date sorting
   - `parseIsraeliDate()` - Parses DD/MM/YYYY format
   - `parseAmount()` - Handles currency symbols and commas

**Deployment**:
1. Copy entire content
2. Paste into main spreadsheet Apps Script
3. Update `PRODUCTS_SCRIPT_URL` with your deployment URL
4. Save and test

---

#### [products-tracking.gs](products-tracking.gs) ⚠️ **CRITICAL - DEPLOY THIS**
**Purpose**: Product tracking and price history management
**Lines**: 453
**Spreadsheet**: `1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ`

**Key Sections**:

1. **Configuration** (Lines 1-66):
   ```javascript
   const PRODUCTS_SPREADSHEET_ID = '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ';
   const PRICE_HISTORY_SHEET_NAME = 'היסטוריית שינויי מחירים';
   const PRODUCT_DATA_START_ROW = 2;
   ```

2. **Main Entry Point** (Lines 75-103):
   - `doPost(e)` - Receives products from main script
   - Parses JSON payload
   - Calls `processProducts()`

3. **Product Processing** (Lines 129-210):
   - `processProducts()` - Main processing logic
   - `processProduct()` - Handles individual products
   - Fuzzy matching to find existing products
   - Price change detection (>0.01 threshold)

4. **Fuzzy Matching Algorithm** (Lines 282-363):
   - `findProduct()` - Find existing product with fuzzy match
   - `normalizeProductName()` - Clean product names
   - `calculateSimilarity()` - Levenshtein distance
   - 85% similarity threshold

5. **Sheet Operations** (Lines 218-411):
   - `getOrCreateSupplierSheet()` - Auto-create supplier sheets
   - `getExistingProducts()` - Read current products
   - `addNewProduct()` - Add new product
   - `updateProductPrice()` - Update existing price
   - `addToPriceHistory()` - Record to history sheet

6. **Utility Functions** (Lines 421-453):
   - `initializePriceHistorySheet()` - One-time setup (run first!)
   - `testProcessProducts()` - Manual testing function

**Deployment**:
1. Copy entire content
2. Paste into products spreadsheet Apps Script
3. Run `initializePriceHistorySheet()` ONCE
4. Deploy as Web App (Execute as: Me, Who has access: Anyone)
5. Copy deployment URL for main script

---

### **3. Documentation Files**

#### [PRODUCT_TRACKING_INSTALLATION.md](PRODUCT_TRACKING_INSTALLATION.md)
**Purpose**: Complete installation guide
**Lines**: 413
**Target Audience**: User performing installation

**Contents**:
- Overview of system
- Sheet structure explanation
- Step-by-step installation (4 steps)
- Testing procedures
- Troubleshooting guide
- Analytics examples
- Best practices
- Security notes

**Use When**: First-time installation or detailed reference needed

---

#### [PRODUCT_TRACKING_QUICKSTART.md](PRODUCT_TRACKING_QUICKSTART.md)
**Purpose**: 10-minute quick start guide
**Lines**: 178
**Target Audience**: User who wants fast deployment

**Contents**:
- 3-step condensed installation
- Quick test procedures
- Common issues (condensed)
- Success checklist
- Quick tips

**Use When**: Need to deploy quickly without reading full guide

---

#### [PRODUCT_TRACKING_SUMMARY.md](PRODUCT_TRACKING_SUMMARY.md)
**Purpose**: Technical implementation summary
**Lines**: 371
**Target Audience**: Developers/technical users

**Contents**:
- What was implemented
- Sheet structure details
- Data flow diagrams
- Key features explained
- Cost impact analysis
- Installation checklist
- Analytics queries
- Best practices

**Use When**: Need technical understanding of system

---

#### [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)
**Purpose**: Step-by-step deployment guide
**Lines**: Current file
**Target Audience**: User ready to deploy

**Contents**:
- Pre-deployment verification
- 3 deployment steps with detailed instructions
- Testing procedures
- Success criteria
- Troubleshooting common issues
- What happens behind the scenes

**Use When**: Ready to deploy after reading other docs

---

#### [FINAL_STATUS_REPORT.md](FINAL_STATUS_REPORT.md)
**Purpose**: Complete project status and summary
**Lines**: Current file
**Target Audience**: Project stakeholders

**Contents**:
- Project summary
- All deliverables listed
- Issues found and fixed
- System architecture
- Cost analysis
- Testing performed
- Expected benefits
- Deployment status

**Use When**: Need overview of entire project

---

#### [PROJECT_FILES_REFERENCE.md](PROJECT_FILES_REFERENCE.md)
**Purpose**: This file - Complete file reference
**Target Audience**: Anyone working with the project

**Use When**: Need to understand project structure or find specific files

---

### **4. API Configuration**

#### [api/config.js](api/config.js)
**Purpose**: Vercel serverless function to securely serve API key
**Deployment**: Vercel

**Function**:
```javascript
export default function handler(req, res) {
  res.status(200).json({
    GEMINI_API_KEY: process.env.GEMINI_API_KEY
  });
}
```

**Environment Variable**: `GEMINI_API_KEY` set in Vercel dashboard

**Do NOT modify**: API key serving is working

---

## 🔄 Data Flow Summary

```
┌─────────────────────────────────────────────────────────────┐
│                    USER SCANS INVOICE                        │
│                     (index.html)                             │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
┌─────────────────────────────────────────────────────────────┐
│               GEMINI AI PROCESSING                           │
│                   (gemini.js)                                │
│                                                              │
│  Extracts:                                                   │
│  • Supplier name, category                                   │
│  • Document date, number                                     │
│  • Total amount                                              │
│  • Products array (name, qty, unit, price before VAT)       │
└───────────────────────┬─────────────────────────────────────┘
                        ▼
                ┌───────┴────────┐
                ▼                ▼
┌──────────────────────┐  ┌────────────────────────────────────┐
│  INVOICE SUMMARY     │  │        PRODUCTS ARRAY              │
│      (script.js)     │  │                                    │
│          ↓           │  │                                    │
│  POST to Main        │  │                                    │
│  Spreadsheet Script  │  │                                    │
│          ↓           │  │                                    │
│  ┌─────────────────┐│  │                                    │
│  │קוד-COMPLETE-    ││  │                                    │
│  │FIXED.gs         ││  │                                    │
│  │                 ││  │                                    │
│  │1. Get sheet     ││  │                                    │
│  │2. Check if      ││  │                                    │
│  │   שונות         ││  │                                    │
│  │3. Write summary ││  │                                    │
│  │4. Send products │──┐│                                    │
│  │   (if not שונות)││ ││                                    │
│  └─────────────────┘│ ││                                    │
└──────────────────────┘ ││                                    │
                         │└────────────────────────────────────┘
                         ▼
         ┌───────────────────────────────────────┐
         │  POST to Product Tracking Script      │
         │                                        │
         │  ┌──────────────────────────────────┐ │
         │  │ products-tracking.gs             │ │
         │  │                                  │ │
         │  │ 1. Get supplier sheet            │ │
         │  │    (auto-create if needed)       │ │
         │  │ 2. Get existing products         │ │
         │  │ 3. For each product:             │ │
         │  │    • Fuzzy match (85%)           │ │
         │  │    • If new → Add to sheet       │ │
         │  │    • If exists & price changed:  │ │
         │  │      - Update sheet              │ │
         │  │      - Add to price history      │ │
         │  │    • If unchanged → Skip         │ │
         │  └──────────────────────────────────┘ │
         └───────────────────────────────────────┘
                         ▼
         ┌───────────────────────────────────────┐
         │     PRODUCT TRACKING SPREADSHEET      │
         │                                        │
         │  • Supplier sheets (current prices)   │
         │  • היסטוריית שינויי מחירים           │
         └───────────────────────────────────────┘
```

---

## 🎯 Quick Action Guide

### **To Deploy Product Tracking:**
1. Read: [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md)
2. Deploy: [products-tracking.gs](products-tracking.gs) to products spreadsheet
3. Deploy: [קוד-COMPLETE-FIXED.gs](קוד-COMPLETE-FIXED.gs) to main spreadsheet
4. Configure: PRODUCTS_SCRIPT_URL in main script

### **To Understand the System:**
1. Read: [FINAL_STATUS_REPORT.md](FINAL_STATUS_REPORT.md)
2. Read: [PRODUCT_TRACKING_SUMMARY.md](PRODUCT_TRACKING_SUMMARY.md)

### **To Get Quick Start:**
1. Read: [PRODUCT_TRACKING_QUICKSTART.md](PRODUCT_TRACKING_QUICKSTART.md)

### **To Troubleshoot Issues:**
1. Check: [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) - Common Issues section
2. Check: Apps Script execution logs (View → Executions)
3. Check: Browser console (F12 → Console)

### **To Understand Code Changes:**
1. See: This file (PROJECT_FILES_REFERENCE.md)
2. See: [FINAL_STATUS_REPORT.md](FINAL_STATUS_REPORT.md) - Issues section

---

## ✅ Files Ready for Deployment

**Must Deploy**:
- ✅ [products-tracking.gs](products-tracking.gs) → Products spreadsheet Apps Script
- ✅ [קוד-COMPLETE-FIXED.gs](קוד-COMPLETE-FIXED.gs) → Main spreadsheet Apps Script

**Already Deployed** (no changes needed):
- ✅ [index.html](index.html) - Web UI
- ✅ [styles.css](styles.css) - Styling
- ✅ [script.js](script.js) - App logic
- ✅ [api/config.js](api/config.js) - API key server

**Updated in Place** (refresh browser):
- ✅ [config.js](config.js) - Added product sheet ID
- ✅ [gemini.js](gemini.js) - Added product extraction

---

## 📊 Version History

| Version | Date | Changes |
|---------|------|---------|
| 1.0 | Previous | Initial invoice scanning system |
| 2.0 | Dec 20, 2024 | **Product tracking added** |
| 2.1 | Dec 20, 2024 | **Fixed JSON parsing** (greedy regex) |
| 2.2 | Dec 20, 2024 | **Fixed URL validation** |
| 2.3 | Dec 20, 2024 | **Fixed category mismatch** (critical fix) |

**Current Version**: 2.3 ✅ **STABLE & READY**

---

## 🎉 Ready to Deploy!

All files are complete, tested, and documented. Follow [DEPLOYMENT_CHECKLIST.md](DEPLOYMENT_CHECKLIST.md) to deploy the system.

**Questions?** Check the relevant documentation file above or review the detailed guides.

---

**End of File Reference** 📚
