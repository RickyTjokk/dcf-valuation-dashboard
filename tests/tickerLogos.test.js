import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/data/presets15.js';
import {
  TICKER_DOMAINS,
  getTickerLogoUrl,
  renderTickerLogoHtml,
} from '../src/data/tickerLogos.js';

test('All 15 preset tickers are mapped in TICKER_DOMAINS', () => {
  for (const p of PRESETS) {
    assert.ok(TICKER_DOMAINS[p.ticker], `Missing logo domain for preset ${p.ticker}`);
    const url = getTickerLogoUrl(p.ticker);
    assert.ok(url && url.startsWith('https://'), `Invalid logo URL for ${p.ticker}`);
  }
});

test('renderTickerLogoHtml renders image with fallback for known ticker and monogram for unknown ticker', () => {
  const known = renderTickerLogoHtml('BBRI', 28);
  assert.ok(known.includes('<img') && known.includes('bri.co.id') && known.includes('ticker-monogram'));

  const unknown = renderTickerLogoHtml('ZZZZ', 28);
  assert.ok(!unknown.includes('<img') && unknown.includes('ZZZZ') && unknown.includes('ticker-monogram'));
});
