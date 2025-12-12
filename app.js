// Zuza Patisserie Invoice Scanner - Main Application

class InvoiceScanner {
  constructor() {
    this.selectedFile = null;
    this.imageBase64 = null;
    this.currentResult = null;
    this.editMode = false;
    this.editedData = {};
    this.dailyTokenCount = this.loadDailyTokenCount();
    this.loadingStartTime = null;

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
      loadingProgress: document.getElementById('loadingProgress'),
      statusMessage: document.getElementById('statusMessage'),

      // Results section
      resultsSection: document.getElementById('resultsSection'),
      actionButtons: document.getElementById('actionButtons'),
      editBtn: document.getElementById('editBtn'),
      approveAndSendBtn: document.getElementById('approveAndSendBtn'),

      // Result fields
      supplierCard: document.getElementById('supplierCard'),
      supplierValue: document.getElementById('supplierValue'),
      supplierCategory: document.getElementById('supplierCategory'),
      supplierNote: document.getElementById('supplierNote'),
      supplierConfidence: document.getElementById('supplierConfidence'),

      documentNumberCard: document.getElementById('documentNumberCard'),
      documentNumber: document.getElementById('documentNumber'),
      documentType: document.getElementById('documentType'),
      documentConfidence: document.getElementById('documentConfidence'),

      dateCard: document.getElementById('dateCard'),
      dateValue: document.getElementById('dateValue'),
      dateConfidence: document.getElementById('dateConfidence'),

      amountCard: document.getElementById('amountCard'),
      amountValue: document.getElementById('amountValue'),
      amountConfidence: document.getElementById('amountConfidence'),

      creditCardCard: document.getElementById('creditCardCard'),
      creditCardValue: document.getElementById('creditCardValue'),
      creditCardConfidence: document.getElementById('creditCardConfidence'),

      newScanBtn: document.getElementById('newScanBtn'),

      // Supplier modal
      supplierModal: document.getElementById('supplierModal'),
      modalClose: document.getElementById('modalClose'),
      supplierSearch: document.getElementById('supplierSearch'),
      supplierList: document.getElementById('supplierList'),

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
      this.elements.uploadZone.style.borderColor = 'var(--gold)';
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
        this.showStatus('נא להעלות קובץ תמונה בלבד', 'error');
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

    // Action buttons
    this.elements.editBtn.addEventListener('click', () => {
      this.enterEditMode();
    });

    this.elements.approveAndSendBtn.addEventListener('click', () => {
      this.sendToGoogleSheets();
    });

    // New scan button
    this.elements.newScanBtn.addEventListener('click', () => {
      this.resetForNewScan();
    });

    // Modal controls
    this.elements.modalClose.addEventListener('click', () => {
      this.closeSupplierModal();
    });

    this.elements.supplierModal.addEventListener('click', (e) => {
      if (e.target === this.elements.supplierModal) {
        this.closeSupplierModal();
      }
    });

    // Supplier search
    this.elements.supplierSearch.addEventListener('input', (e) => {
      this.filterSuppliers(e.target.value);
    });
  }

