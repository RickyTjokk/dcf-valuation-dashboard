import test from 'node:test';
import assert from 'node:assert/strict';
import { PRESETS } from '../src/data/presets15.js';
import { computeDCF } from '../src/engine/dcfEngine.js';
import {
  SCHEMA_VERSION,
  LEGACY_KEYS,
  V12_KEYS,
  migrateStoredStocks,
  runStartupMigration,
  applyPresetOverrides,
  buildBackup,
  parseBackup,
  previewBackupMerge,
  mergeBackup,
  toWatchlistCsv,
  runWithConcurrency,
  shouldRemindBackup,
} from '../src/services/storage.js';

function createMemoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial).map(([k, v]) => [k, String(v)]));
  return {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => map.set(k, String(v)),
    removeItem: (k) => map.delete(k),
    dump: () => Object.fromEntries(map.entries()),
  };
}

test('migrateStoredStocks preserves user LK & v2 fields while filling only === undefined defaults', () => {
  const legacyV2 = [
    {
      id: 'CUSTOM_ICBP',
      ticker: 'ICBP',
      name: 'Indofood CBP Custom',
      price: 9200,
      marketCap: 107.3,
      sharesOverride: 0, // explicit falsy number must NOT be overwritten
      history: [
        { year: 2025, sales: 75000, op: 16500, ni: 9800, inf: 1.0 },
        { year: 2024, sales: 70000, op: 15000, ni: 8900 }, // missing inf -> filled
      ],
      roe: 0.215,
      der: 0.55,
      npm: 0.13,
      epsTTM: 840,
      bvps: 3900,
      g1: 0.09,
      g2: 0.03,
      includeRel: false, // explicit false must stay false
      y3Mult: 1.35, // preset-specific optional field must survive
    },
  ];

  const migrated = migrateStoredStocks(legacyV2);
  assert.equal(migrated.length, 1);
  const rec = migrated[0];

  // Preserved user values
  assert.equal(rec.ticker, 'ICBP');
  assert.equal(rec.price, 9200);
  assert.equal(rec.roe, 0.215);
  assert.equal(rec.sharesOverride, 0);
  assert.equal(rec.includeRel, false);
  assert.equal(rec.y3Mult, 1.35);
  assert.equal(rec.history[0].ni, 9800);
  assert.equal(rec.history[0].inf, 1.0);
  assert.ok(typeof rec.history[1].inf === 'number' && rec.history[1].inf > 1.0);

  // New defaults filled only where undefined
  assert.equal(rec.isBankMode, false);
  assert.equal(rec.ocf, null);
  assert.equal(rec.fcf, null);
  assert.equal(rec.ddmG1, null);
  assert.equal(rec.ddmG2, null);
  assert.equal(rec.note, '');
  assert.equal(rec.savedAt, null);
  assert.equal(rec.lkUpdatedAt, null);
  assert.equal(rec.lastSyncedAt, null);
});

