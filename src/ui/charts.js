/**
 * Crisp inline SVG Visualizations for DCF Valuation Lab v5
 */

export function renderQualityRing(container, { score, grade }) {
  if (!container) return;
  const s = Math.max(0, Math.min(100, Number(score) || 0));
  const r = 34;
  const c = 2 * Math.PI * r;
  const dashOffset = c * (1 - s / 100);
  const strokeColor =
    grade === 'A' || grade === 'B'
      ? 'var(--emerald)'
      : grade === 'C'
      ? 'var(--amber)'
      : 'var(--rose)';

  container.innerHTML = `
    <div class="quality-ring-wrap" title="Skor Kualitas Fundamental: ${s}/100 (Grade ${grade})">
      <svg viewBox="0 0 84 84" class="quality-ring-svg" role="img" aria-label="Skor Kualitas Bisnis ${s} dari 100, Grade ${grade}">
        <circle cx="42" cy="42" r="${r}" fill="none" stroke="var(--surface-subtle)" stroke-width="7" />
        <circle
          cx="42" cy="42" r="${r}"
          fill="none"
          stroke="${strokeColor}"
          stroke-width="7"
          stroke-linecap="round"
          stroke-dasharray="${c.toFixed(2)}"
          stroke-dashoffset="${dashOffset.toFixed(2)}"
          transform="rotate(-90 42 42)"
          class="quality-ring-arc"
        />
        <text x="42" y="41" text-anchor="middle" fill="${strokeColor}" font-size="22" font-weight="800" font-family="inherit">${grade}</text>
        <text x="42" y="57" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="700" font-family="inherit">${s}/100</text>
      </svg>
    </div>
  `;
}

export function renderPriceGauge(container, { price, fvFinal }) {
  const fv = Math.max(1, fvFinal || 0);
  const p = Math.max(0, price || 0);
  const buy50 = fv * 0.5;
  const buy30 = fv * 0.7;
  const maxScale = Math.max(fv * 1.25, p * 1.12, 1);

  const W = 540;
  const padX = 22;
  const usableW = W - padX * 2;
  const xPos = (val) => Math.max(padX, Math.min(W - padX, padX + (val / maxScale) * usableW));
  const x50 = xPos(buy50);
  const x30 = xPos(buy30);
  const xFv = xPos(fv);
  const xP = xPos(p);
  const pillW = 104;
  const pillX = Math.min(W - pillW - 10, Math.max(10, xP - pillW / 2));

  container.innerHTML = `
    <svg viewBox="0 0 ${W} 94" class="svg-chart" role="img" aria-label="Posisi Harga Pasar terhadap Zona Valuasi">
      <defs>
        <linearGradient id="zoneGreen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--emerald)" stop-opacity="0.9" />
          <stop offset="100%" stop-color="var(--emerald)" stop-opacity="0.45" />
        </linearGradient>
      </defs>
      <rect x="${padX}" y="40" width="${Math.max(2, x30 - padX)}" height="12" rx="6" fill="url(#zoneGreen)" />
      <rect x="${x30}" y="40" width="${Math.max(2, xFv - x30)}" height="12" fill="var(--amber)" opacity="0.55" />
      <rect x="${xFv}" y="40" width="${Math.max(2, W - padX - xFv)}" height="12" rx="6" fill="var(--rose)" opacity="0.55" />

      <line x1="${x50}" y1="35" x2="${x50}" y2="57" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2,3" />
      <text x="${x50}" y="71" text-anchor="middle" fill="var(--text-muted)" font-size="10">MoS 50%</text>
      <text x="${x50}" y="86" text-anchor="middle" fill="var(--text)" font-size="10.5" font-weight="600">${Math.round(buy50).toLocaleString('id-ID')}</text>

      <line x1="${x30}" y1="35" x2="${x30}" y2="57" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2,3" />
      <text x="${x30}" y="71" text-anchor="middle" fill="var(--text-muted)" font-size="10">MoS 30%</text>
      <text x="${x30}" y="86" text-anchor="middle" fill="var(--text)" font-size="10.5" font-weight="600">${Math.round(buy30).toLocaleString('id-ID')}</text>

      <line x1="${xFv}" y1="33" x2="${xFv}" y2="57" stroke="var(--text)" stroke-width="1.5" />
      <text x="${xFv}" y="71" text-anchor="middle" fill="var(--text-muted)" font-size="10">Fair (0%)</text>
      <text x="${xFv}" y="86" text-anchor="middle" fill="var(--text)" font-size="10.5" font-weight="700">${Math.round(fv).toLocaleString('id-ID')}</text>

      <polygon points="${xP},37 ${xP - 5},28 ${xP + 5},28" fill="var(--primary)" />
      <line x1="${xP}" y1="37" x2="${xP}" y2="56" stroke="var(--primary)" stroke-width="2.2" />
      <rect x="${pillX}" y="3" width="${pillW}" height="22" rx="7" fill="var(--primary)" />
      <text x="${pillX + pillW / 2}" y="17.5" text-anchor="middle" fill="var(--primary-text)" font-size="10.5" font-weight="700">
        Pasar: Rp ${Math.round(p).toLocaleString('id-ID')}
      </text>
    </svg>
  `;
}

