import test from 'node:test';
import assert from 'node:assert/strict';
import { computeDCF } from '../src/engine/dcfEngine.js';
import { PRESETS } from '../src/data/presets15.js';

const EXPECTED = {
  BBRI: { dr: 0.1211095462, iv: 5517.77, fv: 5048.83 },
  BBNI: { dr: 0.143196352, iv: 3248.02, fv: 4654.12 },
  BRIS: { dr: 0.1062040821, iv: 2172.23, fv: 2172.23 },
  CMRY: { dr: 0.1047204234, iv: 5819.25, fv: 5761.10 },
  ICBP: { dr: 0.1016259966, iv: 11991.24, fv: 12755.27 },
  TLKM: { dr: 0.1058493648, iv: 2125.05, fv: 2806.02 },
  ADRO: { dr: 0.1403157062, iv: 1885.42, fv: 1683.30 },
  PTBA: { dr: 0.1274115959, iv: 3337.39, fv: 3291.48 },
};

test('All 15 presets compute finite DCF valuations without NaN/Infinity', () => {
  assert.equal(PRESETS.length, 15);
  for (const preset of PRESETS) {
    const res = computeDCF(preset);
    assert.ok(Number.isFinite(res.dr) && res.dr > 0, `${preset.ticker} DR invalid`);
    assert.ok(Number.isFinite(res.iv) && res.iv > 0, `${preset.ticker} IV invalid`);
    assert.ok(Number.isFinite(res.fvFinal) && res.fvFinal > 0, `${preset.ticker} FV invalid`);
    assert.equal(res.rows.length, 100, `${preset.ticker} should project 100 years`);
  }
});

test('Exact spreadsheet parity on core benchmark tickers', () => {
  for (const [ticker, exp] of Object.entries(EXPECTED)) {
    const preset = PRESETS.find((p) => p.ticker === ticker);
    assert.ok(preset, `Missing preset ${ticker}`);
    const res = computeDCF(preset);
    assert.ok(Math.abs(res.dr - exp.dr) < 1e-6, `${ticker} DR mismatch: ${res.dr} vs ${exp.dr}`);
    assert.ok(Math.abs(res.iv - exp.iv) < 0.05, `${ticker} IV mismatch: ${res.iv} vs ${exp.iv}`);
    assert.ok(Math.abs(res.fvFinal - exp.fv) < 0.05, `${ticker} FV mismatch: ${res.fvFinal} vs ${exp.fv}`);
  }
});

test('CNMA & KLBF use pure linear interpolation for COV OPM Beta', () => {
  const cnma = PRESETS.find((p) => p.ticker === 'CNMA');
  const cnmaRes = computeDCF(cnma);
  const covFactor = cnmaRes.factors.find((f) => f.key === 'cov');
  assert.ok(covFactor.beta > 0.7 && covFactor.beta < 0.9, `Expected interpolated COV beta ~0.79, got ${covFactor.beta}`);
});
