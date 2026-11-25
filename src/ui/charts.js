/**
 * Crisp inline SVG Visualizations for DCF Valuation Lab v2
 */

export function renderPriceGauge(container, { price, fvFinal }) {
  const fv = Math.max(1, fvFinal || 0);
  const p = Math.max(0, price || 0);
  const buy50 = fv * 0.5;
  const buy30 = fv * 0.7;
  const maxScale = Math.max(fv * 1.25, p * 1.12, 1);

  const xPos = (val) => Math.max(24, Math.min(616, 24 + (val / maxScale) * 592));
  const x50 = xPos(buy50);
  const x30 = xPos(buy30);
  const xFv = xPos(fv);
  const xP = xPos(p);
  const pillX = Math.min(526, Math.max(14, xP - 54));

  container.innerHTML = `
    <svg viewBox="0 0 640 106" class="svg-chart" role="img" aria-label="Posisi Harga Pasar terhadap Zona Valuasi">
      <defs>
        <linearGradient id="zoneGreen" x1="0" y1="0" x2="1" y2="0">
          <stop offset="0%" stop-color="var(--emerald)" stop-opacity="0.88" />
          <stop offset="100%" stop-color="var(--emerald)" stop-opacity="0.45" />
        </linearGradient>
      </defs>
      <rect x="24" y="44" width="${Math.max(2, x30 - 24)}" height="14" rx="7" fill="url(#zoneGreen)" />
      <rect x="${x30}" y="44" width="${Math.max(2, xFv - x30)}" height="14" fill="var(--amber)" opacity="0.55" />
      <rect x="${xFv}" y="44" width="${Math.max(2, 616 - xFv)}" height="14" rx="7" fill="var(--rose)" opacity="0.55" />

      <line x1="${x50}" y1="38" x2="${x50}" y2="64" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2,3" />
      <text x="${x50}" y="80" text-anchor="middle" fill="var(--text-muted)" font-size="11">MoS 50%</text>
      <text x="${x50}" y="96" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="600">${Math.round(buy50).toLocaleString('id-ID')}</text>

      <line x1="${x30}" y1="38" x2="${x30}" y2="64" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="2,3" />
      <text x="${x30}" y="80" text-anchor="middle" fill="var(--text-muted)" font-size="11">MoS 30%</text>
      <text x="${x30}" y="96" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="600">${Math.round(buy30).toLocaleString('id-ID')}</text>

      <line x1="${xFv}" y1="36" x2="${xFv}" y2="64" stroke="var(--text)" stroke-width="1.5" />
      <text x="${xFv}" y="80" text-anchor="middle" fill="var(--text-muted)" font-size="11">Fair (0%)</text>
      <text x="${xFv}" y="96" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="700">${Math.round(fv).toLocaleString('id-ID')}</text>

      <polygon points="${xP},40 ${xP - 6},30 ${xP + 6},30" fill="var(--primary)" />
      <line x1="${xP}" y1="40" x2="${xP}" y2="62" stroke="var(--primary)" stroke-width="2.5" />
      <rect x="${pillX}" y="4" width="108" height="24" rx="8" fill="var(--primary)" />
      <text x="${pillX + 54}" y="20" text-anchor="middle" fill="var(--primary-text)" font-size="11" font-weight="700">
        Pasar: Rp ${Math.round(p).toLocaleString('id-ID')}
      </text>
    </svg>
  `;
}

