import { BETA_SCALE, DEFAULT_INF, computeDCF, compareStocks, getStatBadge } from '../engine/dcfEngine.js';
import { PRESETS } from '../data/presets15.js';
import { renderTickerLogoHtml } from '../data/tickerLogos.js';
import { fetchLiveQuote, loadLiveSettings, saveLiveSettings } from '../services/marketApi.js';
import { smartExtractFinancials, loadLocalGeminiKey, saveLocalGeminiKey } from '../services/smartParser.js';
import { explainValuationAI } from '../services/aiAdvisor.js';
import {
  LEGACY_KEYS,
  normTicker,
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
  formatBackupFilename,
  loadPresetOverrides,
  savePresetOverrides,
  clearPresetOverrides,
  loadSyncMeta,
  saveSyncMeta,
  loadLastBackupAt,
  saveLastBackupAt,
} from '../services/storage.js';
import { renderShareCardCanvas, buildPrintReportHtml } from './reportCard.js';
import { renderQualityRing, renderPriceGauge, renderBetaChart, renderDcfChart, renderHistoryChart } from './charts.js';

const STORAGE_KEY = LEGACY_KEYS.watchlist;
const HIDDEN_PRESETS_KEY = LEGACY_KEYS.hiddenPresets;
const FAVORITES_KEY = LEGACY_KEYS.favorites;
const THEME_KEY = LEGACY_KEYS.theme;
const MODE_KEY = LEGACY_KEYS.uiMode;
const clone = (o) => JSON.parse(JSON.stringify(o));

// Pillar D: Snapshot & non-destructive schema migration BEFORE loading customStocks or state
runStartupMigration();

let isPersistentStorage = null;
if (typeof navigator !== 'undefined' && navigator.storage?.persist) {
  navigator.storage
    .persist()
    .then((granted) => {
      isPersistentStorage = granted;
      updateWatchlistMetaUi();
    })
    .catch(() => {});
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

const fmtRp = (v) => (isFinite(v) ? 'Rp ' + Math.round(v).toLocaleString('id-ID') : '-');
const fmtNum = (v, d = 2) =>
  isFinite(v)
    ? Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '-';
const fmtPct = (v, d = 1) => (isFinite(v) ? (v * 100).toFixed(d) + '%' : '-');

function fmtTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

function fmtDateTimeShort(iso) {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];
  return `${d.getDate()} ${months[d.getMonth()]} ${fmtTimeShort(iso)}`;
}

function loadJsonList(key) {
  try {
    const raw = localStorage.getItem(key);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (Array.isArray(parsed)) return parsed;
    }
  } catch {}
  return [];
}

function saveJsonList(key, list) {
  try {
    localStorage.setItem(key, JSON.stringify(list));
  } catch {}
}

const loadWatchlist = () => loadJsonList(STORAGE_KEY);
const saveWatchlist = (list) => saveJsonList(STORAGE_KEY, list);

let customStocks = loadWatchlist();
let hiddenPresetIds = loadJsonList(HIDDEN_PRESETS_KEY);
let favoriteIds = loadJsonList(FAVORITES_KEY);
let presetOverrides = loadPresetOverrides();
let syncMeta = loadSyncMeta();
let lastBackupAt = loadLastBackupAt();
let watchlistFilter = 'all';
let compareIds = ['BBRI', 'BBCA', 'CMRY'];

let batchSyncAbortController = null;
let rowSyncStatus = {};

function getEffectivePresets() {
  return applyPresetOverrides(PRESETS, presetOverrides);
}

function getAllStocksBoot() {
  const customTickers = new Set(customStocks.map((c) => normTicker(c.ticker)).filter(Boolean));
  return [
    ...customStocks.map((c) => ({ ...c, isCustom: true })),
    ...getEffectivePresets()
      .filter((p) => !hiddenPresetIds.includes(p.id) && !customTickers.has(normTicker(p.ticker)))
      .map((p) => ({ ...p, isCustom: false })),
  ];
}

const initialPool = getAllStocksBoot();
let state = clone(initialPool[0] || PRESETS[0]);
let liveMeta = state.lastSyncedAt
  ? { status: 'live', label: `Live ${fmtTimeShort(state.lastSyncedAt)}` }
  : { status: 'preset', label: state.isCustom ? 'Watchlist' : 'Preset' };
let activeStep = 'step3';
let activeOutTab = 'overview';
let projZoom = 30;
let customBuyMos = 0.35;
let lastExplainTicker = '';

// =========================================================================
// THEME, UI MODE (PEMULA/PRO) & TOAST
// =========================================================================
function applyTheme(theme) {
  document.documentElement.classList.toggle('dark', theme === 'dark');
  const metaTheme = document.getElementById('metaThemeColor');
  if (metaTheme) {
    metaTheme.setAttribute('content', theme === 'dark' ? '#0b1120' : '#f8fafc');
  }
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {}
}

const savedTheme = (() => {
  try {
    return localStorage.getItem(THEME_KEY) || 'light';
  } catch {
    return 'light';
  }
})();
applyTheme(savedTheme);

function applyUiMode(mode) {
  const m = mode === 'pro' ? 'pro' : 'beginner';
  document.body.classList.toggle('mode-beginner', m === 'beginner');
  document.querySelectorAll('.mode-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.mode === m);
  });
  try {
    localStorage.setItem(MODE_KEY, m);
  } catch {}
}

const savedMode = (() => {
  try {
    return localStorage.getItem(MODE_KEY) || 'beginner';
  } catch {
    return 'beginner';
  }
})();
applyUiMode(savedMode);

function showToast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.remove('hidden');
  clearTimeout(window.__toastTimer);
  window.__toastTimer = setTimeout(() => el.classList.add('hidden'), 2600);
}

// =========================================================================
// LIVE MARKET SYNC (HYBRID: YAHOO .JK / GOOGLEFINANCE BRIDGE)
// =========================================================================
function updateLiveBadge() {
  const dot = document.getElementById('liveDot');
  const priceEl = document.getElementById('livePriceText');
  const srcEl = document.getElementById('liveSourceText');
  const icon = document.getElementById('refreshIcon');

  priceEl.textContent = fmtRp(state.price);
  srcEl.textContent = liveMeta.label;
  dot.className = 'live-dot';
  icon.classList.remove('spin');

  if (liveMeta.status === 'loading') {
    dot.classList.add('loading');
    icon.classList.add('spin');
  } else if (liveMeta.status === 'offline' || liveMeta.status === 'manual') {
    dot.classList.add('offline');
  }
}

function applyQuoteToState(q, settings) {
  const oldPrice = Number(state.price) || 0;
  const oldMcap = Number(state.marketCap) || 0;
  const oldShares =
    state.sharesOverride && state.sharesOverride > 0
      ? Number(state.sharesOverride)
      : oldPrice > 0
      ? (oldMcap / oldPrice) * 1000
      : 0;

  if (typeof q.price === 'number' && q.price > 0) {
    state.price = q.price;
  }

  if (typeof q.marketCapTrillion === 'number' && q.marketCapTrillion > 0) {
    state.marketCap = Number(q.marketCapTrillion.toFixed(4));
  } else if (oldShares > 0 && state.price > 0) {
    // Proportional market cap update when chart fallback returns price only
    state.marketCap = Number(((state.price * oldShares) / 1000).toFixed(4));
  }

  if (q.name && (state.name === 'Emiten Baru' || !state.sheet)) {
    state.name = q.name;
  }

  if (settings.syncEpsBvps) {
    if (typeof q.epsTTM === 'number' && q.epsTTM > 0) state.epsTTM = Number(q.epsTTM.toFixed(2));
    if (typeof q.bvps === 'number' && q.bvps > 0) state.bvps = Number(q.bvps.toFixed(2));
    if (typeof q.dividendPerShare === 'number' && q.dividendPerShare >= 0) {
      state.dps = Number(q.dividendPerShare.toFixed(2));
    }
  }

  const srcLabel = q.source === 'google-finance' ? 'Live Google' : 'Live IDX';
  liveMeta = { status: 'live', label: q.cached ? `${srcLabel} (Cache)` : srcLabel };
}

async function syncLiveTicker(force = true) {
  const ticker = (state.ticker || '').trim().toUpperCase();
  if (!ticker) return;
  liveMeta = { status: 'loading', label: 'Mengambil...' };
  updateLiveBadge();

  try {
    const settings = loadLiveSettings();
    const quote = await fetchLiveQuote(ticker, { force });
    applyQuoteToState(quote, settings);
    syncInputsFromState();
    renderAll();
    showToast(`${ticker}: ${fmtRp(state.price)} (${liveMeta.label})`);
  } catch (err) {
    liveMeta = { status: 'offline', label: 'Offline/Manual' };
    updateLiveBadge();
    showToast(`Live ${ticker} belum tersedia: ${err.message}`);
  }
}

// =========================================================================
// SEARCHABLE STOCK PICKER
// =========================================================================
function getAllStocks() {
  return getAllStocksBoot();
}

function renderPickerList(query = '') {
  const listEl = document.getElementById('pickerList');
  const q = query.trim().toLowerCase();
  const items = getAllStocks().filter(
    (s) => s.ticker.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
  );

  const CUSTOM_STOCK_ICON =
    '<span class="custom-stock-icon" title="Data simpanan pribadi" aria-label="Data simpanan pribadi"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M3.5 1.5A1.5 1.5 0 0 1 5 0h6a1.5 1.5 0 0 1 1.5 1.5v13.8a.5.5 0 0 1-.78.41L8 13.1l-3.72 2.61a.5.5 0 0 1-.78-.41V1.5Z"/></svg></span>';

  let html = items
    .map((s) => {
      const active = s.id === state.id ? 'active' : '';
      const yr = s.history?.[0]?.year || '-';
      return `
        <button type="button" class="picker-item ${active}" data-pickid="${escHtml(s.id)}" data-iscustom="${Boolean(s.isCustom)}">
          <div class="ticker-cell">
            ${renderTickerLogoHtml(s.ticker, 24)}
            <div>
              <strong>${escHtml(s.ticker)}</strong>${s.isCustom ? CUSTOM_STOCK_ICON : ''}
              <span class="picker-item-sub">(${escHtml(yr)}) &middot; ${escHtml(s.name)}</span>
            </div>
          </div>
          <span class="picker-item-sub tabular-nums">${fmtRp(s.price)}</span>
        </button>`;
    })
    .join('');

  if (q && !items.some((s) => s.ticker.toLowerCase() === q)) {
    const cleanNew = q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (cleanNew.length >= 2) {
      html += `
        <button type="button" class="picker-item" data-newticker="${escHtml(cleanNew)}">
          <div><strong>+ Analisa Ticker Baru: ${escHtml(cleanNew)}</strong></div>
          <span class="picker-item-sub">Buat &amp; Sync Live</span>
        </button>`;
    }
  }

  listEl.innerHTML = html || `<div class="picker-item-sub" style="padding:10px">Tidak ada hasil.</div>`;
}

function createBlankStock(ticker = 'NEW') {
  const yr = new Date().getFullYear();
  return {
    id: 'CUSTOM_' + Date.now(),
    ticker: ticker.toUpperCase(),
    name: ticker === 'NEW' ? 'Emiten Baru' : ticker.toUpperCase(),
    note: '',
    price: 1000,
    marketCap: 10,
    sharesOverride: null,
    history: [
      { year: yr - 1, sales: 5000, op: 800, ni: 600, inf: 1.0 },
      { year: yr - 2, sales: 4500, op: 700, ni: 520, inf: 1.0272 },
      { year: yr - 3, sales: 4100, op: 640, ni: 470, inf: 1.0593 },
      { year: yr - 4, sales: 3700, op: 550, ni: 400, inf: 1.0975 },
    ],
    avgYearsLimit: 'all',
    roe: 0.15,
    der: 0.4,
    npm: 0.12,
    betaAdj: 0.0,
    rf: 0.07,
    rm: 0.12,
    g1: 0.08,
    g2: 0.02,
    epsTTM: 60,
    bvps: 400,
    epsBasis: 'avg',
    y1Mode: 'flat1',
    y1Mult: 1.0,
    y2Mult: 1.0,
    pe3: 15,
    pe5: 16,
    pe10: 17,
    pbv3: 2.0,
    pbv5: 2.2,
    pbv10: 2.4,
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
  };
}

// =========================================================================
// SYNC STATE <-> DOM
// =========================================================================
function syncInputsFromState() {
  document.getElementById('pillLogo').innerHTML = renderTickerLogoHtml(state.ticker || 'NEW', 22);
  document.getElementById('pillTicker').textContent = state.ticker || 'NEW';
  document.getElementById('pillName').textContent = state.name || '';
  document.getElementById('inpTicker').value = state.ticker || '';
  document.getElementById('inpName').value = state.name || '';
  document.getElementById('inpNote').value = state.note || '';
  document.getElementById('inpPrice').value = state.price;
  document.getElementById('inpMcap').value = state.marketCap;

  const isManualShares = state.sharesOverride !== null && state.sharesOverride !== undefined;
  document.getElementById('chkSharesManual').checked = isManualShares;
  const inpShares = document.getElementById('inpShares');
  inpShares.disabled = !isManualShares;
  const calcShares = state.price > 0 ? (state.marketCap / state.price) * 1000 : 0;
  inpShares.value = isManualShares ? state.sharesOverride : Number(calcShares.toFixed(4));

  document.getElementById('selAvgYears').value = String(state.avgYearsLimit || 'all');
  document.getElementById('inpRoe').value = Number((state.roe * 100).toFixed(2));
  document.getElementById('inpDer').value = state.der;
  document.getElementById('inpNpm').value = Number((state.npm * 100).toFixed(2));
  document.getElementById('inpEpsTtm').value = state.epsTTM;
  document.getElementById('inpBvps').value = state.bvps;
  document.getElementById('chkBankMode').checked = !!state.isBankMode;
  document.getElementById('inpOcf').value = state.ocf !== null && state.ocf !== undefined ? state.ocf : '';
  document.getElementById('inpFcf').value = state.fcf !== null && state.fcf !== undefined ? state.fcf : '';

  document.getElementById('inpG1').value = Number((state.g1 * 100).toFixed(1));
  document.getElementById('rngG1').value = Number((state.g1 * 100).toFixed(1));
  document.getElementById('inpG2').value = Number((state.g2 * 100).toFixed(1));
  document.getElementById('rngG2').value = Number((state.g2 * 100).toFixed(1));
  document.getElementById('inpBetaAdj').value = Number((state.betaAdj || 0).toFixed(2));
  document.getElementById('rngBetaAdj').value = Number((state.betaAdj || 0).toFixed(2));
  document.getElementById('inpRf').value = Number((state.rf * 100).toFixed(2));
  document.getElementById('inpRm').value = Number((state.rm * 100).toFixed(2));

  document.getElementById('selEpsBasis').value = state.epsBasis || 'avg';
  document.getElementById('selY1Mode').value = state.y1Mode || 'normal';
  document.getElementById('inpY1Mult').value = state.y1Mult ?? 0.75;
  document.getElementById('inpY2Mult').value = state.y2Mult ?? 1.0;
  document.getElementById('recoveryBox').classList.toggle('hidden', state.y1Mode !== 'recovery');

  document.getElementById('chkIncludeRel').checked = !!state.includeRel;
  document.getElementById('rngOptimism').value = state.optimism ?? 0.5;
  document.getElementById('dispOptimism').textContent = `${Number(state.optimism ?? 0.5).toFixed(2)} (${Math.round((state.optimism ?? 0.5) * 100)}%)`;
  document.getElementById('selRelMode').value = state.relMode || 'all';
  document.getElementById('inpPe3').value = state.pe3;
  document.getElementById('inpPe5').value = state.pe5;
  document.getElementById('inpPe10').value = state.pe10;
  document.getElementById('inpPbv3').value = state.pbv3;
  document.getElementById('inpPbv5').value = state.pbv5;
  document.getElementById('inpPbv10').value = state.pbv10;

  document.getElementById('chkIncludeDdm').checked = !!state.includeDdm;
  document.getElementById('inpDps').value = state.dps ?? 0;
  document.getElementById('inpDdmG1').value =
    state.ddmG1 !== null && state.ddmG1 !== undefined ? Number((state.ddmG1 * 100).toFixed(1)) : '';
  document.getElementById('inpDdmG2').value =
    state.ddmG2 !== null && state.ddmG2 !== undefined ? Number((state.ddmG2 * 100).toFixed(1)) : '';
  document.getElementById('chkIncludeLynch').checked = !!state.includeLynch;

  renderHistoryTable();
  updateLiveBadge();
}

