import {
  collection,
  deleteDoc,
  doc,
  getDoc,
  getDocs,
  onSnapshot,
  query,
  serverTimestamp,
  setDoc,
  Timestamp,
  updateDoc,
  where,
  writeBatch,
  type Unsubscribe,
} from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import type {
  AnswerReviewItem,
  AvatarConfig,
  PlayerState,
  QuestionItem,
  QuestionType,
  RaceVenueId,
  RoomSettings,
  RoomStatus,
  RoomSummary,
  RunnerEffectState,
  TeacherProfile,
} from '../types/game';
import {
  MAX_MATCH_SCORE,
  calcPointsPerQuestion,
  calcQuestionGateProgress,
  calcScoreFromCorrect,
  calcTotalLaps,
  calcTrackLength,
} from '../utils/matchScaling';
import {
  generateMatchExcelBlob,
  triggerBlobDownload,
  type ExcelAnswerDetailRow,
  type ExcelParticipantRow,
  type ExcelQuestionAnalysisRow,
  type ExcelRoomMeta,
} from './browserExcelExport';
import {
  publishRelayParticipantPatch,
  publishRelayRoomPatch,
  setGlobalRelayClockHandler,
  subscribeRelayRoom,
  type LiveRelayParticipantPatch,
  type LiveRelayRoomPatch,
} from './liveRelayClient';
import {
  POSITION_RATE_LIMIT_CONFIG,
  cancelParticipantPositionSync,
  clearRoomPositionSync,
  markAuthoritativeParticipantWrite,
  scheduleRateLimitedPositionWrite,
  type PositionSyncSnapshot,
  type RateLimitScheduleResult,
} from './firebasePositionRateLimiter';

export {
  POSITION_RATE_LIMIT_CONFIG,
  cancelParticipantPositionSync,
  clearRoomPositionSync,
  type PositionSyncSnapshot,
  type RateLimitScheduleResult,
};

export interface StoredRoomQuestion {
  id: string;
  subject: string;
  grade: string;
  questionType: QuestionType;
  prompt: string;
  options: { A?: string; B?: string; C?: string; D?: string };
  correctAnswer: string;
  explanation: string;
}

export interface StoredAnswerRecord {
  questionIndex: number;
  questionId: string;
  submittedAnswer: string | null;
  isCorrect: boolean;
  isTimeout: boolean;
  pointsEarned: number;
  responseTimeMs: number;
}

export interface LiveFirebaseRoom {
  id: string; // same as roomCode
  code: string;
  roomCode: string;
  ownerId: string;
  name: string;
  roomName: string;
  teacherName: string;
  schoolName: string;
  subject: string;
  grade: string;
  status: RoomStatus;
  settings: RoomSettings;
  questionCount: number;
  totalLaps: number;
  pointsPerQuestion: number;
  maxScore: number;
  trackLength: number;
  questions: StoredRoomQuestion[];
  participantCount: number;
  countdownStartMs: number;
  startedAtMs: number;
  finishedAtMs: number;
  musicTrack?: 'semangat_juara' | 'lari_ceria' | 'turbo_arena';
  createdAtIso: string;
}

export interface LiveFirebaseParticipant extends PlayerState {
  roomCode: string;
  reconnectToken: string;
  lastSyncMs: number;
  answers: StoredAnswerRecord[];
}

export interface FirebaseRoomResultBundle {
  room: {
    id: string;
    code: string;
    name: string;
    subject: string;
    grade: string;
    teacherName: string;
    schoolName: string;
    status: RoomStatus;
    questionCount: number;
    totalLaps: number;
    pointsPerQuestion: number;
    maxScore: number;
    createdAtIso: string;
    finishedAtMs: number;
  };
  byScore: LiveFirebaseParticipant[];
  byFinish: LiveFirebaseParticipant[];
  questionAnalysis: ExcelQuestionAnalysisRow[];
  answerDetails: ExcelAnswerDetailRow[];
  review: AnswerReviewItem[];
}

const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

// ==================== UNIFIED MULTI-LAYER SERVER CLOCK SYNCHRONIZATION ====================
// Priority order for sub-15ms Teacher <-> Student alignment:
// 1. WebSocket live:pong NTP samples (lowest RTT wins, ~2-10ms accuracy)
// 2. High-precision GET /api/time (3 rapid samples, lowest RTT wins, ~5-15ms accuracy)
// 3. Firestore serverTimestamp() round-trip calibration (fallback on static hosting)
// 4. HTTP Date header fallback
let serverClockOffsetMs = 0;
let bestClockRttMs = Infinity;
let clockCalibrated = false;
let preciseClockLocked = false;
let clockCalibrationInFlight: Promise<void> | null = null;
let clockLifecycleBound = false;
const pendingClockProbes = new Map<string, number>();

export function getSyncedNowMs(): number {
  return Date.now() + serverClockOffsetMs;
}

function applyPreciseClockSample(measuredOffsetMs: number, rttMs: number) {
  if (!Number.isFinite(measuredOffsetMs) || !Number.isFinite(rttMs) || rttMs < 0 || rttMs > 3000) {
    return;
  }
  if (!preciseClockLocked || rttMs <= bestClockRttMs + 25) {
    bestClockRttMs = Math.min(bestClockRttMs, rttMs);
    const next = !preciseClockLocked
      ? measuredOffsetMs
      : Math.round(serverClockOffsetMs * 0.65 + measuredOffsetMs * 0.35);
    // Avoid micro-jitter when device clock is already within 25ms of server
    serverClockOffsetMs = Math.abs(next) < 25 ? 0 : next;
    preciseClockLocked = true;
    clockCalibrated = true;
  }
}

setGlobalRelayClockHandler((offsetMs, rttMs) => {
  applyPreciseClockSample(offsetMs, rttMs);
});

function markPendingClockWrite(docKey: string) {
  pendingClockProbes.set(docKey, Date.now());
  if (pendingClockProbes.size > 32) {
    const firstKey = pendingClockProbes.keys().next().value;
    if (firstKey) pendingClockProbes.delete(firstKey);
  }
}

function tryCalibrateFromServerWrite(docKey: string, serverUpdatedAtMs: number) {
  if (!serverUpdatedAtMs || serverUpdatedAtMs <= 0) return;
  const sentLocalMs = pendingClockProbes.get(docKey);
  if (sentLocalMs === undefined) return;
  pendingClockProbes.delete(docKey);

  const recvLocalMs = Date.now();
  const rtt = recvLocalMs - sentLocalMs;
  if (rtt < 0 || rtt > 5000) return;

  // Prefer /api/time or WS clock if already locked at low RTT
  if (preciseClockLocked && bestClockRttMs < 150) return;

  const estimatedLocalAtServerWrite = sentLocalMs + rtt * 0.5;
  const measuredOffset = Math.round(serverUpdatedAtMs - estimatedLocalAtServerWrite);
  if (!preciseClockLocked) {
    serverClockOffsetMs = Math.abs(measuredOffset) < 100 ? 0 : measuredOffset;
    preciseClockLocked = true;
    clockCalibrated = true;
  } else {
    const blended = Math.round(serverClockOffsetMs * 0.65 + measuredOffset * 0.35);
    serverClockOffsetMs = Math.abs(blended) < 100 ? 0 : blended;
  }
}

function ensureClockLifecycleHooks() {
  if (clockLifecycleBound || typeof window === 'undefined') return;
  clockLifecycleBound = true;
  const recalibrate = () => {
    clockCalibrated = false;
    bestClockRttMs = Infinity;
    calibrateServerClock().catch(() => {});
  };
  window.addEventListener('online', recalibrate);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      recalibrate();
    }
  });
}

export function calibrateServerClock(): Promise<void> {
  ensureClockLifecycleHooks();
  if (clockCalibrated && preciseClockLocked) return Promise.resolve();
  if (clockCalibrationInFlight) return clockCalibrationInFlight;
  if (typeof window === 'undefined' || typeof fetch !== 'function') {
    clockCalibrated = true;
    return Promise.resolve();
  }

  clockCalibrationInFlight = (async () => {
    try {
      // 1. Try high-precision /api/time (3 rapid samples, pick lowest RTT)
      let apiTimeSucceeded = false;
      for (let attempt = 0; attempt < 3; attempt++) {
        try {
          const t0 = Date.now();
          const res = await fetch(`${window.location.origin}/api/time?n=${t0}`, {
            method: 'GET',
            cache: 'no-store',
          });
          const t1 = Date.now();
          if (res.ok) {
            const data = (await res.json()) as { serverTime?: number };
            if (typeof data.serverTime === 'number' && data.serverTime > 1_700_000_000_000) {
              const rtt = Math.max(0, t1 - t0);
              const offset = Math.round(data.serverTime - (t0 + rtt * 0.5));
              applyPreciseClockSample(offset, rtt);
              apiTimeSucceeded = true;
              if (rtt < 35) break; // Already ultra-tight lock
            }
          } else {
            break;
          }
        } catch {
          break;
        }
      }

      // 2. Fallback to HTTP Date header when hosted on static edge without /api/time
      if (!apiTimeSucceeded && !preciseClockLocked) {
        const t0 = Date.now();
        const res = await fetch(`${window.location.origin}/?clock=${t0}`, {
          method: 'HEAD',
          cache: 'no-store',
        });
        const t1 = Date.now();
        const dateHeader = res.headers.get('date');
        if (dateHeader) {
          const serverMs = Date.parse(dateHeader);
          if (Number.isFinite(serverMs) && serverMs > 1_700_000_000_000) {
            const rtt = Math.max(0, Math.min(2000, t1 - t0));
            const estimatedServerNow = serverMs + 500 + rtt / 2;
            const offset = Math.round(estimatedServerNow - t1);
            serverClockOffsetMs = Math.abs(offset) < 350 ? 0 : offset;
          }
        }
      }
    } catch {
      // Fall back safely to Firestore serverTimestamp calibration
    } finally {
      clockCalibrated = true;
      clockCalibrationInFlight = null;
    }
  })();
  return clockCalibrationInFlight;
}

