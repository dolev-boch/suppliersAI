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
    const config = {
      maxOutputTokens: gc.maxOutputTokens || 32768,
      responseMimeType: 'application/json',
      thinkingConfig: {
        thinkingLevel: String(overrides.thinkingLevel || gc.thinkingLevel || 'LOW').toUpperCase(),
      },
    };
    // Enforced structured output (JSON Schema) — the model can't drop/rename fields
    if (overrides.schema && this.jsonSchemaSupported !== false) {
      config.responseJsonSchema = overrides.schema;
    }
    // High resolution for images: the default down-scales the photo, which blurs small
    // Hebrew letters on thermal receipts and makes the model "guess" product names.
    if (overrides.highResImage && this.mediaResolutionSupported !== false) {
      config.mediaResolution = 'MEDIA_RESOLUTION_HIGH';
    }
    return config;
  },

  /**
   * Low-level call to generateContent. Returns { text, usage, finishReason }.
   */
  async callGemini(parts, { timeoutMs = 60000, thinkingLevel, highResImage = false, schema = null, model = null } = {}) {
    // A requested model that turned out unavailable falls back to the default model
    const useModel = model && !(this.unavailableModels || {})[model] ? model : CONFIG.GEMINI_MODEL;
    const apiUrl = `${CONFIG.GEMINI_API_URL}/${useModel}:generateContent?key=${CONFIG.GEMINI_API_KEY}`;
    const requestBody = {
      contents: [{ parts }],
      generationConfig: this.buildGenerationConfig({ thinkingLevel, highResImage, schema }),
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
        // Model not available for this key/region → remember and retry with the default model
        if (useModel !== CONFIG.GEMINI_MODEL && (response.status === 404 || /not found|not supported|unknown model/i.test(errorMsg))) {
          console.warn(`⚠️ Model ${useModel} unavailable (${errorMsg}) — using ${CONFIG.GEMINI_MODEL}`);
          this.unavailableModels = { ...(this.unavailableModels || {}), [useModel]: true };
          clearTimeout(timeoutId);
          return this.callGemini(parts, { timeoutMs, thinkingLevel, highResImage, schema, model: null });
        }
        // If this model rejects mediaResolution, remember that and retry once without it
        if (response.status === 400 && requestBody.generationConfig.mediaResolution && /media.?resolution/i.test(errorMsg)) {
          console.warn('⚠️ mediaResolution not supported by this model — retrying without it');
          this.mediaResolutionSupported = false;
          clearTimeout(timeoutId);
          return this.callGemini(parts, { timeoutMs, thinkingLevel, highResImage: false, schema });
        }
        // Same safety net for the JSON schema (prompt still describes the JSON shape)
        if (response.status === 400 && requestBody.generationConfig.responseJsonSchema && /schema/i.test(errorMsg)) {
          console.warn('⚠️ JSON schema rejected — retrying without it:', errorMsg);
          this.jsonSchemaSupported = false;
          clearTimeout(timeoutId);
          return this.callGemini(parts, { timeoutMs, thinkingLevel, highResImage, schema: null });
        }
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
    const TIMEOUT_MS = 90000; // high-res image + MEDIUM thinking
    const RETRY_DELAYS = [1000, 2500];

    let lastError = null;
    let tableTask = null; // Promise<{crop, part} | null> — enlarged crop of the product table
    let ocrTask = null; // Promise<{lines, part} | null> — OCR of the product table

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

        const imagePart = { inline_data: { mime_type: mimeType || 'image/jpeg', data: base64Image } };

        // 1) Locate the product table and make an enlarged, contrast-enhanced crop of it
        //    (Flash-Lite, minimal thinking — fast and cheap). Done once per scan.
        if (!tableTask) tableTask = this.prepareTableCrop(base64Image, mimeType, imagePart);
        // 2) Two INDEPENDENT readings in parallel — Gemini never sees the OCR text, so
        //    their mistakes are not shared:
        //    A) Gemini (VISION_MODEL) reads the full photo + the enlarged table crop
        //    B) Cloud Vision OCR reads the enlarged table crop
        if (!ocrTask) {
          ocrTask = tableTask.then((table) => {
            const src = table ? table.crop : { base64: base64Image, mime: mimeType };
            return this.runOcr(src.base64, src.mime).then((o) =>
              o ? { lines: o.lines, part: table ? table.part : imagePart } : null
            );
          });
        }
        const table = await tableTask;
        const parts = [{ text: this.buildPrompt() }, imagePart];
        if (table) {
          parts.push(
            {
              text: 'התמונה הבאה היא הגדלה של טבלת המוצרים מאותה חשבונית (שחור-לבן, ניגודיות מוגברת). קרא את שמות המוצרים ואת המספרים בשורות המוצרים מתוך ההגדלה; את שאר הפרטים (ספק, תאריך, מספר מסמך, סיכומים) מהתמונה המלאה.',
            },
            table.part
          );
        }
        const mainCall = this.callGemini(parts, {
          timeoutMs: TIMEOUT_MS,
          highResImage: true,
          thinkingLevel: CONFIG.GENERATION_CONFIG?.extractionThinkingLevel || 'LOW',
          schema: this.extractionSchema(),
          model: CONFIG.VISION_MODEL || null,
        });
        const [main, ocr] = await Promise.all([mainCall, ocrTask]);
        const { text, usage, finishReason } = main;

        console.log('✅ Gemini Response received', { usage, finishReason });

        if (finishReason === 'MAX_TOKENS') {
          throw new Error('Response truncated (MAX_TOKENS)');
        }
        if (onProgress) onProgress({ status: 'processing', message: 'עיבוד תשובה...' });

        const parsed = this.parseJson(text);
        console.log('🔍 AI raw result:', parsed);

        this.applyPrintedArithmetic(parsed);
        parsed.products = this.cleanProducts(parsed.products || []);

        if (onProgress) onProgress({ status: 'processing', message: 'מאמת שמות מוצרים...' });
        if (ocr) {
          // Word-by-word agreement Gemini ↔ OCR; disagreements → tie-break on the crop
          this.compareNamesWithOcr(parsed.products, ocr.lines);
          const disputed = parsed.products.filter((p) => !p.name_verified);
          if (disputed.length > 0) await this.adjudicateNames(disputed, ocr.part);
        } else {
          // No OCR available: zoom + independent Gemini readings + majority vote
          const nameReads = await this.zoomedNameReadings(base64Image, mimeType, imagePart, TIMEOUT_MS);
          await this.resolveProductNames(parsed.products, nameReads.readings, nameReads.part);
        }
        parsed.ocr_used = !!ocr;

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
      // Unicode normalization: presentation forms / full-width signs → standard characters
      .normalize('NFKC')
      // invisible direction marks & zero-width characters (common in OCR of RTL text)
      .replace(/[​-‏‪-‮⁦-⁩﻿­]/g, '')
      .replace(/ /g, ' ')
      .toLowerCase()
      .trim()
      // every apostrophe / quote / geresh / gershayim variant (ק"ג = ק'ג = ק״ג = ק’ג)
      .replace(/["'`´״׳‘’‚‛“”„‟]/g, '')
      .replace(/[.,]/g, '')
      // "%42" (RTL order) ≡ "42%"
      .replace(/%(\d+)/g, '$1%')
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
        name_confidence: this.toNum(raw.name_confidence) ?? this.toNum(raw.confidence) ?? 0,
      };

      // A few agorot of rounding ("הנ: 0.01") is not a discount
      if (p.discount_applied && this.isTrivialDiscount(p)) {
        p.discount_applied = false;
        p.discount_percent = null;
        p.discount_amount = null;
        p.price_before_discount = null;
      }

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
      e.name_confidence = Math.min(e.name_confidence, p.name_confidence);
    }
    return Array.from(map.values());
  },

  /**
   * Recompute every product's net unit price from the numbers COPIED from the invoice,
   * instead of trusting the AI's own arithmetic (which mis-detected VAT and skipped
   * discounts). Mutates `result`.
   *
   *  - VAT basis: Σ printed line totals vs (total − printed VAT) → before VAT,
   *               vs total → includes VAT (scale to before-VAT), no VAT → as printed.
   *  - Net unit price = line total (scaled) ÷ quantity.
   *  - Discount = qty × printed price − line total (beyond rounding). Percent is
   *    recorded only when the printed discount number is confirmed as a percent.
   * If the printed numbers are incomplete or don't reconcile, the AI's values are kept
   * and the readability gate decides.
   */
  applyPrintedArithmetic(result) {
    const lines = (result.products || []).map((p) => ({
      p,
      qty: this.toNum(p.quantity),
      price: this.toNum(p.printed_unit_price),
      disc: this.toNum(p.printed_discount),
      line: this.toNum(p.printed_line_total),
    }));
    const usable = lines.filter((l) => l.qty > 0 && l.line !== null);
    if (usable.length === 0 || usable.length !== lines.filter((l) => l.p.name).length) return;

    const T = Math.abs(this.toNum(result.total_amount) || 0);
    const V = Math.abs(this.toNum(result.vat_amount) || 0);
    const other = this.toNum(result.other_charges_before_vat) || 0;
    const S = usable.reduce((s, l) => s + Math.abs(l.line), 0);
    if (!T || !S) return;

    const near = (a, b) => Math.abs(a - b) <= Math.max(2, b * 0.01);

    // factor converts a printed line total to "before VAT"
    let factor = null;
    let basis = null;
    if (V > 0) {
      const ex = T - V;
      if (near(S + other, ex)) { factor = 1; basis = 'before_vat'; }
      else if (near(S, T)) { factor = ex / T; basis = 'includes_vat'; }
    } else if (near(S + other, T)) {
      factor = 1; basis = 'no_vat';
    }
    if (factor === null) {
      console.warn(`⚠️ Printed line totals (${S.toFixed(2)}) don't reconcile with total ${T} / VAT ${V} — keeping AI values`);
      return;
    }

    result.prices_include_vat = basis === 'includes_vat';
    console.log(`🧮 VAT basis from printed numbers: ${basis} (factor ${factor.toFixed(4)})`);

    usable.forEach(({ p, qty, price, disc, line }) => {
      const sign = line < 0 ? -1 : 1;
      const netLine = Math.abs(line) * factor;
      p.total_before_vat = this.round2(netLine * sign);
      p.unit_price_before_vat = this.round2(netLine / qty);

      if (price === null || price <= 0) return;
      const gross = qty * price;
      const discAmount = gross - Math.abs(line);
      if (discAmount > Math.max(0.5, gross * 0.01)) {
        p.discount_applied = true;
        p.price_before_discount = this.round2(price * factor);
        p.discount_amount = this.round2(discAmount * factor);
        // Percent only when the printed discount number is confirmed to be a percent
        const pctFits = disc > 0 && disc < 100 && Math.abs(gross * (1 - disc / 100) - Math.abs(line)) <= Math.max(0.1, gross * 0.002);
        p.discount_percent = pctFits || (p.printed_discount_is_percent === true && disc > 0) ? disc : null;
      } else {
        // No discount, or only rounding
        p.discount_applied = false;
        p.price_before_discount = null;
        p.discount_amount = null;
        p.discount_percent = null;
      }
    });
  },

  round2(n) {
    return Math.round(n * 100) / 100;
  },

  /**
   * JSON Schema for the main extraction (enforced via responseJsonSchema).
   * Field order = reading order: the model copies printed values before computing.
   */
  extractionSchema() {
    const num = (description) => ({ type: ['number', 'null'], description });
    const str = (description) => ({ type: ['string', 'null'], description });
    const conf = (description) => ({ type: 'integer', minimum: 0, maximum: 100, description });
    return {
      type: 'object',
      properties: {
        is_readable: { type: 'boolean', description: 'false if supplier, total or product lines cannot be read with certainty' },
        unreadable_reason: str('Short Hebrew reason when is_readable is false'),
        supplier_name_raw: { type: 'string', description: 'Issuer name exactly as printed (not the customer after לכבוד)' },
        supplier_category: { type: 'string', enum: ['priority', 'fuel_station', 'supermarket', 'nursery', 'other'] },
        supplier_name: { type: 'string', description: 'Name from the known-suppliers list if it matches, else the printed name without בע"מ' },
        supplier_confidence: conf('Certainty of the supplier name'),
        document_type: { type: 'string', enum: ['invoice', 'delivery_note', 'credit_invoice'] },
        document_number: str('Exactly as printed next to the document title'),
        document_number_confidence: conf('Certainty of the document number'),
        document_date: str('DD/MM/YYYY'),
        date_confidence: conf('Certainty of the date'),
        total_amount: str('Final total to pay incl. VAT, as printed (negative for credit invoice)'),
        total_confidence: conf('Certainty of the total'),
        vat_amount: num('VAT amount exactly as printed'),
        subtotal_before_vat: num('Subtotal before VAT as printed'),
        prices_include_vat: { type: ['boolean', 'null'] },
        invoice_discount_amount: num('Whole-invoice discount in ₪ before VAT'),
        invoice_discount_percent: num('Whole-invoice discount percent if printed'),
        other_charges_before_vat: num('Delivery/deposit/rounding charges before VAT'),
        credit_card_last4: str('4 digits, null for priority suppliers'),
        credit_card_confidence: conf('Certainty of the card digits'),
        notes: str('Extra notes ("חשבונית זיכוי" for credit invoices)'),
        products: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              name: { type: 'string', description: 'Product name copied letter by letter as printed. Never replace an unclear word with a different real word.' },
              name_confidence: conf('Certainty of EVERY letter of the name; below 90 if any letter is unclear'),
              item_code: str('Item code / barcode if printed — never a price'),
              quantity: num('Quantity (kg for weighed goods)'),
              unit: str('ק״ג / יח׳ / ליטר / מארז ...'),
              printed_unit_price: num('Number in the price column, copied as printed'),
              printed_discount: num('Number in the discount column / discount line, as printed'),
              printed_discount_is_percent: { type: ['boolean', 'null'] },
              printed_line_total: num('Number in the line total column, as printed'),
              unit_price_before_vat: num('Net unit price after discount, before VAT'),
              total_before_vat: num('Net line total after discount, before VAT'),
              discount_applied: { type: 'boolean' },
              price_before_discount: num('Unit price before discount, before VAT'),
              discount_percent: num('Discount percent only if printed'),
              discount_amount: num('Line discount in ₪ before VAT'),
              confidence: conf('Certainty of quantity and prices of this line'),
            },
            required: ['name', 'name_confidence', 'quantity', 'printed_unit_price', 'printed_line_total', 'discount_applied', 'confidence'],
          },
        },
      },
      required: [
        'is_readable', 'supplier_name_raw', 'supplier_category', 'supplier_name', 'supplier_confidence',
        'document_type', 'document_number', 'document_date', 'total_amount', 'total_confidence', 'products',
      ],
    };
  },

  namesSchema() {
    return {
      type: 'object',
      properties: {
        products: {
          type: 'array',
          items: {
            type: 'object',
            properties: { name: { type: 'string', description: 'Product name copied letter by letter as printed' } },
            required: ['name'],
          },
        },
      },
      required: ['products'],
    };
  },

  /**
   * Prompt for the independent second reading — product names only.
   */
  buildNamesPrompt() {
    return `קרא מתוך החשבונית/תעודת המשלוח בתמונה **רק את שמות המוצרים** בטבלת המוצרים.
- העתק כל שם **אות אחר אות בדיוק כפי שמודפס**, כולל מספרים, אחוזים וקיצורים (ק"ג, 1 ק, 5 ל').
- **אסור** להחליף מילה לא ברורה במילה הגיונית אחרת. אם אות לא ברורה — כתוב את הקריאה הכי סבירה של האותיות עצמן.
- אל תכלול קוד פריט/ברקוד, כמויות, מחירים, שורות הנחה, סיכומים.
החזר JSON בלבד: {"products":[{"name":"..."}]}`;
  },

  /** Normalized form for comparing two readings of the same name */
  nameKey(name) {
    return this.normalizeProductName(name)
      .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
      .replace(/\s+/g, '');
  },

  // ==========================================================================
  // OCR-GROUNDED EXTRACTION (primary path)
  // A dedicated OCR engine recognizes characters; Gemini only structures the text;
  // code verifies every word of every product name against the OCR output.
  // ==========================================================================

  /**
   * Run Cloud Vision OCR through our server endpoint (/api/ocr).
   * Returns { text, lines, confidence } or null if OCR is unavailable (→ fallback path).
   */
  async runOcr(base64Image, mimeType) {
    if (!(mimeType || '').startsWith('image/')) return null; // PDFs: fallback path
    try {
      let image = base64Image;
      // Stay well under the serverless request-size limit
      if (image.length > 3000000 && typeof document !== 'undefined') {
        const smaller = await this.resizeImage(base64Image, mimeType, 2560, 0.85);
        if (smaller) image = smaller.base64;
      }
      const resp = await fetch(CONFIG.OCR_ENDPOINT || '/api/ocr', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image_base64: image }),
      });
      const data = await resp.json().catch(() => ({}));
      if (!resp.ok) {
        console.warn('⚠️ OCR unavailable — using fallback reading:', data.error || resp.status);
        return null;
      }
      if (!data.lines || data.lines.length === 0) return null;
      console.log(`🔤 OCR: ${data.lines.length} lines (confidence ${data.confidence?.toFixed?.(2) ?? '—'})`);
      return data;
    } catch (err) {
      console.warn('⚠️ OCR failed — using fallback reading:', err.message);
      return null;
    }
  },

  resizeImage(base64Image, mimeType, maxSide, quality) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const r = Math.min(maxSide / img.naturalWidth, maxSide / img.naturalHeight, 1);
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(img.naturalWidth * r);
          canvas.height = Math.round(img.naturalHeight * r);
          canvas.getContext('2d').drawImage(img, 0, 0, canvas.width, canvas.height);
          resolve({ base64: canvas.toDataURL('image/jpeg', quality).split(',')[1], mime: 'image/jpeg' });
        } catch (_) {
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = `data:${mimeType || 'image/jpeg'};base64,${base64Image}`;
    });
  },

  /**
   * Locate the product table (Flash-Lite, minimal thinking), crop it with a margin,
   * enlarge it and enhance contrast. The crop gives both readers (Gemini and the OCR
   * engine) many more pixels per letter than the whole photo, where the receipt may
   * fill only part of the frame.
   * Returns { crop: {base64, mime}, part } or null (→ readers use the full photo).
   */
  async prepareTableCrop(base64Image, mimeType, imagePart) {
    if (!(mimeType || '').startsWith('image/') || typeof document === 'undefined') return null;
    try {
      const box = await this.detectProductTable(imagePart);
      if (!box) return null;
      const crop = await this.cropToRows(base64Image, mimeType, box, { enhance: true });
      if (!crop) return null;
      console.log('🔎 Product table cropped and enlarged for reading');
      return { crop, part: { inline_data: { mime_type: crop.mime, data: crop.base64 } } };
    } catch (err) {
      console.warn('⚠️ Table crop skipped:', err.message);
      return null;
    }
  },

  /**
   * Compare each product name (Gemini) with the OCR of the table, word by word.
   *  - Every word read identically by both (after normalizing quotes/gershayim/final
   *    letters) → name_verified = true, name unchanged.
   *  - Otherwise → name_verified = false and name_candidates = [Gemini's reading,
   *    the OCR's reading]; the tie-break decides from the image (or nobody wins).
   * Neither source overwrites the other on its own.
   */
  compareNamesWithOcr(products, ocrLines) {
    const key = (w) =>
      this.normalizeProductName(w)
        .replace(/ך/g, 'כ').replace(/ם/g, 'מ').replace(/ן/g, 'נ').replace(/ף/g, 'פ').replace(/ץ/g, 'צ')
        .replace(/\s+/g, '');
    const sim = (a, b) => (a === b ? 1 : SupplierMatcher.calculateSimilarity(a, b));
    // Split on any whitespace incl. non-breaking spaces; drop invisible direction marks
    const clean = (l) => String(l).normalize('NFKC').replace(/[​-‏‪-‮⁦-⁩﻿­]/g, '');
    const lines = (ocrLines || []).map((l) =>
      clean(l).split(/[\s ]+/).filter(Boolean).map((raw) => ({ raw, k: key(raw) })).filter((t) => t.k)
    );

    // Best OCR token for a name word, within a token list
    const bestIn = (k, tokens) => {
      let best = null;
      let s = 0;
      tokens.forEach((t) => {
        // 1–2 letter words must match exactly (no fuzzy pairing of tiny words)
        const v = k.length <= 2 || t.k.length <= 2 ? (k === t.k ? 1 : 0) : sim(k, t.k);
        if (v > s) { s = v; best = t; }
      });
      return { token: best, sim: s };
    };
    const isWord = (t) => t && /[א-תa-z]/i.test(t.raw) && !/^\d/.test(t.raw);

    products.forEach((p) => {
      const words = String(p.name || '').split(/\s+/).filter(Boolean);
      const keys = words.map(key);

      // OCR line that contains most of the name
      let bestLine = null;
      let bestScore = 0;
      lines.forEach((line) => {
        const score = keys.reduce((acc, k) => {
          if (!k) return acc + 1;
          const m = bestIn(k, line);
          return acc + (m.sim >= 0.5 ? m.sim : 0);
        }, 0) / Math.max(1, keys.length);
        if (score > bestScore) { bestScore = score; bestLine = line; }
      });

      if (!bestLine || bestScore < 0.5) {
        p.name_verified = false;
        p.name_candidates = [p.name];
        p.name_second_reading = null;
        // No OCR counterpart: every word must be confirmed by the tie-break
        p.name_slots = words.map((w) => ({ g: w, o: null, agree: false }));
        console.warn(`⚠️ Name not found in OCR: "${p.name}"`);
        return;
      }

      // Pass 1: pair each word with its OCR word by spelling similarity
      const paired = keys.map((k) => {
        if (!k) return { skip: true };
        const m = bestIn(k, bestLine);
        return m.sim >= 0.5 ? { token: m.token, idx: bestLine.indexOf(m.token) } : null;
      });
      // Pass 2: alignment — an unpaired word next to a paired one takes the OCR word at
      // the same position (only real words, never numbers/codes)
      const used = new Set(paired.filter((m) => m && m.token).map((m) => m.token));
      paired.forEach((m, i) => {
        if (m !== null) return;
        const prev = paired[i - 1];
        const next = paired[i + 1];
        let idx = -1;
        if (next && next.idx > 0) idx = next.idx - 1;
        else if (prev && prev.idx >= 0) idx = prev.idx + 1;
        const t = bestLine[idx];
        if (isWord(t) && !used.has(t)) {
          paired[i] = { token: t, idx };
          used.add(t);
        }
      });

      // Word slots: Gemini's word, the OCR's word, and whether they agree
      p.name_slots = words.map((w, i) => {
        const m = paired[i];
        if (m && m.skip) return { g: w, o: w, agree: true };
        const o = m && m.token ? m.token.raw : null;
        return { g: w, o, agree: !!(m && m.token && m.token.k === keys[i]) };
      });
      const agree = p.name_slots.every((s) => s.agree);
      const ocrName = p.name_slots.map((s) => s.o || s.g).join(' ');

      p.name_ocr = ocrName;
      if (agree) {
        p.name_verified = true;
        p.name_candidates = [p.name];
        p.name_second_reading = null;
      } else {
        p.name_verified = false;
        p.name_candidates = ocrName !== p.name ? [p.name, ocrName] : [p.name];
        p.name_second_reading = ocrName !== p.name ? ocrName : null;
        console.log(`🔍 Gemini vs OCR disagree: "${p.name}" ≠ "${ocrName}"`);
      }
    });
  },

  // ==========================================================================
  // FALLBACK (no OCR): zoom → 3 independent readings → majority vote →
  // image-grounded tie-break between the readings (never a new, invented name)
  // ==========================================================================

  /**
   * Locate the product table, crop it out of the photo (full width, the table's rows
   * plus a margin) and read the names twice on the crop. The crop gives the model
   * far more pixels per letter than the whole photo, where the receipt may be small.
   * Returns { readings: string[][], part } — part is the image used (crop or original).
   * Never throws.
   */
  async zoomedNameReadings(base64Image, mimeType, imagePart, timeoutMs) {
    let part = imagePart;
    try {
      if ((mimeType || '').startsWith('image/') && typeof document !== 'undefined') {
        const box = await this.detectProductTable(imagePart);
        if (box) {
          const crop = await this.cropToRows(base64Image, mimeType, box);
          if (crop) part = { inline_data: { mime_type: crop.mime, data: crop.base64 } };
        }
      }
    } catch (err) {
      console.warn('⚠️ Table zoom skipped:', err.message);
    }

    const read = () =>
      this.callGemini([{ text: this.buildNamesPrompt() }, part], {
        timeoutMs,
        highResImage: true,
        thinkingLevel: 'LOW',
        schema: this.namesSchema(),
      })
        .then((r) => (this.parseJson(r.text).products || []).map((p) => p && p.name).filter(Boolean))
        .catch((err) => {
          console.warn('⚠️ Name reading failed:', err.message);
          return null;
        });

    const readings = (await Promise.all([read(), read()])).filter(Array.isArray);
    return { readings, part };
  },

  /**
   * Bounding box of the product rows: [ymin, xmin, ymax, xmax] normalized 0-1000
   * (Gemini's native box_2d convention). Returns null if not found.
   */
  async detectProductTable(imagePart) {
    const { text } = await this.callGemini(
      [
        {
          text:
            'Detect the table of product lines on this invoice/receipt (the rows with product names, quantities and prices — without the header block and without the totals at the bottom). ' +
            'Return its box_2d as [ymin, xmin, ymax, xmax] normalized to 0-1000.',
        },
        imagePart,
      ],
      {
        timeoutMs: 30000,
        thinkingLevel: 'MINIMAL', // simple localization task — keep it fast and cheap
        schema: {
          type: 'object',
          properties: {
            found: { type: 'boolean' },
            box_2d: { type: 'array', items: { type: 'integer', minimum: 0, maximum: 1000 }, minItems: 4, maxItems: 4 },
          },
          required: ['found', 'box_2d'],
        },
      }
    );
    const r = this.parseJson(text);
    const b = r && r.found && Array.isArray(r.box_2d) ? r.box_2d.map(Number) : null;
    if (!b || b.length !== 4 || b[2] - b[0] < 20) return null;
    return b;
  },

  /**
   * Crop the table box (with a generous margin, so a slightly wrong box still contains
   * the whole rows) and scale it up so the long side is ~2400px.
   * enhance: grayscale + contrast stretch — standard OCR pre-processing that makes faded
   * thermal print and shadows much more legible.
   */
  cropToRows(base64Image, mimeType, box, { enhance = false } = {}) {
    return new Promise((resolve) => {
      const img = new Image();
      img.onload = () => {
        try {
          const W = img.naturalWidth;
          const H = img.naturalHeight;
          const [ymin, xmin, ymax, xmax] = box;
          const yMargin = (ymax - ymin) * 0.08 + 15;
          const xMargin = (xmax - xmin) * 0.06 + 20;
          const y0 = Math.max(0, Math.floor(((ymin - yMargin) / 1000) * H));
          const y1 = Math.min(H, Math.ceil(((ymax + yMargin) / 1000) * H));
          const x0 = Math.max(0, Math.floor(((xmin - xMargin) / 1000) * W));
          const x1 = Math.min(W, Math.ceil(((xmax + xMargin) / 1000) * W));
          const cropW = x1 - x0;
          const cropH = y1 - y0;
          if (cropH < 40 || cropW < 80) return resolve(null);
          const scale = Math.min(3, 2400 / Math.max(cropW, cropH));
          const canvas = document.createElement('canvas');
          canvas.width = Math.round(cropW * scale);
          canvas.height = Math.round(cropH * scale);
          const ctx = canvas.getContext('2d');
          ctx.imageSmoothingQuality = 'high';
          ctx.drawImage(img, x0, y0, cropW, cropH, 0, 0, canvas.width, canvas.height);
          if (enhance) this.enhanceForOcr(ctx, canvas.width, canvas.height);
          resolve({ base64: canvas.toDataURL('image/jpeg', 0.92).split(',')[1], mime: 'image/jpeg' });
        } catch (err) {
          console.warn('Crop failed:', err);
          resolve(null);
        }
      };
      img.onerror = () => resolve(null);
      img.src = `data:${mimeType || 'image/jpeg'};base64,${base64Image}`;
    });
  },

  /**
   * Grayscale + contrast stretch (1st–99th percentile → 0–255). One pass over the crop
   * only (not the full photo), so it stays fast on phones.
   */
  enhanceForOcr(ctx, w, h) {
    const imgData = ctx.getImageData(0, 0, w, h);
    const d = imgData.data;
    const hist = new Uint32Array(256);
    for (let i = 0; i < d.length; i += 4) {
      const g = (d[i] * 299 + d[i + 1] * 587 + d[i + 2] * 114) / 1000;
      d[i] = g;
      hist[g | 0]++;
    }
    const total = d.length / 4;
    let lo = 0;
    let hi = 255;
    for (let acc = 0; lo < 255 && (acc += hist[lo]) < total * 0.01; lo++);
    for (let acc = 0; hi > 0 && (acc += hist[hi]) < total * 0.01; hi--);
    const range = Math.max(1, hi - lo);
    for (let i = 0; i < d.length; i += 4) {
      const v = Math.max(0, Math.min(255, ((d[i] - lo) * 255) / range));
      d[i] = d[i + 1] = d[i + 2] = v;
    }
    ctx.putImageData(imgData, 0, 0);
  },

  /**
   * Decide each product's name from 3 independent readings (main + 2 zoomed):
   *  - readings that are identical after normalization (quotes/gershayim, final
   *    letters, spaces) vote together; a name with ≥ 2 votes is verified.
   *  - no majority → one image-grounded call must choose which of the candidates
   *    matches the print (or none). It can only pick an actually-read candidate.
   *  - still undecided → name_verified = false (→ catalog match or rescan).
   * If the zoomed readings are unavailable, falls back to the model's own certainty.
   */
  async resolveProductNames(products, readings, imagePart) {
    const MIN = CONFIG.READABILITY?.MIN_NAME_CERTAINTY ?? 90;
    const same = (a, b) => a === b || SupplierMatcher.calculateSimilarity(a, b) >= 0.95;

    if (!readings || readings.length === 0) {
      products.forEach((p) => {
        p.name_candidates = [p.name];
        p.name_verified = (this.toNum(p.name_confidence) ?? 0) >= MIN;
      });
      return;
    }

    const pending = [];
    products.forEach((p) => {
      const candidates = [p.name];
      readings.forEach((list) => {
        // The reading's line that corresponds to this product = most similar name
        const k = this.nameKey(p.name);
        let best = null;
        let bestSim = 0;
        list.forEach((n) => {
          const s = SupplierMatcher.calculateSimilarity(k, this.nameKey(n));
          if (s > bestSim) { bestSim = s; best = n; }
        });
        if (best && bestSim >= 0.5) candidates.push(best);
      });

      // Group identical readings
      const groups = [];
      candidates.forEach((c) => {
        const key = this.nameKey(c);
        const g = groups.find((x) => same(x.key, key));
        if (g) g.members.push(c);
        else groups.push({ key, members: [c] });
      });
      groups.sort((a, b) => b.members.length - a.members.length);

      p.name_candidates = groups.map((g) => g.members[0]);
      p.name_votes = groups.map((g) => g.members.length);

      if (groups[0].members.length >= 2) {
        // Keep the main reading's spelling if it is in the winning group
        const winner = groups[0].members.includes(p.name) ? p.name : groups[0].members[0];
        if (winner !== p.name) console.log(`🗳️ Name by majority: "${p.name}" → "${winner}"`);
        p.name = winner;
        p.name_verified = true;
      } else {
        p.name_verified = false;
        pending.push(p);
      }
    });

    if (pending.length > 0) await this.adjudicateNames(pending, imagePart);

    products.forEach((p) => {
      p.name_second_reading = (p.name_candidates || []).find((c) => c !== p.name) || null;
      if (!p.name_verified) console.warn(`⚠️ Uncertain name: ${JSON.stringify(p.name_candidates)}`);
    });
  },

  /**
   * Tie-break: show the (zoomed) image and the candidate readings; the model must pick
   * the candidate that matches the printed text exactly, judged by the letters in the
   * image — or null. Constrained to the candidates, so nothing new can be invented.
   */
  async adjudicateNames(pending, imagePart) {
    // OCR path: decide word by word (each disputed word between its two readings)
    if (pending.every((p) => Array.isArray(p.name_slots))) {
      return this.adjudicateWords(pending, imagePart);
    }
    const MIN = CONFIG.READABILITY?.MIN_NAME_CERTAINTY ?? 90;
    try {
      const lines = pending
        .map((p, i) => `${i}: ${p.name_candidates.map((c, j) => `[${j}] ${c}`).join('   ')}`)
        .join('\n');
      const { text } = await this.callGemini(
        [
          {
            text: `לכל שורה למטה יש כמה קריאות של אותו שם מוצר מהתמונה. הסתכל בתמונה על השם המודפס ובחר את הקריאה שתואמת **בדיוק, אות אחר אות**, למה שמודפס.
בחר לפי האותיות שבתמונה בלבד (שים לב לאותיות דומות בצורתן), לא לפי איזו מילה נשמעת הגיונית.
אם אף קריאה לא תואמת בדיוק — choice: null.

${lines}`,
          },
          imagePart,
        ],
        {
          timeoutMs: 45000,
          highResImage: true,
          thinkingLevel: 'LOW',
          model: CONFIG.VISION_MODEL || null,
          schema: {
            type: 'object',
            properties: {
              picks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    line: { type: 'integer' },
                    choice: { type: ['integer', 'null'] },
                    confidence: { type: 'integer', minimum: 0, maximum: 100 },
                  },
                  required: ['line', 'choice', 'confidence'],
                },
              },
            },
            required: ['picks'],
          },
        }
      );
      (this.parseJson(text).picks || []).forEach((pick) => {
        const p = pending[pick.line];
        if (!p || !Number.isInteger(pick.choice)) return;
        const chosen = p.name_candidates[pick.choice];
        if (chosen && pick.confidence >= MIN) {
          console.log(`⚖️ Name decided from image: ${JSON.stringify(p.name_candidates)} → "${chosen}" (${pick.confidence}%)`);
          p.name = chosen;
          p.name_verified = true;
        }
      });
    } catch (err) {
      console.warn('⚠️ Name tie-break failed:', err.message);
    }
  },

  /**
   * Word-level tie-break. For every word on which Gemini and the OCR disagree, the
   * model looks at the (enlarged) image and picks which of the two readings of THAT
   * word is printed — or null. The final name can combine the right word from each
   * source (one word from Gemini, another from the OCR), yet consists only of words that
   * were actually read. Every disputed word needs ≥ MIN_NAME_CERTAINTY.
   */
  async adjudicateWords(pending, imagePart) {
    const MIN = CONFIG.READABILITY?.MIN_NAME_CERTAINTY ?? 90;
    const options = (s) => (s.o && s.o !== s.g ? [s.g, s.o] : [s.g]);

    const blocks = pending.map((p, i) => {
      const full = p.name_slots.map((s) => s.g).join(' ');
      const disputed = p.name_slots
        .map((s, j) => (s.agree ? null : `  מילה ${j}: ${options(s).map((o, k) => `[${k}] ${o}`).join('   ')}`))
        .filter(Boolean)
        .join('\n');
      return `שורה ${i}: "${full}"\n${disputed}`;
    });

    try {
      const { text } = await this.callGemini(
        [
          {
            text: `בתמונה טבלת מוצרים מחשבונית. לכל שורה למטה יש מילים שנקראו בשתי דרכים שונות.
לכל מילה כזו: מצא אותה בשם המוצר המודפס בתמונה ובחר את הקריאה שתואמת **בדיוק, אות אחר אות**, למה שמודפס.
החלט לפי האותיות שבתמונה (שים לב לאותיות דומות בצורתן כמו ד/ר, ב/כ, ה/ח, ו/ז, ס/ם), לא לפי איזו מילה נשמעת הגיונית.
אם אף אפשרות לא תואמת בדיוק — choice: null.

${blocks.join('\n\n')}`,
          },
          imagePart,
        ],
        {
          timeoutMs: 45000,
          highResImage: true,
          thinkingLevel: 'LOW',
          model: CONFIG.VISION_MODEL || null,
          schema: {
            type: 'object',
            properties: {
              picks: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    line: { type: 'integer' },
                    word: { type: 'integer' },
                    choice: { type: ['integer', 'null'] },
                    confidence: { type: 'integer', minimum: 0, maximum: 100 },
                  },
                  required: ['line', 'word', 'choice', 'confidence'],
                },
              },
            },
            required: ['picks'],
          },
        }
      );

      const picks = this.parseJson(text).picks || [];
      pending.forEach((p, i) => {
        let complete = true;
        const words = p.name_slots.map((s, j) => {
          if (s.agree) return s.g;
          const pick = picks.find((x) => x.line === i && x.word === j);
          const opts = options(s);
          if (!pick || !Number.isInteger(pick.choice) || !opts[pick.choice] || pick.confidence < MIN) {
            complete = false;
            return s.g;
          }
          return opts[pick.choice];
        });
        const decided = words.join(' ');
        if (complete) {
          console.log(`⚖️ Name decided word-by-word from image: "${p.name}" / "${p.name_ocr || '—'}" → "${decided}"`);
          p.name = decided;
          p.name_verified = true;
        } else {
          p.name_candidates = [...new Set([p.name, decided, p.name_ocr].filter(Boolean))];
        }
      });
    } catch (err) {
      console.warn('⚠️ Word tie-break failed:', err.message);
    }
  },

  /**
   * Products whose name is not certain and that did not match an existing catalog
   * product. Non-empty → ask the user to photograph again.
   */
  unverifiedProductNames(result) {
    if (result.productsDisabled) return [];
    return (result.products || []).filter((p) => !p.name_verified && !p.catalog_name);
  },

  /**
   * Rounding adjustment rather than a real discount: under ₪0.50 and under 1%
   * (or a printed percent under 1%).
   */
  isTrivialDiscount(p) {
    const pct = p.discount_percent;
    if (pct !== null && pct !== undefined && pct >= 1) return false;
    let amount = p.discount_amount;
    if ((amount === null || amount === undefined) && p.price_before_discount && p.unit_price_before_vat && p.quantity) {
      amount = (p.price_before_discount - p.unit_price_before_vat) * p.quantity;
    }
    const lineTotal = p.total_before_vat || (p.unit_price_before_vat || 0) * (p.quantity || 1);
    if (amount === null || amount === undefined) return pct !== null && pct !== undefined && pct < 1;
    return Math.abs(amount) < 0.5 && (!lineTotal || Math.abs(amount) / lineTotal < 0.01);
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
- name: שם המוצר **אות אחר אות בדיוק** כפי שמודפס, כולל משקל/נפח/אחוז/גודל, קיצורים וגרשיים. אל תקצר, אל תשלים ואל "תתקן".
  **אסור להמציא:** אם מילה או אות לא ברורה — אל תחליף אותה במילה אחרת שנשמעת הגיונית, ואל תנחש שם מוצר מוכר. כתוב רק את האותיות שאתה רואה בפועל והורד את name_confidence.
  שים לב במיוחד לקיצורים עם גרשיים (כמו יחידות מידה) ולאותיות עבריות דומות בצורתן — אלה המקומות שבהם קריאה שגויה נפוצה.
- name_confidence: 0-100 — כמה אתה בטוח ב**כל אות** של השם. מתחת ל-90 אם יש ולו אות אחת שלא ראית בבירור.
- item_code: קוד פריט / מק"ט / ברקוד אם מודפס (null אם לא). **קוד פריט הוא לעולם לא מחיר.**
- **שדות "כפי שמודפס" — העתקה בלבד, בלי שום חישוב, בלי מע"מ, בלי הנחה:**
  - printed_unit_price: המספר בעמודת "מחיר" של השורה
  - printed_discount: המספר בעמודת "הנחה" של השורה (או בשורת "הנחה" שמתחתיה), null אם ריק/0
  - printed_discount_is_percent: true אם ההנחה מודפסת עם % או שהעמודה היא "% הנחה"; false אם בש"ח; null אם לא ברור
  - printed_line_total: המספר בעמודת "סכום"/"סה"כ" של השורה (הסכום הסופי של השורה כפי שמודפס)
- quantity, unit (ק״ג, ליטר, יח׳, מארז, גרם, מ״ל...)

### מוצרים שקולים (ירקות, פירות, גבינות במשקל, בשר וכו')
- שורה בפורמט "משקל x מחיר" (למשל "W x P" או "W × P") = **משקל בק"ג × מחיר לק"ג**: quantity=W, unit="ק״ג", printed_unit_price=P.
- קוד פריט/ברקוד עשוי להיות מודפס בנפרד מעל או ליד המחיר — אל תבלבל ביניהם.
- **בדיקה חובה:** quantity × unit_price ≈ סה"כ השורה. אם לא — קראת לא נכון; קרא שוב.
- **נרמל תמיד מחיר של מוצר שקול לק"ג:** מחיר ל-100 גרם → כפול 10; מחיר לגרם → כפול 1000; משקל בגרם → חלק ב-1000 (quantity בק"ג). unit="ק״ג".
- ירקות ופירות טריים בישראל פטורים ממע"מ (מע"מ 0%) — אל תחלק אותם ב-1.18 גם אם הכותרת אומרת "כולל מע"מ".

