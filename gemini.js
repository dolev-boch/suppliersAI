// Gemini AI Integration with Request Queue and Optimized Prompts
// ✅ FIXED VERSION - JSON parsing errors resolved, token limit increased

const GeminiService = {
  /**
   * Analyze invoice image with Gemini AI (using request queue)
   */
  async analyzeInvoice(base64Image, onProgress = null) {
    // Use the request queue to serialize and throttle requests
    return geminiQueue.enqueue(async () => {
      return await this.performAnalysis(base64Image, onProgress);
    });
  },

  /**
   * Perform the actual API call with timeout and retry (called by the queue)
   */
  async performAnalysis(base64Image, onProgress = null) {
    const MAX_RETRIES = 5;
    const TIMEOUT_MS = 60000; // 60 seconds - adequate for regular Flash model
    const RETRY_DELAYS = [500, 1000, 2000, 3000]; // Faster retries

    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1];
          const message = `ממתין ${Math.round(delay / 1000)} שניות לפני ניסיון ${attempt + 1}...`;
          console.log(`⏳ ${message}`);
          if (onProgress) onProgress({ status: 'retrying', attempt, message });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const message =
          attempt === 0 ? 'מנתח חשבונית...' : `ניסיון ${attempt + 1} מתוך ${MAX_RETRIES}...`;
        console.log(`🚀 ${message}`);
        if (onProgress)
          onProgress({ status: 'analyzing', attempt: attempt + 1, total: MAX_RETRIES, message });

        const apiUrl = `${CONFIG.GEMINI_API_URL}/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

        // ✅ FIX #1: Increase max output tokens and ensure proper generation config
        const generationConfig = {
          temperature: CONFIG.GENERATION_CONFIG?.temperature || 0.1,
          topK: CONFIG.GENERATION_CONFIG?.topK || 32,
          topP: CONFIG.GENERATION_CONFIG?.topP || 0.95,
          maxOutputTokens: 8192, // ✅ INCREASED from 2048 to 8192 for large invoices
        };

        const requestBody = {
          contents: [
            {
              parts: [
                { text: this.buildPrompt() },
                {
                  inline_data: {
                    mime_type: 'image/jpeg',
                    data: base64Image,
                  },
                },
              ],
            },
          ],
          generationConfig: generationConfig,
        };

        // Create abort controller for timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => {
          console.log(`⏰ Timeout after ${TIMEOUT_MS / 1000} seconds - aborting attempt ${attempt + 1}...`);
          if (onProgress)
            onProgress({
              status: 'timeout',
              attempt: attempt + 1,
              message: 'זמן התגובה פג - מנסה שוב...',
            });
          controller.abort();
        }, TIMEOUT_MS);

        try {
          const response = await fetch(apiUrl, {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
            },
            body: JSON.stringify(requestBody),
            signal: controller.signal,
          });

          clearTimeout(timeoutId);

          if (!response.ok) {
            const errorData = await response.json();
            const errorMsg = errorData.error?.message || 'שגיאת API';

            // Throw error with status code for retry logic
            if (response.status === 429) {
              throw new Error('429 Rate limit exceeded');
            }

            throw new Error(errorMsg);
          }

          const data = await response.json();
          const usage = data.usageMetadata;
          const text = data.candidates[0].content.parts[0].text;

          console.log('✅ Gemini Response received');
          console.log('Token usage:', usage);
          if (onProgress) onProgress({ status: 'processing', message: 'עיבוד תשובה...' });

          // ✅ FIX #2: Improved JSON extraction with repair logic
          let jsonText = text.trim();

          // Remove markdown code fences if present
          if (jsonText.startsWith('```json')) {
            jsonText = jsonText.replace(/```json\s*/g, '').replace(/```\s*$/g, '');
          } else if (jsonText.startsWith('```')) {
            jsonText = jsonText.replace(/```\s*/g, '').replace(/```\s*$/g, '');
          }

          // Extract JSON using regex as fallback
          const jsonMatch = jsonText.match(/\{[\s\S]*\}/);
          if (jsonMatch) {
            jsonText = jsonMatch[0];
          }

          // ✅ FIX #2b: Repair truncated JSON
          if (!jsonText.trim().endsWith('}')) {
            console.warn('⚠️ JSON appears truncated, attempting repair...');

            // Find last complete product object
            const lastCompleteProduct = jsonText.lastIndexOf('},');
            if (lastCompleteProduct !== -1) {
              // Find if we're inside products array
              const productsStart = jsonText.indexOf('"products": [');
              if (productsStart !== -1 && lastCompleteProduct > productsStart) {
                // Truncate to last complete product and close the array/object
                jsonText = jsonText.substring(0, lastCompleteProduct + 1) + ']}';
                console.log('✅ JSON repaired - removed incomplete product entries');
              }
            } else {
              // If no complete products, try to close whatever we have
              if (jsonText.includes('"products": [')) {
                const lastBrace = jsonText.lastIndexOf('}');
                if (lastBrace !== -1) {
                  jsonText = jsonText.substring(0, lastBrace + 1);
                }
                if (!jsonText.endsWith(']}')) {
                  jsonText = jsonText + ']}';
                }
                console.log('⚠️ JSON severely truncated, added minimal closing');
              }
            }
          }

          // Parse JSON
          let parsed;
          try {
            parsed = JSON.parse(jsonText);
          } catch (jsonError) {
            console.error('Invalid JSON from AI:', jsonText);
            console.error('JSON Parse Error:', jsonError.message);
            throw new Error(`AI returned invalid JSON: ${jsonError.message}`);
          }

          // Log what AI detected for debugging
          console.log('🔍 AI detected document_type:', parsed.document_type);
          console.log('🔍 AI detected total_amount:', parsed.total_amount);
          if (parsed.document_type === 'credit_invoice') {
            console.log('💳 Credit invoice detected by AI!');
          }

          // ✅ FIX #3: Deduplicate and limit products
          if (parsed.products && parsed.products.length > 0) {
            const originalCount = parsed.products.length;

            // Deduplicate identical products by consolidating quantities
            const productMap = new Map();
            parsed.products.forEach((product) => {
              const key = this.normalizeProductName(product.name);

              if (productMap.has(key)) {
                // Product exists - add quantities
                const existing = productMap.get(key);
                existing.quantity += product.quantity;
                existing.total_before_vat += product.total_before_vat;
              } else {
                // New product
                productMap.set(key, { ...product });
              }
            });

            // Replace products array with deduplicated version
            parsed.products = Array.from(productMap.values());

            if (originalCount !== parsed.products.length) {
              console.log(
                `✅ Products deduplicated: ${originalCount} → ${parsed.products.length} unique products`
              );
            }

            // Limit to max 100 products to prevent huge responses
            if (parsed.products.length > 100) {
              console.warn(`⚠️ Too many products (${parsed.products.length}), limiting to 100`);
              parsed.products = parsed.products.slice(0, 100);
            }
          }

          // Validate and categorize the response
          const validated = this.validateResponse(parsed);

          console.log(`✅ Request succeeded on attempt ${attempt + 1}`);
          if (onProgress)
            onProgress({
              status: 'success',
              attempt: attempt + 1,
              message: 'החשבונית נותחה בהצלחה!',
            });

          return {
            ...validated,
            usage: usage,
          };
        } catch (fetchError) {
          clearTimeout(timeoutId);

          // Handle timeout
          if (fetchError.name === 'AbortError') {
            throw new Error(`Request timed out after ${TIMEOUT_MS / 1000} seconds (attempt ${attempt + 1})`);
          }

          throw fetchError;
        }
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt + 1} failed:`, error.message);

        // Don't retry on certain errors
        if (error.message.includes('invalid JSON') || error.message.includes('לא הצלחתי לפרק')) {
          console.error('❌ Non-retryable error - giving up');
          if (onProgress) onProgress({ status: 'error', message: 'שגיאה בפענוח התגובה' });
          throw error;
        }

        // If this was the last attempt, throw
        if (attempt === MAX_RETRIES - 1) {
          console.error(`❌ All ${MAX_RETRIES} attempts failed`);
          if (onProgress)
            onProgress({
              status: 'failed',
              message: `כל ${MAX_RETRIES} הניסיונות נכשלו. נא לרענן ולנסות שוב.`,
            });
          throw new Error(`Failed after ${MAX_RETRIES} attempts. Last error: ${error.message}`);
        }

        // Otherwise continue to next retry
        const message = `ניסיון ${attempt + 1} נכשל - מנסה שוב...`;
        console.log(`🔄 ${message}`);
        if (onProgress) onProgress({ status: 'retry', attempt: attempt + 1, message });
      }
    }

    // Should never reach here, but just in case
    throw lastError || new Error('Unknown error during retries');
  },

  /**
   * ✅ NEW: Normalize product name for deduplication
   */
  normalizeProductName(name) {
    return name
      .toLowerCase()
      .trim()
      .replace(/\s+/g, ' ')
      .replace(/[״׳'"]/g, '')
      .replace(/\./g, '')
      .replace(/,/g, '');
  },

  /**
   * Build OPTIMIZED prompt for Gemini
   * ✅ UPDATED: Added product consolidation instructions
   */
  buildPrompt() {
    const prioritySuppliers = SUPPLIERS.priority.join('", "');

    return `אתה מומחה לזיהוי חשבוניות בעברית. חלץ מידע מדויק ותן JSON בלבד.

