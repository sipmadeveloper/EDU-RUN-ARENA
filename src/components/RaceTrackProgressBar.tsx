import { useMemo, useState } from 'react';
import { Flag, Zap, AlertTriangle } from 'lucide-react';
import { AVATAR_COLORS, type PlayerState } from '../types/game';

export interface RaceTrackProgressBarProps {
  players: PlayerState[];
  localPlayerId: string;
  followedPlayerId?: string | null;
  totalLaps: number;
  trackLength: number;
  onSelectPlayer?: (playerId: string) => void;
}

function getColorHex(colorId: string): string {
  return AVATAR_COLORS.find((c) => c.id === colorId)?.hex || '#2563EB';
}

function getInitials(name: string): string {
  const trimmed = name.trim();
  if (!trimmed) return '?';
  const parts = trimmed.split(/\s+/);
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase();
  }
  return trimmed.slice(0, 2).toUpperCase();
}

export function RaceTrackProgressBar({
  players,
  localPlayerId,
  followedPlayerId = null,
  totalLaps,
  trackLength,
  onSelectPlayer,
}: RaceTrackProgressBarProps) {
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  const ranked = useMemo(() => {
    const sorted = [...players].sort((a, b) => {
      const aFin = a.finishedAt && a.finishedAt > 0 ? a.finishedAt : Number.MAX_SAFE_INTEGER;
      const bFin = b.finishedAt && b.finishedAt > 0 ? b.finishedAt : Number.MAX_SAFE_INTEGER;
      if (aFin !== bFin) return aFin - bFin;
      if (b.progress !== a.progress) return b.progress - a.progress;
      return b.score - a.score;
    });

    const rankById = new Map<string, number>();
    sorted.forEach((p, idx) => rankById.set(p.id, idx + 1));

    const local = sorted.find((p) => p.id === localPlayerId) ?? null;
    const leader = sorted[0] ?? null;

    // Render back-to-front so leader & local player always sit cleanly on top
    const renderOrder = [...sorted].sort((a, b) => {
      if (a.id === localPlayerId) return 1;
      if (b.id === localPlayerId) return -1;
      if (a.id === followedPlayerId) return 1;
      if (b.id === followedPlayerId) return -1;
      return a.progress - b.progress;
    });

    return { sorted, rankById, local, leader, renderOrder };
  }, [players, localPlayerId, followedPlayerId]);

  const safeTrackLength = Math.max(10, Math.round(trackLength));
  const localProgress = Math.max(0, Math.min(1, ranked.local?.progress ?? 0));
  const localPct = Math.round(localProgress * 100);
  const localRank = ranked.local ? ranked.rankById.get(ranked.local.id) ?? 0 : 0;
  const localMetersRemaining = Math.max(
    0,
    Math.round((1 - localProgress) * safeTrackLength)
  );
  const localColorHex = ranked.local ? getColorHex(ranked.local.avatar.color) : '#FF6B1A';

  const leaderProgress = Math.max(0, Math.min(1, ranked.leader?.progress ?? 0));
  const leaderPct = Math.round(leaderProgress * 100);

  const lapMilestones = useMemo(() => {
    const laps = Math.max(1, Math.min(20, Math.round(totalLaps)));
    if (laps <= 1) return [];
    const list: { lap: number; pct: number }[] = [];
    for (let i = 1; i < laps; i++) {
      list.push({ lap: i, pct: (i / laps) * 100 });
    }
    return list;
  }, [totalLaps]);

  const fillColorClass =
    ranked.local?.finishedAt && ranked.local.finishedAt > 0
      ? 'bg-gradient-to-r from-amber-500/80 to-[#FACC15]'
      : ranked.local?.effectState === 'boost'
      ? 'bg-gradient-to-r from-blue-500/80 via-cyan-400 to-cyan-200'
      : ranked.local?.effectState === 'penalty'
      ? 'bg-gradient-to-r from-rose-700/80 to-rose-400'
      : 'bg-gradient-to-r from-blue-600/80 to-[#FF6B1A]';

  const showLapLabels = lapMilestones.length > 0 && lapMilestones.length <= 6;

  return (
    <section
      aria-label="Progres Lintasan Semua Peserta"
      className={`w-full px-3 sm:px-4 pt-2 ${
        showLapLabels ? 'pb-2 md:pb-3.5' : 'pb-2'
      } rounded-2xl bg-[#081226]/92 backdrop-blur-sm border border-blue-400/30 pointer-events-auto shadow-lg`}
    >
      {/* Clean unboxed top summary metadata */}
      <div className="flex items-center justify-between gap-3 text-[11px] leading-tight mb-1.5">
        <div className="flex items-center gap-1.5 text-slate-300 min-w-0 truncate">
          <span className="font-display font-bold text-white whitespace-nowrap shrink-0">
            Progres Lintasan
          </span>
          <span aria-hidden="true" className="text-slate-500">
            ·
          </span>
          <span className="tabular-nums whitespace-nowrap shrink-0">
            {players.length} Peserta
          </span>
          {ranked.leader && (
            <>
              <span aria-hidden="true" className="hidden sm:inline text-slate-500">
                ·
              </span>
              <span className="hidden sm:inline truncate text-blue-200">
                Terdepan:{' '}
                <strong className="text-[#FACC15] font-semibold">
                  {ranked.leader.name}
                </strong>{' '}
                <span className="font-mono tabular-nums text-slate-300">
                  ({leaderPct}%)
                </span>
              </span>
            </>
          )}
        </div>

        <div className="flex items-center gap-1.5 font-mono tabular-nums whitespace-nowrap shrink-0">
          {ranked.local?.finishedAt && ranked.local.finishedAt > 0 ? (
            <span className="font-bold text-[#FACC15]">
              Finish #{ranked.local.finishRank ?? localRank} · 100%
            </span>
          ) : (
            <>
              <span className="text-white font-bold">
                #{localRank || '-'}/{Math.max(1, players.length)}
              </span>
              <span aria-hidden="true" className="text-slate-500">
                ·
              </span>
              <span className="text-cyan-300 font-bold">{localPct}%</span>
              <span aria-hidden="true" className="hidden sm:inline text-slate-500">
                ·
              </span>
              <span className="hidden sm:inline text-slate-300">
                Sisa {localMetersRemaining}m
              </span>
            </>
          )}
        </div>
      </div>

      {/* Horizontal Start -> Finish Progress Track with All Participant Markers */}
      <div className="flex items-center gap-2.5 sm:gap-3">
        {/* Start Anchor */}
        <div className="text-[10px] font-mono font-bold tracking-wider text-slate-300 whitespace-nowrap shrink-0">
          START
        </div>

        {/* Track Rail */}
        <div
          className="relative flex-1 h-7 flex items-center"
          role="progressbar"
          aria-label="Progres Anda menuju garis finish"
          aria-valuemin={0}
          aria-valuemax={100}
          aria-valuenow={localPct}
        >
          {/* Base recessed lane */}
          <div className="relative w-full h-2.5 rounded-full bg-[#0F2957] border border-white/15">
            {/* Local runner progress fill */}
            <div
              className={`absolute inset-y-0 left-0 rounded-full transition-[width] duration-300 ease-out ${fillColorClass}`}
              style={{ width: `${Math.max(0, Math.min(100, localProgress * 100))}%` }}
            />

            {/* Lap milestone dividers */}
            {lapMilestones.map((m) => (
              <div
                key={m.lap}
                className="absolute top-0 bottom-0 w-px bg-white/25 pointer-events-none"
                style={{ left: `${m.pct}%` }}
                aria-hidden="true"
              >
                {lapMilestones.length <= 6 && (
                  <span className="hidden md:block absolute -bottom-3.5 -translate-x-1/2 text-[9px] font-mono text-slate-400 tabular-nums select-none">
                    P{m.lap}
                  </span>
                )}
              </div>
            ))}

            {/* Finish line gold accent stripe at 100% */}
            <div
              className="absolute right-0 top-0 bottom-0 w-1.5 rounded-r-full bg-[#FACC15] pointer-events-none"
              aria-hidden="true"
            />
          </div>

          {/* Participant position markers */}
          {ranked.renderOrder.map((p) => {
            const pct = Math.max(0, Math.min(100, (p.progress ?? 0) * 100));
            const isMe = p.id === localPlayerId;
            const isFollowed = followedPlayerId === p.id;
            const rank = ranked.rankById.get(p.id) ?? 0;
            const isLeader = rank === 1 && pct > 0;
            const isFinished = Boolean(p.finishedAt && p.finishedAt > 0);
            const isHovered = hoveredId === p.id;
            const colorHex = getColorHex(p.avatar.color);
            const metersLeft = Math.max(0, Math.round((1 - Math.min(1, p.progress ?? 0)) * safeTrackLength));
            const verticalOffsetPx = isMe ? 0 : ((p.lane % 3) - 1) * 3;

            const tooltipAlignClass =
              pct > 82
                ? 'right-0 translate-x-0'
                : pct < 18
                ? 'left-0 translate-x-0'
                : 'left-1/2 -translate-x-1/2';

            return (
              <div
                key={p.id}
                className="absolute top-1/2 -translate-x-1/2 -translate-y-1/2 transition-[left] duration-300 ease-out"
                style={{
                  left: `${pct}%`,
                  zIndex: isHovered ? 40 : isMe ? 30 : isFollowed ? 25 : isLeader ? 20 : 10,
                }}
              >
                <button
                  type="button"
                  onClick={() => onSelectPlayer?.(p.id)}
                  onMouseEnter={() => setHoveredId(p.id)}
                  onMouseLeave={() => setHoveredId((prev) => (prev === p.id ? null : prev))}
                  onFocus={() => setHoveredId(p.id)}
                  onBlur={() => setHoveredId((prev) => (prev === p.id ? null : prev))}
                  style={{
                    backgroundColor: isMe ? localColorHex : colorHex,
                    transform: `translateY(${verticalOffsetPx}px)`,
                  }}
                  aria-label={`Peringkat ${rank} ${p.name}${isMe ? ' (Anda)' : ''}, ${Math.round(pct)}% lintasan, ${
                    isFinished ? 'sudah finish' : `sisa ${metersLeft} meter ke finish`
                  }`}
                  className={`relative flex items-center justify-center rounded-full font-mono font-bold text-white transition-transform duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[#FACC15] ${
                    onSelectPlayer ? 'cursor-pointer' : 'cursor-default'
                  } ${
                    isMe
                      ? 'w-6 h-6 text-[9px] border-2 border-[#FACC15] shadow-[0_0_10px_rgba(250,204,21,0.55)] hover:scale-110'
                      : isFollowed
                      ? 'w-5 h-5 text-[8px] border-2 border-cyan-300 shadow-[0_0_8px_rgba(34,211,238,0.6)] hover:scale-110'
                      : isLeader
                      ? 'w-[19px] h-[19px] text-[8px] border-[1.5px] border-[#FACC15] hover:scale-125'
                      : 'w-4 h-4 text-[7px] border border-[#081226] hover:scale-125 opacity-90 hover:opacity-100'
                  }`}
                >
                  {isFinished ? (
                    <Flag className={isMe ? 'w-3 h-3 text-[#FACC15]' : 'w-2.5 h-2.5 text-[#FACC15]'} />
                  ) : isMe && p.effectState === 'boost' ? (
                    <Zap className="w-3 h-3 text-cyan-200" />
                  ) : isMe && p.effectState === 'penalty' ? (
                    <AlertTriangle className="w-3 h-3 text-rose-200" />
                  ) : (
                    <span className="leading-none select-none">{getInitials(p.name)}</span>
                  )}
                </button>

                {/* Hover / focus tooltip */}
                {isHovered && (
                  <div
                    role="tooltip"
                    className={`absolute top-full mt-1.5 ${tooltipAlignClass} px-2.5 py-1.5 rounded-lg bg-[#081226]/98 border border-blue-400/45 shadow-xl whitespace-nowrap pointer-events-none z-50`}
                  >
                    <div className="text-[11px] font-display font-bold text-white">
                      #{rank} {p.name}
                      {isMe ? ' (Anda)' : ''}
                    </div>
                    <div className="text-[10px] font-mono text-slate-300 tabular-nums">
                      {p.className} · {Math.round(pct)}% ·{' '}
                      {isFinished ? (
                        <span className="text-[#FACC15] font-bold">FINISH</span>
                      ) : (
                        <span>{metersLeft}m ke Finish</span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            );
          })}
        </div>

        {/* Finish Anchor */}
        <div className="flex items-center gap-1 text-[10px] font-mono font-bold tracking-wider text-[#FACC15] whitespace-nowrap shrink-0 tabular-nums">
          <Flag className="w-3 h-3 shrink-0" />
          <span>FINISH</span>
          <span className="hidden sm:inline text-slate-400 font-normal">
            {safeTrackLength}m
          </span>
        </div>
      </div>
    </section>
  );
}
