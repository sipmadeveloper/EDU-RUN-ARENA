# Panduan Deploy Otomatis (Terima Beres) — EDU RUN ARENA 3D

## 1. Deploy 1-Klik ke Render (Sudah Disiapkan `render.yaml`)
File **`render.yaml`** (Render Blueprint) sudah tersedia langsung di root proyek ini dengan pengaturan otomatis:
- **Region**: Singapore (paling dekat & cepat dari Indonesia)
- **Build Command**: `npm install && npm run build`
- **Start Command**: `NODE_ENV=production npx tsx server.ts`
- **Health Check**: `/api/health`
- **Environment Variables**: `NODE_ENV=production` & `JWT_SECRET` (di-generate otomatis oleh Render, **tidak perlu API Key AI apa pun**)

### Cara Deploy di Render:
1. Push / ekspor proyek ini ke repositori **GitHub** Anda.
2. Login ke [dashboard.render.com](https://dashboard.render.com/).
3. Klik **New +** → pilih **Blueprint** (bukan manual).
4. Pilih repositori GitHub proyek ini → klik **Apply**.
5. Render akan **otomatis membaca `render.yaml`**, menjalankan build & start command, lalu memberikan URL produksi Anda (contoh: `https://edu-run-arena-3d.onrender.com`).

---

## 2. Daftarkan Domain Produksi ke Firebase Console & Google Drive OAuth
Setelah Render selesai deploy dan Anda mendapatkan domain produksinya (misalnya `edu-run-arena-3d.onrender.com`), lakukan 2 langkah singkat berikut agar **Login Google (Firebase)** dan **Simpan ke Google Drive** aktif di domain produksi:

### A. Firebase Auth — Authorized Domains
1. Buka langsung halaman pengaturan Firebase proyek Anda (`gen-lang-client-0581931190`):
   - **Link Langsung**: https://console.firebase.google.com/project/gen-lang-client-0581931190/authentication/settings
2. Masuk ke tab **Authorized domains** → klik **Add domain**.
3. Masukkan domain Render Anda tanpa `https://` (contoh: `edu-run-arena-3d.onrender.com`) → klik **Add**.

### B. Google Cloud OAuth — Authorized JavaScript Origins (Untuk Fitur Google Drive Guru)
1. Buka halaman Credentials Google Cloud proyek Anda:
   - **Link Langsung**: https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0581931190
2. Klik OAuth 2.0 Client ID (`302879231437-jdpgoere4q7hujlnda6k5u77bs5sck17.apps.googleusercontent.com`).
3. Di bagian **Authorized JavaScript origins**, klik **+ ADD URI** dan masukkan URL lengkap produksi Anda (contoh: `https://edu-run-arena-3d.onrender.com`) → klik **Save**.

---

## 3. Catatan Penting
- **100% Tanpa API Key AI**: Komentator, audio, dan hitung mundur berjalan lokal di browser.
- **Database Firebase Hemat Kuota (Spark Free Tier)**: Data pertandingan & pengaturan LED tribun sudah dioptimasi ringan dan langsung sinkron otomatis begitu Anda login di domain produksi.
