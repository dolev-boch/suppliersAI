# Product Tracking - Debugging Guide

## 🔍 How to Debug "Nothing Sent to Products Spreadsheet"

---

## Step 1: Check Main Spreadsheet Logs

### **Open Main Spreadsheet:**
https://docs.google.com/spreadsheets/d/1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM

### **View Logs:**
1. Extensions → Apps Script
2. Click: **View → Executions** (or "תצוגה → הפעלות")
3. Find the most recent `doPost` execution
4. Click on it to expand

### **What You Should See:**

**✅ SUCCESS - Products being sent:**
```
📨 Received data: {...}
📋 Target sheet: מקאנו
📦 Found 5 products
✅ Sending products to tracking spreadsheet
📤 Sending to: https://script.google.com/macros/s/AKfycb.../exec
   Payload: {"supplier_name":"מקאנו","document_date":"20/12/2024","products":[...]}
📥 Response code: 200
   Response: {"success":true,"message":"Products processed successfully"}
✅ Products sent successfully to tracking spreadsheet
```

**❌ PROBLEM 1 - URL not configured:**
```
📨 Received data: {...}
📋 Target sheet: מקאנו
📦 Found 5 products
⚠️ Products script URL not configured. Skipping product tracking.
```
**FIX:** Configure `PRODUCTS_SCRIPT_URL` in line 42 of main script

**❌ PROBLEM 2 - Sheet is שונות (correct behavior):**
```
📨 Received data: {...}
📋 Target sheet: שונות
📦 Found 3 products
⚠️ Sheet is שונות - skipping product tracking
```
**FIX:** This is CORRECT! שונות products are not tracked.

**❌ PROBLEM 3 - No products extracted:**
```
📨 Received data: {...}
📋 Target sheet: מקאנו
⚠️ No products in request
```
**FIX:** Check browser console for AI extraction errors

**❌ PROBLEM 4 - HTTP error response:**
```
📨 Received data: {...}
📋 Target sheet: מקאנו
📦 Found 5 products
✅ Sending products to tracking spreadsheet
📤 Sending to: https://script.google.com/macros/s/AKfycb.../exec
📥 Response code: 302
   Response: <HTML redirect...>
⚠️ Products tracking response: 302 - ...
```
**FIX:** Products script not deployed correctly or wrong URL

---

## Step 2: Check Products Spreadsheet Logs

### **Open Products Spreadsheet:**
https://docs.google.com/spreadsheets/d/1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ

### **View Logs:**
1. Extensions → Apps Script
2. Click: **View → Executions** (or "תצוגה → הפעלות")
3. Check for executions

### **What You Should See:**

**✅ SUCCESS - Products received:**
```
📨 Received POST request for product tracking
📦 Raw postData: {"supplier_name":"מקאנו","document_date":"20/12/2024","products":[...]}
✅ Parsed data successfully
   Supplier: מקאנו
   Products count: 5
🚀 Processing 5 products...
Processing 5 products for supplier: מקאנו
✚ New product: חלב 3% (5.8)
✚ New product: קמח לבן (3.5)
...
✅ Products processed successfully!
```

**❌ PROBLEM 1 - No executions at all:**
**CAUSE:** Main script is not sending data OR URL is wrong
**FIX:** Check Step 1 logs first

**❌ PROBLEM 2 - Only doGet executions (shows "fail"):**
**CAUSE:** Something accessed the URL with GET instead of POST (this is normal, ignore it)
**NOTE:** doGet "failures" are NORMAL - they just mean someone browsed to the URL

**❌ PROBLEM 3 - doPost error:**
```
❌ ERROR in doPost: ...
   Stack: ...
```
**FIX:** Read the error message and check the stack trace

---

## Step 3: Verify Configuration

### **Check 1: Products Script Deployed**

1. Open products spreadsheet Apps Script
2. Click: **Deploy → Manage deployments**
3. You should see an active **Web app** deployment
4. **Copy the Web App URL**

**Example URL:**
```
https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXXXXXXXX/exec
```

