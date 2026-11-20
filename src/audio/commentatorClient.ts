import type { PlayerState, RoomStatus } from '../types/game';
import { soundEngine } from './soundEngine';

export interface CommentatorCaption {
  speaker: 'Raka' | 'Dimas';
  text: string;
}

export interface CommentatorSnapshot {
  roomCode: string;
  roomName: string;
  subject: string;
  grade: string;
  status: RoomStatus;
  totalLaps: number;
  questionCount: number;
  players: PlayerState[];
}

export interface CommentatorCallbacks {
  onCaption?: (caption: CommentatorCaption | null) => void;
  onSpeakingChange?: (speaking: boolean) => void;
  onError?: (errorMessage: string | null) => void;
}

const COUNTDOWN_SPOKEN: Record<number, string> = {
  5: 'Lima!',
  4: 'Empat!',
  3: 'Tiga!',
  2: 'Dua!',
  1: 'Satu!',
  0: 'Mulai! Tancap gas sekarang!',
};

function formatNameList(names: string[]): string {
  const clean = names.map((n) => n.trim()).filter(Boolean);
  if (clean.length === 0) return 'para pelari hebat kita';
  if (clean.length === 1) return clean[0];
  if (clean.length === 2) return `${clean[0]} dan ${clean[1]}`;
  return `${clean.slice(0, -1).join(', ')}, dan ${clean[clean.length - 1]}`;
}

function pickRandom<T>(items: T[], lastIndexRef?: { idx: number }): T {
  if (items.length <= 1) return items[0];
  let idx = Math.floor(Math.random() * items.length);
  if (lastIndexRef && idx === lastIndexRef.idx) {
    idx = (idx + 1) % items.length;
  }
  if (lastIndexRef) lastIndexRef.idx = idx;
  return items[idx];
}

/**
 * 100% API-Key-Free Non-Stop Indonesian Sports Broadcast Duo (Raka & Dimas)
 * Uses Browser Web Speech API with automatic selection of the most natural
 * Indonesian voices (e.g. Microsoft Ardi/Gadis Online Natural, Google Bahasa Indonesia)
 * paired with a high-energy procedural Indonesian sports commentary engine.
 */
export class CommentatorClient {
  private callbacks: CommentatorCallbacks;
  private enabled = true;
  private running = false;
  private destroyed = false;

  private snapshot: CommentatorSnapshot | null = null;
  private recentEvents: string[] = [];
  private lastLeaderId: string | null = null;
  private rosterCursor = 0;
  private segmentIndex = 0;
  private lastTemplateRef = { idx: -1 };

  private lineQueue: CommentatorCaption[] = [];
  private isSpeakingLine = false;
  private generationNonce = 0;
  private gapTimer: number | null = null;
  private watchdogTimer: number | null = null;

  private cachedVoices: SpeechSynthesisVoice[] = [];
  private rakaVoice: SpeechSynthesisVoice | null = null;
  private dimasVoice: SpeechSynthesisVoice | null = null;
  private voicesListenerBound = false;

  constructor(callbacks: CommentatorCallbacks = {}) {
    this.callbacks = callbacks;
    this.initVoices();
  }

  private hasSpeechSynthesis(): boolean {
    return typeof window !== 'undefined' && 'speechSynthesis' in window && typeof SpeechSynthesisUtterance !== 'undefined';
  }

  private initVoices() {
    if (!this.hasSpeechSynthesis()) return;

    const refresh = () => {
      const voices = window.speechSynthesis.getVoices();
      if (!voices || voices.length === 0) return;
      this.cachedVoices = voices;
      this.pickBestIndonesianVoices(voices);
    };

    refresh();

    if (!this.voicesListenerBound) {
      this.voicesListenerBound = true;
      window.speechSynthesis.addEventListener?.('voiceschanged', refresh);
    }
  }

  private pickBestIndonesianVoices(voices: SpeechSynthesisVoice[]) {
    const idVoices = voices.filter((v) => {
      const lang = (v.lang || '').toLowerCase();
      const name = (v.name || '').toLowerCase();
      return lang.startsWith('id') || name.includes('indonesia') || name.includes('indonesian');
    });

    if (idVoices.length === 0) {
      this.rakaVoice = null;
      this.dimasVoice = null;
      return;
    }

    // Score Indonesian voices so Neural / Online Natural / Google voices come first
    const scoreVoice = (v: SpeechSynthesisVoice): number => {
      const name = (v.name || '').toLowerCase();
      let score = 10;
      if (name.includes('natural')) score += 50;
      if (name.includes('online')) score += 35;
      if (name.includes('google')) score += 40;
      if (name.includes('ardi')) score += 32;
      if (name.includes('gadis')) score += 28;
      if (name.includes('damayanti')) score += 20;
      if (v.localService === false) score += 12;
      return score;
    };

    const sorted = [...idVoices].sort((a, b) => scoreVoice(b) - scoreVoice(a));
    this.rakaVoice = sorted[0] ?? null;
    this.dimasVoice = sorted[1] ?? sorted[0] ?? null;
  }

