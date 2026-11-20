import type { RaceVenueId } from '../types/game';

export type CrowdMood = 'idle' | 'waiting' | 'countdown' | 'playing' | 'excited' | 'victory';

interface CrowdAudioGraph {
  rumbleSrc: AudioBufferSourceNode;
  chatterSrc: AudioBufferSourceNode;
  rumbleFilter: BiquadFilterNode;
  chatterFilter: BiquadFilterNode;
  airFilter: BiquadFilterNode;
  lfo1: OscillatorNode;
  lfo2: OscillatorNode;
  lfo1Gain: GainNode;
  lfo2Gain: GainNode;
  crowdGain: GainNode;
  swellGain: GainNode;
  reverbSend: GainNode;
}

interface VictoryChord {
  bar: number;
  notes: number[];
  bass: number;
}

interface MelodyNote {
  step: number; // 16th-note index in 64-step (4-bar) anthem loop
  dur: number;  // duration in 16th-note steps
  freq: number;
  vel: number;
}

// 4-bar heroic stadium championship victory anthem in C major (116 BPM -> 16th = 0.1293s)
const VICTORY_TEMPO_BPM = 116;
const STEP_SEC = 60 / VICTORY_TEMPO_BPM / 4;
const TOTAL_STEPS = 64;

const VICTORY_CHORDS: VictoryChord[] = [
  { bar: 0, notes: [261.63, 329.63, 392.0, 523.25], bass: 130.81 }, // C major
  { bar: 1, notes: [293.66, 392.0, 493.88, 587.33], bass: 196.0 },  // G major
  { bar: 2, notes: [261.63, 349.23, 440.0, 523.25], bass: 174.61 }, // F major
  { bar: 3, notes: [293.66, 392.0, 493.88, 587.33], bass: 196.0 },  // G major cadence -> C
];

const VICTORY_MELODY: MelodyNote[] = [
  // Bar 1 (C): Triumphant brass pickup & fanfare motif
  { step: 0, dur: 3, freq: 523.25, vel: 0.95 },  // C5
  { step: 3, dur: 1, freq: 523.25, vel: 0.72 },  // C5
  { step: 4, dur: 4, freq: 659.25, vel: 1.0 },   // E5
  { step: 8, dur: 4, freq: 783.99, vel: 1.0 },   // G5
  { step: 12, dur: 4, freq: 1046.5, vel: 1.0 },  // C6
  // Bar 2 (G): Soaring answer
  { step: 16, dur: 6, freq: 987.77, vel: 0.95 }, // B5
  { step: 22, dur: 2, freq: 880.0, vel: 0.8 },   // A5
  { step: 24, dur: 4, freq: 783.99, vel: 0.92 }, // G5
  { step: 28, dur: 4, freq: 587.33, vel: 0.85 }, // D5
  // Bar 3 (F): Heroic climb
  { step: 32, dur: 3, freq: 698.46, vel: 0.95 }, // F5
  { step: 35, dur: 1, freq: 783.99, vel: 0.78 }, // G5
  { step: 36, dur: 4, freq: 880.0, vel: 1.0 },   // A5
  { step: 40, dur: 4, freq: 1046.5, vel: 1.0 },  // C6
  { step: 44, dur: 4, freq: 880.0, vel: 0.88 },  // A5
  // Bar 4 (G -> C): Regal cadence
  { step: 48, dur: 6, freq: 783.99, vel: 0.96 }, // G5
  { step: 54, dur: 2, freq: 880.0, vel: 0.82 },  // A5
  { step: 56, dur: 4, freq: 987.77, vel: 0.98 }, // B5
  { step: 60, dur: 4, freq: 1046.5, vel: 1.0 },  // C6 resolve
];

const CROWD_MOOD_LEVELS: Record<CrowdMood, { gain: number; chatterHz: number; rumbleHz: number }> = {
  idle: { gain: 0.0, chatterHz: 900, rumbleHz: 320 },
  waiting: { gain: 0.14, chatterHz: 920, rumbleHz: 340 },
  countdown: { gain: 0.065, chatterHz: 740, rumbleHz: 280 },
  playing: { gain: 0.21, chatterHz: 1120, rumbleHz: 390 },
  excited: { gain: 0.30, chatterHz: 1360, rumbleHz: 440 },
  victory: { gain: 0.34, chatterHz: 1480, rumbleHz: 460 },
};

class SoundEngine {
  private ctx: AudioContext | null = null;
  private masterGain: GainNode | null = null;
  private compressor: DynamicsCompressorNode | null = null;
  private stadiumReverb: ConvolverNode | null = null;
  private reverbReturn: GainNode | null = null;
  private crowdNoiseBuffer: AudioBuffer | null = null;
  private whiteNoiseBuffer: AudioBuffer | null = null;
  private pistolShaperCurve: Float32Array<ArrayBuffer> | null = null;

  private crowdGraph: CrowdAudioGraph | null = null;
  private desiredCrowdActive = false;
  private desiredCrowdMood: CrowdMood = 'waiting';
  private desiredVenue: RaceVenueId = 'stadium_day';
  private raceIntensity = 0; // 0..1 continuous excitement multiplier during race
  private lastAutoRoarAt = 0;

  // Dynamic race-tension heartbeat (lub-dub) synthesizer state
  private heartbeatTension = 0; // 0..1
  private heartbeatTimerId: number | null = null;
  private nextHeartbeatAt = 0;

  private victoryGain: GainNode | null = null;
  private victoryTimerId: number | null = null;
  private victoryActive = false;
  private desiredVictoryMusic = false;
  private victoryNextStepTime = 0;
  private victoryStepIndex = 0;

  private clapTimerId: number | null = null;

  // Broadcast commentator voice bus & ducking state
  private commentatorBus: GainNode | null = null;
  private activeCommentatorSources = new Set<AudioBufferSourceNode>();
  private commentatorSpeakingCount = 0;

  private _muted = false;
  private _volume = 0.78;
  private gestureHookInstalled = false;

  constructor() {
    this.installGestureUnlock();
  }

