import { DEFAULT_INF, computeDCF } from '../engine/dcfEngine.js';

export const SCHEMA_VERSION = 12;

export const LEGACY_KEYS = {
  watchlist: 'dcf_lab_watchlist_v2',
  hiddenPresets: 'dcf_lab_hidden_presets_v4',
  favorites: 'dcf_lab_favorites_v4',
  theme: 'dcf_lab_theme_v2',
  uiMode: 'dcf_lab_ui_mode_v3',
  liveSettings: 'dcf_lab_live_settings_v2',
};

export const V12_KEYS = {
  presetOverrides: 'dcf_lab_preset_overrides_v1',
  schemaVersion: 'dcf_lab_schema_version',
  backupSnapshot: 'dcf_lab_backup_snapshot_v1',
  lastBackupAt: 'dcf_lab_last_backup_at_v1',
  syncMeta: 'dcf_lab_sync_meta_v1',
};

const SECRET_KEY_RE = /gemini|apikey|api_key|secret|token|password/i;

function deepClone(obj) {
  return obj === undefined ? undefined : JSON.parse(JSON.stringify(obj));
}

export function normTicker(itemOrTicker) {
  const raw = typeof itemOrTicker === 'string' ? itemOrTicker : itemOrTicker?.ticker;
  return String(raw || '').trim().toUpperCase().replace(/\.JK$/i, '');
}

function getRecordTimestamp(rec) {
  if (!rec || typeof rec !== 'object') return 0;
  const saved = Date.parse(rec.savedAt || '') || 0;
  const lk = Date.parse(rec.lkUpdatedAt || '') || 0;
  return Math.max(saved, lk);
}

export function sanitizeLiveSettings(settings) {
  const src = settings && typeof settings === 'object' && !Array.isArray(settings) ? settings : {};
  const cleaned = {
    provider: ['hybrid', 'yahoo', 'gas'].includes(src.provider) ? src.provider : 'hybrid',
    gasUrl: typeof src.gasUrl === 'string' ? src.gasUrl : '',
    autoSyncOnSelect: Boolean(src.autoSyncOnSelect),
    syncEpsBvps: Boolean(src.syncEpsBvps),
  };
  for (const [k, v] of Object.entries(src)) {
    if (SECRET_KEY_RE.test(k)) continue;
    if (!(k in cleaned)) cleaned[k] = stripSecretsDeep(deepClone(v));
  }
  return cleaned;
}

function stripSecretsDeep(obj) {
  if (!obj || typeof obj !== 'object') return obj;
  if (Array.isArray(obj)) return obj.map(stripSecretsDeep);
  const out = {};
  for (const [k, v] of Object.entries(obj)) {
    if (SECRET_KEY_RE.test(k)) continue;
    out[k] = stripSecretsDeep(v);
  }
  return out;
}

function normalizePresetOverrides(overrides) {
  const out = {};
  if (!overrides || typeof overrides !== 'object' || Array.isArray(overrides)) return out;
  for (const [k, v] of Object.entries(overrides)) {
    const t = normTicker(k);
    if (!t || !v || typeof v !== 'object' || typeof v.price !== 'number' || !(v.price > 0)) continue;
    const cur = out[t];
    const inTs = Date.parse(v.lastSyncedAt || '') || 0;
    const curTs = Date.parse(cur?.lastSyncedAt || '') || 0;
    if (!cur || inTs > curTs) {
      out[t] = {
        price: v.price,
        ...(typeof v.marketCap === 'number' && v.marketCap > 0 ? { marketCap: v.marketCap } : {}),
        ...(typeof v.sharesOut === 'number' && v.sharesOut > 0 ? { sharesOut: v.sharesOut } : {}),
        lastSyncedAt: v.lastSyncedAt || null,
      };
    }
  }
  return out;
}

/**
 * Non-destructive v2 -> v12 stock record migration.
 * Only fills missing (`=== undefined`) defaults; never overwrites 0, false, null, or user LK/history.
 */
