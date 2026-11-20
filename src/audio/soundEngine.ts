import type { RaceVenueId } from '../types/game';

export type CrowdMood = 'idle' | 'waiting' | 'countdown' | 'playing' | 'excited' | 'victory';
export type RaceMusicTrackId = 'semangat_juara' | 'lari_ceria' | 'turbo_arena';

export interface RaceMusicTrackMeta {
  id: RaceMusicTrackId;
  title: string;
  subtitle: string;
  bpm: number;
}

export const RACE_MUSIC_TRACKS: RaceMusicTrackMeta[] = [
  {
    id: 'semangat_juara',
    title: 'Semangat Juara',
    subtitle: 'Pop Ceria · 126 BPM',
    bpm: 126,
  },
  {
    id: 'lari_ceria',
    title: 'Lari Ceria',
    subtitle: 'Marimba Riang · 132 BPM',
    bpm: 132,
  },
  {
    id: 'turbo_arena',
    title: 'Turbo Arena',
    subtitle: 'Energi Sprint · 138 BPM',
    bpm: 138,
  },
];

interface ChordBar {
  bar: number;
  notes: number[];
  bass: number;
}

interface MelodyNote {
  step: number; // 16th-note index
  dur: number;  // duration in 16th-note steps
  freq: number;
  vel: number;
}

interface RaceTrackSong {
  id: RaceMusicTrackId;
  bpm: number;
  totalSteps: number; // 128 steps = 8 bars of 16th notes
  leadTimbre: 'pluck' | 'marimba' | 'synth';
  chords: ChordBar[];
  melody: MelodyNote[];
  bassPattern: number[]; // step-in-bar triggers (0..15)
}

// Musical note frequency helpers (Hz)
const N = {
  C2: 65.41, D2: 73.42, E2: 82.41, F2: 87.31, G2: 98.0, A2: 110.0, Bb2: 116.54, B2: 123.47,
  C3: 130.81, D3: 146.83, E3: 164.81, F3: 174.61, Fs3: 185.0, G3: 196.0, A3: 220.0, Bb3: 233.08, B3: 246.94,
  C4: 261.63, D4: 293.66, E4: 329.63, F4: 349.23, Fs4: 369.99, G4: 392.0, A4: 440.0, Bb4: 466.16, B4: 493.88,
  C5: 523.25, D5: 587.33, E5: 659.25, F5: 698.46, Fs5: 739.99, G5: 783.99, A5: 880.0, Bb5: 932.33, B5: 987.77,
  C6: 1046.5, D6: 1174.66, E6: 1318.51, F6: 1396.91, G6: 1567.98,
} as const;

// ==================== 3 JOYFUL, ENERGETIC RACE SOUNDTRACKS ====================

const TRACK_SEMANGAT_JUARA: RaceTrackSong = {
  id: 'semangat_juara',
  bpm: 126,
  totalSteps: 128,
  leadTimbre: 'pluck',
  bassPattern: [0, 3, 6, 8, 10, 14],
  chords: [
    // Section A: C - G - Am - F (bright uplifting pop-arcade progression)
    { bar: 0, notes: [N.C4, N.E4, N.G4], bass: N.C3 },
    { bar: 1, notes: [N.B3, N.D4, N.G4], bass: N.G2 },
    { bar: 2, notes: [N.C4, N.E4, N.A4], bass: N.A2 },
    { bar: 3, notes: [N.C4, N.F4, N.A4], bass: N.F2 },
    // Section B: F - C - Dm - G (joyful turnaround)
    { bar: 4, notes: [N.C4, N.F4, N.A4], bass: N.F2 },
    { bar: 5, notes: [N.C4, N.E4, N.G4], bass: N.C3 },
    { bar: 6, notes: [N.D4, N.F4, N.A4], bass: N.D3 },
    { bar: 7, notes: [N.D4, N.G4, N.B4], bass: N.G2 },
  ],
  melody: [
    // Bar 0 (C)
    { step: 0, dur: 2, freq: N.E5, vel: 0.95 },
    { step: 2, dur: 2, freq: N.G5, vel: 0.92 },
    { step: 4, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 6, dur: 2, freq: N.G5, vel: 0.85 },
    { step: 8, dur: 2, freq: N.A5, vel: 0.95 },
    { step: 10, dur: 2, freq: N.G5, vel: 0.86 },
    { step: 12, dur: 4, freq: N.E5, vel: 0.9 },
    // Bar 1 (G)
    { step: 16, dur: 2, freq: N.D5, vel: 0.9 },
    { step: 18, dur: 2, freq: N.G5, vel: 0.95 },
    { step: 20, dur: 2, freq: N.B5, vel: 1.0 },
    { step: 22, dur: 2, freq: N.A5, vel: 0.88 },
    { step: 24, dur: 4, freq: N.G5, vel: 0.95 },
    { step: 28, dur: 2, freq: N.D5, vel: 0.82 },
    { step: 30, dur: 2, freq: N.E5, vel: 0.86 },
    // Bar 2 (Am)
    { step: 32, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 34, dur: 2, freq: N.G5, vel: 0.88 },
    { step: 36, dur: 2, freq: N.E5, vel: 0.92 },
    { step: 38, dur: 2, freq: N.C5, vel: 0.86 },
    { step: 40, dur: 2, freq: N.E5, vel: 0.94 },
    { step: 42, dur: 2, freq: N.G5, vel: 0.94 },
    { step: 44, dur: 4, freq: N.A5, vel: 0.98 },
    // Bar 3 (F)
    { step: 48, dur: 2, freq: N.A5, vel: 0.95 },
    { step: 50, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 52, dur: 2, freq: N.A5, vel: 0.9 },
    { step: 54, dur: 2, freq: N.F5, vel: 0.88 },
    { step: 56, dur: 4, freq: N.G5, vel: 0.92 },
    { step: 60, dur: 4, freq: N.F5, vel: 0.86 },
    // Bar 4 (F)
    { step: 64, dur: 2, freq: N.F5, vel: 0.94 },
    { step: 66, dur: 2, freq: N.A5, vel: 0.95 },
    { step: 68, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 70, dur: 2, freq: N.A5, vel: 0.88 },
    { step: 72, dur: 2, freq: N.G5, vel: 0.92 },
    { step: 74, dur: 2, freq: N.A5, vel: 0.9 },
    { step: 76, dur: 4, freq: N.F5, vel: 0.88 },
    // Bar 5 (C)
    { step: 80, dur: 2, freq: N.E5, vel: 0.92 },
    { step: 82, dur: 2, freq: N.G5, vel: 0.95 },
    { step: 84, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 86, dur: 2, freq: N.E6, vel: 1.0 },
    { step: 88, dur: 4, freq: N.D6, vel: 0.96 },
    { step: 92, dur: 4, freq: N.C6, vel: 0.95 },
    // Bar 6 (Dm)
    { step: 96, dur: 2, freq: N.A5, vel: 0.94 },
    { step: 98, dur: 2, freq: N.F5, vel: 0.88 },
    { step: 100, dur: 2, freq: N.D5, vel: 0.88 },
    { step: 102, dur: 2, freq: N.F5, vel: 0.9 },
    { step: 104, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 106, dur: 2, freq: N.G5, vel: 0.92 },
    { step: 108, dur: 4, freq: N.F5, vel: 0.9 },
    // Bar 7 (G -> C)
    { step: 112, dur: 2, freq: N.G5, vel: 0.95 },
    { step: 114, dur: 2, freq: N.A5, vel: 0.92 },
    { step: 116, dur: 2, freq: N.B5, vel: 0.98 },
    { step: 118, dur: 2, freq: N.G5, vel: 0.9 },
    { step: 120, dur: 2, freq: N.D6, vel: 1.0 },
    { step: 122, dur: 2, freq: N.B5, vel: 0.94 },
    { step: 124, dur: 4, freq: N.G5, vel: 0.92 },
  ],
};

