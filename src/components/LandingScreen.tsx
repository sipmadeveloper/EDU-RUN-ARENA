import { useState } from 'react';
import { Trophy, Zap, BookOpen, Play, GraduationCap, Camera, Grid2x2, ArrowLeft } from 'lucide-react';
import {
  StadiumArena3D,
  type CameraPresetId,
  type CameraViewMode,
} from './StadiumArena3D';
import { AppLogo } from './AppLogo';
import type { PlayerState } from '../types/game';

interface LandingScreenProps {
  onJoinMatch: () => void;
  onTeacherPortal: () => void;
  onShowHowToPlay: () => void;
}

const SHOWCASE_RUNNERS: PlayerState[] = [
  { id: 's1', name: 'CyberRacer', className: 'VIII-A', avatar: { gender: 'female', color: 'red', outfit: 'pro', presetId: 'cyber_racer' }, lane: 2, progress: 0.1, distance: 10, speed: 6.75, effectState: 'boost', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
  { id: 's2', name: 'Striker', className: 'VIII-A', avatar: { gender: 'male', color: 'blue', outfit: 'varsity', presetId: 'striker_blue_red' }, lane: 6, progress: 0.15, distance: 15, speed: 3, effectState: 'normal', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
  { id: 's3', name: 'Kapten', className: 'VIII-B', avatar: { gender: 'male', color: 'orange', outfit: 'champion', presetId: 'pirate_captain' }, lane: 10, progress: 0.12, distance: 12, speed: 6.75, effectState: 'boost', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
  { id: 's4', name: 'NekoPink', className: 'VIII-B', avatar: { gender: 'female', color: 'pink', outfit: 'varsity', presetId: 'pink_neko_girl' }, lane: 14, progress: 0.11, distance: 11, speed: 6.75, effectState: 'boost', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
  { id: 's5', name: 'Ksatria', className: 'VIII-C', avatar: { gender: 'male', color: 'yellow', outfit: 'champion', presetId: 'gold_knight' }, lane: 18, progress: 0.13, distance: 13, speed: 3, effectState: 'normal', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
  { id: 's6', name: 'Builder', className: 'VIII-D', avatar: { gender: 'male', color: 'yellow', outfit: 'pro', presetId: 'builder_man' }, lane: 22, progress: 0.08, distance: 8, speed: 6.75, effectState: 'boost', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
  { id: 's7', name: 'HoodieRed', className: 'VIII-B', avatar: { gender: 'male', color: 'red', outfit: 'varsity', presetId: 'red_hoodie_boy' }, lane: 25, progress: 0.14, distance: 14, speed: 3, effectState: 'normal', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
  { id: 's8', name: 'BlondeCozy', className: 'VIII-D', avatar: { gender: 'female', color: 'yellow', outfit: 'champion', presetId: 'blonde_cozy_girl' }, lane: 28, progress: 0.16, distance: 16, speed: 3, effectState: 'normal', effectExpiresAt: 0, currentQuestionIndex: 0, answeredCount: 0, correctCount: 0, wrongCount: 0, unansweredCount: 0, score: 0, connected: true },
];

export function LandingScreen({
  onJoinMatch,
  onTeacherPortal,
  onShowHowToPlay,
}: LandingScreenProps) {
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('broadcast');
  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>('pip');

  const isQuadMode = cameraViewMode === 'quad';

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#081226] select-none">
      {/* Fullscreen Live 3D Stadium Showcase with 4-Camera Live Preview */}
      <div className="absolute inset-0">
        <StadiumArena3D
          questionCount={15}
          maxPlayers={30}
          players={SHOWCASE_RUNNERS}
          roomStatus="playing"
          roomName="STADION EDU RUN ARENA 3D"
          showcaseMode={true}
          venue="stadium_day"
          cameraPreset={cameraPreset}
          cameraViewMode={cameraViewMode}
          pipPlacement="right-grid"
          onSelectCameraPreset={setCameraPreset}
          onChangeCameraViewMode={setCameraViewMode}
        />
      </div>

      {/* Measured contrast scrim on the left so hero typography stays crisp while right-side 4-cam preview shines clearly */}
      {!isQuadMode && (
        <div
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'linear-gradient(102deg, rgba(8,18,38,0.92) 0%, rgba(8,18,38,0.72) 40%, rgba(8,18,38,0.0) 64%)',
          }}
        />
      )}

      {/* Fullscreen 4-Camera Exit Bar when viewing 2x2 Quad Grid */}
      {isQuadMode ? (
        <div className="relative z-30 p-4 flex items-center justify-end pointer-events-none">
          <button
            type="button"
            onClick={() => setCameraViewMode('pip')}
            className="pointer-events-auto inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#081226]/92 border border-blue-400/40 text-sm font-semibold text-white hover:bg-[#0F2957] transition-colors cursor-pointer shadow-lg"
          >
            <ArrowLeft className="w-4 h-4 text-[#FACC15]" />
            <span>Kembali ke Beranda</span>
          </button>
        </div>
      ) : (
        /* Foreground Title & Primary Actions (pointer-events-none container so 4-cam live previews remain clickable) */
        <div className="relative z-10 h-full max-w-7xl mx-auto px-6 sm:px-10 flex flex-col justify-between py-5 sm:py-7 pointer-events-none">
          {/* Brand Lockup & Quick Controls */}
          <div className="flex flex-wrap items-center justify-between gap-4 pointer-events-auto">
            <div className="flex items-center gap-3.5">
              <AppLogo size="lg" />
              <div>
                <div className="font-display font-extrabold text-xl sm:text-2xl tracking-tight text-white">
                  EDU RUN <span className="text-[#FF6B1A]">ARENA 3D</span>
                </div>
                <div className="text-xs text-blue-200/80 font-medium">
                  Kompetisi Balap Lari Edukatif Multiplayer
                </div>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() =>
                  setCameraViewMode((prev) =>
                    prev === 'single' ? 'pip' : prev === 'pip' ? 'quad' : 'single'
                  )
                }
                className={`inline-flex items-center gap-2 px-3.5 py-2.5 rounded-xl border text-sm font-semibold transition-colors cursor-pointer whitespace-nowrap shrink-0 ${
                  cameraViewMode !== 'single'
                    ? 'bg-[#FF6B1A] border-[#FF6B1A] text-white hover:bg-[#e85d10]'
                    : 'bg-[#0F2957] border-blue-400/30 text-white hover:bg-blue-800'
                }`}
                title="Ganti tampilan Live Preview 4 Kamera"
              >
                {cameraViewMode === 'pip' ? (
                  <>
                    <Grid2x2 className="w-4 h-4 text-[#FACC15]" />
                    <span>Mode 4 Layar (2×2)</span>
                  </>
                ) : (
                  <>
                    <Camera className="w-4 h-4 text-[#FACC15]" />
                    <span>Live 4 Kamera</span>
                  </>
                )}
              </button>

              <button
                onClick={onShowHowToPlay}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F2957] border border-blue-400/30 text-sm font-semibold text-white hover:bg-blue-800 transition-colors cursor-pointer whitespace-nowrap shrink-0"
              >
                <BookOpen className="w-4 h-4 text-[#FACC15]" />
                <span>Cara Bermain</span>
              </button>
            </div>
          </div>

          {/* Hero Centerpiece */}
          <div
            className={`max-w-xl my-auto py-4 pointer-events-auto ${
              cameraViewMode === 'pip' ? 'pb-28 sm:pb-32 lg:pb-4' : ''
            }`}
          >
            <h1
              className="font-display font-extrabold text-3xl sm:text-5xl lg:text-[54px] leading-[1.08] tracking-tight text-white mb-4 sm:mb-5"
              style={{ textWrap: 'balance' }}
            >
              Berlari Menuju Garis Finish dengan Kekuatan Ilmu
            </h1>

            <p className="text-sm sm:text-base lg:text-lg text-slate-200/90 leading-relaxed max-w-xl mb-6 sm:mb-8">
              Taklukkan lintasan balap sambil menjawab kuis pelajaran. Jumlah putaran dan bobot poin
              menuju <strong className="text-[#FACC15]">100 poin maksimal</strong> menyesuaikan otomatis
              sesuai jumlah soal, dengan <strong className="text-cyan-300">Speed Boost 15 detik</strong>{' '}
              untuk jawaban benar dan <strong className="text-rose-300">lari pelan 30 detik</strong>{' '}
              jika salah atau terlambat.
            </p>

            <div className="flex flex-wrap items-center gap-3 sm:gap-4">
              <button
                onClick={onJoinMatch}
                className="inline-flex items-center gap-3 px-6 sm:px-7 py-3.5 sm:py-4 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] text-white font-display font-bold text-base sm:text-lg shadow-lg shadow-orange-950/50 transition-transform active:scale-[0.98] cursor-pointer whitespace-nowrap shrink-0"
              >
                <Play className="w-5 h-5 fill-current" />
                <span>Gabung Pertandingan</span>
              </button>

              <button
                onClick={onTeacherPortal}
                className="inline-flex items-center gap-3 px-5 sm:px-6 py-3.5 sm:py-4 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 border border-blue-400/40 text-white font-display font-bold text-base sm:text-lg transition-transform active:scale-[0.98] cursor-pointer whitespace-nowrap shrink-0"
              >
                <GraduationCap className="w-5 h-5" />
                <span>Masuk sebagai Guru</span>
              </button>
            </div>

            {/* 3 Feature Metrics */}
            <div className="grid grid-cols-3 gap-4 mt-7 sm:mt-10 pt-5 sm:pt-6 border-t border-white/15 max-w-lg">
              <div>
                <div className="flex items-center gap-1.5 text-xs text-blue-200/80 mb-1">
                  <Zap className="w-3.5 h-3.5 text-[#FF6B1A]" />
                  <span>Arena Balap</span>
                </div>
                <div className="font-mono font-bold text-lg sm:text-xl text-white">Real-Time 3D</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-blue-200/80 mb-1">
                  <Trophy className="w-3.5 h-3.5 text-[#FACC15]" />
                  <span>Skor Maksimal</span>
                </div>
                <div className="font-mono font-bold text-lg sm:text-xl text-white tabular-nums">100 Poin</div>
              </div>
              <div>
                <div className="flex items-center gap-1.5 text-xs text-blue-200/80 mb-1">
                  <BookOpen className="w-3.5 h-3.5 text-cyan-300" />
                  <span>Rekap Laporan</span>
                </div>
                <div className="font-mono font-bold text-lg sm:text-xl text-white">3 Sheet XLSX</div>
              </div>
            </div>
          </div>

          {/* Bottom Control Hint & Copyright Footer */}
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-white/10 text-xs text-slate-300/80 pointer-events-auto">
            <div className="font-medium flex flex-wrap items-center gap-x-3 gap-y-1">
              <span>Masukkan Kode Room dari Guru</span>
              <span aria-hidden="true">·</span>
              <span>Pilih Karakter 3D</span>
              <span aria-hidden="true">·</span>
              <span>Jawab Benar Boost 15 Detik</span>
            </div>
            <div className="text-[11px] text-slate-400 font-medium whitespace-nowrap">
              &copy; {new Date().getFullYear()} EDU RUN ARENA 3D — SIPMA Developer. Hak Cipta Dilindungi.
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