## 🚨 בדיקה ראשונה - חשבונית זיכוי

חפש "זיכוי" או "Credit" במסמך → document_type: "credit_invoice"

דוגמאות: "חשבונית מס זיכוי", "זיכוי", "Credit Note"

חובה: סכום שלילי ("-256.50"), notes: "חשבונית זיכוי"

## סדר זיהוי ספק (בדוק בסדר זה):

### 1. ספקים בעדיפות (PRIORITY):
"${prioritySuppliers}"

כללי זיהוי:
- חפש שם בולט בכותרת/לוגו (עברית או אנגלית)
- התעלם מ: בע"מ, Ltd
- אם יש כמה שמות - קח הגדול והבולט
- אם נמצא → supplier_category: "priority", supplier_name: [שם מהרשימה]

### 2. קטגוריות מיוחדות (רק אם לא priority):

**תחנת דלק:** Yellow, דור אלון, סונול, פז, Ten, באר מרים, שלמה סיקסט
מילות זיהוי: דלק, תדלוק, fuel, בנזין, דיזל, ליטר
→ supplier_category: "fuel_station"

**רשתות מזון:** ויקטורי, רמי לוי, דוכן צמח (קח לוגו ראשי גדול, לא סאב-לוגו)
מילות זיהוי: סופר, supermarket, שוק, מרכול
חשוב: רשתות מזון = תמיד invoice (לא delivery_note) + חובה 4 ספרות כרטיס אשראי
→ supplier_category: "supermarket"

