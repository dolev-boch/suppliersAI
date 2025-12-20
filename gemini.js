// Gemini AI Integration with Request Queue and Optimized Prompts
const GeminiService = {
  /**
   * Analyze invoice image with Gemini AI (using request queue)
   */
  async analyzeInvoice(base64Image) {
    // Use the request queue to serialize and throttle requests
    return geminiQueue.enqueue(async () => {
      return await this.performAnalysis(base64Image);
    });
  },

  /**
   * Perform the actual API call (called by the queue)
   */
  async performAnalysis(base64Image) {
    try {
      console.log('Gemini API request started');

      const apiUrl = `${CONFIG.GEMINI_API_URL}/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;

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
        generationConfig: CONFIG.GENERATION_CONFIG,
      };

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(requestBody),
      });

      if (!response.ok) {
        const errorData = await response.json();
        const errorMsg = errorData.error?.message || 'שגיאת API';

        // Throw error with status code for queue to handle retries
        if (response.status === 429) {
          throw new Error('429 Rate limit exceeded');
        }

        throw new Error(errorMsg);
      }

      const data = await response.json();
      const usage = data.usageMetadata;
      const text = data.candidates[0].content.parts[0].text;

      console.log('Gemini Response:', text);
      console.log('Token usage:', usage);

      // Extract JSON from response
      const jsonMatch = text.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) {
        throw new Error('לא הצלחתי לפרק את תשובת ה-AI');
      }

      const parsed = JSON.parse(jsonMatch[0]);

      // Validate and categorize the response
      const validated = this.validateResponse(parsed);

      return {
        ...validated,
        usage: usage,
      };
    } catch (error) {
      console.error('Gemini API Error:', error);
      throw error;
    }
  },

  /**
   * Build OPTIMIZED prompt for Gemini (reduced tokens by ~45%)
   */
  buildPrompt() {
    const prioritySuppliers = SUPPLIERS.priority.join('", "');

    return `אתה מומחה לזיהוי חשבוניות בעברית. חלץ מידע מדויק ותן JSON בלבד.

## סדר זיהוי ספק (בדוק בסדר זה):

### 1. ספקים בעדיפות (PRIORITY):
"${prioritySuppliers}"

**כללי זיהוי:**
- חפש את שם הספק בכותרת, בלוגו, או בפרטי המוכר
- שם יכול להיות בעברית או באנגלית (transliteration)
- התעלם מהוספות כמו: בע"מ, בע״מ, בעמ, בע מ, LTD, Ltd
- אם תמצא התאמה → supplier_category: "priority", supplier_name: [שם מדויק מהרשימה בעברית]
- **ספקים אלו אסור שיהיו: שונות, תחנת דלק, רשתות מזון, משתלות**

דוגמאות:
- "MECKANO" או "Mecano" → מקאנו (priority)
- "Netafim" או "נטפים" → נטפים (priority)
- "Poliva Ltd." → פוליבה (priority)

### 2. קטגוריות מיוחדות (רק אם לא priority):

**תחנת דלק:** Yellow, דור אלון, סונול, פז, Ten, באר מרים, שלמה סיקסט
מילות זיהוי: דלק, תדלוק, fuel, בנזין, דיזל, ליטר
→ supplier_category: "fuel_station"

**רשתות מזון:** שופרסל, רמי לוי, ויקטורי, יוחננוף, אלונית, מחסני השוק, טרמינל 3, יינות ביתן, אושר עד, מגא, חצי חינם, קופיקס
**חשוב מאוד:** חפש את השמות האלה בדיוק! לדוגמה:
- "ויקטורי" / "Victory" → רשתות מזון (לא שונות!)
- "רמי לוי" / "Rami Levy" → רשתות מזון (לא שונות!)
מילות זיהוי: סופר, supermarket, שוק, מרכול, market
→ supplier_category: "supermarket"

**משתלות:** מילות זיהוי: משתלה, גננות, צמחים, nursery, גינון, מוצרי נוי, נוי, פרחים, עציצים, צמח, garden
→ supplier_category: "nursery"

### 3. שונות (אם שום קטגוריה לא התאימה):
→ supplier_category: "other"

## שדות נדרשים:

**מספר מסמך:** חפש ליד ברקוד. כותרות: "מספר מסמך", "מס' חשבונית", "חשבונית מס'". אל תקצר - החזר מלא (10-15 ספרות).

**תאריך:** פורמט DD/MM/YYYY. חפש תאריך המסמך (לא תאריך תשלום עתידי).

**סכום:** הסכום הכולל הסופי בשקלים.

**כרטיס אשראי (קריטי!):**
- **חובה לבדוק ולמצוא** עבור: תחנת דלק (fuel_station), רשתות מזון (supermarket), משתלות (nursery), שונות (other)
- חפש בקפידה 4 ספרות אחרונות של כרטיס אשראי בכל החשבונית
- חפש ליד: "אשראי", "כרטיס", "credit", "card", "מספר כרטיס", "****" (4 כוכביות)
- הספרות יכולות להיות: "****1234", "XXXX1234", "1234" לבד, או "כרטיס 1234"
- אם לא מצאת 4 ספרות למרות חיפוש קפדני → credit_card_last4: null
- אם ספק priority → **תמיד** credit_card_last4: null (גם אם יש מספר כרטיס בחשבונית!)

## מוצרים (PRODUCTS):

**חובה לחלץ את כל שורות המוצרים מהחשבונית!**

עבור כל מוצר בטבלה, חלץ:
- **שם המוצר:** בדיוק כפי שכתוב (ללא קיצורים, ללא נורמליזציה)
- **כמות:** מספר
- **יחידה:** ק״ג, ליטר, יח׳, מארז, גרם, מ״ל, וכו׳
- **מחיר ליחידה לפני מע״מ:** מספר (חשוב! לפני מע״מ!)
- **סה״כ לפני מע״מ:** מספר (חשוב! לפני מע״מ!)

**כללים חשובים:**
1. **לפני מע״מ בלבד!** אם החשבונית מציגה מחירים כולל מע״מ, חשב לפני מע״מ (חלק ב-1.17)
2. דלג על שורות שאינן מוצרים (סכומי ביניים, מע״מ, סיכומים, כותרות)
3. אם מחיר ליחידה לא נראה, חשב: סה״כ ÷ כמות
4. כלול רק מוצרים עם שמות ברורים

**דוגמה:**
חשבונית מציגה:
| מוצר | כמות | מחיר יחידה | סה"כ |
| חלב תנובה 3% | 10 ליטר | 6.79 | 67.90 |
| קמח לבן 1 ק״ג | 25 | 3.86 | 96.50 |

אם מחירים כוללים מע״מ, החזר:
{
  "products": [
    {
      "name": "חלב תנובה 3%",
      "quantity": 10,
      "unit": "ליטר",
      "unit_price_before_vat": 5.80,
      "total_before_vat": 58.03
    },
    {
      "name": "קמח לבן 1 ק״ג",
      "quantity": 25,
      "unit": "יח׳",
      "unit_price_before_vat": 3.30,
      "total_before_vat": 82.48
    }
  ]
}

## JSON:
{
  "supplier_category": "priority|fuel_station|supermarket|nursery|other",
  "supplier_name": "שם הספק",
  "supplier_confidence": 95,
  "document_number": "מלא",
  "document_number_confidence": 98,
  "document_type": "invoice|delivery_note",
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
- document_type: "invoice" לחשבונית מס, "delivery_note" לתעודת משלוח
- כרטיס אשראי: חפש בכל החשבונית, אל תפספס!

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
        return {
          ...response,
          supplier_category: supplierCategory,
          supplier_name: categoryMatch.supplierName || supplierName,
          supplier_confidence: Math.max(
            response.supplier_confidence || 85,
            categoryMatch.confidence
          ),
        };
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
