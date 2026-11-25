/**
 * DCF Calculation Engine — 100% parity with user's Google Sheets DCF method:
 * - 4-7 years Sales, Operating Profit, Net Income + Inflation Adjustment
 * - OPM, Std/Avg/COV OPM, Earnings Predictability (Pearson R), CAGR
 * - 6-Factor Linear Interpolation Fundamental Beta (0.33 - 2.00) + Qualitative Adj
 * - CAPM Discount Rate = Rf + BetaFinal * (Rm - Rf)
 * - 100-Year EPS DCF (2-Stage Growth + Optional Y1 Flat / Recovery Multipliers)
 * - Relative Valuation (PERCENTILE.INC over Mean PE 3/5/10Y & Mean PBV 3/5/10Y)
 * - Final Valuation & Margin of Safety (MoS) Buy/Sell Zones
 */

export const BETA_SCALE = [0.33, 0.67, 1.0, 1.5, 2.0];
export const DEFAULT_INF = [1.0, 1.0272, 1.0593, 1.0975, 1.1307, 1.1686, 1.2663];

export function interpDesc(val, thresholds) {
  if (!isFinite(val)) return BETA_SCALE[4];
  if (val > thresholds[0]) return BETA_SCALE[0];
  for (let i = 1; i < thresholds.length; i++) {
    if (val > thresholds[i]) {
      return (
        BETA_SCALE[i] -
        ((val - thresholds[i]) / (thresholds[i - 1] - thresholds[i])) *
          (BETA_SCALE[i] - BETA_SCALE[i - 1])
      );
    }
  }
  return BETA_SCALE[4];
}

export function interpAsc(val, thresholds) {
  if (!isFinite(val)) return BETA_SCALE[4];
  if (val < thresholds[0]) return BETA_SCALE[0];
  for (let i = 1; i < thresholds.length; i++) {
    if (val < thresholds[i]) {
      return (
        ((val - thresholds[i - 1]) / (thresholds[i] - thresholds[i - 1])) *
          (BETA_SCALE[i] - BETA_SCALE[i - 1]) +
        BETA_SCALE[i - 1]
      );
    }
  }
  return BETA_SCALE[4];
}

export function stdevSample(arr) {
  if (arr.length < 2) return 0;
  const mean = arr.reduce((a, b) => a + b, 0) / arr.length;
  const sq = arr.reduce((a, b) => a + (b - mean) ** 2, 0);
  return Math.sqrt(sq / (arr.length - 1));
}

export function correl(xs, ys) {
  const n = Math.min(xs.length, ys.length);
  if (n < 2) return 0;
  const mx = xs.slice(0, n).reduce((a, b) => a + b, 0) / n;
  const my = ys.slice(0, n).reduce((a, b) => a + b, 0) / n;
  let num = 0;
  let dx2 = 0;
  let dy2 = 0;
  for (let i = 0; i < n; i++) {
    const dx = xs[i] - mx;
    const dy = ys[i] - my;
    num += dx * dy;
    dx2 += dx * dx;
    dy2 += dy * dy;
  }
  return dx2 === 0 || dy2 === 0 ? 0 : num / Math.sqrt(dx2 * dy2);
}

export function percentileInc(arr, p) {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  if (sorted.length === 1) return sorted[0];
  const clamped = Math.max(0, Math.min(1, p));
  const idx = (sorted.length - 1) * clamped;
  const lo = Math.floor(idx);
  const hi = Math.ceil(idx);
  if (lo === hi) return sorted[lo];
  return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
}