// ==================== TRANSIENT FIRESTORE RETRY GUARD ====================
function isTransientFirestoreError(err: unknown): boolean {
  const code = String((err as { code?: string })?.code || '').toLowerCase();
  const msg = err instanceof Error ? err.message.toLowerCase() : String(err).toLowerCase();
  if (
    code.includes('permission-denied') ||
    code.includes('invalid-argument') ||
    code.includes('not-found') ||
    code.includes('already-exists') ||
    code.includes('resource-exhausted') ||
    msg.includes('quota exceeded') ||
    msg.includes('permission')
  ) {
    return false;
  }
  return (
    code.includes('unavailable') ||
    code.includes('deadline-exceeded') ||
    code.includes('aborted') ||
    code.includes('internal') ||
    code.includes('unknown') ||
    msg.includes('network') ||
    msg.includes('offline') ||
    msg.includes('timeout') ||
    msg.includes('failed to fetch')
  );
}

async function withFirestoreRetry<T>(fn: () => Promise<T>, maxAttempts = 3): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastError = err;
      if (attempt >= maxAttempts || !isTransientFirestoreError(err)) {
        throw err;
      }
      const delayMs = 240 * Math.pow(2, attempt - 1) + Math.floor(Math.random() * 80);
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
  }
  throw lastError;
}

function clampStr(val: unknown, maxLen: number, fallback = ''): string {
  const s = typeof val === 'string' ? val.trim() : fallback;
  return (s || fallback).slice(0, maxLen);
}

function clampInt(val: unknown, min: number, max: number, fallback: number): number {
  const n = Math.round(Number(val));
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function clampNum(val: unknown, min: number, max: number, fallback: number): number {
  const n = Number(val);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(min, Math.min(max, n));
}

function sanitizeDocId(raw: string): string {
  const clean = raw.replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 64);
  return clean || `id-${Date.now()}`;
}

export function normalizeRoomCode(raw: string): string {
  return raw.trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 6);
}

function generateRoomCode(): string {
  let code = '';
  for (let i = 0; i < 6; i++) {
    code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
  }
  return code;
}

function randomToken(len = 24): string {
  const chars = 'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let out = '';
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    const arr = new Uint8Array(len);
    crypto.getRandomValues(arr);
    for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
    return out;
  }
  for (let i = 0; i < len; i++) out += chars[Math.floor(Math.random() * chars.length)];
  return out;
}

function sanitizeVenue(v: unknown): RaceVenueId {
  if (v === 'stadium_night' || v === 'open_field') return v;
  return 'stadium_day';
}

function sanitizeRoomSettings(input?: Partial<RoomSettings>): RoomSettings {
  return {
    questionCount: clampInt(input?.questionCount, 1, 50, 10),
    maxPlayers: clampInt(input?.maxPlayers, 2, 30, 30),
    timePerQuestion: clampInt(input?.timePerQuestion, 5, 120, 20),
    baseSpeed: clampNum(input?.baseSpeed, 1.5, 15, 3),
    boostDuration: clampInt(input?.boostDuration, 3, 60, 15),
    penaltyDuration: clampInt(input?.penaltyDuration, 5, 60, 30),
    allowShortAnswer: Boolean(input?.allowShortAnswer),
    venue: sanitizeVenue(input?.venue),
    ...(input?.scheduledAt ? { scheduledAt: String(input.scheduledAt).slice(0, 40) } : {}),
  };
}

function compactRoomQuestion(q: QuestionItem, idx: number): StoredRoomQuestion {
  const cleanOpts: { A?: string; B?: string; C?: string; D?: string } = {};
  for (const k of ['A', 'B', 'C', 'D'] as const) {
    const val = q.options?.[k];
    if (typeof val === 'string' && val.trim()) {
      cleanOpts[k] = val.trim().slice(0, 180);
    }
  }
  return {
    id: sanitizeDocId(q.id || `rq-${idx}`),
    subject: clampStr(q.subject, 60, 'Umum'),
    grade: clampStr(q.grade, 30, 'Umum'),
    questionType:
      q.questionType === 'true_false' || q.questionType === 'short_answer'
        ? q.questionType
        : 'multiple_choice',
    prompt: clampStr(q.prompt, 400, 'Soal'),
    options: cleanOpts,
    correctAnswer: clampStr(q.correctAnswer, 120, 'A'),
    explanation: clampStr(q.explanation, 300, ''),
  };
}

function parseRoomDoc(id: string, data: Record<string, unknown>): LiveFirebaseRoom {
  const rawQuestions = Array.isArray(data.questions) ? (data.questions as StoredRoomQuestion[]) : [];
  const questionCount = Math.max(1, Number(data.questionCount || rawQuestions.length || 1));
  const settings = sanitizeRoomSettings(data.settings as Partial<RoomSettings> | undefined);
  settings.questionCount = questionCount;
  const createdTs = data.createdAt as Timestamp | undefined;
  const createdAtIso =
    createdTs && typeof createdTs.toDate === 'function'
      ? createdTs.toDate().toISOString()
      : new Date().toISOString();

  const updatedTs = data.updatedAt as Timestamp | undefined;
  const updatedAtMs =
    updatedTs && typeof updatedTs.toMillis === 'function' ? updatedTs.toMillis() : 0;

  let countdownStartMs = Number(data.countdownStartMs || 0);
  let startedAtMs = Number(data.startedAtMs || 0);
  const status = String(data.status || 'waiting') as RoomStatus;

  // Self-heal Teacher device clock skew during countdown using Firestore's authoritative serverTimestamp
  if (
    status === 'countdown' &&
    updatedAtMs > 0 &&
    countdownStartMs > 0 &&
    startedAtMs > countdownStartMs &&
    Math.abs(updatedAtMs - countdownStartMs) > 300
  ) {
    const skewShift = updatedAtMs - countdownStartMs;
    countdownStartMs += skewShift;
    startedAtMs += skewShift;
  }

  const roomCode = String(data.roomCode || id).toUpperCase();
  const roomName = String(data.roomName || 'Pertandingan EduRun');

  return {
    id: roomCode,
    code: roomCode,
    roomCode,
    ownerId: String(data.ownerId || ''),
    name: roomName,
    roomName,
    teacherName: String(data.teacherName || 'Guru EduRun'),
    schoolName: String(data.schoolName || 'Sekolah Nusantara'),
    subject: String(data.subject || 'Umum'),
    grade: String(data.grade || 'Umum'),
    status,
    settings,
    questionCount,
    totalLaps: Number(data.totalLaps || calcTotalLaps(questionCount)),
    pointsPerQuestion: Number(data.pointsPerQuestion || calcPointsPerQuestion(questionCount)),
    maxScore: MAX_MATCH_SCORE,
    trackLength: calcTrackLength(questionCount, settings.baseSpeed),
    questions: rawQuestions,
    participantCount: Number(data.participantCount || 0),
    countdownStartMs,
    startedAtMs,
    finishedAtMs: Number(data.finishedAtMs || 0),
    createdAtIso,
  };
}

function parseParticipantDoc(id: string, data: Record<string, unknown>): LiveFirebaseParticipant {
  const rawAvatar = (data.avatar && typeof data.avatar === 'object'
    ? data.avatar
    : { gender: 'male', color: 'blue', outfit: 'sprinter' }) as AvatarConfig;

  const startedAtNum = Number(data.startedAt || 0);
  const finishedAtNum = Number(data.finishedAt || 0);
  const durationMsNum = Number(data.durationMs || 0);
  const finishRankNum = Number(data.finishRank || 0);
  const scoreRankNum = Number(data.scoreRank || 0);
  const answeredCount = Number(data.answeredCount || 0);

  const updatedTs = data.updatedAt as Timestamp | undefined;
  const updatedAtMs =
    updatedTs && typeof updatedTs.toMillis === 'function' ? updatedTs.toMillis() : 0;
  const createdTs = data.createdAt as Timestamp | undefined;
  const createdAtMs =
    createdTs && typeof createdTs.toMillis === 'function'
      ? createdTs.toMillis()
      : Number(data.joinedAtMs || 0);

  let lastSyncMs = Number(data.lastSyncMs || 0);
  let effectExpiresAt = Number(data.effectExpiresAt || 0);

  // Self-heal Student device clock skew using Firestore's authoritative serverTimestamp (sub-250ms alignment)
  if (
    updatedAtMs > 0 &&
    lastSyncMs > 0 &&
    Math.abs(updatedAtMs - lastSyncMs) > 250
  ) {
    const skewShift = updatedAtMs - lastSyncMs;
    lastSyncMs += skewShift;
    if (effectExpiresAt > 0) {
      effectExpiresAt += skewShift;
    }
  }

  return {
    id: String(data.id || id),
    roomCode: String(data.roomCode || ''),
    reconnectToken: String(data.reconnectToken || ''),
    name: String(data.name || 'Peserta'),
    className: String(data.className || '-'),
    avatar: rawAvatar,
    lane: Number(data.lane || 0),
    distance: Number(data.distance || 0),
    progress: Number(data.progress || 0),
    speed: Number(data.speed || 0),
    effectState: (String(data.effectState || 'normal') as RunnerEffectState),
    effectExpiresAt,
    currentQuestionIndex: Number(data.currentQuestionIndex || 0),
    answeredCount,
    correctCount: Number(data.correctCount || 0),
    wrongCount: Number(data.wrongCount || 0),
    unansweredCount: Number(data.unansweredCount || 0),
    score: Number(data.score || 0),
    connected: Boolean(data.connected ?? true),
    joinedAtMs: createdAtMs > 0 ? createdAtMs : undefined,
    startedAt: startedAtNum > 0 ? startedAtNum : undefined,
    finishedAt: finishedAtNum > 0 ? finishedAtNum : undefined,
    durationMs: durationMsNum > 0 ? durationMsNum : undefined,
    finishRank: finishRankNum > 0 ? finishRankNum : undefined,
    scoreRank: scoreRankNum > 0 ? scoreRankNum : undefined,
    lastSyncMs,
    answers: Array.isArray(data.answers) ? (data.answers as StoredAnswerRecord[]) : [],
  };
}

