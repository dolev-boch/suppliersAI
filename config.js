// Configuration for Zuza Patisserie Invoice Scanner
// ✅ UPDATED FOR 2026 - Correct Gemini model names

const CONFIG = {
  // ✅ Gemini API Configuration - UPDATED FOR 2026
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  // ✅ UPDATED: Use Gemini 2.5 Flash (best balance for product tracking)
  // Options as of January 2026:
  // - 'gemini-2.5-flash' (recommended - best price/performance) ← CURRENT
  // - 'gemini-2.5-flash-lite' (cheaper, faster, less capable)
  // - 'gemini-2.5-pro' (most capable, slower, more expensive)
  // - 'gemini-3-flash-preview' (experimental, latest features)
  GEMINI_MODEL: 'gemini-2.5-flash',

  GEMINI_API_KEY: '', // Will be loaded from /api/config endpoint

  // ✅ Generation Configuration - Optimized for invoice scanning
  GENERATION_CONFIG: {
    temperature: 0.1, // Low for consistent, factual extraction
    topK: 32,
    topP: 0.95,
    maxOutputTokens: 8192, // ✅ Maximum: needed for invoices with many products
    // Gemini 2.5 Flash supports up to 8192 output tokens
    // Don't reduce this - causes JSON truncation on large invoices
  },

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

  // Rate Limiting (Gemini 2.5 Flash free tier)
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