function renderHistoryTable() {
  const tbody = document.getElementById('historyTbody');
  tbody.innerHTML = state.history
    .map((row, idx) => {
      const opm = row.sales > 0 ? (row.op / row.sales) * 100 : 0;
      return `
        <tr>
          <td><input data-hidx="${idx}" data-field="year" type="number" value="${escHtml(row.year)}" style="width:66px" class="tabular-nums" /></td>
          <td class="num"><input data-hidx="${idx}" data-field="sales" type="number" step="any" value="${escHtml(row.sales)}" style="width:92px;text-align:right" class="tabular-nums" /></td>
          <td class="num"><input data-hidx="${idx}" data-field="op" type="number" step="any" value="${escHtml(row.op)}" style="width:86px;text-align:right" class="tabular-nums" /></td>
          <td class="num"><input data-hidx="${idx}" data-field="ni" type="number" step="any" value="${escHtml(row.ni)}" style="width:86px;text-align:right" class="tabular-nums" /></td>
          <td class="num pro-only"><input data-hidx="${idx}" data-field="inf" type="number" step="0.001" value="${Number(row.inf).toFixed(4)}" style="width:78px;text-align:right" class="tabular-nums" /></td>
          <td class="num text-muted tabular-nums font-semibold">${opm.toFixed(1)}%</td>
        </tr>`;
    })
    .join('');
}

function setMiniBadge(id, badge) {
  const el = document.getElementById(id);
  if (!el) return;
  el.textContent = badge.text;
  el.className = `mini-badge ${badge.tone}`;
}

// =========================================================================
// RENDER ALL OUTPUTS
// =========================================================================
function renderAll() {
  const res = computeDCF(state);
  updateLiveBadge();

  document.getElementById('pillLogo').innerHTML = renderTickerLogoHtml(state.ticker || 'NEW', 22);
  document.getElementById('pillTicker').textContent = state.ticker || 'NEW';
  document.getElementById('pillName').textContent = state.name || '';

  if (state.sharesOverride === null || state.sharesOverride === undefined) {
    document.getElementById('inpShares').value = Number(res.shares.toFixed(4));
  }
  document.getElementById('metaEpsBase').textContent = fmtRp(res.epsBase);
  document.getElementById('dispEpsAdj').textContent = fmtRp(res.epsAdj);

  // Stale Data Warning Banner
  const staleEl = document.getElementById('staleBanner');
  if (res.isStaleData) {
    staleEl.classList.remove('hidden');
    document.getElementById('staleBannerText').textContent =
      `Perhatian: Data laporan keuangan ${state.ticker} masih sampai tahun ${res.dataYear}. Perbarui agar valuasi akurat.`;
  } else {
    staleEl.classList.add('hidden');
  }

  // Historical stats + friendly badges
  document.getElementById('statNiAvg').textContent = fmtNum(res.avgNiAdj, 0) + ' M';
  document.getElementById('statR').textContent = res.predictR.toFixed(3);
  document.getElementById('statCov').textContent = fmtPct(res.covOpm, 2);
  document.getElementById('statAvgOpm').textContent = fmtPct(res.avgOpm, 1);
  document.getElementById('statStdOpm').textContent = fmtPct(res.stdOpm, 2);
  document.getElementById('statCagr').textContent = res.cagr !== null ? fmtPct(res.cagr, 1) : '-';

  setMiniBadge('badgeR', getStatBadge('r', res.predictR));
  setMiniBadge('badgeCov', getStatBadge('cov', res.covOpm));
  setMiniBadge('badgeCagr', getStatBadge('cagr', res.cagr));
  setMiniBadge('badgeRoe', getStatBadge('roe', state.roe));
  setMiniBadge('badgeDer', getStatBadge('der', state.der, { isBankMode: state.isBankMode }));
  setMiniBadge('badgeNpm', getStatBadge('npm', state.npm));

  // DuPont ROE Step 2 mini strip
  const dupEl = document.getElementById('dupontStep2Strip');
  if (dupEl) {
    dupEl.innerHTML = `
      <div class="label-row">
        <span class="text-xs font-semibold">Bedah DuPont ROE</span>
        <span class="mini-badge ${res.dupont.driver.tone}">${res.dupont.driver.label}</span>
      </div>
      <div class="text-xs text-muted tabular-nums mt-1">ROA Implied: <strong>${fmtPct(res.dupont.roaImplied, 2)}</strong> &middot; Equity Mult: <strong>${res.dupont.equityMultiplier.toFixed(2)}x</strong></div>
    `;
  }

  // Cash conversion badge Step 2
  const cashBadge = document.getElementById('dispCashConvBadge');
  if (cashBadge) {
    const conv = res.cashQuality.ocfConversion ?? res.cashQuality.fcfConversion;
    cashBadge.textContent = conv !== null ? `${(conv * 100).toFixed(0)}% (${res.cashQuality.status.label})` : 'Opsional';
    cashBadge.className = `mini-badge ${res.cashQuality.status.tone}`;
  }

  // Patokan CAGR + 4-Way Growth Check di Step 2
  const cagrPct = res.cagr !== null ? (res.cagr * 100).toFixed(1) + '%' : 'N/A';
  const recCons = res.cagr !== null ? Math.max(3, Math.min(10, Math.round(res.cagr * 50))) : 5;
  document.getElementById('cagrGuideText').innerHTML =
    `CAGR laba historis: <strong>${cagrPct}</strong> &mdash; patokan aman value investor biasanya sekitar <strong>${recCons}%–12%</strong>.`;

  const sanityEl = document.getElementById('step2GrowthSanity');
  if (sanityEl) {
    const impText = res.impliedG1 !== null ? fmtPct(res.impliedG1, 1) : '-';
    sanityEl.innerHTML = `
      <div class="sanity-chips tabular-nums">
        <span>Implied Pasar: <strong>${impText}</strong></span>
        <span>SGR Organik: <strong>${fmtPct(res.sgr, 1)}</strong></span>
      </div>
      <div class="sanity-note ${res.growthSignal.tone}"><strong>${res.growthSignal.label}:</strong> ${res.growthSignal.desc}</div>
    `;
  }

  // History Chart in Step 1
  renderHistoryChart(document.getElementById('step1HistoryChart'), { history: state.history });

  // Relative sub-lists
  document.getElementById('relPeList').innerHTML = res.peItems
    .map((x) => `<div><span>${x.label}</span><span>${x.val > 0 ? fmtRp(x.val) : '-'}</span></div>`)
    .join('');
  document.getElementById('relPbvList').innerHTML = res.pbvItems
    .map((x) => `<div><span>${x.label}</span><span>${x.val > 0 ? fmtRp(x.val) : '-'}</span></div>`)
    .join('');

  // Step 2 DDM & Peter Lynch live stats
  document.getElementById('dispDivYield').textContent = fmtPct(res.divYield, 2);
  document.getElementById('dispPayoutRatio').textContent = res.payoutRatio > 0 ? fmtPct(res.payoutRatio, 1) : '-';

  const pegyEl = document.getElementById('dispLynchPegy');
  pegyEl.textContent = res.pegy > 0 ? `${res.pegy.toFixed(2)}x` : '-';
  pegyEl.style.color =
    res.pegy > 0
      ? res.pegy < 1
        ? 'var(--emerald)'
        : res.pegy <= 1.5
        ? 'var(--amber)'
        : 'var(--rose)'
      : 'var(--text-muted)';
  const catEl = document.getElementById('dispLynchCat');
  catEl.textContent = res.lynchCategory.label;
  catEl.style.color =
    res.lynchCategory.tone === 'emerald'
      ? 'var(--emerald)'
      : res.lynchCategory.tone === 'amber'
      ? 'var(--amber)'
      : 'var(--text-muted)';
  document.getElementById('dispLynchVal').textContent = res.lynchValue > 0 ? fmtRp(res.lynchValue) : '-';

  // Sync Hero Mini Summary Bar (used when collapsed on mobile Step 1/2/Watchlist)
  const miniGrade = document.getElementById('heroMiniGrade');
  if (miniGrade) {
    miniGrade.textContent = `Grade ${res.qualityGrade}`;
    miniGrade.className = `mini-badge ${
      res.qualityGrade === 'A' || res.qualityGrade === 'B' ? 'emerald' : res.qualityGrade === 'C' ? 'amber' : 'rose'
    }`;
    document.getElementById('heroMiniTicker').textContent = state.ticker || 'NEW';
    document.getElementById('heroMiniFv').textContent = fmtRp(res.fvFinal);
    const miniMos = document.getElementById('heroMiniMos');
    miniMos.textContent = `MoS ${fmtPct(res.mos, 1)}`;
    miniMos.style.color = res.mos >= 0.3 ? 'var(--emerald)' : res.mos >= 0 ? 'var(--amber)' : 'var(--rose)';
  }

  // HERO VALUATION VERDICT (2-SIDED: QUALITY RING + VALUATION)
  renderQualityRing(document.getElementById('heroQualityRing'), {
    score: res.qualityScore,
    grade: res.qualityGrade,
  });
  document.getElementById('kpiQualityLabel').textContent = res.qualityLabel;

  const activeNames = ['DCF'];
  const subParts = [`DCF: ${fmtRp(res.iv)}`];
  if (state.includeRel && res.rv > 0) {
    activeNames.push('Relative');
    subParts.push(`Relative: ${fmtRp(res.rv)}`);
  }
  if (state.includeDdm && res.ddmValue > 0) {
    activeNames.push('DDM');
    subParts.push(`DDM: ${fmtRp(res.ddmValue)}`);
  }
  if (state.includeLynch && res.lynchValue > 0) {
    activeNames.push('Lynch');
    subParts.push(`Lynch: ${fmtRp(res.lynchValue)}`);
  }
  document.getElementById('heroMethodHint').textContent =
    activeNames.length > 1 ? activeNames.join(' + ') : 'Intrinsic Only';
  document.getElementById('kpiFV').textContent = fmtRp(res.fvFinal);
  document.getElementById('kpiFVSub').textContent =
    subParts.length > 1
      ? subParts.join(' · ')
      : `Intrinsic DCF 100Y (Implied P/E ${res.impliedPe.toFixed(1)}x)`;

  const mosEl = document.getElementById('kpiMoS');
  mosEl.textContent = fmtPct(res.mos, 1);
  mosEl.style.color = res.mos >= 0.3 ? 'var(--emerald)' : res.mos >= 0 ? 'var(--amber)' : 'var(--rose)';

  const pill = document.getElementById('kpiStatusPill');
  if (res.mos >= 0.3) {
    pill.textContent = 'UNDERVALUED';
    pill.style.background = 'var(--emerald-soft)';
    pill.style.color = 'var(--emerald)';
  } else if (res.mos >= 0) {
    pill.textContent = 'FAIR VALUE';
    pill.style.background = 'var(--amber-soft)';
    pill.style.color = 'var(--amber)';
  } else {
    pill.textContent = 'OVERVALUED';
    pill.style.background = 'var(--rose-soft)';
    pill.style.color = 'var(--rose)';
  }

  document.getElementById('kpiDRSub').textContent = `Beta Final: ${res.betaFinal.toFixed(2)} · Discount Rate: ${(res.dr * 100).toFixed(2)}%`;

  const p = Number(state.price) || 0;
  const upside = p > 0 ? ((res.fvFinal - p) / p) * 100 : 0;
  const upEl = document.getElementById('upsideLabel');
  upEl.textContent = upside >= 0 ? `+${upside.toFixed(1)}% Upside` : `${upside.toFixed(1)}% Premium`;
  upEl.style.color = upside >= 30 ? 'var(--emerald)' : upside >= 0 ? 'var(--amber)' : 'var(--rose)';

  const fv = Math.max(1, res.fvFinal);
  const ratio = Math.min(100, Math.max(4, (p / (fv * 1.2)) * 100));
  const fvMark = Math.min(95, Math.max(10, (fv / (fv * 1.2)) * 100));
  document.getElementById('heroGaugeBar').innerHTML = `
    <div style="position:relative;height:10px;border-radius:999px;background:var(--surface-subtle);overflow:visible;margin:6px 0 4px">
      <div style="width:${ratio}%;height:100%;border-radius:999px;background:${res.mos >= 0.3 ? 'var(--emerald)' : res.mos >= 0 ? 'var(--amber)' : 'var(--rose)'}"></div>
      <div title="Fair Value" style="position:absolute;left:${fvMark}%;top:-3px;width:2px;height:16px;background:var(--text)"></div>
    </div>
    <div style="display:flex;justify-content:space-between;font-size:11px;color:var(--text-muted)" class="tabular-nums">
      <span>Pasar: ${fmtRp(p)}</span>
      <span>Wajar: ${fmtRp(fv)}</span>
    </div>
  `;

  document.getElementById('heroBuyPills').innerHTML = [0.5, 0.4, 0.3]
    .map((m) => `<span class="buy-pill">MoS ${(m * 100).toFixed(0)}%: ${fmtRp(fv * (1 - m))}</span>`)
    .join('');

  // Anti-Value-Trap Verdict Strip
  const vStrip = document.getElementById('heroVerdictStrip');
  const vBg =
    res.verdict.tone === 'emerald'
      ? 'var(--emerald-soft)'
      : res.verdict.tone === 'amber'
      ? 'var(--amber-soft)'
      : 'var(--rose-soft)';
  const vCol =
    res.verdict.tone === 'emerald'
      ? 'var(--emerald)'
      : res.verdict.tone === 'amber'
      ? 'var(--amber)'
      : 'var(--rose)';
  vStrip.style.background = vBg;
  vStrip.style.borderColor = vCol;
  const vTitleEl = document.getElementById('heroVerdictTitle');
  vTitleEl.textContent = res.verdict.title;
  vTitleEl.style.color = vCol;
  document.getElementById('heroVerdictDesc').textContent = res.verdict.desc;

  // Hide old AI explanation when switching ticker
  if (lastExplainTicker !== state.ticker) {
    document.getElementById('aiExplainBox').classList.add('hidden');
  }

  // Render Step 3 & Watchlist details
  renderOverviewOut(res);
  renderBetaOut(res);
  renderProjectionOut(res);
  renderMatrixOut(res);
  renderCompareOut();
  renderWatchlistOut();
}

