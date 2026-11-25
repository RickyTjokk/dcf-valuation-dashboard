/**
 * Hybrid Financial Data Entry Service:
 * 1) Calls /api/parse-financials (Gemini 3.1 Flash-Lite, supports text + screenshot)
 * 2) Automatically falls back to zero-dependency Local Smart Parser for text input
 */

import { DEFAULT_INF } from '../engine/dcfEngine.js';

const GEMINI_KEY_STORAGE = 'dcf_lab_gemini_key_v1';

export function loadLocalGeminiKey() {
  try {
    return localStorage.getItem(GEMINI_KEY_STORAGE) || '';
  } catch {
    return '';
  }
}

export function saveLocalGeminiKey(key) {
  try {
    const clean = String(key || '').trim();
    if (clean) localStorage.setItem(GEMINI_KEY_STORAGE, clean);
    else localStorage.removeItem(GEMINI_KEY_STORAGE);
  } catch {}
}

/**
 * Parse single formatted financial token into Milyar IDR (Billions) or raw number.
 * Supports: "10,724 B", "9.026 B", "1.5 T", "500 M", "(356 B)", "-589", "26.5%"
 */
export function parseFinancialToken(rawToken, { asBillions = true } = {}) {
  let s = String(rawToken || '').trim();
  if (!s) return null;

  let negative = false;
  if (s.startsWith('(') && s.endsWith(')')) {
    negative = true;
    s = s.slice(1, -1).trim();
  }
  if (s.startsWith('-')) {
    negative = true;
    s = s.slice(1).trim();
  }

  // Detect unit suffix
  let mult = 1;
  const unitMatch = s.match(/(trilyun|triliun|billion|milyar|miliar|million|juta|rb|ribu|t|b|m|k)\s*$/i);
  if (unitMatch) {
    const u = unitMatch[1].toLowerCase();
    s = s.slice(0, unitMatch.index).trim();
    if (asBillions) {
      if (u === 't' || u === 'triliun' || u === 'trilyun') mult = 1000;
      else if (u === 'b' || u === 'billion' || u === 'miliar' || u === 'milyar') mult = 1;
      else if (u === 'm' || u === 'million' || u === 'juta') mult = 0.001;
      else if (u === 'k' || u === 'rb' || u === 'ribu') mult = 0.000001;
    } else {
      if (u === 't' || u === 'triliun' || u === 'trilyun') mult = 1e12;
      else if (u === 'b' || u === 'billion' || u === 'miliar' || u === 'milyar') mult = 1e9;
      else if (u === 'm' || u === 'million' || u === 'juta') mult = 1e6;
      else if (u === 'k' || u === 'rb' || u === 'ribu') mult = 1e3;
    }
  }

  // Strip currency prefix
  s = s.replace(/^(rp|idr)\s*/i, '').trim();
  // Clean spaces
  s = s.replace(/\s+/g, '');

  // Disambiguate commas & dots
  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    // Whichever appears last is decimal separator
    if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
      s = s.replace(/\./g, '').replace(',', '.');
    } else {
      s = s.replace(/,/g, '');
    }
  } else if (hasComma) {
    // "10,724" -> thousands separator if 3 digits after every comma, else decimal comma ("26,5")
    if (/^\d{1,3}(,\d{3})+$/.test(s)) {
      s = s.replace(/,/g, '');
    } else {
      s = s.replace(',', '.');
    }
  } else if (hasDot) {
    // "10.724" -> thousands dot if exact groups of 3 digits after dot AND no unit or >=2 groups,
    // except small decimals like "1.250" with unit T/B? Wait: in IDX "10.724 B" or "10.724" usually means 10724,
    // while "1.5 T" has 1 digit after dot -> 1.5!
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, '');
    }
  }

  const num = parseFloat(s);
  if (!Number.isFinite(num)) return null;
  const val = (negative ? -num : num) * mult;
  return Number(val.toFixed(4));
}

function extractNumbersFromLine(line, asBillions = true) {
  const matches = line.match(/\(?\s*-?(?:rp\s*)?\d[\d.,]*\s*(?:trilyun|triliun|billion|milyar|miliar|million|juta|rb|ribu|t|b|m|k)?\s*\)?/gi) || [];
  const nums = [];
  for (const m of matches) {
    const cleaned = m.trim();
    // Ignore standalone 4-digit years if mixed in? Caller handles year lines separately
    const val = parseFinancialToken(cleaned, { asBillions });
    if (val !== null) nums.push(val);
  }
  return nums;
}