const TRACK_LARI_CERIA: RaceTrackSong = {
  id: 'lari_ceria',
  bpm: 132,
  totalSteps: 128,
  leadTimbre: 'marimba',
  bassPattern: [0, 3, 6, 8, 11, 14],
  chords: [
    // Sunny F major tropical-bounce progression: F - C - Dm - Bb | Gm - C - F - C
    { bar: 0, notes: [N.F4, N.A4, N.C5], bass: N.F2 },
    { bar: 1, notes: [N.E4, N.G4, N.C5], bass: N.C3 },
    { bar: 2, notes: [N.D4, N.F4, N.A4], bass: N.D3 },
    { bar: 3, notes: [N.D4, N.F4, N.Bb4], bass: N.Bb2 },
    { bar: 4, notes: [N.D4, N.G4, N.Bb4], bass: N.G2 },
    { bar: 5, notes: [N.E4, N.G4, N.C5], bass: N.C3 },
    { bar: 6, notes: [N.F4, N.A4, N.C5], bass: N.F2 },
    { bar: 7, notes: [N.E4, N.G4, N.C5], bass: N.C3 },
  ],
  melody: [
    // Bar 0 (F)
    { step: 0, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 3, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 6, dur: 2, freq: N.A5, vel: 0.9 },
    { step: 8, dur: 2, freq: N.F5, vel: 0.88 },
    { step: 10, dur: 2, freq: N.G5, vel: 0.9 },
    { step: 12, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 14, dur: 2, freq: N.C6, vel: 0.94 },
    // Bar 1 (C)
    { step: 16, dur: 2, freq: N.G5, vel: 0.95 },
    { step: 19, dur: 2, freq: N.E5, vel: 0.88 },
    { step: 22, dur: 2, freq: N.G5, vel: 0.92 },
    { step: 24, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 26, dur: 2, freq: N.Bb5, vel: 0.92 },
    { step: 28, dur: 4, freq: N.G5, vel: 0.92 },
    // Bar 2 (Dm)
    { step: 32, dur: 2, freq: N.F5, vel: 0.94 },
    { step: 35, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 38, dur: 2, freq: N.D6, vel: 1.0 },
    { step: 40, dur: 2, freq: N.C6, vel: 0.92 },
    { step: 42, dur: 2, freq: N.A5, vel: 0.9 },
    { step: 44, dur: 4, freq: N.F5, vel: 0.88 },
    // Bar 3 (Bb)
    { step: 48, dur: 2, freq: N.Bb5, vel: 0.96 },
    { step: 50, dur: 2, freq: N.A5, vel: 0.9 },
    { step: 52, dur: 2, freq: N.G5, vel: 0.92 },
    { step: 54, dur: 2, freq: N.F5, vel: 0.88 },
    { step: 56, dur: 4, freq: N.D5, vel: 0.9 },
    { step: 60, dur: 2, freq: N.F5, vel: 0.9 },
    { step: 62, dur: 2, freq: N.G5, vel: 0.92 },
    // Bar 4 (Gm)
    { step: 64, dur: 2, freq: N.G5, vel: 0.95 },
    { step: 67, dur: 2, freq: N.Bb5, vel: 0.98 },
    { step: 70, dur: 2, freq: N.D6, vel: 1.0 },
    { step: 72, dur: 2, freq: N.Bb5, vel: 0.92 },
    { step: 74, dur: 2, freq: N.A5, vel: 0.9 },
    { step: 76, dur: 4, freq: N.G5, vel: 0.9 },
    // Bar 5 (C)
    { step: 80, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 82, dur: 2, freq: N.Bb5, vel: 0.92 },
    { step: 84, dur: 2, freq: N.A5, vel: 0.92 },
    { step: 86, dur: 2, freq: N.G5, vel: 0.94 },
    { step: 88, dur: 2, freq: N.E5, vel: 0.9 },
    { step: 90, dur: 2, freq: N.G5, vel: 0.94 },
    { step: 92, dur: 4, freq: N.C6, vel: 0.98 },
    // Bar 6 (F)
    { step: 96, dur: 2, freq: N.F6, vel: 1.0 },
    { step: 98, dur: 2, freq: N.E6, vel: 0.94 },
    { step: 100, dur: 2, freq: N.D6, vel: 0.94 },
    { step: 102, dur: 2, freq: N.C6, vel: 0.96 },
    { step: 104, dur: 2, freq: N.A5, vel: 0.94 },
    { step: 106, dur: 2, freq: N.C6, vel: 0.96 },
    { step: 108, dur: 4, freq: N.A5, vel: 0.92 },
    // Bar 7 (C -> F)
    { step: 112, dur: 2, freq: N.G5, vel: 0.95 },
    { step: 114, dur: 2, freq: N.A5, vel: 0.94 },
    { step: 116, dur: 2, freq: N.Bb5, vel: 0.96 },
    { step: 118, dur: 2, freq: N.C6, vel: 1.0 },
    { step: 120, dur: 2, freq: N.A5, vel: 0.92 },
    { step: 122, dur: 2, freq: N.G5, vel: 0.92 },
    { step: 124, dur: 4, freq: N.C6, vel: 0.96 },
  ],
};

const TRACK_TURBO_ARENA: RaceTrackSong = {
  id: 'turbo_arena',
  bpm: 138,
  totalSteps: 128,
  leadTimbre: 'synth',
  bassPattern: [0, 2, 4, 6, 8, 10, 12, 14],
  chords: [
    // Energetic G major arcade-racing theme: G - D - Em - C | Am - D - G - D
    { bar: 0, notes: [N.G4, N.B4, N.D5], bass: N.G2 },
    { bar: 1, notes: [N.Fs4, N.A4, N.D5], bass: N.D3 },
    { bar: 2, notes: [N.G4, N.B4, N.E5], bass: N.E2 },
    { bar: 3, notes: [N.E4, N.G4, N.C5], bass: N.C3 },
    { bar: 4, notes: [N.E4, N.A4, N.C5], bass: N.A2 },
    { bar: 5, notes: [N.Fs4, N.A4, N.D5], bass: N.D3 },
    { bar: 6, notes: [N.G4, N.B4, N.D5], bass: N.G2 },
    { bar: 7, notes: [N.Fs4, N.A4, N.D5], bass: N.D3 },
  ],
  melody: [
    // Bar 0 (G)
    { step: 0, dur: 2, freq: N.G5, vel: 1.0 },
    { step: 2, dur: 2, freq: N.B5, vel: 0.96 },
    { step: 4, dur: 2, freq: N.D6, vel: 1.0 },
    { step: 6, dur: 2, freq: N.B5, vel: 0.9 },
    { step: 8, dur: 4, freq: N.G5, vel: 0.95 },
    { step: 12, dur: 2, freq: N.A5, vel: 0.92 },
    { step: 14, dur: 2, freq: N.B5, vel: 0.95 },
    // Bar 1 (D)
    { step: 16, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 18, dur: 2, freq: N.Fs5, vel: 0.9 },
    { step: 20, dur: 2, freq: N.D5, vel: 0.9 },
    { step: 22, dur: 2, freq: N.Fs5, vel: 0.92 },
    { step: 24, dur: 4, freq: N.A5, vel: 0.98 },
    { step: 28, dur: 4, freq: N.D6, vel: 1.0 },
    // Bar 2 (Em)
    { step: 32, dur: 2, freq: N.E6, vel: 1.0 },
    { step: 34, dur: 2, freq: N.D6, vel: 0.94 },
    { step: 36, dur: 2, freq: N.B5, vel: 0.96 },
    { step: 38, dur: 2, freq: N.G5, vel: 0.9 },
    { step: 40, dur: 2, freq: N.B5, vel: 0.95 },
    { step: 42, dur: 2, freq: N.D6, vel: 0.98 },
    { step: 44, dur: 4, freq: N.E6, vel: 1.0 },
    // Bar 3 (C)
    { step: 48, dur: 2, freq: N.C6, vel: 0.98 },
    { step: 50, dur: 2, freq: N.B5, vel: 0.92 },
    { step: 52, dur: 2, freq: N.G5, vel: 0.94 },
    { step: 54, dur: 2, freq: N.E5, vel: 0.9 },
    { step: 56, dur: 4, freq: N.G5, vel: 0.96 },
    { step: 60, dur: 4, freq: N.C6, vel: 0.98 },
    // Bar 4 (Am)
    { step: 64, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 66, dur: 2, freq: N.C6, vel: 0.98 },
    { step: 68, dur: 2, freq: N.E6, vel: 1.0 },
    { step: 70, dur: 2, freq: N.C6, vel: 0.92 },
    { step: 72, dur: 4, freq: N.A5, vel: 0.94 },
    { step: 76, dur: 2, freq: N.B5, vel: 0.92 },
    { step: 78, dur: 2, freq: N.C6, vel: 0.96 },
    // Bar 5 (D)
    { step: 80, dur: 2, freq: N.D6, vel: 1.0 },
    { step: 82, dur: 2, freq: N.C6, vel: 0.92 },
    { step: 84, dur: 2, freq: N.A5, vel: 0.94 },
    { step: 86, dur: 2, freq: N.Fs5, vel: 0.9 },
    { step: 88, dur: 4, freq: N.A5, vel: 0.96 },
    { step: 92, dur: 4, freq: N.D6, vel: 1.0 },
    // Bar 6 (G)
    { step: 96, dur: 2, freq: N.G6, vel: 1.0 },
    { step: 98, dur: 2, freq: N.E6, vel: 0.95 },
    { step: 100, dur: 2, freq: N.D6, vel: 0.96 },
    { step: 102, dur: 2, freq: N.B5, vel: 0.94 },
    { step: 104, dur: 2, freq: N.G5, vel: 0.92 },
    { step: 106, dur: 2, freq: N.B5, vel: 0.96 },
    { step: 108, dur: 4, freq: N.D6, vel: 1.0 },
    // Bar 7 (D -> G)
    { step: 112, dur: 2, freq: N.D6, vel: 0.98 },
    { step: 114, dur: 2, freq: N.C6, vel: 0.94 },
    { step: 116, dur: 2, freq: N.B5, vel: 0.96 },
    { step: 118, dur: 2, freq: N.A5, vel: 0.94 },
    { step: 120, dur: 2, freq: N.Fs5, vel: 0.92 },
    { step: 122, dur: 2, freq: N.A5, vel: 0.96 },
    { step: 124, dur: 4, freq: N.D6, vel: 1.0 },
  ],
};

