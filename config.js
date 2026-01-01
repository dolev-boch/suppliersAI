// Configuration for Zuza Patisserie Invoice Scanner
// ✅ FIXED VERSION - Increased token limits for large invoices

const CONFIG = {
  // Gemini API Configuration
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
  GEMINI_MODEL: 'gemini-1.5-flash', // Fast and efficient for free tier
  GEMINI_API_KEY: '', // Will be loaded from /api/config endpoint

  // ✅ FIX: Generation Configuration with increased token limits
  GENERATION_CONFIG: {
    temperature: 0.1, // Low temperature for consistent, accurate results
    topK: 32,
    topP: 0.95,
    maxOutputTokens: 8192, // ✅ INCREASED from 2048 to 8192
    // Note: Gemini 1.5 Flash supports up to 8192 output tokens
    // This handles large invoices with many products without truncation
  },

  // Google Sheets Configuration
  SHEETS_CONFIG: {
    // Invoice summaries sheet
    scriptUrl:
      'https://script.google.com/macros/s/AKfycbytvjwjHJNl08u5ylKkfTN8lhQw8-yKTr-FOZEIQ2pyyetWWS9qyKitFXyRG_60YfDNEw/exec',
    sheetId: '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM',

    // Products tracking sheet
    productsScriptUrl:
      'https://script.google.com/macros/s/AKfycbw-YoM9RFPoEuPnJ1mXBwkDg1TMZcrkqk0GsizG4LMsdfnIoyvQPJ8hf_sQoARMMaz_/exec',
    productsSheetId: '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ',
  },

  // Rate Limiting (for free tier)
  RATE_LIMITS: {
    requestsPerMinute: 15, // Gemini free tier limit
    requestsPerDay: 1500, // Daily limit
  },

  // Token Limits (for free tier monitoring)
  TOKEN_LIMITS: {
    dailyLimit: 50000, // Conservative daily token budget
    warningThreshold: 40000, // Warn when approaching limit
  },
};

// Load API key from server endpoint
async function loadApiKey() {
  try {
    const response = await fetch('/api/config');
    const config = await response.json();
    CONFIG.GEMINI_API_KEY = config.GEMINI_API_KEY;
    console.log('✅ API key loaded successfully');
  } catch (error) {
    console.error('❌ Failed to load API key:', error);
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