**משתלות:**
מילות זיהוי: משתלה, משתלת, גננות, nursery, גינון, עציצים, מוצרי נוי, נוי, פרחים, garden
**שים לב:** המילה "צמחים" או "צמח" לבד אינה מספיקה! (דוכן צמח = רשתות מזון)
→ supplier_category: "nursery"

### 3. שונות (אם שום קטגוריה לא התאימה):
→ supplier_category: "other"

## שדות נדרשים:

**מספר מסמך:**
זהה סוג מסמך, חפש מספר ליד כותרת מתאימה:
- חשבונית מס: "מספר חשבונית", "Invoice Number"
- תעודת משלוח: "מספר תעודת משלוח", "Delivery Note"
- חשבונית זיכוי: "חשבונית זיכוי" + מספר ליד
כלל זהב: קח מספר מיד אחרי כותרת (לא מספר אקראי), מלא (10-15 ספרות)

**תאריך:**
פורמט DD/MM/YYYY, שנה 2024-2025 בלבד (תאריך מסמך, לא תשלום עתידי)
- דוגמאות שגויות: 15/12/20 (צריך 2020 או 2025), 15/12/2023 (ישן מדי)

**סכום:**
- הסכום הכולל הסופי בשקלים
- **אם חשבונית זיכוי:** הסכום חייב להיות **שלילי** (עם מינוס -), לדוגמה: "-256.50"
- **אם חשבונית רגילה:** הסכום חיובי, לדוגמה: "256.50"

