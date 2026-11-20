import { useState } from 'react';
import { ArrowLeft, CheckCircle2, Loader2, ShieldCheck } from 'lucide-react';
import { AppLogo } from './AppLogo';
import { formatFriendlyFirestoreError, signInWithGoogleAccount } from '../firebase';
import {
  cloudProfileToTeacherProfile,
  ensureTeacherCloudProfile,
  loadQuestionBankFromCloud,
  syncQuestionBankToCloud,
} from '../services/firebaseCloudStore';
import {
  BANK_SOAL_FILENAME,
  downloadQuestionBankFromDrive,
  listEduRunDriveFilesReadOnly,
} from '../services/googleDriveService';
import { buildStarterQuestionItems } from '../services/starterQuestions';
import type { QuestionItem, TeacherProfile } from '../types/game';

interface TeacherAuthViewProps {
  onBack: () => void;
  onAuthenticated: (token: string, teacher: TeacherProfile) => void;
}

export function TeacherAuthView({ onBack, onAuthenticated }: TeacherAuthViewProps) {
  const [googleLoading, setGoogleLoading] = useState(false);
  const [error, setError] = useState('');

  async function handleGoogleLogin() {
    setGoogleLoading(true);
    setError('');
    try {
      const { user, accessToken } = await signInWithGoogleAccount();
      if (!user || !user.email) {
        setError('Akun Google tidak memiliki alamat email terverifikasi.');
        return;
      }

      const cloudProfile = await ensureTeacherCloudProfile(user, null);

      // Check Firestore Bank Soal; if empty, check Google Drive backup; if still empty, auto-seed 50 starter questions
      let existingCount = 0;
      try {
        const cloudBank = await loadQuestionBankFromCloud(user.uid);
        existingCount = cloudBank.questions.length;
      } catch {
        // Non-blocking check
      }

      if (existingCount === 0 && accessToken) {
        try {
          const driveCheck = await listEduRunDriveFilesReadOnly(accessToken);
          const driveBankFile = driveCheck.files.find((f) => f.name === BANK_SOAL_FILENAME);
          if (driveBankFile) {
            const driveQuestions = await downloadQuestionBankFromDrive(accessToken, driveBankFile.id);
            if (driveQuestions.length > 0) {
              const items: QuestionItem[] = driveQuestions.map((q) => ({
                id: q.id,
                subject: q.subject,
                grade: q.grade,
                questionType: q.questionType,
                prompt: q.prompt,
                options: q.options,
                correctAnswer: q.correctAnswer,
                explanation: q.explanation,
                createdAt: new Date().toISOString(),
              }));
              await syncQuestionBankToCloud(user.uid, items);
              existingCount = items.length;
            }
          }
        } catch {
          // Non-blocking: Drive token remains cached in memory and can be retried in Drive panel
        }
      }

      if (existingCount === 0) {
        try {
          const { merged } = buildStarterQuestionItems([]);
          await syncQuestionBankToCloud(user.uid, merged);
        } catch {
          // Non-blocking; teacher can also seed starter questions manually in Bank Soal tab
        }
      }

      const teacherProfile = cloudProfileToTeacherProfile(user.uid, cloudProfile);
      onAuthenticated(user.uid, teacherProfile);
    } catch (err) {
      setError(formatFriendlyFirestoreError(err));
    } finally {
      setGoogleLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#081226] text-white flex flex-col justify-between p-4 sm:p-8">
      <div className="max-w-md w-full mx-auto my-auto">
        <button
          onClick={onBack}
          className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F2957] border border-blue-400/20 text-sm font-semibold hover:bg-blue-900 transition-colors cursor-pointer mb-6"
        >
          <ArrowLeft className="w-4 h-4" />
          <span>Kembali ke Beranda</span>
        </button>

        <div className="p-6 sm:p-8 rounded-2xl bg-[#0F2957] border border-blue-400/25 shadow-2xl">
          <div className="flex flex-col items-center text-center mb-6">
            <AppLogo size="xl" className="mb-4" />
            <h1 className="font-display font-bold text-2xl tracking-tight">Portal Guru</h1>
            <p className="text-xs text-blue-200/85 font-semibold mt-1">
              EDU RUN <span className="text-[#FF6B1A]">ARENA 3D</span>
            </p>
            <p className="text-sm text-slate-300 mt-3 leading-relaxed">
              Masuk atau daftar akun guru secara otomatis menggunakan akun Google Anda.
            </p>
          </div>

          <button
            type="button"
            onClick={handleGoogleLogin}
            disabled={googleLoading}
            className="w-full py-3.5 px-4 rounded-xl bg-white hover:bg-slate-100 disabled:opacity-60 text-[#081226] font-display font-bold text-sm flex items-center justify-center gap-3 shadow-lg cursor-pointer transition-colors"
          >
            {googleLoading ? (
              <Loader2 className="w-5 h-5 animate-spin text-[#1D4ED8]" />
            ) : (
              <svg className="w-5 h-5 shrink-0" viewBox="0 0 48 48" aria-hidden="true">
                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z" />
                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z" />
                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z" />
                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z" />
              </svg>
            )}
            <span>{googleLoading ? 'Menghubungkan akun Google...' : 'Sign in with Google'}</span>
          </button>

          {error && (
            <div className="mt-4 p-3 rounded-xl bg-red-950/60 border border-red-400/40 text-xs text-red-200">
              {error}
            </div>
          )}

          <div className="mt-6 pt-5 border-t border-white/10 space-y-2.5 text-xs text-slate-300">
            <div className="flex items-start gap-2.5">
              <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span>Guru baru otomatis terdaftar dengan 50 contoh soal siap pakai.</span>
            </div>
            <div className="flex items-start gap-2.5">
              <ShieldCheck className="w-4 h-4 text-[#FACC15] shrink-0 mt-0.5" />
              <span>Terhubung langsung ke Google Drive pribadi untuk Bank Soal &amp; Rekap Nilai Excel.</span>
            </div>
          </div>
        </div>
      </div>

      <div className="text-center text-xs text-slate-500 mt-6 space-y-1">
        <div>Setiap room, bank soal, dan hasil pertandingan dilindungi per akun Google guru.</div>
        <div>&copy; {new Date().getFullYear()} EDU RUN ARENA 3D — SIPMA Developer. Hak Cipta Dilindungi.</div>
      </div>
    </div>
  );
}
