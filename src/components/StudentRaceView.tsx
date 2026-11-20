import { useEffect, useMemo, useRef, useState, useCallback } from 'react';
import {
  Volume2,
  VolumeX,
  Zap,
  AlertTriangle,
  Camera,
  Users,
  Trophy,
  Clock,
  WifiOff,
  Send,
  Flag,
  Sun,
  Moon,
  Trees,
  RotateCcw,
  Home,
  Award,
  Music,
  SkipForward,
  Grid2x2,
} from 'lucide-react';
import { getVictoryMetaForRank } from '../three/victoryAnimations';
import {
  AVATAR_COLORS,
  RACE_VENUES,
  type PlayerState,
  type QuestionType,
  type RaceVenueId,
  type RoomSettings,
  type RoomStatus,
} from '../types/game';
import type { JoinedSession } from './StudentJoinView';
import {
  CAMERA_PRESET_LIST,
  StadiumArena3D,
  type CameraPresetId,
  type CameraViewMode,
} from './StadiumArena3D';
import { MatchResultsModal } from './MatchResultsModal';
import { StadiumCountdownOverlay } from './StadiumCountdownOverlay';
import { Loading3D } from './Loading3D';
import { RACE_MUSIC_TRACKS, soundEngine, type RaceMusicTrackId } from '../audio/soundEngine';
import {
  MAX_MATCH_SCORE,
  calcGatesPerLap,
  calcPointsPerQuestion,
  calcQuestionGateProgress,
  calcTotalLaps,
  formatScoreValue,
} from '../utils/matchScaling';
import {
  projectParticipantPhysics,
  submitParticipantAnswer,
  subscribeLiveRoom,
  syncParticipantFinished,
  type LiveFirebaseParticipant,
  type LiveFirebaseRoom,
} from '../services/firebaseRaceService';

interface ActiveQuestionPayload {
  index: number;
  total: number;
  id: string;
  subject: string;
  questionType: QuestionType;
  prompt: string;
  options: { A?: string; B?: string; C?: string; D?: string };
  timeLimit: number;
  questionStartedAt: number;
}

const QUESTION_HIDE_GAP_MS = 1400;

interface StudentRaceViewProps {
  session: JoinedSession;
  onPlayAgain: () => void;
  onReturnLobby: () => void;
}

