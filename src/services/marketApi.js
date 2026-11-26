/**
 * Hybrid Market Data Service:
 * 1) Default: Vercel Serverless Proxy -> GET /api/quote?ticker=BBRI (Yahoo Finance .JK)
 * 2) Optional: Google Apps Script Web App URL (direct =GOOGLEFINANCE("IDX:...", ...) bridge)
 * Includes 5-minute client-side cache & graceful offline fallback.
 */

const SETTINGS_KEY = 'dcf_lab_live_settings_v2';
const QUOTE_CACHE = new Map();
const CACHE_TTL_MS = 5 * 60 * 1000;

export function loadLiveSettings() {
  try {
    const raw = localStorage.getItem(SETTINGS_KEY);
    if (raw) {
      return {
        provider: 'hybrid', // 'hybrid' | 'yahoo' | 'gas'
        gasUrl: '',
        autoSyncOnSelect: false,
        syncEpsBvps: false,
        ...JSON.parse(raw),
      };
    }
  } catch {}
  return {
    provider: 'hybrid',
    gasUrl: '',
    autoSyncOnSelect: false,
    syncEpsBvps: false,
  };
}

export function saveLiveSettings(settings) {
  try {
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  } catch {}
}

export function getCachedQuote(ticker) {
  const key = String(ticker || '').trim().toUpperCase();
  const hit = QUOTE_CACHE.get(key);
  if (hit && Date.now() - hit.fetchedAt < CACHE_TTL_MS) {
    return hit.data;
  }
  return null;
}

async function fetchFromGas(gasUrl, ticker, signal) {
  const sep = gasUrl.includes('?') ? '&' : '?';
  const url = `${gasUrl}${sep}ticker=${encodeURIComponent(ticker)}`;
  const resp = await fetch(url, { method: 'GET', signal });
  if (!resp.ok) throw new Error(`GAS HTTP ${resp.status}`);
  const data = await resp.json();
  if (!data || typeof data.price !== 'number' || data.price <= 0) {
    throw new Error('Data GOOGLEFINANCE kosong untuk ticker ini');
  }
  return data;
}

async function fetchFromYahooProxy(ticker, signal) {
  const resp = await fetch(`/api/quote?ticker=${encodeURIComponent(ticker)}`, { signal });
  if (!resp.ok) {
    let msg = `API HTTP ${resp.status}`;
    try {
      const errBody = await resp.json();
      if (errBody?.error) msg = errBody.error;
    } catch {}
    throw new Error(msg);
  }
  const data = await resp.json();
  if (!data || typeof data.price !== 'number' || data.price <= 0) {
    throw new Error('Harga tidak ditemukan');
  }
  return data;
}

export async function fetchLiveQuote(rawTicker, { force = false, signal } = {}) {
  if (signal?.aborted) {
    throw new DOMException('Request aborted', 'AbortError');
  }

  const ticker = String(rawTicker || '').trim().toUpperCase().replace(/\.JK$/i, '');
  if (!ticker) throw new Error('Ticker kosong');

  if (!force) {
    const cached = getCachedQuote(ticker);
    if (cached) return { ...cached, cached: true };
  }

  const settings = loadLiveSettings();
  let data = null;

  if (settings.provider === 'gas' && settings.gasUrl) {
    data = await fetchFromGas(settings.gasUrl, ticker, signal);
  } else if (settings.provider === 'hybrid' && settings.gasUrl) {
    try {
      data = await fetchFromGas(settings.gasUrl, ticker, signal);
    } catch (err) {
      if (signal?.aborted || err?.name === 'AbortError') throw err;
      data = await fetchFromYahooProxy(ticker, signal);
    }
  } else {
    data = await fetchFromYahooProxy(ticker, signal);
  }

  QUOTE_CACHE.set(ticker, { data, fetchedAt: Date.now() });
  return { ...data, cached: false };
}