export function migrateStoredStocks(records) {
  if (!Array.isArray(records)) return [];

  const STOCK_DEFAULTS = {
    note: '',
    sharesOverride: null,
    avgYearsLimit: 'all',
    epsBasis: 'avg',
    y1Mode: 'flat1',
    y1Mult: 1.0,
    y2Mult: null,
    optimism: 0.5,
    relMode: 'all',
    includeRel: true,
    dps: 0,
    includeDdm: false,
    ddmG1: null,
    ddmG2: null,
    includeLynch: false,
    isBankMode: false,
    ocf: null,
    fcf: null,
    savedAt: null,
    lkUpdatedAt: null,
    lastSyncedAt: null,
  };

  const out = [];
  for (const raw of records) {
    if (!raw || typeof raw !== 'object' || Array.isArray(raw)) continue;
    const copy = deepClone(raw);
    const cleanedTicker = normTicker(copy.ticker);
    if (cleanedTicker) {
      copy.ticker = cleanedTicker;
    }

    if (Array.isArray(copy.history)) {
      copy.history = copy.history
        .filter((h) => h && typeof h === 'object' && !Array.isArray(h))
        .map((h, idx) => {
          const row = { ...h };
          if (row.year !== undefined && row.year !== null) {
            const yrStr = String(row.year).trim();
            const yrNum = yrStr !== '' ? Number(yrStr) : NaN;
            row.year = Number.isFinite(yrNum) ? yrNum : 0;
          }
          if (row.inf === undefined) {
            row.inf = DEFAULT_INF[idx] ?? 1.2;
          }
          return row;
        });
    } else {
      copy.history = [];
    }

    for (const [key, defVal] of Object.entries(STOCK_DEFAULTS)) {
      if (copy[key] === undefined) {
        copy[key] = defVal;
      }
    }

    out.push(copy);
  }
  return out;
}

/**
 * Startup migration with automatic snapshot & rollback if parsing or migration fails.
 */
export function runStartupMigration(storage = globalThis?.localStorage) {
  if (!storage || typeof storage.getItem !== 'function' || typeof storage.setItem !== 'function') {
    return { ok: false, migrated: false, rolledBack: false, error: 'Storage unavailable' };
  }

  let raw = null;
  try {
    raw = storage.getItem(LEGACY_KEYS.watchlist);
  } catch (err) {
    return { ok: false, migrated: false, rolledBack: false, error: err?.message || 'Read failed' };
  }

  let prevVersion = 0;
  try {
    prevVersion = Number(storage.getItem(V12_KEYS.schemaVersion) || 0);
  } catch {}

  if (raw === null) {
    try {
      storage.setItem(V12_KEYS.schemaVersion, String(SCHEMA_VERSION));
    } catch {}
    return { ok: true, migrated: false, count: 0, rolledBack: false };
  }

  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      throw new Error('Watchlist storage is not an array');
    }

    // Only write backupSnapshot AFTER raw parses as a valid JSON array
    try {
      storage.setItem(V12_KEYS.backupSnapshot, raw);
    } catch {}

    const migrated = migrateStoredStocks(parsed);
    storage.setItem(LEGACY_KEYS.watchlist, JSON.stringify(migrated));
    storage.setItem(V12_KEYS.schemaVersion, String(SCHEMA_VERSION));
    return {
      ok: true,
      migrated: prevVersion < SCHEMA_VERSION,
      count: migrated.length,
      rolledBack: false,
    };
  } catch (err) {
    let rolledBack = false;
    try {
      const snap = storage.getItem(V12_KEYS.backupSnapshot);
      if (snap !== null) {
        const snapParsed = JSON.parse(snap);
        if (Array.isArray(snapParsed)) {
          storage.setItem(LEGACY_KEYS.watchlist, snap);
          rolledBack = true;
        }
      }
    } catch {}
    return {
      ok: false,
      migrated: false,
      rolledBack,
      error: err?.message || 'Migration failed',
    };
  }
}

/**
 * Overlay synced preset prices/marketCap without mutating PRESETS or touching preset LK fields.
 */