function renderOverviewOut(res) {
  // 5-Card Multi-Method Comparison Strip
  const relActive = !!(state.includeRel && res.rv > 0);
  const ddmActive = !!(state.includeDdm && res.ddmValue > 0);
  const lynchActive = !!(state.includeLynch && res.lynchValue > 0);
  const gColor =
    res.grahamNumber > 0
      ? res.grahamMos >= 0
        ? 'var(--emerald)'
        : 'var(--amber)'
      : 'var(--text-muted)';
  const lynchColor =
    res.lynchValue > 0
      ? res.pegy > 0 && res.pegy < 1
        ? 'var(--emerald)'
        : res.pegy <= 1.5
        ? 'var(--amber)'
        : 'var(--rose)'
      : 'var(--text-muted)';

  document.getElementById('multiMethodStrip').innerHTML = `
    <div class="method-card is-active">
      <div class="method-top">
        <span class="method-name">DCF 100Y</span>
        <span class="mini-badge emerald">Aktif</span>
      </div>
      <div class="method-val tabular-nums">${fmtRp(res.iv)}</div>
      <div class="method-sub tabular-nums">Implied P/E ${res.impliedPe.toFixed(1)}x &middot; DR ${(res.dr * 100).toFixed(2)}%</div>
    </div>

    <div class="method-card ${relActive ? 'is-active' : ''}">
      <div class="method-top">
        <span class="method-name">Relative PE/PBV</span>
        <span class="mini-badge ${relActive ? 'emerald' : 'muted'}">${relActive ? 'Aktif' : 'Pembanding'}</span>
      </div>
      <div class="method-val tabular-nums">${res.rv > 0 ? fmtRp(res.rv) : '-'}</div>
      <div class="method-sub tabular-nums">Optimisme ${Math.round((state.optimism ?? 0.5) * 100)}% (${escHtml((state.relMode || 'all').toUpperCase())})</div>
    </div>

    <div class="method-card ${ddmActive ? 'is-active' : ''}">
      <div class="method-top">
        <span class="method-name">2-Stage DDM</span>
        <span class="mini-badge ${ddmActive ? 'emerald' : 'muted'}">${ddmActive ? 'Aktif' : 'Pembanding'}</span>
      </div>
      <div class="method-val tabular-nums">${res.ddmValue > 0 ? fmtRp(res.ddmValue) : '-'}</div>
      <div class="method-sub tabular-nums">${res.dps > 0 ? `DPS ${fmtRp(res.dps)} &middot; Yield ${fmtPct(res.divYield, 1)}` : 'Isi DPS di Step 2'}</div>
    </div>

    <div class="method-card ${lynchActive ? 'is-active' : ''}" title="Peter Lynch Fair Value = EPS × (min(25, Growth%) + Yield%). PEGY < 1.0 berarti murah.">
      <div class="method-top">
        <span class="method-name">Peter Lynch <span class="tip" title="Rumus GARP Peter Lynch: EPS × (Growth g1% [cap 25%] + Div Yield%). PEGY < 1.0 = Murah, 1.0 = Wajar, > 1.5 = Mahal.">?</span></span>
        <span class="mini-badge ${lynchActive ? 'emerald' : res.lynchCategory.tone}">${lynchActive ? 'Aktif' : res.lynchCategory.label}</span>
      </div>
      <div class="method-val tabular-nums" style="color:${lynchColor}">${res.lynchValue > 0 ? fmtRp(res.lynchValue) : '-'}</div>
      <div class="method-sub tabular-nums">${res.pegy > 0 ? `PEGY ${res.pegy.toFixed(2)}x &middot; ${res.lynchCategory.label}` : 'Butuh EPS & Growth > 0'}</div>
    </div>

    <div class="method-card is-ref" title="Graham Number = √(22.5 × EPS × BVPS). Batas atas harga wajar ala Benjamin Graham (P/E ≤ 15 & PBV ≤ 1.5), hanya sebagai pembanding.">
      <div class="method-top">
        <span class="method-name">Graham Number <span class="tip" title="Rumus konservatif Benjamin Graham: √(22.5 × EPS × BVPS). Mengasumsikan batas P/E ≤ 15 dan PBV ≤ 1.5. Tidak ikut dirata-rata ke Harga Wajar Final.">?</span></span>
        <span class="mini-badge muted">Referensi</span>
      </div>
      <div class="method-val tabular-nums" style="color:${gColor}">${res.grahamNumber > 0 ? fmtRp(res.grahamNumber) : '-'}</div>
      <div class="method-sub tabular-nums">${res.grahamNumber > 0 ? `Batas Graham &middot; MoS ${fmtPct(res.grahamMos, 1)}` : 'Butuh EPS & BVPS > 0'}</div>
    </div>
  `;

  // 3 Scenarios (Pesimis / Wajar / Optimis)
  if (res.scenarios) {
    const list = [
      { key: 'bear', data: res.scenarios.bear, active: false },
      { key: 'base', data: res.scenarios.base, active: true },
      { key: 'bull', data: res.scenarios.bull, active: false },
    ];
    document.getElementById('scenarioCards').innerHTML = list
      .map(({ data, active }) => {
        const mCol = data.mos >= 0.3 ? 'var(--emerald)' : data.mos >= 0 ? 'var(--amber)' : 'var(--rose)';
        return `
          <div class="scenario-card ${active ? 'active-scenario' : ''}">
            <div class="label-row">
              <span class="stat-label">${data.label}</span>
              <span class="mini-badge ${data.mos >= 0.3 ? 'emerald' : data.mos >= 0 ? 'amber' : 'rose'}">MoS ${(data.mos * 100).toFixed(1)}%</span>
            </div>
            <div class="scenario-val tabular-nums" style="color:${active ? 'var(--text)' : mCol}">${fmtRp(data.fv)}</div>
            <div class="stat-note tabular-nums">Growth ${(data.g1 * 100).toFixed(1)}% &middot; Discount Rate ${(data.dr * 100).toFixed(2)}%</div>
          </div>`;
      })
      .join('');
  }

  // Kedalaman Fundamental & Estimasi Return 5 Tahun Card
  const depthEl = document.getElementById('fundamentalDepthCard');
  if (depthEl) {
    const exp = res.expectedReturn5Y;
    const expPct = exp && exp.totalCagr5Y !== null ? (exp.totalCagr5Y * 100).toFixed(1) : null;
    const expTone = exp && exp.totalCagr5Y >= 0.15 ? 'emerald' : exp && exp.totalCagr5Y >= 0.08 ? 'amber' : 'rose';
    const bars = [
      { label: 'Implied Pasar', val: res.impliedG1, color: res.impliedG1 !== null && res.impliedG1 < (res.sgr || 0) ? 'var(--emerald)' : 'var(--amber)' },
      { label: 'Asumsi g1', val: Number(state.g1) || 0, color: 'var(--primary)' },
      { label: 'SGR Organik', val: res.sgr, color: '#0d9488' },
      { label: 'CAGR Historis', val: res.cagr, color: '#6366f1' },
    ];
    const maxBar = Math.max(0.15, ...bars.map((b) => (b.val !== null && b.val > 0 ? b.val : 0)));
    const convText =
      res.cashQuality.ocfConversion !== null
        ? `OCF/NI ${(res.cashQuality.ocfConversion * 100).toFixed(0)}% (${res.cashQuality.status.label})`
        : res.cashQuality.fcfConversion !== null
        ? `FCF/NI ${(res.cashQuality.fcfConversion * 100).toFixed(0)}% (${res.cashQuality.status.label})`
        : 'Belum diisi (opsional di Step 2)';

    depthEl.innerHTML = `
      <div class="card-header">
        <div>
          <h3 class="card-title">Kedalaman Fundamental &amp; Estimasi Return 5 Tahun</h3>
          <p class="card-desc">Menggabungkan potensi return 5Y, Reverse DCF (ekspektasi pasar), kualitas DuPont ROE, dan arus kas.</p>
        </div>
        <span class="mini-badge ${res.growthSignal.tone}">${res.growthSignal.label}</span>
      </div>
      <div class="depth-grid">
        <div class="depth-return-box tone-${expTone}">
          <div class="eyebrow" style="color:inherit;opacity:0.85">Estimasi Total Return 5 Thn (CAGR)</div>
          <div class="depth-return-val tabular-nums">${expPct !== null ? `${exp.totalCagr5Y >= 0 ? '+' : ''}${expPct}% / thn` : '-'}</div>
          <div class="depth-return-drivers tabular-nums">
            ${
              exp
                ? `Growth ${(exp.growthDriver * 100).toFixed(1)}% &middot; Re-rating ${(exp.reratingDriver * 100).toFixed(1)}% &middot; Div ${(exp.divDriver * 100).toFixed(1)}%`
                : 'Butuh Harga & EPS > 0'
            }
          </div>
        </div>

        <div class="depth-bars-box">
          <div class="text-xs font-semibold mb-2">4-Way Growth &amp; Reverse DCF Check</div>
          <div class="growth-bars">
            ${bars
              .map((b) => {
                const w = b.val !== null && b.val > 0 ? Math.min(100, Math.round((b.val / maxBar) * 100)) : 0;
                return `
                  <div class="growth-bar-row">
                    <span class="growth-bar-lbl">${b.label}</span>
                    <div class="growth-bar-track"><div class="growth-bar-fill" style="width:${w}%;background:${b.color}"></div></div>
                    <span class="growth-bar-num tabular-nums">${b.val !== null ? fmtPct(b.val, 1) : 'N/A'}</span>
                  </div>`;
              })
              .join('')}
          </div>
          <div class="depth-badges-row mt-2">
            <span class="depth-pill ${res.dupont.driver.tone}">DuPont ROE: <strong>${res.dupont.driver.label}</strong> (ROA ${fmtPct(res.dupont.roaImplied, 1)}${res.isBankMode ? ' · Mode Bank' : ''})</span>
            <span class="depth-pill ${res.cashQuality.status.tone}">Arus Kas: <strong>${convText}</strong></span>
          </div>
        </div>
      </div>
    `;
  }

  document.getElementById('overviewKpiChips').innerHTML = `
    <span class="chip">DCF: <strong>${fmtRp(res.iv)}</strong></span>
    ${state.includeDdm && res.ddmValue > 0 ? `<span class="chip">DDM: <strong>${fmtRp(res.ddmValue)}</strong></span>` : ''}
    ${state.includeLynch && res.lynchValue > 0 ? `<span class="chip">Lynch: <strong>${fmtRp(res.lynchValue)}</strong></span>` : ''}
    <span class="chip chip-strong">Final: <strong>${fmtRp(res.fvFinal)}</strong></span>
  `;

  renderPriceGauge(document.getElementById('gaugeContainer'), {
    price: state.price,
    fvFinal: res.fvFinal,
  });

  renderHistoryChart(document.getElementById('step3HistoryChart'), { history: state.history });

  const fv = res.fvFinal;
  const p = Number(state.price) || 0;
  const buyLevels = [...new Set([0.5, 0.4, customBuyMos, 0.3].map((x) => Number(x.toFixed(2))))].sort(
    (a, b) => b - a
  );
  document.getElementById('buyTargetsTbody').innerHTML = buyLevels
    .map((m) => {
      const tgt = fv * (1 - m);
      const reached = p > 0 && p <= tgt;
      const diff = p > 0 ? ((tgt - p) / p) * 100 : 0;
      return `
        <tr>
          <td>Buy MoS ${(m * 100).toFixed(0)}%</td>
          <td class="num font-bold">${fmtRp(tgt)}</td>
          <td class="num" style="color:${reached ? 'var(--emerald)' : 'var(--text-muted)'}">
            ${reached ? 'Tercapai' : `${diff.toFixed(1)}%`}
          </td>
        </tr>`;
    })
    .join('');

  document.getElementById('sellTargetsTbody').innerHTML = [0.05, 0.0, -0.05, -0.1]
    .map((m) => {
      const tgt = fv * (1 - m);
      const label =
        m === 0
          ? 'Fair Value (0%)'
          : m > 0
          ? `Sell MoS ${(m * 100).toFixed(0)}%`
          : `Sell Premium +${Math.abs(m * 100).toFixed(0)}%`;
      const diff = p > 0 ? ((tgt - p) / p) * 100 : 0;
      return `
        <tr>
          <td>${label}</td>
          <td class="num font-bold">${fmtRp(tgt)}</td>
          <td class="num text-muted">${diff >= 0 ? '+' : ''}${diff.toFixed(1)}%</td>
        </tr>`;
    })
    .join('');

  const sorted = [...res.factors].sort((a, b) => a.beta - b.beta);
  const strongest = sorted[0];
  const riskiest = sorted[sorted.length - 1];
  const ddmLine =
    res.ddmValue > 0
      ? `<p>&bull; Valuasi Dividen (<strong>2-Stage DDM</strong>): <strong>${fmtRp(res.ddmValue)}</strong> dari DPS <strong>${fmtRp(res.dps)}</strong> (Yield <strong>${fmtPct(res.divYield, 1)}</strong>, Payout <strong>${fmtPct(res.payoutRatio, 0)}</strong>).</p>`
      : '';
  const lynchWarn =
    res.lynchCategory.key === 'cyclical'
      ? ' <em>(Waspada: laba/margin fluktuatif atau siklikal, jangan andalkan PEG di puncak siklus)</em>'
      : Number(state.der) > 1.0
      ? ' <em>(Catatan: DER &gt; 1.0x, cek keamanan utang)</em>'
      : '';
  const lynchLine =
    res.lynchValue > 0
      ? `<p>&bull; Valuasi Growth (<strong>Peter Lynch</strong>): <strong>${fmtRp(res.lynchValue)}</strong> (PEGY <strong>${res.pegy.toFixed(2)}x</strong>, kategori <strong>${res.lynchCategory.label}</strong>).${lynchWarn}</p>`
      : '';
  const grahamLine =
    res.grahamNumber > 0
      ? `<p>&bull; Pembanding <strong>Graham Number</strong>: <strong>${fmtRp(res.grahamNumber)}</strong> (batas aman konservatif ala Benjamin Graham: √(22,5 &times; EPS &times; BVPS)).</p>`
      : '';
  document.getElementById('diagnosticContent').innerHTML = `
    <p><strong>${escHtml(state.ticker)}</strong> mendapat <strong>Kualitas Grade ${res.qualityGrade} (${res.qualityScore}/100)</strong> dengan <strong>Discount Rate ${(res.dr * 100).toFixed(2)}%</strong>.</p>
    <p>&bull; Faktor terkuat (menekan risiko): <strong>${strongest.label}</strong> (${strongest.fmt(strongest.val)} &rarr; Beta <strong>${strongest.beta.toFixed(2)}</strong>).</p>
    <p>&bull; Faktor paling berisiko (menaikkan discount rate): <strong>${riskiest.label}</strong> (${riskiest.fmt(riskiest.val)} &rarr; Beta <strong>${riskiest.beta.toFixed(2)}</strong>).</p>
    <p>&bull; EPS Dasar <strong>${fmtRp(res.epsBase)}</strong> diproyeksikan tumbuh <strong>${(state.g1 * 100).toFixed(1)}%</strong> (0–10 thn) dan <strong>${(state.g2 * 100).toFixed(1)}%</strong> (&gt;10 thn).</p>
    ${ddmLine}
    ${lynchLine}
    ${grahamLine}
  `;
}