  private installGestureUnlock() {
    if (typeof window === 'undefined' || this.gestureHookInstalled) return;
    this.gestureHookInstalled = true;
    const handleGesture = () => {
      if (
        !this._muted &&
        (this.desiredCrowdActive ||
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

  private syncMasterGain() {
    if (!this.ctx || !this.masterGain) return;
    const now = this.ctx.currentTime;
    const target = this._muted ? 0 : this._volume;
    this.masterGain.gain.cancelScheduledValues(now);
    this.masterGain.gain.setTargetAtTime(target, now, 0.035);
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
      compressor.ratio.setValueAtTime(4, ctx.currentTime);
      compressor.attack.setValueAtTime(0.004, ctx.currentTime);
      compressor.release.setValueAtTime(0.18, ctx.currentTime);

      const masterGain = ctx.createGain();
      masterGain.gain.setValueAtTime(this._muted ? 0 : this._volume, ctx.currentTime);

      masterGain.connect(compressor);
      compressor.connect(ctx.destination);

      // Shared procedural stadium impulse response reverb (~1.75s hall/arena decay)
      const reverb = ctx.createConvolver();
      reverb.buffer = this.createStadiumImpulseBuffer(ctx, 1.75, 2.8);

      const reverbReturn = ctx.createGain();
      reverbReturn.gain.setValueAtTime(this.desiredVenue === 'open_field' ? 0.16 : 0.42, ctx.currentTime);
      reverb.connect(reverbReturn);
      reverbReturn.connect(masterGain);

      // Broadcast commentator voice chain: clean high-pass + vocal presence boost + subtle booth ambience
      const commentatorBus = ctx.createGain();
      commentatorBus.gain.setValueAtTime(1.18, ctx.currentTime);

      const voiceHp = ctx.createBiquadFilter();
      voiceHp.type = 'highpass';
      voiceHp.frequency.setValueAtTime(105, ctx.currentTime);

      const voicePresence = ctx.createBiquadFilter();
      voicePresence.type = 'peaking';
      voicePresence.frequency.setValueAtTime(2800, ctx.currentTime);
      voicePresence.Q.setValueAtTime(1.0, ctx.currentTime);
      voicePresence.gain.setValueAtTime(2.8, ctx.currentTime);

      const voiceRevSend = ctx.createGain();
      voiceRevSend.gain.setValueAtTime(0.07, ctx.currentTime);

      commentatorBus.connect(voiceHp);
      voiceHp.connect(voicePresence);
      voicePresence.connect(masterGain);
      voicePresence.connect(voiceRevSend);
      voiceRevSend.connect(reverb);

      this.compressor = compressor;
      this.masterGain = masterGain;
      this.stadiumReverb = reverb;
      this.reverbReturn = reverbReturn;
      this.commentatorBus = commentatorBus;
      this.crowdNoiseBuffer = this.createSeamlessPinkNoiseBuffer(ctx, 6.0);
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
      if (this.desiredCrowdActive && !this.crowdGraph) {
        this.buildAndStartCrowdGraph(ctx);
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

  private createStadiumImpulseBuffer(ctx: AudioContext, durationSec: number, decay: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) {
      const data = buffer.getChannelData(ch);
      let lp = 0;
      for (let i = 0; i < length; i++) {
        const t = i / length;
        const env = Math.pow(1 - t, decay);
        // Subtle early grandstand reflections around 35ms, 78ms, 130ms
        let early = 0;
        if (i === Math.floor(ctx.sampleRate * 0.036)) early = 0.55;
        else if (i === Math.floor(ctx.sampleRate * 0.078)) early = 0.38;
        else if (i === Math.floor(ctx.sampleRate * 0.132)) early = 0.24;
        const white = Math.random() * 2 - 1;
        lp = lp * 0.58 + white * 0.42;
        data[i] = lp * env * 0.65 + early;
      }
    }
    return buffer;
  }

  private createSeamlessPinkNoiseBuffer(ctx: AudioContext, durationSec: number): AudioBuffer {
    const length = Math.floor(ctx.sampleRate * durationSec);
    const buffer = ctx.createBuffer(2, length, ctx.sampleRate);
    const xfade = Math.floor(ctx.sampleRate * 0.35);

    for (let ch = 0; ch < 2; ch++) {
      const raw = new Float32Array(length + xfade);
      // Paul Kellet's pink noise filter for warm organic stadium crowd timbre
      let b0 = 0;
      let b1 = 0;
      let b2 = 0;
      let b3 = 0;
      let b4 = 0;
      let b5 = 0;
      let b6 = 0;
      for (let i = 0; i < raw.length; i++) {
        const white = Math.random() * 2 - 1;
        b0 = 0.99886 * b0 + white * 0.0555179;
        b1 = 0.99332 * b1 + white * 0.0750759;
        b2 = 0.96900 * b2 + white * 0.1538520;
        b3 = 0.86650 * b3 + white * 0.3104856;
        b4 = 0.55000 * b4 + white * 0.5329522;
        b5 = -0.7616 * b5 - white * 0.0168980;
        raw[i] = (b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362) * 0.11;
        b6 = white * 0.115926;
      }

      const data = buffer.getChannelData(ch);
      for (let i = 0; i < length; i++) {
        if (i < xfade) {
          const alpha = i / xfade;
          data[i] = raw[i] * alpha + raw[length + i] * (1 - alpha);
        } else {
          data[i] = raw[i];
        }
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

  // ==================== 1. AMBIENT STADIUM CROWD NOISE ====================

  public setVenue(venue: RaceVenueId) {
    this.desiredVenue = venue;
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const isOpen = venue === 'open_field';
    if (this.reverbReturn) {
      this.reverbReturn.gain.setTargetAtTime(isOpen ? 0.15 : 0.42, now, 0.25);
    }
    if (this.crowdGraph) {
      this.crowdGraph.reverbSend.gain.setTargetAtTime(isOpen ? 0.08 : 0.34, now, 0.25);
      this.applyCrowdMoodParameters(this.desiredCrowdMood);
    }
  }

  public startAmbientCrowd(mood: CrowdMood = 'waiting', venue?: RaceVenueId) {
    this.desiredCrowdActive = true;
    this.desiredCrowdMood = mood;
    if (venue) this.desiredVenue = venue;

    const ctx = this.ensureContext();
    if (!ctx) return;
    if (ctx.state === 'running') {
      if (!this.crowdGraph) {
        this.buildAndStartCrowdGraph(ctx);
      } else {
        this.applyCrowdMoodParameters(mood);
      }
    }
  }

  public setCrowdMood(mood: CrowdMood) {
    this.desiredCrowdMood = mood;
    if (this.crowdGraph && this.ctx) {
      this.applyCrowdMoodParameters(mood);
    }
    this.updateVictoryApplauseLoop();
  }

  private buildAndStartCrowdGraph(ctx: AudioContext) {
    if (!this.masterGain || !this.stadiumReverb || !this.crowdNoiseBuffer) return;
    if (this.crowdGraph) return;

    const now = ctx.currentTime;

    // Layer A: Deep stadium bowl murmur & distant crowd rumble
    const rumbleSrc = ctx.createBufferSource();
    rumbleSrc.buffer = this.crowdNoiseBuffer;
    rumbleSrc.loop = true;

    const rumbleFilter = ctx.createBiquadFilter();
    rumbleFilter.type = 'bandpass';
    rumbleFilter.frequency.setValueAtTime(360, now);
    rumbleFilter.Q.setValueAtTime(0.75, now);

    // Layer B: Mid-frequency human cheer formant bed (offset start so stereo layers decorrelate)
    const chatterSrc = ctx.createBufferSource();
    chatterSrc.buffer = this.crowdNoiseBuffer;
    chatterSrc.loop = true;

    const chatterFilter = ctx.createBiquadFilter();
    chatterFilter.type = 'bandpass';
    chatterFilter.frequency.setValueAtTime(1080, now);
    chatterFilter.Q.setValueAtTime(1.15, now);

    const airFilter = ctx.createBiquadFilter();
    airFilter.type = 'lowpass';
    airFilter.frequency.setValueAtTime(3200, now);

    const crowdGain = ctx.createGain();
    crowdGain.gain.setValueAtTime(0.0001, now);

    const swellGain = ctx.createGain();
    swellGain.gain.setValueAtTime(1.0, now);

    const reverbSend = ctx.createGain();
    reverbSend.gain.setValueAtTime(this.desiredVenue === 'open_field' ? 0.08 : 0.34, now);

    // Dual slow LFOs make the crowd breathe naturally like a live stadium wave
    const lfo1 = ctx.createOscillator();
    lfo1.type = 'sine';
    lfo1.frequency.setValueAtTime(0.11, now);
    const lfo1Gain = ctx.createGain();
    lfo1Gain.gain.setValueAtTime(160, now);
    lfo1.connect(lfo1Gain);
    lfo1Gain.connect(chatterFilter.frequency);

    const lfo2 = ctx.createOscillator();
    lfo2.type = 'sine';
    lfo2.frequency.setValueAtTime(0.17, now);
    const lfo2Gain = ctx.createGain();
    lfo2Gain.gain.setValueAtTime(0.16, now);
    lfo2.connect(lfo2Gain);
    lfo2Gain.connect(swellGain.gain);

    rumbleSrc.connect(rumbleFilter);
    rumbleFilter.connect(crowdGain);

    chatterSrc.connect(chatterFilter);
    chatterFilter.connect(airFilter);
    airFilter.connect(crowdGain);

    crowdGain.connect(swellGain);
    swellGain.connect(this.masterGain);
    swellGain.connect(reverbSend);
    reverbSend.connect(this.stadiumReverb);

    rumbleSrc.start(now, 0);
    chatterSrc.start(now, 2.3);
    lfo1.start(now);
    lfo2.start(now);

    this.crowdGraph = {
      rumbleSrc,
      chatterSrc,
      rumbleFilter,
      chatterFilter,
      airFilter,
      lfo1,
      lfo2,
      lfo1Gain,
      lfo2Gain,
      crowdGain,
      swellGain,
      reverbSend,
    };

    this.applyCrowdMoodParameters(this.desiredCrowdMood);
    this.updateVictoryApplauseLoop();
  }

  public setRaceIntensity(
    intensity: number,
    options?: { heartbeatTension?: number; allowAutoSwell?: boolean }
  ) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(intensity) ? intensity : 0));
    const prev = this.raceIntensity;
    this.raceIntensity = clamped;

    if (this.crowdGraph && this.ctx) {
      this.applyCrowdMoodParameters(this.desiredCrowdMood);
    }

    // Trigger organic stadium crowd roar surges when race intensity spikes into high gear
    if (
      options?.allowAutoSwell !== false &&
      (this.desiredCrowdMood === 'playing' || this.desiredCrowdMood === 'excited') &&
      clamped >= 0.72 &&
      !this._muted
    ) {
      const nowMs = Date.now();
      const crossedPeak = prev < 0.72 && clamped >= 0.72;
      if (crossedPeak || nowMs - this.lastAutoRoarAt >= 5200) {
        this.lastAutoRoarAt = nowMs;
        this.triggerCrowdSwell(0.45 + clamped * 0.48, 2.2);
      }
    }

    if (typeof options?.heartbeatTension === 'number') {
      this.setHeartbeatTension(options.heartbeatTension);
    }
  }

  private applyCrowdMoodParameters(mood: CrowdMood) {
    if (!this.crowdGraph || !this.ctx) return;
    const now = this.ctx.currentTime;
    const spec = CROWD_MOOD_LEVELS[mood];
    const openScale = this.desiredVenue === 'open_field' ? 0.72 : 1.0;
    const duckScale = this.commentatorSpeakingCount > 0 ? 0.56 : 1.0;
    const isActiveRace = mood === 'playing' || mood === 'excited';
    const intensity = isActiveRace ? this.raceIntensity : 0;

    // Continuously scale volume, resonant roar brightness, bass rumble & wave speed with race intensity
    const targetGain = spec.gain * (1 + intensity * 0.62) * openScale * duckScale;
    const targetChatterHz =
      spec.chatterHz + (this.desiredVenue === 'open_field' ? 180 : 0) + intensity * 460;
    const targetChatterQ = 1.15 - intensity * 0.25;
    const targetRumbleHz = spec.rumbleHz + intensity * 125;
    const targetAirHz = 3200 + intensity * 1700;

    this.crowdGraph.crowdGain.gain.setTargetAtTime(targetGain, now, 0.25);
    this.crowdGraph.chatterFilter.frequency.setTargetAtTime(targetChatterHz, now, 0.3);
    this.crowdGraph.chatterFilter.Q.setTargetAtTime(targetChatterQ, now, 0.35);
    this.crowdGraph.rumbleFilter.frequency.setTargetAtTime(targetRumbleHz, now, 0.3);
    this.crowdGraph.airFilter.frequency.setTargetAtTime(targetAirHz, now, 0.35);

    this.crowdGraph.lfo1.frequency.setTargetAtTime(0.11 + intensity * 0.24, now, 0.4);
    this.crowdGraph.lfo1Gain.gain.setTargetAtTime(160 + intensity * 150, now, 0.4);
    this.crowdGraph.lfo2.frequency.setTargetAtTime(0.17 + intensity * 0.31, now, 0.4);
    this.crowdGraph.lfo2Gain.gain.setTargetAtTime(0.16 + intensity * 0.14, now, 0.4);
  }

  private updateBroadcastDucking() {
    if (!this.ctx) return;
    const now = this.ctx.currentTime;
    const isSpeaking = this.commentatorSpeakingCount > 0;
    if (this.crowdGraph) {
      this.applyCrowdMoodParameters(this.desiredCrowdMood);
    }
    if (this.victoryGain) {
      this.victoryGain.gain.setTargetAtTime(isSpeaking ? 0.28 : 0.58, now, 0.18);
    }
  }

  public triggerCrowdSwell(intensity = 0.65, durationSec = 2.0) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain) return;
    if (this._muted || ctx.state !== 'running') return;

    const now = ctx.currentTime;
    if (this.crowdGraph) {
      const peak = 1.0 + Math.max(0.15, Math.min(1.4, intensity));
      this.crowdGraph.swellGain.gain.cancelScheduledValues(now);
      this.crowdGraph.swellGain.gain.setValueAtTime(this.crowdGraph.swellGain.gain.value, now);
      this.crowdGraph.swellGain.gain.linearRampToValueAtTime(peak, now + Math.min(0.28, durationSec * 0.2));
      this.crowdGraph.swellGain.gain.setTargetAtTime(1.0, now + durationSec * 0.35, durationSec * 0.35);
    }

    // Add a short bright upper-formant cheer burst so the roar is distinctly felt
    if (this.crowdNoiseBuffer) {
      const src = ctx.createBufferSource();
      src.buffer = this.crowdNoiseBuffer;
      src.loop = true;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1350, now);
      bp.frequency.linearRampToValueAtTime(1720, now + durationSec * 0.3);
      bp.frequency.exponentialRampToValueAtTime(980, now + durationSec);
      bp.Q.setValueAtTime(1.3, now);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.14 * intensity, now + 0.22);
      g.gain.exponentialRampToValueAtTime(0.0001, now + durationSec);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      if (this.stadiumReverb) g.connect(this.stadiumReverb);

      src.start(now, Math.random() * 3);
      src.stop(now + durationSec + 0.05);
    }
  }

  private playApplauseFlurry() {
    if (!this.ctx || !this.masterGain || !this.whiteNoiseBuffer || this._muted) return;
    if (this.ctx.state !== 'running') return;
    const ctx = this.ctx;
    const now = ctx.currentTime;

    // 5 staggered hand-clap bursts forming realistic stadium applause texture
    for (let i = 0; i < 5; i++) {
      const t = now + i * (0.045 + Math.random() * 0.04);
      const src = ctx.createBufferSource();
      src.buffer = this.whiteNoiseBuffer;

      const bp = ctx.createBiquadFilter();
      bp.type = 'bandpass';
      bp.frequency.setValueAtTime(1600 + Math.random() * 900, t);
      bp.Q.setValueAtTime(2.2, t);

      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.linearRampToValueAtTime(0.045 + Math.random() * 0.025, t + 0.006);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.085);

      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      if (this.stadiumReverb) g.connect(this.stadiumReverb);

      src.start(t, Math.random() * 1.2);
      src.stop(t + 0.1);
    }
  }