export function applyPresetOverrides(presets, overrides = {}) {
  if (!Array.isArray(presets)) return [];
  const ovMap = overrides && typeof overrides === 'object' ? overrides : {};

  return presets.map((p) => {
    const ticker = normTicker(p);
    const ov = ovMap[p.ticker] || ovMap[ticker];
    if (!ov || typeof ov !== 'object' || typeof ov.price !== 'number' || !(ov.price > 0)) {
      return { ...p };
    }

    const oldPrice = Number(p.price) || 0;
    const oldMcap = Number(p.marketCap) || 0;
    const baseShares =
      typeof ov.sharesOut === 'number' && ov.sharesOut > 0
        ? ov.sharesOut
        : p.sharesOverride && p.sharesOverride > 0
        ? Number(p.sharesOverride)
        : oldPrice > 0 && oldMcap > 0
        ? (oldMcap / oldPrice) * 1000
        : 0;

    let nextMcap = p.marketCap;
    if (typeof ov.marketCap === 'number' && ov.marketCap > 0) {
      nextMcap = Number(ov.marketCap.toFixed(4));
    } else if (baseShares > 0) {
      nextMcap = Number(((ov.price * baseShares) / 1000).toFixed(4));
    }

    return {
      ...p,
      price: ov.price,
      marketCap: nextMcap,
      ...(typeof ov.sharesOut === 'number' && ov.sharesOut > 0 ? { sharesOverride: ov.sharesOut } : {}),
      lastSyncedAt: ov.lastSyncedAt || null,
    };
  });
}

