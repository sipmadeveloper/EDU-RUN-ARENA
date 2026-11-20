import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowLeft,
  Play,
  Square,
  Copy,
  Check,
  Users,
  Download,
  Camera,
  Trophy,
  Sun,
  Moon,
  Trees,
  Volume2,
  VolumeX,
  Music,
  SkipForward,
  Link2,
  Grid2x2,
} from 'lucide-react';
import {
  AVATAR_COLORS,
  RACE_VENUES,
  type PlayerState,
  type RaceVenueId,
  type RoomSettings,
  type RoomStatus,
} from '../types/game';
import {
  CAMERA_PRESET_LIST,
  StadiumArena3D,
  type CameraPresetId,
  type CameraViewMode,
} from './StadiumArena3D';
import { StadiumCountdownOverlay } from './StadiumCountdownOverlay';
import { Loading3D } from './Loading3D';
import { RACE_MUSIC_TRACKS, soundEngine, type RaceMusicTrackId } from '../audio/soundEngine';
import {
  MAX_MATCH_SCORE,
  calcPointsPerQuestion,
  calcTotalLaps,
  formatScoreValue,
} from '../utils/matchScaling';
import { formatFriendlyFirestoreError } from '../firebase';
import {
  activatePlayingFirebaseRoom,
  downloadRoomExcelFromFirebase,
  finishFirebaseRoom,
  projectParticipantPhysics,
  startFirebaseRoom,
  subscribeLiveRoom,
  type LiveFirebaseParticipant,
  type LiveFirebaseRoom,
} from '../services/firebaseRaceService';

interface TeacherRoomMonitorProps {
  roomId: string;
  token: string;
  onBack: () => void;
  onOpenResults: (roomId: string) => void;
}

