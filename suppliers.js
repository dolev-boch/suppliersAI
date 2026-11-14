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
    'עמרוסי ניסים ויורם',
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

  // Transliteration aliases for suppliers (English/mixed spellings on invoices)
  // Maps common English spellings to the correct Hebrew supplier name
  transliterations: {
    // מקאנו variations
    meckano: 'מקאנו',
    mecano: 'מקאנו',
    makano: 'מקאנו',
    meccano: 'מקאנו',

    // נטפים variations
    netafim: 'נטפים',
    natafim: 'נטפים',

    // פוליבה variations
    poliva: 'פוליבה',
    polyva: 'פוליבה',
    poliba: 'פוליבה',

    // פפירוס variations
    papyrus: 'פפירוס',
    papirus: 'פפירוס',

    // בזק variations
    bezeq: 'בזק',
    bezek: 'בזק',

    // ארגל variations
    argel: 'ארגל',
    argal: 'ארגל',

    // אקיופוז variations
    ekufuz: 'אקיופוז',
    akufuz: 'אקיופוז',
    equfuz: 'אקיופוז',

    // פריניב variations
    priniv: 'פריניב',
    preyniv: 'פריניב',

    // מר קייק variations
    'mr cake': 'מר קייק',
    'mr. cake': 'מר קייק',
    'mr.cake': 'מר קייק',
    mrcake: 'מר קייק',

    // רשתות מזון (supermarkets) - English variations
    // רשתות מזון (supermarkets) - English variations
    victory: 'ויקטורי',
    viktory: 'ויקטורי',
    'rami levy': 'רמי לוי',
    'rami levi': 'רמי לוי',
    ramilevy: 'רמי לוי',
    shufersol: 'שופרסל',
    shufersal: 'שופרסל',
    yohananof: 'יוחננוף',
    yochananof: 'יוחננוף',

    // Add more as you discover them on invoices
  },

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
        'דוכן צמח',
      ],
      keywords: ['סופר', 'סופרמרקט', 'supermarket', 'שוק', 'מרכול', 'מכולת', 'דוכן'],
    },

    nurseries: {
      categoryName: 'משתלות',
      suppliers: [],
      keywords: [
        'משתלה',
        'משתלת',
        'גננות',
        'צמחים',
        'nursery',
        'גינון',
        'עציצים',
        'מוצרי נוי',
        'נוי',
        'פרחים',
        'צמח',
        'garden',
      ],
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
   * Normalize text for comparison.
   * Removes company suffixes, punctuation and Hebrew final-letter differences so
   * that "עמרוסי נסים ויורם בע״מ" and "עמרוסי ניסים ויורם" compare as near-equal.
   */
  normalize(text) {
    if (!text) return '';
    return String(text)
      .toLowerCase()
      .replace(/בע["״׳'\s]*מ/g, ' ')
      .replace(/\b(ltd|inc|co)\b\.?/g, ' ')
      .replace(/[ך]/g, 'כ')
      .replace(/[ם]/g, 'מ')
      .replace(/[ן]/g, 'נ')
      .replace(/[ף]/g, 'פ')
      .replace(/[ץ]/g, 'צ')
      .replace(/["'״׳`\(\)\[\]\.,\-_/\\:;!?]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();
  },

  /**
   * Similarity score (0..1) between two supplier names, tolerant to typos,
   * missing words ("עמרוסי ניסים" vs "עמרוסי ניסים ויורם") and word order.
   */
  nameScore(a, b) {
    const na = this.normalize(a);
    const nb = this.normalize(b);
    if (!na || !nb) return 0;
    if (na === nb) return 1;

    // Spaces removed (e.g. "מר קייק" vs "מרקייק")
    if (na.replace(/ /g, '') === nb.replace(/ /g, '')) return 0.98;

    const whole = this.calculateSimilarity(na, nb);

    // Token coverage: every word of the shorter name appears (fuzzily) in the longer one
    const ta = na.split(' ').filter(Boolean);
    const tb = nb.split(' ').filter(Boolean);
    const [shortT, longT] = ta.length <= tb.length ? [ta, tb] : [tb, ta];
    let matchedChars = 0;
    let allMatched = true;
    for (const t of shortT) {
      let best = 0;
      for (const u of longT) {
        const s = t === u ? 1 : Math.min(t.length, u.length) >= 4 ? this.calculateSimilarity(t, u) : 0;
        if (s > best) best = s;
      }
      if (best >= 0.8) matchedChars += t.length;
      else allMatched = false;
    }
    const shortLen = shortT.join('').length;
    let tokenScore = 0;
    // Short words (<4 letters) must match exactly as whole words, so "צח" only matches
    // the word "צח", never a substring of another word.
    if (allMatched && shortLen >= 2) {
      const longLen = longT.join('').length;
      // 0.86..0.95 depending on how much of the longer name is covered
      tokenScore = 0.86 + 0.09 * (shortLen / longLen);
    }

    return Math.max(whole, tokenScore);
  },

  /**
   * Find the best-matching name from a list of candidates.
   * @returns {{name: string, score: number} | null}
   */
  bestMatch(text, candidates, threshold = 0.82) {
    let best = null;
    for (const c of candidates) {
      const score = this.nameScore(text, c);
      if (!best || score > best.score) best = { name: c, score };
    }
    return best && best.score >= threshold ? best : null;
  },

  /**
   * Check if text matches any priority supplier
   */
  findPriorityMatch(text) {
    const normalized = this.normalize(text);
    if (!normalized) return { matched: false };

    // 1. Check transliteration aliases first (for English spellings)
    for (const [englishName, hebrewName] of Object.entries(SUPPLIERS.transliterations)) {
      if (normalized.includes(englishName)) {
        return {
          matched: true,
          supplier: hebrewName,
          confidence: 95,
          matchType: 'transliteration',
        };
      }
    }

    // 2. Best fuzzy/word match over the whole list (best match wins, not first match)
    const best = this.bestMatch(text, SUPPLIERS.priority, 0.82);
    if (best) {
      return {
        matched: true,
        supplier: best.name,
        confidence: Math.round(Math.max(best.score, 0.85) * 100),
        matchType: best.score === 1 ? 'exact' : 'fuzzy',
      };
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
