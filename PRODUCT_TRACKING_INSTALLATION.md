# Product Tracking System - Installation Guide

## Overview

This system automatically extracts products from invoices and tracks their prices over time across all suppliers.

**Spreadsheet ID:** `1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ`

---

## 📋 What This System Does

1. **Extracts Products:** AI reads all line items from invoices
2. **Tracks Prices:** Maintains current price for each product per supplier
3. **Price History:** Records every price change with date
4. **Automatic Updates:** No manual work required
5. **Fuzzy Matching:** Recognizes same product even with slight name variations

---

## 🏗️ Sheet Structure

### **Supplier Sheets** (one per supplier)

Each supplier has their own sheet (e.g., "מקאנו", "צח", "נטפים")

| Column A (A2→) | Column B (B2→)       |
| -------------- | -------------------- |
| שם מוצר        | מחיר נוכחי לפני מע״מ |
| חלב 3%         | 5.80                 |
| קמח לבן        | 3.50                 |

**Purpose:** Quick view of current product catalog and prices

---

### **היסטוריית שינויי מחירים Sheet**

Central price history for ALL suppliers

| A2→ ספק | B2→ מוצר | C2→ מחיר לפני מע״מ | D2→ תאריך  |
| ------- | -------- | ------------------ | ---------- |
| מקאנו   | חלב 3%   | 5.50               | 01/11/2024 |
| מקאנו   | חלב 3%   | 5.80               | 15/12/2024 |
| צח      | ביצים L  | 1.70               | 16/11/2024 |
| צח      | ביצים L  | 1.80               | 18/12/2024 |

**Purpose:** Track price changes over time, analyze trends

---

## 🚀 Installation Steps

### **Step 1: Set Up היסטוריית שינויי מחירים Sheet**

1. Open spreadsheet: https://docs.google.com/spreadsheets/d/1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
2. Check if sheet "היסטוריית שינויי מחירים" exists

   - If YES → Skip to Step 2
   - If NO → Continue below

3. Go to Extensions → Apps Script
4. Copy the entire content of `products-tracking.gs` file
5. Paste it into the Apps Script editor
6. Save (Ctrl+S or File → Save)
7. Run function: `initializePriceHistorySheet`
   - Click Run button (▶️)
   - Authorize when prompted
   - Check execution log - should see "✅ Price history sheet initialized"

---

### **Step 2: Deploy Products Tracking Script**

1. In Apps Script editor (from Step 1)
2. Click "Deploy" → "New deployment"
3. Settings:
   - Type: **Web app**
   - Description: "Product Tracking API"
   - Execute as: **Me**
   - Who has access: **Anyone** (important!)
4. Click "Deploy"
5. **Copy the Web App URL** (looks like: `https://script.google.com/macros/s/...`)
6. Save this URL - you'll need it in Step 3

---

### **Step 3: Connect Invoice System to Product Tracking**

1. Open your **MAIN** invoice spreadsheet: https://docs.google.com/spreadsheets/d/1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM
2. Go to Extensions → Apps Script
3. Find the `sendProductsToTracking` function (at the bottom of קוד.gs)
4. Replace this line:
   ```javascript
   const PRODUCTS_SCRIPT_URL = 'PASTE_DEPLOYED_PRODUCTS_SCRIPT_URL_HERE';
   ```
   With:
   ```javascript
   const PRODUCTS_SCRIPT_URL = 'YOUR_URL_FROM_STEP_2';
   ```
5. Save (Ctrl+S)

**Example:**

```javascript
const PRODUCTS_SCRIPT_URL =
  'https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec';
```

---

### **Step 4: Test the System**

#### **Test 1: Price History Sheet Initialization**

1. Open: https://docs.google.com/spreadsheets/d/1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
2. Check "היסטוריית שינויי מחירים" sheet
3. Verify headers in row 1:
   - A1: ספק
   - B1: מוצר
   - C1: מחיר לפני מע״מ
   - D1: תאריך

#### **Test 2: Manual Product Processing**

1. In Apps Script (products tracking spreadsheet)
2. Run function: `testProcessProducts`
3. Check execution log:
   - Should see "Processing 2 products for supplier: מקאנו"
   - Should see "✚ New product: חלב 3%" and "✚ New product: קמח לבן"
4. Check "מקאנו" sheet:
   - Row 2 should have: חלב 3% | 5.80
   - Row 3 should have: קמח לבן | 3.50
5. Check "היסטוריית שינויי מחירים" sheet:
   - Should have 2 new rows with the test products

#### **Test 3: End-to-End Invoice Scan**

1. Scan a test invoice from a priority supplier (e.g., מקאנו, צח)
2. After successful submission, check:
   - **Main spreadsheet** (1De973...) - Invoice summary saved ✅
   - **Products spreadsheet** (1vPVl...) - Supplier sheet has products ✅
   - **Products spreadsheet** (1vPVl...) - Price history updated ✅

---

## 🔧 How It Works

### **Flow:**

```
1. User scans invoice
   ↓
2. Gemini AI extracts:
   - Invoice summary (supplier, date, total, etc.)
   - Products list (name, quantity, unit, price before VAT)
   ↓
3. Invoice summary → Main spreadsheet (1De973...)
   ↓
4. Products → Product tracking spreadsheet (1vPVl...)
   ↓
5. Apps Script processes each product:
   - Check if product exists in supplier sheet
   - If NEW → Add to supplier sheet + price history
   - If EXISTS → Check if price changed
     - Changed → Update supplier sheet + add to price history
     - Unchanged → Do nothing
```

