import { X, Zap, AlertTriangle, Trophy, ShieldCheck, FileSpreadsheet } from 'lucide-react';
import { AppLogo } from './AppLogo';

interface HowToPlayModalProps {
  onClose: () => void;
}

export function HowToPlayModal({ onClose }: HowToPlayModalProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/75">
      <div className="w-full max-w-2xl rounded-2xl bg-[#0F2957] border border-blue-400/30 text-white shadow-2xl overflow-hidden">
        <div className="flex items-center justify-between px-6 py-4 border-b border-white/10 bg-[#081226]">
          <div className="flex items-center gap-3">
            <AppLogo size="xs" />
            <h2 className="font-display font-bold text-xl">Cara Bermain — EDU RUN ARENA 3D</h2>
          </div>
          <button
            onClick={onClose}
            aria-label="Tutup panduan"
            className="p-2 rounded-lg hover:bg-white/10 text-slate-300 hover:text-white cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="p-6 space-y-5 max-h-[78vh] overflow-y-auto text-sm leading-relaxed text-slate-200">
          <div className="grid sm:grid-cols-2 gap-4">
            <div className="p-4 rounded-xl bg-[#081226] border border-white/10">
              <div className="flex items-center gap-2 font-display font-bold text-cyan-300 mb-2">
                <Zap className="w-4 h-4" />
                <span>Jawaban Benar = Speed Boost</span>
              </div>
              <p>
                Semua pelari mulai dengan kecepatan normal yang stabil. Nilai maksimal{' '}
                <strong>100 poin</strong> dengan bobot poin per soal dan jumlah putaran yang{' '}
                <strong>menyesuaikan otomatis</strong> sesuai jumlah soal. Jawaban benar memicu{' '}
                <strong>Speed Boost 15 detik</strong> agar karakter berlari lebih cepat melewati lawan.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#081226] border border-white/10">
              <div className="flex items-center gap-2 font-display font-bold text-amber-300 mb-2">
                <AlertTriangle className="w-4 h-4" />
                <span>Salah / Tidak Menjawab = Slow 30 Detik</span>
              </div>
              <p>
                Jawaban salah atau melewati batas waktu bernilai <strong>0 poin</strong> dan
                membuat karakter <strong>berlari sangat pelan selama 30 detik</strong> sebelum
                kembali ke kecepatan normal.
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#081226] border border-white/10">
              <div className="flex items-center gap-2 font-display font-bold text-[#FACC15] mb-2">
                <Trophy className="w-4 h-4" />
                <span>Dua Sistem Peringkat Resmi</span>
              </div>
              <p>
                Sistem mencatat <strong>Peringkat Finish</strong> (urutan tercepat mencapai garis finish)
                dan <strong>Peringkat Nilai</strong> (total poin tertinggi, lalu jumlah benar dan durasi).
              </p>
            </div>

            <div className="p-4 rounded-xl bg-[#081226] border border-white/10">
              <div className="flex items-center gap-2 font-display font-bold text-emerald-300 mb-2">
                <ShieldCheck className="w-4 h-4" />
                <span>3 Pilihan Tempat Balapan & Reconnect</span>
              </div>
              <p>
                Guru dapat memilih lokasi balapan di <strong>Stadion Siang Hari</strong>,{' '}
                <strong>Stadion Malam Hari</strong> (dengan sorot lampu), atau{' '}
                <strong>Lapangan Luar Stadion</strong>. Jika koneksi terputus, gabung ulang untuk
                melanjutkan balapan.
              </p>
            </div>
          </div>

          <div className="p-4 rounded-xl bg-blue-950/60 border border-blue-400/20 flex items-start gap-3">
            <FileSpreadsheet className="w-5 h-5 text-[#FF6B1A] shrink-0 mt-0.5" />
            <div>
              <div className="font-semibold text-white mb-1">Untuk Guru & Pengelola Kelas</div>
              <p className="text-xs text-slate-300">
                Masuk ke Dashboard Guru untuk membuat room hingga 30 peserta, memilih lokasi
                balapan 3D, mengimpor soal dari Microsoft Word (.docx), memantau balapan 3D
                secara realtime, dan mengunduh rekap nilai lengkap dalam format Excel (.xlsx) 3 sheet.
              </p>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 bg-[#081226] border-t border-white/10 flex justify-end">
          <button
            onClick={onClose}
            className="px-6 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-semibold text-white cursor-pointer"
          >
            Mengerti, Ayo Mulai
          </button>
        </div>
      </div>
    </div>
  );
}
