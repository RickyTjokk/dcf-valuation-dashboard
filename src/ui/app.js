import { BETA_SCALE, DEFAULT_INF, computeDCF, getStatBadge } from '../engine/dcfEngine.js';
import { PRESETS } from '../data/presets15.js';
import { renderTickerLogoHtml } from '../data/tickerLogos.js';
import { fetchLiveQuote, loadLiveSettings, saveLiveSettings } from '../services/marketApi.js';
import { smartExtractFinancials, loadLocalGeminiKey, saveLocalGeminiKey } from '../services/smartParser.js';
import { explainValuationAI } from '../services/aiAdvisor.js';
import { renderPriceGauge, renderBetaChart, renderDcfChart, renderHistoryChart } from './charts.js';

const STORAGE_KEY = 'dcf_lab_watchlist_v2';
const HIDDEN_PRESETS_KEY = 'dcf_lab_hidden_presets_v4';
const FAVORITES_KEY = 'dcf_lab_favorites_v4';
const THEME_KEY = 'dcf_lab_theme_v2';
const MODE_KEY = 'dcf_lab_ui_mode_v3';
const clone = (o) => JSON.parse(JSON.stringify(o));

const fmtRp = (v) => (isFinite(v) ? 'Rp ' + Math.round(v).toLocaleString('id-ID') : '-');
const fmtNum = (v, d = 2) =>
  isFinite(v)
    ? Number(v).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })
    : '-';
const fmtPct = (v, d = 1) => (isFinite(v) ? (v * 100).toFixed(d) + '%' : '-');

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
let watchlistFilter = 'all';

let state = clone(PRESETS[0]);
let liveMeta = { status: 'preset', label: 'Preset' }; // 'preset' | 'live' | 'manual' | 'loading' | 'offline'
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
  const customTickers = new Set(customStocks.map((c) => c.ticker));
  return [
    ...customStocks.map((c) => ({ ...c, isCustom: true })),
    ...PRESETS.filter((p) => !hiddenPresetIds.includes(p.id) && !customTickers.has(p.ticker)).map((p) => ({
      ...p,
      isCustom: false,
    })),
  ];
}