const TRACK_MAP: Record<RaceMusicTrackId, RaceTrackSong> = {
  semangat_juara: TRACK_SEMANGAT_JUARA,
  lari_ceria: TRACK_LARI_CERIA,
  turbo_arena: TRACK_TURBO_ARENA,
};

// 4-bar heroic championship victory anthem in C major (118 BPM)
const VICTORY_TEMPO_BPM = 118;
const VICTORY_STEP_SEC = 60 / VICTORY_TEMPO_BPM / 4;
const VICTORY_TOTAL_STEPS = 64;

const VICTORY_CHORDS: ChordBar[] = [
  { bar: 0, notes: [N.C4, N.E4, N.G4, N.C5], bass: N.C3 },
  { bar: 1, notes: [N.D4, N.G4, N.B4, N.D5], bass: N.G3 },
  { bar: 2, notes: [N.C4, N.F4, N.A4, N.C5], bass: N.F3 },
  { bar: 3, notes: [N.D4, N.G4, N.B4, N.D5], bass: N.G3 },
];

const VICTORY_MELODY: MelodyNote[] = [
  { step: 0, dur: 3, freq: N.C5, vel: 0.95 },
  { step: 3, dur: 1, freq: N.C5, vel: 0.72 },
  { step: 4, dur: 4, freq: N.E5, vel: 1.0 },
  { step: 8, dur: 4, freq: N.G5, vel: 1.0 },
  { step: 12, dur: 4, freq: N.C6, vel: 1.0 },
  { step: 16, dur: 6, freq: N.B5, vel: 0.95 },
  { step: 22, dur: 2, freq: N.A5, vel: 0.8 },
  { step: 24, dur: 4, freq: N.G5, vel: 0.92 },
  { step: 28, dur: 4, freq: N.D5, vel: 0.85 },
  { step: 32, dur: 3, freq: N.F5, vel: 0.95 },
  { step: 35, dur: 1, freq: N.G5, vel: 0.78 },
  { step: 36, dur: 4, freq: N.A5, vel: 1.0 },
  { step: 40, dur: 4, freq: N.C6, vel: 1.0 },
  { step: 44, dur: 4, freq: N.A5, vel: 0.88 },
  { step: 48, dur: 6, freq: N.G5, vel: 0.96 },
  { step: 54, dur: 2, freq: N.A5, vel: 0.82 },
  { step: 56, dur: 4, freq: N.B5, vel: 0.98 },
  { step: 60, dur: 4, freq: N.C6, vel: 1.0 },
];

