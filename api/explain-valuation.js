/**
 * Vercel Serverless Function: POST /api/explain-valuation
 * Turns DCF numbers, Quality Grade, and 6-factor Beta into a plain-Indonesian
 * 4-point coaching summary for beginner value investors via Gemini 3.1 Flash-Lite.
 */

const MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    summary: { type: 'STRING' },
    strengths: { type: 'STRING' },
    risks: { type: 'STRING' },
    nextSteps: { type: 'STRING' },
  },
  required: ['summary', 'strengths', 'risks', 'nextSteps'],
};

const SYSTEM_PROMPT = `Kamu adalah mentor value investing Indonesia yang menjelaskan hasil valuasi DCF kepada investor pemula dengan bahasa Indonesia yang santai, jelas, objektif, dan bebas jargon rumit.
Berikan 4 bagian singkat (masing-masing maksimal 2 kalimat padat):
1. "summary": Kesimpulan cepat apakah saham ini menarik (bisnis sehat + harga diskon) atau perlu hati-hati (mahal / berisiko value trap).
2. "strengths": Kekuatan utama bisnis berdasarkan data & rasio yang dikirim.
3. "risks": Risiko terbesar yang wajib diwaspadai dari faktor Beta atau fluktuasi laba.
4. "nextSteps": Langkah praktis sebelum memutuskan beli (misal tunggu MoS tertentu, cek laporan keuangan terbaru, atau cek prospek industri).
Jangan memberi ajakan membeli secara mutlak ("pasti cuan"), selalu jaga nada edukatif.`;

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') return res.status(405).json({ error: 'Gunakan POST' });

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  if (!body.ticker) return res.status(400).json({ error: 'Data emiten tidak lengkap' });

  const headerKey = req.headers['x-gemini-key'] ? String(req.headers['x-gemini-key']).trim() : '';
  const apiKey = process.env.GEMINI_API_KEY || headerKey;

  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      fallback: true,
      reason: 'GEMINI_API_KEY belum terpasang; menggunakan ringkasan otomatis lokal.',
    });
  }

  const prompt = `Tolong jelaskan hasil valuasi saham berikut untuk investor pemula:
${JSON.stringify(body, null, 2)}`;

  for (const model of MODELS) {
    try {
      const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
          contents: [{ role: 'user', parts: [{ text: prompt }] }],
          generationConfig: {
            temperature: 0.3,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      });
      if (!resp.ok) {
        if (resp.status === 404 || resp.status === 400) continue;
        throw new Error(`HTTP ${resp.status}`);
      }
      const data = await resp.json();
      const txt = data?.candidates?.[0]?.content?.parts?.[0]?.text;
      if (!txt) throw new Error('Empty output');
      return res.status(200).json({ ok: true, engine: 'gemini', model, data: JSON.parse(txt) });
    } catch {
      // try fallback on outer loop / response
    }
  }

  return res.status(200).json({
    ok: false,
    fallback: true,
    reason: 'Gemini tidak merespons; menggunakan ringkasan otomatis lokal.',
  });
}
