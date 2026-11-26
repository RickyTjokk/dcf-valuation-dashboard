/**
 * Kamus domain resmi 80+ emiten IDX (termasuk seluruh 15 preset utama)
 * untuk menampilkan logo perusahaan otomatis via Google Favicon HD + fallback monogram.
 */

export const TICKER_DOMAINS = {
  // 15 Preset Utama
  BBRI: 'bri.co.id',
  BBCA: 'bca.co.id',
  BBNI: 'bni.co.id',
  BRIS: 'bankbsi.co.id',
  CMRY: 'cimory.com',
  KLBF: 'kalbe.co.id',
  CNMA: '21cineplex.com',
  ICBP: 'indofoodcbp.com',
  TLKM: 'telkom.co.id',
  SIDO: 'sidomuncul.co.id',
  ASII: 'astra.co.id',
  UNVR: 'unilever.co.id',
  MYOR: 'mayoraindah.co.id',
  ADRO: 'alamtri.com',
  PTBA: 'ptba.co.id',

  // Emiten Populer IDX lainnya (LQ45 / IDX80 / Tech / Consumer / Energy)
  BMRI: 'bankmandiri.co.id',
  BBTN: 'btn.co.id',
  BNGA: 'cimbniaga.co.id',
  NISP: 'ocbc.id',
  BDMN: 'danamon.co.id',
  ARTO: 'jago.com',
  BBYB: 'bankneocommerce.co.id',
  BTPS: 'btpnsyariah.com',
  INDF: 'indofood.com',
  CPIN: 'cp.co.id',
  JPFA: 'japfacomfeed.co.id',
  ULTJ: 'ultrajaya.co.id',
  CLEO: 'tanobelfood.com',
  ROTI: 'sariroti.com',
  HMSP: 'sampoerna.com',
  GGRM: 'gudanggaramtbk.com',
  WIIM: 'wismilak.com',
  AMRT: 'alfamartku.com',
  ACES: 'ruparupa.com',
  MAPI: 'map.co.id',
  MAPA: 'mapactive.id',
  ERAA: 'erajaya.com',
  MIDI: 'alfamidi.co.id',
  RALS: 'ramayana.co.id',
  LPPF: 'matahari.com',
  ISAT: 'ioh.co.id',
  EXCL: 'xl.co.id',
  TOWR: 'ptsmn.co.id',
  TBIG: 'tower-bersama.com',
  MTEL: 'mitratel.co.id',
  GOTO: 'gotocompany.com',
  BUKA: 'bukalapak.com',
  BELI: 'blibli.com',
  EMTK: 'emtek.co.id',
  SCMA: 'scm.co.id',
  MNCN: 'mnc.co.id',
  ANTM: 'antam.com',
  INCO: 'vale.com',
  MDKA: 'merdekacoppergold.com',
  AMMN: 'amman.co.id',
  ITMG: 'itmg.co.id',
  UNTR: 'unitedtractors.com',
  PGAS: 'pgn.co.id',
  MEDC: 'medcoenergi.com',
  AKRA: 'akr.co.id',
  BREN: 'baritorenewables.co.id',
  BRPT: 'barito-pacific.com',
  TPIA: 'chandra-asri.com',
  SMGR: 'sig.id',
  INTP: 'indocement.co.id',
  AVIA: 'avianbrands.com',
  ARNA: 'arwanacitra.com',
  PWON: 'pakuwonjati.com',
  BSDE: 'sinarmasland.com',
  CTRA: 'ciputradevelopment.com',
  SMRA: 'summarecon.com',
  DMAS: 'deltamas.co.id',
  MIKA: 'mitrakeluarga.com',
  HEAL: 'herminahospitals.com',
  SILO: 'siloamhospitals.com',
  JSMR: 'jasamarga.com',
  INKP: 'app.co.id',
  TKIM: 'app.co.id',
  AUTO: 'component.astra.co.id',
  MTDL: 'metrodata.co.id',
  AXIO: 'axiooworld.com',
  POWR: 'cikaranglistrindo.com',
  LSIP: 'londonsumatra.com',
  AALI: 'astra-agro.co.id',
  SCNP: 'sanken.co.id',
  PZZA: 'pizzahut.co.id',
};

const PALETTE = [
  '#0f766e',
  '#0369a1',
  '#1d4ed8',
  '#4338ca',
  '#047857',
  '#b45309',
  '#be123c',
  '#334155',
];

export function getTickerColor(ticker) {
  const clean = String(ticker || 'XX').toUpperCase();
  let hash = 0;
  for (let i = 0; i < clean.length; i++) {
    hash = (hash * 31 + clean.charCodeAt(i)) >>> 0;
  }
  return PALETTE[hash % PALETTE.length];
}

export function getTickerLogoUrl(ticker) {
  const clean = String(ticker || '').trim().toUpperCase().replace(/\.JK$/i, '');
  const domain = TICKER_DOMAINS[clean];
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=128`;
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function renderTickerLogoHtml(ticker, size = 28) {
  const clean = String(ticker || 'XX').trim().toUpperCase().replace(/\.JK$/i, '');
  const url = getTickerLogoUrl(clean);
  const bg = getTickerColor(clean);
  const mono = clean.slice(0, 4) || 'IDX';
  const safeSize = Math.max(12, Number(size) || 28);
  const fontSize = safeSize <= 24 ? 9 : 10;

  const fallbackHtml = `<span class="ticker-monogram" style="background:${bg};font-size:${fontSize}px">${escHtml(mono)}</span>`;

  if (!url) {
    return `<span class="ticker-logo" style="width:${safeSize}px;height:${safeSize}px">${fallbackHtml}</span>`;
  }

  return `<span class="ticker-logo" style="width:${safeSize}px;height:${safeSize}px"><img src="${url}" alt="${escHtml(clean)}" loading="lazy" onerror="this.style.display='none';this.nextElementSibling.style.display='flex'" /><span class="ticker-monogram" style="display:none;background:${bg};font-size:${fontSize}px">${escHtml(mono)}</span></span>`;
}
