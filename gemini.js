// Gemini AI Integration
const GeminiService = {
  /**
   * Analyze invoice image with Gemini AI
   */
  async analyzeInvoice(base64Image) {
    try {
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
        throw new Error(errorData.error?.message || 'שגיאת API');
      }

      const data = await response.json();
      const usage = data.usageMetadata;
      const text = data.candidates[0].content.parts[0].text;

      console.log('Gemini Response:', text);

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
   * Build optimized prompt for Gemini
   */
  buildPrompt() {
    const prioritySuppliers = SUPPLIERS.priority.join('", "');

    return `אתה מומחה לזיהוי וניתוח חשבוניות ותעודות משלוח בעברית. משימתך לחלץ מידע מדויק ולסווג את הספק בצורה חכמה לפי האלגוריתם הבא.

## 🎯 אלגוריתם זיהוי - חובה לפעול לפי סדר זה בדיוק:

### שלב 1: זיהוי ספקים בעדיפות גבוהה (PRIORITY)
רשימת ספקים בעדיפות גבוהה שחייבים להיבדק ראשונים:
"${prioritySuppliers}"

**כללי זיהוי חובה:**
- אם הלוגו או השם בחשבונית תואם לאחד מהספקים הללו → supplier_category: "priority", supplier_name: [שם הספק המדויק מהרשימה]
- גם התאמה חלקית של 85%+ מספיקה
- **ספקים אלו לא יכולים להיות בקטגוריות: שונות, תחנת דלק, רשתות מזון**

### שלב 2: זיהוי קטגוריות מיוחדות (רק אם לא נמצא ספק priority)

#### 🔴 תחנת דלק
שמות תחנות: Yellow, דור אלון, סונול, פז, Ten, באר מרים, שלמה סיקסט
מילות זיהוי: דלק, תדלוק, fuel, בנזין, דיזל, ליטר
→ אם זוהה: supplier_category: "fuel_station", supplier_name: [שם התחנה המדויק]

#### 🔵 רשתות מזון
שמות רשתות: שופרסל, רמי לוי, ויקטורי, יוחננוף, אלונית, מחסני השוק, טרמינל 3, יינות ביתן, אושר עד, מגא, חצי חינם, קופיקס
מילות זיהוי: סופר, סופרמרקט, supermarket, שוק, מרכול
→ אם זוהה: supplier_category: "supermarket", supplier_name: [שם הרשת המדויק]

#### 🟢 משתלות
מילות זיהוי: משתלה, משתלת, גננות, צמחים, nursery, גינון, עציצים
→ אם זוהה: supplier_category: "nursery", supplier_name: [שם המשתלה]

### שלב 3: שונות (רק אם אף קטגוריה לא התאימה)
→ supplier_category: "other", supplier_name: [השם שזיהית מהחשבונית]

## 📋 זיהוי מספר מסמך - חשוב מאוד!
- מספר המסמך יכול להיות ארוך מאוד (10-15 ספרות)!
- חפש ליד הברקוד
- כותרות נפוצות: "מספר מסמך", "מס' חשבונית", "חשבונית מס'", "מס חשבונית", "חשבונית מס קבלה"
- **אל תקצר את המספר** - החזר אותו במלואו
- אם יש מספר באורך 10+ ספרות ליד ברקוד - זה כנראה מספר המסמך

## 📅 זיהוי תאריך - חשוב!
- **חפש את תאריך המסמך עצמו** - לא תאריך תשלום עתידי
- פורמט: DD/MM/YYYY
- אם התאריך לא ברור - נסה לזהות לפי הקשר
- הימנע מתאריכי תוקף, תאריכי תשלום, וכו'

## 💳 4 ספרות אחרונות של כרטיס אשראי
- זה רלוונטי בעיקר עבור רשתות מזון
- חפש "****1234" או "כרטיס: 1234"
- אם לא קיים → credit_card_last4: null

## 📤 פורמט התשובה - JSON בלבד:

{
  "supplier_category": "priority|fuel_station|supermarket|nursery|other",
  "supplier_name": "שם הספק המדויק",
  "supplier_confidence": 95,
  "document_number": "0123456789012",
  "document_number_confidence": 98,
  "document_type": "invoice|delivery_note",
  "document_date": "12/12/2024",
  "date_confidence": 95,
  "total_amount": "234.50",
  "total_confidence": 98,
  "credit_card_last4": "1234|null",
  "credit_card_confidence": 90
}

## ⚠️ כללים קריטיים:
1. **אסור להמציא מידע** - אם שדה לא ברור, תן confidence נמוך
2. **עקוב בדיוק אחר האלגוריתם** - בדוק priority לפני כל קטגוריה אחרת
3. **רמת ביטחון גבוהה רק אם בטוח מאוד** - 90+ רק למידע ברור וחד משמעי
4. **document_type חייב להיות מדויק** - "invoice" אם חשבונית מס, "delivery_note" אם תעודת משלוח

נתח את המסמך כעת והשב רק JSON:`;
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
