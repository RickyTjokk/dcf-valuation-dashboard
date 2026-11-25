import test from 'node:test';
import assert from 'node:assert/strict';
import {
  parseFinancialToken,
  parseFinancialTextLocal,
  normalizeParsedResult,
} from '../src/services/smartParser.js';

test('parseFinancialToken handles T, B, M units, commas, dots, and parentheses', () => {
  assert.equal(parseFinancialToken('10,724 B'), 10724);
  assert.equal(parseFinancialToken('9.026 B'), 9026);
  assert.equal(parseFinancialToken('1.5 T'), 1500);
  assert.equal(parseFinancialToken('500 M'), 0.5);
  assert.equal(parseFinancialToken('(356 B)'), -356);
  assert.equal(parseFinancialToken('Rp 207,783'), 207783);
});

test('parseFinancialTextLocal parses user messy example and infers missing 5th year', () => {
  const sample = `
CMRY
pendapatan tahun 2025 - 2022
10,724 B\t9,026 B\t7,773 B\t6,378 B\t4,096 B

laba usaha
1,980 B\t1,671 B\t1,428 B\t1,256 B\t1,007 B

laba bersih
1,790 B\t1,519 B\t1,242 B\t1,061 B\t790 B

ROE : 26.5%
NPM : 16.7%
DER : 63%
EPS TTM : 225
BVPS : 890
  `;

  const res = normalizeParsedResult(parseFinancialTextLocal(sample));
  assert.equal(res.ticker, 'CMRY');
  assert.equal(res.history.length, 5);
  assert.deepEqual(
    res.history.map((h) => h.year),
    [2025, 2024, 2023, 2022, 2021]
  );
  assert.equal(res.history[0].sales, 10724);
  assert.equal(res.history[0].op, 1980);
  assert.equal(res.history[0].ni, 1790);
  assert.equal(res.history[4].sales, 4096);
  assert.equal(res.roe, 0.265);
  assert.equal(res.npm, 0.167);
  assert.equal(res.der, 0.63);
  assert.equal(res.epsTTM, 225);
  assert.equal(res.bvps, 890);
  assert.ok(res.warnings.length >= 2, 'Should warn about extended year and DER % conversion');
});

test('parseFinancialTextLocal handles Triliun & Juta mixed units', () => {
  const sample = `
2024 2023 2022
Penjualan: 207.7 T  199.3 T  188.1 T
Laba Usaha: 73,248 B  78,216 B  76,829 B
Laba Bersih: 56,652 B  59,945 B  60,100 B
ROE: 19%
DER: 0.63x
NPM: 27.1%
  `;
  const res = normalizeParsedResult(parseFinancialTextLocal(sample));
  assert.equal(res.history.length, 3);
  assert.equal(res.history[0].sales, 207700);
  assert.equal(res.history[0].op, 73248);
  assert.equal(res.roe, 0.19);
  assert.equal(res.der, 0.63);
  assert.equal(res.npm, 0.271);
});
