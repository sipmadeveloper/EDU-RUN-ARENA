# Panduan Deploy 100% dari HP (Gratis Tanpa Kartu Kredit): GitHub → Hugging Face Spaces

Proyek **EDU RUN ARENA 3D** sudah dilengkapi otomatisasi **GitHub Actions** (`.github/workflows/sync-huggingface.yml`) + **`Dockerfile`** + **`README.md`**. Anda cukup melakukan beberapa ketukan dari browser HP — **tanpa laptop, tanpa terminal, tanpa upload ZIP, dan tanpa kartu kredit**.

---

## Langkah 1: Simpan Proyek ke GitHub
1. Simpan / ekspor proyek ini ke repositori **GitHub** Anda (misalnya bernama `edu-run-arena-3d`).

## Langkah 2: Ambil Token dari Hugging Face (Cukup Sekali)
1. Daftar / login gratis di [huggingface.co](https://huggingface.co/) lewat browser HP.
2. Catat **Username** Hugging Face Anda (contoh: `gurukreatif`).
3. Buka [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) → klik **+ Create new token**.
4. Pilih tipe **Write**, beri nama bebas (misalnya `github-deploy`) → klik **Create token**.
5. **Salin token** yang muncul (`hf_xxxxxxxx...`).

## Langkah 3: Tempel Token ke GitHub (Dari Browser HP)
1. Buka repositori GitHub proyek Anda → klik tab **Settings**.
2. Di menu samping, buka **Secrets and variables** → klik **Actions**.
3. Klik **New repository secret** sebanyak 2 kali untuk menambahkan:
   - Secret 1:
     - **Name**: `HF_USERNAME`
     - **Secret**: username Hugging Face Anda *(contoh: `gurukreatif`)*
   - Secret 2:
     - **Name**: `HF_TOKEN`
     - **Secret**: tempel token `hf_xxxxxxxx...` dari Langkah 2

## Langkah 4: Jalankan Deploy 1-Klik!
1. Di repositori GitHub Anda, buka tab **Actions**.
2. Klik **Deploy Otomatis ke Hugging Face Spaces**.
3. Klik tombol **Run workflow** → klik **Run workflow** (hijau).
4. Tunggu ~30 detik sampai muncul centang hijau — GitHub akan **otomatis membuat Space `edu-run-arena-3d` di akun Hugging Face Anda** dan mengirim seluruh kode beserta logo PNG-nya!
5. Buka `https://huggingface.co/spaces/USERNAME_ANDA/edu-run-arena-3d` dan tunggu 2–4 menit sampai status berubah menjadi hijau **Running**.
6. **URL Langsung Aplikasi Anda** (bagikan link ini ke guru & siswa):
   ```
   https://USERNAME_ANDA-edu-run-arena-3d.hf.space
   ```

## Langkah 5: Daftarkan Domain `.hf.space` ke Firebase & Google Drive OAuth
Agar **Login Google Guru** & **Google Drive otomatis** aktif:
1. **Firebase Authorized Domains**:
   - Buka: https://console.firebase.google.com/project/gen-lang-client-0581931190/authentication/settings
   - Tab **Authorized domains** → **Add domain** → masukkan `USERNAME_ANDA-edu-run-arena-3d.hf.space` *(tanpa `https://`)* → **Add**.
2. **Google Cloud OAuth (Google Drive)**:
   - Buka: https://console.cloud.google.com/apis/credentials?project=gen-lang-client-0581931190
   - Klik Client ID (`302879231437-jdpgoere4q7hujlnda6k5u77bs5sck17.apps.googleusercontent.com`).
   - Di **Authorized JavaScript origins** → **+ ADD URI** → masukkan `https://USERNAME_ANDA-edu-run-arena-3d.hf.space` → **Save**.

Selesai! Setiap kali nanti ada pembaruan dan Anda simpan ke GitHub, **Hugging Face akan ter-update otomatis**.