export function renderBetaChart(container, { factors, betaAvg, betaFinal, betaAdj }) {
  const leftPad = 140;
  const rightPad = 56;
  const width = 640;
  const barW = width - leftPad - rightPad;
  const toX = (b) => leftPad + ((Math.max(0.2, Math.min(2.1, b)) - 0.2) / 1.9) * barW;
  const rowH = 38;
  const topPad = 28;
  const height = topPad + factors.length * rowH + 30;

  const xAvg = toX(betaAvg);
  const xFin = toX(betaFinal);

  let svg = `<svg viewBox="0 0 ${width} ${height}" class="svg-chart" role="img" aria-label="Grafik Beta Fundamental 6 Faktor">`;
  [0.33, 0.67, 1.0, 1.5, 2.0].forEach((tick) => {
    const x = toX(tick);
    svg += `<line x1="${x}" y1="${topPad - 6}" x2="${x}" y2="${height - 24}" stroke="var(--border)" stroke-dasharray="3,3" />`;
    svg += `<text x="${x}" y="${height - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="11">${tick.toFixed(2)}</text>`;
  });

  factors.forEach((f, idx) => {
    const y = topPad + idx * rowH;
    const xEnd = toX(f.beta);
    const color = f.beta <= 0.75 ? 'var(--emerald)' : f.beta <= 1.25 ? 'var(--amber)' : 'var(--rose)';
    svg += `<text x="${leftPad - 10}" y="${y + 18}" text-anchor="end" fill="var(--text)" font-size="12" font-weight="500">${f.label}</text>`;
    svg += `<rect x="${leftPad}" y="${y + 6}" width="${barW}" height="16" rx="6" fill="var(--surface-subtle)" />`;
    svg += `<rect x="${leftPad}" y="${y + 6}" width="${Math.max(6, xEnd - leftPad)}" height="16" rx="6" fill="${color}" opacity="0.88" />`;
    svg += `<text x="${width - 6}" y="${y + 18}" text-anchor="end" fill="var(--text)" font-size="12" font-weight="700">${f.beta.toFixed(2)}</text>`;
  });

  svg += `<line x1="${xAvg}" y1="${topPad - 8}" x2="${xAvg}" y2="${height - 24}" stroke="var(--emerald)" stroke-width="2" stroke-dasharray="4,3" />`;
  svg += `<text x="${xAvg}" y="14" text-anchor="middle" fill="var(--emerald)" font-size="11" font-weight="700">Avg ${betaAvg.toFixed(2)}</text>`;

  if (Math.abs(betaAdj) > 0.001) {
    svg += `<line x1="${xFin}" y1="${topPad - 8}" x2="${xFin}" y2="${height - 24}" stroke="var(--text)" stroke-width="2" />`;
    svg += `<text x="${xFin}" y="${height - 26}" text-anchor="middle" fill="var(--text)" font-size="11" font-weight="700">Final ${betaFinal.toFixed(2)}</text>`;
  }

  svg += `</svg>`;
  container.innerHTML = svg;
}

export function renderDcfChart(container, { rows, projZoom, fmtRp }) {
  const subset = rows.slice(0, projZoom);
  const W = 680;
  const H = 250;
  const padL = 62;
  const padR = 18;
  const padT = 20;
  const padB = 30;
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
    grid += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="11">${Math.round(v).toLocaleString('id-ID')}</text>`;
  }
  const xTicks = projZoom === 30 ? [1, 5, 10, 15, 20, 25, 30] : [1, 10, 25, 50, 75, 100];
  xTicks.forEach((yr) => {
    const x = xOf(yr - 1);
    grid += `<text x="${x}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="11">Thn ${yr}</text>`;
  });

  container.innerHTML = `
    <div class="chart-legend">
      <span><i class="legend-line" style="background:var(--primary)"></i> Future Value EPS</span>
      <span><i class="legend-box" style="background:var(--emerald)"></i> Present Value EPS (Teriskonto)</span>
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
      <path d="${fvPath}" fill="none" stroke="var(--primary)" stroke-width="2.2" />
      <path d="${pvPath}" fill="none" stroke="var(--emerald)" stroke-width="2.4" />
      <line id="dcfCrossX" x1="-10" y1="${padT}" x2="-10" y2="${padT + plotH}" stroke="var(--text-muted)" stroke-width="1" stroke-dasharray="3,2" />
      <circle id="dcfDotFv" cx="-10" cy="-10" r="4.5" fill="var(--primary)" />
      <circle id="dcfDotPv" cx="-10" cy="-10" r="4.5" fill="var(--emerald)" />
    </svg>
    <div id="dcfTooltip" class="chart-tooltip hidden"></div>
  `;

  const svgEl = container.querySelector('#dcfSvg');
  const tip = container.querySelector('#dcfTooltip');
  const cross = container.querySelector('#dcfCrossX');
  const dotFv = container.querySelector('#dcfDotFv');
  const dotPv = container.querySelector('#dcfDotPv');

  svgEl.addEventListener('mousemove', (e) => {
    const rect = svgEl.getBoundingClientRect();
    const relX = ((e.clientX - rect.left) / rect.width) * W;
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
  });

  svgEl.addEventListener('mouseleave', () => {
    cross.setAttribute('x1', -10);
    cross.setAttribute('x2', -10);
    dotFv.setAttribute('cx', -10);
    dotPv.setAttribute('cx', -10);
    tip.classList.add('hidden');
  });
}