  public setEnabled(next: boolean) {
    if (this.enabled === next) return;
    this.enabled = next;
    if (!next) {
      this.haltPlayback();
      this.callbacks.onCaption?.(null);
      this.callbacks.onSpeakingChange?.(false);
    } else if (this.running && this.snapshot && this.snapshot.status !== 'countdown') {
      this.callbacks.onError?.(null);
      this.kickPipeline();
    }
  }

  public isEnabled(): boolean {
    return this.enabled;
  }

  public start() {
    if (this.destroyed) return;
    this.running = true;
    this.initVoices();
    if (this.enabled && this.snapshot && this.snapshot.status !== 'countdown') {
      this.kickPipeline();
    }
  }

  public destroy() {
    this.destroyed = true;
    this.running = false;
    this.haltPlayback();
    this.callbacks.onCaption?.(null);
    this.callbacks.onSpeakingChange?.(false);
  }

  public async preloadCountdownVoices(): Promise<void> {
    this.initVoices();
  }

  public updateSnapshot(next: CommentatorSnapshot) {
    const prevStatus = this.snapshot?.status;
    this.snapshot = next;

    // Detect leader overtake automatically during race
    if (next.status === 'playing' && next.players.length >= 2) {
      const sorted = [...next.players].sort((a, b) => b.progress - a.progress || b.score - a.score);
      const leader = sorted[0];
      if (leader && leader.progress > 0.02) {
        if (this.lastLeaderId && this.lastLeaderId !== leader.id) {
          this.pushEvent(`${leader.name} baru saja MENYALIP ke posisi PERTAMA!`);
        }
        this.lastLeaderId = leader.id;
      }
    }

    if (prevStatus !== next.status) {
      if (next.status === 'countdown') {
        this.haltPlayback();
        this.callbacks.onCaption?.(null);
        this.callbacks.onSpeakingChange?.(false);
      } else if (next.status === 'playing' && prevStatus === 'countdown') {
        this.pushEvent('PISTOL START BERBUNYI! Seluruh pelari melesat kencang meninggalkan garis start!');
        this.lineQueue = [];
        if (this.running && this.enabled) {
          this.clearGapTimer();
          this.gapTimer = window.setTimeout(() => {
            this.gapTimer = null;
            if (!this.destroyed && this.running && this.enabled && this.snapshot?.status === 'playing') {
              this.kickPipeline();
            }
          }, 1150);
        }
      } else if (next.status === 'finished') {
        this.pushEvent('BALAPAN SELESAI! Para juara berjalan menuju podium tengah stadion!');
        this.haltPlayback();
        if (this.running && this.enabled) {
          this.kickPipeline();
        }
      } else if (this.running && this.enabled && !this.isSpeakingLine) {
        this.kickPipeline();
      }
    } else if (
      this.running &&
      this.enabled &&
      next.status !== 'countdown' &&
      !this.isSpeakingLine &&
      this.gapTimer === null
    ) {
      this.kickPipeline();
    }
  }

  public pushEvent(eventText: string) {
    const clean = eventText.trim();
    if (!clean) return;
    this.recentEvents.push(clean);
    if (this.recentEvents.length > 8) {
      this.recentEvents = this.recentEvents.slice(-8);
    }
  }

  public playCountdownVoice(value: number) {
    if (!this.enabled || soundEngine.muted) return;
    const text = COUNTDOWN_SPOKEN[value];
    if (!text || !this.hasSpeechSynthesis()) return;

    this.initVoices();
    try {
      window.speechSynthesis.cancel();
      const utter = new SpeechSynthesisUtterance(text);
      utter.lang = 'id-ID';
      if (this.rakaVoice) utter.voice = this.rakaVoice;
      utter.rate = value === 0 ? 1.18 : 1.05;
      utter.pitch = value === 0 ? 1.16 : 0.96 + (5 - value) * 0.03;
      utter.volume = Math.min(1, soundEngine.volume + 0.15);

      soundEngine.setCommentatorDucking(true);
      utter.onend = () => soundEngine.setCommentatorDucking(false);
      utter.onerror = () => soundEngine.setCommentatorDucking(false);
      window.speechSynthesis.speak(utter);
    } catch {
      // Countdown synth tones and starting pistol still play cleanly
    }
  }