  /**
   * Handle file selection
   */
  handleFile(file) {
    if (!file.type.startsWith('image/')) {
      this.showStatus('נא לבחור קובץ תמונה', 'error');
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
      this.showStatus('נא לבחור תמונה תחילה', 'error');
      return;
    }

    // Wait for API key to load if not loaded yet
    if (!CONFIG.GEMINI_API_KEY) {
      this.showStatus('טוען הגדרות...', 'info');
      await new Promise((resolve) => setTimeout(resolve, 1000));

      if (!CONFIG.GEMINI_API_KEY) {
        this.showStatus('שגיאה בטעינת הגדרות. נא לרענן את הדף.', 'error');
        return;
      }
    }

    try {
      // Show loading state
      this.elements.processBtn.disabled = true;
      this.elements.loadingState.style.display = 'block';
      this.elements.statusMessage.style.display = 'none';
      this.elements.resultsSection.style.display = 'none';

      // Start timer and progress updates
      this.loadingStartTime = Date.now();
      this.startLoadingProgress();

      // Analyze with Gemini
      const result = await GeminiService.analyzeInvoice(this.imageBase64);
      this.currentResult = result;
      this.editedData = {}; // Reset edited data

      console.log('Analysis result:', result);

      // Stop progress updates
      this.stopLoadingProgress();

      // Check average confidence
      const avgConfidence = GeminiService.calculateAverageConfidence(result);

      if (avgConfidence < CONFIG.CONFIDENCE_THRESHOLDS.LOW) {
        this.showStatus('איכות התמונה אינה מספקת. נא לצלם שוב בתאורה טובה יותר', 'warning');
      } else if (avgConfidence < CONFIG.CONFIDENCE_THRESHOLDS.MEDIUM) {
        this.showStatus('החשבונית נותחה. חלק מהנתונים עשויים להיות לא מדויקים', 'info');
      } else {
        this.showStatus('החשבונית נותחה בהצלחה!', 'success');
      }

      // Display results
      this.displayResults(result);

      // Update usage statistics
      if (result.usage) {
        this.updateUsageStatistics(result.usage);
      }
    } catch (error) {
      console.error('Processing error:', error);
      this.stopLoadingProgress();
      this.handleError(error);
    } finally {
      this.elements.processBtn.disabled = false;
      this.elements.loadingState.style.display = 'none';
    }
  }

