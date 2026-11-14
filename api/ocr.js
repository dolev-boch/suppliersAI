// OCR endpoint: Google Cloud Vision DOCUMENT_TEXT_DETECTION.
// A dedicated OCR engine recognizes the printed characters exactly; the LLM then only
// structures that text. This is what keeps product names from being "invented".
//
// Key: GOOGLE_VISION_API_KEY env var (falls back to GEMINI_API_KEY if that key's
// Google Cloud project has the Cloud Vision API enabled). The key never reaches the browser.

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' });

  const key = process.env.GOOGLE_VISION_API_KEY || process.env.GEMINI_API_KEY;
  if (!key) return res.status(500).json({ error: 'OCR API key not configured' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const image = body.image_base64;
  if (!image) return res.status(400).json({ error: 'image_base64 is required' });

  try {
    const r = await fetch(`https://vision.googleapis.com/v1/images:annotate?key=${key}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [
          {
            image: { content: image },
            features: [{ type: 'DOCUMENT_TEXT_DETECTION' }],
            imageContext: { languageHints: ['he', 'en'] },
          },
        ],
      }),
    });
    const data = await r.json();
    const err = data.error || (data.responses && data.responses[0] && data.responses[0].error);
    if (!r.ok || err) {
      return res.status(502).json({ error: (err && err.message) || `Vision HTTP ${r.status}` });
    }

    const ann = data.responses[0].fullTextAnnotation;
    if (!ann || !ann.text) return res.status(200).json({ text: '', lines: [], confidence: null });

    // Mean symbol confidence (a rough image-quality signal)
    let sum = 0;
    let n = 0;
    (ann.pages || []).forEach((page) =>
      (page.blocks || []).forEach((block) =>
        (block.paragraphs || []).forEach((para) =>
          (para.words || []).forEach((word) =>
            (word.symbols || []).forEach((s) => {
              if (typeof s.confidence === 'number') {
                sum += s.confidence;
                n++;
              }
            })
          )
        )
      )
    );

    const lines = ann.text.split('\n').map((l) => l.trim()).filter(Boolean);
    return res.status(200).json({ text: ann.text, lines, confidence: n ? sum / n : null });
  } catch (e) {
    return res.status(502).json({ error: e.message });
  }
}