export function TeacherRoomMonitor({
  roomId,
  onBack,
  onOpenResults,
}: TeacherRoomMonitorProps) {
  const [room, setRoom] = useState<LiveFirebaseRoom | null>(null);
  const [players, setPlayers] = useState<PlayerState[]>([]);
  const [countdownVal, setCountdownVal] = useState<number | null>(null);
  const [countdownTotal, setCountdownTotal] = useState<number>(5);
  const [copied, setCopied] = useState(false);
  const [copiedLink, setCopiedLink] = useState(false);
  const [actionBusy, setActionBusy] = useState(false);
  const [excelBusy, setExcelBusy] = useState(false);
  const [error, setError] = useState('');
  const [cameraPreset, setCameraPreset] = useState<CameraPresetId>('broadcast');
  const [cameraViewMode, setCameraViewMode] = useState<CameraViewMode>('pip');
  const [venueOverride, setVenueOverride] = useState<RaceVenueId | null>(null);
  const [muted, setMuted] = useState(soundEngine.muted);
  const [volume, setVolume] = useState(soundEngine.volume);
  const [musicEnabled, setMusicEnabled] = useState(soundEngine.musicEnabled);
  const [musicTrack, setMusicTrack] = useState<RaceMusicTrackId>(soundEngine.trackId);

  const livePlayersRef = useRef<PlayerState[]>([]);
  const liveVersionRef = useRef(0);
  const lastHudSyncRef = useRef(0);

  const rawRoomRef = useRef<LiveFirebaseRoom | null>(null);
  const rawParticipantsRef = useRef<LiveFirebaseParticipant[]>([]);
  const prevParticipantsMapRef = useRef<Map<string, LiveFirebaseParticipant>>(new Map());
  const lastCountdownTickRef = useRef<number | null>(null);
  const activatingPlayingRef = useRef(false);
  const autoFinishingRef = useRef(false);
  const roomFinishedAudioRef = useRef(false);

  useEffect(() => {
    const unsub = subscribeLiveRoom(roomId, {
      onRoom: (nextRoom) => {
        if (!nextRoom) {
          setError('Room tidak ditemukan atau sudah dihapus.');
          return;
        }
        const prevRoom = rawRoomRef.current;
        rawRoomRef.current = nextRoom;
        setRoom(nextRoom);

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
            soundEngine.setCrowdMood('victory');
            soundEngine.startVictoryMusic();
          }
        }
      },
      onParticipants: (list) => {
        const prevMap = prevParticipantsMapRef.current;
        if (prevMap.size > 0) {
          for (const p of list) {
            const old = prevMap.get(p.id);
            if (!old) continue;
            if (!old.finishedAt && p.finishedAt && p.finishedAt > 0) {
              soundEngine.playCrowdCheerAndFanfare();
            }
          }
        }
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
      onError: (err) => {
        setError(formatFriendlyFirestoreError(err));
      },
    });

    return () => unsub();
  }, [roomId]);

  // 10 Hz physics projection + countdown transition + auto-finish when all participants finish
  useEffect(() => {
    const id = window.setInterval(() => {
      const r = rawRoomRef.current;
      if (!r) return;
      const now = Date.now();
      const rawList = rawParticipantsRef.current;

      // 1. Synchronized countdown + automatic countdown -> playing status update
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
        if (now >= r.startedAtMs && !activatingPlayingRef.current) {
          activatingPlayingRef.current = true;
          activatePlayingFirebaseRoom(r.code, rawList.length).catch(() => {
            activatingPlayingRef.current = false;
          });
        }
      }

      // 2. Project 60 FPS runner positions
      const isPlayingNow =
        r.status === 'playing' || (r.status === 'countdown' && r.startedAtMs > 0 && now >= r.startedAtMs);
      if (isPlayingNow && rawList.length > 0) {
        const projected = rawList.map((p) => projectParticipantPhysics(p, r, now));
        livePlayersRef.current = projected;
        liveVersionRef.current += 1;
        const nowPerf = performance.now();
        if (nowPerf - lastHudSyncRef.current >= 240) {
          lastHudSyncRef.current = nowPerf;
          setPlayers(projected);
        }
      }

      // 3. Auto-finish match once every participant in the room has crossed the finish line
      if (
        r.status === 'playing' &&
        rawList.length > 0 &&
        !autoFinishingRef.current &&
        rawList.every((p) => p.finishedAt && p.finishedAt > 0)
      ) {
        autoFinishingRef.current = true;
        finishFirebaseRoom(r.code).catch(() => {
          autoFinishingRef.current = false;
        });
      }
    }, 100);

    return () => window.clearInterval(id);
  }, []);

  async function handleStartMatch() {
    soundEngine.unlock();
    setActionBusy(true);
    setError('');
    try {
      await startFirebaseRoom(roomId, rawParticipantsRef.current.length);
    } catch (err) {
      setError(formatFriendlyFirestoreError(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleFinishMatch() {
    setActionBusy(true);
    setError('');
    try {
      await finishFirebaseRoom(roomId);
    } catch (err) {
      setError(formatFriendlyFirestoreError(err));
    } finally {
      setActionBusy(false);
    }
  }

  async function handleDownloadExcel() {
    if (!room || excelBusy) return;
    setExcelBusy(true);
    setError('');
    try {
      await downloadRoomExcelFromFirebase(room.code);
    } catch (err) {
      setError(formatFriendlyFirestoreError(err));
    } finally {
      setExcelBusy(false);
    }
  }

  function handleCopyCode() {
    if (!room) return;
    navigator.clipboard.writeText(room.code).catch(() => {});
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1800);
  }

  function handleCopyDirectLink() {
    if (!room) return;
    const directUrl = `${window.location.origin}/?join=${encodeURIComponent(room.code)}`;
    navigator.clipboard.writeText(directUrl).catch(() => {});
    setCopiedLink(true);
    window.setTimeout(() => setCopiedLink(false), 2000);
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

  const activeVenue: RaceVenueId = venueOverride ?? room?.settings?.venue ?? 'stadium_day';
  const roomStatus = room?.status ?? 'waiting';
  const totalQuestions = room?.questionCount || 10;
  const totalLaps = room?.totalLaps ?? calcTotalLaps(totalQuestions);

  const audioTelemetry = useMemo(() => {
    if (roomStatus !== 'playing' || players.length === 0) {
      return { hasHighExcitement: false, raceIntensity: 0, heartbeatTension: 0 };
    }
    let leaderProgress = 0;
    let secondProgress = 0;
    let boostingCount = 0;
    let activeCount = 0;

    for (let i = 0; i < players.length; i++) {
      const p = players[i];
      if (!p.finishedAt) activeCount++;
      if (p.effectState === 'boost') boostingCount++;
      if (p.progress >= leaderProgress) {
        secondProgress = leaderProgress;
        leaderProgress = p.progress;
      } else if (p.progress > secondProgress) {
        secondProgress = p.progress;
      }
    }

    const boostRatio = Math.min(1, boostingCount / Math.min(players.length, 6));
    const closeBattle =
      players.length >= 2 && leaderProgress >= 0.35
        ? Math.max(0, 1 - Math.abs(leaderProgress - secondProgress) / 0.08)
        : 0;
    const finalStretch = Math.max(0, (leaderProgress - 0.65) / 0.35);

    const raceIntensity = Math.min(
      1,
      leaderProgress * 0.4 + finalStretch * 0.38 + boostRatio * 0.2 + closeBattle * 0.22
    );

    // Broadcast tension heartbeat during final stretch or close photo-finish duels
    let heartbeatTension = 0;
    if (activeCount > 0) {
      if (leaderProgress >= 0.74) {
        heartbeatTension = Math.max(heartbeatTension, 0.22 + ((leaderProgress - 0.74) / 0.26) * 0.66);
      }
      if (leaderProgress >= 0.58 && closeBattle >= 0.45) {
        heartbeatTension = Math.max(heartbeatTension, closeBattle * 0.55);
      }
    }

    const hasHighExcitement = raceIntensity >= 0.55 || leaderProgress >= 0.8 || boostingCount >= 2;
    return {
      hasHighExcitement,
      raceIntensity,
      heartbeatTension: Math.min(1, heartbeatTension),
    };
  }, [roomStatus, players]);

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

  const sortedByScore = useMemo(
    () => [...players].sort((a, b) => b.score - a.score || b.progress - a.progress),
    [players]
  );

  return (
    <div className="min-h-screen bg-[#081226] text-white flex flex-col">
      {/* Top Bar */}
      <div className="px-4 sm:px-6 py-3.5 bg-[#0F2957] border-b border-blue-400/25 flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-3.5 py-2 rounded-xl bg-[#081226] border border-white/15 text-sm font-semibold hover:bg-blue-900 cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali</span>
          </button>
          <div>
            <div className="text-xs text-[#FACC15] font-semibold">
              MONITOR ROOM GURU · {room?.subject} · Kelas {room?.grade}
              {room
                ? ` · ${room.questionCount} Soal · ${room.totalLaps ?? calcTotalLaps(room.questionCount)} Putaran · ${formatScoreValue(room.pointsPerQuestion ?? calcPointsPerQuestion(room.questionCount))} Poin/Soal`
                : ''}
            </div>
            <h1 className="font-display font-bold text-lg">{room?.name || 'Memuat Room...'}</h1>
          </div>
        </div>

        <div className="flex flex-wrap items-center gap-2.5">
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-[#081226] border border-white/15">
            <button
              onClick={toggleMusic}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                musicEnabled
                  ? 'bg-[#FF6B1A]/20 text-[#FACC15]'
                  : 'text-slate-400 hover:text-white'
              }`}
              title={musicEnabled ? 'Matikan Musik Latar' : 'Aktifkan Musik Latar'}
            >
              <Music className="w-3.5 h-3.5" />
              <span>{musicEnabled ? activeTrackMeta.title : 'Musik OFF'}</span>
            </button>
            <button
              onClick={handleCycleTrack}
              className="p-1.5 rounded-lg hover:bg-white/10 text-blue-200 hover:text-[#FACC15] cursor-pointer"
              title={`Ganti Lagu (Saat ini: ${activeTrackMeta.title} · ${activeTrackMeta.subtitle})`}
            >
              <SkipForward className="w-3.5 h-3.5" />
            </button>
          </div>

          <div className="inline-flex items-center gap-2 px-3 py-2 rounded-xl bg-[#081226] border border-white/15">
            <button
              onClick={toggleMute}
              className="text-white hover:text-[#FACC15] cursor-pointer"
              title={muted ? 'Aktifkan Musik & Suara' : 'Matikan Semua Suara'}
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
              aria-label="Volume Musik Pertandingan"
              className="w-16 accent-[#FF6B1A] cursor-pointer"
            />
          </div>

          {room && (
            <>
              <button
                onClick={handleCopyCode}
                className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#081226] border border-[#FACC15]/50 font-mono font-bold text-sm text-[#FACC15] cursor-pointer"
                title="Salin Kode Room"
              >
                <span>KODE: {room.code}</span>
                {copied ? <Check className="w-4 h-4 text-emerald-400" /> : <Copy className="w-4 h-4" />}
              </button>
              <button
                onClick={handleCopyDirectLink}
                className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-cyan-950/80 hover:bg-cyan-900 border border-cyan-400/40 font-semibold text-xs text-cyan-200 cursor-pointer"
                title="Salin link langsung agar peserta otomatis masuk ke room ini"
              >
                {copiedLink ? <Check className="w-4 h-4 text-emerald-400" /> : <Link2 className="w-4 h-4" />}
                <span>{copiedLink ? 'Link Tersalin!' : 'Link Peserta'}</span>
              </button>
            </>
          )}

          {room?.status === 'waiting' && (
            <button
              onClick={handleStartMatch}
              disabled={actionBusy || players.length === 0}
              className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] disabled:opacity-50 font-display font-bold text-sm text-white cursor-pointer"
            >
              <Play className="w-4 h-4 fill-current" />
              <span>Mulai Pertandingan</span>
            </button>
          )}

          {(room?.status === 'playing' || room?.status === 'countdown') && (
            <button
              onClick={handleFinishMatch}
              disabled={actionBusy}
              className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-500 font-semibold text-sm text-white cursor-pointer"
            >
              <Square className="w-4 h-4 fill-current" />
              <span>Akhiri Pertandingan</span>
            </button>
          )}

          {room?.status === 'finished' && (
            <>
              <button
                onClick={() => onOpenResults(room.id)}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 font-semibold text-sm text-white cursor-pointer"
              >
                <Trophy className="w-4 h-4" />
                <span>Lihat Hasil & Podium</span>
              </button>
              <button
                type="button"
                onClick={handleDownloadExcel}
                disabled={excelBusy}
                className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-60 font-semibold text-sm text-white cursor-pointer"
              >
                <Download className="w-4 h-4" />
                <span>{excelBusy ? 'Menyiapkan Excel...' : 'Download Excel'}</span>
              </button>
            </>
          )}
        </div>
      </div>

      {error && (
        <div className="mx-6 mt-3 p-3 rounded-xl bg-red-950/70 border border-red-400/40 text-sm text-red-200">
          {error}
        </div>
      )}

      {/* Main Split: 3D Broadcast Stadium + Live 30-Player Roster */}
      <div className="flex-1 grid lg:grid-cols-12 min-h-0">
        <div className="lg:col-span-8 relative min-h-[380px]">
          {!room && !error && (
            <div className="absolute inset-0 z-20 flex items-center justify-center bg-[#081226]">
              <Loading3D
                variant="inline"
                size="lg"
                title="Menyiapkan Stadion Monitor 3D..."
                subtitle="Memuat konfigurasi room dan lintasan"
                className="flex-col text-center"
              />
            </div>
          )}
          {room && (
            <StadiumArena3D
              questionCount={room.questionCount}
              maxPlayers={room.settings.maxPlayers}
              players={players}
              livePlayersRef={livePlayersRef}
              liveVersionRef={liveVersionRef}
              roomStatus={room.status}
              roomName={room.name}
              cameraPreset={cameraPreset}
              cameraViewMode={cameraViewMode}
              pipPlacement="bottom-row"
              onSelectCameraPreset={setCameraPreset}
              onChangeCameraViewMode={setCameraViewMode}
              venue={venueOverride ?? room.settings.venue ?? 'stadium_day'}
            />
          )}

          {countdownVal !== null && (
            <StadiumCountdownOverlay value={countdownVal} total={countdownTotal} />
          )}

          <div className="absolute bottom-3 left-3 right-3 z-30 flex flex-wrap items-center justify-between gap-2 pointer-events-none">
            <div className="flex flex-wrap items-center gap-1.5 pointer-events-auto">
              {CAMERA_PRESET_LIST.map((cam) => (
                <button
                  key={cam.id}
                  type="button"
                  onClick={() => {
                    setCameraPreset(cam.id);
                    if (cameraViewMode === 'quad') setCameraViewMode('single');
                  }}
                  className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer ${
                    cameraPreset === cam.id && cameraViewMode !== 'quad'
                      ? 'bg-[#FF6B1A] text-white'
                      : 'bg-[#081226]/92 border border-white/20 text-slate-200 hover:bg-[#0F2957]'
                  }`}
                  title={`${cam.camCode} · ${cam.label}`}
                >
                  <Camera className="w-3.5 h-3.5" />
                  <span className="font-mono text-[11px] opacity-90">{cam.camCode}</span>
                  <span className="hidden sm:inline">{cam.shortLabel}</span>
                </button>
              ))}

              <button
                type="button"
                onClick={() =>
                  setCameraViewMode((prev) =>
                    prev === 'single' ? 'pip' : prev === 'pip' ? 'quad' : 'single'
                  )
                }
                className={`inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg text-xs font-semibold cursor-pointer border ${
                  cameraViewMode !== 'single'
                    ? 'bg-[#1D4ED8] border-blue-400/50 text-white'
                    : 'bg-[#081226]/92 border-white/20 text-slate-200 hover:bg-[#0F2957]'
                }`}
                title="Ubah tampilan Live Preview 4 Kamera (PiP / Grid 2x2 / 1 Layar)"
              >
                <Grid2x2 className="w-3.5 h-3.5 text-[#FACC15]" />
                <span>
                  {cameraViewMode === 'quad'
                    ? 'Grid 2×2'
                    : cameraViewMode === 'pip'
                    ? 'Live 4 Cam'
                    : 'Buka 4 Cam'}
                </span>
              </button>
            </div>

            {room && (
              <div className="inline-flex items-center p-1 rounded-xl bg-[#081226]/92 border border-white/20 pointer-events-auto">
                {RACE_VENUES.map((v) => {
                  const activeVenue = venueOverride ?? room.settings.venue ?? 'stadium_day';
                  const active = activeVenue === v.id;
                  const Icon =
                    v.id === 'stadium_day' ? Sun : v.id === 'stadium_night' ? Moon : Trees;
                  return (
                    <button
                      key={v.id}
                      type="button"
                      onClick={() => setVenueOverride(v.id)}
                      className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-lg text-xs font-semibold cursor-pointer ${
                        active ? 'bg-[#1D4ED8] text-white' : 'text-slate-300 hover:bg-white/10'
                      }`}
                    >
                      <Icon className="w-3.5 h-3.5" />
                      <span>{v.shortLabel}</span>
                    </button>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        <div className="lg:col-span-4 bg-[#0F2957] border-l border-blue-400/25 p-4 flex flex-col max-h-[600px] lg:max-h-none overflow-hidden">
          <div className="flex items-center justify-between pb-3 border-b border-white/10">
            <div className="flex items-center gap-2 font-display font-bold text-base">
              <Users className="w-4 h-4 text-[#FF6B1A]" />
              <span>
                Peserta Bergabung ({players.length}/{room?.settings.maxPlayers || 30})
              </span>
            </div>
            <span className="text-xs font-semibold text-cyan-300">
              {room?.status === 'waiting'
                ? 'Menunggu'
                : room?.status === 'playing'
                ? 'Berlangsung'
                : room?.status === 'countdown'
                ? 'Hitung Mundur'
                : 'Selesai'}
            </span>
          </div>

          <div className="flex-1 overflow-y-auto divide-y divide-white/10 mt-2">
            {sortedByScore.length === 0 ? (
              <div className="py-10 px-4 flex flex-col items-center text-center gap-3">
                <Loading3D
                  variant="inline"
                  size="md"
                  title="Menunggu Peserta Bergabung..."
                  subtitle={`Bagikan kode ${room?.code || '...'} kepada siswa untuk masuk ke garis start.`}
                  className="flex-col text-center"
                />
              </div>
            ) : (
              sortedByScore.map((p, idx) => {
                const cHex = AVATAR_COLORS.find((c) => c.id === p.avatar.color)?.hex || '#2563EB';
                return (
                  <div key={p.id} className="py-2.5 flex items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="font-mono font-bold text-slate-400 w-5">#{idx + 1}</span>
                      <span
                        className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/30"
                        style={{ backgroundColor: cHex }}
                      />
                      <div className="min-w-0">
                        <div className="font-semibold text-white truncate">
                          {p.name}{' '}
                          {!p.connected && <span className="text-[10px] text-rose-300">(Offline)</span>}
                        </div>
                        <div className="text-[11px] text-slate-300">
                          {p.className} · Soal {p.answeredCount}/{room?.questionCount}
                        </div>
                      </div>
                    </div>

                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-[#FACC15] tabular-nums">
                        {formatScoreValue(p.score)} / {room?.maxScore ?? MAX_MATCH_SCORE}
                      </div>
                      <div className="font-mono text-[11px] text-cyan-300 tabular-nums">
                        {Math.round(p.progress * 100)}%
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