test('runStartupMigration snapshots watchlist, upgrades schema, and rolls back on corrupted storage', () => {
  const legacyPayload = JSON.stringify([
    {
      id: 'CUSTOM_BBRI',
      ticker: 'BBRI',
      name: 'BBRI User LK',
      price: 4100,
      marketCap: 620,
      history: [{ year: 2025, sales: 190000, op: 82000, ni: 61500, inf: 1.0 }],
      roe: 0.195,
      der: 5.2,
      npm: 0.32,
      epsTTM: 405,
      bvps: 2150,
      g1: 0.08,
      g2: 0.03,
    },
  ]);

  const storage = createMemoryStorage({
    [LEGACY_KEYS.watchlist]: legacyPayload,
    [LEGACY_KEYS.hiddenPresets]: JSON.stringify(['UNVR']),
    [LEGACY_KEYS.favorites]: JSON.stringify(['BBRI']),
  });

  const res = runStartupMigration(storage);
  assert.equal(res.ok, true);
  assert.equal(res.migrated, true);
  assert.equal(res.rolledBack, false);
  assert.equal(storage.getItem(V12_KEYS.schemaVersion), String(SCHEMA_VERSION));
  assert.equal(storage.getItem(V12_KEYS.backupSnapshot), legacyPayload);
  // Existing keys untouched
  assert.equal(storage.getItem(LEGACY_KEYS.hiddenPresets), JSON.stringify(['UNVR']));
  assert.equal(storage.getItem(LEGACY_KEYS.favorites), JSON.stringify(['BBRI']));

  const upgraded = JSON.parse(storage.getItem(LEGACY_KEYS.watchlist));
  assert.equal(upgraded[0].history[0].ni, 61500);
  assert.equal(upgraded[0].isBankMode, false);

  // (a) Corrupted JSON or non-array in watchlist must NOT overwrite an existing valid backupSnapshot and must roll back to it
  const validSnapshot = JSON.stringify([
    { id: 'CUSTOM_BBCA', ticker: 'BBCA', price: 6100, history: [{ year: 2025, sales: 100, op: 50, ni: 40, inf: 1.0 }] },
  ]);
  for (const badPayload of ['{invalid-json', '{"corrupt":true}']) {
    const badWithSnap = createMemoryStorage({
      [LEGACY_KEYS.watchlist]: badPayload,
      [V12_KEYS.backupSnapshot]: validSnapshot,
    });
    const failRes = runStartupMigration(badWithSnap);
    assert.equal(failRes.ok, false);
    assert.equal(failRes.rolledBack, true);
    assert.equal(badWithSnap.getItem(V12_KEYS.backupSnapshot), validSnapshot);
    assert.equal(badWithSnap.getItem(LEGACY_KEYS.watchlist), validSnapshot);
  }

  // Corrupted JSON with NO valid backupSnapshot must handle safely without crashing or saving corrupted snapshot
  const badNoSnap = createMemoryStorage({
    [LEGACY_KEYS.watchlist]: '{invalid-json',
  });
  const noSnapRes = runStartupMigration(badNoSnap);
  assert.equal(noSnapRes.ok, false);
  assert.equal(noSnapRes.rolledBack, false);
  assert.equal(badNoSnap.getItem(V12_KEYS.backupSnapshot), null);

  // (b) Valid array is snapshotted first, and if migration/write throws, watchlist rolls back to snapshot
  const validBeforeFail = JSON.stringify([{ id: 'CUSTOM_TLKM', ticker: 'TLKM', price: 3200, history: [] }]);
  const map = new Map([[LEGACY_KEYS.watchlist, validBeforeFail]]);
  let failOnce = true;
  const throwingStorage = {
    getItem: (k) => (map.has(k) ? map.get(k) : null),
    setItem: (k, v) => {
      if (k === LEGACY_KEYS.watchlist && failOnce) {
        failOnce = false;
        throw new Error('Simulated write failure');
      }
      map.set(k, String(v));
    },
  };
  const writeFailRes = runStartupMigration(throwingStorage);
  assert.equal(writeFailRes.ok, false);
  assert.equal(writeFailRes.rolledBack, true);
  assert.equal(throwingStorage.getItem(V12_KEYS.backupSnapshot), validBeforeFail);
  assert.equal(throwingStorage.getItem(LEGACY_KEYS.watchlist), validBeforeFail);
});

test('applyPresetOverrides never mutates PRESETS, keeps LK intact, scales marketCap proportionally, and updates sharesOverride when sharesOut provided', () => {
  const bbriOrig = PRESETS.find((p) => p.ticker === 'BBRI');
  const origShares = (bbriOrig.marketCap / bbriOrig.price) * 1000;

  const overlaid = applyPresetOverrides(PRESETS, {
    BBRI: {
      price: 4000,
      lastSyncedAt: '2026-11-25T10:42:00.000Z',
    },
    BRIS: {
      price: 3000,
      sharesOut: 62,
      lastSyncedAt: '2026-11-25T10:45:00.000Z',
    },
  });

  // Raw PRESETS unchanged -> 100% DCF parity preserved
  assert.equal(bbriOrig.price, 3100.0);
  const bbriRawDcf = computeDCF(bbriOrig);
  assert.ok(Math.abs(bbriRawDcf.iv - 5517.77) < 0.05);
  assert.ok(Math.abs(bbriRawDcf.fvFinal - 5048.83) < 0.05);

  const bbriOv = overlaid.find((p) => p.ticker === 'BBRI');
  assert.equal(bbriOv.price, 4000);
  assert.equal(bbriOv.lastSyncedAt, '2026-11-25T10:42:00.000Z');
  // LK untouched
  assert.deepEqual(bbriOv.history, bbriOrig.history);
  assert.equal(bbriOv.roe, bbriOrig.roe);
  assert.equal(bbriOv.epsTTM, bbriOrig.epsTTM);

  // Proportional marketCap preserves shares count in computeDCF
  const bbriOvDcf = computeDCF(bbriOv);
  assert.ok(Math.abs(bbriOvDcf.shares - origShares) < 0.1);
  assert.ok(Math.abs(bbriOvDcf.epsAdj - bbriRawDcf.epsAdj) < 0.01);

  // BRIS has sharesOverride: 61.0 in PRESETS; sharesOut: 62 must update sharesOverride to match marketCap
  const brisOrig = PRESETS.find((p) => p.ticker === 'BRIS');
  assert.equal(brisOrig.sharesOverride, 61.0);
  const brisOv = overlaid.find((p) => p.ticker === 'BRIS');
  assert.equal(brisOv.price, 3000);
  assert.equal(brisOv.marketCap, 186);
  assert.equal(brisOv.sharesOverride, 62);
  const brisOvDcf = computeDCF(brisOv);
  assert.equal(brisOvDcf.shares, 62);
});

