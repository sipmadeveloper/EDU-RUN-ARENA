import { useState } from 'react';
import { Trophy, Zap, BookOpen, Play, GraduationCap, Sun, Moon, Trees } from 'lucide-react';
import { StadiumArena3D } from './StadiumArena3D';
import { AppLogo } from './AppLogo';
import { RACE_VENUES, type PlayerState, type RaceVenueId } from '../types/game';

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
  const [venue, setVenue] = useState<RaceVenueId>('stadium_day');

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#081226] select-none">
      {/* Fullscreen Live 3D Stadium Showcase */}
      <div className="absolute inset-0">
        <StadiumArena3D
          questionCount={15}
          maxPlayers={30}
          players={SHOWCASE_RUNNERS}
          roomStatus="playing"
          roomName="STADION EDU RUN ARENA 3D"
          showcaseMode={true}
          venue={venue}
        />
      </div>

      {/* Measured contrast scrim so foreground typography stays crisp */}
      <div
        className="absolute inset-0 pointer-events-none"
        style={{
          background:
            'linear-gradient(105deg, rgba(8,18,38,0.92) 0%, rgba(8,18,38,0.72) 44%, rgba(8,18,38,0.20) 100%)',
        }}
      />

      {/* Foreground Title & Primary Actions */}
      <div className="relative z-10 h-full max-w-7xl mx-auto px-6 sm:px-10 flex flex-col justify-between py-6 sm:py-8">
        {/* Brand Lockup & Venue Switcher */}
        <div className="flex flex-wrap items-center justify-between gap-4">
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
            <div className="inline-flex items-center p-1 rounded-xl bg-[#081226]/90 border border-blue-400/30">
              {RACE_VENUES.map((v) => {
                const Icon =
                  v.id === 'stadium_day' ? Sun : v.id === 'stadium_night' ? Moon : Trees;
                const active = venue === v.id;
                return (
                  <button
                    key={v.id}
                    type="button"
                    onClick={() => setVenue(v.id)}
                    className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap ${
                      active
                        ? 'bg-[#FF6B1A] text-white'
                        : 'text-slate-200 hover:bg-white/10'
                    }`}
                  >
                    <Icon className="w-3.5 h-3.5" />
                    <span>{v.shortLabel}</span>
                  </button>
                );
              })}
            </div>

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
        <div className="max-w-2xl my-auto py-6">
          <h1
            className="font-display font-extrabold text-4xl sm:text-5xl lg:text-6xl leading-[1.08] tracking-tight text-white mb-5"
            style={{ textWrap: 'balance' }}
          >
            Berlari Menuju Garis Finish dengan Kekuatan Ilmu
          </h1>

          <p className="text-base sm:text-lg text-slate-200/90 leading-relaxed max-w-xl mb-8">
            Taklukkan lintasan balap sambil menjawab kuis pelajaran. Jumlah putaran dan bobot poin
            menuju <strong className="text-[#FACC15]">100 poin maksimal</strong> menyesuaikan otomatis
            sesuai jumlah soal, dengan <strong className="text-cyan-300">Speed Boost 15 detik</strong>{' '}
            untuk jawaban benar dan <strong className="text-rose-300">lari pelan 30 detik</strong>{' '}
            jika salah atau terlambat.
          </p>

          <div className="flex flex-wrap items-center gap-4">
            <button
              onClick={onJoinMatch}
              className="inline-flex items-center gap-3 px-7 py-4 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] text-white font-display font-bold text-base sm:text-lg shadow-lg shadow-orange-950/50 transition-transform active:scale-[0.98] cursor-pointer whitespace-nowrap shrink-0"
            >
              <Play className="w-5 h-5 fill-current" />
              <span>Gabung Pertandingan</span>
            </button>

            <button
              onClick={onTeacherPortal}
              className="inline-flex items-center gap-3 px-6 py-4 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 border border-blue-400/40 text-white font-display font-bold text-base sm:text-lg transition-transform active:scale-[0.98] cursor-pointer whitespace-nowrap shrink-0"
            >
              <GraduationCap className="w-5 h-5" />
              <span>Masuk sebagai Guru</span>
            </button>
          </div>

          {/* 3 Feature Metrics */}
          <div className="grid grid-cols-3 gap-4 mt-10 pt-6 border-t border-white/15 max-w-lg">
            <div>
              <div className="flex items-center gap-1.5 text-xs text-blue-200/80 mb-1">
                <Zap className="w-3.5 h-3.5 text-[#FF6B1A]" />
                <span>Arena Balap</span>
              </div>
              <div className="font-mono font-bold text-xl text-white">Real-Time 3D</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-blue-200/80 mb-1">
                <Trophy className="w-3.5 h-3.5 text-[#FACC15]" />
                <span>Skor Maksimal</span>
              </div>
              <div className="font-mono font-bold text-xl text-white tabular-nums">100 Poin</div>
            </div>
            <div>
              <div className="flex items-center gap-1.5 text-xs text-blue-200/80 mb-1">
                <BookOpen className="w-3.5 h-3.5 text-cyan-300" />
                <span>Rekap Laporan</span>
              </div>
              <div className="font-mono font-bold text-xl text-white">3 Sheet XLSX</div>
            </div>
          </div>
        </div>

        {/* Bottom Control Hint & Copyright Footer */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-3 border-t border-white/10 text-xs text-slate-300/80">
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
    </div>
  );
}
