import { getTickerColor } from '../data/tickerLogos.js';

const MONTHS_ID = ['Jan', 'Feb', 'Mar', 'Apr', 'Mei', 'Jun', 'Jul', 'Agt', 'Sep', 'Okt', 'Nov', 'Des'];

function fmtDateShort(dateInput = new Date()) {
  const d = dateInput instanceof Date ? dateInput : new Date(dateInput);
  if (Number.isNaN(d.getTime())) return '-';
  return `${d.getDate()} ${MONTHS_ID[d.getMonth()]} ${d.getFullYear()}`;
}

function fmtRp(v) {
  return Number.isFinite(v) ? 'Rp ' + Math.round(v).toLocaleString('id-ID') : '-';
}

function fmtPct(v, d = 1) {
  return Number.isFinite(v) ? (v * 100).toFixed(d) + '%' : '-';
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function drawRoundRect(ctx, x, y, w, h, r) {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.lineTo(x + w - radius, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + radius);
  ctx.lineTo(x + w, y + h - radius);
  ctx.quadraticCurveTo(x + w, y + h, x + w - radius, y + h);
  ctx.lineTo(x + radius, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - radius);
  ctx.lineTo(x, y + radius);
  ctx.quadraticCurveTo(x, y, x + radius, y);
  ctx.closePath();
}

function fitText(ctx, text, maxWidth) {
  const raw = String(text || '');
  if (ctx.measureText(raw).width <= maxWidth) return raw;
  let trimmed = raw;
  while (trimmed.length > 3 && ctx.measureText(trimmed + '…').width > maxWidth) {
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed + '…';
}

function wrapLines(ctx, text, maxWidth, maxLines = 2) {
  const words = String(text || '').split(/\s+/).filter(Boolean);
  const lines = [];
  let current = '';
  let truncated = false;
  for (const w of words) {
    const candidate = current ? `${current} ${w}` : w;
    if (ctx.measureText(candidate).width <= maxWidth) {
      current = candidate;
    } else {
      if (current) lines.push(current);
      current = w;
      if (lines.length >= maxLines) {
        truncated = true;
        break;
      }
    }
  }
  if (current && lines.length < maxLines) lines.push(current);
  if (lines.length === maxLines && words.length > 0) {
    const last = lines[maxLines - 1];
    lines[maxLines - 1] = fitText(ctx, truncated && !last.endsWith('…') ? `${last}…` : last, maxWidth);
  }
  return lines;
}

/**
 * Pure <canvas> 1080x1350 Shareable Valuation Card.
 * Uses deterministic monogram badge so canvas export is never CORS-tainted.
 */
export function renderShareCardCanvas(canvas, stock, res, { theme = 'light', now = new Date() } = {}) {
  if (!canvas || !stock || !res) return;
  const W = 1080;
  const H = 1350;
  canvas.width = W;
  canvas.height = H;

  const ctx = canvas.getContext('2d');
  if (!ctx) return;

  const isDark = theme === 'dark';
  const P = isDark
    ? {
        bg: '#0b1120',
        surface: '#111827',
        subtle: '#1e293b',
        border: '#263244',
        text: '#f8fafc',
        muted: '#94a3b8',
        emerald: '#10b981',
        emeraldSoft: 'rgba(16, 185, 129, 0.16)',
        amber: '#f59e0b',
        amberSoft: 'rgba(245, 158, 11, 0.16)',
        rose: '#f43f5e',
        roseSoft: 'rgba(244, 63, 94, 0.16)',
        brandBg: '#10b981',
        brandText: '#052e16',
      }
    : {
        bg: '#f8fafc',
        surface: '#ffffff',
        subtle: '#f1f5f9',
        border: '#e2e8f0',
        text: '#0f172a',
        muted: '#64748b',
        emerald: '#059669',
        emeraldSoft: 'rgba(16, 185, 129, 0.14)',
        amber: '#d97706',
        amberSoft: 'rgba(217, 119, 6, 0.14)',
        rose: '#e11d48',
        roseSoft: 'rgba(225, 29, 72, 0.14)',
        brandBg: '#0f172a',
        brandText: '#ffffff',
      };

  const FONT = '"Plus Jakarta Sans", -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif';
  const ticker = String(stock.ticker || 'IDX').toUpperCase();
  const dateLabel = fmtDateShort(now);

  // Background
  ctx.fillStyle = P.bg;
  ctx.fillRect(0, 0, W, H);

  // Subtle top ambient gradient
  const grad1 = ctx.createRadialGradient(220, 40, 20, 220, 40, 520);
  grad1.addColorStop(0, isDark ? 'rgba(16, 185, 129, 0.18)' : 'rgba(16, 185, 129, 0.12)');
  grad1.addColorStop(1, 'rgba(16, 185, 129, 0)');
  ctx.fillStyle = grad1;
  ctx.fillRect(0, 0, W, 620);

  const grad2 = ctx.createRadialGradient(880, 90, 20, 880, 90, 460);
  grad2.addColorStop(0, isDark ? 'rgba(14, 165, 233, 0.14)' : 'rgba(14, 165, 233, 0.10)');
  grad2.addColorStop(1, 'rgba(14, 165, 233, 0)');
  ctx.fillStyle = grad2;
  ctx.fillRect(0, 0, W, 560);

  // 1. Top Brand Row
  const padX = 64;
  drawRoundRect(ctx, padX, 56, 76, 44, 12);
  ctx.fillStyle = P.brandBg;
  ctx.fill();
  ctx.fillStyle = P.brandText;
  ctx.font = `800 20px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('DCF', padX + 38, 79);

  ctx.textAlign = 'left';
  ctx.fillStyle = P.text;
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText('DCF Valuation Lab', padX + 94, 79);

  // Right LK source pill
  const lkTag = `LK ${res.dataYear || '-'}${stock.isBankMode ? ' · Mode Bank' : ''}`;
  ctx.font = `700 20px ${FONT}`;
  const pillW = Math.max(150, ctx.measureText(lkTag).width + 38);
  drawRoundRect(ctx, W - padX - pillW, 56, pillW, 44, 22);
  ctx.fillStyle = P.surface;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 2;
  ctx.stroke();
  ctx.fillStyle = P.muted;
  ctx.textAlign = 'center';
  ctx.fillText(lkTag, W - padX - pillW / 2, 79);

  // 2. Ticker Identity
  const idY = 148;
  drawRoundRect(ctx, padX, idY, 108, 108, 26);
  ctx.fillStyle = getTickerColor(ticker);
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = `800 30px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(ticker.slice(0, 4), padX + 54, idY + 56);

  ctx.textAlign = 'left';
  ctx.fillStyle = P.text;
  ctx.font = `800 58px ${FONT}`;
  ctx.fillText(ticker, padX + 134, idY + 34);

  ctx.fillStyle = P.muted;
  ctx.font = `600 28px ${FONT}`;
  ctx.fillText(fitText(ctx, stock.name || ticker, W - padX * 2 - 140), padX + 134, idY + 84);

  // 3. Price vs Fair Value Hero Box
  const heroY = 296;
  const heroH = 228;
  drawRoundRect(ctx, padX, heroY, W - padX * 2, heroH, 28);
  ctx.fillStyle = P.surface;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  const mosColor = res.mos >= 0.3 ? P.emerald : res.mos >= 0 ? P.amber : P.rose;
  const mosSoft = res.mos >= 0.3 ? P.emeraldSoft : res.mos >= 0 ? P.amberSoft : P.roseSoft;

  ctx.textAlign = 'left';
  ctx.fillStyle = P.muted;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('HARGA PASAR', padX + 40, heroY + 52);

  ctx.fillStyle = P.text;
  ctx.font = `800 48px ${FONT}`;
  ctx.fillText(fmtRp(Number(stock.price) || 0), padX + 40, heroY + 114);

  // Center arrow
  ctx.textAlign = 'center';
  ctx.fillStyle = P.muted;
  ctx.font = `700 42px ${FONT}`;
  ctx.fillText('→', W / 2 - 12, heroY + 112);

  // Fair Value right
  ctx.textAlign = 'right';
  ctx.fillStyle = P.muted;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('HARGA WAJAR (FINAL)', W - padX - 40, heroY + 52);

  ctx.fillStyle = mosColor;
  ctx.font = `800 52px ${FONT}`;
  ctx.fillText(fmtRp(res.fvFinal), W - padX - 40, heroY + 114);

  // Divider + active methods line
  ctx.beginPath();
  ctx.moveTo(padX + 40, heroY + 166);
  ctx.lineTo(W - padX - 40, heroY + 166);
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 1.5;
  ctx.stroke();

  const activeMethods = ['DCF 100Y'];
  if (stock.includeRel && res.rv > 0) activeMethods.push('Relative');
  if (stock.includeDdm && res.ddmValue > 0) activeMethods.push('DDM');
  if (stock.includeLynch && res.lynchValue > 0) activeMethods.push('Lynch');

  ctx.textAlign = 'left';
  ctx.fillStyle = P.muted;
  ctx.font = `600 21px ${FONT}`;
  ctx.fillText(
    `Metode: ${activeMethods.join(' + ')}  ·  Discount Rate ${fmtPct(res.dr, 2)}`,
    padX + 40,
    heroY + 198
  );

  // 4. Middle Row: MoS Semi-circular Gauge (Left) + Quality Grade (Right)
  const midY = 556;
  const midH = 290;
  const leftW = 610;
  const gap = 24;
  const rightW = W - padX * 2 - leftW - gap;

  // Left: MoS Gauge Card
  drawRoundRect(ctx, padX, midY, leftW, midH, 28);
  ctx.fillStyle = P.surface;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = P.muted;
  ctx.font = `700 22px ${FONT}`;
  ctx.fillText('MARGIN OF SAFETY', padX + 36, midY + 46);

  const cx = padX + leftW / 2;
  const cy = midY + 216;
  const arcR = 132;

  ctx.lineWidth = 26;
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, Math.PI, Math.PI * 2, false);
  ctx.strokeStyle = P.subtle;
  ctx.stroke();

  const clampedNorm = Math.max(0.03, Math.min(1, (res.mos + 0.4) / 1.0));
  ctx.beginPath();
  ctx.arc(cx, cy, arcR, Math.PI, Math.PI + Math.PI * clampedNorm, false);
  ctx.strokeStyle = mosColor;
  ctx.stroke();

  const mosSign = res.mos > 0 ? '+' : '';
  ctx.textAlign = 'center';
  ctx.fillStyle = mosColor;
  ctx.font = `800 54px ${FONT}`;
  ctx.fillText(`${mosSign}${(res.mos * 100).toFixed(1)}%`, cx, cy - 26);

  ctx.fillStyle = P.muted;
  ctx.font = `600 21px ${FONT}`;
  ctx.fillText(
    res.mos >= 0.3 ? 'Diskon Menarik (Zona Beli)' : res.mos >= 0 ? 'Cukup Wajar' : 'Di Atas Nilai Wajar',
    cx,
    cy + 34
  );

  // Right: Grade Card
  const rx = padX + leftW + gap;
  drawRoundRect(ctx, rx, midY, rightW, midH, 28);
  ctx.fillStyle = P.surface;
  ctx.fill();
  ctx.strokeStyle = P.border;
  ctx.lineWidth = 2;
  ctx.stroke();

  ctx.textAlign = 'center';
  ctx.fillStyle = P.muted;
  ctx.font = `700 21px ${FONT}`;
  ctx.fillText('KUALITAS', rx + rightW / 2, midY + 46);

  const gColor =
    res.qualityGrade === 'A' || res.qualityGrade === 'B'
      ? P.emerald
      : res.qualityGrade === 'C'
      ? P.amber
      : P.rose;
  const gSoft =
    res.qualityGrade === 'A' || res.qualityGrade === 'B'
      ? P.emeraldSoft
      : res.qualityGrade === 'C'
      ? P.amberSoft
      : P.roseSoft;

  drawRoundRect(ctx, rx + rightW / 2 - 58, midY + 76, 116, 116, 28);
  ctx.fillStyle = gSoft;
  ctx.fill();
  ctx.strokeStyle = gColor;
  ctx.lineWidth = 3;
  ctx.stroke();

  ctx.fillStyle = gColor;
  ctx.font = `800 66px ${FONT}`;
  ctx.fillText(res.qualityGrade || '-', rx + rightW / 2, midY + 138);

  ctx.fillStyle = P.text;
  ctx.font = `700 24px ${FONT}`;
  ctx.fillText(`Skor ${res.qualityScore}/100`, rx + rightW / 2, midY + 224);

  ctx.fillStyle = P.muted;
  ctx.font = `600 18px ${FONT}`;
  ctx.fillText(fitText(ctx, res.qualityLabel || '', rightW - 28), rx + rightW / 2, midY + 256);

  // 5. Three Key Metrics Row (Return 5Y, ROE, Implied g)
  const kpiY = 878;
  const kpiH = 166;
  const boxGap = 20;
  const boxW = (W - padX * 2 - boxGap * 2) / 3;

  const ret5yStr =
    res.expectedReturn5Y?.totalCagr5Y !== null &&
    res.expectedReturn5Y?.totalCagr5Y !== undefined &&
    Number.isFinite(res.expectedReturn5Y.totalCagr5Y)
      ? `${res.expectedReturn5Y.totalCagr5Y >= 0 ? '+' : ''}${(res.expectedReturn5Y.totalCagr5Y * 100).toFixed(1)}%/th`
      : '-';
  const roeStr = fmtPct(Number(stock.roe) || 0, 1);
  const impStr = res.impliedG1 !== null && res.impliedG1 !== undefined ? fmtPct(res.impliedG1, 1) : '-';

  const kpiBoxes = [
    {
      label: 'RETURN 5Y',
      val: ret5yStr,
      sub: 'Estimasi CAGR Total',
      color:
        res.expectedReturn5Y?.totalCagr5Y >= 0.15
          ? P.emerald
          : res.expectedReturn5Y?.totalCagr5Y >= 0.08
          ? P.amber
          : P.text,
    },
    {
      label: 'ROE',
      val: roeStr,
      sub: `SGR ${fmtPct(res.sgr, 1)}`,
      color: (Number(stock.roe) || 0) >= 0.15 ? P.emerald : P.text,
    },
    {
      label: 'IMPLIED G',
      val: impStr,
      sub: `Asumsi g1 ${fmtPct(Number(stock.g1) || 0, 1)}`,
      color:
        res.impliedG1 !== null && res.impliedG1 < (res.sgr || 0)
          ? P.emerald
          : P.text,
    },
  ];

  kpiBoxes.forEach((b, i) => {
    const bx = padX + i * (boxW + boxGap);
    drawRoundRect(ctx, bx, kpiY, boxW, kpiH, 24);
    ctx.fillStyle = P.surface;
    ctx.fill();
    ctx.strokeStyle = P.border;
    ctx.lineWidth = 2;
    ctx.stroke();

    ctx.textAlign = 'left';
    ctx.fillStyle = P.muted;
    ctx.font = `700 20px ${FONT}`;
    ctx.fillText(b.label, bx + 26, kpiY + 40);

    ctx.fillStyle = b.color;
    ctx.font = `800 40px ${FONT}`;
    ctx.fillText(b.val, bx + 26, kpiY + 94);

    ctx.fillStyle = P.muted;
    ctx.font = `600 19px ${FONT}`;
    ctx.fillText(b.sub, bx + 26, kpiY + 136);
  });

  // 6. Verdict Pill
  const vY = 1076;
  const vH = 152;
  const vTone = res.verdict?.tone || 'amber';
  const vColor = vTone === 'emerald' ? P.emerald : vTone === 'amber' ? P.amber : P.rose;
  const vSoft = vTone === 'emerald' ? P.emeraldSoft : vTone === 'amber' ? P.amberSoft : P.roseSoft;

  drawRoundRect(ctx, padX, vY, W - padX * 2, vH, 26);
  ctx.fillStyle = vSoft;
  ctx.fill();
  ctx.strokeStyle = vColor;
  ctx.lineWidth = 2.5;
  ctx.stroke();

  ctx.textAlign = 'left';
  ctx.fillStyle = vColor;
  ctx.font = `800 28px ${FONT}`;
  ctx.fillText(fitText(ctx, res.verdict?.title || '-', W - padX * 2 - 64), padX + 32, vY + 48);

  ctx.fillStyle = P.text;
  ctx.font = `500 22px ${FONT}`;
  const descLines = wrapLines(ctx, res.verdict?.desc || '', W - padX * 2 - 64, 2);
  descLines.forEach((line, idx) => {
    ctx.fillText(line, padX + 32, vY + 92 + idx * 30);
  });

  // 7. Watermark Footer
  ctx.textAlign = 'center';
  ctx.fillStyle = P.muted;
  ctx.font = `600 21px ${FONT}`;
  ctx.fillText(`DCF Lab · ${dateLabel} · bukan rekomendasi beli/jual`, W / 2, 1292);
}

function buildMiniHistorySvg(history = []) {
  const sorted = [...(Array.isArray(history) ? history : [])]
    .filter((h) => h && Number.isFinite(Number(h.year)))
    .sort((a, b) => Number(a.year) - Number(b.year))
    .slice(-5);

  if (!sorted.length) {
    return '<div class="pr-muted">Tidak ada data histori laba bersih.</div>';
  }

  const maxAbs = Math.max(1, ...sorted.map((h) => Math.abs(Number(h.ni) || 0)));
  const svgW = 360;
  const svgH = 148;
  const baseLineY = 112;
  const maxBarH = 82;
  const stepX = svgW / sorted.length;
  const barW = Math.min(40, stepX * 0.56);

  const bars = sorted
    .map((h, i) => {
      const ni = Number(h.ni) || 0;
      const hPx = Math.max(4, Math.round((Math.abs(ni) / maxAbs) * maxBarH));
      const x = Math.round(i * stepX + (stepX - barW) / 2);
      const y = ni >= 0 ? baseLineY - hPx : baseLineY;
      const fill = ni >= 0 ? '#059669' : '#e11d48';
      const valLabel = Math.abs(ni) >= 1000 ? `${(ni / 1000).toFixed(1)}T` : `${Math.round(ni)}M`;
      return `
        <rect x="${x}" y="${y}" width="${barW}" height="${hPx}" rx="4" fill="${fill}" />
        <text x="${x + barW / 2}" y="${Math.max(14, y - 5)}" text-anchor="middle" font-size="10" font-weight="700" fill="#0f172a">${escHtml(valLabel)}</text>
        <text x="${x + barW / 2}" y="134" text-anchor="middle" font-size="10" fill="#64748b">${escHtml(h.year)}</text>
      `;
    })
    .join('');

  return `
    <svg viewBox="0 0 ${svgW} ${svgH}" class="pr-svg" role="img" aria-label="Histori Laba Bersih 5 Tahun">
      <line x1="8" y1="${baseLineY}" x2="${svgW - 8}" y2="${baseLineY}" stroke="#cbd5e1" stroke-width="1" />
      ${bars}
    </svg>`;
}

/**
 * Populates #printReport with clean A4 light-mode HTML for window.print().
 */
export function buildPrintReportHtml(stock, res, { now = new Date() } = {}) {
  if (!stock || !res) return '';
  const ticker = String(stock.ticker || 'IDX').toUpperCase();
  const monoColor = getTickerColor(ticker);
  const dateLabel = fmtDateShort(now);
  const statusLabel = res.mos >= 0.3 ? 'UNDERVALUED' : res.mos >= 0 ? 'FAIR VALUE' : 'OVERVALUED';
  const statusCls = res.mos >= 0.3 ? 'emerald' : res.mos >= 0 ? 'amber' : 'rose';
  const sourceTag = stock.isCustom ? 'Simpanan Pribadi' : 'Preset DCF Lab';

  const scenarios = res.scenarios
    ? [res.scenarios.bear, res.scenarios.base, res.scenarios.bull]
    : [];

  const fv = Number.isFinite(res.fvFinal) ? Math.max(1, res.fvFinal) : 1;
  const buy30 = fv * 0.7;
  const sell0 = fv;
  const price = Number(stock.price) || 0;
  const maxZone = Math.max(fv * 1.25, price * 1.1, 1);
  const pricePct = Math.max(2, Math.min(98, (price / maxZone) * 100));

  const convText =
    res.cashQuality?.ocfConversion !== null && res.cashQuality?.ocfConversion !== undefined
      ? `OCF ${(res.cashQuality.ocfConversion * 100).toFixed(0)}%`
      : res.cashQuality?.fcfConversion !== null && res.cashQuality?.fcfConversion !== undefined
      ? `FCF ${(res.cashQuality.fcfConversion * 100).toFixed(0)}%`
      : 'Belum diisi';

  const ret5yText =
    res.expectedReturn5Y?.totalCagr5Y !== null &&
    res.expectedReturn5Y?.totalCagr5Y !== undefined &&
    Number.isFinite(res.expectedReturn5Y.totalCagr5Y)
      ? `${res.expectedReturn5Y.totalCagr5Y >= 0 ? '+' : ''}${(res.expectedReturn5Y.totalCagr5Y * 100).toFixed(1)}%/thn`
      : '-';

  return `
    <div class="pr-page">
      <header class="pr-header">
        <div class="pr-brand-row">
          <div class="pr-monogram" style="background:${monoColor}">${escHtml(ticker.slice(0, 4))}</div>
          <div>
            <div class="pr-eyebrow">LAPORAN RINGKAS VALUASI DCF</div>
            <h1 class="pr-title">${escHtml(ticker)} &mdash; ${escHtml(stock.name || ticker)}</h1>
          </div>
        </div>
        <div class="pr-meta">
          <div><strong>${escHtml(dateLabel)}</strong></div>
          <div>Sumber LK: FY${escHtml(res.dataYear || '-')} &middot; ${escHtml(sourceTag)}${stock.isBankMode ? ' &middot; Mode Bank' : ''}</div>
        </div>
      </header>

      <section class="pr-hero-grid">
        <div class="pr-kpi">
          <div class="pr-kpi-lbl">Harga Pasar</div>
          <div class="pr-kpi-val">${escHtml(fmtRp(price))}</div>
          <div class="pr-kpi-sub">Market Cap Rp ${Number(stock.marketCap || 0).toFixed(1)}T</div>
        </div>
        <div class="pr-kpi">
          <div class="pr-kpi-lbl">Harga Wajar (Final)</div>
          <div class="pr-kpi-val pr-${statusCls}">${escHtml(fmtRp(res.fvFinal))}</div>
          <div class="pr-kpi-sub">DCF ${escHtml(fmtRp(res.iv))} &middot; DR ${escHtml(fmtPct(res.dr, 2))}</div>
        </div>
        <div class="pr-kpi">
          <div class="pr-kpi-lbl">Margin of Safety</div>
          <div class="pr-kpi-val pr-${statusCls}">${res.mos >= 0 ? '+' : ''}${(res.mos * 100).toFixed(1)}%</div>
          <div class="pr-kpi-sub">${escHtml(statusLabel)}</div>
        </div>
        <div class="pr-kpi">
          <div class="pr-kpi-lbl">Kualitas Bisnis</div>
          <div class="pr-kpi-val">Grade ${escHtml(res.qualityGrade)}</div>
          <div class="pr-kpi-sub">Skor ${res.qualityScore}/100 &middot; ${escHtml(res.qualityLabel)}</div>
        </div>
      </section>

      <section class="pr-verdict pr-verdict-${statusCls}">
        <strong>${escHtml(res.verdict?.title || '-')}</strong> &mdash;
        <span>${escHtml(res.verdict?.desc || '-')}</span>
      </section>

      <section class="pr-section">
        <h2 class="pr-h2">3 Skenario Valuasi &amp; Reverse DCF</h2>
        <table class="pr-table">
          <thead>
            <tr>
              <th>Skenario</th>
              <th class="num">Growth g1</th>
              <th class="num">Discount Rate</th>
              <th class="num">Fair Value</th>
              <th class="num">MoS</th>
            </tr>
          </thead>
          <tbody>
            ${scenarios
              .map(
                (sc, idx) => `
              <tr class="${idx === 1 ? 'pr-row-base' : ''}">
                <td>${escHtml(sc.label)}</td>
                <td class="num">${fmtPct(sc.g1, 1)}</td>
                <td class="num">${fmtPct(sc.dr, 2)}</td>
                <td class="num"><strong>${escHtml(fmtRp(sc.fv))}</strong></td>
                <td class="num">${(sc.mos * 100).toFixed(1)}%</td>
              </tr>`
              )
              .join('')}
          </tbody>
        </table>
        <div class="pr-rev-note">
          <strong>Reverse DCF:</strong> Harga pasar mengimplikasikan growth <strong>${
            res.impliedG1 !== null ? fmtPct(res.impliedG1, 1) : '-'
          }</strong>/thn vs SGR organik <strong>${fmtPct(res.sgr, 1)}</strong>/thn
          (${escHtml(res.growthSignal?.label || '')}: ${escHtml(res.growthSignal?.desc || '')}).
        </div>
      </section>

      <section class="pr-section">
        <h2 class="pr-h2">Fundamental Depth</h2>
        <div class="pr-depth-grid">
          <div class="pr-depth-box">
            <div class="pr-kpi-lbl">ROE DuPont</div>
            <div class="pr-depth-val">${fmtPct(Number(stock.roe) || 0, 1)}</div>
            <div class="pr-kpi-sub">ROA ${fmtPct(res.dupont?.roaImplied || 0, 1)} &middot; ${escHtml(res.dupont?.driver?.label || '')}</div>
          </div>
          <div class="pr-depth-box">
            <div class="pr-kpi-lbl">SGR Organik</div>
            <div class="pr-depth-val">${fmtPct(res.sgr, 1)}</div>
            <div class="pr-kpi-sub">Payout ${fmtPct(res.payoutRatio, 0)}</div>
          </div>
          <div class="pr-depth-box">
            <div class="pr-kpi-lbl">Return 5Y (CAGR)</div>
            <div class="pr-depth-val">${escHtml(ret5yText)}</div>
            <div class="pr-kpi-sub">Target 5Y ${res.expectedReturn5Y?.targetPrice5Y ? escHtml(fmtRp(res.expectedReturn5Y.targetPrice5Y)) : '-'}</div>
          </div>
          <div class="pr-depth-box">
            <div class="pr-kpi-lbl">Konversi Arus Kas</div>
            <div class="pr-depth-val">${escHtml(convText)}</div>
            <div class="pr-kpi-sub">${escHtml(res.cashQuality?.status?.label || '')}</div>
          </div>
          <div class="pr-depth-box">
            <div class="pr-kpi-lbl">DER${stock.isBankMode ? ' (Bank)' : ''}</div>
            <div class="pr-depth-val">${(Number(stock.der) || 0).toFixed(2)}x</div>
            <div class="pr-kpi-sub">NPM ${fmtPct(Number(stock.npm) || 0, 1)}</div>
          </div>
        </div>
      </section>

      <section class="pr-two-col">
        <div class="pr-section">
          <h2 class="pr-h2">Zona Beli &amp; Jual</h2>
          <div class="pr-zone-bar">
            <div class="pr-zone-buy" style="width:${Math.round((buy30 / maxZone) * 100)}%">Beli &le; ${escHtml(fmtRp(buy30))}</div>
            <div class="pr-zone-fair" style="width:${Math.round(((sell0 - buy30) / maxZone) * 100)}%">Wajar</div>
            <div class="pr-zone-sell" style="flex:1">Jual &gt; ${escHtml(fmtRp(sell0))}</div>
            <div class="pr-zone-marker" style="left:${pricePct}%"></div>
          </div>
          <table class="pr-table pr-table-compact">
            <tbody>
              <tr><td>Beli Kuat (MoS 50%)</td><td class="num"><strong>${escHtml(fmtRp(fv * 0.5))}</strong></td></tr>
              <tr><td>Zona Beli (MoS 30%)</td><td class="num"><strong>${escHtml(fmtRp(fv * 0.7))}</strong></td></tr>
              <tr><td>Harga Wajar (0%)</td><td class="num"><strong>${escHtml(fmtRp(fv))}</strong></td></tr>
              <tr><td>Target Jual (+10%)</td><td class="num"><strong>${escHtml(fmtRp(fv * 1.1))}</strong></td></tr>
            </tbody>
          </table>
        </div>

        <div class="pr-section">
          <h2 class="pr-h2">Histori Laba Bersih 5 Tahun</h2>
          ${buildMiniHistorySvg(stock.history)}
        </div>
      </section>

      ${stock.note ? `<div class="pr-note"><strong>Catatan Pengguna:</strong> ${escHtml(stock.note)}</div>` : ''}

      <footer class="pr-footer">
        Disclaimer: Laporan ini adalah hasil model valuasi DCF berdasarkan asumsi pengguna, bukan rekomendasi beli atau jual efek. Dibuat oleh DCF Valuation Lab pada ${escHtml(dateLabel)}.
      </footer>
    </div>
  `;
}