test('buildBackup & parseBackup round-trip identically and strictly exclude Gemini / API keys (including nested liveSettings secrets)', () => {
  const sampleStocks = migrateStoredStocks([
    {
      id: 'CUSTOM_BBRI',
      ticker: 'BBRI',
      name: 'Bank Rakyat Indonesia',
      price: 4250,
      marketCap: 644,
      history: [{ year: 2025, sales: 190000, op: 82000, ni: 61500, inf: 1.0 }],
      roe: 0.198,
      der: 5.1,
      npm: 0.32,
      epsTTM: 405,
      bvps: 2150,
      g1: 0.08,
      g2: 0.03,
      savedAt: '2026-11-25T10:30:00.000Z',
      lkUpdatedAt: '2026-11-25T10:30:00.000Z',
    },
  ]);

  const backup = buildBackup({
    customStocks: sampleStocks,
    presetOverrides: { BBCA: { price: 9800, lastSyncedAt: '2026-11-25T10:42:00.000Z' } },
    hiddenPresetIds: ['UNVR', ''],
    favoriteIds: ['BBRI', 'bbca.jk', ''],
    uiMode: 'pro',
    theme: 'dark',
    liveSettings: {
      provider: 'hybrid',
      gasUrl: 'https://script.google.com/exec',
      autoSyncOnSelect: true,
      syncEpsBvps: false,
      geminiKey: 'AIzaSySECRET_SHOULD_NOT_EXPORT',
      apiKey: 'secret-token',
      nested: {
        apiKey: 'NESTED_SECRET_456',
        safeField: 'kept',
        deeper: {
          token: 'NESTED_TOK',
          password: 'NESTED_PW',
          secret: 'NESTED_SEC',
        },
      },
    },
    now: '2026-11-25T11:00:00.000Z',
  });

  const serialized = JSON.stringify(backup);
  assert.equal(serialized.includes('AIzaSySECRET_SHOULD_NOT_EXPORT'), false);
  assert.equal(serialized.includes('secret-token'), false);
  assert.equal(serialized.includes('geminiKey'), false);
  assert.equal(serialized.includes('apiKey'), false);
  assert.equal(serialized.includes('NESTED_SECRET_456'), false);
  assert.equal(serialized.includes('NESTED_TOK'), false);
  assert.equal(serialized.includes('NESTED_PW'), false);
  assert.equal(serialized.includes('NESTED_SEC'), false);
  assert.equal(backup.liveSettings.nested.safeField, 'kept');

  // Even if someone injects geminiKey into JSON before parseBackup, parseBackup must strip it
  const tampered = JSON.parse(serialized);
  tampered.liveSettings.geminiKey = 'AIzaSyTAMPERED';
  tampered.apiKey = 'TOPLEVEL_SECRET';

  const parsed = parseBackup(JSON.stringify(tampered));
  assert.equal(parsed.ok, true);
  assert.equal(parsed.backup.customStocks[0].ticker, 'BBRI');
  assert.equal(parsed.backup.customStocks[0].history[0].ni, 61500);
  assert.equal(parsed.backup.presetOverrides.BBCA.price, 9800);
  assert.deepEqual(parsed.backup.hiddenPresetIds, ['UNVR']);
  assert.deepEqual(parsed.backup.favoriteIds, ['BBRI', 'BBCA']);
  assert.equal(parsed.backup.uiMode, 'pro');
  assert.equal(parsed.backup.theme, 'dark');
  assert.equal('geminiKey' in parsed.backup.liveSettings, false);
  assert.equal('apiKey' in parsed.backup, false);
});

