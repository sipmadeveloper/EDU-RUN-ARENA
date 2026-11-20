# Panduan Deploy Gratis EDU RUN ARENA 3D (GitHub + Vercel + Firebase)

**EDU RUN ARENA 3D** sekarang berjalan **100% Serverless** menggunakan **Vercel (Gratis)** + **Firebase Firestore (Spark Free Tier)** + **Google Drive Pribadi Guru**.
- **Tanpa kartu kredit**
- **Tanpa server Node.js / Docker berbayar**
- **Bisa di-deploy langsung lewat browser HP dalam 2 menit!**

---

## Langkah 1 — Pastikan Kode Terbaru Sudah di GitHub
1. Dari AI Studio, simpan/push perubahan terbaru ini ke repositori GitHub Anda (misalnya `sipmadeveloper/EDU-RUN-ARENA`).
2. Workflow Hugging Face lama sudah dihapus agar tab **Actions** di GitHub bersih tanpa tanda silang merah.

---

## Langkah 2 — Deploy ke Vercel (Gratis, Bisa dari HP)
1. Buka **[https://vercel.com](https://vercel.com)** di browser HP atau laptop.
2. Klik **Sign Up / Log In** lalu pilih **Continue with GitHub**.
3. Klik tombol **Add New… → Project**.
4. Pilih repositori **EDU-RUN-ARENA**, lalu klik **Import**.
5. Pastikan pengaturan berikut sudah terdeteksi otomatis:
   - **Framework Preset**: `Vite`
   - **Build Command**: `npm run build`
   - **Output Directory**: `dist`
   - *(Tidak perlu mengisi Environment Variable apa pun — konfigurasi Firebase sudah tertanam aman di proyek!)*
6. Klik tombol **Deploy** dan tunggu sekitar 1–2 menit sampai muncul status **Congratulations / Ready** beserta alamat website, misalnya:
   `https://edu-run-arena.vercel.app`

---

## Langkah 3 — Daftarkan Domain Vercel agar Login Google & Drive Aktif
Agar guru bisa menekan tombol **Sign in with Google** dan **Google Drive** di alamat Vercel baru Anda:

### A. Firebase Authorized Domains
1. Buka **[Firebase Console](https://console.firebase.google.com/)** → pilih proyek **`gen-lang-client-0581931190`**.
2. Masuk ke menu **Authentication → Settings → Authorized domains**.
3. Klik **Add domain**, lalu masukkan domain Vercel Anda (tanpa `https://`), contoh:
   `edu-run-arena.vercel.app`
4. Klik **Add**.

### B. Google Cloud OAuth Authorized JavaScript Origins (Untuk Google Drive)
1. Buka **[Google Cloud Console — Credentials](https://console.cloud.google.com/apis/credentials)** pada proyek yang sama.
2. Klik **OAuth 2.0 Client ID** yang digunakan aplikasi.
3. Pada bagian **Authorized JavaScript origins**, klik **+ ADD URI** dan masukkan alamat lengkap dengan `https://`, contoh:
   `https://edu-run-arena.vercel.app`
4. Klik **Save**.

---

## Selesai!
- **Guru** login dengan akun Google, membuat room, mengelola Bank Soal (termasuk impor `.docx` dan ekspor `.xlsx` langsung di browser), serta memantau balapan 3D secara real-time.
- **Siswa** cukup buka link Vercel dari HP/laptop, masukkan **Kode Room 6 karakter** (atau klik Link Peserta dari guru), pilih karakter 3D, dan langsung bertanding!
- Setiap kali Anda push pembaruan kode ke GitHub, **Vercel akan otomatis melakukan deploy ulang**.