export function renderHistoryChart(container, { history }) {
  const rows = [...(history || [])].sort((a, b) => Number(a.year) - Number(b.year));
  if (!rows.length) {
    container.innerHTML = '<div class="text-xs text-muted">Belum ada data historis.</div>';
    return;
  }

  const W = 640;
  const H = 220;
  const padL = 60;
  const padR = 16;
  const padT = 18;
  const padB = 30;
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
    grid += `<text x="${padL - 8}" y="${y + 4}" text-anchor="end" fill="var(--text-muted)" font-size="11">${lbl}</text>`;
  }

  const groupW = plotW / rows.length;
  const barW = Math.min(20, Math.max(8, (groupW - 18) / 3));
  let bars = '';

  rows.forEach((r, idx) => {
    const cx = padL + idx * groupW + groupW / 2;
    const xSales = cx - barW * 1.55;
    const xOp = cx - barW * 0.5;
    const xNi = cx + barW * 0.55;

    const hSales = Math.max(2, yZero - yOf(r.sales || 0));
    const hOp = Math.max(2, yZero - yOf(r.op || 0));
    const hNi = Math.max(2, yZero - yOf(r.ni || 0));

    bars += `
      <g class="hist-group" data-hidx="${idx}" style="cursor:pointer">
        <rect x="${cx - groupW / 2}" y="${padT}" width="${groupW}" height="${plotH}" fill="transparent" />
        <rect x="${xSales}" y="${yZero - hSales}" width="${barW}" height="${hSales}" rx="3" fill="var(--primary)" opacity="0.28" />
        <rect x="${xOp}" y="${yZero - hOp}" width="${barW}" height="${hOp}" rx="3" fill="var(--amber)" opacity="0.78" />
        <rect x="${xNi}" y="${yZero - hNi}" width="${barW}" height="${hNi}" rx="3" fill="${(r.ni || 0) >= 0 ? 'var(--emerald)' : 'var(--rose)'}" opacity="0.92" />
        <text x="${cx}" y="${H - 8}" text-anchor="middle" fill="var(--text-muted)" font-size="11" font-weight="600">${r.year}</text>
      </g>
    `;
  });

  container.innerHTML = `
    <div class="chart-legend">
      <span><i class="legend-box" style="background:var(--primary);opacity:0.35"></i> Penjualan</span>
      <span><i class="legend-box" style="background:var(--amber)"></i> Laba Usaha</span>
      <span><i class="legend-box" style="background:var(--emerald)"></i> Laba Bersih</span>
    </div>
    <svg viewBox="0 0 ${W} ${H}" class="svg-chart" role="img" aria-label="Grafik Tren Kinerja Historis">
      ${grid}
      ${bars}
    </svg>
    <div class="chart-tooltip hidden hist-tip"></div>
  `;

  const tip = container.querySelector('.hist-tip');
  container.querySelectorAll('.hist-group').forEach((g) => {
    g.addEventListener('mouseenter', () => {
      const r = rows[Number(g.dataset.hidx)];
      const opm = r.sales > 0 ? ((r.op / r.sales) * 100).toFixed(1) : '0.0';
      const npm = r.sales > 0 ? ((r.ni / r.sales) * 100).toFixed(1) : '0.0';
      tip.classList.remove('hidden');
      tip.innerHTML = `
        <span><strong>Tahun ${r.year}</strong></span>
        <span>Penjualan: <strong>${Math.round(r.sales).toLocaleString('id-ID')} M</strong></span>
        <span>Laba Usaha: <strong>${Math.round(r.op).toLocaleString('id-ID')} M</strong> (OPM ${opm}%)</span>
        <span>Laba Bersih: <strong>${Math.round(r.ni).toLocaleString('id-ID')} M</strong> (NPM ${npm}%)</span>
      `;
    });
  });
  container.addEventListener('mouseleave', () => tip.classList.add('hidden'));
}