  private updateVictoryApplauseLoop() {
    if (this.desiredCrowdActive && this.desiredCrowdMood === 'victory') {
      if (this.clapTimerId === null && typeof window !== 'undefined') {
        this.clapTimerId = window.setInterval(() => {
          if (this.desiredCrowdMood === 'victory' && !this._muted) {
            this.playApplauseFlurry();
          }
        }, 420);
      }
    } else if (this.clapTimerId !== null) {
      window.clearInterval(this.clapTimerId);
      this.clapTimerId = null;
    }
  }

  public stopAmbientCrowd() {
    this.desiredCrowdActive = false;
    if (this.clapTimerId !== null) {
      window.clearInterval(this.clapTimerId);
      this.clapTimerId = null;
    }

    const graph = this.crowdGraph;
    this.crowdGraph = null;
    if (!graph || !this.ctx) return;

    const now = this.ctx.currentTime;
    graph.crowdGain.gain.cancelScheduledValues(now);
    graph.crowdGain.gain.setValueAtTime(graph.crowdGain.gain.value, now);
    graph.crowdGain.gain.linearRampToValueAtTime(0.0001, now + 0.35);

    const stopAt = now + 0.4;
    try {
      graph.rumbleSrc.stop(stopAt);
      graph.chatterSrc.stop(stopAt);
      graph.lfo1.stop(stopAt);
      graph.lfo2.stop(stopAt);
    } catch {
      // ignore if already stopped
    }
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
    // International track-and-field stadium PA pre-start tone (fundamental + crisp 2nd harmonic)
    const osc1 = ctx.createOscillator();
    const osc2 = ctx.createOscillator();
    const gain = ctx.createGain();
    const revSend = ctx.createGain();

    osc1.type = 'sine';
    osc2.type = 'triangle';
    osc1.frequency.setValueAtTime(587.33, now); // D5
    osc2.frequency.setValueAtTime(1174.66, now); // D6 overtone

    const overtoneGain = ctx.createGain();
    overtoneGain.gain.setValueAtTime(0.22, now);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.22, now + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);