function renderPickerList(query = '') {
  const listEl = document.getElementById('pickerList');
  const q = query.trim().toLowerCase();
  const items = getAllStocks().filter(
    (s) => s.ticker.toLowerCase().includes(q) || (s.name || '').toLowerCase().includes(q)
  );

  let html = items
    .map((s) => {
      const active = s.id === state.id ? 'active' : '';
      const yr = s.history?.[0]?.year || '-';
      return `
        <button type="button" class="picker-item ${active}" data-pickid="${s.id}" data-iscustom="${s.isCustom}">
          <div class="ticker-cell">
            ${renderTickerLogoHtml(s.ticker, 24)}
            <div>
              <strong>${s.ticker}</strong>
              <span class="picker-item-sub">(${yr}) &middot; ${s.name}</span>
            </div>
          </div>
          <span class="picker-item-sub tabular-nums">${s.isCustom ? 'Saya' : fmtRp(s.price)}</span>
        </button>`;
    })
    .join('');

  if (q && !items.some((s) => s.ticker.toLowerCase() === q)) {
    const cleanNew = q.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
    if (cleanNew.length >= 2) {
      html += `
        <button type="button" class="picker-item" data-newticker="${cleanNew}">
          <div><strong>+ Analisa Ticker Baru: ${cleanNew}</strong></div>
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
          <td><input data-hidx="${idx}" data-field="year" type="number" value="${row.year}" style="width:66px" class="tabular-nums" /></td>
          <td class="num"><input data-hidx="${idx}" data-field="sales" type="number" step="any" value="${row.sales}" style="width:92px;text-align:right" class="tabular-nums" /></td>
          <td class="num"><input data-hidx="${idx}" data-field="op" type="number" step="any" value="${row.op}" style="width:86px;text-align:right" class="tabular-nums" /></td>
          <td class="num"><input data-hidx="${idx}" data-field="ni" type="number" step="any" value="${row.ni}" style="width:86px;text-align:right" class="tabular-nums" /></td>
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
  setMiniBadge('badgeDer', getStatBadge('der', state.der));
  setMiniBadge('badgeNpm', getStatBadge('npm', state.npm));

  // Patokan CAGR di Step 2
  const cagrPct = res.cagr !== null ? (res.cagr * 100).toFixed(1) + '%' : 'N/A';
  const recCons = res.cagr !== null ? Math.max(3, Math.min(10, Math.round(res.cagr * 50))) : 5;
  document.getElementById('cagrGuideText').innerHTML =
    `CAGR laba historis: <strong>${cagrPct}</strong> &mdash; patokan aman value investor biasanya sekitar <strong>${recCons}%–12%</strong>.`;

  // History Chart in Step 1
  renderHistoryChart(document.getElementById('step1HistoryChart'), { history: state.history });

  // Relative sub-lists
  document.getElementById('relPeList').innerHTML = res.peItems
    .map((x) => `<div><span>${x.label}</span><span>${x.val > 0 ? fmtRp(x.val) : '-'}</span></div>`)
    .join('');
  document.getElementById('relPbvList').innerHTML = res.pbvItems
    .map((x) => `<div><span>${x.label}</span><span>${x.val > 0 ? fmtRp(x.val) : '-'}</span></div>`)
    .join('');

  // HERO VALUATION VERDICT (2-SIDED: QUALITY GRADE + VALUATION)
  const gradeEl = document.getElementById('kpiGradeBadge');
  gradeEl.textContent = res.qualityGrade;
  if (res.qualityGrade === 'A' || res.qualityGrade === 'B') {
    gradeEl.style.background = 'var(--emerald-soft)';
    gradeEl.style.color = 'var(--emerald)';
  } else if (res.qualityGrade === 'C') {
    gradeEl.style.background = 'var(--amber-soft)';
    gradeEl.style.color = 'var(--amber)';
  } else {
    gradeEl.style.background = 'var(--rose-soft)';
    gradeEl.style.color = 'var(--rose)';
  }
  document.getElementById('kpiQualityScore').textContent = `${res.qualityScore} / 100`;
  document.getElementById('kpiQualityLabel').textContent = res.qualityLabel;

  document.getElementById('heroMethodHint').textContent = state.includeRel ? 'DCF + Relative' : 'Intrinsic Only';
  document.getElementById('kpiFV').textContent = fmtRp(res.fvFinal);
  document.getElementById('kpiFVSub').textContent = state.includeRel
    ? `Intrinsic: ${fmtRp(res.iv)} · Relative: ${fmtRp(res.rv)}`
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
  renderWatchlistOut();
}

function renderOverviewOut(res) {
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

  document.getElementById('overviewKpiChips').innerHTML = `
    <span class="chip">Intrinsic: <strong>${fmtRp(res.iv)}</strong></span>
    <span class="chip">Relative: <strong>${state.includeRel ? fmtRp(res.rv) : 'Off'}</strong></span>
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
  document.getElementById('diagnosticContent').innerHTML = `
    <p><strong>${state.ticker}</strong> mendapat <strong>Kualitas Grade ${res.qualityGrade} (${res.qualityScore}/100)</strong> dengan <strong>Discount Rate ${(res.dr * 100).toFixed(2)}%</strong>.</p>
    <p>&bull; Faktor terkuat (menekan risiko): <strong>${strongest.label}</strong> (${strongest.fmt(strongest.val)} &rarr; Beta <strong>${strongest.beta.toFixed(2)}</strong>).</p>
    <p>&bull; Faktor paling berisiko (menaikkan discount rate): <strong>${riskiest.label}</strong> (${riskiest.fmt(riskiest.val)} &rarr; Beta <strong>${riskiest.beta.toFixed(2)}</strong>).</p>
    <p>&bull; EPS Dasar <strong>${fmtRp(res.epsBase)}</strong> diproyeksikan tumbuh <strong>${(state.g1 * 100).toFixed(1)}%</strong> (0–10 thn) dan <strong>${(state.g2 * 100).toFixed(1)}%</strong> (&gt;10 thn).</p>
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

function renderWatchlistOut() {
  const restoreBtn = document.getElementById('btnRestorePresets');
  if (hiddenPresetIds.length > 0) {
    restoreBtn.classList.remove('hidden');
    restoreBtn.textContent = `Pulihkan Preset (${hiddenPresetIds.length})`;
  } else {
    restoreBtn.classList.add('hidden');
  }

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
    if (sortBy === 'qualityDesc') return b.r.qualityScore - a.r.qualityScore;
    if (sortBy === 'drAsc') return a.r.dr - b.r.dr;
    return a.item.ticker.localeCompare(b.item.ticker);
  });

  if (!combined.length) {
    document.getElementById('watchlistTbody').innerHTML =
      '<tr><td colspan="9" class="center text-muted" style="padding:24px">Tidak ada emiten pada filter ini.</td></tr>';
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
      return `
        <tr style="cursor:pointer;${isCur ? 'background:var(--surface-subtle);font-weight:700' : ''}" data-loadid="${item.id}" data-iscustom="${item.isCustom}">
          <td>
            <div class="ticker-cell">
              ${renderTickerLogoHtml(item.ticker, 30)}
              <div>
                <div>
                  <strong>${item.ticker}</strong>
                  ${item.isCustom ? '<span class="hint-chip">Saya</span>' : ''}
                </div>
                <div class="text-xs text-muted">${item.name}</div>
                ${item.note ? `<div class="note-line">${item.note}</div>` : ''}
              </div>
            </div>
          </td>
          <td class="center"><span class="mini-badge ${gTone}">Grade ${r.qualityGrade} (${r.qualityScore})</span></td>
          <td class="center"><span class="mini-badge ${r.isStaleData ? 'amber' : 'muted'}">LK ${r.dataYear || '-'}</span></td>
          <td class="num tabular-nums">${fmtRp(item.price)}</td>
          <td class="num tabular-nums">${(r.dr * 100).toFixed(1)}%</td>
          <td class="num tabular-nums">${fmtRp(r.iv)}</td>
          <td class="num tabular-nums">${fmtRp(r.fvFinal)}</td>
          <td class="num tabular-nums font-bold" style="color:${mosColor}">${(r.mos * 100).toFixed(1)}%</td>
          <td class="center">
            <div class="action-group">
              <button type="button" class="btn-icon-sm fav-btn ${isFav ? 'active' : ''}" data-favticker="${item.ticker}" title="Favorit">&#9733;</button>
              <button type="button" class="btn-icon-sm" data-editid="${item.id}" data-iscustom="${item.isCustom}" title="Edit Data">&#9998;</button>
              <button type="button" class="btn-icon-sm del-btn" data-delid="${item.id}" data-iscustom="${item.isCustom}" data-delticker="${item.ticker}" title="Hapus dari Watchlist">&#128465;</button>
            </div>
          </td>
        </tr>`;
    })
    .join('');
}

// =========================================================================
// NAVIGATION & EVENTS
// =========================================================================
function setStep(step) {
  activeStep = step;
  document.querySelectorAll('.step-btn').forEach((b) => {
    b.classList.toggle('active', b.dataset.step === step);
  });
  document.querySelectorAll('.step-view').forEach((v) => {
    v.classList.toggle('hidden', v.id !== 'view-' + step);
  });
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

document.querySelectorAll('.step-btn').forEach((b) => b.addEventListener('click', () => setStep(b.dataset.step)));
document.querySelectorAll('.next-step-btn').forEach((b) => b.addEventListener('click', () => setStep(b.dataset.goto)));
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
  const src = isCust ? customStocks.find((c) => c.id === id) : PRESETS.find((p) => p.id === id);
  if (src) {
    state = clone(src);
    liveMeta = { status: 'preset', label: isCust ? 'Watchlist' : 'Preset' };
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

document.getElementById('btnSaveWatchlist').addEventListener('click', () => {
  const cleanTicker = (state.ticker || 'NEW').trim().toUpperCase();
  state.ticker = cleanTicker;
  if (!state.id || !state.id.startsWith('CUSTOM_')) state.id = 'CUSTOM_' + cleanTicker;
  const idx = customStocks.findIndex((c) => c.id === state.id || c.ticker === cleanTicker);
  if (idx >= 0) customStocks[idx] = clone(state);
  else customStocks.unshift(clone(state));
  saveWatchlist(customStocks);
  renderAll();
  showToast(`${cleanTicker} tersimpan di Watchlist`);
});

document.getElementById('btnReset').addEventListener('click', () => {
  const orig = PRESETS.find((p) => p.id === state.id) || PRESETS[0];
  state = clone(orig);
  liveMeta = { status: 'preset', label: 'Preset' };
  syncInputsFromState();
  renderAll();
  showToast(`Data ${state.ticker} di-reset`);
});

// Batch Refresh Watchlist
document.getElementById('btnRefreshAllWatchlist').addEventListener('click', async () => {
  const btn = document.getElementById('btnRefreshAllWatchlist');
  btn.disabled = true;
  btn.textContent = 'Memperbarui...';
  const settings = loadLiveSettings();
  let ok = 0;

  const list = getAllStocks();
  for (const item of list) {
    try {
      const q = await fetchLiveQuote(item.ticker, { force: true });
      const target =
        customStocks.find((c) => c.id === item.id) || PRESETS.find((p) => p.id === item.id);
      if (target && typeof q.price === 'number' && q.price > 0) {
        const oldShares =
          target.sharesOverride || (target.price > 0 ? (target.marketCap / target.price) * 1000 : 0);
        target.price = q.price;
        if (typeof q.marketCapTrillion === 'number' && q.marketCapTrillion > 0) {
          target.marketCap = Number(q.marketCapTrillion.toFixed(4));
        } else if (oldShares > 0) {
          target.marketCap = Number(((q.price * oldShares) / 1000).toFixed(4));
        }
        if (settings.syncEpsBvps && typeof q.epsTTM === 'number' && q.epsTTM > 0) {
          target.epsTTM = Number(q.epsTTM.toFixed(2));
        }
        ok++;
      }
    } catch {}
  }

  if (customStocks.length) saveWatchlist(customStocks);
  renderAll();
  btn.disabled = false;
  btn.textContent = 'Refresh Semua Harga Live';
  showToast(ok > 0 ? `${ok} emiten berhasil diperbarui live` : 'Gagal terhubung ke live API');
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

  const editBtn = e.target.closest('[data-editid]');
  if (editBtn) {
    e.stopPropagation();
    const loadId = editBtn.dataset.editid;
    const isCust = editBtn.dataset.iscustom === 'true';
    const src = isCust ? customStocks.find((c) => c.id === loadId) : PRESETS.find((p) => p.id === loadId);
    if (src) {
      state = clone(src);
      liveMeta = { status: 'preset', label: isCust ? 'Watchlist' : 'Preset' };
      syncInputsFromState();
      renderAll();
      setStep('step1');
      showToast(`Mengedit ${state.ticker} — klik Simpan setelah selesai`);
    }
    return;
  }

  const delBtn = e.target.closest('[data-delid]');
  if (delBtn) {
    e.stopPropagation();
    const delId = delBtn.dataset.delid;
    const delTicker = delBtn.dataset.delticker;
    const isCust = delBtn.dataset.iscustom === 'true';

    if (isCust) {
      customStocks = customStocks.filter((c) => c.id !== delId);
      saveWatchlist(customStocks);
      // Also hide matching preset if user had overridden a preset
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
    return showToast(`${delTicker} dihapus dari Watchlist`);
  }

  const tr = e.target.closest('tr[data-loadid]');
  if (!tr) return;
  const loadId = tr.dataset.loadid;
  const isCust = tr.dataset.iscustom === 'true';
  const src = isCust ? customStocks.find((c) => c.id === loadId) : PRESETS.find((p) => p.id === loadId);
  if (src) {
    state = clone(src);
    liveMeta = { status: 'preset', label: isCust ? 'Watchlist' : 'Preset' };
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
    warnBox.innerHTML = d.warnings.map((w) => `<div>&bull; ${w}</div>`).join('');
  } else {
    warnBox.classList.add('hidden');
  }

  const chips = [];
  if (d.ticker) chips.push(`Ticker: <strong>${d.ticker}</strong>`);
  if (d.price) chips.push(`Harga: <strong>${fmtRp(d.price)}</strong>`);
  if (d.marketCapTrillion) chips.push(`MCap: <strong>Rp${d.marketCapTrillion}T</strong>`);
  if (d.roe !== null) chips.push(`ROE: <strong>${(d.roe * 100).toFixed(2)}%</strong>`);
  if (d.npm !== null) chips.push(`NPM: <strong>${(d.npm * 100).toFixed(2)}%</strong>`);
  if (d.der !== null) chips.push(`DER: <strong>${d.der.toFixed(2)}x</strong>`);
  if (d.epsTTM !== null) chips.push(`EPS TTM: <strong>${fmtRp(d.epsTTM)}</strong>`);
  if (d.bvps !== null) chips.push(`BVPS: <strong>${fmtRp(d.bvps)}</strong>`);
  document.getElementById('aiRatioChips').innerHTML = chips.map((c) => `<span class="chip">${c}</span>`).join('');

  if (d.history && d.history.length) {
    document.getElementById('aiHistoryPreview').innerHTML = `
      <table class="data-table">
        <thead><tr><th>Tahun</th><th class="num">Penjualan (M)</th><th class="num">Laba Usaha (M)</th><th class="num">Laba Bersih (M)</th></tr></thead>
        <tbody>
          ${d.history
            .map(
              (h) => `<tr>
              <td class="font-semibold">${h.year}</td>
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
    if (!obj || !Array.isArray(obj.history)) throw new Error('Invalid');
    state = obj;
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
        <h4>1. Kesimpulan Cepat (${out.model})</h4>
        <p>${out.data.summary}</p>
      </div>
      <div class="ai-explain-item">
        <h4>2. Kekuatan Bisnis</h4>
        <p>${out.data.strengths}</p>
      </div>
      <div class="ai-explain-item">
        <h4>3. Risiko yang Perlu Dicek</h4>
        <p>${out.data.risks}</p>
      </div>
      <div class="ai-explain-item">
        <h4>4. Langkah Selanjutnya</h4>
        <p>${out.data.nextSteps}</p>
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