test('mergeBackup supports newest-wins merge mode, replace mode, and .JK/lowercase ticker & presetOverrides normalization', () => {
  const current = [
    { id: 'CUSTOM_BBRI', ticker: 'BBRI', price: 4000, savedAt: '2026-11-20T10:00:00.000Z', history: [] },
    { id: 'CUSTOM_BBCA', ticker: 'BBCA', price: 9500, savedAt: '2026-11-25T10:00:00.000Z', history: [] },
  ];
  const incoming = [
    { id: 'CUSTOM_BBRI', ticker: 'BBRI', price: 4300, savedAt: '2026-11-25T09:00:00.000Z', history: [] }, // newer -> update
    { id: 'CUSTOM_BBCA', ticker: 'BBCA', price: 8900, savedAt: '2026-11-21T09:00:00.000Z', history: [] }, // older -> skip
    { id: 'CUSTOM_CMRY', ticker: 'cmry.jk', price: 4500, savedAt: '2026-11-24T09:00:00.000Z', history: [] }, // new -> add & normalize
  ];

  const preview = previewBackupMerge(current, incoming);
  assert.deepEqual(preview, { totalIncoming: 3, added: 1, updated: 1, skipped: 1 });

  const merged = mergeBackup({
    currentCustomStocks: current,
    incomingCustomStocks: incoming,
    currentPresetOverrides: { 'bbca.jk': { price: 9100, lastSyncedAt: '2026-11-20T10:00:00.000Z' } },
    incomingPresetOverrides: { 'BBCA.JK': { price: 9700, lastSyncedAt: '2026-11-25T10:00:00.000Z' } },
    currentHiddenPresetIds: ['', 'UNVR'],
    incomingHiddenPresetIds: ['ASII', '  '],
    currentFavoriteIds: ['BBRI', ''],
    incomingFavoriteIds: ['cmry.jk', ''],
    mode: 'merge',
  });
  assert.equal(merged.customStocks.length, 3);
  assert.equal(merged.customStocks.find((s) => s.ticker === 'BBRI').price, 4300);
  assert.equal(merged.customStocks.find((s) => s.ticker === 'BBCA').price, 9500);
  assert.equal(merged.customStocks.find((s) => s.ticker === 'CMRY').price, 4500);
  assert.equal('bbca.jk' in merged.presetOverrides, false);
  assert.equal(merged.presetOverrides.BBCA.price, 9700);
  assert.deepEqual(merged.hiddenPresetIds, ['UNVR', 'ASII']);
  assert.deepEqual(merged.favoriteIds, ['BBRI', 'CMRY']);

  const replaced = mergeBackup({
    currentCustomStocks: current,
    incomingCustomStocks: incoming,
    incomingPresetOverrides: { 'bbca.jk': { price: 9200, lastSyncedAt: '2026-11-24T10:00:00.000Z' } },
    currentFavoriteIds: ['BBRI'],
    incomingFavoriteIds: ['cmry.jk', ''],
    incomingHiddenPresetIds: ['', 'TLKM'],
    mode: 'replace',
  });
  assert.equal(replaced.customStocks.length, 3);
  assert.equal(replaced.customStocks.find((s) => s.ticker === 'BBCA').price, 8900);
  assert.equal(replaced.customStocks.some((s) => s.ticker === 'CMRY'), true);
  assert.equal('bbca.jk' in replaced.presetOverrides, false);
  assert.equal(replaced.presetOverrides.BBCA.price, 9200);
  assert.deepEqual(replaced.hiddenPresetIds, ['TLKM']);
  assert.deepEqual(replaced.favoriteIds, ['CMRY']);
});

test('toWatchlistCsv outputs all 9 headers, escapes RFC-4180 cells, and exports empty string for missing prices', () => {
  const sample = [
    {
      ...PRESETS[0],
      ticker: 'TEST',
      name: 'PT "Maju, Jaya"\nTbk',
      savedAt: '2026-11-25T10:30:00.000Z',
    },
    {
      ...PRESETS[0],
      ticker: 'NOPRICE_NULL',
      name: 'Null Price',
      price: null,
    },
    {
      ...PRESETS[0],
      ticker: 'NOPRICE_EMPTY',
      name: 'Empty Price',
      price: '',
    },
  ];
  const csv = toWatchlistCsv(sample, computeDCF);
  assert.equal(csv.startsWith('\uFEFF'), false, 'Pure CSV helper should not prepend BOM');

  const firstNewline = csv.indexOf('\n');
  const headerLine = csv.slice(0, firstNewline);
  assert.equal(
    headerLine,
    'Ticker,Nama,Harga,Fair Value,MoS%,Grade,Return 5Y,Tahun LK,Terakhir disimpan'
  );
  assert.ok(csv.includes('"PT ""Maju, Jaya""\nTbk"'));
  assert.ok(csv.includes('2026-11-25T10:30:00.000Z'));

  const rows = csv.split('\n');
  assert.ok(rows.some((r) => r.startsWith('NOPRICE_NULL,Null Price,,')));
  assert.ok(rows.some((r) => r.startsWith('NOPRICE_EMPTY,Empty Price,,')));
});