export function computeDCF(s, overrides = {}) {
  const g1 = overrides.g1 !== undefined ? overrides.g1 : Number(s.g1) || 0;
  const g2 = overrides.g2 !== undefined ? overrides.g2 : Number(s.g2) || 0;
  const hist = Array.isArray(s.history) ? s.history : [];

  const years = hist.map((h) => Number(h.year) || 0);
  const nis = hist.map((h) => Number(h.ni) || 0);
  const opmsAll = hist.map((h) => (h.sales > 0 ? (Number(h.op) || 0) / Number(h.sales) : 0));
  const niAdjsAll = hist.map((h) => (Number(h.ni) || 0) * (Number(h.inf) || 1));

  const lim =
    s.avgYearsLimit && s.avgYearsLimit !== 'all' && Number(s.avgYearsLimit) <= hist.length
      ? Number(s.avgYearsLimit)
      : hist.length;
  const niSlice = niAdjsAll.slice(0, lim);
  const opmSlice = opmsAll.slice(0, lim);

  const avgNiAdj = niSlice.length ? niSlice.reduce((a, b) => a + b, 0) / niSlice.length : 0;
  const predictR = correl(years, nis);
  const avgOpm = opmSlice.length ? opmSlice.reduce((a, b) => a + b, 0) / opmSlice.length : 0;
  const stdOpm = stdevSample(opmSlice);
  const covOpm = avgOpm !== 0 ? stdOpm / avgOpm : 0;

  let cagr = null;
  if (hist.length >= 2 && hist[0].ni > 0 && hist[hist.length - 1].ni > 0) {
    const span = Math.abs(hist[0].year - hist[hist.length - 1].year) || hist.length - 1;
    cagr = Math.pow(hist[0].ni / hist[hist.length - 1].ni, 1 / span) - 1;
  }

  const price = Number(s.price) || 0;
  const marketCap = Number(s.marketCap) || 0;
  const shares =
    s.sharesOverride && s.sharesOverride > 0
      ? Number(s.sharesOverride)
      : price > 0
      ? (marketCap / price) * 1000
      : 0;

  const epsAdj = shares > 0 ? avgNiAdj / shares : 0;
  const epsTTM = Number(s.epsTTM) || 0;
  const epsBase =
    s.epsBasis === 'ttm' ? epsTTM : s.epsBasis === 'adj' ? epsAdj : (epsAdj + epsTTM) / 2;

  const roe = Number(s.roe) || 0;
  const der = Number(s.der) || 0;
  const npm = Number(s.npm) || 0;

  const factors = [
    {
      key: 'roe',
      label: 'ROE',
      val: roe,
      fmt: (v) => (v * 100).toFixed(2) + '%',
      beta: interpDesc(roe, [0.25, 0.175, 0.1, 0.075, 0.025]),
      thFmt: ['>25%', '17.5%', '10%', '7.5%', '2.5%'],
    },
    {
      key: 'der',
      label: 'DER',
      val: der,
      fmt: (v) => v.toFixed(2) + 'x',
      beta: interpAsc(der, [0.1, 0.25, 0.5, 1.0, 3.0]),
      thFmt: ['<0.10', '0.25', '0.50', '1.00', '3.00'],
    },
    {
      key: 'npm',
      label: 'NPM',
      val: npm,
      fmt: (v) => (v * 100).toFixed(2) + '%',
      beta: interpDesc(npm, [0.25, 0.1, 0.085, 0.05, 0.01]),
      thFmt: ['>25%', '10%', '8.5%', '5%', '1%'],
    },
    {
      key: 'cov',
      label: 'COV OPM',
      val: covOpm,
      fmt: (v) => (v * 100).toFixed(2) + '%',
      beta: interpAsc(covOpm, [0.025, 0.075, 0.1, 0.15, 0.25]),
      thFmt: ['<2.5%', '7.5%', '10%', '15%', '25%'],
    },
    {
      key: 'r',
      label: 'Predictability (R)',
      val: predictR,
      fmt: (v) => v.toFixed(3),
      beta: interpDesc(predictR, [1.0, 0.85, 0.75, 0.25, 0.0]),
      thFmt: ['1.00', '0.85', '0.75', '0.25', '0.00'],
    },
    {
      key: 'cap',
      label: 'Market Cap (T)',
      val: marketCap,
      fmt: (v) => 'Rp' + Number(v).toFixed(1) + 'T',
      beta: interpDesc(marketCap, [200, 100, 50, 10, 1]),
      thFmt: ['>200T', '100T', '50T', '10T', '1T'],
    },
  ];

  const betaAvg = factors.reduce((acc, f) => acc + f.beta, 0) / factors.length;
  const betaFinal = betaAvg + (Number(s.betaAdj) || 0);
  const rf = Number(s.rf) || 0.07;
  const rm = Number(s.rm) || 0.12;
  const dr = overrides.dr !== undefined ? overrides.dr : rf + betaFinal * (rm - rf);
  const safeDr = Math.max(0.01, dr);

  const rows = [];
  let iv = 0;
  let fv10 = 0;
  let pvY10 = 0;
  let pvY30 = 0;
  let pvY100 = 0;

  for (let i = 1; i <= 100; i++) {
    let fv = 0;
    if (i <= 10) {
      if (s.y1Mode === 'flat1' && i === 1) {
        fv = epsBase;
      } else if (s.y1Mode === 'recovery') {
        if (i === 1) fv = epsBase * (Number(s.y1Mult) || 1);
        else if (i === 2 && s.y2Mult !== null && s.y2Mult !== undefined && s.y2Mult !== '')
          fv = epsBase * Number(s.y2Mult);
        else if (i === 3 && s.y3Mult !== null && s.y3Mult !== undefined && s.y3Mult !== '')
          fv = epsBase * Number(s.y3Mult);
        else fv = epsBase * Math.pow(1 + g1, i);
      } else {
        fv = epsBase * Math.pow(1 + g1, i);
      }
      if (i === 10) fv10 = fv;
    } else {
      fv = fv10 * Math.pow(1 + g2, i - 10);
    }
    const pv = fv / Math.pow(1 + safeDr, i);
    iv += pv;
    if (i <= 10) pvY10 += pv;
    else if (i <= 30) pvY30 += pv;
    else pvY100 += pv;
    rows.push({ year: i, fv, pv, cumPv: iv });
  }

  const bvps = Number(s.bvps) || 0;
  const peItems = [
    { label: 'Mean PE 3Y', mult: Number(s.pe3) || 0, val: s.pe3 > 0 ? Number(s.pe3) * epsBase : 0 },
    { label: 'Mean PE 5Y', mult: Number(s.pe5) || 0, val: s.pe5 > 0 ? Number(s.pe5) * epsBase : 0 },
    { label: 'Mean PE 10Y', mult: Number(s.pe10) || 0, val: s.pe10 > 0 ? Number(s.pe10) * epsBase : 0 },
  ];
  const pbvItems = [
    { label: 'Mean PBV 3Y', mult: Number(s.pbv3) || 0, val: s.pbv3 > 0 && bvps > 0 ? Number(s.pbv3) * bvps : 0 },
    { label: 'Mean PBV 5Y', mult: Number(s.pbv5) || 0, val: s.pbv5 > 0 && bvps > 0 ? Number(s.pbv5) * bvps : 0 },
    { label: 'Mean PBV 10Y', mult: Number(s.pbv10) || 0, val: s.pbv10 > 0 && bvps > 0 ? Number(s.pbv10) * bvps : 0 },
  ];
  const peVals = peItems.filter((x) => x.val > 0).map((x) => x.val);
  const pbvVals = pbvItems.filter((x) => x.val > 0).map((x) => x.val);
  let relPool = s.relMode === 'pe' ? peVals : s.relMode === 'pbv' ? pbvVals : [...peVals, ...pbvVals];
  if (!relPool.length) relPool = [...peVals, ...pbvVals];
  const rv = relPool.length ? percentileInc(relPool, Number(s.optimism ?? 0.5)) : 0;

  const fvFinal = s.includeRel && rv > 0 ? (iv + rv) / 2 : iv;
  const mos = fvFinal > 0 ? 1 - price / fvFinal : 0;
  const impliedPe = epsBase > 0 ? iv / epsBase : 0;

  return {
    avgNiAdj,
    predictR,
    avgOpm,
    stdOpm,
    covOpm,
    cagr,
    opmsAll,
    niAdjsAll,
    shares,
    epsAdj,
    epsBase,
    factors,
    betaAvg,
    betaFinal,
    dr: safeDr,
    iv,
    pvY10,
    pvY30,
    pvY100,
    rows,
    peItems,
    pbvItems,
    rv,
    fvFinal,
    mos,
    impliedPe,
  };
}
