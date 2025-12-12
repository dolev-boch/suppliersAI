// Gemini AI Integration with Retry Logic and Optimized Prompts
const GeminiService = {
  /**
   * Analyze invoice image with Gemini AI (with retry logic)
   */
  async analyzeInvoice(base64Image) {
    const maxRetries = 3;
    let lastError;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Gemini API attempt ${attempt}/${maxRetries}`);

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

          // Check if it's a rate limit error (429)
          if (response.status === 429) {
            lastError = new Error('Rate limit exceeded');

            // Exponential backoff: wait longer with each retry
            const waitTime = Math.min(1000 * Math.pow(2, attempt), 8000);
            console.log(`Rate limited. Waiting ${waitTime}ms before retry...`);
            await this.sleep(waitTime);
            continue; // Retry
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
        lastError = error;

        // If it's the last attempt or not a rate limit error, throw immediately
        if (attempt === maxRetries || error.message !== 'Rate limit exceeded') {
          console.error('Gemini API Error:', error);
          throw error;
        }
      }
    }

    // If we got here, all retries failed
    throw lastError;
  },

  /**
   * Sleep utility for retry delays
   */
  sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
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

אם לוגו/שם תואם לרשימה → supplier_category: "priority", supplier_name: [שם מדויק]
**ספקים אלו אסור שיהיו: שונות, תחנת דלק, משתלות**

### 2. קטגוריות מיוחדות (רק אם לא priority):

**תחנת דלק:** Yellow, דור אלון, סונול, פז, Ten, באר מרים, שלמה סיקסט
מילות זיהוי: דלק, תדלוק, fuel, בנזין, דיזל, ליטר
→ supplier_category: "fuel_station"

**רשתות מזון:** שופרסל, רמי לוי, ויקטורי, יוחננוף, אלונית, מחסני השוק, טרמינל 3, יינות ביתן, אושר עד, מגא, חצי חינם, קופיקס
מילות זיהוי: סופר, supermarket, שוק, מרכול
→ supplier_category: "supermarket"

**משתלות:** מילות זיהוי: משתלה, גננות, צמחים, nursery, גינון
→ supplier_category: "nursery"

### 3. שונות (אם שום קטגוריה לא התאימה):
→ supplier_category: "other"

## שדות נדרשים:

**מספר מסמך:** חפש ליד ברקוד. כותרות: "מספר מסמך", "מס' חשבונית", "חשבונית מס'". אל תקצר - החזר מלא (10-15 ספרות).

**תאריך:** פורמט DD/MM/YYYY. חפש תאריך המסמך (לא תאריך תשלום עתידי).

**סכום:** הסכום הכולל הסופי בשקלים.

**כרטיס אשראי (אופציונלי):** 4 ספרות אחרונות אם קיימות (****1234).

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
  "credit_card_confidence": 90
}

כללים:
- אסור להמציא מידע
- עקוב באלגוריתם הזיהוי בדיוק
- confidence גבוה (90+) רק למידע ברור
- document_type: "invoice" לחשבונית מס, "delivery_note" לתעודת משלוח

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
      console.log('✅ Priority supplier matched:', priorityMatch.supplier);
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
      console.log('📦 No match found, categorized as other');
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