**כרטיס אשראי (קריטי!):**
- **חובה לבדוק ולמצוא** עבור: תחנת דלק (fuel_station), רשתות מזון (supermarket), משתלות (nursery), שונות (other)
- חפש בקפידה **4 ספרות אחרונות** של כרטיס אשראי בחלק התשלום של החשבונית
- **איפה לחפש:** באזור פרטי התשלום, סוג תשלום, פירוט אמצעי תשלום
- **פורמטים נפוצים:**
  - "****1234" או "XXXX1234" → קח 1234
  - "מספר כרטיס: 1234" → קח 1234
  - "כרטיס אשראי 1234" → קח 1234
  - חפש 4 ספרות ליד "אשראי", "כרטיס", "credit card"
- אל תבלבל עם: מספר חשבונית, עסקה, אישור, טרמינל
- ספקי priority → תמיד null
- אם לא נמצא → null

## מוצרים (PRODUCTS):

**חובה לחלץ את כל שורות המוצרים מהחשבונית!**

עבור כל מוצר בטבלה, חלץ:
- **שם המוצר:** בדיוק כפי שכתוב (ללא קיצורים, ללא נורמליזציה)
- **כמות:** מספר
- **יחידה:** ק״ג, ליטר, יח׳, מארז, גרם, מ״ל, וכו׳
- **מחיר ליחידה לפני מע״מ:** המחיר שכתוב בעמודה "מחיר" (כבר לפני מע״מ!)
- **סה״כ לפני מע״מ:** המחיר שכתוב בעמודה "סה״כ" (כבר לפני מע״מ!)

## ⚠️ כללים קריטיים!

### 1-2. המחירים כבר לפני מע״מ + מחיר ליחידה כבר נתון
אל תחלק ב-1.17! אל תחלק סה״כ/כמות!
פשוט העתק את המחיר מעמודה "מחיר" כמו שכתוב

### 3. !!! הנחות - חשוב מחדש את מחיר היחידה !!!

זה הכלל החשוב ביותר! תשים לב!

כשרואה שורת "הנחה" או "ה.בש" מתחת למוצר - חייב לעשות חישוב מחדש!

השלבים:
שלב 1: קח את הסה״כ המקורי
שלב 2: חסר את סכום ההנחה
שלב 3: חלק את התוצאה בכמות = מחיר יחידה חדש

דוגמה 1 - גרנד פדנו מגורד:
שורה 1: גרנד פדנו מגורד | כמות: 2 | מחיר: 96.83 | סה״כ: 193.66
שורה 2: הנחה | -15.00

שלב 1: הסה״כ המקורי = 193.66
שלב 2: 193.66 - 15.00 = 178.66 (סה״כ אחרי הנחה)
שלב 3: 178.66 ÷ 2 = 89.33 (מחיר ליחידה אחרי הנחה)

תשובה נכונה: unit_price_before_vat: 89.33, total_before_vat: 178.66
תשובה שגויה: unit_price_before_vat: 96.83 (זה המחיר לפני ההנחה!)
תשובה שגויה: unit_price_before_vat: 10.97 (זה חישוב לא נכון!)

דוגמה 2 - שמנת ק"ג טבעי:
שורה 1: שמנת ק"ג טבעי | כמות: 8 | מחיר: 36.90 | סה״כ: 295.20
שורה 2: הנחה | -20.00

שלב 1: הסה״כ המקורי = 295.20
שלב 2: 295.20 - 20.00 = 275.20 (סה״כ אחרי הנחה)
שלב 3: 275.20 ÷ 8 = 34.40 (מחיר ליחידה אחרי הנחה)

תשובה נכונה: unit_price_before_vat: 34.40, total_before_vat: 275.20
תשובה שגויה: unit_price_before_vat: 36.90 (זה המחיר לפני ההנחה!)
תשובה שגויה: unit_price_before_vat: 29.52 (זה חישוב לא נכון!)

זכור: ההנחה היא בשקלים על הסה״כ, לא אחוזים!

### 4. אין הנחה - קח את המחיר בדיוק
דוגמה:
ריקוטה ק"ג         3 יח׳    מחיר: 52.14    סה״כ: 156.42

- אין הנחה = אין חישוב
- פשוט העתק: unit_price_before_vat: 52.14, total_before_vat: 156.42