### עיגול אגורות אינו הנחה
"הנ: 0.01", "הנ: -0.05" או כל הפרש של אגורות בודדות (פחות מ-0.50 ₪ ופחות מ-1% מהשורה) = **עיגול**, לא הנחה → discount_applied: false, discount_percent: null.
- unit_price_before_vat: מחיר ליחידה **נטו אחרי הנחה ולפני מע"מ**
- total_before_vat: סה"כ השורה **אחרי הנחה ולפני מע"מ**
- discount_applied: true אם יש הנחה על המוצר (שורת "הנחה"/"ה.בש" מתחת לו, עמודת "% הנחה", או הנחה כללית)
- price_before_discount: מחיר יחידה לפני ההנחה (לפני מע"מ), null אם אין הנחה
- discount_percent: אחוז ההנחה **רק אם מודפס במסמך** (בעמודה או בשורת ההנחה). אם לא מודפס אחוז → null. אל תחשב אחוז בעצמך.
- discount_amount: סכום ההנחה לשורה בש"ח לפני מע"מ, null אם אין
- confidence: 0-100 — כמה בטוח אתה בשם, בכמות ובמחיר של השורה

### כלל מע"מ
השווה את **סכום עמודת "סכום" של השורות (אחרי הנחות!)** — לא כמות×מחיר:
- ≈ הסכום לפני מע"מ / "סה"כ אחרי הנחה" (= סה"כ לתשלום פחות סכום המע"מ) → המחירים **לפני מע"מ** → אל תחלק (prices_include_vat: false). זה המצב ברוב חשבוניות הספקים.
- ≈ הסכום הכולל לתשלום כולל מע"מ → המחירים כוללים מע"מ → חלק ב-1.18 (prices_include_vat: true). נפוץ בקבלות סופר.
- אין מע"מ במסמך → כמו שכתוב.
- vat_amount: העתק את סכום המע"מ **בדיוק כפי שמודפס** (לא לחשב).

### כלל הנחה לשורה (הכי חשוב)
- הנחה יכולה להופיע כעמודה בשורת המוצר או כשורה נפרדת מתחתיו ("הנחה -X"). שורת הנחה שייכת למוצר שמעליה.
- סה"כ נטו לשורה = סה"כ מקורי − ההנחה ; מחיר יחידה נטו = סה"כ נטו ÷ כמות.
- אם יש עמודת "מחיר נטו" — זה המחיר אחרי הנחה.
- הערה: המערכת מחשבת בעצמה מחדש את המחירים מתוך השדות printed_* — הקפד בעיקר שהם מועתקים נכון.

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
      "name_confidence": 95,
      "item_code": null,
      "printed_unit_price": 5.80,
      "printed_discount": null,
      "printed_discount_is_percent": null,
      "printed_line_total": 58.00,
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
      const vat = Math.abs(this.toNum(result.vat_amount) || 0);

      // Prefer printed numbers (total − printed VAT) over the AI's own subtotal, so a
      // consistent AI mistake (e.g. dividing by 1.18 twice) can't pass this check.
      let candidates;
      if (vat > 0) {
        candidates = [absTotal - vat];
      } else {
        const subtotal = this.toNum(result.subtotal_before_vat);
        const invDisc = this.toNum(result.invoice_discount_amount) || 0;
        candidates = [absTotal, absTotal / 1.18];
        if (subtotal) candidates.push(Math.abs(subtotal), Math.abs(subtotal) - invDisc);
      }

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
      const items = (catalog.products || []).filter((p) => p && p.name);
      const names = items.map((p) => p.name);
      if (names.length === 0) return result;

      const fmt = (v) => (v > 0 ? `₪${Number(v).toFixed(2)}` : '—');
      const listPrice = (p) => (p.discount_applied && p.price_before_discount > 0 ? p.price_before_discount : p.unit_price_before_vat);

      const prompt = `התאם בין שורות מחשבונית של הספק "${catalog.sheet_name || result.supplier_name}" לבין קטלוג המוצרים הקיים של אותו ספק.
שמות בחשבונית נקראו מצילום ועלולים להכיל שגיאות קריאה (אות מוחלפת, מילה משובשת). גם שמות בקטלוג עלולים להיות שגיאות קריאה ישנות.
התאם כשזה **אותו מוצר** — קיצור, שגיאת כתיב/קריאה, סדר מילים שונה, תוספת/השמטת מילה.
ראיות חזקות לאותו מוצר: אותו מחיר (או קרוב), אותה יחידה, שם דומה באותיות.
**אל תתאים** כשיש הבדל מהותי: גודל/משקל/נפח שונה, אחוז שומן שונה, טעם/סוג/צבע שונה.
אם אין התאמה סבירה → null.

קטלוג (אינדקס: שם | מחיר | יחידה):
${items.map((p, i) => `${i}: ${p.name} | ${fmt(p.price)} | ${p.unit || '—'}`).join('\n')}

שורות מהחשבונית (אינדקס: שם | קריאה שנייה | מחיר | יחידה):
${products.map((p, i) => `${i}: ${p.name} | ${p.name_second_reading || '—'} | ${fmt(listPrice(p))} | ${p.unit || '—'}`).join('\n')}`;

      const { text } = await this.callGemini([{ text: prompt }], {
        timeoutMs: 30000,
        thinkingLevel: 'LOW',
        schema: {
          type: 'object',
          properties: {
            matches: {
              type: 'array',
              items: {
                type: 'object',
                properties: {
                  invoice: { type: 'integer', description: 'Invoice line index' },
                  catalog: { type: ['integer', 'null'], description: 'Catalog index of the same product, or null' },
                },
                required: ['invoice', 'catalog'],
              },
            },
          },
          required: ['matches'],
        },
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