export function StudentRaceView({ session, onPlayAgain, onReturnLobby }: StudentRaceViewProps) {
  const [room, setRoom] = useState<LiveFirebaseRoom | null>(null);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [countdownVal, setCountdownVal] = useState<number | null>(null);
  const [countdownTotal, setCountdownTotal] = useState<number>(5);
  const [currentQuestion, setCurrentQuestion] = useState<ActiveQuestionPayload | null>(null);
  const [questionsCompleted, setQuestionsCompleted] = useState(false);
  const [submittingIdx, setSubmittingIdx] = useState<number | null>(null);
  const [shortAnswerText, setShortAnswerText] = useState('');

  const [questionTimeLeft, setQuestionTimeLeft] = useState<number>(20);
  const [effectSecondsLeft, setEffectSecondsLeft] = useState<number>(0);

  const [toast, setToast] = useState<{ kind: 'boost' | 'penalty' | 'finish'; text: string } | null>(null);
  const [wsConnected, setWsConnected] = useState(true);
  const [muted, setMuted] = useState(soundEngine.muted);
  const [volume, setVolume] = useState(soundEngine.volume);
  const [musicEnabled, setMusicEnabled] = useState(soundEngine.musicEnabled);
  const [musicTrack, setMusicTrack] = useState<RaceMusicTrackId>(soundEngine.trackId);
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('chase');
  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>('single');
  const [venueOverride, setVenueOverride] = useState<RaceVenueId | null>(null);
  const [showResultsOverride, setShowResultsOverride] = useState(false);

  const toastTimerRef = useRef<number | null>(null);
  const finishedCelebratedRef = useRef(false);
  const roomFinishedAudioRef = useRef(false);
  const finishingSyncRef = useRef(false);
  const livePlayersRef = useRef<PlayerState[]>([]);
  const liveVersionRef = useRef(0);
  const lastHudSyncRef = useRef(0);
  const localPlayerRef = useRef<PlayerState | undefined>(undefined);

  // Authoritative Firestore refs for deterministic 60 FPS dead-reckoning projection
  const rawRoomRef = useRef<LiveFirebaseRoom | null>(null);
  const rawParticipantsRef = useRef<LiveFirebaseParticipant[]>([]);
  const prevParticipantsMapRef = useRef<Map<string, LiveFirebaseParticipant>>(new Map());
  const lastCountdownTickRef = useRef<number | null>(null);
  const nextQuestionAllowedAtRef = useRef<number>(0);
  const submittedQuestionIndicesRef = useRef<Set<number>>(new Set());

  const showToast = useCallback((kind: 'boost' | 'penalty' | 'finish', text: string) => {
    setToast({ kind, text });
    if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    toastTimerRef.current = window.setTimeout(() => setToast(null), 2800);
  }, []);

  // Subscribe to Firestore live room + participants in real time
  useEffect(() => {
    const unsub = subscribeLiveRoom(session.roomCode, {
      onRoom: (nextRoom) => {
        if (!nextRoom) return;
        setWsConnected(true);
        const prevRoom = rawRoomRef.current;
        rawRoomRef.current = nextRoom;
        setRoom(nextRoom);

        // Immediately project current participants with updated room state
        if (rawParticipantsRef.current.length > 0) {
          const now = Date.now();
          const projected = rawParticipantsRef.current.map((p) =>
            projectParticipantPhysics(p, nextRoom, now)
          );
          livePlayersRef.current = projected;
          liveVersionRef.current += 1;
          lastHudSyncRef.current = performance.now();
          setPlayers(projected);
        }

        if (nextRoom.status === 'finished' && prevRoom?.status !== 'finished') {
          setCameraPreset('finish');
          setCameraViewMode('single');
          if (!roomFinishedAudioRef.current) {
            roomFinishedAudioRef.current = true;
            soundEngine.setHeartbeatTension(0);
            soundEngine.setRaceIntensity(0, { allowAutoSwell: false });
            soundEngine.playFinishWhistle();
            soundEngine.setMusicMood('victory');
            soundEngine.startVictoryMusic();
            if (!finishedCelebratedRef.current) {
              finishedCelebratedRef.current = true;
              soundEngine.playCrowdCheerAndFanfare();
            }
          }
        }
      },
      onParticipants: (list) => {
        setWsConnected(true);
        prevParticipantsMapRef.current = new Map(list.map((p) => [p.id, p]));
        rawParticipantsRef.current = list;

        const currentRoom = rawRoomRef.current;
        const now = Date.now();
        const projected = currentRoom
          ? list.map((p) => projectParticipantPhysics(p, currentRoom, now))
          : list;
        livePlayersRef.current = projected;
        liveVersionRef.current += 1;
        lastHudSyncRef.current = performance.now();
        setPlayers(projected);
      },
      onError: () => {
        setWsConnected(false);
      },
    });

    return () => {
      unsub();
      if (toastTimerRef.current) window.clearTimeout(toastTimerRef.current);
    };
  }, [session.roomCode]);

  // Deterministic 10 Hz physics projection (60 FPS interpolation inside StadiumArena3D via ref) + synced countdown driver
  useEffect(() => {
    const id = window.setInterval(() => {
      const r = rawRoomRef.current;
      if (!r) return;
      const now = Date.now();

      // 1. Synchronized 5 -> 4 -> 3 -> 2 -> 1 -> MULAI! countdown from room.startedAtMs
      if (r.status === 'countdown' && r.startedAtMs > 0) {
        const totalTicks = Math.max(
          3,
          Math.round((r.startedAtMs - (r.countdownStartMs || r.startedAtMs - 5000)) / 1000)
        );
        const remainingSec = Math.max(0, Math.ceil((r.startedAtMs - now) / 1000));
        if (lastCountdownTickRef.current !== remainingSec) {
          lastCountdownTickRef.current = remainingSec;
          setCountdownTotal(totalTicks);
          setCountdownVal(remainingSec);
          if (remainingSec === 0) {
            soundEngine.playStartingPistol();
            soundEngine.playStartWhistle('go');
            soundEngine.setHeartbeatTension(0);
            soundEngine.setCrowdMood('playing');
            soundEngine.setRaceIntensity(0.32, { allowAutoSwell: false });
            window.setTimeout(() => setCountdownVal(null), 1100);
          } else {
            soundEngine.setCrowdMood('countdown');
            soundEngine.playCountdownBeep(false);
            if (remainingSec === totalTicks) {
              soundEngine.playStartWhistle('ready');
            }
            const tensionRamp = Math.max(0, Math.min(1, (totalTicks - remainingSec + 1) / totalTicks));
            soundEngine.setHeartbeatTension(0.32 + tensionRamp * 0.54);
          }
        }
      } else if (r.status === 'playing' && lastCountdownTickRef.current !== null && lastCountdownTickRef.current > 0) {
        lastCountdownTickRef.current = 0;
        setCountdownVal(0);
        soundEngine.playStartingPistol();
        soundEngine.playStartWhistle('go');
        soundEngine.setHeartbeatTension(0);
        soundEngine.setCrowdMood('playing');
        window.setTimeout(() => setCountdownVal(null), 1100);
      }

      // 2. Dead-reckoning physics projection for all participants
      const rawList = rawParticipantsRef.current;
      if (rawList.length === 0) return;

      const isPlayingNow =
        r.status === 'playing' || (r.status === 'countdown' && r.startedAtMs > 0 && now >= r.startedAtMs);
      if (!isPlayingNow) return;

      const projected = rawList.map((p) => projectParticipantPhysics(p, r, now));
      livePlayersRef.current = projected;
      liveVersionRef.current += 1;

      const nowPerf = performance.now();
      if (nowPerf - lastHudSyncRef.current >= 240) {
        lastHudSyncRef.current = nowPerf;
        setPlayers(projected);
      }

      // 3. Detect local runner crossing the finish line after completing all questions
      const localRaw = rawList.find((p) => p.id === session.participantId);
      const localProj = projected.find((p) => p.id === session.participantId);
      if (
        localRaw &&
        localProj &&
        !localRaw.finishedAt &&
        !finishingSyncRef.current &&
        localRaw.answeredCount >= r.questionCount &&
        localProj.distance >= r.trackLength - 0.1
      ) {
        finishingSyncRef.current = true;
        const alreadyFinishedCount = rawList.filter((p) => p.finishedAt && p.finishedAt > 0).length;
        syncParticipantFinished({
          room: r,
          participant: localRaw,
          alreadyFinishedCount,
        })
          .then(({ finishRank }) => {
            if (!finishedCelebratedRef.current) {
              finishedCelebratedRef.current = true;
              soundEngine.setHeartbeatTension(0);
              soundEngine.playCrowdCheerAndFanfare();
              setCameraPreset('finish');
              showToast('finish', `GARIS FINISH! POSISI #${finishRank}`);
            }
          })
          .catch(() => {
            finishingSyncRef.current = false;
          });
      }
    }, 100);

    return () => window.clearInterval(id);
  }, [session.participantId, showToast]);

  const localPlayer = players.find((p) => p.id === session.participantId);
  localPlayerRef.current = localPlayer;

  const isEffectivePlaying = Boolean(
    room &&
      (room.status === 'playing' ||
        (room.status === 'countdown' && room.startedAtMs > 0 && Date.now() >= room.startedAtMs))
  );

  // Gate-triggered question delivery: each question only appears once the runner crosses its 3D question gate line
  useEffect(() => {
    const id = window.setInterval(() => {
      const r = rawRoomRef.current;
      if (!r) return;
      const now = Date.now();
      const playing =
        r.status === 'playing' || (r.status === 'countdown' && r.startedAtMs > 0 && now >= r.startedAtMs);
      if (!playing) return;

      const localRaw = rawParticipantsRef.current.find((p) => p.id === session.participantId);
      if (!localRaw || localRaw.finishedAt) return;

      if (localRaw.currentQuestionIndex >= r.questions.length) {
        setQuestionsCompleted(true);
        return;
      }

      if (
        !currentQuestion &&
        now >= nextQuestionAllowedAtRef.current &&
        !submittedQuestionIndicesRef.current.has(localRaw.currentQuestionIndex)
      ) {
        const localProj =
          livePlayersRef.current.find((p) => p.id === session.participantId) ??
          projectParticipantPhysics(localRaw, r, now);
        const requiredGateProgress = calcQuestionGateProgress(
          localRaw.currentQuestionIndex,
          r.questionCount
        );

        // Wait until the runner physically crosses the painted "GERBANG SOAL" line on the 3D track
        if (localProj.progress < requiredGateProgress) {
          return;
        }

        const q = r.questions[localRaw.currentQuestionIndex];
        if (q) {
          setQuestionsCompleted(false);
          setSubmittingIdx(null);
          setShortAnswerText('');
          setQuestionTimeLeft(r.settings.timePerQuestion);
          setCurrentQuestion({
            index: localRaw.currentQuestionIndex,
            total: r.questionCount,
            id: q.id,
            subject: q.subject,
            questionType: q.questionType,
            prompt: q.prompt,
            options: q.options,
            timeLimit: r.settings.timePerQuestion,
            questionStartedAt: now,
          });
        }
      }
    }, 120);
    return () => window.clearInterval(id);
  }, [currentQuestion, session.participantId]);

  const submitAnswerInternal = useCallback(
    async (question: ActiveQuestionPayload, answer: string | null, isTimeout: boolean) => {
      const r = rawRoomRef.current;
      const localRaw = rawParticipantsRef.current.find((p) => p.id === session.participantId);
      if (!r || !localRaw) return;
      if (submittedQuestionIndicesRef.current.has(question.index)) return;

      submittedQuestionIndicesRef.current.add(question.index);
      setSubmittingIdx(question.index);

      try {
        const res = await submitParticipantAnswer({
          room: r,
          participant: localRaw,
          questionIndex: question.index,
          submittedAnswer: answer,
          isTimeout,
          questionStartedAt: question.questionStartedAt,
        });

        // Immediately reflect locally so runner surges without waiting for round-trip snapshot
        rawParticipantsRef.current = rawParticipantsRef.current.map((p) =>
          p.id === localRaw.id ? res.nextParticipant : p
        );

        if (res.isCorrect) {
          soundEngine.playCorrectBoost();
          const ptsText = ` (+${formatScoreValue(res.pointsEarned)} Poin)`;
          showToast('boost', `BENAR${ptsText}! SPEED BOOST +${res.effectDurationSec} DETIK`);
        } else if (res.isTimeout) {
          soundEngine.playWrongPenalty();
          showToast('penalty', `WAKTU HABIS! LARI SANGAT PELAN ${res.effectDurationSec} DETIK`);
        } else {
          soundEngine.playWrongPenalty();
          showToast('penalty', `SALAH! LARI SANGAT PELAN ${res.effectDurationSec} DETIK`);
        }

        nextQuestionAllowedAtRef.current = Date.now() + QUESTION_HIDE_GAP_MS;
        setCurrentQuestion(null);
        setSubmittingIdx(null);
        setShortAnswerText('');
        if (question.index + 1 >= r.questionCount) {
          setQuestionsCompleted(true);
        }
      } catch {
        submittedQuestionIndicesRef.current.delete(question.index);
        setSubmittingIdx(null);
      }
    },
    [session.participantId, showToast]
  );

  // Per-second UI countdown for active question (auto-submits timeout) & boost/penalty timer
  useEffect(() => {
    const id = window.setInterval(() => {
      const now = Date.now();
      if (currentQuestion) {
        const elapsedSec = (now - currentQuestion.questionStartedAt) / 1000;
        const left = Math.max(0, Math.ceil(currentQuestion.timeLimit - elapsedSec));
        setQuestionTimeLeft((prev) => (prev === left ? prev : left));
        if (elapsedSec >= currentQuestion.timeLimit) {
          submitAnswerInternal(currentQuestion, null, true).catch(() => {});
        }
      }
      const lp = localPlayerRef.current;
      const nextEffect =
        lp && lp.effectExpiresAt > now
          ? Math.ceil((lp.effectExpiresAt - now) / 1000)
          : 0;
      setEffectSecondsLeft((prev) => (prev === nextEffect ? prev : nextEffect));
    }, 250);
    return () => window.clearInterval(id);
  }, [currentQuestion, submitAnswerInternal]);

  function handleAnswerSubmit(answer: string) {
    if (!currentQuestion || submittingIdx === currentQuestion.index) return;
    soundEngine.unlock();
    submitAnswerInternal(currentQuestion, answer, false).catch(() => {});
  }

  function toggleMute() {
    soundEngine.unlock();
    soundEngine.muted = !soundEngine.muted;
    setMuted(soundEngine.muted);
  }

  function handleVolumeChange(nextVol: number) {
    soundEngine.unlock();
    soundEngine.volume = nextVol;
    setVolume(soundEngine.volume);
    if (nextVol > 0 && soundEngine.muted) {
      soundEngine.muted = false;
      setMuted(false);
    }
  }

  function toggleMusic() {
    soundEngine.unlock();
    const next = !musicEnabled;
    soundEngine.musicEnabled = next;
    setMusicEnabled(next);
  }

  function handleCycleTrack() {
    const nextId = soundEngine.cycleMusicTrack();
    setMusicTrack(nextId);
    setMusicEnabled(true);
    if (soundEngine.muted) {
      soundEngine.muted = false;
      setMuted(false);
    }
  }

  const activeTrackMeta =
    RACE_MUSIC_TRACKS.find((t) => t.id === musicTrack) ?? RACE_MUSIC_TRACKS[0];

  const sortedLeader = useMemo(
    () => [...players].sort((a, b) => b.progress - a.progress || b.score - a.score),
    [players]
  );
  const podiumWinners = useMemo(
    () =>
      [...players].sort((a, b) => {
        const ra = a.scoreRank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.scoreRank ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        if (b.score !== a.score) return b.score - a.score;
        if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
        return (a.durationMs ?? Number.MAX_SAFE_INTEGER) - (b.durationMs ?? Number.MAX_SAFE_INTEGER);
      }),
    [players]
  );
  const myTrackRank = sortedLeader.findIndex((p) => p.id === session.participantId) + 1;
  const totalQuestions = room?.questionCount || 50;
  const totalLaps = room?.totalLaps ?? calcTotalLaps(totalQuestions);
  const pointsPerQuestion = room?.pointsPerQuestion ?? calcPointsPerQuestion(totalQuestions);
  const maxScore = room?.maxScore ?? MAX_MATCH_SCORE;
  const myColorHex = AVATAR_COLORS.find((c) => c.id === session.avatar.color)?.hex || '#2563EB';
  const activeVenue: RaceVenueId = venueOverride ?? room?.settings?.venue ?? 'stadium_day';
  const activeVenueMeta = RACE_VENUES.find((v) => v.id === activeVenue) ?? RACE_VENUES[0];
  const cycleVenue = () => {
    const idx = RACE_VENUES.findIndex((v) => v.id === activeVenue);
    const next = RACE_VENUES[(idx + 1) % RACE_VENUES.length];
    setVenueOverride(next.id);
  };
  const VenueIcon =
    activeVenue === 'stadium_day' ? Sun : activeVenue === 'stadium_night' ? Moon : Trees;

  // Ambient stadium crowd + dynamic race intensity + heartbeat tension synced with live race state
  const roomStatus: RoomStatus = isEffectivePlaying ? 'playing' : room?.status ?? 'waiting';
  const audioTelemetry = useMemo(() => {
    if (roomStatus !== 'playing') {
      return { hasHighExcitement: false, raceIntensity: 0, heartbeatTension: 0 };
    }
    const leaderProgress = sortedLeader[0]?.progress ?? 0;
    const secondProgress = sortedLeader[1]?.progress ?? 0;
    const myProgress = localPlayer?.progress ?? 0;
    const myFinished = Boolean(localPlayer?.finishedAt);
    const myBoost = localPlayer?.effectState === 'boost' ? 1 : 0;

    let boostingCount = 0;
    for (let i = 0; i < players.length; i++) {
      if (players[i].effectState === 'boost') boostingCount++;
    }
    const boostRatio = players.length > 0 ? Math.min(1, boostingCount / Math.min(players.length, 6)) : 0;
    const closeBattle =
      sortedLeader.length >= 2 && leaderProgress >= 0.35
        ? Math.max(0, 1 - Math.abs(leaderProgress - secondProgress) / 0.08)
        : 0;
    const finalStretch = Math.max(0, (Math.max(myProgress, leaderProgress) - 0.65) / 0.35);

    const raceIntensity = Math.min(
      1,
      leaderProgress * 0.38 +
        finalStretch * 0.36 +
        boostRatio * 0.16 +
        myBoost * 0.16 +
        closeBattle * 0.18
    );

    let heartbeatTension = 0;
    if (!myFinished) {
      // 1) Final stretch adrenaline sprint (>= 68% track progress)
      if (myProgress >= 0.68) {
        heartbeatTension = Math.max(heartbeatTension, 0.26 + ((myProgress - 0.68) / 0.32) * 0.7);
      }
      // 2) Urgent quiz question countdown (last 6 seconds)
      if (currentQuestion && questionTimeLeft > 0 && questionTimeLeft <= 6) {
        heartbeatTension = Math.max(heartbeatTension, 0.34 + ((6 - questionTimeLeft) / 5) * 0.56);
      }
      // 3) Neck-and-neck duel near the leader in second half of the race
      if (sortedLeader.length >= 2 && myProgress >= 0.48) {
        const gapToLeader = Math.abs(leaderProgress - myProgress);
        if (gapToLeader < 0.065) {
          const duelUrgency = (1 - gapToLeader / 0.065) * 0.58;
          heartbeatTension = Math.max(heartbeatTension, duelUrgency);
        }
      }
      // 4) Speed boost surge in second half
      if (myBoost && myProgress >= 0.55) {
        heartbeatTension = Math.max(heartbeatTension, 0.34);
      }
    }

    const hasHighExcitement = raceIntensity >= 0.55 || myBoost === 1 || leaderProgress >= 0.8;
    return {
      hasHighExcitement,
      raceIntensity,
      heartbeatTension: Math.min(1, heartbeatTension),
    };
  }, [roomStatus, sortedLeader, localPlayer, players, currentQuestion, questionTimeLeft]);

  useEffect(() => {
    soundEngine.startRaceMusic('waiting', activeVenue);

    return () => {
      soundEngine.stopAllRaceAudio();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    soundEngine.setVenue(activeVenue);
  }, [activeVenue]);

  useEffect(() => {
    if (roomStatus === 'finished') {
      soundEngine.setRaceIntensity(0, { heartbeatTension: 0, allowAutoSwell: false });
      soundEngine.setCrowdMood('victory');
      soundEngine.startVictoryMusic();
    } else {
      soundEngine.stopVictoryMusic();
      if (roomStatus === 'countdown') {
        soundEngine.setCrowdMood('countdown');
      } else if (roomStatus === 'playing') {
        soundEngine.setCrowdMood(audioTelemetry.hasHighExcitement ? 'excited' : 'playing');
        soundEngine.setRaceIntensity(audioTelemetry.raceIntensity, {
          heartbeatTension: audioTelemetry.heartbeatTension,
        });
      } else {
        soundEngine.setCrowdMood('waiting');
        soundEngine.setRaceIntensity(0, { heartbeatTension: 0, allowAutoSwell: false });
      }
    }
  }, [
    roomStatus,
    audioTelemetry.hasHighExcitement,
    audioTelemetry.raceIntensity,
    audioTelemetry.heartbeatTension,
  ]);

  return (
    <div className="relative w-screen h-screen overflow-hidden bg-[#081226] select-none">
      {/* Isolated Fullscreen 3D Stadium Viewport */}
      <div className="absolute inset-0">
        <StadiumArena3D
          questionCount={totalQuestions}
          maxPlayers={room?.settings?.maxPlayers || 30}
          players={players}
          livePlayersRef={livePlayersRef}
          liveVersionRef={liveVersionRef}
          localPlayerId={session.participantId}
          roomStatus={roomStatus}
          roomName={room?.name || 'EDU RUN ARENA 3D'}
          cameraPreset={cameraPreset}
          cameraViewMode={cameraViewMode}
          pipPlacement="top-row"
          onSelectCameraPreset={setCameraPreset}
          onChangeCameraViewMode={setCameraViewMode}
          venue={activeVenue}
        />
      </div>

      {/* Reconnect Banner if network drops */}
      {!wsConnected && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 z-40 px-4 py-2 rounded-xl bg-amber-600 text-white text-xs font-bold flex items-center gap-2 shadow-lg">
          <WifiOff className="w-4 h-4" />
          <span>Koneksi terputus — menyambungkan ulang ke server...</span>
        </div>
      )}

      {/* Initial Room Connection 3D Loading */}
      {!room && (
        <Loading3D
          variant="fullscreen"
          title="Menghubungkan ke Arena Balap..."
          subtitle={`Menyiapkan garis start untuk ${session.name} (Room ${session.roomCode})`}
        />
      )}

      {/* ==================== WAITING LOBBY OVERLAY ==================== */}
      {room?.status === 'waiting' && (
        <div className="absolute inset-0 z-20 flex flex-col justify-between p-4 sm:p-6 pointer-events-none">
          <div className="max-w-4xl mx-auto w-full flex flex-wrap items-center justify-between gap-3 p-4 rounded-2xl bg-[#081226]/92 border border-blue-400/30 pointer-events-auto">
            <div>
              <div className="text-xs font-semibold text-[#FACC15]">
                LOBBY PERTANDINGAN · {room.subject} · Kelas {room.grade}
              </div>
              <h1 className="font-display font-bold text-lg sm:text-xl text-white">{room.name}</h1>
              <div className="text-xs text-slate-300">
                Guru: {room.teacherName} · {totalQuestions} Soal · {totalLaps} Putaran ·{' '}
                {formatScoreValue(pointsPerQuestion)} Poin/Soal (Maks {maxScore}) · Maks {room.settings.maxPlayers} Peserta
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
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  cameraViewMode !== 'single'
                    ? 'bg-[#FF6B1A] border-[#FF6B1A] text-white'
                    : 'bg-[#0F2957] border-blue-400/30 text-white hover:bg-blue-800'
                }`}
                title="Live Preview 4 Posisi Kamera"
              >
                <Grid2x2 className="w-4 h-4 text-[#FACC15]" />
                <span>{cameraViewMode === 'quad' ? 'Grid 2×2' : '4 Kamera'}</span>
              </button>
              <button
                onClick={cycleVenue}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F2957] border border-blue-400/30 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
                title={`Tempat Balapan: ${activeVenueMeta.label} (klik untuk ganti tampilan)`}
              >
                <VenueIcon className="w-4 h-4 text-[#FACC15]" />
                <span>{activeVenueMeta.shortLabel}</span>
              </button>
              <div className="px-4 py-2 rounded-xl bg-[#0F2957] border border-blue-400/30 text-center">
                <div className="text-[10px] text-blue-200 uppercase">Kode Room</div>
                <div className="font-mono font-bold text-lg tracking-widest text-[#FACC15]">
                  {room.code}
                </div>
              </div>
              <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#0F2957] border border-white/15">
                <button
                  onClick={toggleMusic}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    musicEnabled
                      ? 'bg-[#FF6B1A]/20 text-[#FACC15]'
                      : 'text-slate-400 hover:text-white'
                  }`}
                  title={musicEnabled ? 'Matikan Musik Semangat' : 'Aktifkan Musik Semangat'}
                >
                  <Music className="w-4 h-4" />
                  <span className="hidden sm:inline">
                    {musicEnabled ? activeTrackMeta.title : 'Musik OFF'}
                  </span>
                </button>
                <button
                  onClick={handleCycleTrack}
                  className="p-1.5 rounded-lg hover:bg-white/10 text-blue-200 hover:text-[#FACC15] cursor-pointer"
                  title={`Ganti Lagu (${activeTrackMeta.title})`}
                >
                  <SkipForward className="w-3.5 h-3.5" />
                </button>
              </div>
              <div className="flex items-center gap-2 px-2.5 py-2 rounded-xl bg-[#0F2957] border border-white/15">
                <button
                  onClick={toggleMute}
                  className="text-white hover:text-[#FACC15] cursor-pointer"
                  title={muted ? 'Aktifkan Musik & Suara' : 'Matikan Semua Suara'}
                >
                  {muted || volume === 0 ? <VolumeX className="w-5 h-5" /> : <Volume2 className="w-5 h-5" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  aria-label="Volume Musik Pertandingan"
                  className="w-16 accent-[#FF6B1A] cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="max-w-4xl mx-auto w-full p-4 sm:p-5 rounded-2xl bg-[#081226]/92 border border-blue-400/30 pointer-events-auto">
            <div className="flex flex-wrap items-center justify-between gap-3 mb-3">
              <div className="flex items-center gap-2 font-display font-bold text-base">
                <Users className="w-4 h-4 text-[#FF6B1A]" />
                <span>
                  Peserta di Garis Start ({players.length}/{room.settings.maxPlayers})
                </span>
              </div>
              <Loading3D
                variant="inline"
                size="sm"
                title="Siap di Garis Start"
                subtitle="Menunggu guru memulai pertandingan..."
              />
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 md:grid-cols-6 gap-2 max-h-40 overflow-y-auto">
              {players.map((p) => {
                const cHex = AVATAR_COLORS.find((c) => c.id === p.avatar.color)?.hex || '#2563EB';
                const isMe = p.id === session.participantId;
                return (
                  <div
                    key={p.id}
                    className={`p-2 rounded-xl border text-xs flex items-center gap-2 ${
                      isMe ? 'bg-[#FF6B1A]/20 border-[#FACC15]' : 'bg-[#0F2957] border-white/10'
                    }`}
                  >
                    <span
                      className="w-3 h-3 rounded-full shrink-0 border border-white/40"
                      style={{ backgroundColor: cHex }}
                    />
                    <div className="min-w-0">
                      <div className="font-semibold text-white truncate">{p.name}</div>
                      <div className="text-[10px] text-slate-300 truncate">{p.className}</div>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ==================== COUNTDOWN 5, 4, 3, 2, 1, MULAI! ==================== */}
      {countdownVal !== null && (
        <StadiumCountdownOverlay value={countdownVal} total={countdownTotal} />
      )}

      {/* ==================== ACTIVE PLAYING HUD ==================== */}
      {isEffectivePlaying && (
        <div className="absolute inset-0 z-20 flex flex-col justify-between p-2.5 sm:p-4 pointer-events-none">
          {/* TOP BAR PERIMETER + NON-INTRUSIVE TOAST */}
          <div className="space-y-2">
            <div className="flex flex-wrap items-start justify-between gap-2.5">
              {/* Left: Player Card & Speed State */}
              <div className="p-2.5 sm:p-3 rounded-2xl bg-[#081226]/92 border border-blue-400/30 pointer-events-auto flex items-center gap-3">
                <div
                  className="w-9 h-9 sm:w-10 sm:h-10 rounded-xl flex items-center justify-center font-mono font-bold text-white border border-white/25 shrink-0"
                  style={{ backgroundColor: myColorHex }}
                >
                  #{(localPlayer?.lane ?? 0) + 1}
                </div>
                <div className="min-w-0">
                  <div className="font-display font-bold text-sm text-white truncate max-w-[140px]">
                    {session.name}
                  </div>
                  <div className="text-[11px] text-slate-300">
                    {session.className} · Posisi #{myTrackRank || '-'}
                  </div>
                </div>

                {localPlayer?.effectState === 'boost' && (
                  <div className="px-2.5 py-1 rounded-lg bg-cyan-500/20 border border-cyan-400 text-cyan-200 text-xs font-bold flex items-center gap-1 tabular-nums">
                    <Zap className="w-3.5 h-3.5" />
                    <span>BOOST {effectSecondsLeft}s</span>
                  </div>
                )}
                {localPlayer?.effectState === 'penalty' && (
                  <div className="px-2.5 py-1 rounded-lg bg-rose-500/20 border border-rose-400 text-rose-200 text-xs font-bold flex items-center gap-1 tabular-nums">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    <span>LAMBAT {effectSecondsLeft}s</span>
                  </div>
                )}
              </div>

              {/* Center: Progress, Lap, Soal Counter, Score, Controls */}
              <div className="p-2.5 sm:p-3 rounded-2xl bg-[#081226]/92 border border-blue-400/30 pointer-events-auto flex flex-wrap items-center gap-3 sm:gap-4">
                <div>
                  <div className="text-[10px] text-blue-200 uppercase">Putaran</div>
                  <div className="font-mono font-bold text-sm sm:text-base text-orange-300 tabular-nums">
                    {Math.min(
                      totalLaps,
                      Math.floor((localPlayer?.progress ?? 0) * totalLaps) + 1
                    )}{' '}
                    / {totalLaps}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-blue-200 uppercase">Soal</div>
                  <div className="font-mono font-bold text-sm sm:text-base text-white tabular-nums">
                    {Math.min(totalQuestions, (localPlayer?.answeredCount ?? 0) + (questionsCompleted ? 0 : 1))} / {totalQuestions}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-blue-200 uppercase">Terjawab</div>
                  <div className="font-mono font-bold text-sm sm:text-base text-emerald-300 tabular-nums">
                    {localPlayer?.answeredCount ?? 0}
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-blue-200 uppercase">Progres</div>
                  <div className="font-mono font-bold text-sm sm:text-base text-cyan-300 tabular-nums">
                    {Math.round((localPlayer?.progress ?? 0) * 100)}%
                  </div>
                </div>

                <div>
                  <div className="text-[10px] text-blue-200 uppercase">Skor</div>
                  <div className="font-mono font-bold text-sm sm:text-base text-[#FACC15] tabular-nums">
                    {formatScoreValue(localPlayer?.score ?? 0)} / {maxScore}
                  </div>
                </div>

                <div className="flex items-center gap-1.5 pl-2 border-l border-white/15">
                  <button
                    onClick={cycleVenue}
                    className="inline-flex items-center gap-1 px-2.5 py-2 rounded-lg bg-[#0F2957] hover:bg-blue-800 text-xs font-semibold text-slate-200 cursor-pointer"
                    title={`Tempat: ${activeVenueMeta.label} (klik ganti tampilan)`}
                  >
                    <VenueIcon className="w-3.5 h-3.5 text-[#FACC15]" />
                    <span className="hidden sm:inline">{activeVenueMeta.shortLabel}</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      const idx = CAMERA_PRESET_LIST.findIndex((c) => c.id === cameraPreset);
                      const next = CAMERA_PRESET_LIST[(idx + 1) % CAMERA_PRESET_LIST.length];
                      setCameraPreset(next.id);
                    }}
                    className="inline-flex items-center gap-1 px-2 py-2 rounded-lg bg-[#0F2957] hover:bg-blue-800 text-xs font-semibold text-slate-200 cursor-pointer"
                    title="Ganti Sudut Kamera (4 Posisi)"
                  >
                    <Camera className="w-3.5 h-3.5 text-[#FF6B1A]" />
                    <span className="font-mono text-[11px]">
                      {CAMERA_PRESET_LIST.find((c) => c.id === cameraPreset)?.camCode || 'CAM'}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() =>
                      setCameraViewMode((prev) =>
                        prev === 'single' ? 'pip' : prev === 'pip' ? 'quad' : 'single'
                      )
                    }
                    className={`inline-flex items-center gap-1 px-2 py-2 rounded-lg text-xs font-semibold cursor-pointer ${
                      cameraViewMode !== 'single'
                        ? 'bg-[#FF6B1A] text-white'
                        : 'bg-[#0F2957] hover:bg-blue-800 text-slate-200'
                    }`}
                    title="Live Preview 4 Kamera"
                  >
                    <Grid2x2 className="w-3.5 h-3.5 text-[#FACC15]" />
                    <span className="hidden sm:inline">4 Cam</span>
                  </button>
                  <button
                    onClick={toggleMusic}
                    className={`p-2 rounded-lg cursor-pointer ${
                      musicEnabled
                        ? 'bg-[#FF6B1A]/25 text-[#FACC15] border border-[#FF6B1A]/50'
                        : 'bg-[#0F2957] hover:bg-blue-800 text-slate-400'
                    }`}
                    title={musicEnabled ? `Matikan Musik (${activeTrackMeta.title})` : 'Aktifkan Musik Semangat'}
                  >
                    <Music className="w-4 h-4" />
                  </button>
                  <button
                    onClick={handleCycleTrack}
                    className="p-2 rounded-lg bg-[#0F2957] hover:bg-blue-800 text-slate-200 hover:text-[#FACC15] cursor-pointer"
                    title={`Ganti Lagu (${activeTrackMeta.title})`}
                  >
                    <SkipForward className="w-4 h-4" />
                  </button>
                  <button
                    onClick={toggleMute}
                    className="p-2 rounded-lg bg-[#0F2957] hover:bg-blue-800 text-slate-200 cursor-pointer"
                    title={muted ? 'Aktifkan Suara' : 'Matikan Suara'}
                  >
                    {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              {/* Right: Mini Leaderboard (Desktop/Tablet) */}
              <div className="hidden md:block w-52 p-2.5 rounded-2xl bg-[#081226]/92 border border-blue-400/30 pointer-events-auto">
                <div className="text-[11px] font-bold text-[#FACC15] mb-1 flex items-center justify-between">
                  <span>KLASEMEN LINTASAN</span>
                  <Trophy className="w-3.5 h-3.5" />
                </div>
                <div className="space-y-0.5">
                  {sortedLeader.slice(0, 4).map((p, idx) => (
                    <div
                      key={p.id}
                      className={`flex items-center justify-between text-xs px-2 py-0.5 rounded-lg ${
                        p.id === session.participantId ? 'bg-[#FF6B1A]/25 font-bold text-white' : 'text-slate-200'
                      }`}
                    >
                      <span className="truncate max-w-[110px]">
                        {idx + 1}. {p.name}
                      </span>
                      <span className="font-mono text-[#FACC15] tabular-nums">{formatScoreValue(p.score)}p</span>
                    </div>
                  ))}
                </div>
              </div>
            </div>

            {/* TOP-CENTER FEEDBACK TOAST (kept clear of runner center view) */}
            {toast && (
              <div className="flex justify-center pointer-events-none">
                <div
                  className={`px-5 py-2 rounded-xl border-2 font-display font-extrabold text-sm sm:text-base shadow-xl ${
                    toast.kind === 'boost'
                      ? 'bg-emerald-950/95 border-cyan-400 text-cyan-200'
                      : toast.kind === 'finish'
                      ? 'bg-amber-950/95 border-[#FACC15] text-[#FACC15]'
                      : 'bg-rose-950/95 border-rose-400 text-rose-200'
                  }`}
                >
                  {toast.text}
                </div>
              </div>
            )}

          </div>

          {/* COMPACT BOTTOM-DOCKED QUESTION PANEL (keeps running character unobstructed above) */}
          <div className="max-w-3xl mx-auto w-full pointer-events-auto">
            {currentQuestion && !localPlayer?.finishedAt ? (
              <div className="p-3 sm:p-4 rounded-2xl bg-[#081226]/94 border border-blue-400/40 shadow-2xl">
                {/* Timer Progress Bar */}
                <div className="flex items-center justify-between gap-3 mb-1.5">
                  <div className="flex items-center gap-2 text-xs font-bold text-blue-200">
                    <span className="px-2 py-0.5 rounded-md bg-[#1D4ED8] text-white font-mono">
                      SOAL {currentQuestion.index + 1} / {currentQuestion.total}
                    </span>
                    <span>{currentQuestion.subject}</span>
                  </div>
                  <div
                    className={`inline-flex items-center gap-1.5 font-mono font-bold text-sm tabular-nums ${
                      questionTimeLeft <= 5 ? 'text-rose-400' : 'text-[#FACC15]'
                    }`}
                  >
                    <Clock className="w-4 h-4" />
                    <span>{questionTimeLeft}s</span>
                  </div>
                </div>

                <div className="w-full h-1 rounded-full bg-slate-800 overflow-hidden mb-2">
                  <div
                    className={`h-full transition-all duration-200 ${
                      questionTimeLeft <= 5 ? 'bg-rose-500' : 'bg-[#FF6B1A]'
                    }`}
                    style={{
                      width: `${Math.min(100, (questionTimeLeft / currentQuestion.timeLimit) * 100)}%`,
                    }}
                  />
                </div>

                <h2 className="font-display font-bold text-sm sm:text-base text-white leading-snug mb-2.5">
                  {currentQuestion.prompt}
                </h2>

                {currentQuestion.questionType === 'short_answer' ? (
                  <form
                    onSubmit={(e) => {
                      e.preventDefault();
                      if (shortAnswerText.trim()) handleAnswerSubmit(shortAnswerText.trim());
                    }}
                    className="flex flex-col sm:flex-row gap-2"
                  >
                    <input
                      type="text"
                      value={shortAnswerText}
                      onChange={(e) => setShortAnswerText(e.target.value)}
                      placeholder="Ketik jawaban singkat Anda..."
                      disabled={submittingIdx === currentQuestion.index}
                      className="flex-1 px-3.5 py-2.5 rounded-xl bg-[#0F2957] border border-blue-400/40 text-sm text-white placeholder:text-slate-400 focus:outline-none focus:border-[#FACC15]"
                    />
                    <button
                      type="submit"
                      disabled={submittingIdx === currentQuestion.index || !shortAnswerText.trim()}
                      className="inline-flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] disabled:opacity-50 font-bold text-sm text-white cursor-pointer"
                    >
                      <Send className="w-4 h-4" />
                      <span>Kirim Jawaban</span>
                    </button>
                  </form>
                ) : (
                  <div
                    className={`grid gap-2 ${
                      currentQuestion.questionType === 'true_false'
                        ? 'grid-cols-2'
                        : 'grid-cols-1 sm:grid-cols-2'
                    }`}
                  >
                    {(['A', 'B', 'C', 'D'] as const)
                      .filter((k) => Boolean(currentQuestion.options[k]))
                      .map((optKey) => (
                        <button
                          key={optKey}
                          disabled={submittingIdx === currentQuestion.index}
                          onClick={() => handleAnswerSubmit(optKey)}
                          className="group flex items-center gap-2.5 px-3 py-2 sm:py-2.5 rounded-xl bg-[#0F2957] hover:bg-[#1D4ED8] border border-blue-400/30 hover:border-[#FACC15] text-left transition-colors cursor-pointer disabled:opacity-60"
                        >
                          <span className="w-7 h-7 rounded-lg bg-[#081226] group-hover:bg-[#FF6B1A] border border-white/15 flex items-center justify-center font-mono font-bold text-xs text-[#FACC15] group-hover:text-white shrink-0">
                            {optKey}
                          </span>
                          <span className="font-medium text-xs sm:text-sm text-white leading-snug">
                            {currentQuestion.options[optKey]}
                          </span>
                        </button>
                      ))}
                  </div>
                )}
              </div>
            ) : localPlayer?.finishedAt ? (
              <div className="p-3.5 sm:p-4 rounded-2xl bg-[#081226]/95 border border-[#FACC15] flex flex-col sm:flex-row items-center justify-between gap-3">
                <div className="flex items-center gap-3">
                  <Flag className="w-6 h-6 text-[#FACC15] shrink-0" />
                  <div>
                    <div className="font-display font-bold text-base sm:text-lg text-white">
                      Anda Mencapai Garis Finish di Posisi #{localPlayer.finishRank}!
                    </div>
                    <div className="text-xs text-slate-300">
                      Total Poin: <strong className="text-[#FACC15]">{formatScoreValue(localPlayer.score)} / {maxScore}</strong> · Benar:{' '}
                      <strong className="text-emerald-300">{localPlayer.correctCount}</strong> · Menunggu peserta lain menyelesaikan lintasan.
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setShowResultsOverride(true)}
                  className="px-5 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] font-semibold text-sm text-white cursor-pointer whitespace-nowrap shrink-0"
                >
                  Lihat Hasil Sementara
                </button>
              </div>
            ) : questionsCompleted ? (
              <div className="p-3.5 rounded-2xl bg-[#081226]/95 border border-cyan-400/40 text-center">
                <div className="font-display font-bold text-sm sm:text-base text-cyan-300">
                  Semua {totalQuestions} Soal Selesai! Pelari Anda Sedang Sprint Menuju Garis Finish...
                </div>
              </div>
            ) : room && localPlayer && localPlayer.currentQuestionIndex < totalQuestions ? (
              (() => {
                const nextIdx = localPlayer.currentQuestionIndex;
                const gatesOnLap = calcGatesPerLap(totalQuestions);
                const gateNum = (nextIdx % gatesOnLap) + 1;
                const gateLap = Math.floor(nextIdx / gatesOnLap) + 1;
                const reqProg = calcQuestionGateProgress(nextIdx, totalQuestions);
                const prevProg =
                  nextIdx > 0 ? calcQuestionGateProgress(nextIdx - 1, totalQuestions) : 0;
                const ratio = Math.max(
                  0,
                  Math.min(1, (localPlayer.progress - prevProg) / Math.max(0.001, reqProg - prevProg))
                );
                const metersLeft = Math.max(
                  0,
                  Math.ceil((reqProg - localPlayer.progress) * room.trackLength)
                );
                return (
                  <div className="px-4 py-2.5 rounded-2xl bg-[#081226]/92 border border-blue-400/35 shadow-xl">
                    <div className="flex items-center justify-between gap-3 text-xs mb-1.5">
                      <div className="flex items-center gap-2 font-display font-bold text-white">
                        <Flag className="w-3.5 h-3.5 text-[#FACC15] shrink-0" />
                        <span>
                          Menuju Gerbang Soal {gateNum} · Soal {nextIdx + 1}/{totalQuestions}
                        </span>
                        <span className="hidden sm:inline text-[11px] font-normal text-blue-200">
                          (Putaran {gateLap}/{totalLaps})
                        </span>
                      </div>
                      <span className="font-mono font-bold text-[#FACC15] tabular-nums shrink-0">
                        {metersLeft > 0 ? `${metersLeft} m lagi` : 'Melewati Gerbang!'}
                      </span>
                    </div>
                    <div className="w-full h-1.5 rounded-full bg-slate-800 overflow-hidden">
                      <div
                        className="h-full bg-[#FF6B1A] transition-all duration-200"
                        style={{ width: `${Math.round(ratio * 100)}%` }}
                      />
                    </div>
                  </div>
                );
              })()
            ) : null}
          </div>
        </div>
      )}

      {/* ==================== FINISHED LIVE CENTER-FIELD PODIUM HUD ==================== */}
      {room?.status === 'finished' && !showResultsOverride && (
        <div className="absolute inset-0 z-20 flex flex-col justify-between p-3 sm:p-5 pointer-events-none">
          <div className="max-w-5xl mx-auto w-full flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4 rounded-2xl bg-[#081226]/90 border border-[#FACC15]/45 pointer-events-auto shadow-2xl">
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-xl bg-amber-500/20 border border-[#FACC15]/60 flex items-center justify-center shrink-0">
                <Trophy className="w-5 h-5 text-[#FACC15]" />
              </div>
              <div>
                <div className="text-[11px] font-bold text-[#FACC15] uppercase tracking-wide">
                  Upacara Podium Juara 1 · 2 · 3 · 4 — {room.subject}
                </div>
                <h1 className="font-display font-bold text-base sm:text-lg text-white">
                  {room.name}
                </h1>
              </div>
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                onClick={cycleVenue}
                className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-[#0F2957] border border-blue-400/30 text-xs font-semibold text-white hover:bg-blue-800 cursor-pointer"
                title={`Tempat: ${activeVenueMeta.label}`}
              >
                <VenueIcon className="w-4 h-4 text-[#FACC15]" />
                <span>{activeVenueMeta.shortLabel}</span>
              </button>
              <button
                onClick={toggleMusic}
                className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-semibold cursor-pointer ${
                  musicEnabled
                    ? 'bg-[#FF6B1A]/20 border-[#FF6B1A]/60 text-[#FACC15]'
                    : 'bg-[#0F2957] border-white/15 text-slate-400'
                }`}
                title={musicEnabled ? 'Matikan Musik Kemenangan' : 'Aktifkan Musik Kemenangan'}
              >
                <Music className="w-4 h-4" />
                <span>{musicEnabled ? 'Musik ON' : 'Musik OFF'}</span>
              </button>
              <div className="flex items-center gap-2 px-2.5 py-1.5 rounded-xl bg-[#0F2957] border border-white/15">
                <button
                  onClick={toggleMute}
                  className="text-white hover:text-[#FACC15] cursor-pointer"
                  title={muted ? 'Aktifkan Suara' : 'Matikan Suara'}
                >
                  {muted || volume === 0 ? <VolumeX className="w-4 h-4" /> : <Volume2 className="w-4 h-4" />}
                </button>
                <input
                  type="range"
                  min={0}
                  max={1}
                  step={0.05}
                  value={muted ? 0 : volume}
                  onChange={(e) => handleVolumeChange(Number(e.target.value))}
                  aria-label="Volume Musik Kemenangan"
                  className="w-16 accent-[#FACC15] cursor-pointer"
                />
              </div>
            </div>
          </div>

          <div className="max-w-5xl mx-auto w-full p-3.5 sm:p-4 rounded-2xl bg-[#081226]/92 border border-blue-400/35 pointer-events-auto shadow-2xl space-y-3">
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
              {podiumWinners.slice(0, 4).map((w, idx) => {
                const badgeColors = [
                  'border-[#FACC15] bg-amber-500/15 text-[#FACC15]',
                  'border-slate-300/60 bg-slate-500/15 text-slate-200',
                  'border-[#FF6B1A]/70 bg-orange-500/15 text-orange-300',
                  'border-cyan-400/60 bg-cyan-500/15 text-cyan-300',
                ];
                return (
                  <div
                    key={w.id}
                    className={`px-3 py-2 rounded-xl border flex items-center justify-between gap-2 ${badgeColors[idx]}`}
                  >
                    <div className="min-w-0">
                      <div className="text-[10px] font-bold uppercase flex items-center gap-1">
                        <Award className="w-3 h-3 shrink-0" />
                        <span>Juara {idx + 1}</span>
                      </div>
                      <div className="font-display font-bold text-xs sm:text-sm text-white truncate">
                        {w.name}
                      </div>
                    </div>
                    <span className="font-mono font-bold text-xs tabular-nums shrink-0">
                      {formatScoreValue(w.score)}p
                    </span>
                  </div>
                );
              })}
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-300">
                <span>
                  Peringkat Nilai Anda:{' '}
                  <strong className="text-[#FACC15]">#{localPlayer?.scoreRank ?? '-'}</strong> · Nilai:{' '}
                  <strong className="text-white">
                    {formatScoreValue(localPlayer?.score ?? 0)} / {maxScore}
                  </strong>
                </span>
                {localPlayer && (() => {
                  const localFinalRank =
                    localPlayer.scoreRank ??
                    Math.max(1, podiumWinners.findIndex((p) => p.id === localPlayer.id) + 1);
                  const localMeta = getVictoryMetaForRank(localFinalRank);
                  return (
                    <span
                      className="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-lg bg-[#0F2957] border border-white/15 font-semibold"
                      style={{ color: localMeta.accentHex }}
                    >
                      <span>Animasi 3D: {localMeta.title}</span>
                    </span>
                  );
                })()}
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setShowResultsOverride(true)}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 text-xs sm:text-sm font-semibold text-white cursor-pointer"
                >
                  <Trophy className="w-4 h-4" />
                  <span>Hasil & Pembahasan</span>
                </button>
                <button
                  onClick={onPlayAgain}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] text-xs sm:text-sm font-semibold text-white cursor-pointer"
                >
                  <RotateCcw className="w-4 h-4" />
                  <span>Main Lagi</span>
                </button>
                <button
                  onClick={onReturnLobby}
                  className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-[#0F2957] border border-white/15 hover:bg-white/10 text-xs sm:text-sm font-semibold text-white cursor-pointer"
                >
                  <Home className="w-4 h-4" />
                  <span>Lobby</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ==================== DETAILED RESULTS & REVIEW MODAL ==================== */}
      {showResultsOverride && room && (
        <MatchResultsModal
          roomCode={room.code}
          roomName={room.name}
          subject={room.subject}
          questionCount={totalQuestions}
          players={players}
          localPlayerId={session.participantId}
          onPlayAgain={onPlayAgain}
          onReturnLobby={onReturnLobby}
          onClose={() => setShowResultsOverride(false)}
        />
      )}
    </div>
  );
}
