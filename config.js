// Configuration file
const CONFIG = {
  // Gemini API Configuration
  // API key is loaded from Vercel serverless function
  GEMINI_API_KEY: '', // Loaded dynamically
  GEMINI_MODEL: 'gemini-2.5-flash-lite',
  GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models',

  // Generation settings
  GENERATION_CONFIG: {
    temperature: 0.1,
    topK: 32,
    topP: 0.95,
    maxOutputTokens: 2048,
  },

  // Confidence thresholds
  CONFIDENCE_THRESHOLDS: {
    HIGH: 90,
    MEDIUM: 75,
    LOW: 60,
  },

  // Google Sheets Configuration
  SHEETS_CONFIG: {
    scriptUrl:
      'https://script.google.com/macros/s/AKfycbxpvbYdgoLSkRhCKKgGP_aWpviXW6L8mb1OdoQNQa02LjSPMlWRz8Ab6B7XIOdvHebc_Q/exec', // Invoice summaries script URL
    sheetId: '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM', // Invoice summaries spreadsheet
    productsSheetId: '1vPVl1txkN1wgXJncNMX3-VZZENOx2J8O1FXJlbl7hUQ', // Product tracking spreadsheet
  },

  // Local storage keys
  STORAGE_KEYS: {
    DAILY_TOKENS: 'daily_token_count',
    TOKEN_DATE: 'token_count_date',
  },
};

// Load API key from Vercel serverless function
async function loadApiKey() {
  try {
    const response = await fetch('/api/config');
    const data = await response.json();
    CONFIG.GEMINI_API_KEY = data.GEMINI_API_KEY;
    console.log('✅ API key loaded successfully');
  } catch (error) {
    console.error('❌ Failed to load API key:', error);
  }
}

// Load API key in browser
if (typeof window !== 'undefined') {
  loadApiKey();
}

// Export for Node.js environments
if (typeof module !== 'undefined' && module.exports) {
  module.exports = CONFIG;
}