### **Check 2: Main Script URL Configured**

1. Open main spreadsheet Apps Script
2. Find line ~42 (use Ctrl+F to search for `PRODUCTS_SCRIPT_URL`)
3. Verify it matches YOUR deployment URL from Check 1
4. Should look like:
```javascript
const PRODUCTS_SCRIPT_URL = 'https://script.google.com/macros/s/AKfycbxXXXXXXXXXXXXXXXXXXXXX/exec';
```

**Common mistakes:**
- ❌ Still has placeholder: `'PASTE_DEPLOYED_PRODUCTS_SCRIPT_URL_HERE'`
- ❌ Wrong URL (old deployment)
- ❌ Missing `/exec` at the end
- ❌ Extra spaces or quotes

### **Check 3: Deployment Settings**

1. In products spreadsheet Apps Script
2. Click: **Deploy → Manage deployments**
3. Click on the deployment (or ⚙️ icon)
4. Verify:
   - **Execute as:** Me (your email)
   - **Who has access:** Anyone ⚠️ IMPORTANT!

If "Who has access" is not "Anyone", change it:
1. Click **Edit** (pencil icon)
2. Change "Who has access" to **Anyone**
3. Click **Deploy**
4. Copy the NEW URL
5. Update main script with NEW URL

---

## Step 4: Test Products Script Directly

### **Run Test Function:**

1. Open products spreadsheet Apps Script
2. Select function: `testProcessProducts`
3. Click **Run** (▶️)
4. Check execution log (View → Executions)

**Expected log:**
```
Processing 2 products for supplier: מקאנו
✚ New product: חלב 3% (5.8)
   📝 Added to price history: מקאנו | חלב 3% | 5.8 | 15/12/2024
✚ New product: קמח לבן (3.5)
   📝 Added to price history: מקאנו | קמח לבן | 3.5 | 15/12/2024
✅ Processed 2 products for מקאנו
```

**Verify in spreadsheet:**
1. Sheet "מקאנו" should exist with 2 products
2. Sheet "היסטוריית שינויי מחירים" should have 2 entries

**If test works but real scan doesn't:**
→ Problem is in main script sending data

---

## Step 5: Check Browser Console

### **Open Browser Console:**
Press **F12** → Click **Console** tab

### **Scan an invoice and watch for:**

**✅ SUCCESS:**
```
✅ Invoice processed successfully
Data: {supplier_name: "מקאנו", products: Array(5), ...}
Response: {success: true, message: "Data added successfully to מקאנו"}
```

**❌ PROBLEM - No products in data:**
```
✅ Invoice processed successfully
Data: {supplier_name: "מקאנו", products: undefined, ...}
```
**FIX:** AI didn't extract products - check gemini.js

**❌ PROBLEM - JSON parse error:**
```
❌ Gemini API Error: SyntaxError: Expected ',' or ']' after array element
```
**FIX:** AI returned invalid JSON - already fixed in updated gemini.js

---

## Common Issues & Solutions

### **Issue: "Only doGet shows in products spreadsheet logs"**
**Explanation:** doGet "failures" are NORMAL - ignore them
**They mean:** Someone accessed the URL directly (browser, bot, etc.)
**Solution:** Check if there are ANY doPost executions. If not, data isn't being sent.

### **Issue: "Response code 302" in main spreadsheet logs**
**Explanation:** Products script URL is redirecting (wrong deployment)
**Solutions:**
1. Verify products script is deployed as **Web App**
2. Verify "Who has access" is **Anyone**
3. Create a NEW deployment
4. Update main script with new URL

### **Issue: "Products extracted but not sent"**
**Check main spreadsheet logs for:**
```
📦 Found X products
⚠️ Sheet is שונות - skipping product tracking
```
**If you see this for a NON-שונות supplier:**
→ Bug in sheet name detection (should be fixed in COMPLETE-FIXED version)

### **Issue: "No products extracted by AI"**
**Check browser console for:**
- JSON parsing errors
- AI response errors
- Empty products array in response