function renderBetaOut(res) {
  document.getElementById('betaAvgDisp').textContent = res.betaAvg.toFixed(3);
  document.getElementById('betaAdjDisp').textContent = (state.betaAdj >= 0 ? '+' : '') + Number(state.betaAdj || 0).toFixed(2);
  document.getElementById('betaFinalDisp').textContent = res.betaFinal.toFixed(3);
  document.getElementById('capmFormulaDisp').textContent =
    `DR = ${(state.rf * 100).toFixed(2)}% + ${res.betaFinal.toFixed(3)} × (${(state.rm * 100).toFixed(1)}% - ${(state.rf * 100).toFixed(2)}%) = ${(res.dr * 100).toFixed(2)}%`;

  renderBetaChart(document.getElementById('betaChartContainer'), {
    factors: res.factors,
    betaAvg: res.betaAvg,
    betaFinal: res.betaFinal,
    betaAdj: state.betaAdj,
  });

  const drRow = BETA_SCALE.map((b) => ((state.rf + b * (state.rm - state.rf)) * 100).toFixed(2) + '%');
  let html = `
    <tr style="background:var(--surface-subtle);font-weight:700">
      <td>Discount Rate CAPM</td>
      ${drRow.map((d) => `<td class="num">${d}</td>`).join('')}
      <td class="num">-</td>
      <td class="num text-emerald">${(res.dr * 100).toFixed(2)}%</td>
    </tr>`;

  res.factors.forEach((f) => {
    const color = f.beta <= 0.75 ? 'var(--emerald)' : f.beta <= 1.25 ? 'var(--amber)' : 'var(--rose)';
    html += `
      <tr>
        <td class="font-semibold">${f.label}</td>
        ${f.thFmt.map((t) => `<td class="num text-muted">${t}</td>`).join('')}
        <td class="num font-semibold">${f.fmt(f.val)}</td>
        <td class="num font-bold" style="color:${color}">${f.beta.toFixed(2)}</td>
      </tr>`;
  });
  document.getElementById('betaTableTbody').innerHTML = html;
}

function renderProjectionOut(res) {
  const tot = res.iv || 1;
  document.getElementById('pvY10').textContent = fmtRp(res.pvY10);
  document.getElementById('pvY10Pct').textContent = `${((res.pvY10 / tot) * 100).toFixed(1)}% dari Intrinsic`;
  document.getElementById('pvY30').textContent = fmtRp(res.pvY30);
  document.getElementById('pvY30Pct').textContent = `${((res.pvY30 / tot) * 100).toFixed(1)}% dari Intrinsic`;
  document.getElementById('pvY100').textContent = fmtRp(res.pvY100);
  document.getElementById('pvY100Pct').textContent = `${((res.pvY100 / tot) * 100).toFixed(1)}% dari Intrinsic`;

  document.querySelectorAll('.zoom-btn').forEach((b) => {
    b.classList.toggle('active', Number(b.dataset.zoom) === projZoom);
  });

  renderDcfChart(document.getElementById('dcfChartContainer'), {
    rows: res.rows,
    projZoom,
    fmtRp,
  });

  const mode = document.getElementById('selProjRows').value;
  const showRows =
    mode === 'all'
      ? res.rows
      : res.rows.filter((r) => r.year <= 15 || [20, 25, 30, 40, 50, 75, 100].includes(r.year));
  document.getElementById('projTbody').innerHTML = showRows
    .map(
      (r) => `
      <tr style="${r.year === 10 ? 'background:var(--surface-subtle);font-weight:700' : ''}">
        <td>Tahun ${r.year}${r.year === 10 ? ' (Akhir Fase 1)' : ''}</td>
        <td class="num">${fmtRp(r.fv)}</td>
        <td class="num">${fmtRp(r.pv)}</td>
        <td class="num">${fmtRp(r.cumPv)}</td>
        <td class="num text-muted">${((r.pv / tot) * 100).toFixed(2)}%</td>
      </tr>`
    )
    .join('');
}

function renderMatrixOut(res) {
  const metric = document.getElementById('selMatrixMetric').value;
  const gSteps = [-0.04, -0.02, 0, 0.02, 0.04];
  const drSteps = [-0.02, -0.01, 0, 0.01, 0.02];

  let html = `<table class="data-table tabular-nums"><thead><tr><th>Growth \\ DR</th>`;
  drSteps.forEach((d) => {
    html += `<th class="center ${d === 0 ? 'text-emerald' : ''}">${((res.dr + d) * 100).toFixed(1)}%</th>`;
  });
  html += `</tr></thead><tbody>`;

  gSteps.forEach((dg) => {
    const gTest = Math.max(-0.05, state.g1 + dg);
    html += `<tr><td class="font-semibold ${dg === 0 ? 'text-emerald' : ''}">${(gTest * 100).toFixed(1)}%</td>`;
    drSteps.forEach((dd) => {
      const drTest = Math.max(0.03, res.dr + dd);
      const sim = computeDCF(state, { g1: gTest, dr: drTest });
      const val = metric === 'iv' ? sim.iv : sim.fvFinal;
      const mos = val > 0 ? 1 - state.price / val : 0;
      const bg =
        mos >= 0.3 ? 'var(--emerald-soft)' : mos >= 0 ? 'var(--amber-soft)' : 'var(--rose-soft)';
      html += `
        <td class="matrix-cell ${dg === 0 && dd === 0 ? 'base' : ''}" style="background:${bg}">
          <div>${Math.round(val).toLocaleString('id-ID')}</div>
          <div class="text-xs text-muted">MoS ${(mos * 100).toFixed(0)}%</div>
        </td>`;
    });
    html += `</tr>`;
  });
  html += `</tbody></table>`;
  document.getElementById('matrixContainer').innerHTML = html;
}

function syncCompareFloatingBar() {
  const bar = document.getElementById('compareFloatingBar');
  const txt = document.getElementById('compareFloatingText');
  const cnt = document.getElementById('compareTabCount');
  if (cnt) cnt.textContent = String(compareIds.length);
  if (!bar || !txt) return;
  if (activeStep === 'watchlist' && compareIds.length >= 2) {
    bar.classList.remove('hidden');
    txt.textContent = `${compareIds.join(' vs ')} (${compareIds.length} emiten)`;
  } else {
    bar.classList.add('hidden');
  }
}

function resolveComparePool() {
  const all = getAllStocks();
  const map = new Map();
  all.forEach((item) => map.set(item.ticker, item));
  if (state && state.ticker) map.set(state.ticker, state);
  return map;
}

function renderCompareOut() {
  const selWrap = document.getElementById('compareSelectors');
  const winWrap = document.getElementById('compareWinnersGrid');
  const matWrap = document.getElementById('compareMatrixContainer');
  if (!selWrap || !winWrap || !matWrap) return;

  const poolMap = resolveComparePool();
  const poolList = Array.from(poolMap.values());
  const optionsHtml = poolList
    .map((s) => `<option value="${escHtml(s.ticker)}">${escHtml(s.ticker)} — ${escHtml(s.name)}</option>`)
    .join('');

  // Ensure compareIds contains valid tickers, fallback cleanly
  const validIds = compareIds.filter((t) => poolMap.has(t));
  if (validIds.length < 2 && poolList.length >= 2) {
    for (const p of poolList) {
      if (!validIds.includes(p.ticker)) validIds.push(p.ticker);
      if (validIds.length >= 3) break;
    }
    compareIds = validIds;
  }

  const slotCount = 3;
  selWrap.innerHTML = Array.from({ length: slotCount }, (_, idx) => {
    const cur = compareIds[idx] || '';
    return `
      <div class="compare-slot">
        <label class="text-xs text-muted" for="cmpSlot${idx}">Emiten ${idx + 1}${idx === 2 ? ' (Opsional)' : ''}</label>
        <select id="cmpSlot${idx}" data-cmpslot="${idx}" class="compare-select">
          ${idx === 2 ? '<option value="">— Tidak Dipakai (2 Saham) —</option>' : ''}
          ${optionsHtml}
        </select>
      </div>`;
  }).join('');

  for (let idx = 0; idx < slotCount; idx++) {
    const sel = document.getElementById(`cmpSlot${idx}`);
    if (sel) sel.value = compareIds[idx] || '';
  }

  const selectedStocks = compareIds.map((t) => poolMap.get(t)).filter(Boolean);
  const cnt = document.getElementById('compareTabCount');
  if (cnt) cnt.textContent = String(selectedStocks.length);

  if (selectedStocks.length < 2) {
    winWrap.innerHTML = '';
    matWrap.innerHTML = '<div class="text-muted center" style="padding:24px">Pilih minimal 2 emiten untuk membandingkan.</div>';
    return;
  }

  const cmp = compareStocks(selectedStocks);
  const { items, winners } = cmp;

  const winCards = [
    {
      cls: 'win-value',
      badge: 'Juara Value & Dividen',
      w: winners.value,
      detail: (e) => `MoS ${fmtPct(e.res.mos, 1)} · Div Yield ${fmtPct(e.res.divYield, 1)}`,
    },
    {
      cls: 'win-quality',
      badge: 'Juara Quality Compounder',
      w: winners.quality,
      detail: (e) => `Grade ${e.res.qualityGrade} (${e.res.qualityScore}/100) · ROA ${fmtPct(e.res.dupont.roaImplied, 1)}`,
    },
    {
      cls: 'win-growth',
      badge: 'Juara Growth / GARP',
      w: winners.growth,
      detail: (e) =>
        `Return 5Y ${e.res.expectedReturn5Y?.totalCagr5Y !== null && e.res.expectedReturn5Y?.totalCagr5Y !== undefined ? fmtPct(e.res.expectedReturn5Y.totalCagr5Y, 1) : '-'}/thn · PEGY ${e.res.pegy > 0 ? e.res.pegy.toFixed(2) + 'x' : '-'}`,
    },
  ];

  winWrap.innerHTML = winCards
    .map(
      (c) => `
      <div class="compare-winner-card ${c.cls}">
        <div class="compare-winner-badge">${c.badge}</div>
        <div class="compare-winner-ticker">${renderTickerLogoHtml(c.w.ticker, 26)} <strong>${escHtml(c.w.ticker)}</strong></div>
        <div class="compare-winner-sub tabular-nums">${c.detail(c.w.entry)}</div>
      </div>`
    )
    .join('');

  const rowsDef = [
    {
      label: 'Harga Pasar vs Harga Wajar',
      best: 'max',
      val: (x) => x.res.mos,
      fmt: (x) => `${fmtRp(x.stock.price)} → ${fmtRp(x.res.fvFinal)}`,
    },
    {
      label: 'Margin of Safety (Diskon)',
      best: 'max',
      val: (x) => x.res.mos,
      fmt: (x) => fmtPct(x.res.mos, 1),
    },
    {
      label: 'Expected Total Return 5Y',
      best: 'max',
      val: (x) => x.res.expectedReturn5Y?.totalCagr5Y ?? -999,
      fmt: (x) =>
        x.res.expectedReturn5Y?.totalCagr5Y !== null && x.res.expectedReturn5Y?.totalCagr5Y !== undefined
          ? `${fmtPct(x.res.expectedReturn5Y.totalCagr5Y, 1)}/thn`
          : '-',
    },
    {
      label: 'Implied Growth Pasar vs SGR',
      best: 'max',
      val: (x) => (x.res.impliedG1 !== null ? x.res.sgr - x.res.impliedG1 : -999),
      fmt: (x) =>
        `${x.res.impliedG1 !== null ? fmtPct(x.res.impliedG1, 1) : '-'} vs ${fmtPct(x.res.sgr, 1)}`,
    },
    {
      label: 'Kualitas Bisnis & DuPont ROA',
      best: 'max',
      val: (x) => x.res.qualityScore,
      fmt: (x) => `Grade ${x.res.qualityGrade} (${x.res.qualityScore}) · ROA ${fmtPct(x.res.dupont.roaImplied, 1)}`,
    },
    {
      label: 'PEGY Peter Lynch (GARP)',
      best: 'minPos',
      val: (x) => (x.res.pegy > 0 ? x.res.pegy : Infinity),
      fmt: (x) => (x.res.pegy > 0 ? `${x.res.pegy.toFixed(2)}x` : '-'),
    },
    {
      label: 'Dividend Yield & Payout',
      best: 'max',
      val: (x) => x.res.divYield,
      fmt: (x) => `${fmtPct(x.res.divYield, 1)} (PR ${fmtPct(x.res.payoutRatio, 0)})`,
    },
    {
      label: 'Arus Kas (OCF / Laba Bersih)',
      best: 'max',
      val: (x) => x.res.cashQuality.ocfConversion ?? -999,
      fmt: (x) =>
        x.res.cashQuality.ocfConversion !== null
          ? `${(x.res.cashQuality.ocfConversion * 100).toFixed(0)}%`
          : 'Opsional',
    },
  ];

  const headerCells = items
    .map(
      ({ stock }) => `
      <div class="cmp-col-head">
        ${renderTickerLogoHtml(stock.ticker, 22)}
        <strong>${escHtml(stock.ticker)}</strong>
      </div>`
    )
    .join('');

  const bodyRows = rowsDef
    .map((row) => {
      const vals = items.map((x) => row.val(x));
      let bestVal = null;
      if (row.best === 'max') {
        const finite = vals.filter((v) => Number.isFinite(v) && v > -900);
        if (finite.length) bestVal = Math.max(...finite);
      } else if (row.best === 'minPos') {
        const pos = vals.filter((v) => Number.isFinite(v) && v > 0 && v < Infinity);
        if (pos.length) bestVal = Math.min(...pos);
      }
      const cells = items
        .map((x, idx) => {
          const isWinner = bestVal !== null && Math.abs(vals[idx] - bestVal) < 1e-6;
          return `
            <div class="cmp-cell ${isWinner ? 'is-win' : ''}">
              <span class="cmp-cell-ticker">${escHtml(x.stock.ticker)}</span>
              <span class="cmp-cell-val tabular-nums">${row.fmt(x)}</span>
              ${isWinner ? '<span class="cmp-win-tag">&#9733; Unggul</span>' : ''}
            </div>`;
        })
        .join('');

      return `
        <div class="cmp-row cols-${items.length}">
          <div class="cmp-row-label">${row.label}</div>
          <div class="cmp-row-cells">${cells}</div>
        </div>`;
    })
    .join('');

  matWrap.innerHTML = `
    <div class="cmp-matrix cols-${items.length}">
      <div class="cmp-head-row cols-${items.length}">
        <div class="cmp-head-label">Metrik Evaluasi</div>
        <div class="cmp-head-cols">${headerCells}</div>
      </div>
      ${bodyRows}
    </div>`;
}

