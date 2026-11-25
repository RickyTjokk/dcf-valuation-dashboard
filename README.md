# DCF Valuation Lab — Fundamental Beta & 100-Year EPS Model

Dashboard valuasi saham IDX interaktif berbasis **Fundamental Beta 6 Faktor (Interpolasi Linear)**, **DCF EPS 100 Tahun**, **Relative Valuation (Mean PE & PBV)**, serta **Live Harga & Market Cap IDX**.

## Fitur Utama
- **3-Step Guided Workflow**:
  1. **Data Keuangan** — Input 4–7 tahun Penjualan, Laba Usaha, Laba Bersih + tempel langsung dari Excel/Google Sheets + statistik otomatis (`OPM`, `COV OPM`, `Predictability R`, `CAGR`).
  2. **Risiko & Asumsi** — Input `ROE`, `DER`, `NPM`, `EPS TTM`, `BVPS`, slider interaktif (`Growth 0–10Y`, `Growth >10Y`, `Beta Adjustment`), serta `Relative Valuation`.
  3. **Hasil & Analisa** — Price Gauge, Target Harga Beli (`MoS 50%/40%/30%`) & Jual, Grafik 6-Faktor Beta & Tabel Kalibrasi CAPM, Grafik Proyeksi 100 Tahun, dan Matriks Sensitivitas 5×5.
- **15 Preset Emiten Utama IDX** (`BBRI`, `BBCA`, `CMRY`, `KLBF`, `CNMA`, `BBNI`, `BRIS`, `ICBP`, `TLKM`, `SIDO`, `ASII`, `UNVR`, `MYOR`, `ADRO`, `PTBA`) + Watchlist tersimpan di `localStorage`.
- **Hybrid Live Price & Market Cap**:
  - Default otomatis melalui Vercel Serverless Proxy (`/api/quote?ticker=BBRI` → Yahoo Finance `BBRI.JK`).
  - Opsional **Google Finance Bridge** via Google Apps Script (`apps-script/Code.gs`).

---

## Cara Deploy Gratis ke Vercel (1 Klik)

1. Buka [vercel.com/new](https://vercel.com/new) dan login dengan akun GitHub kamu.
2. Pilih repository **`RickyTjokk/dcf-valuation-dashboard`** lalu klik **Import**.
3. Biarkan pengaturan default (`Framework: Vite`, `Build: npm run build`, `Output: dist`) lalu klik **Deploy**.
4. Dalam <1 menit aplikasi + API `/api/quote` langsung online dan bisa diakses dari HP maupun laptop.

### Opsional: Menghubungkan Langsung ke `=GOOGLEFINANCE()`
Jika kamu ingin sumber harga & market cap 100% dari Google Finance:
1. Buka Google Sheets milikmu → menu **Extensions → Apps Script**.
2. Salin isi file [`apps-script/Code.gs`](apps-script/Code.gs) ke editor Apps Script.
3. Klik **Deploy → New deployment → Web app** (*Execute as: Me*, *Who has access: Anyone*).
4. Salin URL Web App yang muncul, lalu tempel di tombol **Pengaturan (ikon gerigi)** pada dashboard.

---

## Menjalankan Secara Lokal

```bash
npm install
npm test
npm run dev
```
