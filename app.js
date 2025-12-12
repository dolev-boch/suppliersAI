// Main Application Logic
class InvoiceScanner {
  constructor() {
    this.selectedFile = null;
    this.imageBase64 = null;
    this.currentResult = null;
    this.dailyTokenCount = this.loadDailyTokenCount();

    this.initializeElements();
    this.attachEventListeners();
    this.updateDailyTokenDisplay();
  }

  /**
   * Initialize DOM elements
   */
  initializeElements() {
    this.elements = {
      // Upload section
      uploadZone: document.getElementById('uploadZone'),
      fileInput: document.getElementById('fileInput'),
      previewContainer: document.getElementById('previewContainer'),
      previewImage: document.getElementById('previewImage'),
      retakeBtn: document.getElementById('retakeBtn'),
      processBtn: document.getElementById('processBtn'),

      // Loading and status
      loadingState: document.getElementById('loadingState'),
      statusMessage: document.getElementById('statusMessage'),

      // Results section
      resultsSection: document.getElementById('resultsSection'),
      supplierValue: document.getElementById('supplierValue'),
      supplierCategory: document.getElementById('supplierCategory'),
      supplierNote: document.getElementById('supplierNote'),
      supplierConfidence: document.getElementById('supplierConfidence'),
      documentNumber: document.getElementById('documentNumber'),
      documentType: document.getElementById('documentType'),
      documentConfidence: document.getElementById('documentConfidence'),
      dateValue: document.getElementById('dateValue'),
      dateConfidence: document.getElementById('dateConfidence'),
      amountValue: document.getElementById('amountValue'),
      amountConfidence: document.getElementById('amountConfidence'),
      creditCardCard: document.getElementById('creditCardCard'),
      creditCardValue: document.getElementById('creditCardValue'),
      creditCardConfidence: document.getElementById('creditCardConfidence'),

      // Action buttons
      newScanBtn: document.getElementById('newScanBtn'),
      sendToSheetsBtn: document.getElementById('sendToSheetsBtn'),

      // Usage statistics
      usageSection: document.getElementById('usageSection'),
      currentTokens: document.getElementById('currentTokens'),
      dailyTokens: document.getElementById('dailyTokens'),
    };
  }

  /**
   * Attach event listeners
   */
  attachEventListeners() {
    // Upload zone interactions
    this.elements.uploadZone.addEventListener('click', () => {
      this.elements.fileInput.click();
    });

    this.elements.uploadZone.addEventListener('touchend', (e) => {
      e.preventDefault();
      this.elements.fileInput.click();
    });

    // File selection
    this.elements.fileInput.addEventListener('change', (e) => {
      const file = e.target.files[0];
      if (file) this.handleFile(file);
    });

    // Drag and drop
    this.elements.uploadZone.addEventListener('dragover', (e) => {
      e.preventDefault();
      this.elements.uploadZone.style.borderColor = 'var(--primary-color)';
    });

    this.elements.uploadZone.addEventListener('dragleave', () => {
      this.elements.uploadZone.style.borderColor = '';
    });

    this.elements.uploadZone.addEventListener('drop', (e) => {
      e.preventDefault();
      this.elements.uploadZone.style.borderColor = '';

      const file = e.dataTransfer.files[0];
      if (file && file.type.startsWith('image/')) {
        this.handleFile(file);
      } else {
        this.showStatus('אנא העלה קובץ תמונה בלבד', 'error');
      }
    });

    // Process button
    this.elements.processBtn.addEventListener('click', () => {
      this.processInvoice();
    });

    // Retake button
    this.elements.retakeBtn.addEventListener('click', () => {
      this.elements.fileInput.click();
    });

    // New scan button
    this.elements.newScanBtn.addEventListener('click', () => {
      this.resetForNewScan();
    });

    // Send to sheets button
    this.elements.sendToSheetsBtn.addEventListener('click', () => {
      this.sendToGoogleSheets();
    });
  }

