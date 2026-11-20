import { useState, useEffect } from 'react';
import { ArrowLeft, Search, Users, BookOpen, Play, Loader2, CheckCircle2, Sparkles } from 'lucide-react';
import {
  AVATAR_COLORS,
  AVATAR_OUTFITS,
  AVATAR_PRESETS,
  type AvatarConfig,
  type AvatarGender,
  type AvatarOutfitId,
  type AvatarColorId,
} from '../types/game';
import { AvatarPreview3D } from './AvatarPreview3D';
import { AppLogo } from './AppLogo';
import { soundEngine } from '../audio/soundEngine';

export interface JoinedSession {
  roomCode: string;
  participantId: string;
  reconnectToken: string;
  name: string;
  className: string;
  avatar: AvatarConfig;
}

interface RoomPreviewInfo {
  id: string;
  code: string;
  name: string;
  subject: string;
  grade: string;
  teacherName: string;
  schoolName: string;
  status: string;
  questionCount: number;
  participantCount: number;
  settings: {
    maxPlayers: number;
    timePerQuestion: number;
  };
}

interface StudentJoinViewProps {
  initialCode?: string;
  onBack: () => void;
  onJoined: (session: JoinedSession) => void;
}

export function StudentJoinView({ initialCode = '', onBack, onJoined }: StudentJoinViewProps) {
  const [roomCode, setRoomCode] = useState(initialCode.toUpperCase());
  const [roomInfo, setRoomInfo] = useState<RoomPreviewInfo | null>(null);
  const [lookupLoading, setLookupLoading] = useState(false);
  const [lookupError, setLookupError] = useState('');

  const [name, setName] = useState('');
  const [className, setClassName] = useState('');
  const [avatar, setAvatar] = useState<AvatarConfig>({
    gender: 'male',
    color: 'red',
    outfit: 'sprinter',
    presetId: 'cyber_racer',
  });
  const [characterTab, setCharacterTab] = useState<'presets' | 'custom'>('presets');
  const [presetCategory, setPresetCategory] = useState<'all' | 'aksi' | 'streetwear' | 'klasik'>('all');
  const [previewMode, setPreviewMode] = useState<'idle' | 'boost' | 'celebration'>('idle');
  const [joinLoading, setJoinLoading] = useState(false);
  const [joinError, setJoinError] = useState('');

  useEffect(() => {
    if (initialCode.trim().length >= 4) {
      handleLookupRoom(initialCode.trim());
    }
  }, [initialCode]);

  async function handleLookupRoom(codeOverride?: string) {
    const code = (codeOverride ?? roomCode).trim().toUpperCase();
    if (!code) {
      setLookupError('Masukkan kode room dari guru Anda.');
      return;
    }
    setLookupLoading(true);
    setLookupError('');
    try {
      const res = await fetch(`/api/public/rooms/${encodeURIComponent(code)}`);
      const data = await res.json();
      if (!res.ok) {
        setRoomInfo(null);
        setLookupError(data.error || 'Kode room tidak ditemukan.');
      } else {
        setRoomInfo(data.room);
        setRoomCode(data.room.code);
      }
    } catch {
      setLookupError('Gagal terhubung ke server.');
    } finally {
      setLookupLoading(false);
    }
  }

  async function handleJoinSubmit(e: React.FormEvent) {
    e.preventDefault();
    soundEngine.unlock();
    if (!roomInfo) {
      await handleLookupRoom();
      return;
    }
    if (!name.trim() || !className.trim()) {
      setJoinError('Nama lengkap dan kelas wajib diisi.');
      return;
    }

    setJoinLoading(true);
    setJoinError('');

    // Check saved reconnect token in localStorage for same room
    let savedToken: { participantId?: string; reconnectToken?: string } = {};
    try {
      const raw = localStorage.getItem(`edurun_session_${roomInfo.code}`);
      if (raw) savedToken = JSON.parse(raw);
    } catch {
      // ignore storage read error
    }

    try {
      const res = await fetch(`/api/public/rooms/${encodeURIComponent(roomInfo.code)}/join`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name.trim(),
          className: className.trim(),
          avatar,
          participantId: savedToken.participantId,
          reconnectToken: savedToken.reconnectToken,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setJoinError(data.error || 'Gagal masuk ke room.');
        return;
      }

      const session: JoinedSession = {
        roomCode: roomInfo.code,
        participantId: data.participantId,
        reconnectToken: data.reconnectToken,
        name: data.participant.name,
        className: data.participant.className,
        avatar: data.participant.avatar,
      };
      try {
        localStorage.setItem(
          `edurun_session_${roomInfo.code}`,
          JSON.stringify({
            participantId: session.participantId,
            reconnectToken: session.reconnectToken,
          })
        );
      } catch {
        // ignore storage error
      }
      onJoined(session);
    } catch {
      setJoinError('Terjadi gangguan jaringan. Coba lagi.');
    } finally {
      setJoinLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#081226] text-white py-6 px-4 sm:px-8">
      <div className="max-w-6xl mx-auto">
        <div className="flex items-center justify-between gap-4 mb-6">
          <button
            onClick={onBack}
            className="inline-flex items-center gap-2 px-4 py-2 rounded-xl bg-[#0F2957] border border-blue-400/20 text-sm font-semibold hover:bg-blue-900 transition-colors cursor-pointer"
          >
            <ArrowLeft className="w-4 h-4" />
            <span>Kembali</span>
          </button>
          <div className="flex items-center gap-2.5">
            <AppLogo size="sm" />
            <div className="font-display font-bold text-lg sm:text-xl">
              EDU RUN <span className="text-[#FF6B1A]">ARENA 3D</span>
            </div>
          </div>
        </div>

        <div className="grid lg:grid-cols-12 gap-6 items-start">
          {/* Left: Room Code + Identity Form */}
          <div className="lg:col-span-7 space-y-6">
            {/* Step 1: Room Code Lookup */}
            <div className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25">
              <h2 className="font-display font-bold text-xl mb-1">1. Masukkan Kode Room</h2>
              <p className="text-sm text-blue-200/80 mb-4">
                Dapatkan kode room 6 karakter dari guru untuk bergabung ke lintasan pertandingan.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <input
                  type="text"
                  value={roomCode}
                  onChange={(e) => setRoomCode(e.target.value.toUpperCase())}
                  placeholder="Contoh: EDU89K"
                  maxLength={10}
                  className="flex-1 px-4 py-3 rounded-xl bg-[#081226] border border-blue-400/30 font-mono text-lg font-bold tracking-widest uppercase text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF6B1A]"
                />
                <button
                  type="button"
                  onClick={() => handleLookupRoom()}
                  disabled={lookupLoading}
                  className="inline-flex items-center justify-center gap-2 px-6 py-3 rounded-xl bg-[#1D4ED8] hover:bg-blue-600 font-semibold text-white cursor-pointer disabled:opacity-60 whitespace-nowrap shrink-0"
                >
                  {lookupLoading ? <Loader2 className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
                  <span>Cek Room</span>
                </button>
              </div>

              {lookupError && (
                <div className="mt-3 p-3 rounded-xl bg-red-950/60 border border-red-400/40 text-sm text-red-200">
                  {lookupError}
                </div>
              )}

              {roomInfo && (
                <div className="mt-4 p-4 rounded-xl bg-[#081226] border border-emerald-400/40">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="flex items-center gap-2 text-emerald-300 text-xs font-semibold mb-1">
                        <CheckCircle2 className="w-4 h-4" />
                        <span>
                          Room Ditemukan ·{' '}
                          {roomInfo.status === 'waiting'
                            ? 'Menunggu Start'
                            : roomInfo.status === 'countdown'
                            ? 'Hitung Mundur Start'
                            : roomInfo.status === 'playing'
                            ? 'Sedang Berlangsung'
                            : 'Selesai'}
                        </span>
                      </div>
                      <h3 className="font-display font-bold text-lg text-white">{roomInfo.name}</h3>
                      <div className="text-xs text-slate-300 mt-1 flex flex-wrap items-center gap-x-2 gap-y-1">
                        <span>{roomInfo.subject}</span>
                        <span aria-hidden="true">·</span>
                        <span>Kelas {roomInfo.grade}</span>
                        <span aria-hidden="true">·</span>
                        <span>Guru: {roomInfo.teacherName}</span>
                      </div>
                    </div>
                    <div className="text-right shrink-0">
                      <div className="font-mono font-bold text-sm text-[#FACC15] tabular-nums">
                        {roomInfo.participantCount}/{roomInfo.settings.maxPlayers} Peserta
                      </div>
                      <div className="text-xs text-slate-400 tabular-nums">
                        {roomInfo.questionCount} Soal · {roomInfo.settings.timePerQuestion}s/soal
                      </div>
                    </div>
                  </div>
                </div>
              )}
            </div>

            {/* Step 2: Identity & Character Customization */}
            <form onSubmit={handleJoinSubmit} className="p-6 rounded-2xl bg-[#0F2957] border border-blue-400/25 space-y-5">
              <div>
                <h2 className="font-display font-bold text-xl mb-1">2. Identitas & Karakter Atlet</h2>
                <p className="text-sm text-blue-200/80">
                  Nama dan karakter 3D Anda akan tampil di atas pelari selama balapan.
                </p>
              </div>

              <div className="grid sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Nama Lengkap Peserta
                  </label>
                  <input
                    type="text"
                    required
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    placeholder="Contoh: Raka Pratama"
                    maxLength={40}
                    className="w-full px-4 py-3 rounded-xl bg-[#081226] border border-blue-400/30 text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF6B1A]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-blue-200 mb-1.5">
                    Kelas
                  </label>
                  <input
                    type="text"
                    required
                    value={className}
                    onChange={(e) => setClassName(e.target.value)}
                    placeholder="Contoh: VIII-A"
                    maxLength={24}
                    className="w-full px-4 py-3 rounded-xl bg-[#081226] border border-blue-400/30 text-white placeholder:text-slate-500 focus:outline-none focus:border-[#FF6B1A]"
                  />
                </div>
              </div>

              {/* Character Mode Switcher: 19 Special Presets vs Custom Athlete */}
              <div className="space-y-4">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="text-xs font-semibold text-blue-200">
                    Pilih Jenis Karakter 3D
                  </label>
                  <div className="inline-flex rounded-xl bg-[#081226] p-1 border border-white/10">
                    <button
                      type="button"
                      onClick={() => {
                        setCharacterTab('presets');
                        if (!avatar.presetId || avatar.presetId === 'custom') {
                          const first = AVATAR_PRESETS[0];
                          setAvatar((prev) => ({
                            ...prev,
                            presetId: first.id,
                            gender: first.gender,
                            color: first.color,
                          }));
                        }
                      }}
                      className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        characterTab === 'presets'
                          ? 'bg-[#FF6B1A] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      <Sparkles className="w-3.5 h-3.5" />
                      <span>19 Karakter Spesial</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        setCharacterTab('custom');
                        setAvatar((prev) => ({ ...prev, presetId: 'custom' }));
                      }}
                      className={`px-3 py-1.5 rounded-lg text-xs font-semibold cursor-pointer transition-colors ${
                        characterTab === 'custom'
                          ? 'bg-[#1D4ED8] text-white'
                          : 'text-slate-300 hover:text-white'
                      }`}
                    >
                      Kustom Atlet (10 Warna)
                    </button>
                  </div>
                </div>

                {characterTab === 'presets' ? (
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {(
                        [
                          { id: 'all', label: 'Semua (19)' },
                          { id: 'aksi', label: 'Arena & Aksi (5)' },
                          { id: 'streetwear', label: 'Streetwear (9)' },
                          { id: 'klasik', label: 'Klasik Ikonik (5)' },
                        ] as const
                      ).map((cat) => (
                        <button
                          type="button"
                          key={cat.id}
                          onClick={() => setPresetCategory(cat.id)}
                          className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                            presetCategory === cat.id
                              ? 'bg-[#1D4ED8] border-[#FACC15] text-white'
                              : 'bg-[#081226] border-white/10 text-slate-300 hover:border-blue-400/40'
                          }`}
                        >
                          {cat.label}
                        </button>
                      ))}
                    </div>

                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5 max-h-72 overflow-y-auto pr-1">
                      {AVATAR_PRESETS.filter(
                        (p) => presetCategory === 'all' || p.category === presetCategory
                      ).map((preset) => {
                        const active = avatar.presetId === preset.id;
                        return (
                          <button
                            type="button"
                            key={preset.id}
                            onClick={() =>
                              setAvatar((prev) => ({
                                ...prev,
                                presetId: preset.id,
                                gender: preset.gender,
                                color: preset.color,
                              }))
                            }
                            className={`text-left p-2.5 rounded-xl border transition-all cursor-pointer ${
                              active
                                ? 'bg-[#1D4ED8]/85 border-[#FACC15] ring-1 ring-[#FACC15]/50'
                                : 'bg-[#081226] border-white/10 hover:border-blue-400/50'
                            }`}
                          >
                            <div className="flex items-center gap-2 mb-1">
                              <span
                                className="w-3.5 h-3.5 rounded-full shrink-0 border border-white/40"
                                style={{ backgroundColor: preset.accentHex }}
                              />
                              <span className="font-semibold text-xs text-white truncate">
                                {preset.name}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-300/80 line-clamp-2 leading-snug">
                              {preset.desc}
                            </div>
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    {/* Gender Selection */}
                    <div>
                      <label className="block text-xs font-semibold text-blue-200 mb-2">
                        Jenis Kelamin Karakter
                      </label>
                      <div className="grid grid-cols-2 gap-3">
                        {(
                          [
                            { id: 'male', label: 'Laki-laki' },
                            { id: 'female', label: 'Perempuan' },
                          ] as Array<{ id: AvatarGender; label: string }>
                        ).map((g) => (
                          <button
                            type="button"
                            key={g.id}
                            onClick={() =>
                              setAvatar((prev) => ({ ...prev, presetId: 'custom', gender: g.id }))
                            }
                            className={`py-2.5 px-4 rounded-xl border text-sm font-semibold transition-colors cursor-pointer ${
                              avatar.gender === g.id
                                ? 'bg-[#1D4ED8] border-[#FACC15] text-white'
                                : 'bg-[#081226] border-white/15 text-slate-300 hover:border-blue-400/50'
                            }`}
                          >
                            {g.label}
                          </button>
                        ))}
                      </div>
                    </div>

                    {/* 10 Colors */}
                    <div>
                      <label className="block text-xs font-semibold text-blue-200 mb-2">
                        Warna Seragam (10 Pilihan)
                      </label>
                      <div className="grid grid-cols-5 sm:grid-cols-10 gap-2.5">
                        {AVATAR_COLORS.map((c) => {
                          const active = avatar.color === c.id;
                          return (
                            <button
                              type="button"
                              key={c.id}
                              title={c.label}
                              onClick={() =>
                                setAvatar((prev) => ({
                                  ...prev,
                                  presetId: 'custom',
                                  color: c.id as AvatarColorId,
                                }))
                              }
                              className={`flex flex-col items-center gap-1 p-1.5 rounded-xl border transition-transform cursor-pointer ${
                                active
                                  ? 'border-[#FACC15] bg-white/15 scale-105'
                                  : 'border-white/10 bg-[#081226] hover:border-white/30'
                              }`}
                            >
                              <span
                                className="w-6 h-6 rounded-full border border-white/30"
                                style={{ backgroundColor: c.hex }}
                              />
                              <span className="text-[10px] font-medium text-slate-200 truncate w-full text-center">
                                {c.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                    </div>

                    {/* Sportswear Outfit */}
                    <div>
                      <label className="block text-xs font-semibold text-blue-200 mb-2">
                        Pakaian Olahraga
                      </label>
                      <div className="grid sm:grid-cols-2 gap-2.5">
                        {AVATAR_OUTFITS.map((o) => {
                          const active = avatar.outfit === o.id;
                          return (
                            <button
                              type="button"
                              key={o.id}
                              onClick={() =>
                                setAvatar((prev) => ({
                                  ...prev,
                                  presetId: 'custom',
                                  outfit: o.id as AvatarOutfitId,
                                }))
                              }
                              className={`text-left p-3 rounded-xl border transition-colors cursor-pointer ${
                                active
                                  ? 'bg-[#1D4ED8]/80 border-[#FACC15] text-white'
                                  : 'bg-[#081226] border-white/15 text-slate-300 hover:border-blue-400/40'
                              }`}
                            >
                              <div className="font-semibold text-sm">{o.label}</div>
                              <div className="text-xs text-slate-300/80">{o.desc}</div>
                            </button>
                          );
                        })}
                      </div>
                    </div>
                  </div>
                )}
              </div>

              {joinError && (
                <div className="p-3 rounded-xl bg-red-950/60 border border-red-400/40 text-sm text-red-200">
                  {joinError}
                </div>
              )}

              <button
                type="submit"
                disabled={joinLoading || !roomInfo}
                className="w-full py-4 rounded-xl bg-[#FF6B1A] hover:bg-[#e85d10] disabled:opacity-50 font-display font-bold text-lg text-white flex items-center justify-center gap-2.5 shadow-lg cursor-pointer transition-colors"
              >
                {joinLoading ? <Loader2 className="w-5 h-5 animate-spin" /> : <Play className="w-5 h-5 fill-current" />}
                <span>Masuk ke Stadion 3D</span>
              </button>
            </form>
          </div>

          {/* Right: Live 3D Avatar Preview */}
          <div className="lg:col-span-5 lg:sticky lg:top-6">
            <div className="p-5 rounded-2xl bg-[#0F2957] border border-blue-400/25">
              <div className="flex items-center justify-between mb-3">
                <h3 className="font-display font-bold text-lg">Preview Karakter 3D</h3>
                <span className="text-xs text-blue-200/80">Ukuran & Kecepatan Standar Adil</span>
              </div>

              <AvatarPreview3D
                avatar={avatar}
                playerName={name.trim() || 'Atlet Edu Run'}
                mode={previewMode}
                className="w-full h-80 sm:h-96"
              />

              <div className="mt-3 flex items-center justify-center gap-2">
                {(
                  [
                    { id: 'idle', label: 'Diam' },
                    { id: 'boost', label: 'Lari Cepat' },
                    { id: 'celebration', label: 'Selebrasi' },
                  ] as const
                ).map((m) => (
                  <button
                    type="button"
                    key={m.id}
                    onClick={() => setPreviewMode(m.id)}
                    className={`px-3 py-1.5 rounded-lg text-xs font-semibold border cursor-pointer transition-colors ${
                      previewMode === m.id
                        ? 'bg-[#FF6B1A] border-[#FACC15] text-white'
                        : 'bg-[#081226] border-white/15 text-slate-300 hover:text-white'
                    }`}
                  >
                    {m.label}
                  </button>
                ))}
              </div>

              <div className="mt-3 p-3.5 rounded-xl bg-[#081226] border border-white/10 text-xs text-slate-300 flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <Users className="w-4 h-4 text-[#FF6B1A] shrink-0" />
                  <span className="truncate">{name.trim() || 'Nama Peserta'} · {className.trim() || 'Kelas'}</span>
                </div>
                <div className="flex items-center gap-1.5 text-[#FACC15] font-semibold shrink-0">
                  <BookOpen className="w-3.5 h-3.5" />
                  <span>
                    {avatar.presetId && avatar.presetId !== 'custom'
                      ? AVATAR_PRESETS.find((p) => p.id === avatar.presetId)?.name
                      : AVATAR_OUTFITS.find((o) => o.id === avatar.outfit)?.label}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
