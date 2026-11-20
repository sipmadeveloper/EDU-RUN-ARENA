interface StadiumCountdownOverlayProps {
  value: number;
  total?: number;
}

const COUNTDOWN_SUBTITLES: Record<number, string> = {
  5: 'POSISI DI GARIS START!',
  4: 'ATUR NAFAS & KONSENTRASI!',
  3: 'BERSIAP MELESAT!',
  2: 'SIAP... FOKUS KE LINTASAN!',
  1: 'SEDIA... TUNGGU PISTOL START!',
  0: 'TANCAP GAS! BERLARI & JAWAB SOAL!',
};

export function StadiumCountdownOverlay({ value, total = 5 }: StadiumCountdownOverlayProps) {
  const isGo = value === 0;
  const clampedTotal = Math.max(3, Math.min(5, total));
  const litCount = isGo ? clampedTotal : Math.max(1, clampedTotal - value + 1);
  const subtitle = COUNTDOWN_SUBTITLES[value] ?? 'BERSIAP DI GARIS START!';

  return (
    <div className="absolute inset-0 z-30 flex items-center justify-center pointer-events-none bg-[#081226]/55">
      <div className="flex flex-col items-center px-6 py-6 sm:px-10 sm:py-8 rounded-3xl bg-[#081226]/92 border-2 border-[#FACC15]/60 shadow-2xl">
        {/* 5-Light International Stadium Starting Gantry */}
        <div className="flex items-center gap-3 sm:gap-4 mb-4 px-5 py-3 rounded-2xl bg-[#050C1B] border border-white/15">
          {Array.from({ length: clampedTotal }).map((_, idx) => {
            const isLit = idx < litCount;
            const lampClass = isGo
              ? 'bg-emerald-400 border-emerald-200 shadow-[0_0_24px_rgba(52,211,153,0.95)]'
              : isLit
              ? value <= 1
                ? 'bg-[#FACC15] border-amber-200 shadow-[0_0_22px_rgba(250,204,21,0.9)]'
                : 'bg-rose-500 border-rose-200 shadow-[0_0_20px_rgba(244,63,94,0.9)]'
              : 'bg-slate-800 border-slate-700';

            return (
              <div
                key={idx}
                className={`w-6 h-6 sm:w-8 sm:h-8 rounded-full border-2 transition-all duration-150 ${lampClass}`}
              />
            );
          })}
        </div>

        <div className="text-[11px] sm:text-xs font-mono font-bold tracking-[0.25em] uppercase text-blue-200 mb-1">
          {isGo ? 'BALAPAN DIMULAI' : 'HITUNGAN MUNDUR START'}
        </div>

        <div
          key={value}
          className={`font-display font-extrabold tracking-tight leading-none drop-shadow-2xl tabular-nums ${
            isGo
              ? 'text-6xl sm:text-8xl text-emerald-400'
              : value === 1
              ? 'text-8xl sm:text-[10rem] text-[#FACC15]'
              : 'text-8xl sm:text-[10rem] text-white'
          }`}
        >
          {isGo ? 'MULAI!' : value}
        </div>

        <div
          className={`font-display font-bold text-sm sm:text-xl mt-3 tracking-wide text-center ${
            isGo ? 'text-[#FACC15]' : 'text-cyan-200'
          }`}
        >
          {subtitle}
        </div>
      </div>
    </div>
  );
}
