/**
 * Vercel Serverless Function: POST /api/parse-financials
 * Extracts and normalizes messy financial text or Stockbit/RTI screenshots
 * into structured DCF inputs using Gemini 3.1 Flash-Lite (Free Tier).
 */

const MODELS = [
  process.env.GEMINI_MODEL || 'gemini-3.1-flash-lite',
  'gemini-3-flash-preview',
  'gemini-2.5-flash',
];

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    ticker: { type: 'STRING', nullable: true },
    name: { type: 'STRING', nullable: true },
    price: { type: 'NUMBER', nullable: true },
    marketCapTrillion: { type: 'NUMBER', nullable: true },
    roeDecimal: { type: 'NUMBER', nullable: true },
    npmDecimal: { type: 'NUMBER', nullable: true },
    derRatio: { type: 'NUMBER', nullable: true },
    epsTTM: { type: 'NUMBER', nullable: true },
    bvps: { type: 'NUMBER', nullable: true },
    pe3: { type: 'NUMBER', nullable: true },
    pe5: { type: 'NUMBER', nullable: true },
    pe10: { type: 'NUMBER', nullable: true },
    pbv3: { type: 'NUMBER', nullable: true },
    pbv5: { type: 'NUMBER', nullable: true },
    pbv10: { type: 'NUMBER', nullable: true },
    ocfBillion: { type: 'NUMBER', nullable: true },
    fcfBillion: { type: 'NUMBER', nullable: true },
    history: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          year: { type: 'INTEGER' },
          sales: { type: 'NUMBER' },
          op: { type: 'NUMBER' },
          ni: { type: 'NUMBER' },
        },
        required: ['year', 'sales', 'op', 'ni'],
      },
    },
    warnings: {
      type: 'ARRAY',
      items: { type: 'STRING' },
    },
  },
  required: ['history', 'warnings'],
};

const SYSTEM_PROMPT = `Kamu adalah asisten analis keuangan pasar modal Indonesia (IDX) yang bertugas mengekstrak dan merapikan data laporan keuangan mentah (dari teks bebas maupun screenshot aplikasi seperti Stockbit, RTI Business, TradingView, atau Excel) menjadi JSON terstruktur untuk model DCF.

ATURAN WAJIB:
1. Semua nilai di array "history" (sales = Pendapatan/Penjualan, op = Laba Usaha/Operating Profit/EBIT, ni = Laba Bersih/Net Income Entitas Induk) HARUS dikonversi ke satuan MILYAR RUPIAH (Billion IDR):
   - Jika angka bersatuan T / Triliun / Trillion -> kalikan 1000 (contoh: 10.5 T -> 10500).
   - Jika bersatuan B / Billion / Miliar / Milyar -> pakai langsung (contoh: 10,724 B -> 10724).
   - Jika bersatuan M / Million / Juta -> bagi 1000 (contoh: 500 M -> 0.5).
   - Jika tanpa satuan tetapi jelas laporan keuangan IDX dalam milyar (misal 207783) -> tetap dalam milyar.
   - Jika format angka pakai pemisah ribuan koma ("10,724") atau titik ("10.724"), pahami konteksnya dengan benar.
2. Urutkan "history" dari tahun TERBARU ke TERLAMA (descending, misal 2025, 2024, 2023, 2022, 2021).
3. Jika pengguna menulis rentang tahun yang jumlahnya tidak cocok dengan jumlah kolom angka (misal menulis "2025 - 2022" tetapi memberikan 5 angka), lengkapi tahun berurutan secara logis (misal tambahkan 2021) dan tulis penjelasannya di "warnings".
4. Konversi rasio:
   - "roeDecimal" dan "npmDecimal" HARUS dalam bentuk desimal (contoh: 26.5% -> 0.265; jika tertulis 26.5 tanpa % dan konteksnya ROE/NPM persen -> 0.265).
   - "derRatio" HARUS dalam rasio x (contoh: 0.63x -> 0.63; jika tertulis dalam persen seperti 63% -> 0.63 dan catat di "warnings").
5. Jika ada angka harga saham (price dalam Rp), Market Cap (marketCapTrillion dalam Trilyun Rp), EPS TTM (epsTTM dalam Rp), BVPS (bvps dalam Rp), rata-rata PE/PBV 3Y/5Y/10Y, atau Operating Cash Flow ("ocfBillion" dalam Milyar Rp) / Free Cash Flow ("fcfBillion" dalam Milyar Rp), ekstrak juga. Jika tidak ada, isi null.
6. Jangan pernah mengarang angka yang tidak ada di input.`;

async function callGemini(model, apiKey, parts) {
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
  const body = {
    systemInstruction: { parts: [{ text: SYSTEM_PROMPT }] },
    contents: [{ role: 'user', parts }],
    generationConfig: {
      temperature: 0.1,
      responseMimeType: 'application/json',
      responseSchema: RESPONSE_SCHEMA,
    },
  };

  const resp = await fetch(url, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });

  if (!resp.ok) {
    const errTxt = await resp.text().catch(() => '');
    const err = new Error(`Gemini ${model} HTTP ${resp.status}: ${errTxt.slice(0, 200)}`);
    err.status = resp.status;
    throw err;
  }

  const data = await resp.json();
  const textOut = data?.candidates?.[0]?.content?.parts?.[0]?.text;
  if (!textOut) throw new Error('Respons Gemini kosong');
  return JSON.parse(textOut);
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') return res.status(204).end();
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Gunakan method POST' });
  }

  const body = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : req.body || {};
  const text = String(body.text || '').trim();
  const imageBase64 = body.imageBase64 ? String(body.imageBase64) : '';
  const mimeType = body.mimeType ? String(body.mimeType) : 'image/png';
  const currentTicker = body.currentTicker ? String(body.currentTicker) : '';

  if (!text && !imageBase64) {
    return res.status(400).json({ error: 'Masukkan teks data keuangan atau tempel screenshot terlebih dahulu.' });
  }

  const headerKey = req.headers['x-gemini-key'] ? String(req.headers['x-gemini-key']).trim() : '';
  const apiKey = process.env.GEMINI_API_KEY || headerKey;

  if (!apiKey) {
    return res.status(200).json({
      ok: false,
      fallback: true,
      reason: 'GEMINI_API_KEY belum terpasang di Vercel. Menggunakan Smart Parser lokal.',
    });
  }

  const parts = [];
  const promptText = [
    currentTicker ? `Konteks ticker aktif saat ini: ${currentTicker}` : '',
    text ? `Teks data mentah:\n${text}` : 'Ekstrak data laporan keuangan & rasio dari gambar screenshot terlampir.',
  ]
    .filter(Boolean)
    .join('\n\n');
  parts.push({ text: promptText });

  if (imageBase64) {
    const cleanB64 = imageBase64.replace(/^data:[^;]+;base64,/, '');
    parts.push({
      inlineData: {
        mimeType,
        data: cleanB64,
      },
    });
  }

  let lastErr = null;
  for (const model of MODELS) {
    try {
      const parsed = await callGemini(model, apiKey, parts);
      return res.status(200).json({
        ok: true,
        engine: 'gemini',
        model,
        data: parsed,
      });
    } catch (err) {
      lastErr = err;
      // Only retry next model on 404/400 model-not-found errors
      if (err.status && err.status !== 404 && err.status !== 400) break;
    }
  }

  return res.status(200).json({
    ok: false,
    fallback: true,
    reason: `Gemini API gagal (${lastErr?.message || 'unknown'}). Beralih ke Smart Parser lokal.`,
  });
}
