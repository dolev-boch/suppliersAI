// Gemini AI Integration with Request Queue
// Model: Gemini 3.5 Flash-Lite (see config.js)

const GeminiService = {
  /**
   * Analyze invoice image with Gemini AI (using request queue)
   */
  async analyzeInvoice(base64Image, onProgress = null, mimeType = 'image/jpeg') {
    return geminiQueue.enqueue(async () => {
      return await this.performAnalysis(base64Image, onProgress, mimeType);
    });
  },

  /**
   * Build the generationConfig for Gemini 3.x
   */
  buildGenerationConfig(overrides = {}) {
    const gc = CONFIG.GENERATION_CONFIG || {};
    return {
      maxOutputTokens: gc.maxOutputTokens || 32768,
      responseMimeType: 'application/json',
      thinkingConfig: { thinkingLevel: overrides.thinkingLevel || gc.thinkingLevel || 'low' },
    };
  },

  /**
   * Low-level call to generateContent. Returns { text, usage, finishReason }.
   */
  async callGemini(parts, { timeoutMs = 60000, thinkingLevel } = {}) {
    const apiUrl = `${CONFIG.GEMINI_API_URL}/${CONFIG.GEMINI_MODEL}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    const requestBody = {
      contents: [{ parts }],
      generationConfig: this.buildGenerationConfig({ thinkingLevel }),
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    try {
      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(requestBody),
        signal: controller.signal,
      });

      if (!response.ok) {
        let errorMsg = 'שגיאת API';
        try {
          const errorData = await response.json();
          errorMsg = errorData.error?.message || errorMsg;
        } catch (_) {}
        if (response.status === 429) throw new Error('429 Rate limit exceeded');
        throw new Error(errorMsg);
      }

      const data = await response.json();
      const candidate = data.candidates && data.candidates[0];
      if (!candidate || !candidate.content || !candidate.content.parts) {
        throw new Error(`Empty response from AI (${candidate?.finishReason || 'no candidate'})`);
      }

      // Ignore thought parts (if any) — take only the answer text
      const text = candidate.content.parts
        .filter((p) => typeof p.text === 'string' && !p.thought)
        .map((p) => p.text)
        .join('');

      return { text, usage: data.usageMetadata, finishReason: candidate.finishReason };
    } catch (err) {
      if (err.name === 'AbortError') {
        throw new Error(`Request timed out after ${timeoutMs / 1000} seconds`);
      }
      throw err;
    } finally {
      clearTimeout(timeoutId);
    }
  },

  /**
   * Parse JSON from model text (tolerates code fences / leading text)
   */
  parseJson(text) {
    let jsonText = (text || '').trim();
    jsonText = jsonText.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '');
    const firstBrace = jsonText.search(/[\{\[]/);
    if (firstBrace > 0) jsonText = jsonText.slice(firstBrace);
    try {
      return JSON.parse(jsonText);
    } catch (e) {
      console.error('Invalid JSON from AI:', jsonText);
      throw new Error(`AI returned invalid JSON: ${e.message}`);
    }
  },

  /**
   * Perform the actual API call with retry (called by the queue)
   */
  async performAnalysis(base64Image, onProgress = null, mimeType = 'image/jpeg') {
    const MAX_RETRIES = 3;
    const TIMEOUT_MS = 60000; // thinking ('low') needs a bit more time than before
    const RETRY_DELAYS = [1000, 2500];

    let lastError = null;

    for (let attempt = 0; attempt < MAX_RETRIES; attempt++) {
      try {
        if (attempt > 0) {
          const delay = RETRY_DELAYS[attempt - 1] || 2500;
          const message = `ממתין ${Math.round(delay / 1000)} שניות לפני ניסיון ${attempt + 1}...`;
          if (onProgress) onProgress({ status: 'retrying', attempt, message });
          await new Promise((resolve) => setTimeout(resolve, delay));
        }

        const message =
          attempt === 0 ? 'מנתח חשבונית...' : `ניסיון ${attempt + 1} מתוך ${MAX_RETRIES}...`;
        if (onProgress)
          onProgress({ status: 'analyzing', attempt: attempt + 1, total: MAX_RETRIES, message });

        const { text, usage, finishReason } = await this.callGemini(
          [
            { text: this.buildPrompt() },
            { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } },
          ],
          { timeoutMs: TIMEOUT_MS }
        );

        console.log('✅ Gemini Response received', { usage, finishReason });

        if (finishReason === 'MAX_TOKENS') {
          throw new Error('Response truncated (MAX_TOKENS)');
        }
        if (onProgress) onProgress({ status: 'processing', message: 'עיבוד תשובה...' });

        const parsed = this.parseJson(text);
        console.log('🔍 AI raw result:', parsed);

        parsed.products = this.cleanProducts(parsed.products || []);

        const validated = this.validateResponse(parsed);
        validated.readability = this.assessReadability(validated);

        if (onProgress)
          onProgress({ status: 'success', attempt: attempt + 1, message: 'החשבונית נותחה' });

        return { ...validated, usage };
      } catch (error) {
        lastError = error;
        console.error(`❌ Attempt ${attempt + 1} failed:`, error.message);

        const nonRetryable = /API key|API_KEY|PERMISSION_DENIED|not found for API version/i.test(
          error.message
        );
        if (nonRetryable || attempt === MAX_RETRIES - 1) {
          if (onProgress)
            onProgress({ status: 'failed', message: 'הניתוח נכשל. נא לנסות שוב.' });
          throw new Error(`Failed after ${attempt + 1} attempts. Last error: ${error.message}`);
        }
        if (onProgress)
          onProgress({ status: 'retry', attempt: attempt + 1, message: `ניסיון ${attempt + 1} נכשל - מנסה שוב...` });
      }
    }

    throw lastError || new Error('Unknown error during retries');
  },

  /**
   * Normalize product name for deduplication within a single invoice
   */
  normalizeProductName(name) {
    return String(name || '')
      .toLowerCase()
      .trim()
      .replace(/[״׳'"`]/g, '')
      .replace(/[.,]/g, '')
      .replace(/\s+/g, ' ');
  },

  toNum(v) {
    if (v === null || v === undefined || v === '') return null;
    const n = parseFloat(String(v).replace(/[₪,\s]/g, ''));
    return isNaN(n) ? null : n;
  },

  /**
   * Coerce product fields and merge duplicate lines of the same product.
   * When merging, the unit price is recomputed from the totals (so a discounted
   * line and a regular line produce the true average, not the first line's price).
   */
  cleanProducts(products) {
    const map = new Map();
    for (const raw of products) {
      if (!raw || !raw.name || !String(raw.name).trim()) continue;
      const p = {
        ...raw,
        name: String(raw.name).trim(),
        quantity: this.toNum(raw.quantity),
        unit_price_before_vat: this.toNum(raw.unit_price_before_vat),
        total_before_vat: this.toNum(raw.total_before_vat),
        price_before_discount: this.toNum(raw.price_before_discount),
        discount_amount: this.toNum(raw.discount_amount),
        discount_percent: this.toNum(raw.discount_percent),
        discount_applied: raw.discount_applied === true || raw.discount_applied === 'true',
        confidence: this.toNum(raw.confidence) ?? 0,
      };

      const key = this.normalizeProductName(p.name);
      if (!map.has(key)) {
        map.set(key, p);
        continue;
      }

      const e = map.get(key);
      const qty = (e.quantity || 0) + (p.quantity || 0);
      const total = (e.total_before_vat || 0) + (p.total_before_vat || 0);
      e.quantity = qty || null;
      e.total_before_vat = total || null;
      if (qty > 0 && total > 0) e.unit_price_before_vat = Math.round((total / qty) * 100) / 100;
      e.discount_applied = e.discount_applied || p.discount_applied;
      e.discount_amount = (e.discount_amount || 0) + (p.discount_amount || 0) || null;
      if (e.discount_percent !== p.discount_percent) e.discount_percent = e.discount_percent ?? p.discount_percent;
      e.confidence = Math.min(e.confidence, p.confidence);
    }
    return Array.from(map.values());
  },

  /**
   * Build prompt for Gemini
   */
  buildPrompt() {
    const prioritySuppliers = SUPPLIERS.priority.join('", "');
    const year = new Date().getFullYear();

    return `אתה מומחה לקריאת חשבוניות ותעודות משלוח בעברית עבור "זוזה פטיסרי" (הלקוח/הקונה).
המטרה: חילוץ מדויק בלבד. **אסור לנחש.** אם משהו לא קריא בבירור — סמן זאת, אל תמציא ערך.

## 0. בדיקת קריאות (חובה)
- is_readable: false אם התמונה מטושטשת/חתוכה/חשוכה/מקומטת כך שלא ניתן לקרוא בוודאות את **שם הספק**, **הסכום הכולל**, או את **שורות המוצרים והמחירים**.
- במקרה כזה: is_readable=false, unreadable_reason קצר בעברית (למשל "שורות המוצרים מטושטשות"), והחזר רק את מה שקראת בוודאות.
- confidence גבוה (90+) רק לנתון שקראת בבירור מלא. נתון שהשלמת/ניחשת — confidence נמוך מ-60.

## 1. חשבונית זיכוי
חפש "זיכוי" / "Credit" → document_type: "credit_invoice", total_amount שלילי ("-256.50"), notes: "חשבונית זיכוי".

## 2. זיהוי הספק (מנפיק המסמך)
- הספק = **מי שהנפיק את המסמך**: השם בכותרת/לוגו העליון, לרוב ליד "ח.פ." / "ע.מ." / "עוסק מורשה" / טלפון וכתובת של העסק.
- **אל** תיקח את שם הלקוח: מה שמופיע אחרי "לכבוד" / "לקוח" / "שם הלקוח" / "Bill to", ובפרט "זוזה" / "Zuza" / "עדן" — זה הקונה, לא הספק.
- supplier_name_raw: השם בדיוק כפי שמודפס.
- רשימת ספקים מוכרים (PRIORITY):
"${prioritySuppliers}"
- אם השם המודפס דומה לאחד מהמוכרים (שגיאת כתיב קטנה, תוספת בע"מ, מילה חסרה/נוספת, אנגלית) → supplier_category: "priority", supplier_name: השם **מהרשימה** בדיוק.
- אחרת supplier_name = השם המודפס (בלי בע"מ).

### קטגוריות (רק אם לא priority):
**תחנת דלק:** Yellow, דור אלון, סונול, פז, Ten, באר מרים, שלמה סיקסט (דלק, תדלוק, בנזין, דיזל) → "fuel_station"
**רשתות מזון:** ויקטורי, רמי לוי, דוכן צמח, שופרסל וכו' (קח לוגו ראשי) → "supermarket". תמיד invoice + 4 ספרות כרטיס אשראי.
**משתלות:** משתלה, גננות, nursery, עציצים, מוצרי נוי, פרחים (המילה "צמח" לבד אינה מספיקה) → "nursery"
**אחר:** → "other"

## 3. שדות המסמך
- document_number: המספר **בדיוק כפי שמודפס** ליד הכותרת "חשבונית מס" / "תעודת משלוח" / "חשבונית זיכוי" (לא מספר הזמנה/לקוח/טלפון). אל תוסיף או תשמיט ספרות.
- document_date: DD/MM/YYYY. השנה כמעט תמיד ${year} או ${year - 1}. אם השנה מודפסת בשתי ספרות (26) → ${year}.
- total_amount: הסכום הסופי לתשלום כולל מע"מ (זיכוי = שלילי).
- subtotal_before_vat: הסכום לפני מע"מ כפי שמודפס (null אם אין).
- vat_amount: סכום המע"מ (null אם אין).
- invoice_discount_amount: הנחה כללית על כל החשבונית בש"ח לפני מע"מ (null אם אין).
- invoice_discount_percent: אחוז ההנחה הכללית אם מודפס (null אם לא).
- other_charges_before_vat: חיובים שאינם מוצרים (דמי משלוח, פיקדון, עיגול אגורות) לפני מע"מ, סכום אחד (0 אם אין).
- credit_card_last4: חובה עבור fuel_station/supermarket/nursery/other — 4 ספרות ליד "אשראי"/"כרטיס". עבור priority → null.

## 4. מוצרים — חלץ את **כל** שורות המוצרים (אין מגבלת כמות)
לכל מוצר:
- name: שם המוצר **בדיוק** כפי שמודפס, כולל משקל/נפח/אחוז שומן/גודל (למשל "שמנת 38% 1 ליטר"). אל תקצר ואל "תתקן".
- quantity, unit (ק״ג, ליטר, יח׳, מארז, גרם, מ״ל...)
- unit_price_before_vat: מחיר ליחידה **נטו אחרי הנחה ולפני מע"מ**
- total_before_vat: סה"כ השורה **אחרי הנחה ולפני מע"מ**
- discount_applied: true אם יש הנחה על המוצר (שורת "הנחה"/"ה.בש" מתחת לו, עמודת "% הנחה", או הנחה כללית)
- price_before_discount: מחיר יחידה לפני ההנחה (לפני מע"מ), null אם אין הנחה
- discount_percent: אחוז ההנחה **רק אם מודפס במסמך** (בעמודה או בשורת ההנחה). אם לא מודפס אחוז → null. אל תחשב אחוז בעצמך.
- discount_amount: סכום ההנחה לשורה בש"ח לפני מע"מ, null אם אין
- confidence: 0-100 — כמה בטוח אתה בשם, בכמות ובמחיר של השורה

### כלל מע"מ
חשב Σ(כמות × מחיר מודפס):
- ≈ הסכום הכולל עם מע"מ → המחירים כוללים מע"מ → חלק כל מחיר וכל סה"כ ב-1.18 (prices_include_vat: true)
- ≈ הסכום לפני מע"מ → השתמש כמו שכתוב (prices_include_vat: false)
- אין מע"מ במסמך → כמו שכתוב.

### כלל הנחה לשורה (הכי חשוב)
מוצר ואחריו שורת "הנחה -X": סה"כ נטו = סה"כ מקורי − X ; מחיר יחידה נטו = סה"כ נטו ÷ כמות.
דוגמה: גרנד פדנו מגורד | כמות 2 | מחיר 96.83 | סה"כ 193.66, ושורה "הנחה -15.00"
→ unit_price_before_vat 89.33, total_before_vat 178.66, discount_applied true, price_before_discount 96.83, discount_amount 15.00, discount_percent null
דוגמה עם אחוז: שמנת | כמות 8 | מחיר 36.90 | הנחה 10% | נטו 265.68
→ unit_price_before_vat 33.21, total_before_vat 265.68, discount_applied true, price_before_discount 36.90, discount_amount 29.52, discount_percent 10
אם יש עמודת "מחיר נטו" — השתמש בה כמחיר אחרי הנחה.

### הנחה כללית על כל החשבונית
אם מודפס אחוז (למשל "הנחה 5%") → החל אותו על כל מוצר (unit_price ו-total אחרי הנחה), discount_applied true, discount_percent 5.
אם מודפס רק סכום בש"ח → חלק אותו באופן יחסי בין המוצרים, discount_applied true, discount_percent null.

### לא מוצרים
דלג על: סיכומים, מע"מ, כותרות, שורות הנחה (הן חלק מהמוצר שמעליהן), דמי משלוח/פיקדון/עיגול (רשום אותם ב-other_charges_before_vat).
אם אותו מוצר מופיע בכמה שורות — אפשר להחזיר כמה רשומות; המערכת תאחד.
אם שורה לא קריאה — החזר אותה עם confidence נמוך (אל תשמיט אותה בשקט ואל תמציא).
בתעודת משלוח ללא מחירים: החזר שמות וכמויות עם unit_price_before_vat: null.

## JSON בלבד:
{
  "is_readable": true,
  "unreadable_reason": null,
  "supplier_category": "priority|fuel_station|supermarket|nursery|other",
  "supplier_name": "שם הספק",
  "supplier_name_raw": "השם כפי שמודפס",
  "supplier_confidence": 95,
  "document_number": "...",
  "document_number_confidence": 95,
  "document_type": "invoice|delivery_note|credit_invoice",
  "notes": "",
  "document_date": "DD/MM/YYYY",
  "date_confidence": 95,
  "total_amount": "234.50",
  "total_confidence": 95,
  "subtotal_before_vat": 198.73,
  "vat_amount": 35.77,
  "prices_include_vat": false,
  "invoice_discount_amount": null,
  "invoice_discount_percent": null,
  "other_charges_before_vat": 0,
  "credit_card_last4": null,
  "credit_card_confidence": 0,
  "products": [
    {
      "name": "שם מוצר מלא",
      "quantity": 10,
      "unit": "ק״ג",
      "unit_price_before_vat": 5.80,
      "total_before_vat": 58.00,
      "discount_applied": false,
      "price_before_discount": null,
      "discount_percent": null,
      "discount_amount": null,
      "confidence": 95
    }
  ]
}`;
  },

  /**
   * Decide whether the scan is reliable enough to save.
   * Returns { ok, reasons[] }. When !ok the user is asked to re-photograph.
   */
  assessReadability(result) {
    const R = CONFIG.READABILITY || {};
    const reasons = [];

    if (result.is_readable === false) {
      reasons.push(result.unreadable_reason || 'המסמך לא קריא');
    }

    if (!result.supplier_name || (result.supplier_confidence || 0) < (R.MIN_SUPPLIER_CONFIDENCE ?? 75)) {
      reasons.push('שם הספק לא זוהה בוודאות');
    }

    const total = this.toNum(result.total_amount);
    if (total === null || (result.total_confidence || 0) < (R.MIN_TOTAL_CONFIDENCE ?? 75)) {
      reasons.push('הסכום הכולל לא זוהה בוודאות');
    }

    if (!result.document_date || (result.date_confidence || 0) < 60) {
      reasons.push('התאריך לא זוהה בוודאות');
    }

    const products = result.products || [];
    const lowConf = products.filter((p) => (p.confidence || 0) < (R.MIN_PRODUCT_CONFIDENCE ?? 70));
    if (lowConf.length > 0) {
      reasons.push(`${lowConf.length} שורות מוצרים לא קריאות בוודאות`);
    }

    // Reconcile product lines against the invoice totals
    const priced = products.filter((p) => p.total_before_vat !== null && p.total_before_vat > 0);
    if (priced.length > 0 && total !== null) {
      const sum = priced.reduce((s, p) => s + p.total_before_vat, 0) + (this.toNum(result.other_charges_before_vat) || 0);
      const absTotal = Math.abs(total);
      const subtotal = this.toNum(result.subtotal_before_vat);
      const invDisc = this.toNum(result.invoice_discount_amount) || 0;

      const candidates = [absTotal / 1.18, absTotal];
      if (subtotal) candidates.push(Math.abs(subtotal), Math.abs(subtotal) - invDisc);

      const tolPct = (R.PRODUCTS_SUM_TOLERANCE_PCT ?? 4) / 100;
      const tolAbs = R.PRODUCTS_SUM_TOLERANCE_ABS ?? 3;
      const matches = candidates.some((c) => c > 0 && Math.abs(sum - c) <= Math.max(tolAbs, c * tolPct));
      if (!matches) {
        console.warn(`⚠️ Products sum ${sum.toFixed(2)} does not match invoice totals`, candidates);
        reasons.push('סכום שורות המוצרים לא תואם לסכום החשבונית');
      }
    }

    return { ok: reasons.length === 0, reasons };
  },

  /**
   * Second AI step: map the invoice's product names to the supplier's existing
   * catalog (names already stored in the products sheet), so an abbreviated or
   * slightly mis-read name updates the existing product instead of creating a new one.
   * Never throws — on any failure the products are returned unchanged.
   */
  async matchProductsToCatalog(result) {
    try {
      const url = CONFIG.SHEETS_CONFIG.productsScriptUrl;
      const products = (result.products || []).filter((p) => p.unit_price_before_vat > 0);
      if (!url || !result.supplier_name || products.length === 0) return result;

      const resp = await fetch(
        `${url}?action=catalog&supplier=${encodeURIComponent(result.supplier_name)}`
      );
      const catalog = await resp.json();
      if (!catalog || !catalog.success) return result;

      if (catalog.sheet_name) result.products_sheet_name = catalog.sheet_name;
      const names = (catalog.products || []).map((p) => p.name).filter(Boolean);
      if (names.length === 0) return result;

      const prompt = `התאם בין שמות מוצרים מחשבונית של הספק "${catalog.sheet_name || result.supplier_name}" לבין קטלוג המוצרים הקיים של אותו ספק.
התאם רק אם זה **אותו מוצר בדיוק** (קיצור, שגיאת כתיב, סדר מילים שונה, תוספת/השמטת מילה כמו "ק"ג" או מותג — בסדר).
**אל תתאים** אם יש הבדל מהותי: גודל/משקל/נפח שונה, אחוז שומן שונה, טעם/סוג/צבע שונה, מוצר אחר.
אם אין התאמה ודאית → null.

קטלוג:
${names.map((n, i) => `${i}: ${n}`).join('\n')}

מוצרים מהחשבונית:
${products.map((p, i) => `${i}: ${p.name}`).join('\n')}

החזר JSON בלבד: {"matches":[{"invoice":0,"catalog":3},{"invoice":1,"catalog":null}]}`;

      const { text } = await this.callGemini([{ text: prompt }], {
        timeoutMs: 25000,
        thinkingLevel: 'low',
      });
      const parsed = this.parseJson(text);

      (parsed.matches || []).forEach((m) => {
        const p = products[m.invoice];
        const idx = m.catalog;
        if (p && Number.isInteger(idx) && names[idx]) {
          p.catalog_name = names[idx];
          if (names[idx] !== p.name) console.log(`🔗 Product matched: "${p.name}" → "${names[idx]}"`);
        }
      });
    } catch (err) {
      console.warn('⚠️ Catalog matching skipped:', err.message);
    }
    return result;
  },

  /**
   * Validate and categorize AI response
   */
  validateResponse(response) {
    const supplierName = response.supplier_name || '';
    const rawName = response.supplier_name_raw || '';
    const supplierCategory = response.supplier_category || '';

    let validated = { ...response };

    // Priority match on either the normalized or the raw printed name
    const priorityMatch = SupplierMatcher.findPriorityMatch(supplierName).matched
      ? SupplierMatcher.findPriorityMatch(supplierName)
      : SupplierMatcher.findPriorityMatch(rawName);

    if (priorityMatch.matched) {
      console.log(`✅ Priority supplier matched: "${supplierName}" → "${priorityMatch.supplier}"`);
      validated = {
        ...validated,
        supplier_category: 'priority',
        supplier_name: priorityMatch.supplier,
        supplier_confidence: Math.max(response.supplier_confidence || 0, priorityMatch.confidence),
        credit_card_last4: null,
      };
    } else if (['fuel_station', 'supermarket', 'nursery'].includes(supplierCategory)) {
      const categoryMatch = SupplierMatcher.findCategoryMatch(supplierName);
      if (categoryMatch.matched) {
        validated.supplier_name = categoryMatch.supplierName || supplierName;
        validated.supplier_confidence = Math.max(response.supplier_confidence || 0, categoryMatch.confidence);
      }
      if (supplierCategory === 'supermarket' && validated.document_type === 'delivery_note') {
        validated.document_type = 'invoice';
      }
    } else {
      // "other" — the server will still route it to an existing supplier sheet/folder
      // if the name is a near match (see main-invoice-script.gs / drive-upload.gs)
      const categoryMatch = SupplierMatcher.findCategoryMatch(supplierName);
      if (categoryMatch.matched) {
        validated.supplier_category = this.getCategoryKey(categoryMatch.category);
        validated.supplier_name = categoryMatch.supplierName || supplierName;
      } else {
        validated.supplier_category = 'other';
      }
    }

    // Credit invoices: negative amount + note
    if (validated.document_type === 'credit_invoice') {
      const amount = parseFloat(validated.total_amount);
      if (!isNaN(amount) && amount > 0) validated.total_amount = (-amount).toString();
      const notes = validated.notes || '';
      if (!notes.includes('חשבונית זיכוי')) {
        validated.notes = notes ? `${notes} | חשבונית זיכוי` : 'חשבונית זיכוי';
      }
    }

    return validated;
  },

  /**
   * Get category key from Hebrew name
   */
  getCategoryKey(hebrewName) {
    const mapping = {
      'תחנת דלק': 'fuel_station',
      'רשתות מזון': 'supermarket',
      משתלות: 'nursery',
      שונות: 'other',
    };
    return mapping[hebrewName] || 'other';
  },

  /**
   * Get Hebrew category name from key
   */
  getCategoryName(categoryKey) {
    const mapping = {
      priority: 'ספק מוכר',
      fuel_station: 'תחנת דלק',
      supermarket: 'רשתות מזון',
      nursery: 'משתלות',
      other: 'שונות',
    };
    return mapping[categoryKey] || 'שונות';
  },

  /**
   * Calculate average confidence
   */
  calculateAverageConfidence(result) {
    const confidences = [
      result.supplier_confidence || 0,
      result.document_number_confidence || 0,
      result.date_confidence || 0,
      result.total_confidence || 0,
    ];
    return Math.round(confidences.reduce((a, b) => a + b, 0) / confidences.length);
  },
};

// Export for use in other files
if (typeof module !== 'undefined' && module.exports) {
  module.exports = GeminiService;
}