const MUSIC_MOOD_GAIN: Record<CrowdMood, number> = {
  idle: 0.0,
  waiting: 0.30,
  countdown: 0.16,
  playing: 0.44,
  excited: 0.50,
  victory: 0.0, // crossfades cleanly to Victory Anthem
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private stadiumReverb: ConvolverNode | null = null;
  private reverbReturn: GainNode | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pistolShaperCurve: Float32Array<ArrayBuffer> | null = null;

  // Energetic Race Background Music Sequencer State
  private musicBus: GainNode | null = null;
  private musicTimerId: number | null = null;
  private musicActive = false;
  private desiredMusicActive = false;
  private desiredMood: CrowdMood = 'waiting';
  private desiredVenue: RaceVenueId = 'stadium_day';
  private raceIntensity = 0; // 0..1 continuous excitement boost
  private musicNextStepTime = 0;
  private musicStepIndex = 0;
  private _musicEnabled = true;
  private _trackId: RaceMusicTrackId = 'semangat_juara';

  // Dynamic race-tension heartbeat (subtle lub-dub during final seconds)
  private heartbeatTension = 0; // 0..1
  private heartbeatTimerId: number | null = null;
  private nextHeartbeatAt = 0;

  // Victory Anthem Sequencer State
  private victoryGain: GainNode | null = null;
  private victoryTimerId: number | null = null;
  private victoryActive = false;
  private desiredVictoryMusic = false;
  private victoryNextStepTime = 0;
  private victoryStepIndex = 0;

  private _muted = false;
  private _volume = 0.78;
  private gestureHookInstalled = false;
  private lastMedalChimeAt = 0;

  constructor() {
    this.installGestureUnlock();
  }

  private installGestureUnlock() {
    if (typeof window === 'undefined' || this.gestureHookInstalled) return;
    this.gestureHookInstalled = true;
    const handleGesture = () => {
      if (
        !this._muted &&
        (this.desiredMusicActive ||
          this.desiredVictoryMusic ||
          this.heartbeatTension > 0.08 ||
          this.ctx?.state === 'suspended')
      ) {
        this.unlock();
      }
    };
    window.addEventListener('pointerdown', handleGesture, { passive: true });
    window.addEventListener('keydown', handleGesture, { passive: true });
  }

  public get muted(): boolean {
    return this._muted;
  }

  public set muted(value: boolean) {
    this._muted = value;
    this.syncMasterGain();
    if (!value) {
      this.unlock();
    }
  }

  public get volume(): number {
    return this._volume;
  }

  public set volume(value: number) {
    this._volume = Math.max(0, Math.min(1, value));
    this.syncMasterGain();
  }

  public get musicEnabled(): boolean {
    return this._musicEnabled;
  }

  public set musicEnabled(value: boolean) {
    this._musicEnabled = value;
    this.syncMusicBusGain();
    this.syncVictoryBusGain();
    if (value && !this._muted) {
      this.unlock();
    }
  }

  public get trackId(): RaceMusicTrackId {
    return this._trackId;
  }

  public setMusicTrack(trackId: RaceMusicTrackId) {
    if (!(trackId in TRACK_MAP)) return;
    this._trackId = trackId;
    this.musicStepIndex = 0;
    if (this.ctx) {
      this.musicNextStepTime = this.ctx.currentTime + 0.05;
    }
  }

  public cycleMusicTrack(): RaceMusicTrackId {
    const idx = RACE_MUSIC_TRACKS.findIndex((t) => t.id === this._trackId);
    const next = RACE_MUSIC_TRACKS[(idx + 1) % RACE_MUSIC_TRACKS.length];
    this.setMusicTrack(next.id);
    if (!this._musicEnabled) {
      this.musicEnabled = true;
    }
    this.unlock();
    return next.id;
  }

  private syncMasterGain() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this._muted ? 0 : this._volume;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.035);
  }

  private syncMusicBusGain() {
    if (!this.ctx || !this.musicBus) return;
    const now = this.ctx.currentTime;
    const base = MUSIC_MOOD_GAIN[this.desiredMood] ?? 0.35;
    const intensityLift =
      this.desiredMood === 'playing' || this.desiredMood === 'excited'
        ? 1 + this.raceIntensity * 0.14
        : 1.0;
    const target =
      !this._musicEnabled || this.desiredVictoryMusic || this.desiredMood === 'victory'
        ? 0.0001
        : Math.min(0.62, base * intensityLift);

    this.musicBus.gain.cancelScheduledValues(now);
    this.musicBus.gain.setTargetAtTime(target, now, 0.18);
  }

  private syncVictoryBusGain() {
    if (!this.ctx || !this.victoryGain) return;
    const now = this.ctx.currentTime;
    const target = this._musicEnabled ? 0.56 : 0.0001;
    this.victoryGain.gain.cancelScheduledValues(now);
    this.victoryGain.gain.setTargetAtTime(target, now, 0.14);
  }

  private ensureContext(): AudioContext | null {
    if (typeof window === 'undefined') return null;

    if (!this.ctx) {
      const AudioCtx =
        window.AudioContext ||
        (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!AudioCtx) return null;

      const ctx = new AudioCtx();
      this.ctx = ctx;

      const compressor = ctx.createDynamicsCompressor();
      compressor.threshold.setValueAtTime(-14, ctx.currentTime);
      compressor.knee.setValueAtTime(16, ctx.currentTime);
      compressor.ratio.setValueAtTime(3.6, ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, ctx.currentTime);
      compressor.release.setValueAtTime(0.18, ctx.currentTime);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this._muted ? 0 : this._volume, ctx.currentTime);

      masterGain.connect(compressor);
      compressor.connect(ctx.destination);

      // Warm concert/arena reverb for musical depth (no crowd noise)
      const reverb = ctx.createConvolver();
      reverb.buffer = this.createArenaImpulseBuffer(ctx, 1.4, 3.0);

      const reverbReturn = ctx.createGain();
      reverbReturn.gain.setValueAtTime(
        this.desiredVenue === 'open_field' ? 0.16 : 0.3,
        ctx.currentTime
      );
      reverb.connect(reverbReturn);
      reverbReturn.connect(masterGain);

      this.compressor = compressor;
      this.masterGain = masterGain;
      this.stadiumReverb = reverb;
      this.reverbReturn = reverbReturn;
      this.whiteNoiseBuffer = this.createWhiteNoiseBuffer(ctx, 2.0);
      this.pistolShaperCurve = this.createSoftClipCurve(22);
    }

    if (this.ctx.state === 'suspended') {
      this.ctx.resume().catch(() => {});
    }

    return this.ctx;
  }

  public unlock() {
    const ctx = this.ensureContext();
    if (!ctx) return;

    const onRunning = () => {
      this.syncMasterGain();
      if (this.desiredMusicActive && !this.musicActive && !this.desiredVictoryMusic) {
        this.beginRaceMusicSequencer(ctx);
      }
      if (this.desiredVictoryMusic && !this.victoryActive) {
        this.beginVictorySequencer(ctx);
      }
      if (this.heartbeatTension > 0.08 && this.heartbeatTimerId === null) {
        this.startHeartbeatScheduler(ctx);
      }
    };

    if (ctx.state === 'running') {
      onRunning();
    } else {
      ctx
        .resume()
        .then(onRunning)
        .catch(() => {});
    }
  }

  private createArenaImpulseBuffer(
    ctx: AudioContext,
    durationSec: number,
    decay: number
  ): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, decay);
        const white = Math.random() * 2 - 1;
        lp = lp * 0.62 + white * 0.38;
        data[i] = lp * env * 0.55;
      }
    }
    return buffer;
  }

  private createWhiteNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(1, length, ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i++) {
      data[i] = Math.random() * 2 - 1;
    }
    return buffer;
  }

  private createSoftClipCurve(drive: number): Float32Array<ArrayBuffer> {
    const samples = 1024;
    const curve = new Float32Array(new ArrayBuffer(samples * 4));
    for (let i = 0; i < samples; i++) {
      const x = (i * 2) / samples - 1;
      curve[i] = Math.tanh(x * drive);
    }
    return curve;
  }

  // ==================== 1. JOYFUL UPBEAT RACE MUSIC ENGINE ====================

  public setVenue(venue: RaceVenueId) {
    this.desiredVenue = venue;
    if (!this.ctx || !this.reverbReturn) return;
    const isOpen = venue === 'open_field';
    this.reverbReturn.gain.setTargetAtTime(isOpen ? 0.14 : 0.3, this.ctx.currentTime, 0.25);
  }

  public startRaceMusic(mood: CrowdMood = 'waiting', venue?: RaceVenueId) {
    this.desiredMusicActive = true;
    this.desiredMood = mood;
    if (venue) this.desiredVenue = venue;

    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'running') {
      if (!this.musicActive && mood !== 'victory') {
        this.beginRaceMusicSequencer(ctx);
      } else {
        this.syncMusicBusGain();
      }
    }
  }

  public setMusicMood(mood: CrowdMood) {
    this.desiredMood = mood;
    if (mood === 'victory') {
      this.stopRaceMusic(false);
      return;
    }
    if (this.desiredMusicActive && !this.musicActive && this.ctx?.state === 'running') {
      this.beginRaceMusicSequencer(this.ctx);
    } else {
      this.syncMusicBusGain();
    }
  }

  public stopRaceMusic(clearDesired = true) {
    if (clearDesired) {
      this.desiredMusicActive = false;
    }
    this.musicActive = false;

    if (this.musicTimerId !== null) {
      window.clearInterval(this.musicTimerId);
      this.musicTimerId = null;
    }

    const bus = this.musicBus;
    this.musicBus = null;
    if (bus && this.ctx) {
      const now = this.ctx.currentTime;
      bus.gain.cancelScheduledValues(now);
      bus.gain.setValueAtTime(Math.max(0.0001, bus.gain.value), now);
      bus.gain.linearRampToValueAtTime(0.0001, now + 0.32);
      window.setTimeout(() => {
        try {
          bus.disconnect();
        } catch {
          // ignore
        }
      }, 380);
    }
  }

  // Backward-compatible aliases (no stadium crowd rumble — plays upbeat race music instead!)
  public startAmbientCrowd(mood: CrowdMood = 'waiting', venue?: RaceVenueId) {
    this.startRaceMusic(mood, venue);
  }

  public setCrowdMood(mood: CrowdMood) {
    this.setMusicMood(mood);
  }

  public stopAmbientCrowd() {
    this.stopRaceMusic(true);
  }

  public triggerCrowdSwell(_intensity = 0.65, _durationSec = 2.0) {
    // Crowd roar removed per user request — play a subtle joyful chime accent instead!
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted || ctx.state !== 'running') return;
    const now = ctx.currentTime;
    const sparkle = [783.99, 1046.5, 1318.51];
    sparkle.forEach((f, idx) => {
      this.scheduleBellSparkle(ctx, this.masterGain!, f, now + idx * 0.045, 0.045);
    });
  }

  public setRaceIntensity(
    intensity: number,
    options?: { heartbeatTension?: number; allowAutoSwell?: boolean }
  ) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0));
    this.raceIntensity = clamped;
    this.syncMusicBusGain();

    if (typeof options?.heartbeatTension === 'number') {
      this.setHeartbeatTension(options.heartbeatTension);
    }
  }

  private beginRaceMusicSequencer(ctx: AudioContext) {
    if (!this.masterGain || this.musicActive) return;
    this.musicActive = true;

    const now = ctx.currentTime;
    const bus = ctx.createGain();
    bus.gain.setValueAtTime(0.0001, now);
    bus.connect(this.masterGain);

    if (this.stadiumReverb) {
      const revSend = ctx.createGain();
      revSend.gain.setValueAtTime(0.24, now);
      bus.connect(revSend);
      revSend.connect(this.stadiumReverb);
    }

    this.musicBus = bus;
    this.syncMusicBusGain();

    this.musicNextStepTime = now + 0.05;

    const scheduleAheadSec = 0.24;
    const tickScheduler = () => {
      if (!this.musicActive || !this.ctx || !this.musicBus) return;
      if (this.ctx.state !== 'running') return;

      const song = TRACK_MAP[this._trackId];
      // Gentle tempo lift (+4.5%) when race enters high-excitement final stretch
      const tempoScale =
        this.desiredMood === 'excited'
          ? 1.045
          : this.desiredMood === 'playing'
          ? 1 + this.raceIntensity * 0.035
          : this.desiredMood === 'waiting'
          ? 0.94
          : 1.0;
      const stepSec = 60 / (song.bpm * tempoScale) / 4;

      if (this.musicNextStepTime < this.ctx.currentTime - 0.15) {
        this.musicNextStepTime = this.ctx.currentTime + 0.03;
      }

      while (this.musicNextStepTime < this.ctx.currentTime + scheduleAheadSec) {
        if (!this._muted && this._musicEnabled && this.desiredMood !== 'victory') {
          this.scheduleRaceMusicStep(
            this.ctx,
            this.musicBus,
            song,
            this.musicStepIndex,
            this.musicNextStepTime,
            stepSec
          );
        }
        this.musicNextStepTime += stepSec;
        this.musicStepIndex = (this.musicStepIndex + 1) % song.totalSteps;
      }
    };

    tickScheduler();
    this.musicTimerId = window.setInterval(tickScheduler, 50);
  }

  private scheduleRaceMusicStep(
    ctx: AudioContext,
    dest: GainNode,
    song: RaceTrackSong,
    step: number,
    time: number,
    stepSec: number
  ) {
    const barIdx = Math.floor(step / 16) % song.chords.length;
    const stepInBar = step % 16;
    const chord = song.chords[barIdx];
    const isPlaying = this.desiredMood === 'playing' || this.desiredMood === 'excited';
    const isExcited = this.desiredMood === 'excited' || this.raceIntensity >= 0.6;
    const isCountdown = this.desiredMood === 'countdown';

    // 1) Upbeat Percussion Groove (Kick + Clap/Snare + Crisp Hi-Hat)
    if (!isCountdown) {
      // Kick drum: punchy 4-on-the-floor during race, gentle half-time pulse in lobby
      if (isPlaying) {
        if (stepInBar === 0 || stepInBar === 4 || stepInBar === 8 || stepInBar === 12) {
          this.schedulePopKick(ctx, dest, time, stepInBar === 0 ? 0.38 : 0.31);
        } else if (isExcited && stepInBar === 14 && (barIdx === 3 || barIdx === 7)) {
          this.schedulePopKick(ctx, dest, time, 0.25);
        }
      } else {
        if (stepInBar === 0 || stepInBar === 10) {
          this.schedulePopKick(ctx, dest, time, 0.18);
        }
      }

      // Snappy clap/snare on beats 2 & 4 + playful energy fill at end of phrase
      if (isPlaying && (stepInBar === 4 || stepInBar === 12)) {
        this.schedulePopClapSnare(ctx, dest, time, 0.18);
      } else if (isExcited && barIdx === 7 && (stepInBar === 14 || stepInBar === 15)) {
        this.schedulePopClapSnare(ctx, dest, time, 0.14);
      } else if (!isPlaying && stepInBar === 12) {
        this.schedulePopClapSnare(ctx, dest, time, 0.08);
      }

      // Bouncy hi-hats on off-beats (8ths in lobby, 16ths in high energy)
      if (stepInBar % 2 === 0) {
        const accent = stepInBar % 4 === 2;
        this.scheduleHiHat(
          ctx,
          dest,
          time,
          isPlaying ? (accent ? 0.095 : 0.05) : accent ? 0.045 : 0.024,
          accent && isExcited
        );
      } else if (isExcited && (stepInBar === 7 || stepInBar === 15)) {
        this.scheduleHiHat(ctx, dest, time, 0.045, false);
      }
    }

    // 2) Bouncy Synth Bassline
    if (chord && song.bassPattern.includes(stepInBar)) {
      const octaveUp = stepInBar === 6 || stepInBar === 14;
      const bassFreq = octaveUp ? chord.bass * 2 : chord.bass;
      this.scheduleGrooveBass(
        ctx,
        dest,
        bassFreq,
        time,
        stepSec * 1.75,
        isPlaying ? 0.24 : 0.14
      );
    }

    // 3) Warm Electric-Piano / Pop Chord Stabs (rhythmic upbeat comping)
    if (chord && (stepInBar === 0 || stepInBar === 6 || stepInBar === 12)) {
      const stabDur = stepInBar === 0 ? stepSec * 4.5 : stepSec * 2.2;
      const stabVol = isPlaying ? 0.075 : 0.055;
      this.scheduleChordStab(ctx, dest, chord.notes, time, stabDur, stabVol);
    }

    // 4) Sparkling Background Arpeggio (adds joyful energy during active match)
    if (chord && isPlaying && stepInBar % 2 === 1) {
      const arpNote = chord.notes[(Math.floor(stepInBar / 2) + barIdx) % chord.notes.length] * 2;
      this.scheduleBellSparkle(ctx, dest, arpNote, time, isExcited ? 0.05 : 0.032);
    }

    // 5) Catchy Cheerful Lead Melody
    for (let i = 0; i < song.melody.length; i++) {
      const note = song.melody[i];
      if (note.step === step) {
        const durSec = Math.max(0.08, note.dur * stepSec * 0.9);
        const leadVol = (isPlaying ? 0.175 : 0.13) * note.vel;
        this.scheduleJoyfulLead(ctx, dest, note.freq, time, durSec, leadVol, song.leadTimbre);
      }
    }
  }

  private scheduleJoyfulLead(
    ctx: AudioContext,
    dest: GainNode,
    freq: number,
    startTime: number,
    durationSec: number,
    volume: number,
    timbre: 'pluck' | 'marimba' | 'synth'
  ) {
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const filter = ctx.createBiquadFilter();
    const env = ctx.createGain();

    filter.type = 'lowpass';

    if (timbre === 'marimba') {
      osc1.type = 'sine';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 2, startTime); // wooden 2nd harmonic sparkle
      filter.frequency.setValueAtTime(Math.min(5200, freq * 5), startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(850, freq * 1.8), startTime + durationSec);

      const otGain = ctx.createGain();
      otGain.gain.setValueAtTime(0.24, startTime);
      osc1.connect(filter);
      osc2.connect(otGain);
      otGain.connect(filter);
    } else if (timbre === 'synth') {
      osc1.type = 'sawtooth';
      osc2.type = 'triangle';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 1.003, startTime);
      filter.frequency.setValueAtTime(Math.min(4400, freq * 4.5), startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(900, freq * 2.1), startTime + durationSec);
      filter.Q.setValueAtTime(1.6, startTime);

      const s1Gain = ctx.createGain();
      s1Gain.gain.setValueAtTime(0.45, startTime);
      osc1.connect(s1Gain);
      s1Gain.connect(filter);
      osc2.connect(filter);
    } else {
      // 'pluck': bright cheerful game-show synth bell-pluck
      osc1.type = 'triangle';
      osc2.type = 'sine';
      osc1.frequency.setValueAtTime(freq, startTime);
      osc2.frequency.setValueAtTime(freq * 2.0, startTime);
      filter.frequency.setValueAtTime(Math.min(5600, freq * 5.2), startTime);
      filter.frequency.exponentialRampToValueAtTime(Math.max(950, freq * 2.0), startTime + durationSec);

      const otGain = ctx.createGain();
      otGain.gain.setValueAtTime(0.18, startTime);
      osc1.connect(filter);
      osc2.connect(otGain);
      otGain.connect(filter);
    }

    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.012);
    env.gain.exponentialRampToValueAtTime(Math.max(0.0001, volume * 0.42), startTime + durationSec * 0.65);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.04);

    filter.connect(env);
    env.connect(dest);

    osc1.start(startTime);
    osc2.start(startTime);
    osc1.stop(startTime + durationSec + 0.06);
    osc2.stop(startTime + durationSec + 0.06);
  }

  private scheduleGrooveBass(
    ctx: AudioContext,
    dest: GainNode,
    freq: number,
    startTime: number,
    durationSec: number,
    volume: number
  ) {
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.setValueAtTime(freq, startTime);

    const sub = ctx.createOscillator();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(freq, startTime);

    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(520, startTime);
    lp.frequency.exponentialRampToValueAtTime(220, startTime + durationSec);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.01);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.02);

    osc.connect(lp);
    sub.connect(lp);
    lp.connect(env);
    env.connect(dest);

    osc.start(startTime);
    sub.start(startTime);
    osc.stop(startTime + durationSec + 0.04);
    sub.stop(startTime + durationSec + 0.04);
  }

  private scheduleChordStab(
    ctx: AudioContext,
    dest: GainNode,
    notes: number[],
    startTime: number,
    durationSec: number,
    volume: number
  ) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(2200, startTime);
    lp.frequency.exponentialRampToValueAtTime(1050, startTime + durationSec);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.014);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.03);

    lp.connect(env);
    env.connect(dest);

    for (const f of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, startTime);
      osc.connect(lp);
      osc.start(startTime);
      osc.stop(startTime + durationSec + 0.05);
    }
  }

  private schedulePopKick(ctx: AudioContext, dest: GainNode, startTime: number, volume: number) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(145, startTime);
    osc.frequency.exponentialRampToValueAtTime(46, startTime + 0.095);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.005);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.16);

    osc.connect(env);
    env.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.18);
  }

  private schedulePopClapSnare(
    ctx: AudioContext,
    dest: GainNode,
    startTime: number,
    volume: number
  ) {
    if (!this.whiteNoiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoiseBuffer;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.setValueAtTime(1850, startTime);
    bp.Q.setValueAtTime(1.2, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.004);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.11);

    src.connect(bp);
    bp.connect(env);
    env.connect(dest);
    src.start(startTime, Math.random() * 0.7);
    src.stop(startTime + 0.13);

    // Subtle crisp snare tone body
    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(215, startTime);
    body.frequency.exponentialRampToValueAtTime(120, startTime + 0.05);

    const bodyEnv = ctx.createGain();
    bodyEnv.gain.setValueAtTime(0.0001, startTime);
    bodyEnv.gain.linearRampToValueAtTime(volume * 0.45, startTime + 0.003);
    bodyEnv.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.065);

    body.connect(bodyEnv);
    bodyEnv.connect(dest);
    body.start(startTime);
    body.stop(startTime + 0.08);
  }

  private scheduleHiHat(
    ctx: AudioContext,
    dest: GainNode,
    startTime: number,
    volume: number,
    open: boolean
  ) {
    if (!this.whiteNoiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoiseBuffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(6800, startTime);

    const dur = open ? 0.11 : 0.042;
    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.002);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + dur);

    src.connect(hp);
    hp.connect(env);
    env.connect(dest);
    src.start(startTime, Math.random() * 0.9);
    src.stop(startTime + dur + 0.02);
  }

  // ==================== 2. STARTING PISTOL & COUNTDOWN SFX ====================

  public playCountdownBeep(isGo: boolean) {
    if (isGo) {
      this.playStartingPistol();
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;

    const now = ctx.currentTime;
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const revSend = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, now);
    osc2.frequency.setValueAtTime(1174.66, now);

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.22, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    revSend.gain.setValueAtTime(0.3, now);

    osc1.connect(gain);
    osc2.connect(overtoneGain);
    overtoneGain.connect(gain);
    gain.connect(this.masterGain);
    if (this.stadiumReverb) {
      gain.connect(revSend);
      revSend.connect(this.stadiumReverb);
    }

    osc1.start(now);
    osc2.start(now);
    osc1.stop(now + 0.26);
    osc2.stop(now + 0.26);
  }

  public playStartingPistol() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || !this.whiteNoiseBuffer || this._muted) return;

    const now = ctx.currentTime;
    const pistolBus = ctx.createGain();
    pistolBus.gain.setValueAtTime(0.75, now);

    const shaper = ctx.createWaveShaper();
    if (this.pistolShaperCurve) {
      shaper.curve = this.pistolShaperCurve;
    }
    shaper.oversample = '2x';

    pistolBus.connect(shaper);
    shaper.connect(this.masterGain);

    // Crisp start snap + bright launch chord (energetic, no harsh crowd noise)
    const crackSrc = ctx.createBufferSource();
    crackSrc.buffer = this.whiteNoiseBuffer;
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.setValueAtTime(2400, now);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.linearRampToValueAtTime(0.85, now + 0.002);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.035);
    crackSrc.connect(crackHp);
    crackHp.connect(crackGain);
    crackGain.connect(pistolBus);
    crackSrc.start(now);
    crackSrc.stop(now + 0.045);

    const thumpOsc = ctx.createOscillator();
    thumpOsc.type = 'triangle';
    thumpOsc.frequency.setValueAtTime(210, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(48, now + 0.1);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.linearRampToValueAtTime(0.75, now + 0.003);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.15);
    thumpOsc.connect(thumpGain);
    thumpGain.connect(pistolBus);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.16);

    // Bright triumphant GO fanfare triad
    [N.C5, N.E5, N.G5, N.C6].forEach((f, idx) => {
      this.scheduleBellSparkle(ctx, this.masterGain!, f, now + 0.04 + idx * 0.04, 0.11);
    });
  }

  // ==================== 2B. ATHLETIC START & FINISH PEA-WHISTLE ====================

  private scheduleWhistleBlast(
    ctx: AudioContext,
    startTime: number,
    durationSec: number,
    baseHz: number,
    intensity: number
  ) {
    if (!this.masterGain) return;

    const whistleBus = ctx.createGain();
    whistleBus.gain.setValueAtTime(0.0001, startTime);
    whistleBus.gain.linearRampToValueAtTime(0.2 * intensity, startTime + 0.018);
    whistleBus.gain.setValueAtTime(0.18 * intensity, startTime + Math.max(0.03, durationSec - 0.055));
    whistleBus.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.04);

    const trillAmpGain = ctx.createGain();
    trillAmpGain.gain.setValueAtTime(0.84, startTime);

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'triangle';

    oscA.frequency.setValueAtTime(baseHz * 0.92, startTime);
    oscA.frequency.exponentialRampToValueAtTime(baseHz, startTime + 0.024);
    oscA.frequency.setValueAtTime(baseHz * 1.015, startTime + durationSec * 0.72);
    oscA.frequency.exponentialRampToValueAtTime(baseHz * 0.95, startTime + durationSec + 0.03);

    oscB.frequency.setValueAtTime(baseHz * 1.058 * 0.92, startTime);
    oscB.frequency.exponentialRampToValueAtTime(baseHz * 1.058, startTime + 0.024);
    oscB.frequency.exponentialRampToValueAtTime(baseHz * 1.03, startTime + durationSec + 0.03);

    const oscBGain = ctx.createGain();
    oscBGain.gain.setValueAtTime(0.32, startTime);

    const peaLfo = ctx.createOscillator();
    peaLfo.type = 'sine';
    peaLfo.frequency.setValueAtTime(30 + Math.random() * 4, startTime);

    const peaFmGain = ctx.createGain();
    peaFmGain.gain.setValueAtTime(74, startTime);
    peaLfo.connect(peaFmGain);
    peaFmGain.connect(oscA.frequency);
    peaFmGain.connect(oscB.frequency);

    const peaAmGain = ctx.createGain();
    peaAmGain.gain.setValueAtTime(0.22, startTime);
    peaLfo.connect(peaAmGain);
    peaAmGain.connect(trillAmpGain.gain);

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1600, startTime);

    oscA.connect(trillAmpGain);
    oscB.connect(oscBGain);
    oscBGain.connect(trillAmpGain);
    trillAmpGain.connect(hp);
    hp.connect(whistleBus);

    whistleBus.connect(this.masterGain);
    if (this.stadiumReverb) {
      const revSend = ctx.createGain();
      revSend.gain.setValueAtTime(this.desiredVenue === 'open_field' ? 0.2 : 0.48, startTime);
      whistleBus.connect(revSend);
      revSend.connect(this.stadiumReverb);
    }

    const stopAt = startTime + durationSec + 0.06;
    oscA.start(startTime);
    oscB.start(startTime);
    peaLfo.start(startTime);
    oscA.stop(stopAt);
    oscB.stop(stopAt);
    peaLfo.stop(stopAt);
  }

  public playStartWhistle(kind: 'ready' | 'go' = 'go') {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;
    const now = ctx.currentTime;

    if (kind === 'ready') {
      this.scheduleWhistleBlast(ctx, now, 0.22, 2740, 0.65);
    } else {
      this.scheduleWhistleBlast(ctx, now + 0.03, 0.54, 2860, 0.88);
    }
  }

  public playFinishWhistle() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;
    const now = ctx.currentTime;

    this.scheduleWhistleBlast(ctx, now, 0.16, 2780, 0.72);
    this.scheduleWhistleBlast(ctx, now + 0.26, 0.16, 2820, 0.76);
    this.scheduleWhistleBlast(ctx, now + 0.54, 0.58, 2880, 0.88);
  }

  // ==================== 2C. SUBTLE RACE-TENSION PULSE ====================

  public setHeartbeatTension(tension: number) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(tension) ? tension : 0));
    this.heartbeatTension = clamped;

    if (clamped <= 0.12) {
      this.stopHeartbeat();
      return;
    }

    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'running' && this.heartbeatTimerId === null) {
      this.startHeartbeatScheduler(ctx);
    }
  }

  private startHeartbeatScheduler(ctx: AudioContext) {
    if (this.heartbeatTimerId !== null || typeof window === 'undefined') return;
    this.nextHeartbeatAt = ctx.currentTime + 0.04;

    const scheduleAheadSec = 0.18;
    const tick = () => {
      if (!this.ctx || this.heartbeatTension <= 0.12) {
        this.stopHeartbeat();
        return;
      }
      if (this.ctx.state !== 'running') return;

      const now = this.ctx.currentTime;
      if (this.nextHeartbeatAt < now - 0.12) {
        this.nextHeartbeatAt = now + 0.03;
      }

      while (this.nextHeartbeatAt < now + scheduleAheadSec) {
        const tension = this.heartbeatTension;
        if (!this._muted && this.masterGain) {
          this.scheduleHeartbeatPulse(this.ctx, this.nextHeartbeatAt, tension);
        }
        const bpm = 76 + tension * 72;
        this.nextHeartbeatAt += 60 / bpm;
      }
    };

    tick();
    this.heartbeatTimerId = window.setInterval(tick, 50);
  }

  private scheduleHeartbeatPulse(ctx: AudioContext, time: number, tension: number) {
    if (!this.masterGain) return;
    // Keep subtle so it supports the cheerful music rather than overpowering it
    const level = 0.05 + tension * 0.11;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(140, time);
    lp.connect(this.masterGain);

    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(66 + tension * 8, time);
    osc.frequency.exponentialRampToValueAtTime(36, time + 0.11);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, time);
    env.gain.linearRampToValueAtTime(level, time + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, time + 0.14);

    osc.connect(env);
    env.connect(lp);
    osc.start(time);
    osc.stop(time + 0.16);
  }

  public stopHeartbeat() {
    this.heartbeatTension = 0;
    if (this.heartbeatTimerId !== null) {
      window.clearInterval(this.heartbeatTimerId);
      this.heartbeatTimerId = null;
    }
  }

  // ==================== 3. GAMEPLAY FEEDBACK SFX ====================

  public playCorrectBoost() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;

    const now = ctx.currentTime;
    const notes = [N.C5, N.E5, N.G5, N.C6];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.05;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.25);
      osc.connect(gain);
      gain.connect(this.masterGain!);
      if (this.stadiumReverb) gain.connect(this.stadiumReverb);
      osc.start(t);
      osc.stop(t + 0.28);
    });

    // Subtle aerodynamic speed-boost whoosh
    if (this.whiteNoiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoiseBuffer;
      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(480, now);
      bp.frequency.exponentialRampToValueAtTime(2400, now + 0.26);
      bp.Q.setValueAtTime(1.8, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.09, now + 0.07);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.3);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      src.start(now, 0.2);
      src.stop(now + 0.32);
    }
  }

  public playWrongPenalty() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;

    const now = ctx.currentTime;
    const osc = ctx.createOscillator();
    const lp = ctx.createBiquadFilter();
    const gain = ctx.createGain();

    osc.type = 'sawtooth';
    osc.frequency.setValueAtTime(235, now);
    osc.frequency.linearRampToValueAtTime(132, now + 0.32);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(900, now);
    lp.frequency.linearRampToValueAtTime(360, now + 0.32);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.15, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.36);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.38);
  }

  public playCrowdCheerAndFanfare() {
    // Pure celebratory musical fanfare (crowd noise & applause removed)
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;

    const now = ctx.currentTime;
    const fanfare = [N.C5, N.E5, N.G5, N.C6];
    fanfare.forEach((freq, i) => {
      const t = now + i * 0.09;
      this.scheduleBrassVoice(ctx, this.masterGain!, freq, t, 0.5, 0.14);
      this.scheduleBellSparkle(ctx, this.masterGain!, freq * 2, t + 0.02, 0.06);
    });
  }

  public playMedalAwarded(rank: 1 | 2 | 3) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;
    const nowMs = Date.now();
    if (nowMs - this.lastMedalChimeAt < 900) return;
    this.lastMedalChimeAt = nowMs;

    const now = ctx.currentTime;
    const chords: Record<1 | 2 | 3, number[]> = {
      3: [N.C5, N.E5, N.G5],
      2: [N.D5, N.Fs5, N.A5, N.D6],
      1: [N.E5, N.G5, N.C6, N.E6, N.G6],
    };
    const notes = chords[rank];
    const dest = this.masterGain;

    notes.forEach((freq, idx) => {
      const t = now + idx * 0.068;
      const osc = ctx.createOscillator();
      const overtone = ctx.createOscillator();
      const env = ctx.createGain();
      const otGain = ctx.createGain();

      osc.type = 'sine';
      overtone.type = 'triangle';
      osc.frequency.setValueAtTime(freq, t);
      overtone.frequency.setValueAtTime(freq * 2, t);
      otGain.gain.setValueAtTime(0.22, t);

      const peak = rank === 1 ? 0.17 : 0.14;
      const tail = rank === 1 ? 0.85 : 0.62;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(peak, t + 0.01);
      env.gain.exponentialRampToValueAtTime(0.0001, t + tail);

      osc.connect(env);
      overtone.connect(otGain);
      otGain.connect(env);
      env.connect(dest);
      if (this.stadiumReverb) {
        const revSend = ctx.createGain();
        revSend.gain.setValueAtTime(0.4, t);
        env.connect(revSend);
        revSend.connect(this.stadiumReverb);
      }

      osc.start(t);
      overtone.start(t);
      osc.stop(t + tail + 0.04);
      overtone.stop(t + tail + 0.04);
    });

    if (rank === 1) {
      this.scheduleBrassVoice(ctx, dest, N.C5, now + 0.18, 0.72, 0.12);
      this.scheduleBrassVoice(ctx, dest, N.G5, now + 0.22, 0.72, 0.11);
    }
  }

  // ==================== 4. CELEBRATORY VICTORY MUSIC ====================

  public startVictoryMusic() {
    this.desiredVictoryMusic = true;
    this.stopRaceMusic(false);
    const ctx = this.ensureContext();
    if (!ctx) return;

    if (ctx.state === 'running' && !this.victoryActive) {
      this.beginVictorySequencer(ctx);
    }
  }

  private beginVictorySequencer(ctx: AudioContext) {
    if (!this.masterGain || this.victoryActive) return;
    this.victoryActive = true;

    const now = ctx.currentTime;
    const vGain = ctx.createGain();
    vGain.gain.setValueAtTime(0.0001, now);
    vGain.gain.linearRampToValueAtTime(this._musicEnabled ? 0.56 : 0.0001, now + 0.35);
    vGain.connect(this.masterGain);
    if (this.stadiumReverb) {
      const revSend = ctx.createGain();
      revSend.gain.setValueAtTime(0.32, now);
      vGain.connect(revSend);
      revSend.connect(this.stadiumReverb);
    }
    this.victoryGain = vGain;

    this.victoryStepIndex = 0;
    this.victoryNextStepTime = now + 0.06;

    // Opening celebratory cymbal crash
    this.scheduleCymbalCrash(ctx, vGain, this.victoryNextStepTime, 0.2);

    const scheduleAheadSec = 0.26;
    const tickScheduler = () => {
      if (!this.victoryActive || !this.ctx || !this.victoryGain) return;
      if (this.ctx.state !== 'running') return;

      if (this.victoryNextStepTime < this.ctx.currentTime - 0.15) {
        this.victoryNextStepTime = this.ctx.currentTime + 0.04;
      }

      while (this.victoryNextStepTime < this.ctx.currentTime + scheduleAheadSec) {
        if (!this._muted && this._musicEnabled) {
          this.scheduleVictoryStep(
            this.ctx,
            this.victoryGain,
            this.victoryStepIndex,
            this.victoryNextStepTime
          );
        }
        this.victoryNextStepTime += VICTORY_STEP_SEC;
        this.victoryStepIndex = (this.victoryStepIndex + 1) % VICTORY_TOTAL_STEPS;
      }
    };

    tickScheduler();
    this.victoryTimerId = window.setInterval(tickScheduler, 60);
  }

  private scheduleVictoryStep(ctx: AudioContext, dest: GainNode, step: number, time: number) {
    if (step % 16 === 0) {
      const barIdx = Math.floor(step / 16);
      const chord = VICTORY_CHORDS[barIdx];
      if (chord) {
        this.schedulePadChord(ctx, dest, chord.notes, time, VICTORY_STEP_SEC * 16);
        this.scheduleTimpaniHit(ctx, dest, chord.bass, time, 0.32);
        if (barIdx === 0) {
          this.scheduleCymbalCrash(ctx, dest, time, 0.14);
        }
      }
    }

    const stepInBar = step % 16;
    const barIdx = Math.floor(step / 16);
    const bassFreq = VICTORY_CHORDS[barIdx]?.bass ?? N.C3;

    if (stepInBar === 8 || stepInBar === 14) {
      this.scheduleTimpaniHit(ctx, dest, bassFreq, time, stepInBar === 8 ? 0.2 : 0.15);
    }
    if (
      stepInBar === 4 ||
      stepInBar === 12 ||
      (barIdx === 3 && (stepInBar === 13 || stepInBar === 14 || stepInBar === 15))
    ) {
      this.scheduleMarchSnare(ctx, dest, time, stepInBar === 4 || stepInBar === 12 ? 0.11 : 0.075);
    }

    if (stepInBar % 4 === 2) {
      const chord = VICTORY_CHORDS[barIdx];
      if (chord) {
        const bellNote = chord.notes[(stepInBar / 2) % chord.notes.length] * 2;
        this.scheduleBellSparkle(ctx, dest, bellNote, time, 0.055);
      }
    }

    for (let i = 0; i < VICTORY_MELODY.length; i++) {
      const note = VICTORY_MELODY[i];
      if (note.step === step) {
        this.scheduleBrassVoice(
          ctx,
          dest,
          note.freq,
          time,
          note.dur * VICTORY_STEP_SEC * 0.94,
          0.145 * note.vel
        );
      }
    }
  }

  private scheduleBrassVoice(
    ctx: AudioContext,
    dest: GainNode,
    freq: number,
    startTime: number,
    durationSec: number,
    volume: number
  ) {
    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sawtooth';
    oscB.type = 'triangle';
    oscA.frequency.setValueAtTime(freq, startTime);
    oscB.frequency.setValueAtTime(freq * 1.004, startTime);

    const filter = ctx.createBiquadFilter();
    filter.type = 'lowpass';
    filter.Q.setValueAtTime(2.0, startTime);
    filter.frequency.setValueAtTime(freq * 1.3, startTime);
    filter.frequency.exponentialRampToValueAtTime(Math.min(4800, freq * 4.2), startTime + 0.045);
    filter.frequency.exponentialRampToValueAtTime(Math.max(600, freq * 2.1), startTime + durationSec);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.025);
    env.gain.setValueAtTime(volume * 0.88, startTime + Math.max(0.04, durationSec - 0.06));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.05);

    oscA.connect(filter);
    oscB.connect(filter);
    filter.connect(env);
    env.connect(dest);

    oscA.start(startTime);
    oscB.start(startTime);
    oscA.stop(startTime + durationSec + 0.07);
    oscB.stop(startTime + durationSec + 0.07);
  }

  private schedulePadChord(
    ctx: AudioContext,
    dest: GainNode,
    notes: number[],
    startTime: number,
    durationSec: number
  ) {
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(1350, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(0.075, startTime + 0.22);
    env.gain.setValueAtTime(0.07, startTime + Math.max(0.25, durationSec - 0.25));
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.08);

    lp.connect(env);
    env.connect(dest);

    for (const f of notes) {
      const osc = ctx.createOscillator();
      osc.type = 'triangle';
      osc.frequency.setValueAtTime(f, startTime);
      osc.connect(lp);
      osc.start(startTime);
      osc.stop(startTime + durationSec + 0.1);
    }
  }

  private scheduleTimpaniHit(
    ctx: AudioContext,
    dest: GainNode,
    freq: number,
    startTime: number,
    volume: number
  ) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq * 1.18, startTime);
    osc.frequency.exponentialRampToValueAtTime(freq * 0.96, startTime + 0.07);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.42);

    osc.connect(env);
    env.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.45);
  }

  private scheduleMarchSnare(
    ctx: AudioContext,
    dest: GainNode,
    startTime: number,
    volume: number
  ) {
    if (!this.whiteNoiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoiseBuffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'bandpass';
    hp.frequency.setValueAtTime(2400, startTime);
    hp.Q.setValueAtTime(1.1, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.003);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.11);

    src.connect(hp);
    hp.connect(env);
    env.connect(dest);
    src.start(startTime, Math.random() * 0.8);
    src.stop(startTime + 0.13);
  }

  private scheduleBellSparkle(
    ctx: AudioContext,
    dest: GainNode,
    freq: number,
    startTime: number,
    volume: number
  ) {
    const osc = ctx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(freq, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.006);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.32);

    osc.connect(env);
    env.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.35);
  }

  private scheduleCymbalCrash(
    ctx: AudioContext,
    dest: GainNode,
    startTime: number,
    volume: number
  ) {
    if (!this.whiteNoiseBuffer) return;
    const src = ctx.createBufferSource();
    src.buffer = this.whiteNoiseBuffer;

    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(5200, startTime);

    const env = ctx.createGain();
    env.gain.setValueAtTime(0.0001, startTime);
    env.gain.linearRampToValueAtTime(volume, startTime + 0.012);
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.05);

    src.connect(hp);
    hp.connect(env);
    env.connect(dest);
    src.start(startTime, 0.3);
    src.stop(startTime + 1.1);
  }

  public stopVictoryMusic() {
    this.desiredVictoryMusic = false;
    this.victoryActive = false;

    if (this.victoryTimerId !== null) {
      window.clearInterval(this.victoryTimerId);
      this.victoryTimerId = null;
    }

    const vGain = this.victoryGain;
    this.victoryGain = null;
    if (vGain && this.ctx) {
      const now = this.ctx.currentTime;
      vGain.gain.cancelScheduledValues(now);
      vGain.gain.setValueAtTime(Math.max(0.0001, vGain.gain.value), now);
      vGain.gain.linearRampToValueAtTime(0.0001, now + 0.42);
      window.setTimeout(() => {
        try {
          vGain.disconnect();
        } catch {
          // ignore
        }
      }, 480);
    }
  }

  // No-op compatibility stubs (commentator audio removed per user request)
  public setCommentatorDucking(_active: boolean) {}
  public stopCommentatorPlayback() {}

  public stopAllRaceAudio() {
    this.raceIntensity = 0;
    this.stopHeartbeat();
    this.stopRaceMusic(true);
    this.stopVictoryMusic();
  }
}

export const soundEngine = new SoundEngine();