function updateWatchlistMetaUi() {
  const savedInfoEl = document.getElementById('watchlistSavedInfo');
  const syncGlobalEl = document.getElementById('watchlistSyncGlobal');
  const remBanner = document.getElementById('backupReminderBanner');
  const remText = document.getElementById('backupReminderText');

  let latestSavedIso = null;
  let latestSavedMs = 0;
  for (const c of customStocks) {
    const iso = c.lkUpdatedAt || c.savedAt;
    const ms = iso ? Date.parse(iso) || 0 : 0;
    if (ms > latestSavedMs) {
      latestSavedMs = ms;
      latestSavedIso = iso;
    }
  }

  if (savedInfoEl) {
    const totalCount = getAllStocks().length;
    const timePart = latestSavedIso ? ` · terakhir disimpan ${fmtDateTimeShort(latestSavedIso)}` : '';
    savedInfoEl.textContent = `🔒 Data tersimpan: ${customStocks.length} custom / ${totalCount} emiten${timePart}`;
  }

  if (syncGlobalEl) {
    if (syncMeta?.lastSyncAllAt) {
      syncGlobalEl.textContent = `Terakhir sync: ${fmtDateTimeShort(syncMeta.lastSyncAllAt)} (${syncMeta.okCount}/${syncMeta.totalCount} sukses)`;
    } else {
      syncGlobalEl.textContent = '';
    }
  }

  if (remBanner && remText) {
    const rem = shouldRemindBackup({ customStocks, lastBackupAt });
    if (rem.remind) {
      remBanner.classList.remove('hidden');
      remText.textContent = `⚠️ Backup terakhir: ${rem.daysAgo} hari lalu`;
    } else {
      remBanner.classList.add('hidden');
    }
  }
}

function renderWatchlistOut() {
  const restoreBtn = document.getElementById('btnRestorePresets');
  if (hiddenPresetIds.length > 0) {
    restoreBtn.classList.remove('hidden');
    restoreBtn.textContent = `Pulihkan Preset (${hiddenPresetIds.length})`;
  } else {
    restoreBtn.classList.add('hidden');
  }

  updateWatchlistMetaUi();

  let combined = getAllStocks().map((item) => ({
    item,
    r: computeDCF(item),
    isFav: favoriteIds.includes(item.ticker),
  }));

  if (watchlistFilter === 'fav') combined = combined.filter((x) => x.isFav);
  else if (watchlistFilter === 'buyable')
    combined = combined.filter(
      (x) => (x.r.qualityGrade === 'A' || x.r.qualityGrade === 'B') && x.r.mos >= 0.3
    );
  else if (watchlistFilter === 'stale') combined = combined.filter((x) => x.r.isStaleData);

  const sortBy = document.getElementById('selSortWatchlist').value;
  combined.sort((a, b) => {
    if (a.isFav !== b.isFav) return a.isFav ? -1 : 1;
    if (sortBy === 'mosDesc') return b.r.mos - a.r.mos;
    if (sortBy === 'ret5yDesc') {
      const ra = a.r.expectedReturn5Y?.totalCagr5Y ?? -999;
      const rb = b.r.expectedReturn5Y?.totalCagr5Y ?? -999;
      return rb - ra;
    }
    if (sortBy === 'qualityDesc') return b.r.qualityScore - a.r.qualityScore;
    if (sortBy === 'drAsc') return a.r.dr - b.r.dr;
    return a.item.ticker.localeCompare(b.item.ticker);
  });

  if (!combined.length) {
    document.getElementById('watchlistTbody').innerHTML =
      '<tr><td colspan="9" class="center text-muted" style="padding:24px">Tidak ada emiten pada filter ini.</td></tr>';
    syncCompareFloatingBar();
    return;
  }

  document.getElementById('watchlistTbody').innerHTML = combined
    .map(({ item, r, isFav }) => {
      const mosColor = r.mos >= 0.3 ? 'var(--emerald)' : r.mos >= 0 ? 'var(--amber)' : 'var(--rose)';
      const gTone =
        r.qualityGrade === 'A' || r.qualityGrade === 'B'
          ? 'emerald'
          : r.qualityGrade === 'C'
          ? 'amber'
          : 'rose';
      const isCur = item.id === state.id;
      const inCmp = compareIds.includes(item.ticker);

      const st = rowSyncStatus[item.ticker];
      let syncBadgeHtml = '';
      if (st?.status === 'syncing') {
        syncBadgeHtml = '<div class="sync-badge syncing">Sync...</div>';
      } else if (st?.status === 'error') {
        syncBadgeHtml = '<div class="sync-badge error">&#128992; Gagal &middot; harga lama</div>';
      } else if (st?.status === 'ok' || item.lastSyncedAt) {
        const tm = fmtTimeShort(st?.time || item.lastSyncedAt);
        syncBadgeHtml = `<div class="sync-badge ok">&#128994; Live${tm ? ' ' + tm : ''}</div>`;
      }

      return `
        <tr class="wl-row ${isCur ? 'is-current' : ''}" style="cursor:pointer" data-loadid="${escHtml(item.id)}" data-iscustom="${Boolean(item.isCustom)}">
          <td class="wl-col-ticker">
            <div class="ticker-cell">
              ${renderTickerLogoHtml(item.ticker, 30)}
              <div>
                <div>
                  <strong>${escHtml(item.ticker)}</strong>
                  ${
                    item.isCustom
                      ? '<span class="custom-stock-icon" title="Data simpanan pribadi" aria-label="Data simpanan pribadi"><svg viewBox="0 0 16 16" width="12" height="12" fill="currentColor" aria-hidden="true"><path d="M3.5 1.5A1.5 1.5 0 0 1 5 0h6a1.5 1.5 0 0 1 1.5 1.5v13.8a.5.5 0 0 1-.78.41L8 13.1l-3.72 2.61a.5.5 0 0 1-.78-.41V1.5Z"/></svg></span>'
                      : ''
                  }
                </div>
                <div class="text-xs text-muted">${escHtml(item.name)}</div>
                ${item.note ? `<div class="note-line">${escHtml(item.note)}</div>` : ''}
              </div>
            </div>
          </td>
          <td class="center wl-col-grade"><span class="mini-badge ${gTone}">Grade ${r.qualityGrade} (${r.qualityScore})</span></td>
          <td class="center wl-col-lk"><span class="mini-badge ${r.isStaleData ? 'amber' : 'muted'}">LK ${escHtml(r.dataYear || '-')}</span></td>
          <td class="num tabular-nums wl-col-price" data-label="Pasar">
            <div>${fmtRp(item.price)}</div>
            ${syncBadgeHtml}
          </td>
          <td class="num tabular-nums wl-col-dr">${(r.dr * 100).toFixed(1)}%</td>
          <td class="num tabular-nums wl-col-iv">${fmtRp(r.iv)}</td>
          <td class="num tabular-nums wl-col-fv" data-label="Wajar">${fmtRp(r.fvFinal)}</td>
          <td class="num tabular-nums font-bold wl-col-mos" data-label="MoS" style="color:${mosColor}">${(r.mos * 100).toFixed(1)}%</td>
          <td class="center wl-col-actions">
            <div class="action-group">
              <button type="button" class="btn-icon-sm vs-btn ${inCmp ? 'active' : ''}" data-vsticker="${escHtml(item.ticker)}" title="Pilih untuk Bandingkan (maks 3)">VS</button>
              <button type="button" class="btn-icon-sm fav-btn ${isFav ? 'active' : ''}" data-favticker="${escHtml(item.ticker)}" title="Favorit">&#9733;</button>
              <button type="button" class="btn-icon-sm more-btn" data-moreid="${escHtml(item.id)}" data-iscustom="${Boolean(item.isCustom)}" data-moreticker="${escHtml(item.ticker)}" title="Laporan, Edit, Hapus" aria-label="Aksi ${escHtml(item.ticker)}">&#8943;</button>
            </div>
          </td>
        </tr>`;
    })
    .join('');
  syncCompareFloatingBar();
}

// =========================================================================
// NAVIGATION & EVENTS
// =========================================================================
let heroForceExpanded = false;
function syncHeroCollapse() {
  const hero = document.getElementById('heroSection');
  if (!hero) return;
  const isStep3 = activeStep === 'step3';
  const shouldCollapse = !isStep3 && !heroForceExpanded;
  hero.classList.toggle('hero-step3', isStep3);
  hero.classList.toggle('hero-collapsed', shouldCollapse);
  const tog = document.getElementById('heroMiniToggle');
  if (tog) tog.innerHTML = shouldCollapse ? 'Detail &#9662;' : 'Tutup &#9652;';
}

document.getElementById('heroMiniBar')?.addEventListener('click', () => {
  heroForceExpanded = !heroForceExpanded;
  syncHeroCollapse();
});

function setStep(step, { scroll = false } = {}) {
  activeStep = step;
  heroForceExpanded = false;
  syncHeroCollapse();
  document.querySelectorAll('.step-btn, .mobile-tab-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.step === step);
  });
  document.querySelectorAll('.step-view').forEach((v) => {
    v.classList.toggle('hidden', v.id !== 'view-' + step);
  });
  syncCompareFloatingBar();
  if (scroll && window.innerWidth <= 768) {
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }
}

function setOutTab(tab) {
  activeOutTab = tab;
  document.querySelectorAll('.out-tab').forEach((b) => {
    b.classList.toggle('active', b.dataset.outtab === tab);
  });
  document.querySelectorAll('.out-panel').forEach((p) => {
    p.classList.toggle('hidden', p.id !== 'panel-out-' + tab);
  });
}

document.querySelectorAll('.step-btn, .mobile-tab-btn').forEach((b) =>
  b.addEventListener('click', () => setStep(b.dataset.step, { scroll: true }))
);
document.querySelectorAll('.next-step-btn').forEach((b) =>
  b.addEventListener('click', () => setStep(b.dataset.goto, { scroll: true }))
);
document.querySelectorAll('.out-tab').forEach((b) => b.addEventListener('click', () => setOutTab(b.dataset.outtab)));
document.querySelectorAll('.mode-btn').forEach((b) =>
  b.addEventListener('click', () => {
    applyUiMode(b.dataset.mode);
    showToast(b.dataset.mode === 'pro' ? 'Mode Pro aktif (semua kontrol tampil)' : 'Mode Pemula aktif (tampilan ringkas)');
  })
);

// Theme Toggle
document.getElementById('btnTheme').addEventListener('click', () => {
  const isDark = document.documentElement.classList.contains('dark');
  applyTheme(isDark ? 'light' : 'dark');
});

// Stock Picker Dropdown
const pickerBtn = document.getElementById('btnPicker');
const pickerDrop = document.getElementById('pickerDropdown');
const pickerSearch = document.getElementById('inpPickerSearch');

pickerBtn.addEventListener('click', () => {
  const open = pickerDrop.classList.toggle('hidden');
  pickerBtn.setAttribute('aria-expanded', String(!open));
  if (!open) {
    pickerSearch.value = '';
    renderPickerList('');
    pickerSearch.focus();
  }
});

pickerSearch.addEventListener('input', (e) => renderPickerList(e.target.value));

document.getElementById('pickerList').addEventListener('click', async (e) => {
  const btn = e.target.closest('.picker-item');
  if (!btn) return;
  pickerDrop.classList.add('hidden');

  if (btn.dataset.newticker) {
    state = createBlankStock(btn.dataset.newticker);
    liveMeta = { status: 'manual', label: 'Baru' };
    syncInputsFromState();
    renderAll();
    setStep('step1');
    await syncLiveTicker(true);
    return;
  }

  const id = btn.dataset.pickid;
  const isCust = btn.dataset.iscustom === 'true';
  const src = isCust ? customStocks.find((c) => c.id === id) : getEffectivePresets().find((p) => p.id === id);
  if (src) {
    state = clone(src);
    liveMeta = state.lastSyncedAt
      ? { status: 'live', label: `Live ${fmtTimeShort(state.lastSyncedAt)}` }
      : { status: 'preset', label: isCust ? 'Watchlist' : 'Preset' };
    syncInputsFromState();
    renderAll();
    setStep('step3');
    if (loadLiveSettings().autoSyncOnSelect) {
      syncLiveTicker(false);
    }
  }
});

document.addEventListener('click', (e) => {
  if (!e.target.closest('.picker-wrap')) pickerDrop.classList.add('hidden');
});

// Live Buttons
document.getElementById('btnRefreshLive').addEventListener('click', () => syncLiveTicker(true));
document.getElementById('btnInlineFetch').addEventListener('click', () => syncLiveTicker(true));

document.getElementById('btnNewStock').addEventListener('click', () => {
  state = createBlankStock('NEW');
  liveMeta = { status: 'manual', label: 'Baru' };
  syncInputsFromState();
  renderAll();
  setStep('step1');
  showToast('Template emiten baru siap diisi');
});

function hasLkChanged(prev, next) {
  if (!prev) return true;
  const lkFields = ['roe', 'der', 'npm', 'epsTTM', 'bvps', 'dps', 'ocf', 'fcf', 'isBankMode'];
  for (const k of lkFields) {
    if ((prev[k] ?? null) !== (next[k] ?? null)) return true;
  }
  return JSON.stringify(prev.history || []) !== JSON.stringify(next.history || []);
}

document.getElementById('btnSaveWatchlist').addEventListener('click', () => {
  const cleanTicker = (state.ticker || 'NEW').trim().toUpperCase().replace(/\.JK$/i, '');
  state.ticker = cleanTicker;

  const existingById = state.id && state.id.startsWith('CUSTOM_') ? customStocks.find((c) => c.id === state.id) : null;
  const tickerChanged = existingById && String(existingById.ticker || '').toUpperCase() !== cleanTicker;
  if (!state.id || !state.id.startsWith('CUSTOM_') || tickerChanged) {
    state.id = 'CUSTOM_' + cleanTicker;
  }

  const idx = customStocks.findIndex((c) => c.ticker === cleanTicker || c.id === state.id);
  const prev = idx >= 0 ? customStocks[idx] : null;
  const nowIso = new Date().toISOString();
  state.savedAt = nowIso;
  state.lkUpdatedAt = hasLkChanged(prev, state) ? nowIso : prev?.lkUpdatedAt || prev?.savedAt || nowIso;

  if (idx >= 0) customStocks[idx] = clone(state);
  else customStocks.unshift(clone(state));
  saveWatchlist(customStocks);
  renderAll();
  showToast(`${cleanTicker} tersimpan di Watchlist`);
});

document.getElementById('btnReset').addEventListener('click', () => {
  const orig =
    PRESETS.find((p) => p.id === state.id || 'CUSTOM_' + p.ticker === state.id || p.ticker === state.ticker) ||
    PRESETS[0];
  state = clone(orig);
  liveMeta = { status: 'preset', label: 'Preset' };
  syncInputsFromState();
  renderAll();
  showToast(`Data ${state.ticker} di-reset ke default spreadsheet`);
});

