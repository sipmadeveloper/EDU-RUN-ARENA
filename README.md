---
title: EDU RUN ARENA 3D
emoji: 🏃
colorFrom: blue
colorTo: indigo
sdk: docker
app_port: 7860
pinned: false
---

# EDU RUN ARENA 3D

Game balap lari kuis edukasi 3D multiplayer realtime hingga 30 siswa per ruangan, dilengkapi stadion 3D, layar digital urutan pembalap, podium kejuaraan dengan upacara pengalungan medali 3D, login Google Guru + integrasi Google Drive, serta ekspor soal Word & hasil Excel.

## Cara Deploy Gratis di Hugging Face Spaces (Tanpa Kartu Kredit)

1. Daftar / login gratis di [huggingface.co](https://huggingface.co/).
2. Buat Space baru di [huggingface.co/new-space](https://huggingface.co/new-space):
   - **Space name**: `edu-run-arena-3d`
   - **SDK**: pilih **Docker** → **Blank**
   - **Space hardware**: **CPU basic · 2 vCPU · 16 GB · FREE**
   - **Visibility**: **Public**
3. Upload seluruh isi proyek ini (atau push via Git) ke Space tersebut.
4. *(Opsional)* Di tab **Settings → Variables and secrets**, tambahkan Secret `JWT_SECRET` berisi teks acak panjang.
5. Tunggu status menjadi **Running**, lalu buka URL langsung aplikasi Anda:  
   `https://<username-anda>-edu-run-arena-3d.hf.space`
6. Daftarkan domain `.hf.space` tersebut di **Firebase Console (Authorized Domains)** dan **Google Cloud Console (OAuth Authorized JavaScript Origins)** agar Login Google & Google Drive Guru aktif.
