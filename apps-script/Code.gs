/**
 * Google Apps Script Bridge (Opsional)
 * Tempel kode ini di Google Sheets -> Extensions -> Apps Script,
 * lalu Deploy -> New Deployment -> Web app (Execute as: Me, Who has access: Anyone).
 * Salin URL Web App ke menu Pengaturan Live Data di DCF Dashboard.
 */
function doGet(e) {
  var ticker = (e && e.parameter && e.parameter.ticker ? String(e.parameter.ticker) : 'BBRI')
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '');

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName('_DCF_LIVE_CACHE') || ss.insertSheet('_DCF_LIVE_CACHE');

  sheet.getRange('A1').setValue('IDX:' + ticker);
  sheet.getRange('B1').setFormula('=IFERROR(GOOGLEFINANCE(A1,"price"),"")');
  sheet.getRange('C1').setFormula('=IFERROR(GOOGLEFINANCE(A1,"marketcap")/1000000000000,"")');
  sheet.getRange('D1').setFormula('=IFERROR(GOOGLEFINANCE(A1,"name"),"")');
  sheet.getRange('E1').setFormula('=IFERROR(GOOGLEFINANCE(A1,"eps"),"")');
  SpreadsheetApp.flush();

  var price = Number(sheet.getRange('B1').getValue()) || null;
  var marketCapTrillion = Number(sheet.getRange('C1').getValue()) || null;
  var name = String(sheet.getRange('D1').getValue() || ticker);
  var epsTTM = Number(sheet.getRange('E1').getValue()) || null;

  var result = {
    ticker: ticker,
    symbol: 'IDX:' + ticker,
    name: name,
    price: price,
    marketCapTrillion: marketCapTrillion,
    sharesBillion: price && marketCapTrillion ? (marketCapTrillion / price) * 1000 : null,
    epsTTM: epsTTM,
    bvps: null,
    currency: 'IDR',
    source: 'google-finance',
    updatedAt: new Date().toISOString()
  };

  return ContentService
    .createTextOutput(JSON.stringify(result))
    .setMimeType(ContentService.MimeType.JSON);
}
