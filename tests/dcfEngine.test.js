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

test('V3: Quality Score, Grade A-D, 3 Scenarios, and Stale Data detection', () => {
  const cmry = PRESETS.find((p) => p.ticker === 'CMRY');
  const cmryRes = computeDCF(cmry, { refYear: 2026 });
  assert.equal(cmryRes.qualityGrade, 'A');
  assert.ok(cmryRes.qualityScore >= 75);
  assert.equal(cmryRes.isStaleData, false);
  assert.ok(cmryRes.scenarios.bear.fv < cmryRes.scenarios.base.fv);
  assert.ok(cmryRes.scenarios.base.fv < cmryRes.scenarios.bull.fv);

  const tlkm = PRESETS.find((p) => p.ticker === 'TLKM');
  const tlkmRes = computeDCF(tlkm, { refYear: 2026 });
  assert.equal(tlkmRes.dataYear, 2019);
  assert.equal(tlkmRes.isStaleData, true);

  // Value trap detection: Grade C/D with MoS >= 30%
  const trapStock = { ...cmry, roe: 0.02, npm: 0.01, der: 3.5, marketCap: 0.5, price: 200 };
  const trapRes = computeDCF(trapStock);
  assert.ok(trapRes.qualityGrade === 'C' || trapRes.qualityGrade === 'D');
  assert.ok(trapRes.verdict.title.includes('Value Trap'));
});

test('V5: 2-Stage DDM, Graham Number, and preset DCF parity with includeDdm=false', () => {
  const bbri = PRESETS.find((p) => p.ticker === 'BBRI');
  assert.strictEqual(bbri.includeDdm, false);
  const resOff = computeDCF(bbri);
  assert.ok(resOff.ddmValue > 0, 'BBRI should calculate reference ddmValue from DPS');
  assert.ok(resOff.grahamNumber > 0, 'BBRI should calculate Graham Number from EPS & BVPS');
  const expectedGraham = Math.sqrt(22.5 * resOff.epsBase * bbri.bvps);
  assert.ok(Math.abs(resOff.grahamNumber - expectedGraham) < 0.01);
  // With includeDdm=false, fvFinal must equal (iv + rv) / 2 (100% v4 parity)
  assert.ok(Math.abs(resOff.fvFinal - (resOff.iv + resOff.rv) / 2) < 0.01);

  // When includeDdm=true, fvFinal averages iv, rv, and ddmValue
  const resOn = computeDCF({ ...bbri, includeDdm: true });
  const expectedAvg = (resOn.iv + resOn.rv + resOn.ddmValue) / 3;
  assert.ok(Math.abs(resOn.fvFinal - expectedAvg) < 0.01);
  // Bear/Bull scenarios should shift DDM growth too when ddmG1 is unset
  assert.ok(resOn.scenarios.bull.fv > resOn.scenarios.base.fv);
  assert.ok(resOn.scenarios.base.fv > resOn.scenarios.bear.fv);

  // When DPS=0, enabling includeDdm should gracefully skip DDM in fvFinal
  const resZeroDps = computeDCF({ ...bbri, dps: 0, includeDdm: true });
  assert.strictEqual(resZeroDps.ddmValue, 0);
  assert.ok(Math.abs(resZeroDps.fvFinal - (resZeroDps.iv + resZeroDps.rv) / 2) < 0.01);
});