    revSend.gain.setValueAtTime(0.35, now);

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
    pistolBus.gain.setValueAtTime(0.95, now);

    // Soft-clip saturation for authentic acoustic gunshot transient snap
    const shaper = ctx.createWaveShaper();
    if (this.pistolShaperCurve) {
      shaper.curve = this.pistolShaperCurve;
    }
    shaper.oversample = '2x';

    pistolBus.connect(shaper);
    shaper.connect(this.masterGain);

    // Stadium slap-back echo (2 distinct reflections bouncing off opposite grandstands)
    const echo1 = ctx.createDelay(0.5);
    echo1.delayTime.setValueAtTime(this.desiredVenue === 'open_field' ? 0.09 : 0.145, now);
    const echo1Filter = ctx.createBiquadFilter();
    echo1Filter.type = 'lowpass';
    echo1Filter.frequency.setValueAtTime(2200, now);
    const echo1Gain = ctx.createGain();
    echo1Gain.gain.setValueAtTime(this.desiredVenue === 'open_field' ? 0.14 : 0.36, now);

    const echo2 = ctx.createDelay(0.6);
    echo2.delayTime.setValueAtTime(0.295, now);
    const echo2Filter = ctx.createBiquadFilter();
    echo2Filter.type = 'lowpass';
    echo2Filter.frequency.setValueAtTime(1250, now);
    const echo2Gain = ctx.createGain();
    echo2Gain.gain.setValueAtTime(this.desiredVenue === 'open_field' ? 0.04 : 0.2, now);