---

## 🎯 Key Features

### **1. Fuzzy Matching**

The system recognizes products even with slight variations:

| Invoice Shows  | Matches Existing |
| -------------- | ---------------- |
| "חלב טרי 3%"   | "חלב 3%"         |
| "קמח לבן 1 קג" | "קמח לבן"        |
| "שוקולד מריר"  | "שוקולד מריר"    |

**Threshold:** 85% similarity required for match

---

### **2. Price Before VAT**

All prices are stored **before VAT (לפני מע״מ)**

- If invoice shows prices with VAT, AI automatically divides by 1.17
- Ensures accurate price tracking and comparisons

---

### **3. Automatic Supplier Sheets**

- Supplier sheets created automatically on first invoice
- No manual sheet creation needed
- Consistent formatting across all suppliers

---

### **4. Excluded Categories**

Products are **NOT** tracked for:

- **שונות** (other category)

All other categories (priority suppliers, תחנת דלק, רשתות מזון, משתלות) are tracked.

---

## 📊 Analytics Examples

### **Track Price Changes for Specific Product**

```
=QUERY(היסטוריית_שינויי_מחירים!A:D,
  "SELECT D, A, C WHERE B='חלב 3%' ORDER BY D",
  1)
```

### **Average Price by Supplier**

```
=QUERY(היסטוריית_שינויי_מחירים!A:D,
  "SELECT A, AVG(C) WHERE B='קמח לבן' GROUP BY A",
  1)
```

### **Price Changes This Month**

```
=QUERY(היסטוריית_שינויי_מחירים!A:D,
  "SELECT A, B, C, D WHERE D >= date '2024-12-01'",
  1)
```

---

## ⚠️ Troubleshooting

### **Problem: Products not appearing in tracking spreadsheet**

**Check:**

1. ✅ Products script URL configured in קוד.gs (Step 3)?
2. ✅ Products script deployed as Web App with "Anyone" access?
3. ✅ Invoice has products array in AI response?
4. ✅ Supplier category is NOT "other" (שונות)?

**Debug:**

1. Open Apps Script execution logs (View → Executions)
2. Look for "📦 Sending products to tracking spreadsheet..."
3. Check for errors

---

### **Problem: Price not updating**

**Reason:** Price difference must be > 0.01 to register as change

**Example:**

- Old: 5.80
- New: 5.80 → No update ✅
- New: 5.81 → Update ✅
- New: 5.79 → Update ✅

---

### **Problem: Duplicate products in supplier sheet**

**Reason:** Product names too different for fuzzy matching

**Solution:**

1. Manually merge duplicates (copy price history, delete duplicate)
2. Future invoices will match correctly

---

## 🔐 Security Notes

- **Products tracking script** must have "Anyone" access to receive data from main script
- **Main invoice script** already has "Anyone" access (no change needed)
- Both scripts run under YOUR Google account
- No external parties can access or modify data

---

## 💾 Backup Recommendations

The product tracking spreadsheet contains valuable historical data:

1. **Manual Backup:** File → Download → Microsoft Excel (.xlsx)

   - Do this monthly
   - Store in Google Drive backup folder

2. **Automatic Backup:** Consider setting up monthly backup (similar to invoice backup system)

---

## 📈 Cost Analysis

**Token Usage:**

- Without products: ~1,000 tokens/invoice
- With products: ~1,400 tokens/invoice (+40%)

**Cost:**

- Without: $0.001/invoice
- With: $0.0015/invoice
- **Extra: $0.0005 per invoice** (0.05 cents)

**Monthly (85 invoices):**

- Extra cost: **$0.04** (4 cents)

**Annual:**

- Extra cost: **$0.50** (50 cents)

✅ **Still well within Gemini free tier!**

---

## 🎓 Best Practices

### **1. Regular Review**

- Weekly: Check היסטוריית שינויי מחירים for unusual price jumps
- Monthly: Review supplier sheets for duplicate products

### **2. Product Name Consistency**

- Don't manually edit product names in supplier sheets
- Let the AI extract names as-is
- Fuzzy matching will handle variations

### **3. Price Alerts**

Use conditional formatting in היסטוריית שינויי מחירים:

- Red: Price increase > 10%
- Yellow: Price increase 5-10%
- Green: Price decrease

### **4. Data Validation**

Occasionally spot-check:

- Does AI-extracted price match invoice?
- Are products categorized under correct supplier?

---

## 📞 Support

If you encounter issues:

1. Check Apps Script execution logs (View → Executions)
2. Look for error messages in logs
3. Verify all URLs and IDs are correct
4. Test with `testProcessProducts` function
5. Check that היסטוריית שינויי מחירים sheet exists and has headers

---

## 🎉 Success Checklist

After installation, you should have:

- ✅ היסטוריית שינויי מחירים sheet with headers
- ✅ Products tracking script deployed and URL configured
- ✅ Test run successful (testProcessProducts)
- ✅ End-to-end invoice scan working
- ✅ Products appearing in supplier sheets
- ✅ Price history recording changes

**Congratulations! Your product tracking system is live!** 🎊

---

## 📝 Next Steps (Optional Enhancements)

### **Dashboard Sheet**

Create a "Dashboard" sheet with:

- Top 10 price increases this month
- Chart: Price trends over time
- Supplier price comparison

### **Price Alerts**

Set up Google Sheets notifications:

- Email when price increases > 15%
- Weekly summary of price changes

### **Export Reports**

Monthly price change report:

- Export היסטוריית שינויי מחירים to Excel
- Share with management/accountant