function parsePercentOrDecimal(raw) {
  const s = String(raw || '').trim();
  const hasPct = s.includes('%');
  const num = parseFinancialToken(s.replace('%', ''), { asBillions: false });
  if (num === null) return null;
  if (hasPct) return Number((num / 100).toFixed(6));
  // If > 1 (e.g. "26.5" for ROE/NPM), treat as percentage
  return num > 1 ? Number((num / 100).toFixed(6)) : num;
}

/**
 * Local Smart Parser — zero API key fallback for free-form financial notes
 */
export function parseFinancialTextLocal(rawText) {
  const lines = String(rawText || '')
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);

  const warnings = [];
  let ticker = null;
  let years = [];
  let salesArr = [];
  let opArr = [];
  let niArr = [];

  let roeDecimal = null;
  let npmDecimal = null;
  let derRatio = null;
  let epsTTM = null;
  let bvps = null;
  let price = null;
  let marketCapTrillion = null;
  let pe3 = null, pe5 = null, pe10 = null;
  let pbv3 = null, pbv5 = null, pbv10 = null;
  let ocfBillion = null;
  let fcfBillion = null;

  let activeSection = null;

  const isYearLine = (l) => /(tahun|year|periode|fy)/i.test(l) || /^(?:20\d{2}|19\d{2})(?:\s*[-–—s/dto,\t ]+\s*(?:20\d{2}|19\d{2}))+$/i.test(l);

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const lower = line.toLowerCase();

    // Detect standalone ticker on early line (e.g. "CMRY" or "Ticker: BBRI")
    const tickerMatch = line.match(/^(?:ticker|kode|emiten)?\s*[:=]?\s*([A-Z]{4})(?:\.JK)?$/i);
    if (tickerMatch && !/^(laba|pendapatan|sales|tahun|year|harga|price)/i.test(tickerMatch[1])) {
      ticker = tickerMatch[1].toUpperCase();
      continue;
    }

    // Single-value ratio lines
    const ratioMatch = (re) => {
      const m = line.match(re);
      return m ? m[1] : null;
    };

    if (/^\s*roe\b/i.test(line)) {
      const val = parsePercentOrDecimal(line.replace(/^.*?roe\s*[:=\-]?\s*/i, ''));
      if (val !== null) roeDecimal = val;
      activeSection = null;
      continue;
    }
    if (/^\s*npm\b/i.test(line)) {
      const val = parsePercentOrDecimal(line.replace(/^.*?npm\s*[:=\-]?\s*/i, ''));
      if (val !== null) npmDecimal = val;
      activeSection = null;
      continue;
    }
    if (/^\s*der\b/i.test(line)) {
      const rest = line.replace(/^.*?der\s*[:=\-]?\s*/i, '');
      const hasPct = rest.includes('%');
      const val = parseFinancialToken(rest.replace(/[%x]/gi, ''), { asBillions: false });
      if (val !== null) {
        if (hasPct) {
          derRatio = Number((val / 100).toFixed(4));
          warnings.push(`DER ${rest.trim()} dikonversi menjadi rasio ${derRatio}x.`);
        } else {
          derRatio = val;
        }
      }
      activeSection = null;
      continue;
    }
    if (/^\s*(eps\s*ttm|eps)\b/i.test(line)) {
      const val = parseFinancialToken(line.replace(/^.*?(?:eps\s*ttm|eps)\s*[:=\-]?\s*/i, ''), { asBillions: false });
      if (val !== null) epsTTM = val;
      activeSection = null;
      continue;
    }
    if (/^\s*(bvps|ekuitas\s*per\s*(?:lembar|saham))\b/i.test(line)) {
      const val = parseFinancialToken(line.replace(/^.*?(?:bvps|ekuitas\s*per\s*(?:lembar|saham))\s*[:=\-]?\s*/i, ''), { asBillions: false });
      if (val !== null) bvps = val;
      activeSection = null;
      continue;
    }
    if (/^\s*(harga(?:\s*saham)?|price)\b/i.test(line)) {
      const val = parseFinancialToken(line.replace(/^.*?(?:harga(?:\s*saham)?|price)\s*[:=\-]?\s*/i, ''), { asBillions: false });
      if (val !== null) price = val;
      activeSection = null;
      continue;
    }
    if (/^\s*(market\s*cap|mcap|kapitalisasi)\b/i.test(line)) {
      const rest = line.replace(/^.*?(?:market\s*cap|mcap|kapitalisasi)\s*[:=\-]?\s*/i, '');
      const valB = parseFinancialToken(rest, { asBillions: true });
      if (valB !== null) {
        // If user wrote e.g. "32.9 T" -> valB = 32900 -> in trillion = 32.9; if wrote "32.9" without unit -> assume trillion
        const hasUnit = /(t|tril|b|mil|m|juta)/i.test(rest);
        marketCapTrillion = hasUnit ? Number((valB / 1000).toFixed(4)) : valB;
      }
      activeSection = null;
      continue;
    }

    if (/^\s*(?:ocf|operating\s*cash\s*flow|arus\s*kas\s*operasi(?:onal)?|cfo)\b/i.test(line)) {
      const rest = line.replace(/^.*?(?:ocf|operating\s*cash\s*flow|arus\s*kas\s*operasi(?:onal)?|cfo)\s*[:=\-]?\s*/i, '');
      const nums = extractNumbersFromLine(rest, true);
      if (nums.length) ocfBillion = nums[0];
      activeSection = null;
      continue;
    }
    if (/^\s*(?:fcf|free\s*cash\s*flow|arus\s*kas\s*bebas)\b/i.test(line)) {
      const rest = line.replace(/^.*?(?:fcf|free\s*cash\s*flow|arus\s*kas\s*bebas)\s*[:=\-]?\s*/i, '');
      const nums = extractNumbersFromLine(rest, true);
      if (nums.length) fcfBillion = nums[0];
      activeSection = null;
      continue;
    }

    // PE / PBV multiples
    const pe3m = ratioMatch(/^(?:mean\s*)?pe\s*3\s*y\s*[:=\-]?\s*(.+)$/i);
    if (pe3m) { pe3 = parseFinancialToken(pe3m, { asBillions: false }); continue; }
    const pe5m = ratioMatch(/^(?:mean\s*)?pe\s*5\s*y\s*[:=\-]?\s*(.+)$/i);
    if (pe5m) { pe5 = parseFinancialToken(pe5m, { asBillions: false }); continue; }
    const pe10m = ratioMatch(/^(?:mean\s*)?pe\s*10\s*y\s*[:=\-]?\s*(.+)$/i);
    if (pe10m) { pe10 = parseFinancialToken(pe10m, { asBillions: false }); continue; }
    const pbv3m = ratioMatch(/^(?:mean\s*)?pbv\s*3\s*y\s*[:=\-]?\s*(.+)$/i);
    if (pbv3m) { pbv3 = parseFinancialToken(pbv3m, { asBillions: false }); continue; }
    const pbv5m = ratioMatch(/^(?:mean\s*)?pbv\s*5\s*y\s*[:=\-]?\s*(.+)$/i);
    if (pbv5m) { pbv5 = parseFinancialToken(pbv5m, { asBillions: false }); continue; }
    const pbv10m = ratioMatch(/^(?:mean\s*)?pbv\s*10\s*y\s*[:=\-]?\s*(.+)$/i);
    if (pbv10m) { pbv10 = parseFinancialToken(pbv10m, { asBillions: false }); continue; }

    // Year range or list
    if (isYearLine(line) && !/(pendapatan|penjualan|revenue|sales|laba|profit|income)/i.test(line)) {
      const rangeM = line.match(/(20\d{2}|19\d{2})\s*(?:-|–|—|s\/d|sd|to)\s*(20\d{2}|19\d{2})/i);
      if (rangeM) {
        const y1 = Number(rangeM[1]);
        const y2 = Number(rangeM[2]);
        const step = y1 >= y2 ? -1 : 1;
        const seq = [];
        for (let y = y1; step < 0 ? y >= y2 : y <= y2; y += step) seq.push(y);
        years = seq;
      } else {
        const yrs = (line.match(/\b(?:20\d{2}|19\d{2})\b/g) || []).map(Number);
        if (yrs.length >= 2) years = yrs;
      }
      activeSection = null;
      continue;
    }

    // Section headers (may also have inline numbers on same line!)
    if (/^(pendapatan|penjualan|revenue|sales|omzet)\b/i.test(lower)) {
      activeSection = 'sales';
      // Check if line contains a year range too (e.g. "pendapatan tahun 2025 - 2022")
      const rangeM = line.match(/(20\d{2}|19\d{2})\s*(?:-|–|—|s\/d|sd|to)\s*(20\d{2}|19\d{2})/i);
      if (rangeM) {
        const y1 = Number(rangeM[1]);
        const y2 = Number(rangeM[2]);
        const step = y1 >= y2 ? -1 : 1;
        const seq = [];
        for (let y = y1; step < 0 ? y >= y2 : y <= y2; y += step) seq.push(y);
        years = seq;
      } else {
        const stripped = line.replace(/^.*?(?:pendapatan|penjualan|revenue|sales|omzet)\s*[:=\-]?\s*/i, '');
        const nums = extractNumbersFromLine(stripped, true);
        if (nums.length >= 2) {
          salesArr = nums;
          activeSection = null;
        }
      }
      continue;
    }

    if (/^(laba\s*usaha|laba\s*operasional|operating\s*profit|operating\s*income|ebit)\b/i.test(lower)) {
      activeSection = 'op';
      const stripped = line.replace(/^.*?(?:laba\s*usaha|laba\s*operasional|operating\s*profit|operating\s*income|ebit)\s*[:=\-]?\s*/i, '');
      const nums = extractNumbersFromLine(stripped, true);
      if (nums.length >= 2) {
        opArr = nums;
        activeSection = null;
      }
      continue;
    }

    if (/^(laba\s*bersih|net\s*income|net\s*profit|laba\s*tahun\s*berjalan)\b/i.test(lower)) {
      activeSection = 'ni';
      const stripped = line.replace(/^.*?(?:laba\s*bersih(?:\s*\([^)]*\))?|net\s*income|net\s*profit|laba\s*tahun\s*berjalan)\s*[:=\-]?\s*/i, '');
      const nums = extractNumbersFromLine(stripped, true);
      if (nums.length >= 2) {
        niArr = nums;
        activeSection = null;
      }
      continue;
    }

    // Data line belonging to activeSection
    if (activeSection) {
      const nums = extractNumbersFromLine(line, true);
      if (nums.length) {
        if (activeSection === 'sales') salesArr.push(...nums);
        else if (activeSection === 'op') opArr.push(...nums);
        else if (activeSection === 'ni') niArr.push(...nums);
      }
    }
  }

  const maxLen = Math.max(salesArr.length, opArr.length, niArr.length);
  const history = [];

  if (maxLen > 0) {
    if (!years.length) {
      const curY = new Date().getFullYear() - 1;
      years = Array.from({ length: maxLen }, (_, idx) => curY - idx);
      warnings.push(`Tahun tidak disebut eksplisit; diisi otomatis ${years[0]}–${years[years.length - 1]}.`);
    } else if (years.length < maxLen) {
      const originalRange = `${years[0]}–${years[years.length - 1]}`;
      const desc = years.length === 1 || years[0] > years[years.length - 1];
      while (years.length < maxLen) {
        const last = years[years.length - 1];
        years.push(desc ? last - 1 : last + 1);
      }
      warnings.push(
        `Terdeteksi ${maxLen} kolom angka untuk rentang tahun ${originalRange}; tahun dilengkapi otomatis menjadi ${years[0]}–${years[years.length - 1]}.`
      );
    }

    for (let i = 0; i < maxLen; i++) {
      history.push({
        year: years[i],
        sales: salesArr[i] ?? 0,
        op: opArr[i] ?? 0,
        ni: niArr[i] ?? 0,
      });
    }

    // Sort newest -> oldest
    history.sort((a, b) => b.year - a.year);
  }

  return {
    ticker,
    name: null,
    price,
    marketCapTrillion,
    roeDecimal,
    npmDecimal,
    derRatio,
    epsTTM,
    bvps,
    pe3,
    pe5,
    pe10,
    pbv3,
    pbv5,
    pbv10,
    ocfBillion,
    fcfBillion,
    history: history.slice(0, 7),
    warnings,
  };
}

