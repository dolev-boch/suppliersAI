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
    this.completionSound = this.createCompletionSound();
    this.wakeLock = null; // Screen Wake Lock

    this.initializeElements();
    this.attachEventListeners();
    this.updateDailyTokenDisplay();
  }

  /**
   * Create completion sound using Web Audio API
   */
  createCompletionSound() {
    try {
      const audioContext = new (window.AudioContext || window.webkitAudioContext)();
      return () => {
        // Create a pleasant "ding" sound
        const oscillator = audioContext.createOscillator();
        const gainNode = audioContext.createGain();

        oscillator.connect(gainNode);
        gainNode.connect(audioContext.destination);

        oscillator.frequency.value = 800; // High pitch
        oscillator.type = 'sine';

        gainNode.gain.setValueAtTime(0.3, audioContext.currentTime);
        gainNode.gain.exponentialRampToValueAtTime(0.01, audioContext.currentTime + 0.5);

        oscillator.start(audioContext.currentTime);
        oscillator.stop(audioContext.currentTime + 0.5);
      };
    } catch (error) {
      console.warn('Audio API not supported:', error);
      return () => {}; // No-op if audio not supported
    }
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
      processBtn: document.getElementById('processBtn'),

      // Bulk upload section
      bulkUploadSection: document.getElementById('bulkUploadSection'),
      bulkUploadBtn: document.getElementById('bulkUploadBtn'),
      bulkFileInput: document.getElementById('bulkFileInput'),
      bulkProcessingState: document.getElementById('bulkProcessingState'),
      bulkProcessingText: document.getElementById('bulkProcessingText'),
      bulkProgressFill: document.getElementById('bulkProgressFill'),
      bulkProgressDetails: document.getElementById('bulkProgressDetails'),
      bulkResultsSummary: document.getElementById('bulkResultsSummary'),

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
      customSupplierSection: document.getElementById('customSupplierSection'),
      customSupplierName: document.getElementById('customSupplierName'),
      saveCustomSupplier: document.getElementById('saveCustomSupplier'),

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

    // Action buttons
    this.elements.editBtn.addEventListener('click', () => {
      if (this.editMode) {
        this.exitEditMode();
      } else {
        this.enterEditMode();
      }
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

    // Custom supplier (שונות)
    this.elements.saveCustomSupplier.addEventListener('click', () => {
      this.saveCustomSupplier();
    });

    this.elements.customSupplierName.addEventListener('keypress', (e) => {
      if (e.key === 'Enter') {
        this.saveCustomSupplier();
      }
    });

    // Bulk upload
    this.elements.bulkUploadBtn.addEventListener('click', () => {
      this.elements.bulkFileInput.click();
    });

    this.elements.bulkFileInput.addEventListener('change', (e) => {
      const files = Array.from(e.target.files);
      if (files.length > 0) {
        this.processBulkFiles(files);
      }
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

      // Analyze with Gemini - with progress callback
      const result = await GeminiService.analyzeInvoice(this.imageBase64, (progress) => {
        // Update loading text with progress status
        const loadingText = this.elements.loadingState.querySelector('p');
        if (loadingText) {
          loadingText.textContent = progress.message || 'מנתח חשבונית...';
        }
      });
      this.currentResult = result;
      this.editedData = {}; // Reset edited data

      console.log('Analysis result:', result);

      // Stop progress updates
      this.stopLoadingProgress();

      // Play completion sound
      this.completionSound();

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
  async startLoadingProgress() {
    // Request wake lock to keep screen on during scan
    try {
      if ('wakeLock' in navigator) {
        this.wakeLock = await navigator.wakeLock.request('screen');
        console.log('✅ Screen wake lock activated');
      }
    } catch (err) {
      console.warn('Wake Lock not supported or failed:', err);
    }

    // Calculate estimated time based on model
    const modelName = CONFIG.GEMINI_MODEL || 'gemini-2.5-flash';
    const isFlashLite = modelName.includes('lite');
    const estimatedTime = isFlashLite ? 15 : 30; // Flash Lite: ~15s, Flash: ~30s

    // Show initial message with time estimate
    this.elements.loadingProgress.textContent = `זמן משוער: ${estimatedTime} שניות`;

    this.loadingInterval = setInterval(() => {
      const elapsed = Math.floor((Date.now() - this.loadingStartTime) / 1000);
      const remaining = Math.max(0, estimatedTime - elapsed);

      if (elapsed < estimatedTime) {
        this.elements.loadingProgress.textContent = `עברו ${elapsed} שניות | נותרו ~${remaining} שניות`;
      } else if (elapsed < 50) {
        this.elements.loadingProgress.textContent = `עברו ${elapsed} שניות | כמעט מוכן...`;
      } else {
        this.elements.loadingProgress.textContent = `עברו ${elapsed} שניות | מעבד...`;
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

    // Release wake lock
    if (this.wakeLock) {
      this.wakeLock.release().then(() => {
        console.log('✅ Screen wake lock released');
        this.wakeLock = null;
      });
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
    const isCreditInvoice = result.document_type === 'credit_invoice';
    const isInvoice = result.document_type === 'invoice';

    let documentTypeText = 'תעודת משלוח';
    let documentTypeClass = 'delivery';

    if (isCreditInvoice) {
      documentTypeText = 'חשבונית זיכוי';
      documentTypeClass = 'credit-invoice';
    } else if (isInvoice) {
      documentTypeText = 'חשבונית מס';
      documentTypeClass = 'invoice';
    }

    this.elements.documentType.textContent = documentTypeText;
    this.elements.documentType.className = `document-type-badge ${documentTypeClass}`;

    // Date
    this.elements.dateValue.textContent = result.document_date || 'לא זוהה';
    this.setConfidenceBadge(this.elements.dateConfidence, result.date_confidence);

    // Amount
    this.elements.amountValue.textContent = result.total_amount
      ? `₪${result.total_amount}`
      : 'לא זוהה';
    this.setConfidenceBadge(this.elements.amountConfidence, result.total_confidence);

    // Credit card (only for special categories: fuel_station, supermarket, nursery, other)
    const showCreditCard =
      result.credit_card_last4 &&
      ['fuel_station', 'supermarket', 'nursery', 'other'].includes(result.supplier_category);

    if (showCreditCard) {
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
    console.log('🔧 Entering edit mode');
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
      if (!card) {
        console.error(`Card not found for field: ${field}`);
        return;
      }

      console.log(`Making ${field} editable`);
      card.classList.add('editable');
      card.style.cursor = 'pointer';

      const clickHandler = (e) => {
        e.stopPropagation();
        console.log(`Card clicked: ${field}`);
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

    console.log('✅ Edit mode activated. Click on any card to edit.');
  }

  /**
   * Exit edit mode
   */
  exitEditMode() {
    console.log('❌ Exiting edit mode');
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

    console.log('✅ Edit mode deactivated');
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
        originalValue = this.editedData.total_amount || this.currentResult.total_amount || '';
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

    // Pre-populate custom supplier field with AI-detected name
    // This helps when AI detected a supplier but mislabeled the category
    const currentSupplierName = this.currentResult?.supplier_name || '';
    this.elements.customSupplierName.value = currentSupplierName;

    this.elements.customSupplierSection.style.display = 'block';
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
    } else if (SUPPLIERS.categories.fuelStations.suppliers.includes(supplierName)) {
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
   * Save custom supplier as "שונות" (other)
   */
  saveCustomSupplier() {
    const supplierName = this.elements.customSupplierName.value.trim();

    if (!supplierName) {
      alert('נא להזין שם ספק');
      return;
    }

    console.log(`Saving custom supplier: ${supplierName} as "other"`);

    // Set as "other" category
    this.editedData.supplier_name = supplierName;
    this.editedData.supplier_category = 'other';

    // Update display
    this.elements.supplierValue.textContent = supplierName;
    this.elements.supplierCategory.textContent = 'קטגוריה: שונות';
    this.elements.supplierCategory.style.display = 'block';

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
   * Show status message (permanent, user controls visibility)
   */
  showStatus(message, type = 'info') {
    this.elements.statusMessage.textContent = message;
    this.elements.statusMessage.className = `status-message ${type}`;
    this.elements.statusMessage.style.display = 'block';

    // Success messages are permanent (no auto-hide)
    // User can start a new scan to clear them
  }

  /**
   * Handle errors
   */
  handleError(error) {
    let errorMsg = 'שגיאה בניתוח החשבונית';

    if (!error) {
      errorMsg = 'שגיאה לא ידועה - נא לנסות שוב';
    } else if (error.message) {
      if (error.message.includes('API_KEY') || error.message.includes('API key')) {
        errorMsg = 'מפתח API לא תקין';
      } else if (error.message.includes('quota') || error.message.includes('QUOTA')) {
        errorMsg = 'חרגת ממכסת השימוש היומית';
      } else if (error.message.includes('Rate limit') || error.message.includes('429')) {
        errorMsg = 'יותר מדי בקשות. המתן מספר שניות ונסה שוב';
      } else if (
        error.message.includes('network') ||
        error.message.includes('fetch') ||
        error.message.includes('Failed to fetch')
      ) {
        errorMsg = 'בעיית תקשורת - בדוק חיבור לאינטרנט';
      } else if (error.message.includes('timeout') || error.message.includes('timed out')) {
        errorMsg = 'הבקשה ארכה זמן רב - נסה שוב';
      } else if (error.message.includes('Failed after')) {
        errorMsg = 'כל הניסיונות נכשלו - נסה שוב במספר שניות';
      }
    }

    this.showStatus(errorMsg, 'error');

    // Show detailed error in console
    console.error('Error details:', error);

    // Ensure UI is reset properly
    this.stopLoadingProgress();
    this.elements.loadingState.style.display = 'none';
    this.elements.processBtn.disabled = false;
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
    this.elements.processBtn.style.display = 'block';
    this.elements.fileInput.value = '';
    this.elements.bulkFileInput.value = '';

    // Show bulk upload section
    this.elements.bulkUploadSection.style.display = 'block';

    // Hide bulk processing state
    this.elements.bulkProcessingState.style.display = 'none';

    // Exit edit mode if active
    this.exitEditMode();

    // Scroll to top
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  /**
   * Process multiple files in bulk
   */
  async processBulkFiles(files) {
    if (!files || files.length === 0) {
      this.showStatus('לא נבחרו קבצים', 'error');
      return;
    }

    console.log(`Starting bulk processing of ${files.length} files`);

    // Hide upload section and single results
    this.elements.uploadZone.style.display = 'none';
    this.elements.previewContainer.style.display = 'none';
    this.elements.processBtn.style.display = 'none';
    this.elements.bulkUploadSection.style.display = 'none';
    this.elements.resultsSection.style.display = 'none';
    this.elements.statusMessage.style.display = 'none';

    // Show bulk processing UI
    this.elements.bulkProcessingState.style.display = 'block';
    this.elements.bulkProgressFill.style.width = '0%';
    this.elements.bulkResultsSummary.innerHTML = '';

    const results = {
      total: files.length,
      processed: 0,
      successful: 0,
      failed: 0,
      details: [],
    };

    // Process each file sequentially
    for (let i = 0; i < files.length; i++) {
      const file = files[i];
      const fileNum = i + 1;

      try {
        this.elements.bulkProcessingText.textContent = `מעבד קובץ ${fileNum} מתוך ${files.length}`;
        this.elements.bulkProgressDetails.textContent = `${fileNum}/${files.length} קבצים`;

        // Update progress bar
        const progressPercent = ((fileNum - 1) / files.length) * 100;
        this.elements.bulkProgressFill.style.width = `${progressPercent}%`;

        // Read file as base64
        const base64Image = await this.readFileAsBase64(file);

        // Analyze with Gemini
        const result = await GeminiService.analyzeInvoice(base64Image);

        // Send to Google Sheets immediately
        await this.sendBulkDataToSheets(result);

        results.successful++;
        results.details.push({
          fileName: file.name,
          status: 'success',
          supplier: result.supplier_name,
          amount: result.total_amount,
        });

        console.log(`✅ File ${fileNum}/${files.length} processed: ${file.name}`);
      } catch (error) {
        console.error(`❌ Error processing file ${file.name}:`, error);
        results.failed++;
        results.details.push({
          fileName: file.name,
          status: 'failed',
          error: error.message,
        });
      }

      results.processed++;

      // Update summary
      this.updateBulkSummary(results);
    }

    // Completed
    this.elements.bulkProgressFill.style.width = '100%';
    this.elements.bulkProcessingText.textContent = 'העיבוד הושלם!';
    this.elements.bulkProgressDetails.textContent = `${results.successful} הצליחו, ${results.failed} נכשלו`;

    // Show final summary
    this.showBulkCompletionMessage(results);

    // Reset file input
    this.elements.bulkFileInput.value = '';
  }

  /**
   * Read file as base64
   */
  readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const base64 = e.target.result.split(',')[1];
        resolve(base64);
      };
      reader.onerror = reject;
      reader.readAsDataURL(file);
    });
  }

  /**
   * Send data to Google Sheets with automatic retry
   * @param {Object} data - Data to send
   * @param {number} maxRetries - Maximum number of retry attempts (default: 3)
   */
  async sendToSheetsWithRetry(data, maxRetries = 3) {
    let lastError = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        console.log(`Attempt ${attempt}/${maxRetries}: Sending to Google Sheets`);
        console.log('Data being sent:', JSON.stringify(data, null, 2));
        console.log('Script URL:', CONFIG.SHEETS_CONFIG.scriptUrl);

        await fetch(CONFIG.SHEETS_CONFIG.scriptUrl, {
          method: 'POST',
          mode: 'no-cors',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(data),
        });

        // If fetch succeeds, return immediately
        console.log(`✅ Successfully sent to Google Sheets (main invoice) on attempt ${attempt}`);
        return;
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt}/${maxRetries} failed:`, error);

        // If this wasn't the last attempt, wait before retrying
        if (attempt < maxRetries) {
          const delay = 1000 * attempt; // Exponential backoff: 1s, 2s, 3s
          console.log(`Waiting ${delay}ms before retry...`);
          await new Promise((resolve) => setTimeout(resolve, delay));
        }
      }
    }

    // If all retries failed, throw the last error
    throw new Error(
      `Failed to send to Google Sheets after ${maxRetries} attempts: ${
        lastError?.message || 'Unknown error'
      }`
    );
  }

  /**
   * Send products data to products tracking sheet
   * @param {Object} result - Invoice result with products array
   */
  async sendProductsToSheet(result) {
    if (!CONFIG.SHEETS_CONFIG.productsScriptUrl) {
      console.warn('⚠️ Products script URL not configured - skipping product tracking');
      return;
    }

    if (!result.products || result.products.length === 0) {
      console.log('ℹ️ No products to send');
      return;
    }

    // Filter out products with zero or invalid prices
    const validProducts = result.products.filter((product) => {
      const price = parseFloat(product.unit_price_before_vat);
      return !isNaN(price) && price > 0;
    });

    if (validProducts.length === 0) {
      console.log('ℹ️ No products with valid prices to send');
      return;
    }

    // Log filtered products if any were removed
    if (validProducts.length < result.products.length) {
      console.log(
        `⚠️ Filtered out ${
          result.products.length - validProducts.length
        } products with zero/invalid prices`
      );
    }

    const productsData = {
      supplier_name: result.supplier_name,
      document_date: result.document_date,
      products: validProducts, // Only send products with valid prices > 0
    };

    console.log(`📦 Sending ${validProducts.length} products to tracking sheet:`, productsData);

    try {
      await fetch(CONFIG.SHEETS_CONFIG.productsScriptUrl, {
        method: 'POST',
        mode: 'no-cors',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(productsData),
      });

      console.log(`✅ Products sent successfully to tracking sheet`);
    } catch (error) {
      console.error('❌ Error sending products to tracking sheet:', error);
      // Don't throw - we don't want to fail the entire submission if products fail
    }
  }

  /**
   * Send bulk data to Google Sheets
   */
  async sendBulkDataToSheets(result) {
    if (!CONFIG.SHEETS_CONFIG.scriptUrl) {
      throw new Error('Google Sheets not configured');
    }

    const dataToSend = {
      supplier_category: result.supplier_category,
      supplier_name: result.supplier_name || '',
      document_number: result.document_number || '',
      document_type: result.document_type,
      document_date: result.document_date || '',
      total_amount: result.total_amount || '',
      credit_card_last4: result.credit_card_last4 || '',
      notes: result.notes || '',
    };

    console.log('Sending bulk data to Google Sheets:', dataToSend);

    // Use retry mechanism
    await this.sendToSheetsWithRetry(dataToSend, 3);

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 500));
  }

  /**
   * Update bulk processing summary
   */
  updateBulkSummary(results) {
    let summaryHTML = '<div class="bulk-summary-list">';

    results.details.forEach((detail) => {
      const icon =
        detail.status === 'success'
          ? '<span class="status-icon success">✓</span>'
          : '<span class="status-icon failed">✗</span>';

      const info =
        detail.status === 'success'
          ? `${detail.supplier} - ₪${detail.amount}`
          : `שגיאה: ${detail.error}`;

      summaryHTML += `
        <div class="bulk-item ${detail.status}">
          ${icon}
          <span class="bulk-item-name">${detail.fileName}</span>
          <span class="bulk-item-info">${info}</span>
        </div>
      `;
    });

    summaryHTML += '</div>';
    this.elements.bulkResultsSummary.innerHTML = summaryHTML;
  }

  /**
   * Show bulk completion message
   */
  showBulkCompletionMessage(results) {
    setTimeout(() => {
      let message = `נשלחו ${results.successful} מתוך ${results.total} קבצים בהצלחה`;

      if (results.failed > 0) {
        message += ` (${results.failed} נכשלו)`;
      }

      // Add a "New Bulk Scan" button
      const newBulkBtn = document.createElement('button');
      newBulkBtn.className = 'primary-btn';
      newBulkBtn.textContent = 'סרוק קבצים נוספים';
      newBulkBtn.style.marginTop = 'var(--spacing-lg)';
      newBulkBtn.addEventListener('click', () => {
        this.resetForNewScan();
      });

      this.elements.bulkResultsSummary.appendChild(newBulkBtn);

      this.showStatus(message, results.failed === 0 ? 'success' : 'warning');
    }, 500);
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
      // Show loading state
      this.elements.approveAndSendBtn.disabled = true;
      this.elements.approveAndSendBtn.textContent = 'שולח...';
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

      // Send to Google Sheets via Apps Script with retry logic
      await this.sendToSheetsWithRetry(dataToSend);

      // Send products to products tracking sheet
      if (this.currentResult.products && this.currentResult.products.length > 0) {
        await this.sendProductsToSheet(this.currentResult);
      }

      this.showStatus('הנתונים נשלחו בהצלחה ל-Google Sheets! 🎉', 'success');

      // Exit edit mode if active
      if (this.editMode) {
        this.exitEditMode();
      }

      // Log success
      console.log('Data sent successfully to Google Sheets');

      // Reset UI after successful submission to allow new scan
      setTimeout(() => {
        this.resetForNewScan();
      }, 2000);
    } catch (error) {
      console.error('Sheets error:', error);
      this.showStatus('שגיאה בשליחת הנתונים', 'error');
    } finally {
      // Restore button state
      this.elements.approveAndSendBtn.disabled = false;
      this.elements.approveAndSendBtn.textContent = this.editMode ? 'שמור ושלח' : 'אישור ושליחה';
    }
  }
}

// Initialize application when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
  window.app = new InvoiceScanner();
  console.log('Zuza Patisserie Invoice Scanner initialized');
});