// Pillar A: 1-Click Batch Refresh Watchlist (Max-4 Concurrency + AbortController + Preset Overrides)
document.getElementById('btnRefreshAllWatchlist').addEventListener('click', async () => {
  const btn = document.getElementById('btnRefreshAllWatchlist');
  const syncBar = document.getElementById('watchlistSyncBar');
  const syncText = document.getElementById('watchlistSyncText');
  const syncFill = document.getElementById('watchlistSyncFill');

  if (batchSyncAbortController) {
    batchSyncAbortController.abort();
    btn.textContent = 'Membatalkan...';
    btn.disabled = true;
    return;
  }

  const list = getAllStocks();
  if (!list.length) {
    return showToast('Watchlist kosong');
  }

  batchSyncAbortController = new AbortController();
  const { signal } = batchSyncAbortController;
  const settings = loadLiveSettings();

  btn.textContent = 'Batal';
  btn.classList.add('is-syncing');
  syncBar?.classList.remove('hidden');
  if (syncFill) syncFill.style.width = '0%';
  if (syncText) syncText.textContent = `Sync 0/${list.length}...`;

  rowSyncStatus = {};
  for (const item of list) {
    rowSyncStatus[item.ticker] = { status: 'syncing' };
  }
  renderWatchlistOut();

  let okCount = 0;
  let lastOkTicker = '';
  let lastFailTicker = '';
  let activeStatePatched = false;

  const summary = await runWithConcurrency(
    list,
    4,
    async (item) => {
      const q = await fetchLiveQuote(item.ticker, { force: true, signal });
      if (!q || typeof q.price !== 'number' || !(q.price > 0)) {
        throw new Error('Harga kosong');
      }

      const nowIso = new Date().toISOString();
      const oldPrice = Number(item.price) || 0;
      const oldMcap = Number(item.marketCap) || 0;
      const oldShares =
        item.sharesOverride && item.sharesOverride > 0
          ? Number(item.sharesOverride)
          : oldPrice > 0 && oldMcap > 0
          ? (oldMcap / oldPrice) * 1000
          : 0;
      const nextMcap =
        typeof q.marketCapTrillion === 'number' && q.marketCapTrillion > 0
          ? Number(q.marketCapTrillion.toFixed(4))
          : oldShares > 0
          ? Number(((q.price * oldShares) / 1000).toFixed(4))
          : oldMcap;

      if (item.isCustom) {
        const target = customStocks.find((c) => c.id === item.id || c.ticker === item.ticker);
        if (target) {
          target.price = q.price;
          target.marketCap = nextMcap;
          target.lastSyncedAt = nowIso;
          if (settings.syncEpsBvps) {
            if (typeof q.epsTTM === 'number' && q.epsTTM > 0) target.epsTTM = Number(q.epsTTM.toFixed(2));
            if (typeof q.bvps === 'number' && q.bvps > 0) target.bvps = Number(q.bvps.toFixed(2));
          }
        }
      } else {
        presetOverrides[item.ticker] = {
          price: q.price,
          marketCap: nextMcap,
          ...(typeof q.sharesBillion === 'number' && q.sharesBillion > 0 ? { sharesOut: q.sharesBillion } : {}),
          lastSyncedAt: nowIso,
        };
      }

      // Non-clobbering patch on active Step 1-3 state (preserve unsaved LK & assumptions)
      if (state && (state.ticker === item.ticker || state.id === item.id)) {
        state.price = q.price;
        state.marketCap = nextMcap;
        state.lastSyncedAt = nowIso;
        if (item.isCustom && settings.syncEpsBvps) {
          if (typeof q.epsTTM === 'number' && q.epsTTM > 0) state.epsTTM = Number(q.epsTTM.toFixed(2));
          if (typeof q.bvps === 'number' && q.bvps > 0) state.bvps = Number(q.bvps.toFixed(2));
        }
        liveMeta = { status: 'live', label: `Live ${fmtTimeShort(nowIso)}` };
        activeStatePatched = true;
      }

      rowSyncStatus[item.ticker] = { status: 'ok', time: nowIso };
      return { ticker: item.ticker, price: q.price };
    },
    {
      signal,
      onProgress: ({ completed, total, item, ok }) => {
        if (ok) {
          okCount++;
          lastOkTicker = item.ticker;
        } else {
          rowSyncStatus[item.ticker] = { status: 'error' };
          lastFailTicker = item.ticker;
        }
        const pct = total > 0 ? Math.round((completed / total) * 100) : 0;
        if (syncFill) syncFill.style.width = `${pct}%`;
        if (syncText) {
          const parts = [`Sync ${completed}/${total}`];
          if (lastOkTicker) parts.push(`${lastOkTicker} ✓`);
          if (lastFailTicker) parts.push(`${lastFailTicker} ✗`);
          syncText.textContent = parts.join(' · ');
        }
        renderWatchlistOut();
      },
    }
  );

  // Clear 'syncing' badge for any remaining aborted rows
  for (const item of list) {
    if (rowSyncStatus[item.ticker]?.status === 'syncing') {
      delete rowSyncStatus[item.ticker];
    }
  }

  if (customStocks.length) saveWatchlist(customStocks);
  savePresetOverrides(presetOverrides);
  syncMeta = {
    lastSyncAllAt: new Date().toISOString(),
    okCount,
    totalCount: list.length,
  };
  saveSyncMeta(syncMeta);

  batchSyncAbortController = null;
  btn.disabled = false;
  btn.classList.remove('is-syncing');
  btn.innerHTML = '&#8635; Sync Semua Harga';

  if (activeStatePatched) {
    syncInputsFromState();
  }
  renderAll();

  if (summary.aborted) {
    showToast(`Sync dibatalkan (${okCount}/${list.length} selesai)`);
  } else {
    setTimeout(() => {
      if (!batchSyncAbortController) syncBar?.classList.add('hidden');
    }, 3500);
    showToast(
      okCount > 0
        ? `${okCount}/${list.length} emiten berhasil diperbarui live`
        : 'Gagal terhubung ke live API'
    );
  }
});

// Input Bindings
document.getElementById('inpTicker').addEventListener('input', (e) => {
  state.ticker = e.target.value.toUpperCase();
  renderAll();
});
document.getElementById('inpName').addEventListener('input', (e) => {
  state.name = e.target.value;
  document.getElementById('pillName').textContent = state.name;
});
document.getElementById('inpNote').addEventListener('input', (e) => {
  state.note = e.target.value;
});
document.getElementById('inpPrice').addEventListener('input', (e) => {
  state.price = parseFloat(e.target.value) || 0;
  liveMeta = { status: 'manual', label: 'Manual' };
  renderAll();
});
document.getElementById('inpMcap').addEventListener('input', (e) => {
  state.marketCap = parseFloat(e.target.value) || 0;
  renderAll();
});
document.getElementById('chkSharesManual').addEventListener('change', (e) => {
  const inp = document.getElementById('inpShares');
  if (e.target.checked) {
    state.sharesOverride = parseFloat(inp.value) || 1;
    inp.disabled = false;
  } else {
    state.sharesOverride = null;
    inp.disabled = true;
  }
  renderAll();
});
document.getElementById('inpShares').addEventListener('input', (e) => {
  if (document.getElementById('chkSharesManual').checked) {
    state.sharesOverride = parseFloat(e.target.value) || 0;
    renderAll();
  }
});

document.getElementById('historyTbody').addEventListener('input', (e) => {
  const idx = e.target.dataset.hidx;
  const field = e.target.dataset.field;
  if (idx === undefined || !field) return;
  state.history[Number(idx)][field] = parseFloat(e.target.value) || 0;
  if (field === 'sales' || field === 'op') {
    const row = state.history[Number(idx)];
    const opm = row.sales > 0 ? (row.op / row.sales) * 100 : 0;
    e.target.closest('tr').lastElementChild.textContent = opm.toFixed(1) + '%';
  }
  renderAll();
});

document.getElementById('btnAddYear').addEventListener('click', () => {
  if (state.history.length >= 7) return showToast('Maksimal 7 tahun historis');
  const last = state.history[state.history.length - 1];
  state.history.push({
    year: (last ? last.year : 2024) - 1,
    sales: last ? last.sales : 0,
    op: last ? last.op : 0,
    ni: last ? last.ni : 0,
    inf: DEFAULT_INF[state.history.length] || 1.2,
  });
  renderHistoryTable();
  renderAll();
});

document.getElementById('btnRemYear').addEventListener('click', () => {
  if (state.history.length <= 3) return showToast('Minimal 3 tahun data historis');
  state.history.pop();
  renderHistoryTable();
  renderAll();
});

document.getElementById('selAvgYears').addEventListener('change', (e) => {
  state.avgYearsLimit = e.target.value === 'all' ? 'all' : Number(e.target.value);
  renderAll();
});

const bindPct = (id, key) =>
  document.getElementById(id).addEventListener('input', (e) => {
    state[key] = (parseFloat(e.target.value) || 0) / 100;
    renderAll();
  });
bindPct('inpRoe', 'roe');
bindPct('inpNpm', 'npm');
bindPct('inpRf', 'rf');
bindPct('inpRm', 'rm');

document.getElementById('inpDer').addEventListener('input', (e) => {
  state.der = parseFloat(e.target.value) || 0;
  renderAll();
});
document.getElementById('inpEpsTtm').addEventListener('input', (e) => {
  state.epsTTM = parseFloat(e.target.value) || 0;
  renderAll();
});
document.getElementById('inpBvps').addEventListener('input', (e) => {
  state.bvps = parseFloat(e.target.value) || 0;
  renderAll();
});
document.getElementById('chkBankMode').addEventListener('change', (e) => {
  state.isBankMode = e.target.checked;
  renderAll();
});
document.getElementById('inpOcf').addEventListener('input', (e) => {
  const raw = e.target.value.trim();
  state.ocf = raw === '' ? null : parseFloat(raw) || 0;
  renderAll();
});
document.getElementById('inpFcf').addEventListener('input', (e) => {
  const raw = e.target.value.trim();
  state.fcf = raw === '' ? null : parseFloat(raw) || 0;
  renderAll();
});

const bindSliderPair = (rngId, inpId, key, scale = 100) => {
  const rng = document.getElementById(rngId);
  const inp = document.getElementById(inpId);
  rng.addEventListener('input', (e) => {
    inp.value = e.target.value;
    state[key] = (parseFloat(e.target.value) || 0) / scale;
    renderAll();
  });
  inp.addEventListener('input', (e) => {
    rng.value = e.target.value;
    state[key] = (parseFloat(e.target.value) || 0) / scale;
    renderAll();
  });
};
bindSliderPair('rngG1', 'inpG1', 'g1', 100);
bindSliderPair('rngG2', 'inpG2', 'g2', 100);
bindSliderPair('rngBetaAdj', 'inpBetaAdj', 'betaAdj', 1);

document.getElementById('selEpsBasis').addEventListener('change', (e) => {
  state.epsBasis = e.target.value;
  renderAll();
});
document.getElementById('selY1Mode').addEventListener('change', (e) => {
  state.y1Mode = e.target.value;
  document.getElementById('recoveryBox').classList.toggle('hidden', state.y1Mode !== 'recovery');
  renderAll();
});
document.getElementById('inpY1Mult').addEventListener('input', (e) => {
  state.y1Mult = parseFloat(e.target.value) || 1;
  renderAll();
});
document.getElementById('inpY2Mult').addEventListener('input', (e) => {
  state.y2Mult = parseFloat(e.target.value) || 1;
  renderAll();
});

document.getElementById('chkIncludeRel').addEventListener('change', (e) => {
  state.includeRel = e.target.checked;
  renderAll();
});
document.getElementById('chkIncludeDdm').addEventListener('change', (e) => {
  state.includeDdm = e.target.checked;
  renderAll();
});
document.getElementById('inpDps').addEventListener('input', (e) => {
  state.dps = Math.max(0, parseFloat(e.target.value) || 0);
  renderAll();
});
document.getElementById('inpDdmG1').addEventListener('input', (e) => {
  const raw = e.target.value.trim();
  state.ddmG1 = raw === '' ? null : (parseFloat(raw) || 0) / 100;
  renderAll();
});
document.getElementById('inpDdmG2').addEventListener('input', (e) => {
  const raw = e.target.value.trim();
  state.ddmG2 = raw === '' ? null : (parseFloat(raw) || 0) / 100;
  renderAll();
});
document.getElementById('chkIncludeLynch').addEventListener('change', (e) => {
  state.includeLynch = e.target.checked;
  renderAll();
});
document.getElementById('rngOptimism').addEventListener('input', (e) => {
  state.optimism = parseFloat(e.target.value) || 0;
  document.getElementById('dispOptimism').textContent = `${state.optimism.toFixed(2)} (${Math.round(state.optimism * 100)}%)`;
  renderAll();
});
document.getElementById('selRelMode').addEventListener('change', (e) => {
  state.relMode = e.target.value;
  renderAll();
});
['pe3', 'pe5', 'pe10', 'pbv3', 'pbv5', 'pbv10'].forEach((k) => {
  const id = 'inp' + k.charAt(0).toUpperCase() + k.slice(1);
  document.getElementById(id).addEventListener('input', (e) => {
    state[k] = parseFloat(e.target.value) || 0;
    renderAll();
  });
});

document.getElementById('inpCustomMos').addEventListener('input', (e) => {
  customBuyMos = Math.max(0.01, Math.min(0.9, (parseFloat(e.target.value) || 35) / 100));
  renderAll();
});
document.querySelectorAll('.zoom-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    projZoom = Number(btn.dataset.zoom);
    renderAll();
  })
);
document.getElementById('selProjRows').addEventListener('change', () => renderAll());
document.getElementById('selMatrixMetric').addEventListener('change', () => renderAll());
document.getElementById('selSortWatchlist').addEventListener('change', () => renderAll());

// Compare Tab Events
document.getElementById('compareSelectors')?.addEventListener('change', (e) => {
  const sel = e.target.closest('select[data-cmpslot]');
  if (!sel) return;
  const idx = Number(sel.dataset.cmpslot);
  const val = sel.value;
  const next = [...compareIds];
  if (val) next[idx] = val;
  else next.splice(idx, 1);
  compareIds = [...new Set(next.filter(Boolean))].slice(0, 3);
  renderCompareOut();
  renderWatchlistOut();
});

document.getElementById('btnCompareSyncActive')?.addEventListener('click', () => {
  const t = (state.ticker || '').toUpperCase();
  if (!t) return;
  if (!compareIds.includes(t)) {
    compareIds = [t, ...compareIds].slice(0, 3);
    renderCompareOut();
    renderWatchlistOut();
    showToast(`${t} dimasukkan ke perbandingan`);
  }
});

document.getElementById('btnGoCompare')?.addEventListener('click', () => {
  setStep('step3', { scroll: true });
  setOutTab('compare');
});

document.querySelectorAll('.filter-pill').forEach((btn) =>
  btn.addEventListener('click', () => {
    watchlistFilter = btn.dataset.wfilter;
    document.querySelectorAll('.filter-pill').forEach((b) => b.classList.toggle('active', b === btn));
    renderWatchlistOut();
  })
);

document.getElementById('btnRestorePresets').addEventListener('click', () => {
  hiddenPresetIds = [];
  saveJsonList(HIDDEN_PRESETS_KEY, hiddenPresetIds);
  renderWatchlistOut();
  showToast('Semua emiten preset dipulihkan');
});