**Solutions:**
1. Verify invoice has clear product table
2. Check gemini.js has updated prompt with products section
3. Try scanning a clearer invoice

---

## Diagnostic Checklist

Run through this checklist:

- [ ] **Main spreadsheet script** = קוד-COMPLETE-FIXED.gs code
- [ ] **Products spreadsheet script** = products-tracking.gs code (with enhanced logging)
- [ ] **PRODUCTS_SCRIPT_URL** configured in main script (line 42)
- [ ] **Products script deployed** as Web App
- [ ] **Deployment access** = "Anyone"
- [ ] **היסטוריית שינויי מחירים** sheet exists with headers
- [ ] **Test function works** (testProcessProducts creates מקאנו sheet)
- [ ] **Main logs show** "📦 Found X products"
- [ ] **Main logs show** "✅ Sending products to tracking spreadsheet"
- [ ] **Main logs show** "📥 Response code: 200"
- [ ] **Products logs show** "📨 Received POST request"
- [ ] **Products logs show** "✅ Products processed successfully!"
- [ ] **Scanned supplier** is NOT שונות

---

## Next Steps

Based on what you see in the logs, you can determine:

1. **If main spreadsheet logs show products being sent with 200 response:**
   → Check products spreadsheet logs for doPost execution

2. **If main spreadsheet logs show warning about URL:**
   → Configure PRODUCTS_SCRIPT_URL

3. **If main spreadsheet logs show 302 or other error:**
   → Redeploy products script with "Anyone" access

4. **If no products in main logs:**
   → Check browser console for AI extraction errors

5. **If everything looks good but nothing in products spreadsheet:**
   → Share the logs here for detailed analysis

---

## Example: Full Successful Flow

### **Main Spreadsheet Log:**
```
📨 Received data: {supplier_name: "מקאנו", document_date: "20/12/2024", products: [...]}
✅ Priority supplier matched: "מקאנו" → "מקאנו" (exact)
supplier_category: 'priority'
📋 Target sheet: מקאנו
Writing to sheet: מקאנו, row: 7
📦 Found 5 products
✅ Sending products to tracking spreadsheet
📤 Sending to: https://script.google.com/macros/s/AKfycbxXXX.../exec
   Payload: {"supplier_name":"מקאנו","document_date":"20/12/2024","products":[{...},{...},...]}
📥 Response code: 200
   Response: {"success":true,"message":"Products processed successfully"}
✅ Products sent successfully to tracking spreadsheet
✅ Data written successfully
```

### **Products Spreadsheet Log:**
```
📨 Received POST request for product tracking
📦 Raw postData: {"supplier_name":"מקאנו","document_date":"20/12/2024","products":[...]}
✅ Parsed data successfully
   Supplier: מקאנו
   Products count: 5
🚀 Processing 5 products...
Processing 5 products for supplier: מקאנו
✚ New product: חלב 3% (5.8)
   📝 Added to price history: מקאנו | חלב 3% | 5.8 | 20/12/2024
✚ New product: קמח לבן (3.5)
   📝 Added to price history: מקאנו | קמח לבן | 3.5 | 20/12/2024
✚ New product: שוקולד מריר (42)
   📝 Added to price history: מקאנו | שוקולד מריר | 42 | 20/12/2024
✚ New product: ביצים L (1.7)
   📝 Added to price history: מקאנו | ביצים L | 1.7 | 20/12/2024
✚ New product: חמאה (8.5)
   📝 Added to price history: מקאנו | חמאה | 8.5 | 20/12/2024
✅ Processed 5 products for מקאנו
```

### **Result:**
- ✅ Invoice summary in main spreadsheet
- ✅ מקאנו sheet created/updated with 5 products
- ✅ 5 entries added to היסטוריית שינויי מחירים

---

## Need Help?

**Share these details:**
1. Main spreadsheet logs (latest doPost execution)
2. Products spreadsheet logs (any doPost executions?)
3. PRODUCTS_SCRIPT_URL value from main script
4. Deployment settings screenshot

This will help diagnose the exact issue! 🔧