/**
 * Normalize parsed payload (from Gemini or Local) into clean DCF dashboard format
 */
export function normalizeParsedResult(raw) {
  const warnings = Array.isArray(raw.warnings) ? [...raw.warnings] : [];
  let history = Array.isArray(raw.history) ? raw.history : [];

  history = history
    .filter((h) => h && Number.isFinite(Number(h.year)))
    .sort((a, b) => Number(b.year) - Number(a.year))
    .slice(0, 7)
    .map((h, idx) => ({
      year: Math.round(Number(h.year)),
      sales: Number(h.sales) || 0,
      op: Number(h.op) || 0,
      ni: Number(h.ni) || 0,
      inf: DEFAULT_INF[idx] || 1.2,
    }));

  // Sanity guard for ROE/NPM if AI ever returned 26.5 instead of 0.265
  let roe = raw.roeDecimal ?? null;
  if (roe !== null && roe > 1.5) {
    roe = Number((roe / 100).toFixed(6));
  }
  let npm = raw.npmDecimal ?? null;
  if (npm !== null && npm > 1) {
    npm = Number((npm / 100).toFixed(6));
  }

  return {
    ticker: raw.ticker ? String(raw.ticker).toUpperCase().replace(/\.JK$/i, '') : null,
    name: raw.name || null,
    price: raw.price > 0 ? Number(raw.price) : null,
    marketCapTrillion: raw.marketCapTrillion > 0 ? Number(raw.marketCapTrillion) : null,
    roe,
    npm,
    der: raw.derRatio !== null && raw.derRatio !== undefined ? Number(raw.derRatio) : null,
    epsTTM: raw.epsTTM !== null && raw.epsTTM !== undefined ? Number(raw.epsTTM) : null,
    bvps: raw.bvps !== null && raw.bvps !== undefined ? Number(raw.bvps) : null,
    pe3: raw.pe3 > 0 ? Number(raw.pe3) : null,
    pe5: raw.pe5 > 0 ? Number(raw.pe5) : null,
    pe10: raw.pe10 > 0 ? Number(raw.pe10) : null,
    pbv3: raw.pbv3 > 0 ? Number(raw.pbv3) : null,
    pbv5: raw.pbv5 > 0 ? Number(raw.pbv5) : null,
    pbv10: raw.pbv10 > 0 ? Number(raw.pbv10) : null,
    ocf: raw.ocfBillion !== null && raw.ocfBillion !== undefined ? Number(raw.ocfBillion) : null,
    fcf: raw.fcfBillion !== null && raw.fcfBillion !== undefined ? Number(raw.fcfBillion) : null,
    history,
    warnings,
  };
}