document.getElementById('watchlistTbody').addEventListener('click', (e) => {
  const vsBtn = e.target.closest('[data-vsticker]');
  if (vsBtn) {
    e.stopPropagation();
    const t = vsBtn.dataset.vsticker;
    if (compareIds.includes(t)) {
      if (compareIds.length <= 2) {
        return showToast('Minimal 2 saham dipertahankan untuk perbandingan');
      }
      compareIds = compareIds.filter((x) => x !== t);
    } else {
      if (compareIds.length >= 3) {
        compareIds = [...compareIds.slice(1), t];
      } else {
        compareIds.push(t);
      }
    }
    renderCompareOut();
    renderWatchlistOut();
    return;
  }

  const favBtn = e.target.closest('[data-favticker]');
  if (favBtn) {
    e.stopPropagation();
    const t = favBtn.dataset.favticker;
    if (favoriteIds.includes(t)) favoriteIds = favoriteIds.filter((x) => x !== t);
    else favoriteIds.push(t);
    saveJsonList(FAVORITES_KEY, favoriteIds);
    renderWatchlistOut();
    return;
  }

  const moreBtn = e.target.closest('[data-moreid]');
  if (moreBtn) {
    e.stopPropagation();
    openRowActionsModal({
      id: moreBtn.dataset.moreid,
      isCustom: moreBtn.dataset.iscustom === 'true',
      ticker: moreBtn.dataset.moreticker,
    });
    return;
  }

  const tr = e.target.closest('tr[data-loadid]');
  if (!tr) return;
  const loadId = tr.dataset.loadid;
  const isCust = tr.dataset.iscustom === 'true';
  const src = isCust ? customStocks.find((c) => c.id === loadId) : getEffectivePresets().find((p) => p.id === loadId);
  if (src) {
    state = clone(src);
    liveMeta = state.lastSyncedAt
      ? { status: 'live', label: `Live ${fmtTimeShort(state.lastSyncedAt)}` }
      : { status: 'preset', label: isCust ? 'Watchlist' : 'Preset' };
    syncInputsFromState();
    renderAll();
    setStep('step3');
    showToast(`Memuat ${state.ticker}`);
  }
});

// Modals
document.querySelectorAll('[data-close]').forEach((btn) =>
  btn.addEventListener('click', () => document.getElementById(btn.dataset.close).classList.add('hidden'))
);
document.querySelectorAll('.modal-overlay').forEach((ov) =>
  ov.addEventListener('click', (e) => {
    if (e.target === ov) ov.classList.add('hidden');
  })
);

let pendingAiData = null;
let pendingImageBase64 = '';
let pendingImageMime = 'image/png';

function openAiModal(tab = 'ai') {
  document.getElementById('txtJsonBox').value = JSON.stringify(state, null, 2);
  document.querySelectorAll('.modal-tab').forEach((b) => b.classList.toggle('active', b.dataset.mtab === tab));
  document.getElementById('mpanel-ai').classList.toggle('hidden', tab !== 'ai');
  document.getElementById('mpanel-json').classList.toggle('hidden', tab !== 'json');
  document.getElementById('modalPaste').classList.remove('hidden');
}

document.getElementById('btnPasteModal').addEventListener('click', () => openAiModal('ai'));
document.getElementById('btnStep1Ai').addEventListener('click', () => openAiModal('ai'));

document.querySelectorAll('.modal-tab').forEach((btn) =>
  btn.addEventListener('click', () => openAiModal(btn.dataset.mtab))
);

document.getElementById('btnFillExample').addEventListener('click', () => {
  document.getElementById('txtAiInput').value = `CMRY
pendapatan tahun 2025 - 2022
10,724 B\t9,026 B\t7,773 B\t6,378 B\t4,096 B

laba usaha
1,980 B\t1,671 B\t1,428 B\t1,256 B\t1,007 B

laba bersih
1,790 B\t1,519 B\t1,242 B\t1,061 B\t790 B

ROE : 26.5%
NPM : 16.7%
DER : 0.05x
EPS TTM : 225
BVPS : 890`;
});

function setScreenshotFile(file) {
  if (!file || !file.type.startsWith('image/')) return;
  const reader = new FileReader();
  reader.onload = () => {
    pendingImageBase64 = String(reader.result || '');
    pendingImageMime = file.type || 'image/png';
    document.getElementById('imgPreview').src = pendingImageBase64;
    document.getElementById('dropPrompt').classList.add('hidden');
    document.getElementById('dropPreviewWrap').classList.remove('hidden');
  };
  reader.readAsDataURL(file);
}

function clearScreenshot() {
  pendingImageBase64 = '';
  document.getElementById('inpScreenshotFile').value = '';
  document.getElementById('dropPrompt').classList.remove('hidden');
  document.getElementById('dropPreviewWrap').classList.add('hidden');
}

document.getElementById('btnPickImage').addEventListener('click', () => {
  document.getElementById('inpScreenshotFile').click();
});
document.getElementById('inpScreenshotFile').addEventListener('change', (e) => {
  if (e.target.files?.[0]) setScreenshotFile(e.target.files[0]);
});
document.getElementById('btnClearImage').addEventListener('click', clearScreenshot);

const dropZone = document.getElementById('dropZone');
dropZone.addEventListener('dragover', (e) => {
  e.preventDefault();
  dropZone.classList.add('dragover');
});
dropZone.addEventListener('dragleave', () => dropZone.classList.remove('dragover'));
dropZone.addEventListener('drop', (e) => {
  e.preventDefault();
  dropZone.classList.remove('dragover');
  if (e.dataTransfer?.files?.[0]) setScreenshotFile(e.dataTransfer.files[0]);
});

// Support Ctrl+V image paste anywhere when AI modal is open
document.getElementById('modalPaste').addEventListener('paste', (e) => {
  const items = e.clipboardData?.items || [];
  for (const item of items) {
    if (item.type.startsWith('image/')) {
      const file = item.getAsFile();
      if (file) {
        setScreenshotFile(file);
        showToast('Screenshot ditempel — siap diproses AI');
        break;
      }
    }
  }
});