### 5. אל תמציא מוצרים!
- חלץ רק מוצרים שאתה רואה בפועל
- אל תנחש, אל תמציא, אל להוסיף מוצרים
- אם לא בטוח בשם - דלג עליו

### 6. צבור מוצרים זהים
אם אותו מוצר מופיע במספר שורות - צבור למוצר אחד
דוגמה: אם רואה 3 שורות זהות של "קופסאות מדרום 50 יח׳" כל אחת 1 יחידה במחיר 6.50
החזר רשומה אחת: quantity=3, unit_price_before_vat=6.50, total_before_vat=19.50

### 7. דלג על שורות שאינן מוצרים
דלג על: סכומי ביניים, מע״מ, סיכומים, כותרות, שורות הנחה (הן חלק מהמוצר שלפניהן)

### 8. מקסימום 50 מוצרים שונים
אם יש יותר - צבור דומים וקח את החשובים

## JSON:
{
  "supplier_category": "priority|fuel_station|supermarket|nursery|other",
  "supplier_name": "שם הספק",
  "supplier_confidence": 95,
  "document_number": "מלא",
  "document_number_confidence": 98,
  "document_type": "invoice|delivery_note|credit_invoice",
  "notes": "הערות נוספות (אם חשבונית זיכוי - חייב להכיל 'חשבונית זיכוי')",
  "document_date": "DD/MM/YYYY",
  "date_confidence": 95,
  "total_amount": "234.50",
  "total_confidence": 98,
  "credit_card_last4": "1234|null",
  "credit_card_confidence": 90,
  "products": [
    {
      "name": "שם מוצר מלא",
      "quantity": 10,
      "unit": "ליטר|ק״ג|יח׳|מארז|גרם|מ״ל",
      "unit_price_before_vat": 5.80,
      "total_before_vat": 58.00
    }
  ]
}

**חשוב מאוד:**
- עבור supplier_category: "priority" → תמיד credit_card_last4: null
- עבור fuel_station, supermarket, nursery, other → **חפש בקפידה** את ה-4 ספרות של כרטיס האשראי!

כללים:
- אסור להמציא מידע
- עקוב באלגוריתם הזיהוי בדיוק
- confidence גבוה (90+) רק למידע ברור
- document_type: "invoice" לחשבונית מס, "delivery_note" לתעודת משלוח, "credit_invoice" לחשבונית זיכוי
- **חשבונית זיכוי:** אם זיהית חשבונית זיכוי → סכום שלילי + "חשבונית זיכוי" בהערות
- כרטיס אשראי: חפש בכל החשבונית, אל תפספס!

**חשוב! תבנית JSON:**
- החזר **רק** JSON תקין, ללא טקסט נוסף
- כל מוצר במערך products חייב להיות אובייקט תקין עם כל השדות
- אם אין מוצרים, החזר "products": []
- ודא שיש פסיק אחרי כל אובייקט מוצר (חוץ מהאחרון)
- ודא שכל מחרוזות בתוך גרשיים כפולים
- **אם מוצרים חוזרים על עצמם - צבור אותם לרשומה אחת!**