  /**
   * Handle file selection
   */
  handleFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showStatus('אנא בחר קובץ תמונה', 'error');
      return;
    }

    this.selectedFile = file;

    const reader = new FileReader();
    reader.onload = (e) => {
      this.elements.previewImage.src = e.target.result;
      this.elements.previewContainer.style.display = 'block';
      this.imageBase64 = e.target.result.split(',')[1];

      // Hide upload zone and show preview
      this.elements.uploadZone.style.display = 'none';
      this.elements.processBtn.disabled = false;

      this.showStatus('תמונה נטענה בהצלחה! לחץ "נתח חשבונית" להמשך', 'success');
    };
    reader.readAsDataURL(file);

    // Reset results
    this.elements.resultsSection.style.display = 'none';
    this.elements.usageSection.style.display = 'none';
  }

  /**
   * Process invoice with Gemini AI
   */
  async processInvoice() {
    if (!this.imageBase64) {
      this.showStatus('אנא בחר תמונה תחילה', 'error');
      return;
    }

    try {
      // Show loading state
      this.elements.processBtn.disabled = true;
      this.elements.loadingState.style.display = 'block';
      this.elements.statusMessage.style.display = 'none';
      this.elements.resultsSection.style.display = 'none';

      // Analyze with Gemini
      const result = await GeminiService.analyzeInvoice(this.imageBase64);
      this.currentResult = result;

      console.log('Analysis result:', result);

      // Check average confidence
      const avgConfidence = GeminiService.calculateAverageConfidence(result);

      if (avgConfidence < CONFIG.CONFIDENCE_THRESHOLDS.LOW) {
        this.showStatus('⚠️ איכות התמונה אינה מספקת. אנא צלם שוב בתאורה טובה יותר', 'warning');
      } else if (avgConfidence < CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM) {
        this.showStatus('✅ החשבונית נותחה. חלק מהנתונים עשויים להיות לא מדויקים', 'info');
      } else {
        this.showStatus('✅ החשבונית נותחה בהצלחה!', 'success');
      }

      // Display results
      this.displayResults(result);

      // Update usage statistics
      if (result.usage) {
        this.updateUsageStatistics(result.usage);
      }
    } catch (error) {
      console.error('Processing error:', error);
      this.handleError(error);
    } finally {
      this.elements.processBtn.disabled = false;
      this.elements.loadingState.style.display = 'none';
    }
  }

  /**
   * Display analysis results
   */
  displayResults(result) {
    // Supplier information
    const categoryName = GeminiService.getCategoryName(result.supplier_category);
    this.elements.supplierValue.textContent = result.supplier_name || 'לא זוהה';

    // Show category badge if not priority
    if (result.supplier_category !== 'priority') {
      this.elements.supplierCategory.textContent = `קטגוריה: ${categoryName}`;
      this.elements.supplierCategory.style.display = 'block';
    } else {
      this.elements.supplierCategory.style.display = 'none';
    }

    // Show note if exists
    if (result.supplier_note) {
      this.elements.supplierNote.textContent = result.supplier_note;
      this.elements.supplierNote.style.display = 'block';
    } else {
      this.elements.supplierNote.style.display = 'none';
    }

    this.setConfidenceBadge(this.elements.supplierConfidence, result.supplier_confidence);

    // Document information
    this.elements.documentNumber.textContent = result.document_number || 'לא זוהה';
    this.setConfidenceBadge(this.elements.documentConfidence, result.document_number_confidence);

    // Document type
    const isInvoice = result.document_type === 'invoice';
    this.elements.documentType.textContent = isInvoice ? '✓ חשבונית מס' : '⚠️ תעודת משלוח';
    this.elements.documentType.className = `document-type-badge ${
      isInvoice ? 'invoice' : 'delivery'
    }`;

    // Date
    this.elements.dateValue.textContent = result.document_date || 'לא זוהה';
    this.setConfidenceBadge(this.elements.dateConfidence, result.date_confidence);

    // Amount
    this.elements.amountValue.textContent = result.total_amount
      ? `₪${result.total_amount}`
      : 'לא זוהה';
    this.setConfidenceBadge(this.elements.amountConfidence, result.total_confidence);

    // Credit card (optional)
    if (result.credit_card_last4) {
      this.elements.creditCardValue.textContent = `****${result.credit_card_last4}`;
      this.setConfidenceBadge(
        this.elements.creditCardConfidence,
        result.credit_card_confidence || 90
      );
      this.elements.creditCardCard.style.display = 'block';
    } else {
      this.elements.creditCardCard.style.display = 'none';
    }

    // Show results section
    this.elements.resultsSection.style.display = 'block';

    // Scroll to results
    this.elements.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Set confidence badge styling
   */
  setConfidenceBadge(element, confidence) {
    const value = confidence || 0;
    element.textContent = `${value}%`;

    if (value >= CONFIG.CONFIDENCE_THRESHOLDS.HIGH) {
      element.className = 'confidence-badge confidence-high';
    } else if (value >= CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM) {
      element.className = 'confidence-badge confidence-medium';
    } else {
      element.className = 'confidence-badge confidence-low';
    }
  }

  /**
   * Update usage statistics
   */
  updateUsageStatistics(usage) {
    this.elements.currentTokens.textContent = usage.totalTokenCount.toLocaleString('he-IL');

    this.dailyTokenCount += usage.totalTokenCount;
    this.saveDailyTokenCount(this.dailyTokenCount);
    this.updateDailyTokenDisplay();

    this.elements.usageSection.style.display = 'block';
  }

  /**
   * Update daily token display
   */
  updateDailyTokenDisplay() {
    this.elements.dailyTokens.textContent = this.dailyTokenCount.toLocaleString('he-IL');
  }

  /**
   * Load daily token count from localStorage
   */
  loadDailyTokenCount() {
    const savedTokens = localStorage.getItem(CONFIG.STORAGE_KEYS.DAILY_TOKENS);
    const savedDate = localStorage.getItem(CONFIG.STORAGE_KEYS.TOKEN_DATE);
    const today = new Date().toDateString();

    if (savedDate === today && savedTokens) {
      return parseInt(savedTokens);
    } else {
      this.saveDailyTokenCount(0);
      return 0;
    }
  }

  /**
   * Save daily token count to localStorage
   */
  saveDailyTokenCount(count) {
    const today = new Date().toDateString();
    localStorage.setItem(CONFIG.STORAGE_KEYS.DAILY_TOKENS, count.toString());
    localStorage.setItem(CONFIG.STORAGE_KEYS.TOKEN_DATE, today);
  }

  /**
   * Show status message
   */
  showStatus(message, type = 'info') {
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message ${type}`;
    this.elements.statusMessage.style.display = 'block';

    // Auto-hide success messages after 5 seconds
    if (type === 'success' || type === 'info') {
      setTimeout(() => {
        this.elements.statusMessage.style.display = 'none';
      }, 5000);
    }
  }

  /**
   * Handle errors
   */
  handleError(error) {
    let errorMsg = '❌ שגיאה בניתוח החשבונית';

    if (error.message.includes('API_KEY') || error.message.includes('API key')) {
      errorMsg = '❌ מפתח API לא תקין';
    } else if (error.message.includes('quota') || error.message.includes('QUOTA')) {
      errorMsg = '❌ חרגת ממכסת השימוש היומית';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMsg = '❌ בעיית תקשורת - בדוק חיבור לאינטרנט';
    }

    this.showStatus(errorMsg, 'error');

    // Show detailed error in console
    console.error('Error details:', error);
  }

  /**
   * Reset for new scan
   */
  resetForNewScan() {
    this.selectedFile = null;
    this.imageBase64 = null;
    this.currentResult = null;

    // Reset UI
    this.elements.uploadZone.style.display = 'block';
    this.elements.previewContainer.style.display = 'none';
    this.elements.resultsSection.style.display = 'none';
    this.elements.statusMessage.style.display = 'none';
    this.elements.processBtn.disabled = true;
    this.elements.fileInput.value = '';

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Send data to Google Sheets
   */
  async sendToGoogleSheets() {
    if (!this.currentResult) {
      this.showStatus('אין נתונים לשליחה', 'error');
      return;
    }

    // Check if Google Sheets is configured
    if (!CONFIG.SHEETS_CONFIG.scriptUrl) {
      this.showStatus('⚠️ יש להגדיר את Google Sheets ב-config.js', 'warning');
      return;
    }

    try {
      this.elements.sendToSheetsBtn.disabled = true;
      this.showStatus('שולח נתונים ל-Google Sheets...', 'info');

      // Prepare data for Google Sheets
      const dataToSend = {
        timestamp: new Date().toISOString(),
        supplier_category: GeminiService.getCategoryName(this.currentResult.supplier_category),
        supplier_name: this.currentResult.supplier_name,
        document_number: this.currentResult.document_number,
        document_type:
          this.currentResult.document_type === 'invoice' ? 'חשבונית מס' : 'תעודת משלוח',
        document_date: this.currentResult.document_date,
        total_amount: this.currentResult.total_amount,
        credit_card_last4: this.currentResult.credit_card_last4 || '',
        confidences: {
          supplier: this.currentResult.supplier_confidence,
          document: this.currentResult.document_number_confidence,
          date: this.currentResult.date_confidence,
          amount: this.currentResult.total_confidence,
        },
      };

      // Send to Google Sheets via Apps Script
      const response = await fetch(CONFIG.SHEETS_CONFIG.scriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      this.showStatus('✅ הנתונים נשלחו בהצלחה ל-Google Sheets!', 'success');
    } catch (error) {
      console.error('Sheets error:', error);
      this.showStatus('❌ שגיאה בשליחת הנתונים', 'error');
    } finally {
      this.elements.sendToSheetsBtn.disabled = false;
    }
  }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new InvoiceScanner();
  console.log('Invoice Scanner initialized');
});