test('runWithConcurrency enforces max concurrency <= 4 and respects AbortController', async () => {
  const items = Array.from({ length: 15 }, (_, i) => i + 1);
  let active = 0;
  let maxActive = 0;

  const res = await runWithConcurrency(items, 4, async (item) => {
    active++;
    if (active > maxActive) maxActive = active;
    await new Promise((r) => setTimeout(r, 12));
    active--;
    return item * 2;
  });

  assert.equal(res.aborted, false);
  assert.equal(res.completed, 15);
  assert.ok(maxActive <= 4, `Expected maxActive <= 4, got ${maxActive}`);
  assert.ok(maxActive >= 2, `Expected parallel execution (>=2), got ${maxActive}`);

  // Abort test
  const ac = new AbortController();
  let started = 0;
  const abortRes = await runWithConcurrency(
    items,
    4,
    async (item, _idx, { signal }) => {
      started++;
      await new Promise((resolve, reject) => {
        const t = setTimeout(resolve, 25);
        signal?.addEventListener('abort', () => {
          clearTimeout(t);
          reject(new DOMException('Aborted', 'AbortError'));
        });
      });
      if (item === 2) ac.abort();
      return item;
    },
    {
      signal: ac.signal,
      onProgress: ({ completed }) => {
        if (completed >= 2) ac.abort();
      },
    }
  );
  assert.equal(abortRes.aborted, true);
  assert.ok(started < 15, `Expected abort to prevent running all 15 tasks, ran ${started}`);
});

test('shouldRemindBackup triggers only when unbacked-up LK change and > 7 days elapsed', () => {
  const nowMs = Date.parse('2026-11-25T12:00:00.000Z');
  const stocks = [
    { ticker: 'BBRI', lkUpdatedAt: '2026-11-15T12:00:00.000Z', savedAt: '2026-11-15T12:00:00.000Z' },
  ];

  // No backup ever, LK updated 10 days ago -> remind
  const r1 = shouldRemindBackup({ customStocks: stocks, lastBackupAt: null, nowMs });
  assert.equal(r1.remind, true);
  assert.equal(r1.daysAgo, 10);

  // Backed up 2 days ago after LK update -> no remind
  const r2 = shouldRemindBackup({
    customStocks: stocks,
    lastBackupAt: '2026-11-23T12:00:00.000Z',
    nowMs,
  });
  assert.equal(r2.remind, false);

  // Backed up 9 days ago, LK updated 5 days ago -> unbacked-up changes + >7 days since backup -> remind
  const r3 = shouldRemindBackup({
    customStocks: [{ ticker: 'BBRI', lkUpdatedAt: '2026-11-20T12:00:00.000Z' }],
    lastBackupAt: '2026-11-16T12:00:00.000Z',
    nowMs,
  });
  assert.equal(r3.remind, true);
  assert.equal(r3.daysAgo, 9);

  // Backed up 9 days ago, NO LK changes since backup -> no remind
  const r4 = shouldRemindBackup({
    customStocks: [{ ticker: 'BBRI', lkUpdatedAt: '2026-11-10T12:00:00.000Z' }],
    lastBackupAt: '2026-11-16T12:00:00.000Z',
    nowMs,
  });
  assert.equal(r4.remind, false);
});

test('migrateStoredStocks drops non-object history rows and neutralizes non-numeric XSS history[].year', () => {
  const [migrated] = migrateStoredStocks([
    {
      ticker: 'xss',
      name: 'XSS Test',
      price: 1000,
      marketCap: 10,
      history: [
        null,
        'bad',
        [1, 2],
        { year: '2025', sales: 5000, op: 900, ni: 700 },
        { year: '</text></svg><img src=x onerror="window.__xssChart=1">', sales: 4000, op: 700, ni: 500 },
      ],
    },
  ]);

  assert.equal(migrated.history.length, 2);
  assert.equal(migrated.history[0].year, 2025);
  assert.equal(migrated.history[1].year, 0);

  const csv = toWatchlistCsv([{ ...PRESETS[0], ticker: 'WS', name: 'Whitespace Price', price: '   ' }], computeDCF);
  assert.ok(csv.split('\n')[1].startsWith('WS,Whitespace Price,,'));
});