function renderAiPreview(result) {
  pendingAiData = result.data;
  const d = result.data;
  document.getElementById('aiPreviewBox').classList.remove('hidden');
  document.getElementById('aiEngineBadge').textContent =
    result.engine === 'gemini' ? `✨ ${result.model}` : `⚡ ${result.model}`;

  const warnBox = document.getElementById('aiWarningsBox');
  if (d.warnings && d.warnings.length) {
    warnBox.classList.remove('hidden');
    warnBox.innerHTML = d.warnings.map((w) => `<div>&bull; ${escHtml(w)}</div>`).join('');
  } else {
    warnBox.classList.add('hidden');
  }

  const chips = [];
  if (d.ticker) chips.push(`Ticker: <strong>${escHtml(d.ticker)}</strong>`);
  if (d.price) chips.push(`Harga: <strong>${fmtRp(d.price)}</strong>`);
  if (d.marketCapTrillion) chips.push(`MCap: <strong>Rp${escHtml(d.marketCapTrillion)}T</strong>`);
  if (d.roe !== null) chips.push(`ROE: <strong>${(d.roe * 100).toFixed(2)}%</strong>`);
  if (d.npm !== null) chips.push(`NPM: <strong>${(d.npm * 100).toFixed(2)}%</strong>`);
  if (d.der !== null) chips.push(`DER: <strong>${d.der.toFixed(2)}x</strong>`);
  if (d.epsTTM !== null) chips.push(`EPS TTM: <strong>${fmtRp(d.epsTTM)}</strong>`);
  if (d.bvps !== null) chips.push(`BVPS: <strong>${fmtRp(d.bvps)}</strong>`);
  if (d.ocf !== null && d.ocf !== undefined) chips.push(`OCF: <strong>${fmtNum(d.ocf, 0)} M</strong>`);
  if (d.fcf !== null && d.fcf !== undefined) chips.push(`FCF: <strong>${fmtNum(d.fcf, 0)} M</strong>`);
  document.getElementById('aiRatioChips').innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');

  if (d.history && d.history.length) {
    document.getElementById('aiHistoryPreview').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Tahun</th><th class="num">Penjualan (M)</th><th class="num">Laba Usaha (M)</th><th class="num">Laba Bersih (M)</th></tr></thead>
        <tbody>
          ${d.history
            .map(
              (h) => `<tr>
              <td class="font-semibold">${escHtml(h.year)}</td>
              <td class="num">${fmtNum(h.sales, 1)}</td>
              <td class="num">${fmtNum(h.op, 1)}</td>
              <td class="num">${fmtNum(h.ni, 1)}</td>
            </tr>`
            )
            .join('')}
        </tbody>
      </table>`;
  } else {
    document.getElementById('aiHistoryPreview').innerHTML =
      '<div class="text-xs text-muted">Tidak ada tabel tahunan yang terdeteksi (hanya rasio yang diperbarui).</div>';
  }
}

document.getElementById('btnRunAiParse').addEventListener('click', async () => {
  const text = document.getElementById('txtAiInput').value;
  if (!text.trim() && !pendingImageBase64) {
    return showToast('Tempel teks data atau screenshot terlebih dahulu');
  }

  const btn = document.getElementById('btnRunAiParse');
  btn.disabled = true;
  btn.textContent = 'Memproses...';

  try {
    const result = await smartExtractFinancials({
      text,
      imageBase64: pendingImageBase64,
      mimeType: pendingImageMime,
      currentTicker: state.ticker,
    });
    renderAiPreview(result);
  } catch (err) {
    showToast(err.message || 'Gagal memproses data');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#10024; Proses &amp; Rapikan Data';
  }
});

document.getElementById('btnApplyAiData').addEventListener('click', () => {
  if (!pendingAiData) return;
  const d = pendingAiData;

  if (d.ticker) state.ticker = d.ticker;
  if (d.name) state.name = d.name;
  if (d.price) state.price = d.price;
  if (d.marketCapTrillion) state.marketCap = d.marketCapTrillion;
  if (d.roe !== null) state.roe = d.roe;
  if (d.npm !== null) state.npm = d.npm;
  if (d.der !== null) state.der = d.der;
  if (d.epsTTM !== null) state.epsTTM = d.epsTTM;
  if (d.bvps !== null) state.bvps = d.bvps;
  if (d.ocf !== null && d.ocf !== undefined) state.ocf = d.ocf;
  if (d.fcf !== null && d.fcf !== undefined) state.fcf = d.fcf;
  if (d.pe3) state.pe3 = d.pe3;
  if (d.pe5) state.pe5 = d.pe5;
  if (d.pe10) state.pe10 = d.pe10;
  if (d.pbv3) state.pbv3 = d.pbv3;
  if (d.pbv5) state.pbv5 = d.pbv5;
  if (d.pbv10) state.pbv10 = d.pbv10;
  if (d.history && d.history.length >= 2) {
    state.history = clone(d.history);
    state.avgYearsLimit = 'all';
  }

  syncInputsFromState();
  renderAll();
  document.getElementById('modalPaste').classList.add('hidden');
  showToast(`Data ${state.ticker} berhasil dirapikan & diterapkan!`);
});

document.getElementById('btnCopyJson').addEventListener('click', () => {
  const txt = document.getElementById('txtJsonBox');
  txt.select();
  navigator.clipboard?.writeText(txt.value);
  showToast('JSON disalin ke clipboard');
});

document.getElementById('btnLoadJson').addEventListener('click', () => {
  try {
    const obj = JSON.parse(document.getElementById('txtJsonBox').value);
    if (!obj || typeof obj !== 'object' || Array.isArray(obj) || !Array.isArray(obj.history)) {
      throw new Error('Invalid');
    }
    const [normalized] = migrateStoredStocks([obj]);
    if (!normalized) throw new Error('Invalid');
    state = normalized;
    syncInputsFromState();
    renderAll();
    document.getElementById('modalPaste').classList.add('hidden');
    showToast(`JSON ${state.ticker || ''} dimuat`);
  } catch {
    showToast('Format JSON tidak valid');
  }
});

// Live & AI Settings Modal
document.getElementById('btnLiveSettings').addEventListener('click', () => {
  const s = loadLiveSettings();
  document.getElementById('selLiveProvider').value = s.provider;
  document.getElementById('inpGasUrl').value = s.gasUrl || '';
  document.getElementById('inpGeminiKey').value = loadLocalGeminiKey();
  document.getElementById('chkAutoSync').checked = !!s.autoSyncOnSelect;
  document.getElementById('chkSyncEpsBvps').checked = !!s.syncEpsBvps;
  document.getElementById('modalLive').classList.remove('hidden');
});

document.getElementById('btnSaveLiveSettings').addEventListener('click', () => {
  saveLiveSettings({
    provider: document.getElementById('selLiveProvider').value,
    gasUrl: document.getElementById('inpGasUrl').value.trim(),
    autoSyncOnSelect: document.getElementById('chkAutoSync').checked,
    syncEpsBvps: document.getElementById('chkSyncEpsBvps').checked,
  });
  saveLocalGeminiKey(document.getElementById('inpGeminiKey').value);
  document.getElementById('modalLive').classList.add('hidden');
  showToast('Pengaturan Live Data & AI disimpan');
});

document.getElementById('btnResetPresetPrices').addEventListener('click', () => {
  clearPresetOverrides();
  presetOverrides = {};
  for (const p of PRESETS) {
    if (!customStocks.some((c) => c.ticker === p.ticker)) {
      delete rowSyncStatus[p.ticker];
    }
  }
  const isCustomActive = customStocks.some((c) => c.id === state.id || c.ticker === state.ticker);
  if (!isCustomActive) {
    const rawPreset = PRESETS.find((p) => p.id === state.id || p.ticker === state.ticker);
    if (rawPreset) {
      state.price = rawPreset.price;
      state.marketCap = rawPreset.marketCap;
      delete state.lastSyncedAt;
      liveMeta = { status: 'preset', label: 'Preset' };
      syncInputsFromState();
    }
  }
  renderAll();
  showToast('Harga semua preset dikembalikan ke default spreadsheet');
});

// =========================================================================
// PILLAR B: BACKUP, EXPORT CSV & RESTORE WATCHLIST
// =========================================================================
let parsedBackupPreview = null;

function downloadBlobFile(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function updateBackupModalMeta() {
  const statusEl = document.getElementById('backupModalStorageStatus');
  const summaryEl = document.getElementById('backupExportSummary');
  const lastEl = document.getElementById('backupModalLastBackup');

  if (statusEl) {
    const persistText =
      isPersistentStorage === true
        ? 'Penyimpanan permanen: aktif'
        : isPersistentStorage === false
        ? 'Penyimpanan permanen: standar browser'
        : 'Penyimpanan lokal browser aktif';
    statusEl.textContent = `🔒 ${customStocks.length} saham custom tersimpan · ${Object.keys(presetOverrides).length} harga preset tersinkron · ${persistText}`;
  }

  if (summaryEl) {
    summaryEl.textContent = `Berisi ${customStocks.length} saham custom (LK Anda), ${Object.keys(presetOverrides).length} harga preset, ${favoriteIds.length} favorit & pengaturan. Gemini API key tidak disertakan.`;
  }

  if (lastEl) {
    lastEl.textContent = lastBackupAt
      ? `🕒 Backup terakhir: ${fmtDateTimeShort(lastBackupAt)} · Disarankan backup rutin setelah update LK.`
      : '🕒 Belum ada riwayat backup JSON di perangkat ini · Disarankan backup setelah update LK.';
  }
}

function refreshRestorePreview(rawText) {
  const prevBox = document.getElementById('backupRestorePreview');
  const applyBtn = document.getElementById('btnApplyBackupRestore');
  if (!rawText || !rawText.trim()) {
    parsedBackupPreview = null;
    prevBox.classList.add('hidden');
    applyBtn.disabled = true;
    return;
  }

  const parsed = parseBackup(rawText);
  prevBox.classList.remove('hidden');
  if (!parsed.ok) {
    parsedBackupPreview = null;
    prevBox.className = 'backup-preview is-err mt-2';
    prevBox.textContent = `⚠️ ${parsed.error}`;
    applyBtn.disabled = true;
    return;
  }

  parsedBackupPreview = parsed.backup;
  const stats = previewBackupMerge(customStocks, parsed.backup.customStocks);
  const ovCount = Object.keys(parsed.backup.presetOverrides || {}).length;
  prevBox.className = 'backup-preview is-ok mt-2';
  prevBox.innerHTML = `✅ Backup valid (schema v${parsed.backup.schemaVersion}) · <strong>${stats.totalIncoming} saham custom</strong> (${stats.added} baru, ${stats.updated} diperbarui, ${stats.skipped} dilewati)${
    ovCount > 0 ? ` · ${ovCount} harga preset` : ''
  }.`;
  applyBtn.disabled = false;
}

function openBackupModal() {
  updateBackupModalMeta();
  document.getElementById('txtBackupImport').value = '';
  document.getElementById('inpBackupFile').value = '';
  refreshRestorePreview('');
  document.getElementById('modalBackup').classList.remove('hidden');
}

document.getElementById('btnBackupModal').addEventListener('click', openBackupModal);
document.getElementById('btnQuickBackup').addEventListener('click', openBackupModal);

function createBackupPayloadAndRecord() {
  const nowIso = new Date().toISOString();
  const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const currentUiMode = document.body.classList.contains('mode-beginner') ? 'beginner' : 'pro';
  const payload = buildBackup({
    customStocks,
    presetOverrides,
    hiddenPresetIds,
    favoriteIds,
    uiMode: currentUiMode,
    theme: currentTheme,
    liveSettings: loadLiveSettings(),
    now: nowIso,
  });
  return { payload, nowIso, filename: formatBackupFilename(new Date(nowIso)) };
}

document.getElementById('btnDownloadBackupJson').addEventListener('click', () => {
  const { payload, nowIso, filename } = createBackupPayloadAndRecord();
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
  downloadBlobFile(blob, filename);
  lastBackupAt = nowIso;
  saveLastBackupAt(nowIso);
  updateBackupModalMeta();
  renderWatchlistOut();
  showToast(`Backup ${filename} diunduh`);
});

document.getElementById('btnShareBackupJson').addEventListener('click', async () => {
  const { payload, nowIso, filename } = createBackupPayloadAndRecord();
  const jsonStr = JSON.stringify(payload, null, 2);
  const blob = new Blob([jsonStr], { type: 'application/json' });
  const file = new File([blob], filename, { type: 'application/json' });

  let shared = false;
  if (typeof navigator !== 'undefined' && navigator.canShare?.({ files: [file] }) && navigator.share) {
    try {
      await navigator.share({ files: [file], title: 'Backup Watchlist DCF Lab' });
      shared = true;
    } catch (err) {
      if (err?.name === 'AbortError') return;
    }
  }

  if (!shared) {
    downloadBlobFile(blob, filename);
  }
  lastBackupAt = nowIso;
  saveLastBackupAt(nowIso);
  updateBackupModalMeta();
  renderWatchlistOut();
  showToast(shared ? 'Backup dibagikan' : `Backup ${filename} diunduh`);
});

document.getElementById('btnDownloadWatchlistCsv').addEventListener('click', () => {
  const csv = toWatchlistCsv(getAllStocks(), computeDCF);
  const blob = new Blob(['\uFEFF' + csv], { type: 'text/csv;charset=utf-8' });
  const pad = (n) => String(n).padStart(2, '0');
  const d = new Date();
  const fname = `dcf-watchlist-${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}.csv`;
  downloadBlobFile(blob, fname);
  showToast(`CSV ${fname} diunduh`);
});

document.getElementById('btnPickBackupFile').addEventListener('click', () => {
  document.getElementById('inpBackupFile').click();
});

document.getElementById('inpBackupFile').addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (!file) return;
  const reader = new FileReader();
  reader.onload = () => {
    const text = String(reader.result || '');
    document.getElementById('txtBackupImport').value = text;
    refreshRestorePreview(text);
  };
  reader.readAsText(file);
});

document.getElementById('txtBackupImport').addEventListener('input', (e) => {
  refreshRestorePreview(e.target.value);
});

document.getElementById('btnApplyBackupRestore').addEventListener('click', () => {
  if (!parsedBackupPreview) return;
  const mode = document.querySelector('input[name="backupRestoreMode"]:checked')?.value === 'replace' ? 'replace' : 'merge';

  const result = mergeBackup({
    currentCustomStocks: customStocks,
    incomingCustomStocks: parsedBackupPreview.customStocks,
    currentPresetOverrides: presetOverrides,
    incomingPresetOverrides: parsedBackupPreview.presetOverrides,
    currentHiddenPresetIds: hiddenPresetIds,
    incomingHiddenPresetIds: parsedBackupPreview.hiddenPresetIds,
    currentFavoriteIds: favoriteIds,
    incomingFavoriteIds: parsedBackupPreview.favoriteIds,
    mode,
  });

  customStocks = result.customStocks;
  presetOverrides = result.presetOverrides;
  hiddenPresetIds = result.hiddenPresetIds;
  favoriteIds = result.favoriteIds;

  saveWatchlist(customStocks);
  savePresetOverrides(presetOverrides);
  saveJsonList(HIDDEN_PRESETS_KEY, hiddenPresetIds);
  saveJsonList(FAVORITES_KEY, favoriteIds);

  if (mode === 'replace') {
    applyTheme(parsedBackupPreview.theme);
    applyUiMode(parsedBackupPreview.uiMode);
    if (parsedBackupPreview.liveSettings) {
      saveLiveSettings(parsedBackupPreview.liveSettings);
    }
  }

  // Refresh active state if its ticker exists in restored pool
  const refreshed = getAllStocks().find((s) => s.ticker === state.ticker || s.id === state.id);
  if (refreshed) {
    state = clone(refreshed);
    liveMeta = state.lastSyncedAt
      ? { status: 'live', label: `Live ${fmtTimeShort(state.lastSyncedAt)}` }
      : { status: 'preset', label: state.isCustom ? 'Watchlist' : 'Preset' };
    syncInputsFromState();
  }

  renderAll();
  document.getElementById('modalBackup').classList.add('hidden');
  showToast(
    mode === 'replace'
      ? `Restore selesai: ${customStocks.length} saham custom dimuat`
      : `Restore digabung: +${result.summary.added} baru, ${result.summary.updated} diperbarui`
  );
});

// =========================================================================
// PILLAR C: LAPORAN RINGKAS (PDF A4 & SHAREABLE CARD) + ROW ACTIONS (...)
// =========================================================================
let activeReportStock = null;
let activeReportRes = null;
let rowActionTarget = null;

function resolveStockTarget({ id, isCustom, ticker }) {
  if (isCustom) {
    return customStocks.find((c) => c.id === id || c.ticker === ticker) || null;
  }
  return getEffectivePresets().find((p) => p.id === id || p.ticker === ticker) || null;
}

function openRowActionsModal(target) {
  rowActionTarget = target;
  document.getElementById('rowActionsTitle').textContent = `Aksi — ${target.ticker}`;
  document.getElementById('modalRowActions').classList.remove('hidden');
}

function openReportModal(stockItem) {
  if (!stockItem) return;
  activeReportStock = clone(stockItem);
  activeReportRes = computeDCF(activeReportStock);

  const ticker = String(activeReportStock.ticker || 'IDX').toUpperCase();
  document.getElementById('reportModalTitle').textContent = `📄 Laporan Ringkas — ${ticker}`;
  document.getElementById('reportStockSummary').textContent = `${ticker} (${activeReportStock.name || ticker}) · FV ${fmtRp(activeReportRes.fvFinal)} · MoS ${fmtPct(activeReportRes.mos, 1)}`;

  const currentTheme = document.documentElement.classList.contains('dark') ? 'dark' : 'light';
  const canvas = document.getElementById('shareCardCanvas');
  renderShareCardCanvas(canvas, activeReportStock, activeReportRes, { theme: currentTheme });

  document.getElementById('modalReport').classList.remove('hidden');
}

document.getElementById('btnOpenReport').addEventListener('click', () => {
  openReportModal(state);
});

document.getElementById('btnRowActionReport').addEventListener('click', () => {
  if (!rowActionTarget) return;
  const src = resolveStockTarget(rowActionTarget);
  document.getElementById('modalRowActions').classList.add('hidden');
  if (src) openReportModal({ ...src, isCustom: rowActionTarget.isCustom });
});

document.getElementById('btnRowActionEdit').addEventListener('click', () => {
  if (!rowActionTarget) return;
  const src = resolveStockTarget(rowActionTarget);
  document.getElementById('modalRowActions').classList.add('hidden');
  if (src) {
    state = clone(src);
    liveMeta = state.lastSyncedAt
      ? { status: 'live', label: `Live ${fmtTimeShort(state.lastSyncedAt)}` }
      : { status: 'preset', label: rowActionTarget.isCustom ? 'Watchlist' : 'Preset' };
    syncInputsFromState();
    renderAll();
    setStep('step1');
    showToast(`Mengedit ${state.ticker} — klik Simpan setelah selesai`);
  }
});

document.getElementById('btnRowActionDelete').addEventListener('click', () => {
  if (!rowActionTarget) return;
  const { id: delId, ticker: delTicker, isCustom: isCust } = rowActionTarget;
  document.getElementById('modalRowActions').classList.add('hidden');

  if (isCust) {
    customStocks = customStocks.filter((c) => c.id !== delId);
    saveWatchlist(customStocks);
    const matchPreset = PRESETS.find((p) => p.ticker === delTicker);
    if (matchPreset && !hiddenPresetIds.includes(matchPreset.id)) {
      hiddenPresetIds.push(matchPreset.id);
      saveJsonList(HIDDEN_PRESETS_KEY, hiddenPresetIds);
    }
  } else {
    if (!hiddenPresetIds.includes(delId)) {
      hiddenPresetIds.push(delId);
      saveJsonList(HIDDEN_PRESETS_KEY, hiddenPresetIds);
    }
  }
  renderAll();
  showToast(`${delTicker} dihapus dari Watchlist`);
});

document.getElementById('btnPrintReportPdf').addEventListener('click', () => {
  if (!activeReportStock || !activeReportRes) return;
  const container = document.getElementById('printReport');
  container.innerHTML = buildPrintReportHtml(activeReportStock, activeReportRes);
  window.print();
});

function exportReportCardPng(preferShare = false) {
  const canvas = document.getElementById('shareCardCanvas');
  if (!canvas || !activeReportStock) return;
  const ticker = String(activeReportStock.ticker || 'IDX').toUpperCase();
  const filename = `${ticker}-dcf-card.png`;

  canvas.toBlob(async (blob) => {
    if (!blob) return showToast('Gagal membuat gambar PNG');
    if (preferShare && typeof navigator !== 'undefined' && navigator.share) {
      const file = new File([blob], filename, { type: 'image/png' });
      if (navigator.canShare?.({ files: [file] })) {
        try {
          await navigator.share({ files: [file], title: `Valuasi ${ticker} — DCF Lab` });
          return;
        } catch (err) {
          if (err?.name === 'AbortError') return;
        }
      }
    }
    downloadBlobFile(blob, filename);
    showToast(`Card ${filename} disimpan`);
  }, 'image/png');
}

document.getElementById('btnShareReportCard').addEventListener('click', () => exportReportCardPng(true));
document.getElementById('btnDownloadReportCard').addEventListener('click', () => exportReportCardPng(false));

// V3: Stale Data Update Button
document.getElementById('btnUpdateStaleAi').addEventListener('click', () => openAiModal('ai'));

// V3: Quick Growth Preset Buttons (Konservatif / Moderat / Optimis)
document.querySelectorAll('.gpreset-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    const res = computeDCF(state);
    const cagr = res.cagr !== null && res.cagr > 0 ? res.cagr : 0.08;
    const kind = btn.dataset.gpreset;
    document.querySelectorAll('.gpreset-btn').forEach((b) => b.classList.toggle('active', b === btn));

    if (kind === 'conservative') {
      state.g1 = Number(Math.max(0.03, Math.min(0.08, cagr * 0.5)).toFixed(3));
      state.g2 = 0.02;
      state.optimism = 0.3;
    } else if (kind === 'moderate') {
      state.g1 = Number(Math.max(0.05, Math.min(0.12, cagr * 0.75)).toFixed(3));
      state.g2 = 0.02;
      state.optimism = 0.5;
    } else {
      state.g1 = Number(Math.max(0.08, Math.min(0.18, cagr * 1.0)).toFixed(3));
      state.g2 = 0.03;
      state.optimism = 0.7;
    }
    syncInputsFromState();
    renderAll();
    showToast(`Skenario ${btn.textContent} diterapkan (Growth ${(state.g1 * 100).toFixed(1)}%)`);
  })
);

// V3: AI Jelaskan Valuasi Ini (Gemini 3.1 Flash-Lite + Local Coach Fallback)
document.getElementById('btnExplainAi').addEventListener('click', async () => {
  const btn = document.getElementById('btnExplainAi');
  const box = document.getElementById('aiExplainBox');
  btn.disabled = true;
  btn.textContent = 'Menganalisa...';

  try {
    const res = computeDCF(state);
    const out = await explainValuationAI(state, res);
    lastExplainTicker = state.ticker;
    box.classList.remove('hidden');
    box.innerHTML = `
      <div class="ai-explain-item">
        <h4>1. Kesimpulan Cepat (${escHtml(out.model)})</h4>
        <p>${escHtml(out.data.summary)}</p>
      </div>
      <div class="ai-explain-item">
        <h4>2. Kekuatan Bisnis</h4>
        <p>${escHtml(out.data.strengths)}</p>
      </div>
      <div class="ai-explain-item">
        <h4>3. Risiko yang Perlu Dicek</h4>
        <p>${escHtml(out.data.risks)}</p>
      </div>
      <div class="ai-explain-item">
        <h4>4. Langkah Selanjutnya</h4>
        <p>${escHtml(out.data.nextSteps)}</p>
      </div>
    `;
  } catch (err) {
    showToast(err.message || 'Gagal membuat penjelasan');
  } finally {
    btn.disabled = false;
    btn.innerHTML = '&#10024; Jelaskan Valuasi Ini';
  }
});

// Init — Smart Landing opens on Step 3 (Ringkasan & Analisa) for preset
syncInputsFromState();
setStep('step3');
setOutTab('overview');
renderAll();

