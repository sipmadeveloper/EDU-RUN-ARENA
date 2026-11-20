import { useState } from 'react';
import { Trophy, Medal, Clock, CheckCircle2, XCircle, RotateCcw, Home, BookOpen, List } from 'lucide-react';
import type { AnswerReviewItem, PlayerState } from '../types/game';
import { VictoryPodium3D } from './VictoryPodium3D';
import { getVictoryMetaForRank } from '../three/victoryAnimations';
import {
  MAX_MATCH_SCORE,
  calcPointsPerQuestion,
  calcTotalLaps,
  formatScoreValue,
} from '../utils/matchScaling';

interface MatchResultsModalProps {
  roomCode: string;
  roomName: string;
  subject: string;
  questionCount: number;
  players: PlayerState[];
  localPlayerId?: string;
  onPlayAgain: () => void;
  onReturnLobby: () => void;
  onClose?: () => void;
}

function formatMs(ms?: number | null): string {
  if (!ms || ms <= 0) return '-';
  const sec = Math.round(ms / 1000);
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
}

export function MatchResultsModal({
  roomCode,
  roomName,
  subject,
  questionCount,
  players,
  localPlayerId,
  onPlayAgain,
  onReturnLobby,
  onClose,
}: MatchResultsModalProps) {
  const [activeTab, setActiveTab] = useState<'podium' | 'full' | 'review'>('podium');
  const [rankMode, setRankMode] = useState<'score' | 'finish'>('score');
  const [reviewItems, setReviewItems] = useState<AnswerReviewItem[] | null>(null);
  const [reviewLoading, setReviewLoading] = useState(false);
  const [reviewError, setReviewError] = useState('');

  const byScore = [...players].sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
    return (a.durationMs ?? 9e9) - (b.durationMs ?? 9e9);
  });

  const byFinish = [...players].sort((a, b) => {
    const fa = a.finishRank ?? 999;
    const fb = b.finishRank ?? 999;
    if (fa !== fb) return fa - fb;
    return b.progress - a.progress;
  });

  const displayedList = rankMode === 'score' ? byScore : byFinish;
  const topPodium = displayedList.slice(0, Math.min(4, displayedList.length));

  async function loadReview() {
    setActiveTab('review');
    if (reviewItems || !localPlayerId) return;
    setReviewLoading(true);
    setReviewError('');
    try {
      const res = await fetch(
        `/api/public/rooms/${encodeURIComponent(roomCode)}/results/${encodeURIComponent(localPlayerId)}`
      );
      const data = await res.json();
      if (!res.ok) {
        setReviewError(data.error || 'Pembahasan belum tersedia.');
      } else {
        setReviewItems(data.review);
      }
    } catch {
      setReviewError('Gagal memuat pembahasan soal.');
    } finally {
      setReviewLoading(false);
    }
  }

  return (
    <div className="fixed inset-0 z-40 bg-[#081226]/95 overflow-y-auto py-6 px-4 sm:px-8 text-white">
      <div className="max-w-6xl mx-auto space-y-6">
        {/* Header */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4 pb-4 border-b border-white/15">
          <div>
            <div className="text-xs font-semibold text-[#FACC15] mb-1">
              PERTANDINGAN SELESAI · KODE {roomCode} · {subject} · {questionCount} SOAL · {calcTotalLaps(questionCount)} PUTARAN · {formatScoreValue(calcPointsPerQuestion(questionCount))} POIN/SOAL
            </div>
            <h1 className="font-display font-extrabold text-2xl sm:text-3xl">{roomName}</h1>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <button
              onClick={() => setActiveTab('full')}
              className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer whitespace-nowrap ${
                activeTab === 'full'
                  ? 'bg-[#1D4ED8] text-white'
                  : 'bg-[#0F2957] border border-white/15 text-slate-200 hover:bg-blue-900'
              }`}
            >
              <List className="w-4 h-4" />
              <span>Lihat Hasil Lengkap</span>
            </button>

            {localPlayerId && (
              <button
                onClick={loadReview}
                className={`inline-flex items-center gap-2 px-4 py-2.5 rounded-xl text-sm font-semibold cursor-pointer whitespace-nowrap ${
                  activeTab === 'review'
                    ? 'bg-[#1D4ED8] text-white'
                    : 'bg-[#0F2957] border border-white/15 text-slate-200 hover:bg-blue-900'
                }`}
              >
                <BookOpen className="w-4 h-4" />
                <span>Lihat Pembahasan Soal</span>
              </button>
            )}

            <button
              onClick={onPlayAgain}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] text-sm font-semibold text-white cursor-pointer whitespace-nowrap"
            >
              <RotateCcw className="w-4 h-4" />
              <span>Main Lagi</span>
            </button>

            {onClose && (
              <button
                onClick={onClose}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-amber-500/20 border border-[#FACC15]/50 hover:bg-amber-500/30 text-sm font-semibold text-[#FACC15] cursor-pointer whitespace-nowrap"
              >
                <Trophy className="w-4 h-4" />
                <span>Lihat Podium 3D</span>
              </button>
            )}

            <button
              onClick={onReturnLobby}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#0F2957] border border-white/15 hover:bg-white/10 text-sm font-semibold text-white cursor-pointer whitespace-nowrap"
            >
              <Home className="w-4 h-4" />
              <span>Kembali ke Lobby</span>
            </button>
          </div>
        </div>

        {/* Podium + Top Placement Cards */}
        {activeTab === 'podium' && (
          <div className="space-y-6">
            <VictoryPodium3D
              players={displayedList}
              localPlayerId={localPlayerId}
              className="w-full h-80 sm:h-[420px]"
            />

            <div className={`grid gap-4 ${topPodium.length >= 4 ? 'sm:grid-cols-2 lg:grid-cols-4' : 'md:grid-cols-3'}`}>
              {topPodium.map((p, idx) => {
                const rank = idx + 1;
                const vMeta = getVictoryMetaForRank(rank);
                const titles = [
                  'Juara 1 · Emas',
                  'Juara 2 · Perak',
                  'Juara 3 · Perunggu',
                  'Juara 4 · Kehormatan',
                ];
                const accents = [
                  'border-[#FACC15] bg-amber-950/30',
                  'border-slate-300/60 bg-slate-900/50',
                  'border-[#FF6B1A] bg-orange-950/30',
                  'border-sky-400/60 bg-sky-950/30',
                ];
                const isSelf = p.id === localPlayerId;
                return (
                  <div
                    key={p.id}
                    className={`p-4 sm:p-5 rounded-2xl border ${accents[idx]} ${isSelf ? 'ring-2 ring-white/40' : ''}`}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-xs font-bold" style={{ color: vMeta.accentHex }}>
                        {titles[idx]}
                      </span>
                      <Medal className="w-4 h-4 shrink-0" style={{ color: vMeta.accentHex }} />
                    </div>
                    <div className="font-display font-bold text-lg sm:text-xl truncate">
                      {p.name}
                      {isSelf && <span className="ml-1.5 text-xs font-semibold text-[#FACC15]">(Anda)</span>}
                    </div>
                    <div className="text-xs text-slate-300 truncate">{p.className}</div>
                    <div className="text-[11px] font-medium text-blue-200/90 mt-1.5 mb-3 truncate">
                      Selebrasi: {vMeta.title}
                    </div>
                    <div className="grid grid-cols-3 gap-2 text-center pt-3 border-t border-white/10">
                      <div>
                        <div className="text-[11px] text-slate-400">Total Poin</div>
                        <div className="font-mono font-bold text-base sm:text-lg text-white tabular-nums">
                          {formatScoreValue(p.score)}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">Benar</div>
                        <div className="font-mono font-bold text-base sm:text-lg text-emerald-300 tabular-nums">
                          {p.correctCount}
                        </div>
                      </div>
                      <div>
                        <div className="text-[11px] text-slate-400">Finish</div>
                        <div className="font-mono font-bold text-base sm:text-lg text-cyan-300 tabular-nums">
                          #{p.finishRank ?? '-'}
                        </div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}

        {/* Dual Ranking Full Table (up to 30 players) */}
        {(activeTab === 'podium' || activeTab === 'full') && (
          <div className="rounded-2xl bg-[#0F2957] border border-blue-400/25 overflow-hidden">
            <div className="p-4 sm:p-5 border-b border-white/10 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <h2 className="font-display font-bold text-lg">
                  Peringkat Pertandingan ({players.length} Peserta)
                </h2>
                <p className="text-xs text-blue-200/80">
                  Peringkat Nilai dan Peringkat Finish dihitung terpisah secara adil oleh server.
                </p>
              </div>

              <div className="inline-flex p-1 rounded-xl bg-[#081226] border border-white/10">
                <button
                  onClick={() => setRankMode('score')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    rankMode === 'score' ? 'bg-[#1D4ED8] text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  A. Peringkat Nilai
                </button>
                <button
                  onClick={() => setRankMode('finish')}
                  className={`px-3.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                    rankMode === 'finish' ? 'bg-[#FF6B1A] text-white' : 'text-slate-300 hover:text-white'
                  }`}
                >
                  B. Peringkat Finish
                </button>
              </div>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-sm text-left">
                <thead className="bg-[#081226] text-xs text-blue-200 uppercase">
                  <tr>
                    <th className="py-3 px-4">Peringkat</th>
                    <th className="py-3 px-4">Peserta</th>
                    <th className="py-3 px-4">Kelas</th>
                    <th className="py-3 px-4 text-center">Benar</th>
                    <th className="py-3 px-4 text-center">Salah</th>
                    <th className="py-3 px-4 text-center">Kosong</th>
                    <th className="py-3 px-4 text-center">Total Poin</th>
                    <th className="py-3 px-4 text-center">Posisi Finish</th>
                    <th className="py-3 px-4 text-center">Durasi</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-white/10">
                  {displayedList.map((p, i) => {
                    const isMe = p.id === localPlayerId;
                    return (
                      <tr
                        key={p.id}
                        className={isMe ? 'bg-orange-500/15' : 'hover:bg-white/5'}
                      >
                        <td className="py-3 px-4 font-mono font-bold tabular-nums">
                          #{rankMode === 'score' ? p.scoreRank ?? i + 1 : p.finishRank ?? i + 1}
                        </td>
                        <td className="py-3 px-4 font-semibold text-white">
                          {p.name} {isMe && <span className="text-xs text-[#FACC15]">(Anda)</span>}
                        </td>
                        <td className="py-3 px-4 text-slate-300">{p.className}</td>
                        <td className="py-3 px-4 text-center font-mono text-emerald-300 tabular-nums">
                          {p.correctCount}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-rose-300 tabular-nums">
                          {p.wrongCount}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-amber-300 tabular-nums">
                          {p.unansweredCount}
                        </td>
                        <td className="py-3 px-4 text-center font-mono font-bold text-[#FACC15] tabular-nums">
                          {formatScoreValue(p.score)} / {MAX_MATCH_SCORE}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-cyan-300 tabular-nums">
                          #{p.finishRank ?? '-'}
                        </td>
                        <td className="py-3 px-4 text-center font-mono text-slate-200 tabular-nums">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3.5 h-3.5 text-slate-400" />
                            {formatMs(p.durationMs)}
                          </span>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {/* Answer Key & Explanation Review */}
        {activeTab === 'review' && (
          <div className="rounded-2xl bg-[#0F2957] border border-blue-400/25 p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-display font-bold text-xl flex items-center gap-2">
                <Trophy className="w-5 h-5 text-[#FACC15]" />
                <span>Pembahasan Soal Anda</span>
              </h2>
              <button
                onClick={() => setActiveTab('podium')}
                className="text-xs font-semibold text-blue-200 hover:text-white underline cursor-pointer"
              >
                Kembali ke Podium
              </button>
            </div>

            {reviewLoading && <div className="py-10 text-center text-slate-300">Memuat pembahasan soal...</div>}
            {reviewError && <div className="p-4 rounded-xl bg-red-950/60 border border-red-400/30 text-red-200 text-sm">{reviewError}</div>}

            {reviewItems && (
              <div className="space-y-3">
                {reviewItems.map((item) => (
                  <div
                    key={item.questionIndex}
                    className="p-4 rounded-xl bg-[#081226] border border-white/10 space-y-2"
                  >
                    <div className="flex items-center justify-between gap-3">
                      <span className="font-mono text-xs font-bold text-blue-300">
                        SOAL {item.questionIndex + 1}
                      </span>
                      <span
                        className={`inline-flex items-center gap-1.5 text-xs font-bold ${
                          item.isCorrect
                            ? 'text-emerald-300'
                            : item.isTimeout
                            ? 'text-amber-300'
                            : 'text-rose-300'
                        }`}
                      >
                        {item.isCorrect ? (
                          <>
                            <CheckCircle2 className="w-4 h-4" />
                            <span>Benar (+{formatScoreValue(item.pointsEarned)} Poin)</span>
                          </>
                        ) : item.isTimeout ? (
                          <>
                            <Clock className="w-4 h-4" />
                            <span>Waktu Habis (0 Poin)</span>
                          </>
                        ) : (
                          <>
                            <XCircle className="w-4 h-4" />
                            <span>Salah (0 Poin)</span>
                          </>
                        )}
                      </span>
                    </div>

                    <p className="font-medium text-white">{item.prompt}</p>

                    <div className="text-xs text-slate-300 flex flex-wrap gap-4">
                      <span>
                        Jawaban Anda:{' '}
                        <strong className="text-white">{item.submittedAnswer || 'Tidak dijawab'}</strong>
                      </span>
                      <span>
                        Kunci Jawaban:{' '}
                        <strong className="text-emerald-300">
                          {item.correctAnswer}
                          {item.options?.[item.correctAnswer as 'A' | 'B' | 'C' | 'D']
                            ? ` (${item.options[item.correctAnswer as 'A' | 'B' | 'C' | 'D']})`
                            : ''}
                        </strong>
                      </span>
                    </div>

                    {item.explanation && (
                      <div className="text-xs text-blue-100/90 pt-2 border-t border-white/10">
                        <strong>Pembahasan:</strong> {item.explanation}
                      </div>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
