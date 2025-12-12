// Configuration file
const CONFIG = {
    // Gemini API Configuration
    // API key is loaded from Vercel serverless function
    GEMINI_API_KEY: '', // Will be loaded dynamically
    GEMINI_MODEL: 'gemini-2.0-flash-lite',
    GEMINI_API_URL: 'https://generativelanguage.googleapis.com/v1beta/models',
    
    // Generation settings
    GENERATION_CONFIG: {
        temperature: 0.1,
        topK: 32,
        topP: 0.95,
        maxOutputTokens: 2048
    },
    
    // Confidence thresholds
    CONFIDENCE_THRESHOLDS: {
        HIGH: 90,
        MEDIUM: 75,
        LOW: 60
    },
    
    // Google Sheets Configuration
    SHEETS_CONFIG: {
        scriptUrl: '',
        sheetId: '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM'
    },
    
    // Local storage keys
    STORAGE_KEYS: {
        DAILY_TOKENS: 'daily_token_count',
        TOKEN_DATE: 'token_count_date'
    }
};

// Function to load API key from Vercel serverless function
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

// Load API key when page loads
if (typeof window !== 'undefined') {
    loadApiKey();
}

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}
    
    // Generation settings
    GENERATION_CONFIG: {
        temperature: 0.1,
        topK: 32,
        topP: 0.95,
        maxOutputTokens: 2048
    },
    
    // Confidence thresholds
    CONFIDENCE_THRESHOLDS: {
        HIGH: 90,
        MEDIUM: 75,
        LOW: 60
    },
    
    // Google Sheets Configuration
    SHEETS_CONFIG: {
        scriptUrl: '', // Add your Google Apps Script deployment URL here after deploying
        sheetId: '1De973PQAzwTiSvTjBSSLEeoe3O-eMbvzy0py-DJegkM'
    },
    
    // Local storage keys
    STORAGE_KEYS: {
        DAILY_TOKENS: 'daily_token_count',
        TOKEN_DATE: 'token_count_date'
    }
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
    module.exports = CONFIG;
}