export function buildBackup({
  customStocks = [],
  presetOverrides = {},
  hiddenPresetIds = [],
  favoriteIds = [],
  uiMode = 'beginner',
  theme = 'light',
  liveSettings = {},
  now,
} = {}) {
  const cleanOverrides = normalizePresetOverrides(presetOverrides);

  return {
    app: 'dcf-lab',
    schemaVersion: SCHEMA_VERSION,
    exportedAt: now || new Date().toISOString(),
    customStocks: stripSecretsDeep(migrateStoredStocks(customStocks)),
    presetOverrides: cleanOverrides,
    hiddenPresetIds: Array.isArray(hiddenPresetIds)
      ? [...new Set(hiddenPresetIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
      : [],
    favoriteIds: Array.isArray(favoriteIds)
      ? [...new Set(favoriteIds.map((t) => normTicker(t)).filter(Boolean))]
      : [],
    uiMode: uiMode === 'pro' ? 'pro' : 'beginner',
    theme: theme === 'dark' ? 'dark' : 'light',
    liveSettings: sanitizeLiveSettings(liveSettings),
  };
}

export function parseBackup(input) {
  let obj = input;
  if (typeof input === 'string') {
    const trimmed = input.trim();
    if (!trimmed) return { ok: false, error: 'Isi backup kosong.' };
    try {
      obj = JSON.parse(trimmed);
    } catch {
      return { ok: false, error: 'Format JSON backup tidak valid.' };
    }
  }

  if (!obj || typeof obj !== 'object' || Array.isArray(obj)) {
    return { ok: false, error: 'Struktur backup tidak dikenali.' };
  }
  if (obj.app !== 'dcf-lab') {
    return { ok: false, error: 'File ini bukan backup resmi DCF Lab.' };
  }
  if (!Array.isArray(obj.customStocks)) {
    return { ok: false, error: 'Data saham custom tidak ditemukan di file backup.' };
  }

  const sanitized = stripSecretsDeep(obj);
  const customStocks = migrateStoredStocks(sanitized.customStocks);
  const presetOverrides = normalizePresetOverrides(sanitized.presetOverrides);

  return {
    ok: true,
    backup: {
      app: 'dcf-lab',
      schemaVersion: Number(sanitized.schemaVersion) || SCHEMA_VERSION,
      exportedAt: sanitized.exportedAt || null,
      customStocks,
      presetOverrides,
      hiddenPresetIds: Array.isArray(sanitized.hiddenPresetIds)
        ? [...new Set(sanitized.hiddenPresetIds.map((id) => String(id ?? '').trim()).filter(Boolean))]
        : [],
      favoriteIds: Array.isArray(sanitized.favoriteIds)
        ? [...new Set(sanitized.favoriteIds.map((t) => normTicker(t)).filter(Boolean))]
        : [],
      uiMode: sanitized.uiMode === 'pro' ? 'pro' : 'beginner',
      theme: sanitized.theme === 'dark' ? 'dark' : 'light',
      liveSettings: sanitizeLiveSettings(sanitized.liveSettings),
    },
  };
}

export function previewBackupMerge(currentCustomStocks = [], incomingCustomStocks = []) {
  const curMap = new Map();
  for (const s of Array.isArray(currentCustomStocks) ? currentCustomStocks : []) {
    const key = normTicker(s) || s?.id;
    if (key) curMap.set(key, s);
  }

  const incoming = Array.isArray(incomingCustomStocks) ? incomingCustomStocks : [];
  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const inc of incoming) {
    const key = normTicker(inc) || inc?.id;
    if (!key) {
      skipped++;
      continue;
    }
    const existing = curMap.get(key);
    if (!existing) {
      added++;
      curMap.set(key, inc);
      continue;
    }
    const inTs = getRecordTimestamp(inc);
    const curTs = getRecordTimestamp(existing);
    if (inTs > curTs) {
      updated++;
      curMap.set(key, inc);
    } else {
      skipped++;
    }
  }

  return {
    totalIncoming: incoming.length,
    added,
    updated,
    skipped,
  };
}

export function mergeBackup({
  currentCustomStocks = [],
  incomingCustomStocks = [],
  currentPresetOverrides = {},
  incomingPresetOverrides = {},
  currentHiddenPresetIds = [],
  incomingHiddenPresetIds = [],
  currentFavoriteIds = [],
  incomingFavoriteIds = [],
  mode = 'merge',
} = {}) {
  const incomingList = migrateStoredStocks(incomingCustomStocks);

  if (mode === 'replace') {
    return {
      customStocks: incomingList,
      presetOverrides: normalizePresetOverrides(incomingPresetOverrides),
      hiddenPresetIds: [
        ...new Set(
          (Array.isArray(incomingHiddenPresetIds) ? incomingHiddenPresetIds : [])
            .map((id) => String(id ?? '').trim())
            .filter(Boolean)
        ),
      ],
      favoriteIds: [
        ...new Set(
          (Array.isArray(incomingFavoriteIds) ? incomingFavoriteIds : [])
            .map((t) => normTicker(t))
            .filter(Boolean)
        ),
      ],
      summary: {
        totalIncoming: incomingList.length,
        added: incomingList.length,
        updated: 0,
        skipped: 0,
      },
    };
  }

  const mergedList = deepClone(Array.isArray(currentCustomStocks) ? currentCustomStocks : []);
  const indexByKey = new Map();
  mergedList.forEach((item, idx) => {
    if (item && typeof item === 'object' && !Array.isArray(item)) {
      const cleanedTicker = normTicker(item.ticker);
      if (cleanedTicker) item.ticker = cleanedTicker;
    }
    const key = normTicker(item) || item?.id;
    if (key && !indexByKey.has(key)) indexByKey.set(key, idx);
  });

  let added = 0;
  let updated = 0;
  let skipped = 0;

  for (const inc of incomingList) {
    const key = normTicker(inc) || inc?.id;
    if (!key) {
      skipped++;
      continue;
    }
    if (!indexByKey.has(key)) {
      mergedList.push(deepClone(inc));
      indexByKey.set(key, mergedList.length - 1);
      added++;
    } else {
      const idx = indexByKey.get(key);
      const existing = mergedList[idx];
      const inTs = getRecordTimestamp(inc);
      const curTs = getRecordTimestamp(existing);
      if (inTs > curTs) {
        mergedList[idx] = deepClone(inc);
        updated++;
      } else {
        skipped++;
      }
    }
  }

  const mergedOverrides = normalizePresetOverrides(currentPresetOverrides);
  if (incomingPresetOverrides && typeof incomingPresetOverrides === 'object' && !Array.isArray(incomingPresetOverrides)) {
    for (const [k, incOv] of Object.entries(incomingPresetOverrides)) {
      const t = normTicker(k);
      if (!t || !incOv || typeof incOv !== 'object' || typeof incOv.price !== 'number' || !(incOv.price > 0)) continue;
      const curOv = mergedOverrides[t];
      const inTs = Date.parse(incOv.lastSyncedAt || '') || 0;
      const curTs = Date.parse(curOv?.lastSyncedAt || '') || 0;
      if (!curOv || inTs > curTs) {
        mergedOverrides[t] = {
          price: incOv.price,
          ...(typeof incOv.marketCap === 'number' && incOv.marketCap > 0 ? { marketCap: incOv.marketCap } : {}),
          ...(typeof incOv.sharesOut === 'number' && incOv.sharesOut > 0 ? { sharesOut: incOv.sharesOut } : {}),
          lastSyncedAt: incOv.lastSyncedAt || null,
        };
      }
    }
  }

  const mergedHidden = [
    ...new Set([
      ...(Array.isArray(currentHiddenPresetIds) ? currentHiddenPresetIds.map((id) => String(id ?? '').trim()) : []),
      ...(Array.isArray(incomingHiddenPresetIds) ? incomingHiddenPresetIds.map((id) => String(id ?? '').trim()) : []),
    ].filter(Boolean)),
  ];

  const mergedFavorites = [
    ...new Set([
      ...(Array.isArray(currentFavoriteIds) ? currentFavoriteIds.map((t) => normTicker(t)) : []),
      ...(Array.isArray(incomingFavoriteIds) ? incomingFavoriteIds.map((t) => normTicker(t)) : []),
    ].filter(Boolean)),
  ];

  return {
    customStocks: mergedList,
    presetOverrides: mergedOverrides,
    hiddenPresetIds: mergedHidden,
    favoriteIds: mergedFavorites,
    summary: {
      totalIncoming: incomingList.length,
      added,
      updated,
      skipped,
    },
  };
}

export function escapeCsvCell(val) {
  const str = val === null || val === undefined ? '' : String(val);
  if (/[",\r\n]/.test(str)) {
    return '"' + str.replace(/"/g, '""') + '"';
  }
  return str;
}

export function toWatchlistCsv(stocks = [], computeFn = computeDCF) {
  const headers = [
    'Ticker',
    'Nama',
    'Harga',
    'Fair Value',
    'MoS%',
    'Grade',
    'Return 5Y',
    'Tahun LK',
    'Terakhir disimpan',
  ];

  const lines = [headers.map(escapeCsvCell).join(',')];
  for (const s of Array.isArray(stocks) ? stocks : []) {
    const res = computeFn(s);
    const hasPrice = s?.price !== null && s?.price !== undefined && String(s.price).trim() !== '';
    const price = hasPrice && Number.isFinite(Number(s.price)) ? Math.round(Number(s.price)) : '';
    const fv = Number.isFinite(res?.fvFinal) ? Math.round(res.fvFinal) : '';
    const mosPct = Number.isFinite(res?.mos) ? (res.mos * 100).toFixed(1) + '%' : '';
    const grade = res?.qualityGrade || '';
    const ret5y =
      res?.expectedReturn5Y?.totalCagr5Y !== null &&
      res?.expectedReturn5Y?.totalCagr5Y !== undefined &&
      Number.isFinite(res.expectedReturn5Y.totalCagr5Y)
        ? (res.expectedReturn5Y.totalCagr5Y * 100).toFixed(1) + '%'
        : '-';
    const dataYear = res?.dataYear ?? (s?.history?.[0]?.year ?? '');
    const savedAt = s?.savedAt || s?.lkUpdatedAt || '';

    lines.push(
      [s?.ticker || '', s?.name || '', price, fv, mosPct, grade, ret5y, dataYear, savedAt]
        .map(escapeCsvCell)
        .join(',')
    );
  }
  return lines.join('\n');
}

export async function runWithConcurrency(items, limit = 4, worker, { signal, onProgress } = {}) {
  const list = Array.isArray(items) ? items : [];
  const maxWorkers = Math.max(1, Math.min(4, Number(limit) || 4));
  const results = new Array(list.length);
  let nextIdx = 0;
  let completed = 0;
  let aborted = Boolean(signal?.aborted);

  async function runWorker() {
    while (!aborted) {
      if (signal?.aborted) {
        aborted = true;
        break;
      }
      const idx = nextIdx++;
      if (idx >= list.length) break;
      const item = list[idx];
      try {
        const value = await worker(item, idx, { signal });
        results[idx] = { status: 'fulfilled', value, item };
        completed++;
        onProgress?.({ completed, total: list.length, idx, item, ok: true, value });
      } catch (error) {
        if (error?.name === 'AbortError' || signal?.aborted) {
          aborted = true;
          results[idx] = { status: 'aborted', reason: error, item };
          break;
        }
        results[idx] = { status: 'rejected', reason: error, item };
        completed++;
        onProgress?.({ completed, total: list.length, idx, item, ok: false, error });
      }
    }
  }

  const workers = Array.from({ length: Math.min(maxWorkers, list.length) }, () => runWorker());
  await Promise.all(workers);

  return {
    aborted: aborted || Boolean(signal?.aborted),
    completed,
    total: list.length,
    results,
  };
}

export function shouldRemindBackup({ customStocks = [], lastBackupAt = null, nowMs = Date.now() } = {}) {
  const list = Array.isArray(customStocks) ? customStocks : [];
  let latestLkMs = 0;
  for (const s of list) {
    const ts = Math.max(Date.parse(s?.lkUpdatedAt || '') || 0, Date.parse(s?.savedAt || '') || 0);
    if (ts > latestLkMs) latestLkMs = ts;
  }

  if (latestLkMs <= 0) {
    return { remind: false, daysAgo: null };
  }

  const lastBackupMs = lastBackupAt ? Date.parse(lastBackupAt) || 0 : 0;
  const hasUnbackedChanges = !lastBackupMs || latestLkMs > lastBackupMs;
  if (!hasUnbackedChanges) {
    return { remind: false, daysAgo: null };
  }

  const refMs = lastBackupMs > 0 ? lastBackupMs : latestLkMs;
  const elapsedMs = Math.max(0, nowMs - refMs);
  if (elapsedMs > 7 * 86400_000) {
    return { remind: true, daysAgo: Math.floor(elapsedMs / 86400_000) };
  }
  return { remind: false, daysAgo: null };
}

export function formatBackupFilename(date = new Date()) {
  const pad = (n) => String(n).padStart(2, '0');
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `dcf-backup-${yyyy}${mm}${dd}-${hh}${min}.json`;
}

// Browser localStorage wrappers
export function loadPresetOverrides(storage = globalThis?.localStorage) {
  try {
    const raw = storage?.getItem(V12_KEYS.presetOverrides);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return {};
}

export function savePresetOverrides(overrides, storage = globalThis?.localStorage) {
  try {
    storage?.setItem(V12_KEYS.presetOverrides, JSON.stringify(overrides || {}));
  } catch {}
}

export function clearPresetOverrides(storage = globalThis?.localStorage) {
  try {
    storage?.removeItem(V12_KEYS.presetOverrides);
  } catch {}
}

export function loadSyncMeta(storage = globalThis?.localStorage) {
  try {
    const raw = storage?.getItem(V12_KEYS.syncMeta);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && typeof parsed === 'object') {
        return {
          lastSyncAllAt: parsed.lastSyncAllAt || null,
          okCount: Number(parsed.okCount) || 0,
          totalCount: Number(parsed.totalCount) || 0,
        };
      }
    }
  } catch {}
  return { lastSyncAllAt: null, okCount: 0, totalCount: 0 };
}

export function saveSyncMeta(meta, storage = globalThis?.localStorage) {
  try {
    storage?.setItem(V12_KEYS.syncMeta, JSON.stringify(meta || {}));
  } catch {}
}

export function loadLastBackupAt(storage = globalThis?.localStorage) {
  try {
    return storage?.getItem(V12_KEYS.lastBackupAt) || null;
  } catch {
    return null;
  }
}

export function saveLastBackupAt(iso, storage = globalThis?.localStorage) {
  try {
    if (iso) storage?.setItem(V12_KEYS.lastBackupAt, String(iso));
  } catch {}
}