  /**
   * Start loading progress updates
   */
  startLoadingProgress() {
    this.loadingInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.loadingStartTime) / 1000);
      if (elapsed < 30) {
        this.elements.loadingProgress.textContent = `עברו ${elapsed} שניות...`;
      } else {
        this.elements.loadingProgress.textContent = 'זה לוקח יותר זמן מהרגיל...';
      }
    }, 1000);
  }

  /**
   * Stop loading progress updates
   */
  stopLoadingProgress() {
    if (this.loadingInterval) {
      clearInterval(this.loadingInterval);
      this.loadingInterval = null;
    }
    this.elements.loadingProgress.textContent = '';
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
    this.elements.documentType.textContent = isInvoice ? 'חשבונית מס' : 'תעודת משלוח';
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

    // Reset edit mode
    this.exitEditMode();

    // Show results section
    this.elements.resultsSection.style.display = 'block';

    // Scroll to results
    this.elements.resultsSection.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /**
   * Enter edit mode
   */
  enterEditMode() {
    this.editMode = true;
    this.elements.editBtn.textContent = 'בטל עריכה';
    this.elements.approveAndSendBtn.textContent = 'שמור ושלח';

    // Make cards editable
    const editableCards = [
      { card: this.elements.supplierCard, field: 'supplier', isSupplier: true },
      { card: this.elements.documentNumberCard, field: 'document_number' },
      { card: this.elements.dateCard, field: 'date' },
      { card: this.elements.amountCard, field: 'amount' },
    ];

    if (this.elements.creditCardCard.style.display !== 'none') {
      editableCards.push({ card: this.elements.creditCardCard, field: 'credit_card' });
    }

    editableCards.forEach(({ card, field, isSupplier }) => {
      card.classList.add('editable');
      card.style.cursor = 'pointer';

      const clickHandler = () => {
        if (isSupplier) {
          this.openSupplierModal();
        } else {
          this.editField(field);
        }
      };

      // Remove old listener if exists
      const oldHandler = card._clickHandler;
      if (oldHandler) {
        card.removeEventListener('click', oldHandler);
      }

      card._clickHandler = clickHandler;
      card.addEventListener('click', clickHandler);
    });

    // Update button handler
    this.elements.editBtn.onclick = () => this.exitEditMode();
  }

  /**
   * Exit edit mode
   */
  exitEditMode() {
    this.editMode = false;
    this.elements.editBtn.textContent = 'עריכה';
    this.elements.approveAndSendBtn.textContent = 'אישור ושליחה';

    // Remove editable state
    const cards = document.querySelectorAll('.result-card');
    cards.forEach((card) => {
      card.classList.remove('editable');
      card.style.cursor = '';
      if (card._clickHandler) {
        card.removeEventListener('click', card._clickHandler);
        card._clickHandler = null;
      }
    });

    // Restore button handler
    this.elements.editBtn.onclick = () => this.enterEditMode();
  }

  /**
   * Edit a field (document number, date, amount)
   */
  editField(field) {
    let valueElement, originalValue;

    switch (field) {
      case 'document_number':
        valueElement = this.elements.documentNumber;
        originalValue = this.editedData.document_number || this.currentResult.document_number || '';
        break;
      case 'date':
        valueElement = this.elements.dateValue;
        originalValue = this.editedData.document_date || this.currentResult.document_date || '';
        break;
      case 'amount':
        valueElement = this.elements.amountValue;
        originalValue =
          this.editedData.total_amount ||
          this.currentResult.total_amount ||
          '';
        // Remove ₪ symbol if present
        originalValue = originalValue.toString().replace('₪', '');
        break;
      case 'credit_card':
        valueElement = this.elements.creditCardValue;
        originalValue =
          this.editedData.credit_card_last4 || this.currentResult.credit_card_last4 || '';
        // Remove **** if present
        originalValue = originalValue.toString().replace(/\*/g, '');
        break;
    }

    // Create input field
    const input = document.createElement('input');
    input.type = 'text';
    input.className = 'edit-field';
    input.value = originalValue;

    // Handle date field
    if (field === 'date') {
      input.placeholder = 'DD/MM/YYYY';
    }

    // Replace value with input
    const parent = valueElement.parentNode;
    parent.replaceChild(input, valueElement);
    input.focus();
    input.select();

    // Handle save
    const saveEdit = () => {
      const newValue = input.value.trim();
      if (newValue) {
        // Save to edited data
        switch (field) {
          case 'document_number':
            this.editedData.document_number = newValue;
            break;
          case 'date':
            this.editedData.document_date = newValue;
            break;
          case 'amount':
            this.editedData.total_amount = newValue;
            break;
          case 'credit_card':
            this.editedData.credit_card_last4 = newValue;
            break;
        }

        // Update display
        switch (field) {
          case 'amount':
            valueElement.textContent = `₪${newValue}`;
            break;
          case 'credit_card':
            valueElement.textContent = `****${newValue}`;
            break;
          default:
            valueElement.textContent = newValue;
        }
      }

      // Restore original element
      parent.replaceChild(valueElement, input);
    };

    // Save on blur or Enter
    input.addEventListener('blur', saveEdit);
    input.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        saveEdit();
      }
    });
  }

  /**
   * Open supplier search modal
   */
  openSupplierModal() {
    this.elements.supplierModal.style.display = 'flex';
    this.elements.supplierSearch.value = '';
    this.populateSupplierList();
    this.elements.supplierSearch.focus();
  }

  /**
   * Close supplier search modal
   */
  closeSupplierModal() {
    this.elements.supplierModal.style.display = 'none';
  }

  /**
   * Populate supplier list
   */
  populateSupplierList(filter = '') {
    const list = this.elements.supplierList;
    list.innerHTML = '';

    const normalizedFilter = filter.toLowerCase().trim();

    // Get all suppliers
    const allSuppliers = [
      ...SUPPLIERS.priority.map((name) => ({ name, category: 'ספק מוכר' })),
      ...SUPPLIERS.categories.fuelStations.suppliers.map((name) => ({
        name,
        category: 'תחנת דלק',
      })),
      ...SUPPLIERS.categories.supermarkets.suppliers.map((name) => ({
        name,
        category: 'רשתות מזון',
      })),
    ];

    // Filter suppliers
    const filteredSuppliers = allSuppliers.filter((supplier) =>
      supplier.name.toLowerCase().includes(normalizedFilter)
    );

    // Create list items
    filteredSuppliers.forEach((supplier) => {
      const li = document.createElement('li');
      li.className = 'supplier-item';

      li.innerHTML = `
        <div class="supplier-name">${supplier.name}</div>
        <div class="supplier-category">${supplier.category}</div>
      `;

      li.addEventListener('click', () => {
        this.selectSupplier(supplier.name);
      });

      list.appendChild(li);
    });

    // Show message if no results
    if (filteredSuppliers.length === 0) {
      const li = document.createElement('li');
      li.style.padding = 'var(--spacing-md)';
      li.style.textAlign = 'center';
      li.style.color = 'var(--text-secondary)';
      li.textContent = 'לא נמצאו תוצאות';
      list.appendChild(li);
    }
  }

  /**
   * Filter suppliers based on search
   */
  filterSuppliers(query) {
    this.populateSupplierList(query);
  }

  /**
   * Select a supplier from the modal
   */
  selectSupplier(supplierName) {
    this.editedData.supplier_name = supplierName;
    this.elements.supplierValue.textContent = supplierName;

    // Determine category
    if (SUPPLIERS.priority.includes(supplierName)) {
      this.editedData.supplier_category = 'priority';
      this.elements.supplierCategory.style.display = 'none';
    } else if (
      SUPPLIERS.categories.fuelStations.suppliers.includes(supplierName)
    ) {
      this.editedData.supplier_category = 'fuel_station';
      this.elements.supplierCategory.textContent = 'קטגוריה: תחנת דלק';
      this.elements.supplierCategory.style.display = 'block';
    } else if (SUPPLIERS.categories.supermarkets.suppliers.includes(supplierName)) {
      this.editedData.supplier_category = 'supermarket';
      this.elements.supplierCategory.textContent = 'קטגוריה: רשתות מזון';
      this.elements.supplierCategory.style.display = 'block';
    }

    this.closeSupplierModal();
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
    let errorMsg = 'שגיאה בניתוח החשבונית';

    if (error.message.includes('API_KEY') || error.message.includes('API key')) {
      errorMsg = 'מפתח API לא תקין';
    } else if (error.message.includes('quota') || error.message.includes('QUOTA')) {
      errorMsg = 'חרגת ממכסת השימוש היומית';
    } else if (error.message.includes('Rate limit')) {
      errorMsg = 'יותר מדי בקשות. מנסה שוב...';
    } else if (error.message.includes('network') || error.message.includes('fetch')) {
      errorMsg = 'בעיית תקשורת - בדוק חיבור לאינטרנט';
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
    this.editedData = {};
    this.editMode = false;

    // Reset UI
    this.elements.uploadZone.style.display = 'block';
    this.elements.previewContainer.style.display = 'none';
    this.elements.resultsSection.style.display = 'none';
    this.elements.statusMessage.style.display = 'none';
    this.elements.processBtn.disabled = true;
    this.elements.fileInput.value = '';

    // Exit edit mode if active
    this.exitEditMode();

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
      this.showStatus('יש להגדיר את Google Sheets ב-config.js', 'warning');
      return;
    }

    try {
      this.elements.approveAndSendBtn.disabled = true;
      this.showStatus('שולח נתונים ל-Google Sheets...', 'info');

      // Merge original data with edited data
      const dataToSend = {
        supplier_category:
          this.editedData.supplier_category || this.currentResult.supplier_category,
        supplier_name: this.editedData.supplier_name || this.currentResult.supplier_name || '',
        document_number:
          this.editedData.document_number || this.currentResult.document_number || '',
        document_type: this.currentResult.document_type,
        document_date: this.editedData.document_date || this.currentResult.document_date || '',
        total_amount: this.editedData.total_amount || this.currentResult.total_amount || '',
        credit_card_last4:
          this.editedData.credit_card_last4 || this.currentResult.credit_card_last4 || '',
        notes: this.currentResult.notes || '',
      };

      console.log('Sending to Google Sheets:', dataToSend);

      // Send to Google Sheets via Apps Script
      const response = await fetch(CONFIG.SHEETS_CONFIG.scriptUrl, {
        method: 'POST',
        mode: 'no-cors', // Required for Google Apps Script
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(dataToSend),
      });

      // Note: With no-cors mode, we can't read the response
      // but we can assume success if no error was thrown
      this.showStatus('הנתונים נשלחו בהצלחה ל-Google Sheets!', 'success');

      // Exit edit mode if active
      if (this.editMode) {
        this.exitEditMode();
      }

      // Log success
      console.log('Data sent successfully to Google Sheets');
    } catch (error) {
      console.error('Sheets error:', error);
      this.showStatus('שגיאה בשליחת הנתונים', 'error');
    } finally {
      this.elements.approveAndSendBtn.disabled = false;
    }
  }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new InvoiceScanner();
  console.log('Zuza Patisserie Invoice Scanner initialized');
});