export function renderBetaChart(container, { factors, betaAvg, betaFinal, betaAdj }) {
  const leftPad = 132;
  const rightPad = 48;
  const width = 560;
  const barW = width - leftPad - rightPad;
  const toX = (b) => leftPad + ((Math.max(0.2, Math.min(2.1, b)) - 0.2) / 1.9) * barW;
  const rowH = 31;
  const topPad = 24;
  const height = topPad + factors.length * rowH + 26;

  const xAvg = toX(betaAvg);
  const xFin = toX(betaFinal);

  let svg = `<svg viewBox="0 0 ${width} ${height}" class="svg-chart" role="img" aria-label="Grafik Beta Fundamental 6 Faktor">`;
  [0.33, 0.67, 1.0, 1.5, 2.0].forEach((tick) => {
    const x = toX(tick);
    svg += `<line x1="${x}" y1="${topPad - 5}" x2="${x}" y2="${height - 20}" stroke="var(--border)" stroke-dasharray="3,3" />`;
    svg += `<text x="${x}" y="${height - 6}" text-anchor="middle" fill="var(--text-muted)" font-size="10.5">${tick.toFixed(2)}</text>`;
  });

  factors.forEach((f, idx) => {
    const y = topPad + idx * rowH;
    const xEnd = toX(f.beta);
    const color = f.beta <= 0.75 ? 'var(--emerald)' : f.beta <= 1.25 ? 'var(--amber)' : 'var(--rose)';
    svg += `<text x="${leftPad - 8}" y="${y + 16}" text-anchor="end" fill="var(--text)" font-size="11.5" font-weight="500">${f.label}</text>`;
    svg += `<rect x="${leftPad}" y="${y + 5}" width="${barW}" height="14" rx="5" fill="var(--surface-subtle)" />`;
    svg += `<rect x="${leftPad}" y="${y + 5}" width="${Math.max(6, xEnd - leftPad)}" height="14" rx="5" fill="${color}" opacity="0.88" />`;
    svg += `<text x="${width - 6}" y="${y + 16}" text-anchor="end" fill="var(--text)" font-size="11.5" font-weight="700">${f.beta.toFixed(2)}</text>`;
  });

  svg += `<line x1="${xAvg}" y1="${topPad - 6}" x2="${xAvg}" y2="${height - 20}" stroke="var(--emerald)" stroke-width="2" stroke-dasharray="4,3" />`;
  svg += `<text x="${xAvg}" y="13" text-anchor="middle" fill="var(--emerald)" font-size="10.5" font-weight="700">Avg ${betaAvg.toFixed(2)}</text>`;

  if (Math.abs(betaAdj) > 0.001) {
    svg += `<line x1="${xFin}" y1="${topPad - 6}" x2="${xFin}" y2="${height - 20}" stroke="var(--text)" stroke-width="2" />`;
    svg += `<text x="${xFin}" y="${height - 22}" text-anchor="middle" fill="var(--text)" font-size="10.5" font-weight="700">Final ${betaFinal.toFixed(2)}</text>`;
  }

  svg += `</svg>`;
  container.innerHTML = svg;
}