function toRoomSummary(r: LiveFirebaseRoom): RoomSummary {
  return {
    id: r.roomCode,
    code: r.roomCode,
    name: r.roomName,
    subject: r.subject,
    grade: r.grade,
    teacherId: r.ownerId,
    teacherName: r.teacherName,
    schoolName: r.schoolName,
    status: r.status,
    settings: r.settings,
    questionCount: r.questionCount,
    totalLaps: r.totalLaps,
    pointsPerQuestion: r.pointsPerQuestion,
    maxScore: MAX_MATCH_SCORE,
    participantCount: r.participantCount,
    createdAt: r.createdAtIso,
    startedAt: r.startedAtMs > 0 ? new Date(r.startedAtMs).toISOString() : undefined,
    finishedAt: r.finishedAtMs > 0 ? new Date(r.finishedAtMs).toISOString() : undefined,
  };
}

// ==================== 1. TEACHER ROOM MANAGEMENT ====================

export async function createFirebaseRoom(params: {
  ownerId: string;
  teacher: TeacherProfile;
  name: string;
  subject: string;
  grade: string;
  settings: RoomSettings;
  allQuestions: QuestionItem[];
  questionIds?: string[];
  scheduledAt?: string;
}): Promise<LiveFirebaseRoom> {
  const cleanOwnerId = sanitizeDocId(params.ownerId);
  const cleanSettings = sanitizeRoomSettings({
    ...params.settings,
    scheduledAt: params.scheduledAt || params.settings.scheduledAt,
  });

  // Select questions (manual selection or automatic smart match)
  let chosen: QuestionItem[] = [];
  if (params.questionIds && params.questionIds.length > 0) {
    const byId = new Map(params.allQuestions.map((q) => [q.id, q]));
    for (const qId of params.questionIds) {
      const found = byId.get(qId);
      if (found) chosen.push(found);
    }
    chosen = chosen.slice(0, 50);
  } else {
    const eligible = params.allQuestions.filter(
      (q) => cleanSettings.allowShortAnswer || q.questionType !== 'short_answer'
    );
    const subjectLower = params.subject.trim().toLowerCase();
    const matched = eligible.filter((q) => q.subject.trim().toLowerCase() === subjectLower);
    const others = eligible.filter((q) => q.subject.trim().toLowerCase() !== subjectLower);

    // Shuffle copies gently so rooms vary while prioritizing requested subject
    const shuffle = <T,>(arr: T[]) => [...arr].sort(() => Math.random() - 0.5);
    const pool = [...shuffle(matched), ...shuffle(others)];
    chosen = pool.slice(0, Math.min(50, Math.max(1, cleanSettings.questionCount)));
  }

  if (chosen.length === 0) {
    throw new Error(
      'Bank Soal Anda masih kosong atau belum ada soal yang cocok. Muat 50 Soal Contoh atau tambah soal terlebih dahulu.'
    );
  }

  const compactQuestions = chosen.map((q, idx) => compactRoomQuestion(q, idx));
  const questionCount = compactQuestions.length;
  cleanSettings.questionCount = questionCount;
  const totalLaps = calcTotalLaps(questionCount);
  const pointsPerQuestion = calcPointsPerQuestion(questionCount);

  // Pick a unique 6-char room code
  let roomCode = generateRoomCode();
  for (let attempt = 0; attempt < 6; attempt++) {
    const checkRef = doc(db, 'rooms', roomCode);
    const snap = await getDoc(checkRef);
    if (!snap.exists()) break;
    roomCode = generateRoomCode();
  }

  const path = `rooms/${roomCode}`;
  const payload = {
    roomCode,
    ownerId: cleanOwnerId,
    roomName: clampStr(params.name, 100, 'Pertandingan EduRun'),
    teacherName: clampStr(params.teacher.name, 100, 'Guru EduRun'),
    schoolName: clampStr(params.teacher.schoolName, 120, 'Sekolah Nusantara'),
    subject: clampStr(params.subject, 60, 'Umum'),
    grade: clampStr(params.grade, 30, 'Umum'),
    status: 'waiting' as const,
    settings: cleanSettings,
    questionCount,
    totalLaps,
    pointsPerQuestion,
    questions: compactQuestions,
    participantCount: 0,
    countdownStartMs: 0,
    startedAtMs: 0,
    finishedAtMs: 0,
    createdAt: serverTimestamp(),
    updatedAt: serverTimestamp(),
  };

  try {
    await setDoc(doc(db, 'rooms', roomCode), payload);
    return parseRoomDoc(roomCode, {
      ...payload,
      createdAt: Timestamp.now(),
      updatedAt: Timestamp.now(),
    });
  } catch (error) {
    handleFirestoreError(error, OperationType.CREATE, path);
  }
}

export async function listTeacherRooms(ownerId: string): Promise<RoomSummary[]> {
  const cleanOwnerId = sanitizeDocId(ownerId);
  const path = 'rooms';
  try {
    const snap = await getDocs(query(collection(db, 'rooms'), where('ownerId', '==', cleanOwnerId)));
    const rooms = snap.docs.map((d) => parseRoomDoc(d.id, d.data() as Record<string, unknown>));
    rooms.sort((a, b) => b.createdAtIso.localeCompare(a.createdAtIso));

    // Fetch live participant count for active rooms (waiting/countdown/playing) so dashboard is always fresh
    const summaries = await Promise.all(
      rooms.map(async (rm) => {
        if (rm.status !== 'finished') {
          try {
            const pSnap = await getDocs(
              query(collection(db, 'rooms', rm.roomCode, 'participants'), where('roomCode', '==', rm.roomCode))
            );
            rm.participantCount = pSnap.size;
          } catch {
            // fallback to cached count
          }
        }
        return toRoomSummary(rm);
      })
    );
    return summaries;
  } catch (error) {
    handleFirestoreError(error, OperationType.LIST, path);
  }
}

export function broadcastRoomMusicTrack(
  roomCode: string,
  musicTrack: 'semangat_juara' | 'lari_ceria' | 'turbo_arena'
): void {
  const code = normalizeRoomCode(roomCode);
  if (code.length !== 6) return;
  publishRelayRoomPatch(code, { musicTrack });
}

export async function startFirebaseRoom(roomCode: string, participantCount?: number): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    const pSnap =
      participantCount === undefined
        ? await withFirestoreRetry(() =>
            getDocs(query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code)))
          )
        : null;
    const count = pSnap ? pSnap.size : clampInt(participantCount, 0, 30, 0);
    if (count === 0) {
      throw new Error('Minimal harus ada 1 peserta di lobby sebelum memulai pertandingan.');
    }

    await calibrateServerClock();
    const now = getSyncedNowMs();
    const countdownDurationMs = 5000;
    const startedAtMs = now + countdownDurationMs;

    // Broadcast immediately via WebSocket fast-lane (<20ms) so all devices enter countdown together
    publishRelayRoomPatch(code, {
      status: 'countdown',
      countdownStartMs: now,
      startedAtMs,
      participantCount: count,
    });

    markPendingClockWrite(path);
    await withFirestoreRetry(() =>
      updateDoc(doc(db, 'rooms', code), {
        status: 'countdown',
        countdownStartMs: now,
        startedAtMs,
        participantCount: count,
        updatedAt: serverTimestamp(),
      })
    );
  } catch (error) {
    if (error instanceof Error && error.message.includes('Minimal harus ada')) {
      throw error;
    }
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function activatePlayingFirebaseRoom(
  roomCode: string,
  participantCount: number,
  syncedStartedAtMs?: number
): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  const cleanCount = clampInt(participantCount, 0, 30, 0);
  try {
    publishRelayRoomPatch(code, {
      status: 'playing',
      participantCount: cleanCount,
      ...(syncedStartedAtMs && syncedStartedAtMs > 0
        ? { startedAtMs: Math.round(syncedStartedAtMs) }
        : {}),
    });

    markPendingClockWrite(path);
    const updateData: Record<string, unknown> = {
      status: 'playing',
      participantCount: cleanCount,
      updatedAt: serverTimestamp(),
    };
    if (syncedStartedAtMs && syncedStartedAtMs > 0) {
      updateData.startedAtMs = Math.round(syncedStartedAtMs);
    }
    await withFirestoreRetry(() => updateDoc(doc(db, 'rooms', code), updateData));
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function finishFirebaseRoom(roomCode: string): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    const roomRef = doc(db, 'rooms', code);
    const roomSnap = await getDoc(roomRef);
    if (!roomSnap.exists()) return;
    const room = parseRoomDoc(roomSnap.id, roomSnap.data() as Record<string, unknown>);
    if (room.status === 'finished') return;

    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    const now = getSyncedNowMs();
    const participants = pSnap.docs.map((d) =>
      projectParticipantPhysics(parseParticipantDoc(d.id, d.data() as Record<string, unknown>), room, now)
    );

    // Assign finishRank to already-finished first (by finishedAt asc), then unfinished by progress desc
    const alreadyFinished = participants
      .filter((p) => p.finishedAt && p.finishedAt > 0)
      .sort((a, b) => (a.finishedAt ?? 0) - (b.finishedAt ?? 0));
    const unfinished = participants
      .filter((p) => !p.finishedAt || p.finishedAt <= 0)
      .sort((a, b) => b.progress - a.progress || b.score - a.score);

    const finishOrder = [...alreadyFinished, ...unfinished];
    const finishRankMap = new Map<string, number>();
    finishOrder.forEach((p, idx) => finishRankMap.set(p.id, idx + 1));

    const durationMap = new Map<string, number>();
    for (const p of participants) {
      if (p.durationMs && p.durationMs > 0) {
        durationMap.set(p.id, Math.round(p.durationMs));
      } else {
        const startAnchor = p.startedAt || room.startedAtMs || now;
        durationMap.set(p.id, Math.max(0, Math.round(now - startAnchor)));
      }
    }

    // Compute scoreRank (score desc -> correctCount desc -> durationMs asc -> finishRank asc)
    const byScore = [...participants].sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
      const dA = durationMap.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const dB = durationMap.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (dA !== dB) return dA - dB;
      return (finishRankMap.get(a.id) ?? 999) - (finishRankMap.get(b.id) ?? 999);
    });
    const scoreRankMap = new Map<string, number>();
    byScore.forEach((p, idx) => scoreRankMap.set(p.id, idx + 1));

    // Update all participants in a single batch (Tier 1 rules allow teacher finalization)
    if (participants.length > 0) {
      const batch = writeBatch(db);
      for (const p of participants) {
        batch.update(doc(db, 'rooms', code, 'participants', p.id), {
          effectState: 'finished',
          speed: 0,
          finishedAt: p.finishedAt && p.finishedAt > 0 ? Math.round(p.finishedAt) : now,
          durationMs: durationMap.get(p.id) ?? 0,
          finishRank: finishRankMap.get(p.id) ?? 1,
          scoreRank: scoreRankMap.get(p.id) ?? 1,
          lastSyncMs: now,
          updatedAt: serverTimestamp(),
        });
      }
      await withFirestoreRetry(() => batch.commit());
      for (const p of participants) {
        publishRelayParticipantPatch(code, {
          id: p.id,
          roomCode: code,
          effectState: 'finished',
          speed: 0,
          finishedAt: p.finishedAt && p.finishedAt > 0 ? Math.round(p.finishedAt) : now,
          durationMs: durationMap.get(p.id) ?? 0,
          finishRank: finishRankMap.get(p.id) ?? 1,
          scoreRank: scoreRankMap.get(p.id) ?? 1,
          lastSyncMs: now,
        });
      }
    }

    publishRelayRoomPatch(code, {
      status: 'finished',
      finishedAtMs: now,
      participantCount: participants.length,
    });

    await withFirestoreRetry(() =>
      updateDoc(roomRef, {
        status: 'finished',
        finishedAtMs: now,
        participantCount: participants.length,
        updatedAt: serverTimestamp(),
      })
    );
    clearRoomPositionSync(code);
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function deleteFirebaseRoom(roomCode: string): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    // Delete participant subcollection docs FIRST (rules check roomExists(roomCode)!)
    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    if (!pSnap.empty) {
      const batch = writeBatch(db);
      for (const d of pSnap.docs) {
        batch.delete(d.ref);
      }
      await batch.commit();
    }
    await deleteDoc(doc(db, 'rooms', code));
  } catch (error) {
    handleFirestoreError(error, OperationType.DELETE, path);
  }
}