    shaper.connect(echo1);
    echo1.connect(echo1Filter);
    echo1Filter.connect(echo1Gain);
    echo1Gain.connect(this.masterGain);

    shaper.connect(echo2);
    echo2.connect(echo2Filter);
    echo2Filter.connect(echo2Gain);
    echo2Gain.connect(this.masterGain);

    if (this.stadiumReverb) {
      const revSend = ctx.createGain();
      revSend.gain.setValueAtTime(this.desiredVenue === 'open_field' ? 0.22 : 0.72, now);
      shaper.connect(revSend);
      revSend.connect(this.stadiumReverb);
    }

    // Layer 1: Razor-sharp metallic hammer & supersonic crack (0..22ms)
    const crackSrc = ctx.createBufferSource();
    crackSrc.buffer = this.whiteNoiseBuffer;
    const crackHp = ctx.createBiquadFilter();
    crackHp.type = 'highpass';
    crackHp.frequency.setValueAtTime(2600, now);
    const crackGain = ctx.createGain();
    crackGain.gain.setValueAtTime(0.0001, now);
    crackGain.gain.linearRampToValueAtTime(1.0, now + 0.002);
    crackGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.032);
    crackSrc.connect(crackHp);
    crackHp.connect(crackGain);
    crackGain.connect(pistolBus);
    crackSrc.start(now);
    crackSrc.stop(now + 0.04);

    // Layer 2: Explosive gunpowder mid-blast body (0..240ms)
    const blastSrc = ctx.createBufferSource();
    blastSrc.buffer = this.whiteNoiseBuffer;
    const blastBp = ctx.createBiquadFilter();
    blastBp.type = 'bandpass';
    blastBp.frequency.setValueAtTime(1950, now);
    blastBp.frequency.exponentialRampToValueAtTime(420, now + 0.22);
    blastBp.Q.setValueAtTime(0.75, now);
    const blastGain = ctx.createGain();
    blastGain.gain.setValueAtTime(0.0001, now);
    blastGain.gain.linearRampToValueAtTime(0.85, now + 0.004);
    blastGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
    blastSrc.connect(blastBp);
    blastBp.connect(blastGain);
    blastGain.connect(pistolBus);
    blastSrc.start(now, 0.12);
    blastSrc.stop(now + 0.26);

    // Layer 3: Low-end acoustic boom punch (220Hz -> 44Hz rapid drop)
    const thumpOsc = ctx.createOscillator();
    thumpOsc.type = 'triangle';
    thumpOsc.frequency.setValueAtTime(220, now);
    thumpOsc.frequency.exponentialRampToValueAtTime(44, now + 0.095);
    const thumpGain = ctx.createGain();
    thumpGain.gain.setValueAtTime(0.0001, now);
    thumpGain.gain.linearRampToValueAtTime(0.82, now + 0.003);
    thumpGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.14);
    thumpOsc.connect(thumpGain);
    thumpGain.connect(pistolBus);
    thumpOsc.start(now);
    thumpOsc.stop(now + 0.16);

    // Immediate stadium crowd launch roar right after the gun fires!
    this.triggerCrowdSwell(0.95, 2.8);
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
    whistleBus.gain.linearRampToValueAtTime(0.24 * intensity, startTime + 0.018);
    whistleBus.gain.setValueAtTime(0.22 * intensity, startTime + Math.max(0.03, durationSec - 0.055));
    whistleBus.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec + 0.04);

    // Subtle amplitude trill gain modulated by the spinning cork pea (~30 Hz)
    const trillAmpGain = ctx.createGain();
    trillAmpGain.gain.setValueAtTime(0.84, startTime);

    const oscA = ctx.createOscillator();
    const oscB = ctx.createOscillator();
    oscA.type = 'sine';
    oscB.type = 'triangle';

    // Crisp upward breath attack scoop into steady athletic whistle pitch
    oscA.frequency.setValueAtTime(baseHz * 0.92, startTime);
    oscA.frequency.exponentialRampToValueAtTime(baseHz, startTime + 0.024);
    oscA.frequency.setValueAtTime(baseHz * 1.015, startTime + durationSec * 0.72);
    oscA.frequency.exponentialRampToValueAtTime(baseHz * 0.95, startTime + durationSec + 0.03);

    oscB.frequency.setValueAtTime(baseHz * 1.058 * 0.92, startTime);
    oscB.frequency.exponentialRampToValueAtTime(baseHz * 1.058, startTime + 0.024);
    oscB.frequency.exponentialRampToValueAtTime(baseHz * 1.03, startTime + durationSec + 0.03);

    const oscBGain = ctx.createGain();
    oscBGain.gain.setValueAtTime(0.32, startTime);

    // Spinning cork pea LFO: rapid FM + AM flutter for authentic referee pea-whistle rattle
    const peaLfo = ctx.createOscillator();
    peaLfo.type = 'sine';
    peaLfo.frequency.setValueAtTime(30 + Math.random() * 4, startTime);

    const peaFmGain = ctx.createGain();
    peaFmGain.gain.setValueAtTime(78, startTime);
    peaLfo.connect(peaFmGain);
    peaFmGain.connect(oscA.frequency);
    peaFmGain.connect(oscB.frequency);

    const peaAmGain = ctx.createGain();
    peaAmGain.gain.setValueAtTime(0.22, startTime);
    peaLfo.connect(peaAmGain);
    peaAmGain.connect(trillAmpGain.gain);

    // High-pass shimmer filter removes any harsh sub artifacts
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.setValueAtTime(1600, startTime);

    oscA.connect(trillAmpGain);
    oscB.connect(oscBGain);
    oscBGain.connect(trillAmpGain);
    trillAmpGain.connect(hp);
    hp.connect(whistleBus);

    // Airy breath turbulence noise for realistic lip-blow attack
    if (this.whiteNoiseBuffer) {
      const airSrc = ctx.createBufferSource();
      airSrc.buffer = this.whiteNoiseBuffer;
      const airBp = ctx.createBiquadFilter();
      airBp.type = 'bandpass';
      airBp.frequency.setValueAtTime(baseHz * 1.18, startTime);
      airBp.Q.setValueAtTime(3.6, startTime);

      const airGain = ctx.createGain();
      airGain.gain.setValueAtTime(0.0001, startTime);
      airGain.gain.linearRampToValueAtTime(0.11 * intensity, startTime + 0.015);
      airGain.gain.exponentialRampToValueAtTime(0.0001, startTime + durationSec);

      airSrc.connect(airBp);
      airBp.connect(airGain);
      airGain.connect(whistleBus);
      airSrc.start(startTime, Math.random() * 0.6);
      airSrc.stop(startTime + durationSec + 0.05);
    }

    whistleBus.connect(this.masterGain);
    if (this.stadiumReverb) {
      const revSend = ctx.createGain();
      revSend.gain.setValueAtTime(this.desiredVenue === 'open_field' ? 0.24 : 0.64, startTime);
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
      // Short sharp attention whistle at the beginning of countdown ("Bersiap!")
      this.scheduleWhistleBlast(ctx, now, 0.24, 2740, 0.68);
    } else {
      // Commanding start whistle blast at GO! slightly offset so it sings over the starting gun
      this.scheduleWhistleBlast(ctx, now + 0.03, 0.62, 2860, 0.96);
    }
  }

  public playFinishWhistle() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;
    const now = ctx.currentTime;

    // Classic athletic referee full-time triple whistle: short - short - long
    this.scheduleWhistleBlast(ctx, now, 0.17, 2780, 0.78);
    this.scheduleWhistleBlast(ctx, now + 0.27, 0.17, 2820, 0.82);
    this.scheduleWhistleBlast(ctx, now + 0.56, 0.64, 2880, 0.96);
  }

  // ==================== 2C. DYNAMIC RACE-TENSION HEARTBEAT (LUB-DUB) ====================

  public setHeartbeatTension(tension: number) {
    const clamped = Math.max(0, Math.min(1, Number.isFinite(tension) ? tension : 0));
    this.heartbeatTension = clamped;

    if (clamped <= 0.08) {
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
      if (!this.ctx || this.heartbeatTension <= 0.08) {
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
        // Smooth BPM curve: 68 BPM (tense anticipation) -> 148 BPM (final sprint adrenaline)
        const bpm = 68 + tension * 80;
        const beatSec = 60 / bpm;
        this.nextHeartbeatAt += beatSec;
      }
    };

    tick();
    this.heartbeatTimerId = window.setInterval(tick, 50);
  }

  private scheduleHeartbeatPulse(ctx: AudioContext, time: number, tension: number) {
    if (!this.masterGain) return;

    const duckScale = this.commentatorSpeakingCount > 0 ? 0.55 : 1.0;
    const level = (0.1 + tension * 0.24) * duckScale;
    const bpm = 68 + tension * 80;
    const dubOffset = Math.max(0.12, Math.min(0.185, (60 / bpm) * 0.27));

    // Warm visceral chest-thump lowpass filter (no reverb so it feels close and intimate)
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(145 + tension * 55, time);
    lp.Q.setValueAtTime(1.35, time);
    lp.connect(this.masterGain);

    const scheduleThump = (t: number, startHz: number, endHz: number, dur: number, amp: number) => {
      // Sub-bass fundamental
      const subOsc = ctx.createOscillator();
      subOsc.type = 'sine';
      subOsc.frequency.setValueAtTime(startHz, t);
      subOsc.frequency.exponentialRampToValueAtTime(endHz, t + dur * 0.72);

      // Warm low-mid body harmonic so heartbeat is audible on laptop/mobile speakers too
      const bodyOsc = ctx.createOscillator();
      bodyOsc.type = 'triangle';
      bodyOsc.frequency.setValueAtTime(startHz * 1.85, t);
      bodyOsc.frequency.exponentialRampToValueAtTime(endHz * 1.5, t + dur * 0.55);

      const bodyGain = ctx.createGain();
      bodyGain.gain.setValueAtTime(0.32, t);

      const env = ctx.createGain();
      env.gain.setValueAtTime(0.0001, t);
      env.gain.linearRampToValueAtTime(amp, t + 0.014);
      env.gain.exponentialRampToValueAtTime(0.0001, t + dur);

      subOsc.connect(env);
      bodyOsc.connect(bodyGain);
      bodyGain.connect(env);
      env.connect(lp);

      subOsc.start(t);
      bodyOsc.start(t);
      subOsc.stop(t + dur + 0.02);
      bodyOsc.stop(t + dur + 0.02);
    };

    // S1 ("lub"): deeper, stronger contraction
    scheduleThump(time, 68 + tension * 8, 34, 0.16, level);
    // S2 ("dub"): slightly tighter, softer follow-up
    scheduleThump(time + dubOffset, 58 + tension * 6, 30, 0.13, level * 0.76);
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
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, idx) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'triangle';
      const t = now + idx * 0.052;
      osc.frequency.setValueAtTime(freq, t);
      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.18, t + 0.014);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.26);
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
      bp.frequency.setValueAtTime(450, now);
      bp.frequency.exponentialRampToValueAtTime(2400, now + 0.28);
      bp.Q.setValueAtTime(1.8, now);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, now);
      g.gain.linearRampToValueAtTime(0.11, now + 0.08);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.34);
      src.connect(bp);
      bp.connect(g);
      g.connect(this.masterGain);
      src.start(now, 0.2);
      src.stop(now + 0.36);
    }

    this.triggerCrowdSwell(0.42, 1.4);
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
    osc.frequency.linearRampToValueAtTime(132, now + 0.34);

    lp.type = 'lowpass';
    lp.frequency.setValueAtTime(920, now);
    lp.frequency.linearRampToValueAtTime(360, now + 0.34);

    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(0.16, now + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.38);

    osc.connect(lp);
    lp.connect(gain);
    gain.connect(this.masterGain);
    osc.start(now);
    osc.stop(now + 0.4);
  }

  public playCrowdCheerAndFanfare() {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;

    const now = ctx.currentTime;
    this.triggerCrowdSwell(1.1, 3.2);
    this.playApplauseFlurry();

    // Bright brass triad sting when crossing the finish line
    const fanfare = [523.25, 659.25, 783.99, 1046.5];
    fanfare.forEach((freq, i) => {
      const t = now + i * 0.095;
      this.scheduleBrassVoice(ctx, this.masterGain!, freq, t, 0.52, 0.14);
    });
  }

  private lastMedalChimeAt = 0;

  public playMedalAwarded(rank: 1 | 2 | 3) {
    const ctx = this.ensureContext();
    if (!ctx || !this.masterGain || this._muted) return;
    const nowMs = Date.now();
    if (nowMs - this.lastMedalChimeAt < 900) return;
    this.lastMedalChimeAt = nowMs;

    const now = ctx.currentTime;
    // Ascending harmonic bell-harp arpeggio tailored to Bronze (#3), Silver (#2), and Gold (#1)
    const chords: Record<1 | 2 | 3, number[]> = {
      3: [523.25, 659.25, 783.99],               // C5 - E5 - G5 (warm Bronze)
      2: [587.33, 739.99, 880.0, 1174.66],       // D5 - F#5 - A5 - D6 (bright Silver)
      1: [659.25, 783.99, 1046.5, 1318.51, 1567.98], // E5 - G5 - C6 - E6 - G6 (triumphant Gold)
    };
    const notes = chords[rank];
    const dest = this.masterGain;

    notes.forEach((freq, idx) => {
      const t = now + idx * 0.068;
      // Sparkling glockenspiel / ceremonial chime fundamental + soft shimmer overtone
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
        revSend.gain.setValueAtTime(0.45, t);
        env.connect(revSend);
        revSend.connect(this.stadiumReverb);
      }

      osc.start(t);
      overtone.start(t);
      osc.stop(t + tail + 0.04);
      overtone.stop(t + tail + 0.04);
    });

    // Gold medal gets an extra majestic brass chord accent + crowd ovation swell
    if (rank === 1) {
      this.scheduleBrassVoice(ctx, dest, 523.25, now + 0.18, 0.72, 0.12);
      this.scheduleBrassVoice(ctx, dest, 783.99, now + 0.22, 0.72, 0.11);
      this.triggerCrowdSwell(0.85, 2.4);
      this.playApplauseFlurry();
    } else {
      this.triggerCrowdSwell(rank === 2 ? 0.55 : 0.42, 1.5);
      this.playApplauseFlurry();
    }
  }

  // ==================== 4. CELEBRATORY VICTORY MUSIC ====================

  public startVictoryMusic() {
    this.desiredVictoryMusic = true;
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
    vGain.gain.linearRampToValueAtTime(0.58, now + 0.35);
    vGain.connect(this.masterGain);
    if (this.stadiumReverb) {
      const revSend = ctx.createGain();
      revSend.gain.setValueAtTime(0.38, now);
      vGain.connect(revSend);
      revSend.connect(this.stadiumReverb);
    }
    this.victoryGain = vGain;

    this.victoryStepIndex = 0;
    this.victoryNextStepTime = now + 0.06;

    // Opening celebratory cymbal crash + crowd ovation
    this.scheduleCymbalCrash(ctx, vGain, this.victoryNextStepTime, 0.24);
    this.triggerCrowdSwell(1.0, 3.4);

    const scheduleAheadSec = 0.26;
    const tickScheduler = () => {
      if (!this.victoryActive || !this.ctx || !this.victoryGain) return;
      if (this.ctx.state !== 'running') return;

      if (this.victoryNextStepTime < this.ctx.currentTime - 0.15) {
        this.victoryNextStepTime = this.ctx.currentTime + 0.04;
      }

      while (this.victoryNextStepTime < this.ctx.currentTime + scheduleAheadSec) {
        this.scheduleVictoryStep(this.ctx, this.victoryGain, this.victoryStepIndex, this.victoryNextStepTime);
        this.victoryNextStepTime += STEP_SEC;
        this.victoryStepIndex = (this.victoryStepIndex + 1) % TOTAL_STEPS;
      }
    };

    tickScheduler();
    this.victoryTimerId = window.setInterval(tickScheduler, 60);
  }

  private scheduleVictoryStep(ctx: AudioContext, dest: GainNode, step: number, time: number) {
    // 1) Bar-start orchestral string pad + deep timpani downbeat
    if (step % 16 === 0) {
      const barIdx = Math.floor(step / 16);
      const chord = VICTORY_CHORDS[barIdx];
      if (chord) {
        this.schedulePadChord(ctx, dest, chord.notes, time, STEP_SEC * 16);
        this.scheduleTimpaniHit(ctx, dest, chord.bass, time, 0.34);
        if (barIdx === 0) {
          this.scheduleCymbalCrash(ctx, dest, time, 0.16);
        }
      }
    }

    // 2) Ceremonial timpani & snare marching rhythm
    const stepInBar = step % 16;
    const barIdx = Math.floor(step / 16);
    const bassFreq = VICTORY_CHORDS[barIdx]?.bass ?? 130.81;

    if (stepInBar === 8 || stepInBar === 14) {
      this.scheduleTimpaniHit(ctx, dest, bassFreq, time, stepInBar === 8 ? 0.22 : 0.16);
    }
    if (stepInBar === 4 || stepInBar === 12 || (barIdx === 3 && (stepInBar === 13 || stepInBar === 14 || stepInBar === 15))) {
      this.scheduleMarchSnare(ctx, dest, time, stepInBar === 4 || stepInBar === 12 ? 0.12 : 0.08);
    }

    // 3) Sparkling celebratory bell arpeggio on eighth-note upbeats
    if (stepInBar % 4 === 2) {
      const chord = VICTORY_CHORDS[barIdx];
      if (chord) {
        const bellNote = chord.notes[(stepInBar / 2) % chord.notes.length] * 2;
        this.scheduleBellSparkle(ctx, dest, bellNote, time, 0.055);
      }
    }

    // 4) Heroic brass fanfare melody
    for (let i = 0; i < VICTORY_MELODY.length; i++) {
      const note = VICTORY_MELODY[i];
      if (note.step === step) {
        this.scheduleBrassVoice(ctx, dest, note.freq, time, note.dur * STEP_SEC * 0.94, 0.145 * note.vel);
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
    // Dual slightly detuned sawtooth + triangle through dynamic resonant low-pass filter = warm stadium brass
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
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 0.36);

    osc.connect(env);
    env.connect(dest);
    osc.start(startTime);
    osc.stop(startTime + 0.38);
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
    env.gain.exponentialRampToValueAtTime(0.0001, startTime + 1.15);

    src.connect(hp);
    hp.connect(env);
    env.connect(dest);
    src.start(startTime, 0.3);
    src.stop(startTime + 1.2);
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
      vGain.gain.setValueAtTime(vGain.gain.value, now);
      vGain.gain.linearRampToValueAtTime(0.0001, now + 0.45);
      window.setTimeout(() => {
        try {
          vGain.disconnect();
        } catch {
          // ignore
        }
      }, 520);
    }
  }

  // ==================== 5. LIVE COMMENTATOR & ANNOUNCER BROADCAST BUS ====================

  public async decodeWavBase64(base64: string): Promise<AudioBuffer | null> {
    const ctx = this.ensureContext();
    if (!ctx) return null;
    try {
      const binary = atob(base64);
      const len = binary.length;
      const bytes = new Uint8Array(len);
      for (let i = 0; i < len; i++) {
        bytes[i] = binary.charCodeAt(i);
      }
      return await ctx.decodeAudioData(bytes.buffer.slice(0));
    } catch {
      return null;
    }
  }

  public playCommentatorBuffer(
    buffer: AudioBuffer,
    options?: { gain?: number; duckCrowd?: boolean; onEnded?: () => void }
  ): () => void {
    const ctx = this.ensureContext();
    if (!ctx || !this.commentatorBus) {
      options?.onEnded?.();
      return () => {};
    }

    const shouldDuck = options?.duckCrowd !== false;
    const src = ctx.createBufferSource();
    src.buffer = buffer;

    const clipGain = ctx.createGain();
    clipGain.gain.setValueAtTime(options?.gain ?? 1.0, ctx.currentTime);

    src.connect(clipGain);
    clipGain.connect(this.commentatorBus);

    let finished = false;
    const cleanup = () => {
      if (finished) return;
      finished = true;
      this.activeCommentatorSources.delete(src);
      if (shouldDuck) {
        this.commentatorSpeakingCount = Math.max(0, this.commentatorSpeakingCount - 1);
        this.updateBroadcastDucking();
      }
      try {
        src.disconnect();
        clipGain.disconnect();
      } catch {
        // ignore
      }
      options?.onEnded?.();
    };

    src.onended = cleanup;
    this.activeCommentatorSources.add(src);
    if (shouldDuck) {
      this.commentatorSpeakingCount += 1;
      this.updateBroadcastDucking();
    }

    try {
      src.start(ctx.currentTime);
    } catch {
      cleanup();
    }

    return () => {
      if (finished) return;
      try {
        src.onended = null;
        src.stop();
      } catch {
        // ignore
      }
      cleanup();
    };
  }

  public setCommentatorDucking(active: boolean) {
    this.commentatorSpeakingCount = active ? 1 : 0;
    this.updateBroadcastDucking();
  }

  public stopCommentatorPlayback() {
    const sources = Array.from(this.activeCommentatorSources);
    this.activeCommentatorSources.clear();
    this.commentatorSpeakingCount = 0;
    for (const src of sources) {
      try {
        src.onended = null;
        src.stop();
        src.disconnect();
      } catch {
        // ignore
      }
    }
    this.updateBroadcastDucking();
  }

  public stopAllRaceAudio() {
    this.raceIntensity = 0;
    this.stopHeartbeat();
    this.stopCommentatorPlayback();
    this.stopAmbientCrowd();
    this.stopVictoryMusic();
  }
}

export const soundEngine = new SoundEngine();
