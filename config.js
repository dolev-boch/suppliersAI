// Configuration for Zuza Patisserie Invoice Scanner
// ✅ UPDATED FOR 2026 - Correct Gemini model names

const CONFIG = {
  // ✅ Gemini API Configuration - UPDATED FOR 2026
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  // Gemini 3.5 Flash-Lite (stable). Replaces gemini-2.5-flash / 2.5-flash-lite.
  GEMINI_MODEL: 'gemini-3.5-flash-lite',

  // Model that READS the invoice image (main extraction + name tie-break).
  // Gemini 4 Hydrogen = Gemini 4's speed tier: $1.50 / $7.50 per 1M tokens — the same price
  // as gemini-3.8-flash from Jan 2027, a generation newer and much better at reading print.
  // GEMINI_MODEL (Flash-Lite) stays for cheap helper calls (table detection, catalog
  // matching) and is the automatic fallback if this model is unavailable.
  VISION_MODEL: 'gemini-4-hydrogen',

  GEMINI_API_KEY: '', // Will be loaded from /api/config endpoint

  // Generation configuration for Gemini 3.x.
  // Google recommends NOT overriding temperature/topK/topP on 3.x models, and using
  // thinkingLevel instead of the old thinkingBudget. A little thinking ('low') makes
  // the model actually do the discount / VAT arithmetic instead of guessing.
  GENERATION_CONFIG: {
    thinkingLevel: 'LOW', // MINIMAL | LOW | MEDIUM | HIGH — default for text-only helper calls
    extractionThinkingLevel: 'LOW', // main invoice reading — LOW keeps scans fast
    maxOutputTokens: 32768, // thinking tokens count toward this limit
  },

  // Readability gate: below these values the scan is rejected and the user is asked
  // to photograph the invoice again (no guessing).
  READABILITY: {
    MIN_SUPPLIER_CONFIDENCE: 75,
    MIN_TOTAL_CONFIDENCE: 75,
    MIN_PRODUCT_CONFIDENCE: 70,
    // Product names: own certainty AND agreement of two independent readings must be ≥ this.
    // A name below it is accepted only if it matches a product already in the supplier's sheet.
    MIN_NAME_CERTAINTY: 90,
    // Sum of product lines must match the invoice subtotal within this tolerance
    PRODUCTS_SUM_TOLERANCE_PCT: 4,
    PRODUCTS_SUM_TOLERANCE_ABS: 3,
  },

  // Server-side OCR (Google Cloud Vision) — see api/ocr.js
  OCR_ENDPOINT: '/api/ocr',

  RESCAN_MESSAGE: 'הצילום לא מספיק ברור, נא לצלם בשנית את החשבונית עם הפרטים',

  // Google Sheets Configuration
  SHEETS_CONFIG: {
    // Invoice summaries sheet
    scriptUrl:
      'https://script.google.com/macros/s/AKfycbyMzMKj2bB8xMLD9UUFJdQiAPM1vF7xr_W7aD8_57XGJDSEadKdxv5kzRKHMYMcCyPWQg/exec',
    sheetId: '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM',

    // Products tracking sheet
    productsScriptUrl:
      'https://script.google.com/macros/s/AKfycbzsmd0MEUA_GxIgXsHOOHmEh1DFjE0jq6SE81LvVJr024xlwTJ91flYTR_wJSnGtaOG/exec',
    productsSheetId: '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ',

    // Google Drive upload script (paste URL after deploying drive-upload.gs)
    driveUploadScriptUrl:
      'https://script.google.com/macros/s/AKfycbwQ8fUzZTMPXImFHOeGHldoPVu_YcpF8rC6bLxjiDrtRUY3BH07IuVMmBSCMwEc5kk/exec',
  },

  // Storage Keys (required by app.js)
  STORAGE_KEYS: {
    DAILY_TOKENS: 'zuza_daily_tokens',
    TOKEN_DATE: 'zuza_token_date',
  },

  // Token Limits (for free tier monitoring)
  TOKEN_LIMITS: {
    DAILY_TOKENS: 50000, // Conservative daily budget
    WARNING_THRESHOLD: 40000, // Warn at 80%
  },

  // Confidence Thresholds (required by app.js)
  CONFIDENCE_THRESHOLDS: {
    HIGH: 90,
    MEDIUM: 75,
    LOW: 60,
  },

  // Rate Limiting (free tier)
  RATE_LIMITS: {
    requestsPerMinute: 15, // Free tier limit
    requestsPerDay: 1500, // Free tier limit
  },
};

// Load API key from server endpoint
async function loadApiKey() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    CONFIG.GEMINI_API_KEY = config.GEMINI_API_KEY;
    console.log('✅ API key loaded successfully');
    console.log(`✅ Using model: ${CONFIG.GEMINI_MODEL}`);
  } catch (error) {
    console.error('❌ Failed to load API key:', error);
    // Don't throw - allow app to load and show error when user tries to scan
  }
}

// Initialize on page load
if (typeof document !== 'undefined') {
  document.addEventListener('DOMContentLoaded', loadApiKey);
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
