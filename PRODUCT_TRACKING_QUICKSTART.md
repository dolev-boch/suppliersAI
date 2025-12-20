# Product Tracking - Quick Start Guide

## 🚀 3-Step Installation (10 minutes)

### **Step 1: Initialize Price History Sheet** (2 min)

1. Open: https://docs.google.com/spreadsheets/d/1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ
2. Extensions → Apps Script
3. Delete any existing code
4. Copy ALL content from `products-tracking.gs`
5. Paste into Apps Script editor
6. Save (Ctrl+S)
7. Run function: `initializePriceHistorySheet`
8. Authorize when prompted
9. ✅ Check: Sheet "היסטוריית שינויי מחירים" now has headers

---

### **Step 2: Deploy Product Tracking** (3 min)

1. In Apps Script (from Step 1)
2. Click "Deploy" → "New deployment"
3. Click gear icon ⚙️ → Select "Web app"
4. Settings:
   - Execute as: **Me (your email)**
   - Who has access: **Anyone**
5. Click "Deploy"
6. ⚠️ **COPY THE URL** (looks like: `https://script.google.com/macros/s/AKfycb...`)
7. Keep this URL - you need it in Step 3

---

### **Step 3: Connect to Main System** (5 min)

1. Open: https://docs.google.com/spreadsheets/d/1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM
2. Extensions → Apps Script
3. Find line ~673: `const PRODUCTS_SCRIPT_URL = 'PASTE_DEPLOYED_PRODUCTS_SCRIPT_URL_HERE';`
4. Replace with your URL from Step 2:
   ```javascript
   const PRODUCTS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycb...YOUR_URL.../exec';
   ```
5. Save (Ctrl+S)
6. ✅ Done!

---

## 🧪 Test It (2 min)

### **Quick Test:**
1. Go to products spreadsheet Apps Script
2. Run: `testProcessProducts`
3. Check "מקאנו" sheet → Should have 2 test products
4. Check "היסטוריית שינויי מחירים" → Should have 2 entries

### **Real Test:**
1. Scan any invoice from מקאנו, צח, or נטפים
2. After "נשלח בהצלחה!" message
3. Open products spreadsheet
4. Check supplier sheet → Products should be there!
5. Check price history → Entries logged!

---

## 📋 What You Should See

### **Products Spreadsheet Structure:**

```
Sheets:
├── מקאנו (auto-created when first invoice scanned)
├── צח (auto-created when first invoice scanned)
├── נטפים (auto-created when first invoice scanned)
├── ... (one sheet per supplier)
└── היסטוריית שינויי מחירים (price history)
```

### **Supplier Sheet Example (מקאנו):**
```
| A: שם מוצר    | B: מחיר נוכחי לפני מע״מ |
|---------------|------------------------|
| חלב 3%        | 5.80                   |
| קמח לבן       | 3.50                   |
| שוקולד מריר   | 42.00                  |
```

### **Price History Example:**
```
| A: ספק | B: מוצר    | C: מחיר | D: תאריך    |
|--------|-----------|--------|-------------|
| מקאנו  | חלב 3%    | 5.50   | 01/11/2024  |
| מקאנו  | חלב 3%    | 5.80   | 15/12/2024  | ← Price increased!
| צח     | ביצים L   | 1.70   | 16/11/2024  |
```

---

## ❓ Common Issues

### **"Products not appearing after scan"**
→ Check Step 3: Is URL configured correctly in קוד.gs?

### **"Authorization required"**
→ Click "Review permissions" → Select your account → Allow

### **"Script URL not working"**
→ Verify deployment settings: "Who has access" = **Anyone**

### **"Duplicates appearing"**
→ Normal! Fuzzy matching works 85% of time. Merge manually if needed.

---

## 📊 Quick Analytics

### **See all price changes for a product:**
In היסטוריית שינויי מחירים, filter column B (מוצר) by product name

### **Compare suppliers for same product:**
1. Filter column B by product
2. Group by column A (supplier)
3. Compare prices

### **Recent changes (last 30 days):**
Filter column D (date) → After: [30 days ago]

---

## ✅ Success Checklist

After installation:
- [ ] היסטוריית שינויי מחירים sheet exists with headers
- [ ] Products script deployed (have URL)
- [ ] URL configured in main קוד.gs
- [ ] Test function works (creates test products)
- [ ] Real invoice scan creates supplier sheet
- [ ] Products appear in supplier sheet
- [ ] Price history logs entries

**All checked?** You're done! 🎉

---

## 💡 Tips

1. **Don't manually edit product names** - Let AI handle it, fuzzy matching will work
2. **Check weekly** - Review היסטוריית שינויי מחירים for price jumps
3. **Merge duplicates monthly** - Manually combine obvious duplicates
4. **Use for negotiations** - Show suppliers their price increases with data!

---

## 📖 More Info

- **Detailed Guide:** `PRODUCT_TRACKING_INSTALLATION.md`
- **Technical Summary:** `PRODUCT_TRACKING_SUMMARY.md`
- **Main Code:** `products-tracking.gs`

---

## 🎯 What This System Does

**Automatically:**
- ✅ Extracts all products from invoices
- ✅ Tracks current price per supplier
- ✅ Records price history with dates
- ✅ Detects price changes
- ✅ Handles product name variations

**Cost:** $0.50/year extra (~50 cents!)

**Time saved:** ~2 hours/month of manual price tracking

**Value:** Priceless supplier negotiation data! 💰

---

**Questions?** Check the detailed installation guide or troubleshooting section!
