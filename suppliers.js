// Suppliers Database
const SUPPLIERS = {
  // Priority suppliers list - MUST be checked first with high accuracy
  // These suppliers can NEVER be categorized as שונות, תחנת דלק, or משתלות
  priority: [
    'אלכס ברק',
    'אחים לוי',
    'אלמנדוס בע"מ',
    'אפי שיווק ביצים',
    'אקיופוז',
    'ארגל',
    'אריזים שפי פלסט',
    'בזק',
    'הפרסי פירות וירקות בע"מ',
    'דקל דברי נוי',
    'ח.ל.ק.ט קרח',
    'טויטו שחר מחלבות גד',
    'טכנאים',
    'מ. אש קפה',
    'מגבוני סיוון',
    'מיכל גינון',
    'מיכלי זהב',
    'מירב אוזן',
    'מקאנו',
    'מר קייק',
    'מרכז הירק',
    'משתלות',
    'נטפים',
    'פוליבה',
    'פיין וויין גבינות',
    'פנדרייה (אנשי הלחם)',
    'פפירוס',
    'פריניב',
    'צח',
    'קיבוץ כנרת',
    'רפת א.א.א.',
    'תבליני כהן',
  ],

  // Categories - only checked if no priority supplier match
  categories: {
    fuelStations: {
      categoryName: 'תחנת דלק',
      suppliers: ['Yellow', 'דור אלון', 'סונול', 'פז', 'Ten', 'באר מרים', 'שלמה סיקסט'],
      keywords: [
        'דלק',
        'תדלוק',
        'fuel',
        'בנזין',
        'דיזל',
        'gas station',
        'תחנת דלק',
        'ליטר',
        'תדלוק',
      ],
    },

    supermarkets: {
      categoryName: 'רשתות מזון',
      suppliers: [
        'שופרסל',
        'רמי לוי',
        'ויקטורי',
        'יוחננוף',
        'אלונית',
        'מחסני השוק',
        'טרמינל 3',
        'יינות ביתן',
        'אושר עד',
        'מגא',
        'חצי חינם',
        'קופיקס',
      ],
      keywords: ['סופר', 'סופרמרקט', 'supermarket', 'שוק', 'מרכול', 'מכולת'],
    },

    nurseries: {
      categoryName: 'משתלות',
      suppliers: [],
      keywords: ['משתלה', 'משתלת', 'גננות', 'צמחים', 'nursery', 'גינון', 'עציצים'],
    },
  },

  // Default category for unmatched suppliers
  defaultCategory: {
    categoryName: 'שונות',
  },
};

// Helper functions for supplier matching
const SupplierMatcher = {
  /**
   * Normalize text for comparison
   */
  normalize(text) {
    if (!text) return '';
    return text
      .toLowerCase()
      .replace(/[\"'\(\)]/g, '')
      .replace(/בע\"מ|בע"מ|בעמ|בע מ/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Check if text matches any priority supplier
   */
  findPriorityMatch(text) {
    const normalized = this.normalize(text);

    // Exact match
    for (const supplier of SUPPLIERS.priority) {
      if (this.normalize(supplier) === normalized) {
        return {
          matched: true,
          supplier: supplier,
          confidence: 95,
          matchType: 'exact',
        };
      }
    }

    // Fuzzy match (high threshold)
    for (const supplier of SUPPLIERS.priority) {
      const similarity = this.calculateSimilarity(normalized, this.normalize(supplier));
      if (similarity > 0.85) {
        return {
          matched: true,
          supplier: supplier,
          confidence: Math.round(similarity * 100),
          matchType: 'fuzzy',
        };
      }
    }

    return { matched: false };
  },

  /**
   * Check if text matches a category
   */
  findCategoryMatch(text) {
    const normalized = this.normalize(text);

    for (const [categoryKey, categoryData] of Object.entries(SUPPLIERS.categories)) {
      // Check supplier names
      for (const supplier of categoryData.suppliers) {
        if (normalized.includes(this.normalize(supplier))) {
          return {
            matched: true,
            category: categoryData.categoryName,
            supplierName: supplier,
            confidence: 90,
          };
        }
      }

      // Check keywords
      for (const keyword of categoryData.keywords) {
        if (normalized.includes(this.normalize(keyword))) {
          return {
            matched: true,
            category: categoryData.categoryName,
            supplierName: null, // Will be extracted from AI response
            confidence: 85,
          };
        }
      }
    }

    return { matched: false };
  },

  /**
   * Calculate similarity between two strings (Levenshtein distance)
   */
  calculateSimilarity(str1, str2) {
    const longer = str1.length > str2.length ? str1 : str2;
    const shorter = str1.length > str2.length ? str2 : str1;

    if (longer.length === 0) return 1.0;

    const distance = this.levenshteinDistance(longer, shorter);
    return (longer.length - distance) / longer.length;
  },

  /**
   * Calculate Levenshtein distance
   */
  levenshteinDistance(str1, str2) {
    const matrix = [];

    for (let i = 0; i <= str2.length; i++) {
      matrix[i] = [i];
    }

    for (let j = 0; j <= str1.length; j++) {
      matrix[0][j] = j;
    }

    for (let i = 1; i <= str2.length; i++) {
      for (let j = 1; j <= str1.length; j++) {
        if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
          matrix[i][j] = matrix[i - 1][j - 1];
        } else {
          matrix[i][j] = Math.min(
            matrix[i - 1][j - 1] + 1,
            matrix[i][j - 1] + 1,
            matrix[i - 1][j] + 1
          );
        }
      }
    }

    return matrix[str2.length][str1.length];
  },
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { SUPPLIERS, SupplierMatcher };
}
