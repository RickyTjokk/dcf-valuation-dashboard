import { loadLocalGeminiKey } from './smartParser.js';

export function buildLocalExplanation(state, res) {
  const sorted = [...res.factors].sort((a, b) => a.beta - b.beta);
  const strongest = sorted[0];
  const riskiest = sorted[sorted.length - 1];
  const mosPct = (res.mos * 100).toFixed(1);
  const buy30 = Math.round(res.fvFinal * 0.7).toLocaleString('id-ID');
  const exp5Y =
    res.expectedReturn5Y?.totalCagr5Y !== null && res.expectedReturn5Y?.totalCagr5Y !== undefined
      ? ` Potensi total return 5 tahun sekitar ${(res.expectedReturn5Y.totalCagr5Y * 100).toFixed(1)}%/thn.`
      : '';
  const impliedStr =
    res.impliedG1 !== null
      ? ` Pasar saat ini mem-price-in growth ${(res.impliedG1 * 100).toFixed(1)}%/thn (vs SGR organik ${(res.sgr * 100).toFixed(1)}%).`
      : '';
  const cashNote =
    res.cashQuality?.ocfConversion !== null
      ? ` Konversi kas OCF/Laba Bersih tercatat ${(res.cashQuality.ocfConversion * 100).toFixed(0)}% (${res.cashQuality.status.label}).`
      : '';

  return {
    engine: 'local',
    model: 'Analisa Otomatis',
    data: {
      summary: `${state.ticker} memiliki Kualitas Bisnis Grade ${res.qualityGrade} (${res.qualityScore}/100 — ${res.qualityLabel}) dengan Margin of Safety ${mosPct}%. ${res.verdict.title}.${exp5Y}`,
      strengths: `Keunggulan utamanya ada pada ${strongest.label} (${strongest.fmt(strongest.val)}, Beta ${strongest.beta.toFixed(2)}) dengan profil DuPont: ${res.dupont.driver.label} (ROA implied ${(res.dupont.roaImplied * 100).toFixed(1)}%).${impliedStr}`,
      risks: `Poin yang perlu dicermati adalah ${riskiest.label} (${riskiest.fmt(riskiest.val)}, Beta ${riskiest.beta.toFixed(2)}), karena menjadi penyumbang risiko terbesar.${cashNote}`,
      nextSteps: `${
        res.isStaleData
          ? `Data laporan keuangan masih tahun ${res.dataYear} — perbarui dulu dengan data terbaru lewat tombol AI Smart Input. `
          : ''
      }Sebagai patokan disiplin value investing, area beli aman (MoS 30%) berada di kisaran Rp ${buy30} atau lebih rendah.`,
    },
  };
}

export async function explainValuationAI(state, res) {
  const payload = {
    ticker: state.ticker,
    name: state.name,
    price: state.price,
    finalValuation: Math.round(res.fvFinal),
    intrinsicValuation: Math.round(res.iv),
    relativeValuation: state.includeRel ? Math.round(res.rv) : null,
    marginOfSafetyPct: Number((res.mos * 100).toFixed(1)),
    qualityGrade: res.qualityGrade,
    qualityScore: res.qualityScore,
    verdict: res.verdict.title,
    discountRatePct: Number((res.dr * 100).toFixed(2)),
    betaFinal: Number(res.betaFinal.toFixed(2)),
    growth0to10Pct: Number((state.g1 * 100).toFixed(1)),
    impliedGrowthPct: res.impliedG1 !== null ? Number((res.impliedG1 * 100).toFixed(1)) : null,
    sgrPct: Number((res.sgr * 100).toFixed(1)),
    expectedReturn5YPct:
      res.expectedReturn5Y?.totalCagr5Y !== null && res.expectedReturn5Y?.totalCagr5Y !== undefined
        ? Number((res.expectedReturn5Y.totalCagr5Y * 100).toFixed(1))
        : null,
    dupontSummary: res.dupont.driver.label,
    ocfConversionPct:
      res.cashQuality?.ocfConversion !== null
        ? Number((res.cashQuality.ocfConversion * 100).toFixed(1))
        : null,
    dataYear: res.dataYear,
    isStaleData: res.isStaleData,
    factors: res.factors.map((f) => ({
      name: f.label,
      value: f.fmt(f.val),
      beta: Number(f.beta.toFixed(2)),
    })),
  };

  const localKey = loadLocalGeminiKey();
  const headers = { 'Content-Type': 'application/json' };
  if (localKey) headers['x-gemini-key'] = localKey;

  try {
    const resp = await fetch('/api/explain-valuation', {
      method: 'POST',
      headers,
      body: JSON.stringify(payload),
    });
    if (resp.ok) {
      const json = await resp.json();
      if (json.ok && json.data) {
        return {
          engine: 'gemini',
          model: json.model || 'gemini-3.1-flash-lite',
          data: json.data,
        };
      }
    }
  } catch {}

  return buildLocalExplanation(state, res);
}