  private clearGapTimer() {
    if (this.gapTimer !== null) {
      window.clearTimeout(this.gapTimer);
      this.gapTimer = null;
    }
  }

  private clearWatchdogTimer() {
    if (this.watchdogTimer !== null) {
      window.clearTimeout(this.watchdogTimer);
      this.watchdogTimer = null;
    }
  }

  private haltPlayback() {
    this.generationNonce += 1;
    this.clearGapTimer();
    this.clearWatchdogTimer();
    this.lineQueue = [];
    this.isSpeakingLine = false;
    soundEngine.setCommentatorDucking(false);
    if (this.hasSpeechSynthesis()) {
      try {
        window.speechSynthesis.cancel();
      } catch {
        // ignore
      }
    }
  }

  private pickSpotlightBatch(allNames: string[], batchSize = 4): string[] {
    if (allNames.length === 0) return [];
    if (allNames.length <= batchSize) return [...allNames];
    const picked: string[] = [];
    for (let i = 0; i < batchSize; i++) {
      picked.push(allNames[(this.rosterCursor + i) % allNames.length]);
    }
    this.rosterCursor = (this.rosterCursor + batchSize) % allNames.length;
    return picked;
  }

  private generateBroadcastBatch(): CommentatorCaption[] {
    const snap = this.snapshot;
    if (!snap) return [];

    const allNames = snap.players.map((p) => p.name).filter(Boolean);
    const playerCount = allNames.length;
    const spotlight = this.pickSpotlightBatch(allNames, snap.status === 'waiting' ? 5 : 4);
    const spotlightStr = formatNameList(spotlight);
    const seg = this.segmentIndex++;

    // ==================== PHASE 1: WAITING (PRA-BALAPAN) ====================
    if (snap.status === 'waiting') {
      if (playerCount === 0) {
        return pickRandom(
          [
            [
              {
                speaker: 'Raka',
                text: `Selamat datang di stadion megah ${snap.roomName}! Lintasan atletik internasional sudah siap menyambut duel cepat ${snap.subject} kelas ${snap.grade}!`,
              },
              {
                speaker: 'Dimas',
                text: `Betul banget Bung Raka! ${snap.totalLaps} putaran dan ${snap.questionCount} gerbang soal menanti, ayo segera masuk ke lintasan!`,
              },
            ],
            [
              {
                speaker: 'Raka',
                text: `Tribun stadion mulai bergemuruh! Para juara ${snap.subject} tinggal melangkah ke garis start untuk lomba ${snap.questionCount} soal ini!`,
              },
              {
                speaker: 'Dimas',
                text: `Siapkan fokus dan kecepatan terbaik kalian, karena setiap jawaban benar langsung kasih dorongan speed boost kencang!`,
              },
            ],
          ],
          this.lastTemplateRef
        );
      }

      const waitingTemplates: CommentatorCaption[][] = [
        [
          {
            speaker: 'Raka',
            text: `Luar biasa meriah suasana stadion ${snap.roomName}! Sudah ada ${playerCount} pelari tangguh di garis start untuk adu cepat ${snap.subject}!`,
          },
          {
            speaker: 'Dimas',
            text: `Lihat tuh Bung Raka, di lintasan sudah bersiap ${spotlightStr}! Tatapan mereka tajam banget siap tancap gas!`,
          },
          {
            speaker: 'Raka',
            text: `Ingat ya, total ${snap.totalLaps} putaran dengan ${snap.questionCount} soal! Begitu pistol start berbunyi, langsung melesat secepat kilat!`,
          },
          {
            speaker: 'Dimas',
            text: `Betul sekali! Penonton di seluruh tribun sudah tidak sabar melihat siapa yang bakal naik podium juara satu hari ini!`,
          },
        ],
        [
          {
            speaker: 'Dimas',
            text: `Bung Raka, merinding banget dengar sorakan penonton di stadion internasional ini! ${playerCount} peserta sudah pemanasan di lintasan masing-masing!`,
          },
          {
            speaker: 'Raka',
            text: `Kita sapa dulu atlet-atlet andalan kelas ${snap.grade} yang sudah siap berlaga: ada ${spotlightStr}!`,
          },
          {
            speaker: 'Dimas',
            text: `Keren-keren semua nih! Jawab soal ${snap.subject} dengan cepat dan tepat biar lari makin ngebut tanpa hambatan!`,
          },
          {
            speaker: 'Raka',
            text: `Semua mata tertuju ke garis start sekarang, tinggal tunggu aba-aba hitungan mundur untuk memulai balapan spektakuler!`,
          },
        ],
        [
          {
            speaker: 'Raka',
            text: `Selamat datang kembali di siaran langsung ${snap.roomName}! Atmosfer benar-benar panas menjelang start lomba ${snap.subject}!`,
          },
          {
            speaker: 'Dimas',
            text: `Sorotan kamera kita arahkan ke ${spotlightStr} yang terlihat sangat percaya diri di jalur start!`,
          },
          {
            speaker: 'Raka',
            text: `Dengan ${snap.questionCount} gerbang soal sepanjang ${snap.totalLaps} putaran, strategi kecepatan dan ketepatan jadi kunci utama!`,
          },
          {
            speaker: 'Dimas',
            text: `Ayo semangat semua peserta! Tunjukkan kemampuan terbaik kalian di hadapan seisi stadion!`,
          },
        ],
      ];

      return pickRandom(waitingTemplates, this.lastTemplateRef);
    }

    // ==================== PHASE 3: FINISHED (PODIUM JUARA 1, 2, 3, 4) ====================
    if (snap.status === 'finished') {
      const ranked = [...snap.players].sort((a, b) => {
        const ra = a.scoreRank ?? Number.MAX_SAFE_INTEGER;
        const rb = b.scoreRank ?? Number.MAX_SAFE_INTEGER;
        if (ra !== rb) return ra - rb;
        return b.score - a.score;
      });
      const p1 = ranked[0];
      const p2 = ranked[1];
      const p3 = ranked[2];
      const p4 = ranked[3];

      const podiumCallout = [
        p1 ? `Juara satu ${p1.name} dengan skor ${p1.score}` : null,
        p2 ? `Juara dua ${p2.name}` : null,
        p3 ? `Juara tiga ${p3.name}` : null,
        p4 ? `dan peringkat empat ${p4.name}` : null,
      ]
        .filter(Boolean)
        .join(', ');

      const finishedTemplates: CommentatorCaption[][] = [
        [
          {
            speaker: 'Raka',
            text: `Luar biasa! Pertandingan ${snap.roomName} resmi berakhir dengan sangat spektakuler! Para juara berjalan gagah menuju podium di tengah stadion!`,
          },
          {
            speaker: 'Dimas',
            text: `Selamat besar untuk para peraih podium: ${podiumCallout}! Tepuk tangan gemuruh dari seluruh penjuru stadion!`,
          },
          {
            speaker: 'Raka',
            text: p1
              ? `Lihat ${p1.name} mengangkat piala juara satu tinggi-tinggi di puncak podium! Penampilan yang benar-benar dominan di pelajaran ${snap.subject}!`
              : `Momen pengangkatan piala yang luar biasa membanggakan di tengah stadion internasional!`,
          },
          {
            speaker: 'Dimas',
            text: `Apresiasi tinggi juga untuk perjuangan hebat dari ${spotlightStr}! Semua peserta hari ini adalah juara sejati!`,
          },
        ],
        [
          {
            speaker: 'Dimas',
            text: `Bung Raka, meriah sekali perayaan podium kejuaraan hari ini! Kembang api dan sorakan penonton mengiringi para pemenang!`,
          },
          {
            speaker: 'Raka',
            text: p1
              ? `Benar banget Bung Dimas! ${p1.name} tampil gemilang merebut gelar juara pertama${p2 ? `, dibayangi ketat oleh ${p2.name} di posisi kedua` : ''}${p3 ? ` dan ${p3.name} di posisi ketiga` : ''}!`
              : `Semua peserta sudah menyelesaikan tantangan ${snap.subject} dengan penuh semangat!`,
          },
          {
            speaker: 'Dimas',
            text: p4
              ? `Tidak lupa ${p4.name} yang berhasil mengamankan tempat keempat di podium kehormatan! Keren banget perjuangannya!`
              : `Kecepatan lari dan ketepatan menjawab soal hari ini benar-benar kelas dunia!`,
          },
          {
            speaker: 'Raka',
            text: `Terima kasih juga untuk aksi seru dari ${spotlightStr}! Sampai jumpa di kejuaraan berikutnya!`,
          },
        ],
      ];

      return pickRandom(finishedTemplates, this.lastTemplateRef);
    }

    // ==================== PHASE 2: PLAYING (NON-STOP LIVE PLAY-BY-PLAY) ====================
    const sorted = [...snap.players].sort((a, b) => b.progress - a.progress || b.score - a.score);
    const leader1 = sorted[0];
    const leader2 = sorted[1];
    const leader3 = sorted[2];
    const boostingPlayers = sorted.filter((p) => p.effectState === 'boost');
    const penaltyPlayers = sorted.filter((p) => p.effectState === 'penalty');
    const pendingEvent = this.recentEvents.shift();

    const lines: CommentatorCaption[] = [];

    // Turn 1: React immediately to freshest live event OR intense leader action
    if (pendingEvent) {
      lines.push({
        speaker: 'Raka',
        text: `Wah lihat itu Bung Dimas! ${pendingEvent} Suasana stadion langsung meledak sorak-sorai!`,
      });
    } else if (leader1 && leader2) {
      const pct1 = Math.round(leader1.progress * 100);
      const gapPct = Math.max(0, Math.round((leader1.progress - leader2.progress) * 100));
      lines.push({
        speaker: 'Raka',
        text:
          gapPct <= 4
            ? `Sengit banget di barisan depan! ${leader1.name} dan ${leader2.name} saling kejar ketat di progres ${pct1} persen! Susul-menyusul luar biasa!`
            : `${leader1.name} memimpin kencang di lintasan ${leader1.lane + 1} dengan progres ${pct1} persen dan skor ${leader1.score}, dibuntuti ketat oleh ${leader2.name}!`,
      });
    } else if (leader1) {
      lines.push({
        speaker: 'Raka',
        text: `${leader1.name} melaju kencang di lintasan ${leader1.lane + 1}! Sudah mencapai ${Math.round(leader1.progress * 100)} persen dengan raihan skor ${leader1.score}!`,
      });
    } else {
      lines.push({
        speaker: 'Raka',
        text: `Balapan ${snap.subject} terus memanas di lintasan stadion internasional! Semua pelari tancap gas menuju gerbang soal berikutnya!`,
      });
    }

    // Turn 2: Co-commentator Dimas reacts to speed boost / penalty / tight pack
    if (boostingPlayers.length > 0) {
      const b = boostingPlayers[0];
      lines.push({
        speaker: 'Dimas',
        text: `Gila sih kecepatan ${b.name}! Baru saja dapat speed boost setelah menjawab tepat, langsung melesat bagai roket meninggalkan lawan!`,
      });
    } else if (penaltyPlayers.length > 0) {
      const pen = penaltyPlayers[0];
      lines.push({
        speaker: 'Dimas',
        text: `Waduh, ${pen.name} sedikit melambat sesaat! Ayo jangan menyerah, masih banyak gerbang soal ${snap.subject} untuk membalikkan keadaan!`,
      });
    } else if (leader3) {
      lines.push({
        speaker: 'Dimas',
        text: `Betul Bung Raka! Jangan lupakan ${leader3.name} di posisi ketiga dengan skor ${leader3.score}, satu jawaban benar lagi bisa langsung nyalip ke papan atas!`,
      });
    } else {
      lines.push({
        speaker: 'Dimas',
        text: `Tempo lari benar-benar cepat banget! Setiap detik sangat menentukan siapa yang pertama menembus garis finis!`,
      });
    }

    // Turn 3: Spotlight batch of players so EVERY player gets mentioned on air
    const spotlightTemplates = [
      `Kita pantau juga pergerakan ${spotlightStr} yang terus memacu langkah dengan penuh determinasi di lintasan masing-masing!`,
      `Sorotan langsung ke ${spotlightStr}! Fokus penuh menatap gerbang soal ${snap.subject} di depan mata!`,
      `Dari tengah rombongan, ${spotlightStr} tampil pantang menyerah dan terus mengejar ketertinggalan menuju podium juara!`,
      `Ayo kasih semangat untuk ${spotlightStr}! Semua masih punya peluang emas meraih nilai maksimal di ${snap.totalLaps} putaran ini!`,
    ];
    lines.push({
      speaker: 'Raka',
      text: spotlightTemplates[seg % spotlightTemplates.length],
    });

    // Turn 4: Dimas high-energy wrap & bridge into next non-stop segment
    const bridgeTemplates = [
      `Penonton di tribun terus bergemuruh tanpa henti! Persaingan perebutan juara satu, dua, tiga, dan empat makin mendebarkan!`,
      `Luar biasa antusiasme kelas ${snap.grade} hari ini! Jawab cepat, tepat, dan raih speed boost menuju garis finis!`,
      `Belum ada yang aman di papan skor! Satu gerbang soal saja bisa mengubah seluruh peta klasemen dalam sekejap!`,
      `Mantap banget aksi para pelari kita! Siapa yang bakal jadi penguasa lintasan ${snap.roomName} kali ini? Kita kawal terus!`,
    ];
    lines.push({
      speaker: 'Dimas',
      text: bridgeTemplates[seg % bridgeTemplates.length],
    });

    return lines;
  }