export function renderDcfChart(container, { rows, projZoom, fmtRp }) {
  const subset = rows.slice(0, projZoom);
  const W = 620;
  const H = 195;
  const padL = 58;
  const padR = 16;
  const padT = 16;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;
  const maxVal = Math.max(...subset.map((r) => Math.max(r.fv, r.pv)), 1);

  const xOf = (idx) => padL + (idx / (subset.length - 1 || 1)) * plotW;
  const yOf = (val) => padT + plotH - (val / maxVal) * plotH;

  const fvPath = subset
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(r.fv).toFixed(1)}`)
    .join(' ');
  const pvPath = subset
    .map((r, i) => `${i === 0 ? 'M' : 'L'}${xOf(i).toFixed(1)},${yOf(r.pv).toFixed(1)}`)
    .join(' ');
  const pvArea = `${pvPath} L${xOf(subset.length - 1).toFixed(1)},${(padT + plotH).toFixed(1)} L${xOf(0).toFixed(1)},${(padT + plotH).toFixed(1)} Z`;

  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = (maxVal * k) / 4;
    const y = yOf(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3" />`;
    grid += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10.5">${Math.round(v).toLocaleString('id-ID')}</text>`;
  }
  const xTicks = projZoom === 30 ? [1, 5, 10, 15, 20, 25, 30] : [1, 10, 25, 50, 75, 100];
  xTicks.forEach((yr) => {
    const x = xOf(yr - 1);
    grid += `<text x="${x}" y="${H - 7}" text-anchor="middle" fill="var(--text-muted)" font-size="10.5">Thn ${yr}</text>`;
  });

  container.innerHTML = `
    <div class="chart-legend">
      <span><i class="legend-line" style="background:var(--primary)"></i> Future Value EPS</span>
      <span><i class="legend-box" style="background:var(--emerald)"></i> Present Value EPS (Terdiskonto)</span>
    </div>
    <svg id="dcfSvg" viewBox="0 0 ${W} ${H}" class="svg-chart crosshair">
      <defs>
        <linearGradient id="pvGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stop-color="var(--emerald)" stop-opacity="0.34" />
          <stop offset="100%" stop-color="var(--emerald)" stop-opacity="0.03" />
        </linearGradient>
      </defs>
      ${grid}
      <path d="${pvArea}" fill="url(#pvGrad)" />
      <path d="${fvPath}" fill="none" stroke="var(--primary)" stroke-width="2" />
      <path d="${pvPath}" fill="none" stroke="var(--emerald)" stroke-width="2.2" />
      <line id="dcfCrossX" x1="-10" y1="${padT}" x2="-10" y2="${padT + plotH}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,2" />
      <circle id="dcfDotFv" cx="-10" cy="-10" r="4" fill="var(--primary)" />
      <circle id="dcfDotPv" cx="-10" cy="-10" r="4" fill="var(--emerald)" />
    </svg>
    <div id="dcfTooltip" class="chart-tooltip hidden"></div>
  `;

  const svgEl = container.querySelector('#dcfSvg');
  const tip = container.querySelector('#dcfTooltip');
  const cross = container.querySelector('#dcfCrossX');
  const dotFv = container.querySelector('#dcfDotFv');
  const dotPv = container.querySelector('#dcfDotPv');

  const updateFromClientX = (clientX) => {
    const rect = svgEl.getBoundingClientRect();
    const relX = ((clientX - rect.left) / rect.width) * W;
    const t = Math.max(0, Math.min(1, (relX - padL) / plotW));
    const idx = Math.round(t * (subset.length - 1));
    const r = subset[idx];
    const cx = xOf(idx);
    cross.setAttribute('x1', cx);
    cross.setAttribute('x2', cx);
    dotFv.setAttribute('cx', cx);
    dotFv.setAttribute('cy', yOf(r.fv));
    dotPv.setAttribute('cx', cx);
    dotPv.setAttribute('cy', yOf(r.pv));
    tip.classList.remove('hidden');
    tip.innerHTML = `
      <span><strong>Tahun ${r.year}</strong></span>
      <span>FV EPS: <strong>${fmtRp(r.fv)}</strong></span>
      <span>PV EPS: <strong>${fmtRp(r.pv)}</strong></span>
      <span>Kumulatif PV: <strong>${fmtRp(r.cumPv)}</strong></span>
    `;
  };

  const clearTip = () => {
    cross.setAttribute('x1', -10);
    cross.setAttribute('x2', -10);
    dotFv.setAttribute('cx', -10);
    dotPv.setAttribute('cx', -10);
    tip.classList.add('hidden');
  };

  svgEl.addEventListener('mousemove', (e) => updateFromClientX(e.clientX));
  svgEl.addEventListener('mouseleave', clearTip);
  svgEl.addEventListener(
    'touchstart',
    (e) => {
      if (e.touches && e.touches[0]) updateFromClientX(e.touches[0].clientX);
    },
    { passive: true }
  );
  svgEl.addEventListener(
    'touchmove',
    (e) => {
      if (e.touches && e.touches[0]) {
        e.preventDefault();
        updateFromClientX(e.touches[0].clientX);
      }
    },
    { passive: false }
  );
  svgEl.addEventListener('touchend', clearTip);
}