export async function deleteFinishedTeacherRooms(ownerId: string): Promise<number> {
  const rooms = await listTeacherRooms(ownerId);
  const finished = rooms.filter((r) => r.status === 'finished');
  for (const rm of finished) {
    await deleteFirebaseRoom(rm.code);
  }
  return finished.length;
}

// ==================== 2. STUDENT LOOKUP, JOIN & ANSWER SYNC ====================

export async function lookupPublicRoom(roomCode: string): Promise<{
  id: string;
  code: string;
  name: string;
  subject: string;
  grade: string;
  teacherName: string;
  schoolName: string;
  status: RoomStatus;
  questionCount: number;
  participantCount: number;
  settings: RoomSettings;
}> {
  const code = normalizeRoomCode(roomCode);
  if (code.length !== 6) {
    throw new Error('Kode room harus terdiri dari 6 karakter huruf/angka.');
  }
  const path = `rooms/${code}`;
  try {
    const snap = await getDoc(doc(db, 'rooms', code));
    if (!snap.exists()) {
      throw new Error('Kode room tidak ditemukan. Periksa kembali kode dari guru Anda.');
    }
    const room = parseRoomDoc(snap.id, snap.data() as Record<string, unknown>);
    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    return {
      id: room.roomCode,
      code: room.roomCode,
      name: room.roomName,
      subject: room.subject,
      grade: room.grade,
      teacherName: room.teacherName,
      schoolName: room.schoolName,
      status: room.status,
      questionCount: room.questionCount,
      participantCount: pSnap.size,
      settings: room.settings,
    };
  } catch (error) {
    if (error instanceof Error && (error.message.includes('Kode room') || error.message.includes('tidak ditemukan'))) {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function joinFirebaseRoom(
  roomCode: string,
  input: {
    name: string;
    className: string;
    avatar: AvatarConfig;
    participantId?: string;
    reconnectToken?: string;
  }
): Promise<{
  participantId: string;
  reconnectToken: string;
  participant: LiveFirebaseParticipant;
  reconnected: boolean;
}> {
  const code = normalizeRoomCode(roomCode);
  const cleanName = clampStr(input.name, 40, '');
  const cleanClass = clampStr(input.className, 24, '');
  if (!cleanName || !cleanClass) {
    throw new Error('Nama lengkap dan kelas wajib diisi.');
  }

  const path = `rooms/${code}/participants`;
  try {
    const roomSnap = await getDoc(doc(db, 'rooms', code));
    if (!roomSnap.exists()) {
      throw new Error('Kode room tidak ditemukan.');
    }
    const room = parseRoomDoc(roomSnap.id, roomSnap.data() as Record<string, unknown>);

    const pSnap = await getDocs(
      query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))
    );
    const existingList = pSnap.docs.map((d) =>
      parseParticipantDoc(d.id, d.data() as Record<string, unknown>)
    );

    // 1. Explicit reconnect via saved token
    if (input.participantId && input.reconnectToken) {
      const found = existingList.find(
        (p) => p.id === input.participantId && p.reconnectToken === input.reconnectToken
      );
      if (found) {
        if (room.status !== 'finished') {
          await updateDoc(doc(db, 'rooms', code, 'participants', found.id), {
            connected: true,
            ...(room.status === 'waiting' ? { avatar: input.avatar } : {}),
            updatedAt: serverTimestamp(),
          });
        }
        return {
          participantId: found.id,
          reconnectToken: found.reconnectToken,
          participant: {
            ...found,
            avatar: room.status === 'waiting' ? input.avatar : found.avatar,
            connected: true,
          },
          reconnected: true,
        };
      }
    }

    // 2. Identity reconnect (same name + class in room)
    const byIdentity = existingList.find(
      (p) =>
        p.name.toLowerCase() === cleanName.toLowerCase() &&
        p.className.toLowerCase() === cleanClass.toLowerCase()
    );
    if (byIdentity) {
      if (room.status !== 'finished') {
        await updateDoc(doc(db, 'rooms', code, 'participants', byIdentity.id), {
          connected: true,
          ...(room.status === 'waiting' ? { avatar: input.avatar } : {}),
          updatedAt: serverTimestamp(),
        });
      }
      return {
        participantId: byIdentity.id,
        reconnectToken: byIdentity.reconnectToken,
        participant: {
          ...byIdentity,
          avatar: room.status === 'waiting' ? input.avatar : byIdentity.avatar,
          connected: true,
        },
        reconnected: true,
      };
    }

    if (room.status === 'finished') {
      throw new Error('Pertandingan pada room ini sudah selesai.');
    }
    if (existingList.length >= room.settings.maxPlayers) {
      throw new Error(`Room sudah penuh (maksimal ${room.settings.maxPlayers} peserta).`);
    }

    const usedLanes = new Set(existingList.map((p) => p.lane));
    let lane = 0;
    while (usedLanes.has(lane) && lane < 30) lane++;

    await calibrateServerClock();
    const participantId = `p-${randomToken(10).toLowerCase()}`;
    const reconnectToken = randomToken(24);
    const now = getSyncedNowMs();
    const isAlreadyPlaying = room.status === 'playing' || (room.status === 'countdown' && room.startedAtMs > 0 && now >= room.startedAtMs);

    const payload = {
      id: participantId,
      roomCode: code,
      reconnectToken,
      name: cleanName,
      className: cleanClass,
      avatar: {
        gender: input.avatar.gender === 'female' ? 'female' : 'male',
        color: input.avatar.color || 'blue',
        outfit: input.avatar.outfit || 'sprinter',
        ...(input.avatar.presetId ? { presetId: input.avatar.presetId } : {}),
      },
      lane,
      distance: 0,
      progress: 0,
      speed: isAlreadyPlaying ? room.settings.baseSpeed : 0,
      effectState: 'normal' as const,
      effectExpiresAt: 0,
      currentQuestionIndex: 0,
      answeredCount: 0,
      correctCount: 0,
      wrongCount: 0,
      unansweredCount: 0,
      score: 0,
      connected: true,
      startedAt: isAlreadyPlaying ? now : 0,
      finishedAt: 0,
      durationMs: 0,
      finishRank: 0,
      scoreRank: 0,
      lastSyncMs: isAlreadyPlaying ? now : 0,
      answers: [] as StoredAnswerRecord[],
      createdAt: serverTimestamp(),
      updatedAt: serverTimestamp(),
    };

    markPendingClockWrite(`rooms/${code}/participants/${participantId}`);
    await withFirestoreRetry(() =>
      setDoc(doc(db, 'rooms', code, 'participants', participantId), payload)
    );

    const parsedPart = {
      ...parseParticipantDoc(participantId, payload),
      joinedAtMs: now,
    };
    markAuthoritativeParticipantWrite(code, participantId, {
      distance: parsedPart.distance,
      progress: parsedPart.progress,
      speed: parsedPart.speed,
      effectState: parsedPart.effectState,
      effectExpiresAt: parsedPart.effectExpiresAt,
      lastSyncMs: parsedPart.lastSyncMs || now,
    });
    publishRelayParticipantPatch(code, {
      id: parsedPart.id,
      roomCode: code,
      name: parsedPart.name,
      className: parsedPart.className,
      avatar: parsedPart.avatar,
      lane: parsedPart.lane,
      distance: parsedPart.distance,
      progress: parsedPart.progress,
      speed: parsedPart.speed,
      effectState: parsedPart.effectState,
      effectExpiresAt: parsedPart.effectExpiresAt,
      currentQuestionIndex: parsedPart.currentQuestionIndex,
      answeredCount: parsedPart.answeredCount,
      correctCount: parsedPart.correctCount,
      wrongCount: parsedPart.wrongCount,
      unansweredCount: parsedPart.unansweredCount,
      score: parsedPart.score,
      connected: true,
      joinedAtMs: now,
      startedAt: parsedPart.startedAt,
      lastSyncMs: parsedPart.lastSyncMs || now,
    });

    return {
      participantId,
      reconnectToken,
      participant: parsedPart,
      reconnected: false,
    };
  } catch (error) {
    if (
      error instanceof Error &&
      (error.message.includes('Room sudah penuh') ||
        error.message.includes('sudah selesai') ||
        error.message.includes('tidak ditemukan') ||
        error.message.includes('wajib diisi'))
    ) {
      throw error;
    }
    handleFirestoreError(error, OperationType.WRITE, path);
  }
}

// ==================== 3. DETERMINISTIC 60 FPS RACE PHYSICS ====================

export interface LivePhysicsOut {
  distance: number;
  progress: number;
  speed: number;
  effectState: RunnerEffectState;
  effectExpiresAt: number;
}

/**
 * Zero-allocation deterministic physics evaluator for 60 FPS Three.js rendering.
 * Computes exact runner distance/progress/speed/effect directly from Firestore authoritative anchors.
 */
export function evaluateParticipantPhysics(
  p: LiveFirebaseParticipant,
  room: LiveFirebaseRoom,
  nowMs: number,
  out: LivePhysicsOut
): LivePhysicsOut {
  const effectivePlaying =
    room.status === 'playing' ||
    (room.status === 'countdown' && room.startedAtMs > 0 && nowMs >= room.startedAtMs);

  if (room.status === 'waiting' || (!effectivePlaying && room.status !== 'finished')) {
    out.distance = 0;
    out.progress = 0;
    out.speed = 0;
    out.effectState = p.effectState;
    out.effectExpiresAt = p.effectExpiresAt;
    return out;
  }

  if (room.status === 'finished' || p.effectState === 'finished' || (p.finishedAt && p.finishedAt > 0)) {
    out.distance = p.distance;
    out.progress = p.progress;
    out.speed = 0;
    out.effectState = 'finished';
    out.effectExpiresAt = 0;
    return out;
  }

  const trackLength = Math.max(10, room.trackLength);
  const totalQuestions = Math.max(1, room.questionCount);
  // Keep runner smoothly jogging while reading/answering the current question gate;
  // only prevent crossing the subsequent gate (or finish line) before answering.
  const nextGateBoundaryDist =
    p.answeredCount + 1 < totalQuestions
      ? Math.max(
          calcQuestionGateProgress(p.answeredCount, totalQuestions) * trackLength + 8,
          calcQuestionGateProgress(p.answeredCount + 1, totalQuestions) * trackLength - 2
        )
      : trackLength - 2;
  const maxAllowedDist =
    p.answeredCount >= totalQuestions
      ? trackLength
      : Math.min(trackLength - 0.5, nextGateBoundaryDist);

  const raceStartMs = room.startedAtMs > 0 ? room.startedAtMs : p.startedAt || nowMs;
  const anchorMs =
    p.answeredCount === 0 && p.distance <= 0.01 && room.startedAtMs > 0
      ? raceStartMs
      : Math.max(raceStartMs, p.lastSyncMs || raceStartMs);

  const baseSpeed = room.settings.baseSpeed;
  let dist = p.distance;
  let speed = p.speed > 0 ? p.speed : baseSpeed;
  let effectState: RunnerEffectState = p.effectState;
  let effectExpiresAt = p.effectExpiresAt;

  if (nowMs > anchorMs) {
    if (effectState !== 'normal' && effectExpiresAt > anchorMs) {
      if (nowMs < effectExpiresAt) {
        const dt = (nowMs - anchorMs) / 1000;
        dist = Math.min(maxAllowedDist, dist + speed * dt);
      } else {
        const dtEffect = (effectExpiresAt - anchorMs) / 1000;
        dist = Math.min(maxAllowedDist, dist + speed * dtEffect);
        const dtNormal = (nowMs - effectExpiresAt) / 1000;
        dist = Math.min(maxAllowedDist, dist + baseSpeed * dtNormal);
        effectState = 'normal';
        effectExpiresAt = 0;
        speed = baseSpeed;
      }
    } else {
      if (effectState !== 'normal' && effectExpiresAt <= nowMs) {
        effectState = 'normal';
        effectExpiresAt = 0;
        speed = baseSpeed;
      }
      const dt = (nowMs - anchorMs) / 1000;
      dist = Math.min(maxAllowedDist, dist + speed * dt);
    }
  }

  out.distance = dist;
  out.progress = Math.max(0, Math.min(1, dist / trackLength));
  out.speed = Number(speed.toFixed(2));
  out.effectState = effectState;
  out.effectExpiresAt = effectExpiresAt;
  return out;
}

const _sharedPhysicsOut: LivePhysicsOut = {
  distance: 0,
  progress: 0,
  speed: 0,
  effectState: 'normal',
  effectExpiresAt: 0,
};

export function projectParticipantPhysics(
  p: LiveFirebaseParticipant,
  room: LiveFirebaseRoom,
  nowMs: number
): LiveFirebaseParticipant {
  evaluateParticipantPhysics(p, room, nowMs, _sharedPhysicsOut);
  return {
    ...p,
    distance: _sharedPhysicsOut.distance,
    progress: _sharedPhysicsOut.progress,
    speed: _sharedPhysicsOut.speed,
    effectState: _sharedPhysicsOut.effectState,
    effectExpiresAt: _sharedPhysicsOut.effectExpiresAt,
  };
}

function normalizeShortAnswer(s: string): string {
  return s.trim().toLowerCase().replace(/\s+/g, ' ');
}

export interface PreparedAnswerResult {
  isCorrect: boolean;
  isTimeout: boolean;
  pointsEarned: number;
  correctAnswer: string;
  explanation: string;
  effectState: RunnerEffectState;
  effectDurationSec: number;
  score: number;
  nextParticipant: LiveFirebaseParticipant;
  updatePayload: Record<string, unknown>;
}

/**
 * Computes answer evaluation & physics transition synchronously so StudentRaceView can apply
 * 0ms optimistic boost/penalty feedback while Firestore sync runs concurrently.
 */
export function prepareParticipantAnswer(params: {
  room: LiveFirebaseRoom;
  participant: LiveFirebaseParticipant;
  questionIndex: number;
  submittedAnswer: string | null;
  isTimeout: boolean;
  questionStartedAt: number;
}): PreparedAnswerResult {
  const { room, participant, questionIndex, submittedAnswer, isTimeout, questionStartedAt } = params;
  const q = room.questions[questionIndex];
  if (!q) {
    throw new Error('Soal tidak ditemukan.');
  }

  if (participant.answers.some((a) => a.questionIndex === questionIndex)) {
    throw new Error('Jawaban untuk soal ini sudah tercatat.');
  }

  const now = getSyncedNowMs();
  const projected = projectParticipantPhysics(participant, room, now);
  const responseTimeMs = Math.max(100, Math.min(180000, Math.round(now - questionStartedAt)));

  let isCorrect = false;
  if (!isTimeout && submittedAnswer !== null) {
    if (q.questionType === 'short_answer') {
      isCorrect = normalizeShortAnswer(submittedAnswer) === normalizeShortAnswer(q.correctAnswer);
    } else {
      isCorrect = submittedAnswer.trim().toUpperCase() === q.correctAnswer.trim().toUpperCase();
    }
  }

  const totalQuestions = Math.max(1, room.questionCount);
  let pointsEarned = 0;
  let nextScore = projected.score;
  const nextCorrectCount = projected.correctCount + (isCorrect ? 1 : 0);
  if (isCorrect) {
    nextScore = calcScoreFromCorrect(nextCorrectCount, totalQuestions);
    pointsEarned = Number((nextScore - projected.score).toFixed(2));
  }

  const nextAnsweredCount = projected.answeredCount + 1;
  const nextWrongCount = projected.wrongCount + (!isTimeout && !isCorrect ? 1 : 0);
  const nextUnansweredCount = projected.unansweredCount + (isTimeout ? 1 : 0);

  let nextEffectState: RunnerEffectState = 'normal';
  let nextEffectExpiresAt = 0;
  let nextSpeed = room.settings.baseSpeed;
  let nextDistance = projected.distance;

  if (isCorrect) {
    nextEffectState = 'boost';
    nextEffectExpiresAt = now + room.settings.boostDuration * 1000;
    nextSpeed = Number((room.settings.baseSpeed * 2.25).toFixed(2));
    nextDistance = Math.min(room.trackLength, projected.distance + 5);
  } else {
    nextEffectState = 'penalty';
    nextEffectExpiresAt = now + room.settings.penaltyDuration * 1000;
    nextSpeed = Number((room.settings.baseSpeed * 0.42).toFixed(2));
  }

  const nextProgress = Math.max(0, Math.min(1, Number((nextDistance / room.trackLength).toFixed(6))));
  const answerRec: StoredAnswerRecord = {
    questionIndex,
    questionId: q.id,
    submittedAnswer: submittedAnswer ? submittedAnswer.slice(0, 120) : null,
    isCorrect,
    isTimeout,
    pointsEarned,
    responseTimeMs,
  };
  const nextAnswers = [...participant.answers, answerRec].slice(0, 50);
  const startedAtVal = participant.startedAt || room.startedAtMs || now;

  const updatePayload = {
    distance: Number(nextDistance.toFixed(2)),
    progress: nextProgress,
    speed: nextSpeed,
    effectState: nextEffectState,
    effectExpiresAt: nextEffectExpiresAt,
    currentQuestionIndex: Math.min(totalQuestions, questionIndex + 1),
    answeredCount: Math.min(totalQuestions, nextAnsweredCount),
    correctCount: Math.min(totalQuestions, nextCorrectCount),
    wrongCount: Math.min(totalQuestions, nextWrongCount),
    unansweredCount: Math.min(totalQuestions, nextUnansweredCount),
    score: Math.min(100, Number(nextScore.toFixed(2))),
    connected: true,
    startedAt: Math.round(startedAtVal),
    lastSyncMs: now,
    answers: nextAnswers,
    updatedAt: serverTimestamp(),
  };

  return {
    isCorrect,
    isTimeout,
    pointsEarned,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    effectState: nextEffectState,
    effectDurationSec: isCorrect ? room.settings.boostDuration : room.settings.penaltyDuration,
    score: updatePayload.score,
    nextParticipant: {
      ...participant,
      ...updatePayload,
      startedAt: updatePayload.startedAt,
    },
    updatePayload,
  };
}

const _positionSyncOut: LivePhysicsOut = {
  distance: 0,
  progress: 0,
  speed: 0,
  effectState: 'normal',
  effectExpiresAt: 0,
};

/**
 * Sends a rate-limited character position checkpoint to Firebase Firestore.
 * Protected by per-participant cooldown (>= 2.5s), token-bucket cap, trailing-edge coalescing,
 * delta suppression, single-flight serialization, and adaptive backoff to minimize network
 * traffic and server load while keeping 60 FPS rendering smooth.
 */
export function syncParticipantPosition(params: {
  room: LiveFirebaseRoom;
  participant: LiveFirebaseParticipant;
}): RateLimitScheduleResult {
  const { room, participant } = params;
  const now = getSyncedNowMs();
  const isPlayingNow =
    room.status === 'playing' ||
    (room.status === 'countdown' && room.startedAtMs > 0 && now >= room.startedAtMs);
  if (!isPlayingNow) {
    return 'suppressed_delta';
  }
  if (
    participant.effectState === 'finished' ||
    (participant.finishedAt && participant.finishedAt > 0)
  ) {
    return 'ignored_terminal';
  }

  evaluateParticipantPhysics(participant, room, now, _positionSyncOut);
  const code = normalizeRoomCode(room.roomCode);
  const path = `rooms/${code}/participants/${participant.id}`;
  const snapshot: PositionSyncSnapshot = {
    distance: Number(Math.max(0, Math.min(room.trackLength, _positionSyncOut.distance)).toFixed(2)),
    progress: Number(Math.max(0, Math.min(1, _positionSyncOut.progress)).toFixed(6)),
    speed: Number(Math.max(0, Math.min(60, _positionSyncOut.speed)).toFixed(2)),
    effectState: _positionSyncOut.effectState,
    effectExpiresAt: Math.max(0, Math.round(_positionSyncOut.effectExpiresAt)),
    lastSyncMs: now,
  };

  return scheduleRateLimitedPositionWrite(code, participant.id, snapshot, async (snap) => {
    publishRelayParticipantPatch(code, {
      id: participant.id,
      roomCode: code,
      distance: snap.distance,
      progress: snap.progress,
      speed: snap.speed,
      effectState: snap.effectState,
      effectExpiresAt: snap.effectExpiresAt,
      lastSyncMs: snap.lastSyncMs,
    });

    try {
      markPendingClockWrite(path);
      await updateDoc(doc(db, 'rooms', code, 'participants', participant.id), {
        distance: snap.distance,
        progress: snap.progress,
        speed: snap.speed,
        effectState: snap.effectState,
        effectExpiresAt: snap.effectExpiresAt,
        lastSyncMs: snap.lastSyncMs,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      handleFirestoreError(error, OperationType.UPDATE, path);
    }
  });
}

export async function commitParticipantAnswer(
  roomCode: string,
  participantId: string,
  updatePayload: Record<string, unknown>
): Promise<void> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}/participants/${participantId}`;
  const syncMs =
    typeof updatePayload.lastSyncMs === 'number' ? updatePayload.lastSyncMs : getSyncedNowMs();

  // Cancel any pending deferred position-only write and reset rate-limit cooldown
  markAuthoritativeParticipantWrite(code, participantId, {
    distance: typeof updatePayload.distance === 'number' ? updatePayload.distance : 0,
    progress: typeof updatePayload.progress === 'number' ? updatePayload.progress : 0,
    speed: typeof updatePayload.speed === 'number' ? updatePayload.speed : 0,
    effectState: (updatePayload.effectState as RunnerEffectState) || 'normal',
    effectExpiresAt:
      typeof updatePayload.effectExpiresAt === 'number' ? updatePayload.effectExpiresAt : 0,
    lastSyncMs: syncMs,
  });

  // Push delta immediately over WebSocket fast-lane (~15-35ms to Teacher Preview & peers)
  publishRelayParticipantPatch(code, {
    id: participantId,
    roomCode: code,
    distance: typeof updatePayload.distance === 'number' ? updatePayload.distance : undefined,
    progress: typeof updatePayload.progress === 'number' ? updatePayload.progress : undefined,
    speed: typeof updatePayload.speed === 'number' ? updatePayload.speed : undefined,
    effectState: updatePayload.effectState as RunnerEffectState | undefined,
    effectExpiresAt:
      typeof updatePayload.effectExpiresAt === 'number' ? updatePayload.effectExpiresAt : undefined,
    currentQuestionIndex:
      typeof updatePayload.currentQuestionIndex === 'number'
        ? updatePayload.currentQuestionIndex
        : undefined,
    answeredCount:
      typeof updatePayload.answeredCount === 'number' ? updatePayload.answeredCount : undefined,
    correctCount:
      typeof updatePayload.correctCount === 'number' ? updatePayload.correctCount : undefined,
    wrongCount:
      typeof updatePayload.wrongCount === 'number' ? updatePayload.wrongCount : undefined,
    unansweredCount:
      typeof updatePayload.unansweredCount === 'number'
        ? updatePayload.unansweredCount
        : undefined,
    score: typeof updatePayload.score === 'number' ? updatePayload.score : undefined,
    connected: true,
    startedAt: typeof updatePayload.startedAt === 'number' ? updatePayload.startedAt : undefined,
    lastSyncMs: syncMs,
  });

  try {
    markPendingClockWrite(path);
    await withFirestoreRetry(() =>
      updateDoc(doc(db, 'rooms', code, 'participants', participantId), updatePayload)
    );
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

export async function submitParticipantAnswer(params: {
  room: LiveFirebaseRoom;
  participant: LiveFirebaseParticipant;
  questionIndex: number;
  submittedAnswer: string | null;
  isTimeout: boolean;
  questionStartedAt: number;
}): Promise<{
  isCorrect: boolean;
  isTimeout: boolean;
  pointsEarned: number;
  correctAnswer: string;
  explanation: string;
  effectState: RunnerEffectState;
  effectDurationSec: number;
  score: number;
  nextParticipant: LiveFirebaseParticipant;
}> {
  const prepared = prepareParticipantAnswer(params);
  await commitParticipantAnswer(params.room.roomCode, params.participant.id, prepared.updatePayload);
  return prepared;
}

export async function syncParticipantFinished(params: {
  room: LiveFirebaseRoom;
  participant: LiveFirebaseParticipant;
  alreadyFinishedCount: number;
}): Promise<{ finishRank: number; durationMs: number }> {
  const { room, participant, alreadyFinishedCount } = params;
  const code = normalizeRoomCode(room.roomCode);
  const now = getSyncedNowMs();
  const startAnchor = participant.startedAt || room.startedAtMs || now;
  const durationMs = Math.max(100, Math.round(now - startAnchor));
  const finishRank = Math.max(1, Math.min(30, alreadyFinishedCount + 1));

  // Permanently halt deferred position-only writes for this finished runner
  markAuthoritativeParticipantWrite(
    code,
    participant.id,
    {
      distance: room.trackLength,
      progress: 1,
      speed: 0,
      effectState: 'finished',
      effectExpiresAt: 0,
      lastSyncMs: now,
    },
    { terminal: true }
  );

  // Push finish event immediately via WebSocket fast-lane (<20ms)
  publishRelayParticipantPatch(code, {
    id: participant.id,
    roomCode: code,
    distance: room.trackLength,
    progress: 1,
    speed: 0,
    effectState: 'finished',
    effectExpiresAt: 0,
    finishedAt: now,
    durationMs,
    finishRank,
    lastSyncMs: now,
  });

  const path = `rooms/${code}/participants/${participant.id}`;
  try {
    await withFirestoreRetry(() =>
      updateDoc(doc(db, 'rooms', code, 'participants', participant.id), {
        distance: room.trackLength,
        progress: 1,
        speed: 0,
        effectState: 'finished',
        effectExpiresAt: 0,
        finishedAt: now,
        durationMs,
        finishRank,
        lastSyncMs: now,
        updatedAt: serverTimestamp(),
      })
    );
    return { finishRank, durationMs };
  } catch (error) {
    handleFirestoreError(error, OperationType.UPDATE, path);
  }
}

// ==================== 4. DUAL-CHANNEL REAL-TIME SUBSCRIPTION ====================
// Combines durable Firestore onSnapshot with <20ms WebSocket fast-lane relay + monotonic reconciliation
// so Teacher Preview and Students stay locked in real time with zero stale-snapshot rollbacks.

const ROOM_STATUS_RANK: Record<RoomStatus, number> = {
  waiting: 0,
  countdown: 1,
  playing: 2,
  finished: 3,
};

function mergeRoomMonotonic(
  current: LiveFirebaseRoom | null,
  incoming: LiveFirebaseRoom
): LiveFirebaseRoom {
  if (!current) return incoming;
  const curRank = ROOM_STATUS_RANK[current.status] ?? 0;
  const incRank = ROOM_STATUS_RANK[incoming.status] ?? 0;
  if (incRank < curRank) {
    return {
      ...incoming,
      status: current.status,
      countdownStartMs: current.countdownStartMs || incoming.countdownStartMs,
      startedAtMs: current.startedAtMs || incoming.startedAtMs,
      finishedAtMs: current.finishedAtMs || incoming.finishedAtMs,
      participantCount: Math.max(current.participantCount, incoming.participantCount),
      musicTrack: incoming.musicTrack ?? current.musicTrack,
    };
  }
  return {
    ...incoming,
    musicTrack: incoming.musicTrack ?? current.musicTrack,
  };
}

function applyRelayRoomPatch(
  current: LiveFirebaseRoom | null,
  patch: LiveRelayRoomPatch
): LiveFirebaseRoom | null {
  if (!current) return null;
  const curRank = ROOM_STATUS_RANK[current.status] ?? 0;
  const patchRank = patch.status ? ROOM_STATUS_RANK[patch.status] ?? 0 : curRank;
  const nextStatus = patchRank >= curRank && patch.status ? patch.status : current.status;
  const nextCountdown = patch.countdownStartMs ?? current.countdownStartMs;
  const nextStarted = patch.startedAtMs ?? current.startedAtMs;
  const nextFinished = patch.finishedAtMs ?? current.finishedAtMs;
  const nextCount = Math.max(current.participantCount, patch.participantCount ?? 0);
  const nextMusicTrack = patch.musicTrack ?? current.musicTrack;

  if (
    nextStatus === current.status &&
    nextCountdown === current.countdownStartMs &&
    nextStarted === current.startedAtMs &&
    nextFinished === current.finishedAtMs &&
    nextCount === current.participantCount &&
    nextMusicTrack === current.musicTrack
  ) {
    return null;
  }

  return {
    ...current,
    status: nextStatus,
    countdownStartMs: nextCountdown,
    startedAtMs: nextStarted,
    finishedAtMs: nextFinished,
    participantCount: nextCount,
    musicTrack: nextMusicTrack,
  };
}

function mergeParticipantFromFirestore(
  existing: LiveFirebaseParticipant | undefined,
  incoming: LiveFirebaseParticipant
): LiveFirebaseParticipant {
  if (!existing) return incoming;

  const existingFinished = Boolean(existing.finishedAt && existing.finishedAt > 0);
  const incomingFinished = Boolean(incoming.finishedAt && incoming.finishedAt > 0);

  // Never let an older in-flight Firestore snapshot regress a newer fast-lane WS state
  if (existingFinished && !incomingFinished) {
    return {
      ...incoming,
      distance: existing.distance,
      progress: existing.progress,
      speed: 0,
      effectState: 'finished',
      effectExpiresAt: 0,
      finishedAt: existing.finishedAt,
      durationMs: existing.durationMs,
      finishRank: existing.finishRank,
      scoreRank: existing.scoreRank ?? incoming.scoreRank,
      lastSyncMs: Math.max(existing.lastSyncMs, incoming.lastSyncMs),
    };
  }

  if (
    !incomingFinished &&
    (incoming.answeredCount < existing.answeredCount ||
      (incoming.answeredCount === existing.answeredCount &&
        incoming.lastSyncMs < existing.lastSyncMs - 50))
  ) {
    return {
      ...existing,
      // Always keep authoritative answers/reconnectToken from Firestore
      reconnectToken: incoming.reconnectToken || existing.reconnectToken,
      joinedAtMs: incoming.joinedAtMs ?? existing.joinedAtMs,
      answers: incoming.answers.length >= existing.answers.length ? incoming.answers : existing.answers,
      scoreRank: incoming.scoreRank ?? existing.scoreRank,
    };
  }

  return {
    ...incoming,
    joinedAtMs: incoming.joinedAtMs ?? existing.joinedAtMs,
  };
}

function applyRelayParticipantPatch(
  existing: LiveFirebaseParticipant | undefined,
  patch: LiveRelayParticipantPatch
): LiveFirebaseParticipant | null {
  if (!existing) {
    // Only materialize a brand-new runner from relay if we have their display identity
    if (!patch.name || patch.lane === undefined) return null;
    return {
      id: patch.id,
      roomCode: patch.roomCode,
      reconnectToken: '',
      name: patch.name,
      className: patch.className || '-',
      avatar: patch.avatar || { gender: 'male', color: 'blue', outfit: 'sprinter' },
      lane: patch.lane,
      distance: patch.distance ?? 0,
      progress: patch.progress ?? 0,
      speed: patch.speed ?? 0,
      effectState: patch.effectState ?? 'normal',
      effectExpiresAt: patch.effectExpiresAt ?? 0,
      currentQuestionIndex: patch.currentQuestionIndex ?? 0,
      answeredCount: patch.answeredCount ?? 0,
      correctCount: patch.correctCount ?? 0,
      wrongCount: patch.wrongCount ?? 0,
      unansweredCount: patch.unansweredCount ?? 0,
      score: patch.score ?? 0,
      connected: patch.connected ?? true,
      joinedAtMs: patch.joinedAtMs ?? getSyncedNowMs(),
      startedAt: patch.startedAt,
      finishedAt: patch.finishedAt,
      durationMs: patch.durationMs,
      finishRank: patch.finishRank,
      scoreRank: patch.scoreRank,
      lastSyncMs: patch.lastSyncMs,
      answers: [],
    };
  }

  const existingFinished = Boolean(existing.finishedAt && existing.finishedAt > 0);
  const incomingFinished = Boolean(patch.finishedAt && patch.finishedAt > 0);
  if (existingFinished && !incomingFinished) {
    if (patch.scoreRank && patch.scoreRank !== existing.scoreRank) {
      return { ...existing, scoreRank: patch.scoreRank };
    }
    return null;
  }

  const nextAnswered = patch.answeredCount ?? existing.answeredCount;
  if (!incomingFinished && nextAnswered < existing.answeredCount) {
    return null;
  }
  if (
    !incomingFinished &&
    nextAnswered === existing.answeredCount &&
    patch.lastSyncMs < existing.lastSyncMs
  ) {
    return null;
  }

  return {
    ...existing,
    name: patch.name ?? existing.name,
    className: patch.className ?? existing.className,
    avatar: patch.avatar ?? existing.avatar,
    lane: patch.lane ?? existing.lane,
    distance: patch.distance ?? existing.distance,
    progress: patch.progress ?? existing.progress,
    speed: patch.speed ?? existing.speed,
    effectState: patch.effectState ?? existing.effectState,
    effectExpiresAt: patch.effectExpiresAt ?? existing.effectExpiresAt,
    currentQuestionIndex: patch.currentQuestionIndex ?? existing.currentQuestionIndex,
    answeredCount: nextAnswered,
    correctCount: patch.correctCount ?? existing.correctCount,
    wrongCount: patch.wrongCount ?? existing.wrongCount,
    unansweredCount: patch.unansweredCount ?? existing.unansweredCount,
    score: patch.score ?? existing.score,
    connected: patch.connected ?? existing.connected,
    joinedAtMs: existing.joinedAtMs ?? patch.joinedAtMs,
    startedAt: patch.startedAt ?? existing.startedAt,
    finishedAt: patch.finishedAt ?? existing.finishedAt,
    durationMs: patch.durationMs ?? existing.durationMs,
    finishRank: patch.finishRank ?? existing.finishRank,
    scoreRank: patch.scoreRank ?? existing.scoreRank,
    lastSyncMs: Math.max(existing.lastSyncMs, patch.lastSyncMs),
  };
}

export function subscribeLiveRoom(
  roomCode: string,
  callbacks: {
    onRoom: (room: LiveFirebaseRoom | null) => void;
    onParticipants: (participants: LiveFirebaseParticipant[]) => void;
    onError?: (err: Error) => void;
  }
): Unsubscribe {
  const code = normalizeRoomCode(roomCode);
  const roomPath = `rooms/${code}`;
  const partPath = `rooms/${code}/participants`;

  let currentRoom: LiveFirebaseRoom | null = null;
  let pendingRelayRoomPatch: LiveRelayRoomPatch | null = null;
  const participantsById = new Map<string, LiveFirebaseParticipant>();

  const emitParticipants = () => {
    const sorted = Array.from(participantsById.values()).sort((a, b) => a.lane - b.lane);
    callbacks.onParticipants(sorted);
  };

  // 1. Ultra-low-latency WebSocket fast-lane (<20ms fan-out)
  const unsubRelay = subscribeRelayRoom(code, {
    onRoomPatch: (patch) => {
      if (!currentRoom) {
        pendingRelayRoomPatch = patch;
        return;
      }
      const next = applyRelayRoomPatch(currentRoom, patch);
      if (next) {
        currentRoom = next;
        callbacks.onRoom(currentRoom);
      }
    },
    onParticipantPatch: (patch) => {
      const merged = applyRelayParticipantPatch(participantsById.get(patch.id), patch);
      if (merged) {
        participantsById.set(merged.id, merged);
        emitParticipants();
      }
    },
  });

  // 2. Authoritative Firestore room snapshot
  const unsubRoom = onSnapshot(
    doc(db, 'rooms', code),
    (snap) => {
      if (!snap.exists()) {
        currentRoom = null;
        callbacks.onRoom(null);
        return;
      }
      const rawData = snap.data() as Record<string, unknown>;
      if (!snap.metadata.hasPendingWrites) {
        const ts = rawData.updatedAt as Timestamp | undefined;
        if (ts && typeof ts.toMillis === 'function') {
          tryCalibrateFromServerWrite(roomPath, ts.toMillis());
        }
      }
      let nextRoom = mergeRoomMonotonic(currentRoom, parseRoomDoc(snap.id, rawData));
      if (pendingRelayRoomPatch) {
        const patched = applyRelayRoomPatch(nextRoom, pendingRelayRoomPatch);
        if (patched) nextRoom = patched;
        pendingRelayRoomPatch = null;
      }
      currentRoom = nextRoom;
      callbacks.onRoom(currentRoom);
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.GET, roomPath);
      } catch (wrapped) {
        callbacks.onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  // 3. Authoritative Firestore participants snapshot
  const unsubParts = onSnapshot(
    query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code)),
    (snap) => {
      const fromServer = !snap.metadata.hasPendingWrites;
      const seenIds = new Set<string>();
      for (const d of snap.docs) {
        const rawData = d.data() as Record<string, unknown>;
        if (fromServer) {
          const ts = rawData.updatedAt as Timestamp | undefined;
          if (ts && typeof ts.toMillis === 'function') {
            tryCalibrateFromServerWrite(`${partPath}/${d.id}`, ts.toMillis());
          }
        }
        const parsed = parseParticipantDoc(d.id, rawData);
        const merged = mergeParticipantFromFirestore(participantsById.get(parsed.id), parsed);
        participantsById.set(merged.id, merged);
        seenIds.add(merged.id);
      }

      // Remove deleted participants only if they weren't just freshly created via fast-lane (<5s ago)
      const now = getSyncedNowMs();
      for (const [id, existing] of participantsById) {
        if (!seenIds.has(id) && now - existing.lastSyncMs > 5000) {
          participantsById.delete(id);
        }
      }

      emitParticipants();
    },
    (err) => {
      try {
        handleFirestoreError(err, OperationType.LIST, partPath);
      } catch (wrapped) {
        callbacks.onError?.(wrapped instanceof Error ? wrapped : new Error(String(wrapped)));
      }
    }
  );

  return () => {
    unsubRelay();
    unsubRoom();
    unsubParts();
  };
}

// ==================== 5. RESULTS, REVIEW & BROWSER EXCEL EXPORT ====================

export async function getFirebaseRoomResults(
  roomCode: string,
  localParticipantId?: string
): Promise<FirebaseRoomResultBundle> {
  const code = normalizeRoomCode(roomCode);
  const path = `rooms/${code}`;
  try {
    const [roomSnap, pSnap] = await Promise.all([
      getDoc(doc(db, 'rooms', code)),
      getDocs(query(collection(db, 'rooms', code, 'participants'), where('roomCode', '==', code))),
    ]);

    if (!roomSnap.exists()) {
      throw new Error('Room tidak ditemukan.');
    }

    const room = parseRoomDoc(roomSnap.id, roomSnap.data() as Record<string, unknown>);
    const participants = pSnap.docs.map((d) =>
      parseParticipantDoc(d.id, d.data() as Record<string, unknown>)
    );

    const byScore = [...participants]
      .sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        if (b.correctCount !== a.correctCount) return b.correctCount - a.correctCount;
        const dA = a.durationMs ?? Number.MAX_SAFE_INTEGER;
        const dB = b.durationMs ?? Number.MAX_SAFE_INTEGER;
        if (dA !== dB) return dA - dB;
        return (a.finishRank ?? 999) - (b.finishRank ?? 999);
      })
      .map((p, idx) => ({ ...p, scoreRank: p.scoreRank ?? idx + 1 }));

    const byFinish = [...participants]
      .sort((a, b) => {
        const fA = a.finishRank ?? 999;
        const fB = b.finishRank ?? 999;
        if (fA !== fB) return fA - fB;
        return b.progress - a.progress;
      })
      .map((p, idx) => ({ ...p, finishRank: p.finishRank ?? idx + 1 }));

    // Build detailed answer rows & question analysis
    const answerDetails: ExcelAnswerDetailRow[] = [];
    const analysisMap = new Map<
      number,
      { correct: number; wrong: number; unanswered: number }
    >();

    for (let i = 0; i < room.questions.length; i++) {
      analysisMap.set(i, { correct: 0, wrong: 0, unanswered: 0 });
    }

    for (const p of byScore) {
      const ansByIdx = new Map(p.answers.map((a) => [a.questionIndex, a]));
      for (let i = 0; i < room.questions.length; i++) {
        const q = room.questions[i];
        const a = ansByIdx.get(i);
        const bucket = analysisMap.get(i)!;

        if (!a || a.isTimeout) {
          bucket.unanswered += 1;
          answerDetails.push({
            questionNumber: i + 1,
            participantName: p.name,
            className: p.className,
            prompt: q.prompt,
            submittedAnswer: '-',
            correctAnswer: q.correctAnswer,
            status: 'Tidak Dijawab',
            points: 0,
            responseTimeSec: a ? a.responseTimeMs / 1000 : room.settings.timePerQuestion,
          });
        } else if (a.isCorrect) {
          bucket.correct += 1;
          answerDetails.push({
            questionNumber: i + 1,
            participantName: p.name,
            className: p.className,
            prompt: q.prompt,
            submittedAnswer: a.submittedAnswer || '-',
            correctAnswer: q.correctAnswer,
            status: 'Benar',
            points: a.pointsEarned,
            responseTimeSec: a.responseTimeMs / 1000,
          });
        } else {
          bucket.wrong += 1;
          answerDetails.push({
            questionNumber: i + 1,
            participantName: p.name,
            className: p.className,
            prompt: q.prompt,
            submittedAnswer: a.submittedAnswer || '-',
            correctAnswer: q.correctAnswer,
            status: 'Salah',
            points: 0,
            responseTimeSec: a.responseTimeMs / 1000,
          });
        }
      }
    }

    const totalParts = Math.max(1, participants.length);
    const questionAnalysis: ExcelQuestionAnalysisRow[] = room.questions.map((q, idx) => {
      const bucket = analysisMap.get(idx) || { correct: 0, wrong: 0, unanswered: 0 };
      const correctPct = participants.length > 0 ? (bucket.correct / totalParts) * 100 : 0;
      const difficulty: 'Mudah' | 'Sedang' | 'Sulit' =
        correctPct >= 70 ? 'Mudah' : correctPct >= 40 ? 'Sedang' : 'Sulit';
      return {
        questionNumber: idx + 1,
        prompt: q.prompt,
        subject: q.subject,
        correctCount: bucket.correct,
        wrongCount: bucket.wrong,
        unansweredCount: bucket.unanswered,
        correctPct: Number(correctPct.toFixed(1)),
        difficulty,
      };
    });

    // Build personal review items if localParticipantId provided
    let review: AnswerReviewItem[] = [];
    if (localParticipantId) {
      const me = participants.find((p) => p.id === localParticipantId);
      const ansByIdx = new Map((me?.answers || []).map((a) => [a.questionIndex, a]));
      review = room.questions.map((q, idx) => {
        const a = ansByIdx.get(idx);
        return {
          questionIndex: idx,
          questionId: q.id,
          prompt: q.prompt,
          questionType: q.questionType,
          options: q.options,
          submittedAnswer: a?.submittedAnswer ?? null,
          correctAnswer: q.correctAnswer,
          isCorrect: Boolean(a?.isCorrect),
          isTimeout: a ? Boolean(a.isTimeout) : true,
          pointsEarned: a?.pointsEarned ?? 0,
          explanation: q.explanation,
          responseTimeMs: a?.responseTimeMs ?? 0,
        };
      });
    }

    return {
      room: {
        id: room.roomCode,
        code: room.roomCode,
        name: room.roomName,
        subject: room.subject,
        grade: room.grade,
        teacherName: room.teacherName,
        schoolName: room.schoolName,
        status: room.status,
        questionCount: room.questionCount,
        totalLaps: room.totalLaps,
        pointsPerQuestion: room.pointsPerQuestion,
        maxScore: MAX_MATCH_SCORE,
        createdAtIso: room.createdAtIso,
        finishedAtMs: room.finishedAtMs,
      },
      byScore,
      byFinish,
      questionAnalysis,
      answerDetails,
      review,
    };
  } catch (error) {
    if (error instanceof Error && error.message === 'Room tidak ditemukan.') {
      throw error;
    }
    handleFirestoreError(error, OperationType.GET, path);
  }
}

export async function buildRoomExcelBlobFromFirebase(roomCode: string): Promise<{
  blob: Blob;
  filename: string;
}> {
  const res = await getFirebaseRoomResults(roomCode);
  const matchDate = new Date(res.room.finishedAtMs || res.room.createdAtIso).toLocaleDateString(
    'id-ID',
    { day: '2-digit', month: 'long', year: 'numeric' }
  );

  const meta: ExcelRoomMeta = {
    schoolName: res.room.schoolName,
    teacherName: res.room.teacherName,
    roomName: res.room.name,
    subject: res.room.subject,
    grade: res.room.grade,
    roomCode: res.room.code,
    matchDate,
    questionCount: res.room.questionCount,
    totalLaps: res.room.totalLaps,
    pointsPerQuestion: res.room.pointsPerQuestion,
    maxScore: res.room.maxScore,
    participantCount: res.byScore.length,
  };

  const participantRows: ExcelParticipantRow[] = res.byScore.map((p, idx) => ({
    name: p.name,
    className: p.className,
    correctCount: p.correctCount,
    wrongCount: p.wrongCount,
    unansweredCount: p.unansweredCount,
    totalPoints: Number(p.score.toFixed(2)),
    finalScore: Number(p.score.toFixed(2)),
    scoreRank: p.scoreRank ?? idx + 1,
    finishRank: p.finishRank ?? null,
    durationMs: p.durationMs ?? null,
  }));

  const blob = await generateMatchExcelBlob(
    meta,
    participantRows,
    res.answerDetails,
    res.questionAnalysis
  );
  const safeName = res.room.name
    .replace(/[^a-zA-Z0-9\s_-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
    .slice(0, 36);
  const filename = safeName
    ? `Rekap-Nilai-${res.room.code}-${safeName}.xlsx`
    : `Rekap-Nilai-${res.room.code}.xlsx`;

  return { blob, filename };
}

export async function downloadRoomExcelFromFirebase(roomCode: string): Promise<void> {
  const { blob, filename } = await buildRoomExcelBlobFromFirebase(roomCode);
  triggerBlobDownload(blob, filename);
}
