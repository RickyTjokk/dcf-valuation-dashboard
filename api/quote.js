/**
 * Vercel Serverless Function: GET /api/quote?ticker=BBRI
 * Fetches live IDX stock price, market cap, shares outstanding, EPS TTM, and BVPS
 * from Yahoo Finance ({TICKER}.JK), with v8 chart fallback and edge caching.
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36';

async function fetchChartFallback(symbol) {
  const url = `https://query1.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(symbol)}?range=5d&interval=1d`;
  const resp = await fetch(url, { headers: { 'User-Agent': UA, Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`Chart HTTP ${resp.status}`);
  const data = await resp.json();
  const meta = data?.chart?.result?.[0]?.meta;
  if (!meta || typeof meta.regularMarketPrice !== 'number') {
    throw new Error('Ticker tidak ditemukan di Yahoo Finance');
  }
  return {
    symbol,
    name: meta.longName || meta.shortName || symbol.replace('.JK', ''),
    price: meta.regularMarketPrice,
    previousClose: meta.chartPreviousClose ?? meta.previousClose ?? null,
    currency: meta.currency || 'IDR',
    marketCapTrillion: null,
    sharesBillion: null,
    epsTTM: null,
    bvps: null,
    source: 'yahoo-chart',
  };
}

async function fetchFullQuote(symbol) {
  // 1. Obtain Yahoo session cookie + crumb for v7 quote (gives marketCap, EPS, BVPS)
  const fcResp = await fetch('https://fc.yahoo.com', {
    headers: { 'User-Agent': UA },
    redirect: 'manual',
  });
  const rawSetCookie = fcResp.headers.get('set-cookie') || '';
  const cookie = rawSetCookie
    .split(/,(?=[^;]+=[^;]+)/)
    .map((c) => c.split(';')[0].trim())
    .filter(Boolean)
    .join('; ');

  if (!cookie) throw new Error('No Yahoo cookie');

  const crumbResp = await fetch('https://query1.finance.yahoo.com/v1/test/getcrumb', {
    headers: { 'User-Agent': UA, Cookie: cookie },
  });
  if (!crumbResp.ok) throw new Error(`Crumb HTTP ${crumbResp.status}`);
  const crumb = (await crumbResp.text()).trim();
  if (!crumb || crumb.includes('<')) throw new Error('Invalid crumb');

  const qUrl = `https://query1.finance.yahoo.com/v7/finance/quote?symbols=${encodeURIComponent(symbol)}&crumb=${encodeURIComponent(crumb)}`;
  const qResp = await fetch(qUrl, {
    headers: { 'User-Agent': UA, Cookie: cookie, Accept: 'application/json' },
  });
  if (!qResp.ok) throw new Error(`Quote HTTP ${qResp.status}`);
  const qData = await qResp.json();
  const q = qData?.quoteResponse?.result?.[0];
  if (!q || typeof q.regularMarketPrice !== 'number') {
    throw new Error('Empty quote result');
  }

  const marketCapTrillion = typeof q.marketCap === 'number' ? q.marketCap / 1e12 : null;
  const sharesBillion = typeof q.sharesOutstanding === 'number' ? q.sharesOutstanding / 1e9 : null;

  return {
    symbol,
    name: q.longName || q.shortName || symbol.replace('.JK', ''),
    price: q.regularMarketPrice,
    previousClose: q.regularMarketPreviousClose ?? null,
    currency: q.currency || 'IDR',
    marketCapTrillion,
    sharesBillion,
    epsTTM: typeof q.epsTrailingTwelveMonths === 'number' ? q.epsTrailingTwelveMonths : null,
    bvps: typeof q.bookValue === 'number' ? q.bookValue : null,
    source: 'yahoo-quote',
  };
}

export default async function handler(req, res) {
  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  const rawTicker = String(req.query.ticker || '').trim().toUpperCase();
  const cleanTicker = rawTicker.replace(/\.JK$/i, '').replace(/[^A-Z0-9]/g, '');

  if (!cleanTicker || cleanTicker.length < 2 || cleanTicker.length > 8) {
    return res.status(400).json({ error: 'Parameter ticker tidak valid (contoh: BBRI)' });
  }

  const symbol = `${cleanTicker}.JK`;
  res.setHeader('Cache-Control', 's-maxage=300, stale-while-revalidate=600');

  try {
    let payload;
    try {
      payload = await fetchFullQuote(symbol);
    } catch {
      payload = await fetchChartFallback(symbol);
    }

    return res.status(200).json({
      ticker: cleanTicker,
      ...payload,
      updatedAt: new Date().toISOString(),
    });
  } catch (err) {
    return res.status(502).json({
      error: `Gagal mengambil data pasar untuk ${symbol}`,
      detail: err?.message || 'Unknown error',
    });
  }
}