נתח עכשיו:`;
  },

  /**
   * Validate and categorize AI response
   */
  validateResponse(response) {
    console.log('Validating AI response:', response);

    const supplierName = response.supplier_name || '';
    const supplierCategory = response.supplier_category || '';

    // Validate priority supplier match
    const priorityMatch = SupplierMatcher.findPriorityMatch(supplierName);
    if (priorityMatch.matched) {
      console.log(
        `✅ Priority supplier matched: "${supplierName}" → "${priorityMatch.supplier}" (${priorityMatch.matchType})`
      );
      return {
        ...response,
        supplier_category: 'priority',
        supplier_name: priorityMatch.supplier,
        supplier_confidence: Math.max(response.supplier_confidence || 90, priorityMatch.confidence),
      };
    }

    // Validate category match
    if (['fuel_station', 'supermarket', 'nursery'].includes(supplierCategory)) {
      const categoryMatch = SupplierMatcher.findCategoryMatch(supplierName);
      if (categoryMatch.matched) {
        console.log('✅ Category matched:', categoryMatch.category);

        let validatedResponse = {
          ...response,
          supplier_category: supplierCategory,
          supplier_name: categoryMatch.supplierName || supplierName,
          supplier_confidence: Math.max(
            response.supplier_confidence || 85,
            categoryMatch.confidence
          ),
        };

        // CRITICAL: Enforce supermarket rules
        if (supplierCategory === 'supermarket') {
          // Rule 1: Supermarkets are ALWAYS invoices, never delivery notes (unless credit invoice)
          if (validatedResponse.document_type === 'delivery_note') {
            console.log('🔧 Correcting supermarket document type from delivery_note to invoice');
            validatedResponse.document_type = 'invoice';
          }

          // Rule 2: Supermarkets MUST have credit card (warn if missing)
          if (
            !validatedResponse.credit_card_last4 ||
            validatedResponse.credit_card_last4 === 'null'
          ) {
            console.warn('⚠️ WARNING: Supermarket missing credit card - this should not happen!');
            // Don't block, but log prominently
          }
        }

        // CRITICAL: Handle credit invoices (חשבונית זיכוי)
        if (validatedResponse.document_type === 'credit_invoice') {
          console.log('💳 Credit invoice detected - ensuring negative amount and note');

          // Ensure amount is negative
          const amount = parseFloat(validatedResponse.total_amount);
          if (!isNaN(amount) && amount > 0) {
            validatedResponse.total_amount = (-amount).toString();
            console.log(`🔧 Corrected amount from ${amount} to -${amount}`);
          }

          // Ensure notes include "חשבונית זיכוי"
          const notes = validatedResponse.notes || '';
          if (!notes.includes('חשבונית זיכוי')) {
            validatedResponse.notes = notes ? `${notes} | חשבונית זיכוי` : 'חשבונית זיכוי';
            console.log('🔧 Added "חשבונית זיכוי" to notes');
          }
        }

        return validatedResponse;
      }
    }

    // If AI said "other" or no match found, double-check
    if (supplierCategory === 'other' || !supplierCategory) {
      // Try one more time to match against priority list
      const fuzzyMatch = SupplierMatcher.findPriorityMatch(supplierName);
      if (fuzzyMatch.matched && fuzzyMatch.confidence > 80) {
        console.log('🔄 Fuzzy matched to priority:', fuzzyMatch.supplier);
        return {
          ...response,
          supplier_category: 'priority',
          supplier_name: fuzzyMatch.supplier,
          supplier_confidence: fuzzyMatch.confidence,
        };
      }

      // Try to match category
      const categoryMatch = SupplierMatcher.findCategoryMatch(supplierName);
      if (categoryMatch.matched) {
        console.log('🔄 Matched to category:', categoryMatch.category);
        return {
          ...response,
          supplier_category: this.getCategoryKey(categoryMatch.category),
          supplier_name: categoryMatch.supplierName || supplierName,
          supplier_confidence: categoryMatch.confidence,
        };
      }

      // Default to "other"
      console.log(
        `📦 No match found for "${supplierName}", categorized as other. Consider adding transliteration if this is a known supplier.`
      );
      return {
        ...response,
        supplier_category: 'other',
        supplier_confidence: Math.max(response.supplier_confidence || 75, 75),
      };
    }

    return response;
  },

  /**
   * Get category key from Hebrew name
   */
  getCategoryKey(hebrewName) {
    const mapping = {
      'תחנת דלק': 'fuel_station',
      'רשתות מזון': 'supermarket',
      משתלות: 'nursery',
      שונות: 'other',
    };
    return mapping[hebrewName] || 'other';
  },

  /**
   * Get Hebrew category name from key
   */
  getCategoryName(categoryKey) {
    const mapping = {
      priority: 'ספק מוכר',
      fuel_station: 'תחנת דלק',
      supermarket: 'רשתות מזון',
      nursery: 'משתלות',
      other: 'שונות',
    };
    return mapping[categoryKey] || 'שונות';
  },

  /**
   * Calculate average confidence
   */
  calculateAverageConfidence(result) {
    const confidences = [
      result.supplier_confidence || 0,
      result.document_number_confidence || 0,
      result.date_confidence || 0,
      result.total_confidence || 0,
    ];

    return Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
  },
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiService;
}