export function renderHistoryChart(container, { history }) {
  const rows = [...(history || [])].sort((a, b) => Number(a.year) - Number(b.year));
  if (!rows.length) {
    container.innerHTML = '<div class="text-xs text-muted">Belum ada data historis.</div>';
    return;
  }

  const METRICS = {
    sales: { key: 'sales', label: 'Penjualan', lineColor: '#0284c7' },
    op: { key: 'op', label: 'Laba Usaha', lineColor: 'var(--amber)' },
    ni: { key: 'ni', label: 'Laba Bersih', lineColor: 'var(--emerald)' },
  };
  const activeKey = METRICS[container.dataset.histMetric] ? container.dataset.histMetric : 'ni';
  const activeCfg = METRICS[activeKey];

  const W = 540;
  const H = 204;
  const padL = 52;
  const padR = 14;
  const padT = 30;
  const padB = 26;
  const plotW = W - padL - padR;
  const plotH = H - padT - padB;

  const maxVal = Math.max(
    ...rows.flatMap((r) => [Math.abs(r.sales || 0), Math.abs(r.op || 0), Math.abs(r.ni || 0)]),
    1
  );
  const yZero = padT + plotH;
  const yOf = (val) => padT + plotH - (Math.max(0, val) / maxVal) * plotH;

  let grid = '';
  for (let k = 0; k <= 4; k++) {
    const v = (maxVal * k) / 4;
    const y = yOf(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--border)" stroke-dasharray="3,3" />`;
    const lbl = v >= 1000 ? `${(v / 1000).toFixed(v >= 10000 ? 0 : 1)}T` : `${Math.round(v)}M`;
    grid += `<text x="${padL - 7}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="10">${lbl}</text>`;
  }

  const groupW = plotW / rows.length;
  const barW = Math.min(18, Math.max(7, (groupW - 16) / 3));
  let bars = '';
  const activePts = [];

  rows.forEach((r, idx) => {
    const cx = padL + idx * groupW + groupW / 2;
    const xSales = cx - barW * 1.55;
    const xOp = cx - barW * 0.5;
    const xNi = cx + barW * 0.55;

    const hSales = Math.max(2, yZero - yOf(r.sales || 0));
    const hOp = Math.max(2, yZero - yOf(r.op || 0));
    const hNi = Math.max(2, yZero - yOf(r.ni || 0));

    const opSales = activeKey === 'sales' ? 0.52 : 0.2;
    const opOp = activeKey === 'op' ? 0.95 : 0.42;
    const opNi = activeKey === 'ni' ? 0.96 : 0.45;

    const activeX =
      activeKey === 'sales'
        ? xSales + barW / 2
        : activeKey === 'op'
        ? xOp + barW / 2
        : xNi + barW / 2;
    const activeVal = Number(r[activeKey]) || 0;
    const prevVal = idx > 0 ? Number(rows[idx - 1][activeKey]) || 0 : null;
    const yoy =
      idx > 0 && prevVal !== null && prevVal !== 0
        ? ((activeVal - prevVal) / Math.abs(prevVal)) * 100
        : null;
    activePts.push({ x: activeX, y: yOf(activeVal), val: activeVal, year: r.year, yoy });

    bars += `
      <g class="hist-group" data-hidx="${idx}" style="cursor:pointer">
        <rect x="${cx - groupW / 2}" y="${padT}" width="${groupW}" height="${plotH}" fill="transparent" />
        <rect class="hist-bar" data-metric="sales" x="${xSales}" y="${yZero - hSales}" width="${barW}" height="${hSales}" rx="3" fill="var(--primary)" opacity="${opSales}" />
        <rect class="hist-bar" data-metric="op" x="${xOp}" y="${yZero - hOp}" width="${barW}" height="${hOp}" rx="3" fill="var(--amber)" opacity="${opOp}" />
        <rect class="hist-bar" data-metric="ni" x="${xNi}" y="${yZero - hNi}" width="${barW}" height="${hNi}" rx="3" fill="${(r.ni || 0) >= 0 ? 'var(--emerald)' : 'var(--rose)'}" opacity="${opNi}" />
        <text x="${cx}" y="${H - 7}" text-anchor="middle" fill="var(--text-muted)" font-size="10.5" font-weight="600">${r.year}</text>
      </g>
    `;
  });

  // YoY % trendline + nodes + pill badges for active metric
  let trendSvg = '';
  if (activePts.length >= 2) {
    const lineD = activePts
      .map((p, i) => `${i === 0 ? 'M' : 'L'}${p.x.toFixed(1)},${p.y.toFixed(1)}`)
      .join(' ');
    trendSvg += `<path d="${lineD}" fill="none" stroke="${activeCfg.lineColor}" stroke-width="2.1" stroke-linecap="round" stroke-linejoin="round" style="pointer-events:none" />`;
  }

  // Straight CAGR line from first year to last year for active metric
  const markerId = `cagrArrow-${container.id || 'hist'}-${activeKey}`;
  let cagrVal = null;
  if (activePts.length >= 2) {
    const first = activePts[0];
    const last = activePts[activePts.length - 1];
    if (first.val > 0 && last.val > 0) {
      const span = Math.abs(last.year - first.year) || activePts.length - 1;
      cagrVal = Math.pow(last.val / first.val, 1 / span) - 1;

      trendSvg += `
        <line x1="${first.x.toFixed(1)}" y1="${first.y.toFixed(1)}" x2="${last.x.toFixed(1)}" y2="${last.y.toFixed(1)}"
          stroke="${activeCfg.lineColor}" stroke-width="1.9" stroke-dasharray="5,4" opacity="0.88"
          marker-end="url(#${markerId})" style="pointer-events:none" />
      `;
    }
  }

  // Nodes & YoY % pills
  activePts.forEach((p) => {
    trendSvg += `<circle cx="${p.x.toFixed(1)}" cy="${p.y.toFixed(1)}" r="3.6" fill="${activeCfg.lineColor}" stroke="var(--surface)" stroke-width="1.6" style="pointer-events:none" />`;
    if (p.yoy !== null) {
      const pos = p.yoy >= 0;
      const lbl = `${pos ? '+' : ''}${p.yoy.toFixed(1)}%`;
      const pw = Math.max(36, lbl.length * 5.4 + 8);
      const py = Math.max(9, p.y - 16);
      const px = Math.max(padL + pw / 2, Math.min(W - padR - pw / 2, p.x));
      trendSvg += `
        <g style="pointer-events:none">
          <rect x="${(px - pw / 2).toFixed(1)}" y="${(py - 7.5).toFixed(1)}" width="${pw}" height="14" rx="7"
            fill="${pos ? 'var(--emerald-soft)' : 'var(--rose-soft)'}" />
          <text x="${px.toFixed(1)}" y="${(py + 2.5).toFixed(1)}" text-anchor="middle"
            fill="${pos ? 'var(--emerald)' : 'var(--rose)'}" font-size="8.8" font-weight="700">${lbl}</text>
        </g>
      `;
    }
  });

  const cagrChip =
    cagrVal !== null
      ? `<span class="legend-cagr"><i class="legend-dash" style="border-color:${activeCfg.lineColor}"></i> CAGR ${activeCfg.label}: <strong style="color:${activeCfg.lineColor}">${cagrVal >= 0 ? '+' : ''}${(cagrVal * 100).toFixed(1)}%/thn</strong></span>`
      : '';

  container.innerHTML = `
    <div class="chart-legend chart-legend-wrap">
      <button type="button" class="legend-btn ${activeKey === 'sales' ? 'active' : ''}" data-metric="sales" title="Klik untuk lihat YoY & CAGR Penjualan">
        <i class="legend-box" style="background:var(--primary);opacity:0.55"></i> Penjualan
      </button>
      <button type="button" class="legend-btn ${activeKey === 'op' ? 'active' : ''}" data-metric="op" title="Klik untuk lihat YoY & CAGR Laba Usaha">
        <i class="legend-box" style="background:var(--amber)"></i> Laba Usaha
      </button>
      <button type="button" class="legend-btn ${activeKey === 'ni' ? 'active' : ''}" data-metric="ni" title="Klik untuk lihat YoY & CAGR Laba Bersih">
        <i class="legend-box" style="background:var(--emerald)"></i> Laba Bersih
      </button>
      ${cagrChip}
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="img" aria-label="Grafik Tren Kinerja Historis Interaktif">
      <defs>
        <marker id="${markerId}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="5.5" markerHeight="5.5" orient="auto-start-reverse">
          <path d="M 0 1.5 L 9 5 L 0 8.5 z" fill="${activeCfg.lineColor}" />
        </marker>
      </defs>
      ${grid}
      ${bars}
      ${trendSvg}
    </svg>
    <div class="chart-tooltip hidden hist-tip"></div>
  `;

  const tip = container.querySelector('.hist-tip');
  const showRowTip = (idx) => {
    const r = rows[idx];
    if (!r) return;
    const opm = r.sales > 0 ? ((r.op / r.sales) * 100).toFixed(1) : '0.0';
    const npm = r.sales > 0 ? ((r.ni / r.sales) * 100).toFixed(1) : '0.0';
    const pt = activePts[idx];
    const yoyText =
      pt && pt.yoy !== null
        ? `<span>YoY ${activeCfg.label}: <strong style="color:${pt.yoy >= 0 ? 'var(--emerald)' : 'var(--rose)'}">${pt.yoy >= 0 ? '+' : ''}${pt.yoy.toFixed(1)}%</strong></span>`
        : '';
    tip.classList.remove('hidden');
    tip.innerHTML = `
      <span><strong>Tahun ${r.year}</strong></span>
      <span>Penjualan: <strong>${Math.round(r.sales).toLocaleString('id-ID')} M</strong></span>
      <span>Laba Usaha: <strong>${Math.round(r.op).toLocaleString('id-ID')} M</strong> (OPM ${opm}%)</span>
      <span>Laba Bersih: <strong>${Math.round(r.ni).toLocaleString('id-ID')} M</strong> (NPM ${npm}%)</span>
      ${yoyText}
    `;
  };

  container.querySelectorAll('.legend-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      container.dataset.histMetric = btn.dataset.metric;
      renderHistoryChart(container, { history });
    });
  });

  container.querySelectorAll('.hist-bar').forEach((bar) => {
    bar.addEventListener('click', (e) => {
      e.stopPropagation();
      const nextMetric = bar.dataset.metric;
      const g = bar.closest('.hist-group');
      const idx = g ? Number(g.dataset.hidx) : -1;
      if (nextMetric && nextMetric !== activeKey) {
        container.dataset.histMetric = nextMetric;
        renderHistoryChart(container, { history });
        if (idx >= 0) {
          container.querySelector(`.hist-group[data-hidx="${idx}"]`)?.dispatchEvent(new Event('mouseenter'));
        }
      } else if (idx >= 0) {
        showRowTip(idx);
      }
    });
  });

  container.querySelectorAll('.hist-group').forEach((g) => {
    const idx = Number(g.dataset.hidx);
    g.addEventListener('mouseenter', () => showRowTip(idx));
    g.addEventListener('click', () => showRowTip(idx));
  });
  container.addEventListener('mouseleave', () => tip.classList.add('hidden'));
}