/**
 * Main entry point called by UI: tries Gemini 3.1 Flash-Lite API first, falls back to Local Smart Parser
 */
export async function smartExtractFinancials({ text = '', imageBase64 = '', mimeType = 'image/png', currentTicker = '' }) {
  const localKey = loadLocalGeminiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (localKey) headers['x-gemini-key'] = localKey;

  try {
    const resp = await fetch('/api/parse-financials', {
      method: 'POST',
      headers,
      body: JSON.stringify({ text, imageBase64, mimeType, currentTicker }),
    });

    if (resp.ok) {
      const res = await resp.json();
      if (res.ok && res.data) {
        return {
          engine: 'gemini',
          model: res.model || 'gemini-3.1-flash-lite',
          data: normalizeParsedResult(res.data),
        };
      }
      if (res.fallback) {
        if (!text.trim() && imageBase64) {
          throw new Error('Pembacaan screenshot membutuhkan GEMINI_API_KEY (Free Tier Google AI Studio). Tambahkan di Vercel atau Pengaturan.');
        }
        const local = parseFinancialTextLocal(text);
        const norm = normalizeParsedResult(local);
        if (res.reason) norm.warnings.unshift(res.reason);
        return { engine: 'local', model: 'Local Smart Parser', data: norm };
      }
    }
  } catch (err) {
    if (!text.trim() && imageBase64) throw err;
  }

  if (!text.trim()) {
    throw new Error('Tidak ada teks yang bisa diproses.');
  }

  const local = parseFinancialTextLocal(text);
  return {
    engine: 'local',
    model: 'Local Smart Parser',
    data: normalizeParsedResult(local),
  };
}