  private kickPipeline() {
    if (this.destroyed || !this.running || !this.enabled || !this.snapshot) return;
    if (this.snapshot.status === 'countdown') return;
    if (this.isSpeakingLine) return;

    if (this.lineQueue.length === 0) {
      this.lineQueue = this.generateBroadcastBatch();
    }

    const nextLine = this.lineQueue.shift();
    if (!nextLine) return;

    this.speakLine(nextLine, this.generationNonce);
  }

  private speakLine(line: CommentatorCaption, nonce: number) {
    if (nonce !== this.generationNonce || this.destroyed || !this.running || !this.enabled) return;

    this.isSpeakingLine = true;
    this.callbacks.onCaption?.(line);
    this.callbacks.onSpeakingChange?.(true);

    const finishLine = () => {
      this.clearWatchdogTimer();
      if (nonce !== this.generationNonce || this.destroyed) return;
      this.isSpeakingLine = false;
      soundEngine.setCommentatorDucking(false);

      if (!this.running || !this.enabled || !this.snapshot || this.snapshot.status === 'countdown') {
        this.callbacks.onSpeakingChange?.(false);
        this.callbacks.onCaption?.(null);
        return;
      }

      // Snappy 140ms banter handoff between Raka and Dimas for non-stop lively broadcast!
      const pauseMs = this.lineQueue.length > 0 ? 140 : 320;
      this.clearGapTimer();
      this.gapTimer = window.setTimeout(() => {
        this.gapTimer = null;
        if (nonce !== this.generationNonce || this.destroyed) return;
        this.kickPipeline();
      }, pauseMs);
    };

    const estimatedDurationMs = Math.max(2400, Math.min(9500, line.text.length * 68));

    // If audio is muted or Web Speech API is unavailable, still run smooth live broadcast captions
    if (soundEngine.muted || !this.hasSpeechSynthesis()) {
      this.clearWatchdogTimer();
      this.watchdogTimer = window.setTimeout(finishLine, estimatedDurationMs);
      return;
    }

    this.initVoices();

    try {
      const utter = new SpeechSynthesisUtterance(line.text);
      utter.lang = 'id-ID';
      const chosenVoice = line.speaker === 'Raka' ? this.rakaVoice : this.dimasVoice;
      if (chosenVoice) utter.voice = chosenVoice;

      // Distinct energetic TV duo profiles: Raka (fast bright play-by-play) & Dimas (lively punchy co-host)
      const hasTwoDistinctVoices = Boolean(
        this.rakaVoice && this.dimasVoice && this.rakaVoice.name !== this.dimasVoice.name
      );
      if (line.speaker === 'Raka') {
        utter.rate = 1.13;
        utter.pitch = hasTwoDistinctVoices ? 1.02 : 1.07;
      } else {
        utter.rate = 1.16;
        utter.pitch = hasTwoDistinctVoices ? 1.0 : 0.93;
      }
      utter.volume = Math.min(1, soundEngine.volume + 0.12);

      let settled = false;
      const settleOnce = () => {
        if (settled) return;
        settled = true;
        finishLine();
      };

      utter.onstart = () => {
        if (nonce === this.generationNonce && !this.destroyed) {
          soundEngine.setCommentatorDucking(true);
        }
      };
      utter.onend = settleOnce;
      utter.onerror = settleOnce;

      // Safety watchdog in case a mobile browser skips onend
      this.clearWatchdogTimer();
      this.watchdogTimer = window.setTimeout(settleOnce, estimatedDurationMs + 4500);

      // Chrome quirk guard: resume if paused
      if (window.speechSynthesis.paused) {
        window.speechSynthesis.resume();
      }
      window.speechSynthesis.speak(utter);
    } catch {
      this.clearWatchdogTimer();
      this.watchdogTimer = window.setTimeout(finishLine, estimatedDurationMs);
    }
  }
}
