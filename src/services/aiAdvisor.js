import { loadLocalGeminiKey } from './smartParser.js';

export function buildLocalExplanation(state, res) {
  const sorted = [...res.factors].sort((a, b) => a.beta - b.beta);
  const strongest = sorted[0];
  const riskiest = sorted[sorted.length - 1];
  const mosPct = (res.mos * 100).toFixed(1);
  const buy30 = Math.round(res.fvFinal * 0.7).toLocaleString('id-ID');

  return {
    engine: 'local',
    model: 'Analisa Otomatis',
    data: {
      summary: `${state.ticker} memiliki Kualitas Bisnis Grade ${res.qualityGrade} (${res.qualityScore}/100 — ${res.qualityLabel}) dengan Margin of Safety ${mosPct}%. ${res.verdict.title}.`,
      strengths: `Keunggulan utamanya ada pada ${strongest.label} (${strongest.fmt(strongest.val)}, Beta ${strongest.beta.toFixed(2)}) yang membantu menjaga risiko dan menekan Discount Rate ke ${(res.dr * 100).toFixed(2)}%.`,
      risks: `Poin yang perlu dicermati adalah ${riskiest.label} (${riskiest.fmt(riskiest.val)}, Beta ${riskiest.beta.toFixed(2)}), karena menjadi penyumbang risiko terbesar dalam perhitungan valuasi ini.`,
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
